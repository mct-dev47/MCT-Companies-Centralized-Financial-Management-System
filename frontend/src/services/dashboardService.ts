import { normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import { salesService } from './salesService'
import { expenseService } from './expenseService'
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

    const [sales, expenses] = await Promise.all([
      salesService.getSales(isSingleCompany),
      expenseService.getExpenses({ company: isSingleCompany }),
    ])
    let transactions: DashboardTransactionItem[] = [
      ...sales.map((s) => salesService.toDashboardTransaction(s)),
      ...expenses.map((e) => expenseService.toDashboardTransaction(e)),
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
