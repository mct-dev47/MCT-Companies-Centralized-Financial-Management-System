// Petty cash wallet (one per company). Top-ups move sales cash into the wallet;
// expenses paid with "Petty Cash" are deducted from it. The balance is computed
// by the backend, so there is no local fallback: when the backend is unreachable
// the calls throw and callers show the wallet as unavailable.

import { websocketService } from './websocketService'
import { notifyNotificationsUpdated } from './notificationService'

export const PETTY_CASH_METHOD = 'Petty Cash'

export const isPettyCashMethod = (method?: string | null): boolean =>
  (method || '').trim().toLowerCase() === PETTY_CASH_METHOD.toLowerCase()

export interface PettyCashSummary {
  companyId: number
  companyName: string
  balance: number
  totalTopUps: number
  totalSpent: number
  periodTopUps: number
  periodSpent: number
  lowBalanceThreshold: number
  isLow: boolean
}

export interface PettyCashLedgerEntry {
  id: string
  type: 'topup' | 'expense' | 'request'
  requestType?: 'topup' | 'reimbursement' | string
  paidBy?: string | null
  receiptUrl?: string | null
  attachments?: string | null
  items?: string | null
  recordId: number
  companyId?: number | null
  companyName?: string | null
  date: string
  description: string
  category?: string | null
  referenceNo?: string | null
  amountRequested: number
  amountIn: number
  amountOut: number
  runningBalance: number
  status: string
  remark?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  endorsedBy?: string | null
  endorsedAt?: string | null
  financeRemark?: string | null
  createdAt?: string | null
  /** Funding bank chosen by Finance at endorsement (spec 0014). No account number is sent. */
  fundingBankId?: string | null
  fundingBankName?: string | null
  fundingAccountName?: string | null
  fundingCompanyName?: string | null
  /** The funding bank belongs to the requesting company itself. */
  isOwnAccount?: boolean
  auditStatus?: 'Verified' | 'Pending Audit' | 'Flagged'
  auditDate?: string | null
  auditedBy?: string | null
}

export interface NewPettyCashTopUpInput {
  company?: string
  company_name?: string
  amount: number
  date: string
  description?: string
  status?: string
  bank_account_id?: string | null
  finance_remark?: string | null
  endorsement_remark?: string | null
  request_type?: 'topup' | 'reimbursement' | string
  paid_by?: string | null
  receipt_url?: string | null
  attachments?: string | null
  items?: string | null
  category?: string | null
}

/**
 * A petty cash top-up as shown on the Transaction page ledger. Names both the
 * requesting company and the company that owns the funding bank, so the page can show a Deposit
 * for one and a Withdrawal for the other.
 */
export interface PettyCashMovement {
  topupId: number
  refNo: string
  /** ISO date, YYYY-MM-DD */
  date: string
  amount: number
  description: string
  status: string
  companyId: number
  companyName: string
  fundingCompanyId: number | null
  fundingCompanyName: string
  /** True when the funding bank belongs to the requesting company itself. */
  isOwnAccount: boolean
  createdAt: string | null
}

interface BackendMovement {
  topup_id: number
  reference_no?: string | null
  topup_date: string
  amount: string | number
  description?: string | null
  status: string
  company_id: number
  company_name?: string | null
  funding_company_id?: number | null
  funding_company_name?: string | null
  is_own_account?: boolean
  created_at?: string | null
}

export interface PettyCashPeriod {
  startDate?: string | null
  endDate?: string | null
}

interface BackendSummary {
  company_id: number
  company_name: string
  balance: string | number
  total_topups: string | number
  total_spent: string | number
  period_topups: string | number
  period_spent: string | number
  low_balance_threshold: string | number
  is_low: boolean
}

interface BackendLedgerEntry {
  entry_id: string
  entry_type: 'topup' | 'expense' | 'request'
  record_id: number
  company_id?: number | null
  company_name?: string | null
  entry_date: string
  description: string
  category?: string | null
  reference_no?: string | null
  amount_requested?: string | number
  amount_in: string | number
  amount_out: string | number
  running_balance: string | number
  status?: string | null
  remark?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  endorsed_by?: string | null
  endorsed_at?: string | null
  finance_remark?: string | null
  created_at?: string | null
  funding_bank_id?: string | null
  funding_bank_name?: string | null
  funding_account_name?: string | null
  funding_company_name?: string | null
  is_own_account?: boolean
  request_type?: string | null
  paid_by?: string | null
  receipt_url?: string | null
  attachments?: string | null
  items?: string | null
}

