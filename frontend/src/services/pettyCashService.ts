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

export interface PettyCashCategory {
  category_id: number
  company_id: number
  name: string
  created_at?: string
}

export interface PettyCashLedgerEntry {
  id: string
  type: 'topup' | 'expense' | 'request'
  requestType?: 'topup' | 'reimbursement' | 'replenishment_disbursement' | string
  paidBy?: string | null
  receiptUrl?: string | null
  attachments?: string | null
  hasReceipt?: boolean
  attachmentCount?: number
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
  totalExpenses?: number | null
  companyFundedAmount?: number | null
  employeeOutOfPocket?: number | null
  existingExpenseId?: number | null
  paymentMethodOption?: 'direct' | 'transfer_first' | null
  destinationBankId?: string | null
  destinationBankName?: string | null
  intercompanyTransferId?: number | null
  transferStatus?: string | null
  settlementStatus?: string | null
  reimbursedAt?: string | null
  reimbursedBy?: string | null
  transferReceivedAt?: string | null
  transferReceivedBy?: string | null
}

export interface NewPettyCashTopUpInput {
  company?: string
  company_name?: string
  amount: number
  date: string
  description?: string
  status?: string
  bank_account_id?: string | null
  payment_method_option?: 'direct' | 'transfer_first' | null
  destination_bank_id?: string | null
  finance_remark?: string | null
  endorsement_remark?: string | null
  request_type?: 'topup' | 'reimbursement' | string
  paid_by?: string | null
  receipt_url?: string | null
  attachments?: string | null
  has_receipt?: boolean
  attachment_count?: number
  items?: string | null
  category?: string | null
  total_expenses?: number | null
  company_funded_amount?: number | null
  employee_out_of_pocket?: number | null
  existing_expense_id?: number | null
}

