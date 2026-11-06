import type { DashboardTransactionItem } from './dashboardService'
import { websocketService } from './websocketService'
import { notifyNotificationsUpdated } from './notificationService'

export interface LoanRepaymentRecord {
  id: string
  paymentDate: string
  amount: number
  remainingBalance: number
  referenceNo?: string
  paymentMethod?: string
  notes?: string
  createdAt?: string
}

export interface LoanItem {
  id: string
  loanId?: number
  refNo: string
  chequeNo?: string
  date: string // e.g. "10/01/26"
  rawDate: string // e.g. "2026-10-01"
  dueDate?: string // e.g. "2026-12-31"
  interestRate?: number // e.g. 5.0 (%)
  interestType?: string // e.g. "simple"
  particulars: string
  category: string
  amount: number
  totalPaid?: number
  outstandingBalance?: number
  repayments?: LoanRepaymentRecord[]
  borrowerId?: number
  borrower: string // Borrower company name
  lenderId?: number
  lender: string // Lender company name
  bankAccountId?: string
  company: string // Selected context company
  status: string
  endorsedBy?: string
  endorsedAt?: string
  financeRemark?: string
  auditReviewedBy?: string
  auditReviewedAt?: string
  auditRemark?: string
  auditStatus: 'Verified' | 'Pending Audit' | 'Flagged'
  auditedBy?: string
  auditNotes?: string
  auditDate?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
  type: 'Loan'
}

export interface NewLoanInput {
  date: string
  dueDate?: string
  interestRate?: number
  amount: number
  particulars: string
  borrowerCompany: string
  lenderCompany?: string
  category?: string
  chequeNo?: string
  status?: string
}

export interface CompanyOption {
  company_id: number
  company_name: string
}

export interface CompanyLoan extends LoanItem {
  category: string
  totalPaid: number
  outstandingBalance: number
  paymentStatus: 'Unpaid' | 'Partially Paid' | 'Fully Paid' | 'Overdue'
}

export interface CompanyLoanResult {
  items: CompanyLoanGroup[]
  total: number
  offset: number
  limit: number
}

export interface CompanyLoanGroup {
  key: string
  borrower: string
  lender: string
  category: string
  totalLoanAmount: number
  totalPaid: number
  outstandingBalance: number
  interestDisplay: string
  paymentStatus: string
  loanCount: number
  loans: CompanyLoan[]
}

// Clear legacy local storage to prevent clear-text storage of sensitive banking/financial data
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('mct_loan_records_v2')
    localStorage.removeItem('mct_loan_records_v1')
  } catch {
    // ignore
  }
}

let inMemoryLoans: LoanItem[] = []

function saveStoredLoans(items: LoanItem[]): void {
  inMemoryLoans = items
}

const companyNameCache = new Map<string, string>()

