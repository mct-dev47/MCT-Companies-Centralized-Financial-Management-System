import type { DashboardTransactionItem } from './dashboardService'
import { HttpError, NetworkError } from '@/lib/requestErrors'
import type { DailyGroupSummary } from '@/utils/dailyGroupUtils'
import { formatCreatedAt } from '@/utils/dateUtils'
import { removeLegacyAuditStorage, saveAuditReview } from './auditReviewApi'
import {
  type ParticularItem,
  parseParticulars,
  deriveRecordStatusFromParticulars,
} from '@/utils/particularsUtils'

export class ExpenseValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExpenseValidationError'
  }
}

export interface ExpenseRepaymentRecord {
  id: string
  paymentDate: string
  amount: number
  remainingBalance: number
  referenceNo?: string
  paymentMethod?: string
  notes?: string
  createdAt?: string
}

export interface ExpenseItem {
  id: string
  refNo: string
  chequeNo?: string
  date: string // e.g. "10/01/26"
  rawDate: string // e.g. "2026-10-01"
  particulars: string
  withdrawal: number
  netAmount: number
  category: string
  paymentMethod?: string // e.g. Petty Cash, Cash, GCash, etc.
  company: string
  items?: ParticularItem[]
  totalPaid?: number
  outstandingBalance?: number
  repayments?: ExpenseRepaymentRecord[]
  status: 'Paid' | 'Pending' | 'Overdue' | 'Partially Paid' | 'On hold' | 'Unpaid'
  auditStatus: 'Verified' | 'Pending Audit' | 'Flagged'
  auditedBy?: string
  auditNotes?: string
  auditDate?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
  type: 'Expense'
  bankAccountId?: string
  bankName?: string
  remarks?: string
}

export interface DailyExpenseSummaryOut {
  date: string
  day_of_week: string
  transaction_count: number
  gross_total: number | string
  realized_cash: number | string
  audit_status: string
}

export interface NewExpenseInput {
  date: string
  chequeNo?: string
  particulars: string
  amount: number
  category: string
  paymentMethod?: string
  company: string
  status: 'Paid' | 'Pending' | 'On hold' | 'Unpaid'
  items?: ParticularItem[]
  bankAccountId?: string
  remarks?: string
  createdBy?: string
  updatedBy?: string
  updatedAt?: string
  /** Unique ID for this new record; resending it returns the existing record (spec 0038). */
  clientRef?: string
}

const EXPENSES_STORAGE_KEY = 'mct_expense_records_v1'
removeLegacyAuditStorage()

// Clear legacy local storage to prevent clear-text storage
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(EXPENSES_STORAGE_KEY)
  } catch {
    // ignore
  }
}

let inMemoryExpenses: ExpenseItem[] = []

function saveStoredExpenses(items: ExpenseItem[]): void {
  inMemoryExpenses = items
}

function mapBackendExpenseToItem(exp: any): ExpenseItem {
  const rawDateStr = exp.expense_date || '2026-10-01'
  let displayDate = '10/01/26'
  if (rawDateStr) {
    const parts = rawDateStr.split('-')
    if (parts.length === 3) {
      displayDate = `${parts[1]}/${parts[2]}/${parts[0].slice(2)}`
    }
  }

  const amt = Number(exp.amount || exp.withdrawal || 0)
  const isPending =
    (exp.unpaid_balance !== undefined && Number(exp.unpaid_balance) > 0) ||
    exp.status === 'Pending'
  const fallbackStatus: 'Paid' | 'Pending' | 'Unpaid' = isPending
    ? 'Pending'
    : exp.status === 'Unpaid'
      ? 'Unpaid'
      : 'Paid'
  const partText = exp.particulars || exp.description || 'Expense Outflow'
  const parsedItems = parseParticulars(partText, null, amt)
  const derivedStatus = deriveRecordStatusFromParticulars(parsedItems, fallbackStatus)

  const expId = `exp_${exp.expense_id || exp.id}`
  const resolvedAuditStatus: 'Verified' | 'Pending Audit' | 'Flagged' =
    exp.audit_status === 'Verified' || exp.audit_status === 'Flagged' ? exp.audit_status : 'Pending Audit'

  return {
    id: expId,
    refNo: exp.reference_no || exp.ref_no || `REF-${exp.expense_id || '001'}`,
    chequeNo: exp.cheque_no || exp.cheque_number || '',
    date: displayDate,
    rawDate: rawDateStr,
    particulars: partText,
    withdrawal: amt,
    netAmount: amt,
    category: exp.category_name || exp.category || 'Petty Cash',
    paymentMethod: exp.payment_method || undefined,
    company: exp.company_name || exp.company || 'MCT Kitchen',
    items: parsedItems,
    status: derivedStatus,
    auditStatus: resolvedAuditStatus,
    auditedBy: exp.audited_by || undefined,
    auditDate: exp.audited_at ? formatCreatedAt(exp.audited_at) : undefined,
    auditNotes: exp.audit_remarks || undefined,
    type: 'Expense',
    bankAccountId: exp.bank_account_id || exp.bankAccountId || undefined,
    bankName: exp.bank_name || exp.bankName || undefined,
    remarks: exp.remarks || undefined,
    createdBy: exp.created_by ? String(exp.created_by) : (exp.created_by_name || 'Finance Staff'),
    createdAt: exp.created_at || new Date().toISOString(),
    updatedAt: exp.updated_at || undefined,
    updatedBy: exp.updated_by || exp.updated_by_name || undefined,
  }
}