export interface IntercompanyTransfer {
  transferId: number
  sourceCompanyId: number
  destinationCompanyId: number
  sourceBankId: string
  destinationBankId?: string | null
  sourceBankTxId?: string | null
  destinationBankTxId?: string | null
  reversalBankTxId?: string | null
  repaymentSourceBankTxId?: string | null
  repaymentDestinationBankTxId?: string | null
  linkedTopupId?: number | null
  amount: number
  transferType: string
  referenceNo: string
  transferStatus: string
  settlementStatus: string
  initiatedBy: string
  initiatedAt: string
  receivedBy?: string | null
  receivedAt?: string | null
  settledAt?: string | null
  repaidBy?: string | null
  notes?: string | null
  sourceCompanyName?: string | null
  destinationCompanyName?: string | null
  sourceBankName?: string | null
  destinationBankName?: string | null
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
  fundingBankId?: string | null
  fundingBankName?: string | null
  /** True when the funding bank belongs to the requesting company itself. */
  isOwnAccount: boolean
  createdAt: string | null
  requestType?: string | null
  paidBy?: string | null
  category?: string | null
  totalExpenses?: number | null
  companyFundedAmount?: number | null
  employeeOutOfPocket?: number | null
  amountReimbursed?: number | null
  endorsedBy?: string | null
  endorsedAt?: string | null
  financeRemark?: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
  remark?: string | null
  createdBy?: number | null
  createdByName?: string | null
  reimbursedBy?: string | null
  reimbursedAt?: string | null
  transferReceivedBy?: string | null
  transferReceivedAt?: string | null
  items?: string | null
  attachments?: string | null
  receiptUrl?: string | null
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
  funding_bank_id?: string | null
  funding_bank_name?: string | null
  is_own_account?: boolean
  created_at?: string | null
  request_type?: string | null
  paid_by?: string | null
  category?: string | null
  total_expenses?: string | number | null
  company_funded_amount?: string | number | null
  employee_out_of_pocket?: string | number | null
  amount_reimbursed?: string | number | null
  endorsed_by?: string | null
  endorsed_at?: string | null
  finance_remark?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  remark?: string | null
  created_by?: number | null
  created_by_name?: string | null
  reimbursed_by?: string | null
  reimbursed_at?: string | null
  transfer_received_by?: string | null
  transfer_received_at?: string | null
  items?: string | null
  attachments?: string | null
  receipt_url?: string | null
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
  has_receipt?: boolean
  attachment_count?: number
  items?: string | null
  total_expenses?: string | number | null
  company_funded_amount?: string | number | null
  employee_out_of_pocket?: string | number | null
  existing_expense_id?: number | null
  payment_method_option?: string | null
  destination_bank_id?: string | null
  destination_bank_name?: string | null
  intercompany_transfer_id?: number | null
  transfer_status?: string | null
  settlement_status?: string | null
  reimbursed_at?: string | null
  reimbursed_by?: string | null
  transfer_received_at?: string | null
  transfer_received_by?: string | null
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
    hasReceipt: Boolean(data.has_receipt ?? (data.receipt_url || data.attachments)),
    attachmentCount: Number(data.attachment_count ?? 0),
    items: data.items,
    totalExpenses: data.total_expenses != null ? Number(data.total_expenses) : null,
    companyFundedAmount: data.company_funded_amount != null ? Number(data.company_funded_amount) : 0,
    employeeOutOfPocket: data.employee_out_of_pocket != null ? Number(data.employee_out_of_pocket) : 0,
    existingExpenseId: data.existing_expense_id ?? null,
    paymentMethodOption: (data.payment_method_option as any) ?? null,
    destinationBankId: data.destination_bank_id ?? null,
    destinationBankName: data.destination_bank_name ?? null,
    intercompanyTransferId: data.intercompany_transfer_id ?? null,
    transferStatus: data.transfer_status ?? null,
    settlementStatus: data.settlement_status ?? null,
    reimbursedAt: data.reimbursed_at ?? null,
    reimbursedBy: data.reimbursed_by ?? null,
    transferReceivedAt: data.transfer_received_at ?? null,
    transferReceivedBy: data.transfer_received_by ?? null,
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

export interface PettyCashTopUpReceipts {
  topupId: number
  receiptUrl: string | null
  attachments: string | null
}

export interface EligibleExpense {
  expenseId: number
  companyId: number
  expenseDate: string
  particulars: string
  category: string | null
  amount: number
  referenceNo: string | null
}

const pcCache = new Map<string, { data: any; timestamp: number }>()
const receiptCache = new Map<number, PettyCashTopUpReceipts>()
const PC_CACHE_TTL = 30000

export const pettyCashService = {
  invalidateCache(): void {
    pcCache.clear()
    receiptCache.clear()
    notifyNotificationsUpdated()
  },

  async getTopUpReceipts(
    topupId: number,
    options?: { forceRefresh?: boolean }
  ): Promise<PettyCashTopUpReceipts> {
    if (!options?.forceRefresh) {
      const cached = receiptCache.get(topupId)
      if (cached) return cached
    }
    const response = await fetch(`/api/v1/petty-cash/topups/${topupId}/receipts`, {
      headers: backendHeaders(),
    })
    if (!response.ok) throw await getBackendError(response)
    const data = await response.json()
    const mapped: PettyCashTopUpReceipts = {
      topupId: data.topup_id,
      receiptUrl: data.receipt_url ?? null,
      attachments: data.attachments ?? null,
    }
    receiptCache.set(topupId, mapped)
    return mapped
  },

  async getEligibleExpenses(
    company: string,
    q?: string,
    limit = 50
  ): Promise<EligibleExpense[]> {
    const query = buildQuery({
      company_name: company,
      q: q?.trim() || undefined,
      limit: String(limit),
    })
    const response = await fetch(`/api/v1/petty-cash/eligible-expenses${query}`, {
      headers: backendHeaders(),
    })
    if (!response.ok) throw await getBackendError(response)
    const rows = (await response.json()) as Array<{
      expense_id: number
      company_id: number
      expense_date: string
      particulars: string
      category?: string | null
      amount: string | number
      reference_no?: string | null
    }>
    return rows.map((row) => ({
      expenseId: row.expense_id,
      companyId: row.company_id,
      expenseDate: row.expense_date,
      particulars: row.particulars || '',
      category: row.category ?? null,
      amount: Number(row.amount || 0),
      referenceNo: row.reference_no ?? null,
    }))
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

  async getCompanyCategories(companyName?: string): Promise<PettyCashCategory[]> {
    const query = buildQuery({ company_name: companyName && companyName !== 'All Companies' ? companyName : undefined })
    const response = await fetch(`/api/v1/petty-cash/categories${query}`, { headers: backendHeaders() })
    if (!response.ok) throw await getBackendError(response)
    return (await response.json()) as PettyCashCategory[]
  },

  async createCompanyCategory(companyName: string, name: string): Promise<PettyCashCategory> {
    const response = await fetch('/api/v1/petty-cash/categories', {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify({ company_name: companyName, name }),
    })
    if (!response.ok) throw await getBackendError(response)
    return (await response.json()) as PettyCashCategory
  },

  async deleteCompanyCategory(categoryId: number): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/categories/${categoryId}`, {
      method: 'DELETE',
      headers: backendHeaders(),
    })
    if (!response.ok) throw await getBackendError(response)
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
      fundingBankId: m.funding_bank_id ?? null,
      fundingBankName: m.funding_bank_name ?? null,
      isOwnAccount: Boolean(m.is_own_account),
      createdAt: m.created_at ?? null,
      requestType: m.request_type || 'topup',
      paidBy: m.paid_by ?? null,
      category: m.category ?? null,
      totalExpenses: m.total_expenses != null ? Number(m.total_expenses) : null,
      companyFundedAmount: m.company_funded_amount != null ? Number(m.company_funded_amount) : 0,
      employeeOutOfPocket: m.employee_out_of_pocket != null ? Number(m.employee_out_of_pocket) : 0,
      amountReimbursed: m.amount_reimbursed != null ? Number(m.amount_reimbursed) : null,
      endorsedBy: m.endorsed_by ?? null,
      endorsedAt: m.endorsed_at ?? null,
      financeRemark: m.finance_remark ?? null,
      reviewedBy: m.reviewed_by ?? null,
      reviewedAt: m.reviewed_at ?? null,
      remark: m.remark ?? null,
      createdBy: m.created_by ?? null,
      createdByName: m.created_by_name ?? null,
      reimbursedBy: m.reimbursed_by ?? null,
      reimbursedAt: m.reimbursed_at ?? null,
      transferReceivedBy: m.transfer_received_by ?? null,
      transferReceivedAt: m.transfer_received_at ?? null,
      items: m.items ?? null,
      attachments: m.attachments ?? null,
      receiptUrl: m.receipt_url ?? null,
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
        payment_method_option: input.payment_method_option || null,
        destination_bank_id: input.destination_bank_id || null,
        finance_remark: input.finance_remark || input.endorsement_remark || null,
        request_type: input.request_type || 'topup',
        paid_by: input.paid_by || null,
        receipt_url: input.receipt_url || null,
        attachments: input.attachments || null,
        items: input.items || null,
        category: input.category || null,
        total_expenses: input.total_expenses ?? null,
        company_funded_amount: input.company_funded_amount ?? null,
        employee_out_of_pocket: input.employee_out_of_pocket ?? null,
        existing_expense_id: input.existing_expense_id ?? null,
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
    paymentMethodOption?: 'direct' | 'transfer_first' | null,
    destinationBankId?: string | null,
  ): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/endorse`, {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify({
        action,
        remark,
        ...(bankAccountId ? { bank_account_id: bankAccountId } : {}),
        ...(paymentMethodOption ? { payment_method_option: paymentMethodOption } : {}),
        ...(destinationBankId ? { destination_bank_id: destinationBankId } : {}),
      }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async finalizeSettlement(recordId: number, notes?: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/finalize-settlement`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `finalize-${recordId}-${Date.now()}`,
      },
      body: JSON.stringify({ notes: notes || null }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async reimburse(recordId: number, notes?: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/reimburse`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `reimb-${recordId}-${Date.now()}`,
      },
      body: JSON.stringify({ notes: notes || null }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async initiateTransfer(recordId: number, notes?: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/transfer`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `transfer-${recordId}-${Date.now()}`,
      },
      body: JSON.stringify({ notes: notes || null }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async confirmTransfer(recordId: number, notes?: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/confirm-transfer`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `confirm-${recordId}-${Date.now()}`,
      },
      body: JSON.stringify({ notes: notes || null }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async cancelTransfer(recordId: number, reason: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/cancel-transfer`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `cancel-${recordId}-${Date.now()}`,
      },
      body: JSON.stringify({ reason }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async confirmReversal(recordId: number, verificationNotes?: string): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/topups/${recordId}/confirm-reversal`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `reversal-${recordId}-${Date.now()}`,
      },
      body: JSON.stringify({ verification_notes: verificationNotes || null }),
    })
    if (!response.ok) throw await getBackendError(response)
    this.invalidateCache()
    websocketService.emitLocal('PETTY_CASH_UPDATED')
  },

  async getIntercompanyTransfers(companyId?: number, settlementStatus?: string): Promise<IntercompanyTransfer[]> {
    const query = buildQuery({
      company_id: companyId ? String(companyId) : null,
      settlement_status: settlementStatus || null,
    })
    const response = await fetch(`/api/v1/petty-cash/intercompany-transfers${query}`, {
      headers: backendHeaders(),
    })
    if (!response.ok) throw await getBackendError(response)
    const raw = await response.json()
    return (raw || []).map((t: any) => ({
      transferId: t.transfer_id,
      sourceCompanyId: t.source_company_id,
      destinationCompanyId: t.destination_company_id,
      sourceBankId: t.source_bank_id,
      destinationBankId: t.destination_bank_id,
      sourceBankTxId: t.source_bank_tx_id,
      destinationBankTxId: t.destination_bank_tx_id,
      reversalBankTxId: t.reversal_bank_tx_id,
      repaymentSourceBankTxId: t.repayment_source_bank_tx_id,
      repaymentDestinationBankTxId: t.repayment_destination_bank_tx_id,
      linkedTopupId: t.linked_topup_id,
      amount: Number(t.amount || 0),
      transferType: t.transfer_type,
      referenceNo: t.reference_no,
      transferStatus: t.transfer_status,
      settlementStatus: t.settlement_status,
      initiatedBy: t.initiated_by,
      initiatedAt: t.initiated_at,
      receivedBy: t.received_by,
      receivedAt: t.received_at,
      settledAt: t.settled_at,
      repaidBy: t.repaid_by,
      notes: t.notes,
      sourceCompanyName: t.source_company_name,
      destinationCompanyName: t.destination_company_name,
      sourceBankName: t.source_bank_name,
      destinationBankName: t.destination_bank_name,
    }))
  },

  async settleIntercompanyTransfer(
    transferId: number,
    input: { source_bank_id: string; destination_bank_id: string; notes?: string }
  ): Promise<void> {
    const response = await fetch(`/api/v1/petty-cash/intercompany-transfers/${transferId}/settle`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Idempotency-Key': `settle-${transferId}-${Date.now()}`,
      },
      body: JSON.stringify(input),
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