function mapBackendLoanToItem(l: any): LoanItem {
  const rawDateStr = l.loan_date || '2026-10-01'
  let displayDate = '10/01/26'
  if (rawDateStr) {
    const parts = rawDateStr.split('-')
    if (parts.length === 3) {
      displayDate = `${parts[1]}/${parts[2]}/${parts[0].slice(2)}`
    }
  }

  const amt = Number(l.principal_amount || l.amount || 0)
  
  let bName = l.borrower_name || l.borrower_company || ''
  const bId = String(l.borrower || '').replace(/\D/g, '')
  if ((!bName || bName.startsWith('Company #')) && bId) {
    bName = companyNameCache.get(bId) || (l.borrower ? `Company #${l.borrower}` : '')
  } else if (!bName) {
    bName = l.borrower ? `Company #${l.borrower}` : ''
  }

  let lName = l.lender_name || l.lender_company || ''
  const lId = String(l.lender || '').replace(/\D/g, '')
  if ((!lName || lName.startsWith('Company #')) && lId) {
    lName = companyNameCache.get(lId) || (l.lender ? `Company #${l.lender}` : 'Pending Finance Assignment')
  } else if (!lName) {
    lName = l.lender ? `Company #${l.lender}` : 'Pending Finance Assignment'
  }

  const totalPaid = Number(l.total_paid || l.totalPaid || 0)
  const outstanding = Number(
    l.outstanding_balance !== undefined
      ? l.outstanding_balance
      : l.outstandingBalance !== undefined
      ? l.outstandingBalance
      : Math.max(0, amt - totalPaid)
  )

  let finalStatus = l.status || 'Pending Finance Endorsement'
  if (!['Pending Finance Endorsement', 'Pending Audit Approval', 'Pending Approval', 'Overdue', 'Rejected by Finance', 'Disapproved by Audit'].includes(finalStatus)) {
    if (outstanding <= 0 && (totalPaid > 0 || finalStatus === 'Paid')) {
      finalStatus = 'Paid'
    } else if (totalPaid > 0 && outstanding > 0) {
      finalStatus = 'Partially Paid'
    }
  }

  return {
    id: `loan_${l.loan_id || l.id}`,
    loanId: l.loan_id || l.id,
    refNo: l.loan_ref_no || `LN-${l.loan_id || '001'}`,
    chequeNo: l.cheque_no || '',
    date: displayDate,
    rawDate: rawDateStr,
    dueDate: l.due_date || '',
    interestRate: Number(l.interest_rate || 0),
    interestType: l.interest_type || 'simple',
    particulars: l.particulars || l.description || 'Inter-company term financing facility',
    category: l.category || 'In-house',
    amount: amt,
    totalPaid,
    outstandingBalance: outstanding,
    repayments: l.repayments || [],
    borrowerId: l.borrower,
    borrower: bName,
    lenderId: l.lender,
    lender: lName,
    bankAccountId: l.bank_account_id || l.bankAccountId,
    company: bName,
    status: l.status || finalStatus,
    endorsedBy: l.endorsed_by,
    endorsedAt: l.endorsed_at,
    financeRemark: l.finance_remark,
    auditReviewedBy: l.audit_reviewed_by,
    auditReviewedAt: l.audit_reviewed_at,
    auditRemark: l.audit_remark,
    // Audit's approval is the audit (spec 0014, AC-8). Every status after approval counts as audited.
    auditStatus: AUDITED_LOAN_STATUSES.has((l.status || '').trim().toLowerCase()) ? 'Verified' : 'Pending Audit',
    auditedBy: l.audit_reviewed_by || undefined,
    type: 'Loan',
    createdAt: l.created_at || new Date().toISOString(),
    updatedAt: l.updated_at || new Date().toISOString(),
  }
}

/** Loan statuses reached only after Internal Audit approved the loan. */
const AUDITED_LOAN_STATUSES = new Set(['approved', 'paid', 'partially paid', 'overdue'])

const loanCache = new Map<string, { data: any; timestamp: number }>()
const LOAN_CACHE_TTL = 30000

