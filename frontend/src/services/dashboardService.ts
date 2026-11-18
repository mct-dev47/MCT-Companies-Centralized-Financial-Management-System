import { normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
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
  date: string
  type: 'Expense' | 'Sales' | 'Loan' | 'Income' | 'Petty Cash' | 'Bank'
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
  isMirrorRow?: boolean
  awaitingAudit?: boolean
  pendingLabel?: string
  paidAmount?: number
  bankAccountId?: string
  bankName?: string
  remarks?: string
  financeRemark?: string
  endorsedBy?: string
  endorsedAt?: string
  supervisorRemark?: string
  reviewedBy?: string
  reviewedAt?: string
  auditRemark?: string
  /** 'Tenants' | 'Lending' when that page created this record; it is read-only everywhere else. */
  sourceModule?: string
  depositStatus?: 'Deposited' | 'Not Deposited'
  deposit_status?: 'Deposited' | 'Not Deposited'
  deposit_date?: string | null
  depositDate?: string | null
  saleDate?: string
  sourceExpenseId?: number
  sourceSaleId?: number
}

export interface DashboardMetricSummary {
  total_cash: number
  total_expense: number
  net_income: number
  overdue_count: number
  due_soon_count: number
  petty_cash_balance: number
}

export interface MonthlyProfitLossItem {
  key: string
  label: string
  short_label: string
  income: number
  expenses: number
  profit: number
}

export interface CategoryBreakdownItem {
  category: string
  amount: number
  percentage: number
  color?: string
}

export interface DashboardSummaryData {
  company_name: string
  company_id?: number | null
  metrics: DashboardMetricSummary
  monthly_pnl: MonthlyProfitLossItem[]
  income_categories: CategoryBreakdownItem[]
  expense_categories: CategoryBreakdownItem[]
  recent_transactions: DashboardTransactionItem[]
}

export interface DashboardData {
  recentTransactions: DashboardTransactionItem[]
}

const summaryCache = new Map<string, { data: DashboardSummaryData; timestamp: number }>()
const SUMMARY_CACHE_TTL = 60000 // 60s cache to protect Supabase free-tier and prevent spam

export const dashboardService = {
  invalidateCache(): void {
    summaryCache.clear()
  },

  async getDashboardSummary(params?: {
    company?: string
    startDate?: string | null
    endDate?: string | null
    forceRefresh?: boolean
  }): Promise<DashboardSummaryData> {
    const comp = params?.company && params.company !== 'All Companies' ? params.company : undefined
    const sDate = params?.startDate || ''
    const eDate = params?.endDate || ''
    const cacheKey = `${comp || 'default'}_${sDate}_${eDate}`

    if (!params?.forceRefresh) {
      const cached = summaryCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < SUMMARY_CACHE_TTL) {
        return cached.data
      }
    }

    const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
    const query = new URLSearchParams()
    if (comp) query.set('company_name', comp)
    if (params?.startDate) query.set('start_date', params.startDate)
    if (params?.endDate) query.set('end_date', params.endDate)

    const res = await fetch(`/api/v1/dashboard/summary?${query.toString()}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

    if (!res.ok) {
      throw new Error(`Failed to load dashboard summary (HTTP ${res.status})`)
    }

    const raw = await res.json()
    const mappedTransactions: DashboardTransactionItem[] = (raw.recent_transactions || []).map((t: any) => ({
      id: t.id,
      refNo: t.ref_no || '',
      chequeNo: t.cheque_no || undefined,
      date: t.date || '',
      type: t.type || 'Sales',
      company: t.company || '',
      description: t.description || '',
      particulars: t.description || '',
      amount: Number(t.amount || 0),
      withdrawal: Number(t.withdrawal || 0),
      deposit: Number(t.deposit || 0),
      category: t.category || 'Uncategorized',
      paymentMethod: t.payment_method || undefined,
      status: t.status || 'Paid',
      auditStatus: t.audit_status || 'Pending Audit',
      createdAt: t.created_at || undefined,
    }))

    const result: DashboardSummaryData = {
      company_name: raw.company_name || comp || 'Company Dashboard',
      company_id: raw.company_id,
      metrics: {
        total_cash: Number(raw.metrics?.total_cash || 0),
        total_expense: Number(raw.metrics?.total_expense || 0),
        net_income: Number(raw.metrics?.net_income || 0),
        overdue_count: Number(raw.metrics?.overdue_count || 0),
        due_soon_count: Number(raw.metrics?.due_soon_count || 0),
        petty_cash_balance: Number(raw.metrics?.petty_cash_balance || 0),
      },
      monthly_pnl: (raw.monthly_pnl || []).map((p: any) => ({
        key: p.key,
        label: p.label,
        short_label: p.short_label,
        income: Number(p.income || 0),
        expenses: Number(p.expenses || 0),
        profit: Number(p.profit || 0),
      })),
      income_categories: (raw.income_categories || []).map((c: any) => ({
        category: c.category,
        amount: Number(c.amount || 0),
        percentage: Number(c.percentage || 0),
        color: c.color,
      })),
      expense_categories: (raw.expense_categories || []).map((c: any) => ({
        category: c.category,
        amount: Number(c.amount || 0),
        percentage: Number(c.percentage || 0),
        color: c.color,
      })),
      recent_transactions: mappedTransactions,
    }

    summaryCache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  },

  /** Legacy helper retained for backwards compatibility */
  async getDashboardData(filters?: { company?: string; companies?: string[] }): Promise<DashboardData> {
    const summary = await this.getDashboardSummary({ company: filters?.company })
    return { recentTransactions: summary.recent_transactions }
  },
}