function backendHeaders(): HeadersInit {
  const token =
    typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
  const userStr =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('mct_session_user') || sessionStorage.getItem('mct_user')
      : null
  let userName = ''
  let userRole = ''
  if (userStr) {
    try {
      const u = JSON.parse(userStr)
      userName = u.fullName || u.email || ''
      userRole = u.role || ''
    } catch {
      // ignore
    }
  }

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userName ? { 'X-User-Name': userName } : {}),
    ...(userRole ? { 'X-User-Role': userRole } : {}),
  }
}

async function getBackendError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}))
  return new Error(
    typeof body.detail === 'string' ? body.detail : `Petty cash request failed (${response.status}).`
  )
}

function mapSummary(data: BackendSummary): PettyCashSummary {
  return {
    companyId: data.company_id,
    companyName: data.company_name,
    balance: Number(data.balance),
    totalTopUps: Number(data.total_topups),
    totalSpent: Number(data.total_spent),
    periodTopUps: Number(data.period_topups),
    periodSpent: Number(data.period_spent),
    lowBalanceThreshold: Number(data.low_balance_threshold),
    isLow: data.is_low,
  }
}

function mapLedgerEntry(data: BackendLedgerEntry): PettyCashLedgerEntry {
  return {
    id: data.entry_id,
    type: data.entry_type,
    recordId: data.record_id,
    companyId: data.company_id,
    companyName: data.company_name,
    date: data.entry_date,
    description: data.description,
    category: data.category,
    referenceNo: data.reference_no,
    amountRequested: Number(data.amount_requested || (data.entry_type === 'topup' ? data.amount_in : 0)),
    amountIn: Number(data.amount_in),
    amountOut: Number(data.amount_out),
    runningBalance: Number(data.running_balance),
    status: (data.status as any) || 'Approved',
    remark: data.remark,
    reviewedBy: data.reviewed_by,
    reviewedAt: data.reviewed_at,
    endorsedBy: data.endorsed_by,
    endorsedAt: data.endorsed_at,
    financeRemark: data.finance_remark,
    createdAt: data.created_at,
    fundingBankId: data.funding_bank_id,
    fundingBankName: data.funding_bank_name,
    fundingAccountName: data.funding_account_name,
    fundingCompanyName: data.funding_company_name,
    isOwnAccount: Boolean(data.is_own_account),
    requestType: data.request_type || (data.entry_type === 'topup' ? 'topup' : 'topup'),
    paidBy: data.paid_by,
    receiptUrl: data.receipt_url,
    attachments: data.attachments,
    items: data.items,
  }
}

function buildQuery(params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  const str = query.toString()
  return str ? `?${str}` : ''
}

const pcCache = new Map<string, { data: any; timestamp: number }>()
const PC_CACHE_TTL = 30000