export const loanService = {
  invalidateCache(): void {
    loanCache.clear()
    notifyNotificationsUpdated()
  },

  async getCompanyLoans(params: {
    companyId?: number
    borrowerId?: number
    lenderId?: number
    category?: string
    reference?: string
    particulars?: string
    paymentStatus?: string
    startDate?: string
    endDate?: string
    offset?: number
    limit?: number
  } = {}): Promise<CompanyLoanResult> {
    const cacheKey = JSON.stringify(params)
    const cached = loanCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < LOAN_CACHE_TTL) {
      return cached.data
    }

    if (companyNameCache.size === 0) {
      await loanService.getCompanies().catch(() => [])
    }

    const token = typeof window !== 'undefined'
      ? sessionStorage.getItem('mct_access_token')
      : null
    const query = new URLSearchParams()
    const values: Record<string, string | number | undefined> = {
      company_id: params.companyId,
      borrower_id: params.borrowerId,
      lender_id: params.lenderId,
      category: params.category,
      reference: params.reference,
      particulars: params.particulars,
      payment_status: params.paymentStatus,
      start_date: params.startDate,
      end_date: params.endDate,
      offset: params.offset,
      limit: params.limit,
    }
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value))
    })
    const response = await fetch(`/api/v1/loans/company?${query.toString()}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.detail || 'Unable to load company loans.')
    }
    const result = await response.json()
    const mappedResult = {
      ...result,
      items: result.items.map((group: any) => ({
        key: `${group.borrower}-${group.lender || 'external'}-${group.category}`,
        borrower: group.borrower_name,
        lender: group.lender_name,
        category: group.category,
        totalLoanAmount: Number(group.total_loan_amount || 0),
        totalPaid: Number(group.total_paid || 0),
        outstandingBalance: Number(group.outstanding_balance || 0),
        interestDisplay: group.interest_display,
        paymentStatus: group.payment_status,
        loanCount: group.loan_count,
        loans: group.loans.map((loan: any) => ({
          ...mapBackendLoanToItem(loan),
          category: loan.category,
          totalPaid: Number(loan.total_paid || 0),
          outstandingBalance: Number(loan.outstanding_balance || 0),
          paymentStatus: loan.payment_status,
        })),
      })),
    }
    loanCache.set(cacheKey, { data: mappedResult, timestamp: Date.now() })
    return mappedResult
  },

  async getCompanyLoanStatement(loanId: number) {
    const token = typeof window !== 'undefined'
      ? sessionStorage.getItem('mct_access_token')
      : null
    const response = await fetch(`/api/v1/loans/${loanId}/statement`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!response.ok) throw new Error('Unable to load the loan repayment timeline.')
    return response.json()
  },

  async exportCompanyLoans(params: Parameters<typeof this.getCompanyLoans>[0] = {}) {
    const token = typeof window !== 'undefined'
      ? sessionStorage.getItem('mct_access_token')
      : null
    const query = new URLSearchParams()
    const values: Record<string, string | number | undefined> = {
      company_id: params.companyId,
      borrower_id: params.borrowerId,
      lender_id: params.lenderId,
      category: params.category,
      reference: params.reference,
      particulars: params.particulars,
      payment_status: params.paymentStatus,
      start_date: params.startDate,
      end_date: params.endDate,
    }
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== '') query.set(key, String(value))
    })
    const response = await fetch(`/api/v1/loans/company/export?${query.toString()}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!response.ok) throw new Error('Unable to export company loans.')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'company-loans.csv'
    link.click()
    URL.revokeObjectURL(url)
  },

  async getCompanies(): Promise<CompanyOption[]> {
    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null
      const res = await fetch('/api/v1/companies/lookup', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          return data.map((c: any) => {
            const companyId = Number(c.company_id ?? c.id)
            const companyName = String(c.company_name || c.name || '')
            if (companyId && companyName) {
              companyNameCache.set(String(companyId), companyName)
            }
            return {
              company_id: companyId,
              company_name: companyName,
            }
          })
        }
      } else {
        console.warn('GET /api/v1/companies failed with status', res.status)
      }
    } catch (err) {
      console.warn('Failed to fetch companies from backend:', err)
    }
    return []
  },

  async getLoans(params?: {
    company?: string
    scope?: 'borrower' | 'lender'
    status?: string
    start_date?: string
    end_date?: string
  }): Promise<LoanItem[]> {
    try {
      if (companyNameCache.size === 0) {
        await loanService.getCompanies().catch(() => [])
      }

      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null
      const userStr = typeof window !== 'undefined' ? (sessionStorage.getItem('mct_session_user') || sessionStorage.getItem('mct_user')) : null
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

      const query = new URLSearchParams()
      if (params?.company && params.company !== 'All Companies') {
        query.append('company_name', params.company)
      }
      if (params?.scope) query.append('scope', params.scope)
      if (params?.status && params.status !== 'All') query.append('status', params.status)
      if (params?.start_date) query.append('start_date', params.start_date)
      if (params?.end_date) query.append('end_date', params.end_date)

      const url = `/api/v1/loans${query.toString() ? `?${query.toString()}` : ''}`
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(userName ? { 'X-User-Name': userName } : {}),
          ...(userRole ? { 'X-User-Role': userRole } : {}),
        },
      })

      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          const mapped = data.map(mapBackendLoanToItem)
          inMemoryLoans = mapped
          saveStoredLoans(mapped)
          return mapped
        }
      }
    } catch (err) {
      console.warn('Backend GET /loans failed, falling back to local storage:', err)
    }

    return [...inMemoryLoans]
  },

  async addLoan(input: NewLoanInput): Promise<LoanItem> {
    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const payload = {
        borrower_company: input.borrowerCompany,
        lender_company: input.lenderCompany,
        principal_amount: input.amount,
        interest_rate: input.interestRate || 0.0,
        interest_type: 'simple',
        loan_date: input.date,
        due_date: input.dueDate || null,
        description: input.particulars,
        particulars: input.particulars,
        status: input.status || 'Pending Finance Endorsement',
      }

      const res = await fetch('/api/v1/loans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const created = await res.json()
        const mapped = mapBackendLoanToItem(created)
        inMemoryLoans = [mapped, ...inMemoryLoans]
        saveStoredLoans(inMemoryLoans)
        return mapped
      } else {
        const errData = await res.json().catch(() => ({}))
        const errorMsg =
          errData.detail ||
          (typeof errData === 'string' ? errData : 'Failed to record loan entry.')
        throw new Error(errorMsg)
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch')) {
        throw err
      }
      console.warn('Backend POST /loans failed, creating local record:', err)
    }

    const rawDate = input.date
    const parts = rawDate.split('-')
    const formattedDate =
      parts.length === 3
        ? `${parts[1]}/${parts[2]}/${parts[0].slice(2)}`
        : input.date

    const randomSuffix = Math.floor(1000 + Math.random() * 9000)
    const refNo = `LN-${rawDate.replace(/-/g, '')}-${randomSuffix}`

    const newLoan: LoanItem = {
      id: `loan_${Date.now()}`,
      refNo,
      chequeNo: input.chequeNo || '',
      date: formattedDate,
      rawDate: input.date,
      dueDate: input.dueDate || '',
      interestRate: input.interestRate || 0,
      particulars: input.particulars,
      category: input.category || 'In-house',
      amount: input.amount,
      borrower: input.borrowerCompany,
      lender: input.lenderCompany || 'Pending Finance Assignment',
      company: input.borrowerCompany,
      status: (input.status as any) || 'Pending Approval',
      auditStatus: 'Pending Audit',
      type: 'Loan',
      createdAt: new Date().toISOString(),
      updatedBy: updates.updatedBy || existing.updatedBy,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    }

    inMemoryLoans = [newLoan, ...inMemoryLoans]
    saveStoredLoans(inMemoryLoans)
    return newLoan
  },

  async updateLoan(
    id: string,
    updates: Partial<LoanItem> & { borrowerCompany?: string; lenderCompany?: string }
  ): Promise<LoanItem | null> {
    const numericId = id.replace(/^loan_/, '')
    const payload: Record<string, any> = {}

    if (updates.rawDate || (updates.date && updates.date.includes('-'))) {
      payload.loan_date = updates.rawDate || updates.date
    }
    if (updates.dueDate) payload.due_date = updates.dueDate
    if (updates.amount !== undefined) payload.principal_amount = updates.amount
    if (updates.interestRate !== undefined) payload.interest_rate = updates.interestRate
    if (updates.particulars) {
      payload.particulars = updates.particulars
      payload.description = updates.particulars
    }
    if (updates.lenderCompany || updates.lender) {
      payload.lender_company = updates.lenderCompany || updates.lender
    }
    if (updates.status) payload.status = updates.status

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/loans/${numericId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const updated = await res.json()
        const mapped = mapBackendLoanToItem(updated)
        if (updates.updatedBy) mapped.updatedBy = updates.updatedBy
        if (updates.updatedAt) mapped.updatedAt = updates.updatedAt
        inMemoryLoans = inMemoryLoans.map((l) => (l.id === id || l.id === `loan_${numericId}` ? mapped : l))
        saveStoredLoans(inMemoryLoans)
        return mapped
      } else {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Failed to update loan.')
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch')) {
        throw err
      }
      console.warn('Backend PUT /loans failed, updating locally:', err)
    }

    const index = inMemoryLoans.findIndex((l) => l.id === id || l.id === `loan_${numericId}`)
    if (index === -1) return null

    const existing = inMemoryLoans[index]
    const updated: LoanItem = {
      ...existing,
      ...updates,
      updatedBy: updates.updatedBy || existing.updatedBy,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    }
    inMemoryLoans[index] = updated
    saveStoredLoans(inMemoryLoans)
    websocketService.emitLocal('LOANS_UPDATED')
    return updated
  },

  async deleteLoan(id: string): Promise<boolean> {
    const numericId = id.replace(/^loan_/, '')
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null

    if (/^\d+$/.test(numericId)) {
      const res = await fetch(`/api/v1/loans/${numericId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Failed to delete loan request.')
      }
    }

    inMemoryLoans = inMemoryLoans.filter((l) => l.id !== id && l.id !== `loan_${numericId}`)
    saveStoredLoans(inMemoryLoans)
    websocketService.emitLocal('LOANS_UPDATED')
    return true
  },

  async recordRepayment(
    id: string,
    repayment: {
      amount: number
      paymentDate: string
      referenceNo?: string
      paymentMethod?: string
      notes?: string
    }
  ): Promise<LoanItem> {
    const numericId = id.replace(/^loan_/, '')
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null

    if (/^\d+$/.test(numericId)) {
      try {
        const res = await fetch(`/api/v1/loans/${numericId}/repayments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            amount: repayment.amount,
            payment_date: repayment.paymentDate,
            reference_no: repayment.referenceNo || null,
            notes: repayment.notes || null,
          }),
        })
        if (res.ok) {
          // Success from backend
        }
      } catch (err) {
        console.warn('Backend POST /loans/.../repayments failed, recording locally:', err)
      }
    }

    const index = inMemoryLoans.findIndex((l) => l.id === id || l.id === `loan_${numericId}`)
    if (index === -1) {
      throw new Error('Loan record not found.')
    }

    const loan = inMemoryLoans[index]
    const currentPaid = (loan.totalPaid || 0) + Number(repayment.amount)
    const newRemaining = Math.max(0, loan.amount - currentPaid)
    const newStatus = newRemaining <= 0 ? 'Paid' : 'Partially Paid'

    const repRecord: LoanRepaymentRecord = {
      id: `rep_${Date.now()}`,
      paymentDate: repayment.paymentDate,
      amount: Number(repayment.amount),
      remainingBalance: newRemaining,
      referenceNo: repayment.referenceNo || `REP-${Date.now().toString().slice(-4)}`,
      paymentMethod: repayment.paymentMethod || 'Cash',
      notes: repayment.notes || '',
      createdAt: new Date().toISOString(),
    }

    const updatedLoan: LoanItem = {
      ...loan,
      totalPaid: currentPaid,
      outstandingBalance: newRemaining,
      status: newStatus,
      repayments: [repRecord, ...(loan.repayments || [])],
      updatedBy: updates.updatedBy || existing.updatedBy,
      updatedAt: updates.updatedAt || new Date().toISOString(),
    }

    inMemoryLoans[index] = updatedLoan
    saveStoredLoans(inMemoryLoans)
    return updatedLoan
  },

  async endorseLoan(
    id: string,
    payload: {
      action: 'endorse' | 'reject'
      bankAccountId?: string
      lenderCompany?: string
      interestRate?: number
      dueDate?: string
      remark: string
    }
  ): Promise<LoanItem> {
    const numericId = id.replace(/^loan_/, '')
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null
    const userStr = typeof window !== 'undefined' ? (sessionStorage.getItem('mct_session_user') || sessionStorage.getItem('mct_user')) : null
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

    const res = await fetch(`/api/v1/loans/${numericId}/endorse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(userName ? { 'X-User-Name': userName } : {}),
        ...(userRole ? { 'X-User-Role': userRole } : {}),
      },
      body: JSON.stringify({
        action: payload.action,
        bank_account_id: payload.bankAccountId || null,
        lender_company: payload.lenderCompany,
        interest_rate: payload.interestRate,
        due_date: payload.dueDate || null,
        remark: payload.remark,
      }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.detail || 'Failed to submit loan endorsement.')
    }

    const data = await res.json()
    const mapped = mapBackendLoanToItem(data)
    inMemoryLoans = inMemoryLoans.map((l) => (l.id === id || l.id === `loan_${numericId}` ? mapped : l))
    saveStoredLoans(inMemoryLoans)
    return mapped
  },

  async auditReviewLoan(
    id: string,
    payload: {
      action: 'approve' | 'disapprove'
      remark: string
    }
  ): Promise<LoanItem> {
    const numericId = id.replace(/^loan_/, '')
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null
    const userStr = typeof window !== 'undefined' ? (sessionStorage.getItem('mct_session_user') || sessionStorage.getItem('mct_user')) : null
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

    const res = await fetch(`/api/v1/loans/${numericId}/audit-review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(userName ? { 'X-User-Name': userName } : {}),
        ...(userRole ? { 'X-User-Role': userRole } : {}),
      },
      body: JSON.stringify({
        action: payload.action,
        remark: payload.remark,
      }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.detail || 'Failed to submit loan audit review.')
    }

    const data = await res.json()
    const mapped = mapBackendLoanToItem(data)
    inMemoryLoans = inMemoryLoans.map((l) => (l.id === id || l.id === `loan_${numericId}` ? mapped : l))
    saveStoredLoans(inMemoryLoans)
    return mapped
  },

  async approveLoan(
    id: string,
    approvalData?: {
      lenderCompany?: string
      interestRate?: number
      dueDate?: string
      notes?: string
    }
  ): Promise<LoanItem> {
    const numericId = id.replace(/^loan_/, '')
    const payload: Record<string, any> = {}
    if (approvalData?.lenderCompany) payload.lender_company = approvalData.lenderCompany
    if (approvalData?.interestRate !== undefined) payload.interest_rate = approvalData.interestRate
    if (approvalData?.dueDate) payload.due_date = approvalData.dueDate
    if (approvalData?.notes) payload.notes = approvalData.notes

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/loans/${numericId}/approve`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const approved = await res.json()
        const mapped = mapBackendLoanToItem(approved)
        inMemoryLoans = inMemoryLoans.map((l) => (l.id === id || l.id === `loan_${numericId}` ? mapped : l))
        saveStoredLoans(inMemoryLoans)
        return mapped
      } else {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Failed to approve loan.')
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch')) {
        throw err
      }
      console.warn('Backend PATCH /loans/approve failed, approving locally:', err)
    }

    const index = inMemoryLoans.findIndex((l) => l.id === id || l.id === `loan_${numericId}`)
    if (index !== -1) {
      inMemoryLoans[index].status = 'Approved'
      if (approvalData?.lenderCompany) {
        inMemoryLoans[index].lender = approvalData.lenderCompany
      }
      if (approvalData?.interestRate !== undefined) {
        inMemoryLoans[index].interestRate = approvalData.interestRate
      }
      if (approvalData?.dueDate) {
        inMemoryLoans[index].dueDate = approvalData.dueDate
      }
      saveStoredLoans(inMemoryLoans)
      return inMemoryLoans[index]
    }
    throw new Error('Loan record not found')
  },

  exportCsv(items: LoanItem[], scope: 'Borrower' | 'Lender', filename = 'loan_report.csv') {
    const isBorrower = scope === 'Borrower'

    const headers = isBorrower
      ? ['Date', 'Ref No', 'Lender Company', 'Particulars', 'Amount', 'Due Date', 'Interest Rate']
      : ['Date', 'Ref No', 'Borrower Company', 'Particulars', 'Amount', 'Due Date', 'Status']

    const rows = items.map((l) =>
      isBorrower
        ? [
            l.date,
            l.refNo,
            l.lender || '—',
            `"${(l.particulars || '').replace(/"/g, '""')}"`,
            l.amount,
            l.dueDate || '—',
            `${l.interestRate || 0}%`,
          ]
        : [
            l.date,
            l.refNo,
            l.borrower || '—',
            `"${(l.particulars || '').replace(/"/g, '""')}"`,
            l.amount,
            l.dueDate || '—',
            l.status,
          ]
    )

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

  exportPdf(items: LoanItem[], company = 'MCT Kitchen', scope: 'Borrower' | 'Lender' = 'Borrower') {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const totalAmount = items.reduce((sum, l) => sum + (l.amount || 0), 0)
    const isBorrower = scope === 'Borrower'

    const rowsHtml = items
      .map(
        (l) => `
        <tr>
          <td>${l.date}</td>
          <td>${l.refNo}</td>
          <td>${isBorrower ? l.lender : l.borrower}</td>
          <td>${l.particulars}</td>
          <td style="text-align: right;">₱${l.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td>${l.dueDate || '—'}</td>
          ${isBorrower ? `<td>${l.interestRate || 0}%</td>` : `<td>${l.status}</td>`}
        </tr>
      `
      )
      .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${scope} Loans Report — ${company}</title>
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
          <p>${scope} Loan Report for <strong>${company}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Ref No.</th>
                <th>${isBorrower ? 'Lender Company' : 'Borrower Company'}</th>
                <th>Particulars</th>
                <th style="text-align: right;">Amount</th>
                <th>Due Date</th>
                <th>${isBorrower ? 'Interest Rate' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Records:</strong> ${items.length}</div>
            <div><strong>Total Amount:</strong> ₱${totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
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

  toDashboardTransaction(loan: LoanItem): DashboardTransactionItem {
    return {
      id: loan.id,
      refNo: loan.refNo,
      chequeNo: loan.chequeNo,
      date: loan.date,
      type: 'Loan',
      company: loan.borrower,
      description: loan.particulars,
      particulars: loan.particulars,
      amount: loan.amount,
      withdrawal: loan.amount,
      deposit: 0,
      category: 'In-house',
      status: loan.status === 'Approved' ? 'Paid' : 'Pending',
      auditStatus: loan.auditStatus,
      auditedBy: loan.auditedBy,
      auditNotes: loan.auditNotes,
      auditDate: loan.auditDate,
      createdBy: loan.createdBy,
      createdAt: loan.createdAt,
      updatedAt: loan.updatedAt,
      attachments: [],
    }
  },
}