const expenseCache = new Map<string, { data: ExpenseItem[]; timestamp: number }>()
const EXPENSE_CACHE_TTL = 30000

/** Shown when the backend can't be reached: nothing was saved, so the user must not be told it was. */
const SERVER_UNREACHABLE =
  "Can't reach the server, so nothing was saved. Check that the backend is running, then try again."

export const expenseService = {
  invalidateCache(): void {
    expenseCache.clear()
  },

  async getDailySummary(params?: {
    company?: string
    startDate?: string
    endDate?: string
    viewType?: string
    search?: string
  }): Promise<DailyExpenseSummaryOut[]> {
    try {
      const query = new URLSearchParams()
      if (params?.company && params.company !== 'All Companies') {
        query.append('company_name', params.company)
      }
      if (params?.startDate) query.append('start_date', params.startDate)
      if (params?.endDate) query.append('end_date', params.endDate)
      if (params?.viewType) query.append('view_type', params.viewType)
      if (params?.search) query.append('search', params.search)

      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/expenses/daily-summary?${query.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('Failed to fetch expenses daily summary:', err)
    }
    return []
  },

  async getCategories(): Promise<{ category_id: number; name: string }[]> {
    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch('/api/v1/categories', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          return data
        }
      }
    } catch (err) {
      console.warn('Failed to fetch categories from backend:', err)
    }
    return [
      { category_id: 1, name: 'Petty Cash' },
      { category_id: 2, name: 'Rendered Fee' },
      { category_id: 3, name: 'BBMP Foundation' },
      { category_id: 4, name: 'HDMF' },
      { category_id: 5, name: 'Philhealth' },
      { category_id: 6, name: 'Electricity' },
      { category_id: 7, name: 'BIR' },
      { category_id: 8, name: 'Payroll' },
      { category_id: 9, name: 'SSS' },
      { category_id: 10, name: 'Hotel Supplies' },
      { category_id: 11, name: 'Revolving Funds' },
    ]
  },

  async createCategory(
    name: string,
    description?: string
  ): Promise<{ category_id: number; name: string }> {
    const cleaned = name.trim()
    if (!cleaned) throw new Error('Category name cannot be empty')
    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch('/api/v1/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: cleaned, description }),
      })
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('Failed to save category to backend:', err)
    }
    return { category_id: Date.now(), name: cleaned }
  },

  async getExpenses(params?: {
    company?: string
    start_date?: string
    end_date?: string
    category_id?: number
  }): Promise<ExpenseItem[]> {
    const cacheKey = JSON.stringify(params || {})
    const cached = expenseCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < EXPENSE_CACHE_TTL) {
      return cached.data
    }

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const query = new URLSearchParams()
      if (params?.company && params.company !== 'All Companies') {
        query.append('company_name', params.company)
      }
      if (params?.start_date) query.append('start_date', params.start_date)
      if (params?.end_date) query.append('end_date', params.end_date)
      if (params?.category_id) query.append('category_id', String(params.category_id))

      const url = `/api/v1/expenses${query.toString() ? `?${query.toString()}` : ''}`
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          const mapped = data.map(mapBackendExpenseToItem)
          expenseCache.set(cacheKey, { data: mapped, timestamp: Date.now() })
          if (!params?.company || params.company === 'All Companies') {
            inMemoryExpenses = mapped
            saveStoredExpenses(mapped)
            return mapped
          } else {
            const otherCompaniesExpenses = inMemoryExpenses.filter(
              (e) => e.company.toLowerCase() !== params.company!.toLowerCase()
            )
            inMemoryExpenses = [...mapped, ...otherCompaniesExpenses]
            saveStoredExpenses(inMemoryExpenses)
            return mapped
          }
        }
      }
    } catch (err) {
      console.warn('Backend GET /expenses failed, falling back to local storage:', err)
    }

    const list =
      !params?.company || params.company === 'All Companies'
        ? [...inMemoryExpenses]
        : inMemoryExpenses.filter(
            (e) => e.company.toLowerCase() === params.company!.toLowerCase()
          )
    return list
  },

  async addExpense(input: NewExpenseInput): Promise<ExpenseItem> {
    this.invalidateCache()
    let rawDate = input.date
    if (rawDate && rawDate.includes('/')) {
      const p = rawDate.split('/')
      if (p.length === 3) {
        const m = p[0].padStart(2, '0')
        const d = p[1].padStart(2, '0')
        const y = p[2].length === 2 ? `20${p[2]}` : p[2]
        rawDate = `${y}-${m}-${d}`
      }
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000)
    const refNo = `REF-${rawDate.replace(/-/g, '')}-${randomSuffix}`
    const cleanAmount = Math.round(Number(input.amount || 0) * 100) / 100

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const payload = {
        company: input.company,
        expense_date: rawDate,
        particulars: input.particulars,
        description: input.particulars,
        amount: cleanAmount,
        category: input.category,
        payment_method: input.paymentMethod || null,
        cheque_no: input.chequeNo || null,
        reference_no: refNo,
        bank_account_id: input.bankAccountId || undefined,
        remarks: input.remarks || undefined,
        client_ref: input.clientRef || undefined,
      }

      const res = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const created = await res.json()
        const mapped = mapBackendExpenseToItem(created)
        if (input.items && input.items.length > 0) {
          mapped.items = input.items
          mapped.status = deriveRecordStatusFromParticulars(
            input.items,
            input.status === 'Unpaid'
              ? 'Unpaid'
              : input.status === 'Pending' || input.status === 'On hold'
                ? 'Pending'
                : 'Paid'
          )
        }
        inMemoryExpenses = [mapped, ...inMemoryExpenses]
        saveStoredExpenses(inMemoryExpenses)
        this.invalidateCache()
        return mapped
      } else {
        const errData = await res.json().catch(() => ({}))
        let errorMsg = 'Failed to record expense entry.'
        if (typeof errData.detail === 'string') {
          errorMsg = errData.detail
        } else if (Array.isArray(errData.detail)) {
          errorMsg = errData.detail
            .map((d: any) => {
              const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : ''
              return field ? `${field}: ${d.msg}` : (d.msg || JSON.stringify(d))
            })
            .join('; ')
        } else if (errData.detail && typeof errData.detail === 'object') {
          errorMsg = errData.detail.msg || JSON.stringify(errData.detail)
        } else if (typeof errData.message === 'string') {
          errorMsg = errData.message
        }
        throw new HttpError(errorMsg, res.status)
      }
    } catch (err: any) {
      if (err instanceof HttpError || (err.message && !err.message.includes('fetch'))) {
        throw err
      }
      throw new NetworkError(SERVER_UNREACHABLE)
    }
  },

  async updateExpense(
    id: string,
    updates: Partial<ExpenseItem> & {
      amount?: number
      particulars?: string
      chequeNo?: string
    }
  ): Promise<ExpenseItem | null> {
    this.invalidateCache()
    const numericId = id.replace(/^exp_/, '')
    const withdrawalVal =
      updates.withdrawal !== undefined
        ? updates.withdrawal
        : updates.amount !== undefined
          ? updates.amount
          : undefined

    const payload: Record<string, any> = {}
    if (updates.rawDate || (updates.date && updates.date.includes('-'))) {
      payload.expense_date = updates.rawDate || updates.date
    }
    if (withdrawalVal !== undefined) {
      payload.amount = withdrawalVal
    }
    if (updates.particulars) {
      payload.particulars = updates.particulars
      payload.description = updates.particulars
    }
    if (updates.category) {
      payload.category = updates.category
    }
    if (updates.paymentMethod !== undefined) {
      payload.payment_method = updates.paymentMethod || null
    }
    if (updates.chequeNo !== undefined) {
      payload.cheque_no = updates.chequeNo
    }
    if (updates.remarks !== undefined) {
      payload.remarks = updates.remarks
    }

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/expenses/${numericId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const updated = await res.json()
        const mapped = mapBackendExpenseToItem(updated)
        if (updates.updatedBy) {
          mapped.updatedBy = updates.updatedBy
        }
        if (updates.updatedAt) {
          mapped.updatedAt = updates.updatedAt
        }
        if (updates.items && updates.items.length > 0) {
          mapped.items = updates.items
          mapped.status = deriveRecordStatusFromParticulars(
            updates.items,
            mapped.status === 'Unpaid'
              ? 'Unpaid'
              : mapped.status === 'Pending'
                ? 'Pending'
                : 'Paid'
          )
        } else if (updates.status) {
          mapped.status = updates.status
        }
        inMemoryExpenses = inMemoryExpenses.map((e) =>
          e.id === id || e.id === `exp_${numericId}` ? mapped : e
        )
        saveStoredExpenses(inMemoryExpenses)
        this.invalidateCache()
        return mapped
      } else if (res.status === 400) {
        const errData = await res.json().catch(() => ({}))
        throw new ExpenseValidationError(
          typeof errData.detail === 'string'
            ? errData.detail
            : 'Failed to update expense entry.'
        )
      }
      // Any other refusal (403, 404, 422, 500...) is an error too, never a silent local update
      const errData = await res.json().catch(() => ({}))
      throw new Error(typeof errData.detail === 'string' ? errData.detail : 'Failed to update expense entry.')
    } catch (err) {
      if (err instanceof ExpenseValidationError) throw err
      if (err instanceof TypeError) throw new Error(SERVER_UNREACHABLE)
      throw err
    }
  },

  async recordExpensePayment(
    id: string,
    payment: {
      amount: number
      paymentDate: string
      referenceNo?: string
      paymentMethod?: string
      notes?: string
    }
  ): Promise<ExpenseItem> {
    this.invalidateCache()
    const numericId = id.replace(/^exp_/, '')
    const index = inMemoryExpenses.findIndex(
      (e) => e.id === id || e.id === `exp_${numericId}`
    )
    if (index === -1) {
      throw new Error('Expense record not found.')
    }

    const exp = inMemoryExpenses[index]
    const totalAmount = exp.withdrawal || exp.netAmount || 0
    const currentPaid = (exp.totalPaid || 0) + Number(payment.amount)
    const newRemaining = Math.max(0, totalAmount - currentPaid)
    const newStatus = newRemaining <= 0 ? 'Paid' : 'Partially Paid'

    const repRecord: ExpenseRepaymentRecord = {
      id: `rep_exp_${Date.now()}`,
      paymentDate: payment.paymentDate,
      amount: Number(payment.amount),
      remainingBalance: newRemaining,
      referenceNo: payment.referenceNo || `PAY-${Date.now().toString().slice(-4)}`,
      paymentMethod: payment.paymentMethod || 'Cash',
      notes: payment.notes || '',
      createdAt: new Date().toISOString(),
    }

    const updated: ExpenseItem = {
      ...exp,
      totalPaid: currentPaid,
      outstandingBalance: newRemaining,
      status: newStatus,
      repayments: [repRecord, ...(exp.repayments || [])],
      updatedBy: exp.updatedBy,
      updatedAt: new Date().toISOString(),
    }

    inMemoryExpenses[index] = updated
    saveStoredExpenses(inMemoryExpenses)
    this.invalidateCache()
    return updated
  },

  async updateExpenseRemarks(id: string, remarks: string): Promise<ExpenseItem> {
    this.invalidateCache()
    const numericId = id.replace(/^exp_/, '')
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null

    const res = await fetch(`/api/v1/expenses/${numericId}/remarks`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ remarks }),
    })

    if (res.ok) {
      const updated = await res.json()
      const mapped = mapBackendExpenseToItem(updated)
      inMemoryExpenses = inMemoryExpenses.map((e) =>
        e.id === id || e.id === `exp_${numericId}` ? mapped : e
      )
      saveStoredExpenses(inMemoryExpenses)
      this.invalidateCache()
      return mapped
    } else {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.detail || 'Failed to update remarks.')
    }
  },

  async deleteExpense(id: string): Promise<boolean> {
    this.invalidateCache()
    const numericId = id.replace(/^exp_/, '')
    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/expenses/${numericId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        inMemoryExpenses = inMemoryExpenses.filter(
          (e) => e.id !== id && e.id !== `exp_${numericId}`
        )
        saveStoredExpenses(inMemoryExpenses)
        this.invalidateCache()
        return true
      }
      const errData = await res.json().catch(() => ({}))
      throw new Error(typeof errData.detail === 'string' ? errData.detail : 'Failed to delete expense entry.')
    } catch (err) {
      if (err instanceof TypeError) throw new Error(SERVER_UNREACHABLE)
      throw err
    }
  },

  async updateExpenseAuditStatus(
    id: string,
    auditStatus: 'Verified' | 'Pending Audit' | 'Flagged',
    auditedBy?: string,
    auditNotes?: string
  ): Promise<ExpenseItem | null> {
    // Spec 0014: the server saves the status and stamps who audited and when.
    // `auditedBy` is kept in the signature for existing callers; the server ignores it.
    void auditedBy
    try {
      const numericId = id.replace(/^exp_/, '')
      const saved = await saveAuditReview('expenses', numericId, auditStatus, auditNotes)
      const mapped = mapBackendExpenseToItem(saved)
      const index = inMemoryExpenses.findIndex(
        (e) => e.id === id || e.id === `exp_${numericId}`
      )
      if (index === -1) return mapped
      const updated: ExpenseItem = {
        ...inMemoryExpenses[index],
        auditStatus: mapped.auditStatus,
        auditedBy: mapped.auditedBy,
        auditDate: mapped.auditDate,
        auditNotes: mapped.auditNotes,
        updatedBy: inMemoryExpenses[index].updatedBy,
        updatedAt: inMemoryExpenses[index].updatedAt,
      }
      inMemoryExpenses[index] = updated
      saveStoredExpenses(inMemoryExpenses)
      return updated
    } finally {
      // Success or failure, the next read must come from the server.
      this.invalidateCache()
    }
  },

  exportCsv(items: ExpenseItem[], filename = 'expense_report.csv') {
    const headers = [
      'Date',
      'Ref No',
      'Cheque No',
      'Particulars',
      'Withdrawal',
      'Payment Method',
      'Category',
      'Net Amount',
      'Company',
    ]

    const rows = items.map((e) => [
      e.date,
      e.refNo,
      e.chequeNo || '—',
      `"${e.particulars.replace(/"/g, '""')}"`,
      e.withdrawal,
      e.paymentMethod || 'Cash',
      e.category,
      e.netAmount,
      e.company,
    ])

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  },

  exportPdf(items: ExpenseItem[], company = 'MCT Kitchen') {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const totalWithdrawal = items.reduce((sum, e) => sum + (e.withdrawal || 0), 0)

    const rowsHtml = items
      .map(
        (e) => `
        <tr>
          <td>${e.date}</td>
          <td>${e.chequeNo || '—'}</td>
          <td>${e.particulars}</td>
          <td style="text-align: right;">₱${e.withdrawal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td>${e.paymentMethod || 'Cash'}</td>
          <td>${e.category}</td>
          <td style="text-align: right;">₱${e.netAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td>${e.status}</td>
        </tr>
      `
      )
      .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Expense Summary Report — ${company}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #0B0F2B; }
            h1 { font-size: 20px; margin-bottom: 4px; color: #960C01; }
            p { font-size: 12px; color: #767B89; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 11px; }
            th { background: #F8FAFC; text-align: left; padding: 8px; border-bottom: 2px solid #E2E8F0; font-weight: 600; text-transform: uppercase; font-size: 10px; color: #767B89; }
            td { padding: 8px; border-bottom: 1px solid #F1F5F9; }
            .summary { margin-top: 24px; padding: 16px; background: #F8FAFC; border-radius: 8px; font-size: 12px; display: flex; justify-content: space-between; }
          </style>
        </head>
        <body>
          <h1>MCT Group of Companies</h1>
          <p>Expense Summary Report for <strong>${company}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Cheque No.</th>
                <th>Particulars</th>
                <th style="text-align: right;">Withdrawal</th>
                <th>Payment Method</th>
                <th>Category</th>
                <th style="text-align: right;">Net Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Records:</strong> ${items.length}</div>
            <div><strong>Total Expenses (Outflows):</strong> ₱${totalWithdrawal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  },

  exportDailySummaryCsv(groups: DailyGroupSummary<ExpenseItem>[], filename = 'expense_daily_summary.csv') {
    const headers = [
      'Date',
      'Day of Week',
      'Transaction Count',
      'Gross Total',
      'Realized Cash Disbursement',
      'Audit Status',
    ]

    const rows = groups.map((g) => [
      g.date,
      g.dayOfWeek,
      g.transactionCount,
      g.grossTotal.toFixed(2),
      g.realizedCash.toFixed(2),
      g.auditStatus,
    ])

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  },

  exportDailySummaryPdf(groups: DailyGroupSummary<ExpenseItem>[], company = 'MCT Kitchen') {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const totalGross = groups.reduce((sum, g) => sum + (g.grossTotal || 0), 0)
    const totalRealized = groups.reduce((sum, g) => sum + (g.realizedCash || 0), 0)
    const totalTransactions = groups.reduce((sum, g) => sum + (g.transactionCount || 0), 0)

    const rowsHtml =
      groups.length === 0
        ? `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No daily expense records available for this selection.</td></tr>`
        : groups
            .map(
              (g) => `
      <tr>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${g.formattedDate || g.date}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${g.dayOfWeek}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${g.transactionCount}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #dc2626; font-weight: 600;">₱${g.grossTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">₱${g.realizedCash.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; ${
            g.auditStatus === 'All Verified'
              ? 'background: #dcfce7; color: #15803d;'
              : g.auditStatus === 'Discrepancy'
              ? 'background: #ffe4e6; color: #be123c;'
              : 'background: #fef3c7; color: #b45309;'
          }">
            ${g.auditStatus}
          </span>
        </td>
      </tr>
    `
            )
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Daily Expense Summary Report — ${company}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding: 24px; }
            h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; color: #960C01; }
            p { font-size: 12px; color: #64748B; margin: 0 0 16px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; border-bottom: 2px solid #CBD5E1; }
            .summary { margin-top: 20px; padding: 12px 16px; background-color: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 12px; }
            @media print {
              body { padding: 10px; }
              @page { size: landscape; margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <h1>MCT Group of Companies</h1>
          <p>Daily Expense Summary Report for <strong>${company}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th style="text-align: center;">Transactions</th>
                <th style="text-align: right;">Gross Expenses</th>
                <th style="text-align: right;">Realized Cash</th>
                <th>Audit Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Days:</strong> ${groups.length} (Total Tx: ${totalTransactions})</div>
            <div><strong>Total Gross Expenses:</strong> ₱${totalGross.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            <div><strong>Total Realized Cash:</strong> ₱${totalRealized.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  },


  toDashboardTransaction(expense: ExpenseItem): DashboardTransactionItem {
    return {
      id: expense.id,
      refNo: expense.refNo,
      chequeNo: expense.chequeNo,
      date: expense.date,
      type: 'Expense',
      company: expense.company,
      description: expense.particulars,
      particulars: expense.particulars,
      amount: expense.withdrawal,
      withdrawal: expense.withdrawal,
      deposit: 0,
      category: (expense.category || 'Uncategorized') as any,
      paymentMethod: expense.paymentMethod,
      status: expense.status,
      auditStatus: expense.auditStatus,
      auditedBy: expense.auditedBy,
      auditNotes: expense.auditNotes,
      auditDate: expense.auditDate,
      createdBy: expense.createdBy,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      attachments: [],
      items:
        expense.items ||
        parseParticulars(
          expense.particulars,
          null,
          expense.withdrawal || expense.netAmount
        ),
    }
  },
}
