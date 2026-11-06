import { normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import { salesService } from './salesService'
import { expenseService } from './expenseService'
import { tenantService, TENANT_COMPANY_NAME, type TenantLease } from './tenantService'
import type { ParticularItem } from '@/utils/particularsUtils'

export type AuditStatus = 'Verified' | 'Pending Audit' | 'Flagged'

export type TransactionCategory =
  | 'Petty Cash'
  | 'Rendered Fee'
  | 'BBMP Foundation'
  | 'HDMF'
  | 'Philhealth'
  | 'Electricity'
  | 'BIR'
  | 'Payroll'
  | 'SSS'
  | 'Hotel Supplies'
  | 'Revolving Funds'
  | string

export interface DashboardTransactionItem {
  id: string
  refNo: string
  chequeNo?: string
  date: string // e.g. "October 1, 2026" or "2026-10-01"
  type: 'Expense' | 'Sales' | 'Loan' | 'Income' | 'Petty Cash'
  company: string
  description: string
  particulars?: string
  amount: number
  withdrawal: number
  deposit: number
  category: TransactionCategory
  paymentMethod?: string
  status: 'Paid' | 'Pending' | 'Overdue' | 'Partially Paid' | 'On hold' | 'Unpaid'
  auditStatus: AuditStatus
  auditedBy?: string
  auditNotes?: string
  auditDate?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
  attachments?: string[]
  items?: ParticularItem[]
  /** The other side of a record shown for another company (lender loan row, petty cash rows). Read only. */
  isMirrorRow?: boolean
  /** Endorsed by Finance but not yet approved by Internal Audit. */
  awaitingAudit?: boolean
  /** The paid part of a sale or expense (spec 0013, AC-10). Used by the cash ledger tab. */
  paidAmount?: number
}

/**
 * What the Dashboard shows. Everything in it comes from the database (real sales and expenses). The totals,
 * charts and counts on the page are worked out from these rows (spec 0018).
 */
export interface DashboardData {
  recentTransactions: DashboardTransactionItem[]
}

const dashboardCache = new Map<string, { data: DashboardData; timestamp: number }>()
const DASHBOARD_CACHE_TTL = 20000

export const dashboardService = {
  invalidateCache(): void {
    dashboardCache.clear()
  },

  /** Throws when the data cannot be read, so the page can say so instead of showing zeros. */
  async getDashboardData(filters?: { company?: string; companies?: string[] }): Promise<DashboardData> {
    const isSingleCompany =
      !!filters?.company && filters.company !== 'All Companies'
        ? filters.company
        : filters?.companies && filters.companies.length === 1 && filters.companies[0] !== 'All Companies'
        ? filters.companies[0]
        : undefined

    const cacheKey = isSingleCompany || 'All Companies'
    const cached = dashboardCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < DASHBOARD_CACHE_TTL) {
      return cached.data
    }

    const shouldFetchTenants = !isSingleCompany || isCompanyMatch(TENANT_COMPANY_NAME, isSingleCompany)

    const [sales, expenses, tenantLeases] = await Promise.all([
      salesService.getSales(isSingleCompany),
      expenseService.getExpenses({ company: isSingleCompany }),
      shouldFetchTenants
        ? tenantService.listLeases().catch((err) => {
            console.warn('Tenant leases not available for dashboard:', err)
            return [] as TenantLease[]
          })
        : Promise.resolve([] as TenantLease[]),
    ])

    const tenantTransactions: DashboardTransactionItem[] = []
    tenantLeases.forEach((lease) => {
      const leaseCompany = lease.companyName || TENANT_COMPANY_NAME
      if (isSingleCompany && !isCompanyMatch(leaseCompany, isSingleCompany)) return

      if (lease.dailyPayments && lease.dailyPayments.length > 0) {
        lease.dailyPayments.forEach((p) => {
          if (p.status === 'Missed' || (p.amount || 0) <= 0) return
          tenantTransactions.push({
            id: `tenant_pmt_${p.id}`,
            refNo: p.referenceNo || lease.tenantId,
            date: p.date,
            type: 'Income',
            company: leaseCompany,
            description: `Rental Collection - ${lease.tenantName} (${lease.unitName})`,
            particulars: `Rental Payment - ${lease.tenantName} (${lease.unitName})`,
            amount: p.amount,
            withdrawal: 0,
            deposit: p.amount,
            category: 'Rental Income',
            paymentMethod: p.method,
            status: 'Paid',
            auditStatus: (lease.auditStatus as any) || 'Verified',
            auditedBy: lease.auditedBy,
            auditNotes: lease.auditRemarks,
            auditDate: lease.auditDate,
            createdAt: p.timestamp || `${p.date}T00:00:00Z`,
            isMirrorRow: true,
            paidAmount: p.amount,
          })
        })
      } else if (lease.amountPaid > 0) {
        tenantTransactions.push({
          id: `tenant_lease_${lease.id}`,
          refNo: lease.tenantId,
          date: lease.contractDate,
          type: 'Income',
          company: leaseCompany,
          description: `Rental Collection - ${lease.tenantName} (${lease.unitName})`,
          particulars: `Rental Payment - ${lease.tenantName} (${lease.unitName})`,
          amount: lease.amountPaid,
          withdrawal: 0,
          deposit: lease.amountPaid,
          category: 'Rental Income',
          paymentMethod: 'Cash',
          status: 'Paid',
          auditStatus: (lease.auditStatus as any) || 'Verified',
          auditedBy: lease.auditedBy,
          auditNotes: lease.auditRemarks,
          auditDate: lease.auditDate,
          createdAt: `${lease.contractDate}T00:00:00Z`,
          isMirrorRow: true,
          paidAmount: lease.amountPaid,
        })
      }
    })

    let transactions: DashboardTransactionItem[] = [
      ...sales.map((s) => salesService.toDashboardTransaction(s)),
      ...expenses.map((e) => expenseService.toDashboardTransaction(e)),
      ...tenantTransactions,
    ]
    if (isSingleCompany) {
      transactions = transactions.filter((t) => isCompanyMatch(t.company, isSingleCompany))
    }

    // Latest first
    transactions.sort((a, b) => {
      const cmp = normalizeDateToYYYYMMDD(b.date).localeCompare(normalizeDateToYYYYMMDD(a.date))
      if (cmp !== 0) return cmp
      return (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
    })

    const result: DashboardData = { recentTransactions: transactions }
    dashboardCache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  },
}