export const pettyCashService = {
  invalidateCache(): void {
    pcCache.clear()
    notifyNotificationsUpdated()
  },

  async getSummary(company: string, period: PettyCashPeriod = {}): Promise<PettyCashSummary> {
    const cacheKey = `summary:${company}:${period.startDate || ''}:${period.endDate || ''}`
    const cached = pcCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < PC_CACHE_TTL) {
      return cached.data
    }

    const query = buildQuery({
      company_name: company,
      start_date: period.startDate,
      end_date: period.endDate,
    })
    const response = await fetch(`/api/v1/petty-cash/summary${query}`, { headers: backendHeaders() })
    if (!response.ok) throw await getBackendError(response)
    const result = mapSummary(await response.json())
    pcCache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  },

  /** One summary per company with petty cash activity (used for "All Companies"). */
  async getAllSummaries(period: PettyCashPeriod = {}): Promise<PettyCashSummary[]> {
    const cacheKey = `all_summaries:${period.startDate || ''}:${period.endDate || ''}`
    const cached = pcCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < PC_CACHE_TTL) {
      return cached.data
    }

    const query = buildQuery({ start_date: period.startDate, end_date: period.endDate })
    const response = await fetch(`/api/v1/petty-cash/summaries${query}`, { headers: backendHeaders() })
    if (!response.ok) throw await getBackendError(response)
    const result = ((await response.json()) as BackendSummary[]).map(mapSummary)
    pcCache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  },

  async getLedger(company?: string, period: PettyCashPeriod = {}): Promise<PettyCashLedgerEntry[]> {
    const query = buildQuery({
      company_name: company && company !== 'All Companies' ? company : undefined,
      start_date: period.startDate,
      end_date: period.endDate,
    })
    const response = await fetch(`/api/v1/petty-cash/ledger${query}`, { headers: backendHeaders() })
    if (!response.ok) throw await getBackendError(response)
    return ((await response.json()) as BackendLedgerEntry[]).map(mapLedgerEntry)
  },

  /**
   * Top-ups for the Transaction ledger (spec 0013): endorsed or approved, with a funding bank.
   * When a company is given, returns top-ups where it is the requesting or the funding company.
   */
  async getMovements(company?: string): Promise<PettyCashMovement[]> {
    const query = buildQuery({
      company_name: company && company !== 'All Companies' ? company : undefined,
    })
    const response = await fetch(`/api/v1/petty-cash/movements${query}`, { headers: backendHeaders() })
    if (!response.ok) throw await getBackendError(response)
    return ((await response.json()) as BackendMovement[]).map((m) => ({
      topupId: m.topup_id,
      refNo: m.reference_no || `PC-${m.topup_id}`,
      date: m.topup_date,
      amount: Number(m.amount),
      description: m.description || 'Petty cash top-up',
      status: m.status,
      companyId: m.company_id,
      companyName: m.company_name || `Company #${m.company_id}`,
      fundingCompanyId: m.funding_company_id ?? null,
      fundingCompanyName: m.funding_company_name || 'Funding bank',
      isOwnAccount: Boolean(m.is_own_account),
      createdAt: m.created_at ?? null,
    }))
  },

  async createTopUp(input: NewPettyCashTopUpInput): Promise<void> {
    const comp = input.company || input.company_name || ''
    const response = await fetch('/api/v1/petty-cash/topups', {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify({
        company: comp,
        company_name: comp,
        amount: input.amount,
        topup_date: input.date,
        description: input.description || null,
        status: input.status || 'Pending Finance Endorsement',
        bank_account_id: input.bank_account_id || null,
        finance_remark: input.finance_remark || input.endorsement_remark || null,
        request_type: input.request_type || 'topup',
        paid_by: input.paid_by || null,
        receipt_url: input.receipt_url || null,
        attachments: input.attachments || null,
        items: input.items || null,
        category: input.category || null,
      }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async updateTopUp(recordId: number, input: { amount?: number; description?: string }): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}`, {
      method: 'PUT',
      headers: backendHeaders(),
      body: JSON.stringify({
        amount: input.amount,
        description: input.description || null,
      }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async endorseTopUp(
    recordId: number,
    action: 'endorse' | 'reject',
    remark: string,
    bankAccountId?: string | null,
  ): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/endorse`, {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify({
        action,
        remark,
        ...(bankAccountId ? { bank_account_id: bankAccountId } : {}),
      }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async reviewTopUp(recordId: number, action: 'approve' | 'disapprove', remark: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/review`, {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify({ action, remark }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async deleteTopUp(topUpId: number): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${topUpId}`, {
      method: 'DELETE',
      headers: backendHeaders(),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async updateThreshold(company: string, threshold: number): Promise<PettyCashSummary> {
    const response = await fetch(`/api/v1/petty-cash/wallet${buildQuery({ company_name: company })}`, {
      method: 'PUT',
      headers: backendHeaders(),
      body: JSON.stringify({ low_balance_threshold: threshold }),
    })
    if (!response.ok) throw await getBackendError(response)
    return mapSummary(await response.json())
  },

  async uploadReceipt(file: File): Promise<{ url: string; filename: string; file_name?: string; file_size?: number; mime_type?: string }> {
    const formData = new FormData()
    formData.append('file', file)
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
    const response = await fetch('/api/v1/petty-cash/receipts', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    })
    if (!response.ok) throw await getBackendError(response)
    return await response.json()
  },
}
