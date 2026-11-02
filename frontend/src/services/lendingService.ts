import { formatUserFriendlyErrorMessage } from '../utils/errorUtils'

export interface DailyPaymentRecord {
  id: string
  transactionRefNo?: string
  transaction_ref_no?: string
  date: string
  payment_date?: string
  cycle_due_date?: string
  cycleDueDate?: string
  cycle_index?: number
  cycleIndex?: number
  is_late?: boolean
  isLate?: boolean
  days_late?: number
  daysLate?: number
  amount: number
  method: string
  referenceNo?: string
  notes?: string
  status?: 'Paid' | 'Missed' | 'Partial' | 'Partially Paid' | 'Advance Paid' | 'Pending' | 'Scheduled'
  missedReason?: string
  timestamp: string
  monthIndex?: number
  periodLabel?: string
  isLocked?: boolean
  target?: number
  penalty?: number
  penalty_portion?: number
}

export interface LendingFacility {
  id: string
  borrower_id?: number
  borrowerId?: number
  borrower_ref_no?: string
  borrowerRefNo?: string
  loanId: string | number
  loanRefNo?: string
  borrowerName: string
  borrowerContact?: string
  borrowerAddress?: string
  loanAmount: number
  interestRate: number
  dateBorrowed: string
  dueDate: string
  totalAmountPayable: number
  amountPaid: number
  remainingBalance: number
  status: 'Active' | 'Completed' | 'Overdue' | 'Pending'
  paymentFrequency?: 'Daily' | 'Monthly'
  termDays?: number
  penaltyRate?: number
  penaltyPerCycle?: number
  totalPenalties?: number
  advanceAmount?: number
  installmentTarget?: number
  complianceStatus?: 'Compliant' | 'Delayed' | 'Delinquent'
  missedCyclesCount?: number
  lenderCompany?: string
  notes?: string
  dailyPayments: DailyPaymentRecord[]
  auditStatus?: 'Verified' | 'Flagged'
  auditDate?: string
  auditedBy?: string
}

export type Borrower = LendingFacility
export type BorrowerCreatePayload = LendingCreateFacilityPayload

export interface LendingCalculateParams {
  principal: number
  interestRate: number
  paymentFrequency: 'Daily' | 'Monthly'
  dateBorrowed: string
  dueDate?: string
  termDays?: number
}

export interface LendingCalculateResult {
  principal: number
  interest_rate: number
  interest: number
  total_payable: number
  frequency: string
  cycle_count: number
  installment_target: number
  term_days: number
  penalty_rate: number
  penalty_per_cycle: number
  date_borrowed: string
  due_date: string
}

export interface LendingCreateFacilityPayload {
  borrowerName: string
  borrowerContact?: string
  borrowerAddress?: string
  loanAmount: number
  interestRate: number
  paymentFrequency: 'Daily' | 'Monthly'
  dateBorrowed: string
  dueDate?: string
  termDays?: number
  notes?: string
}

export interface LendingRecordPaymentPayload {
  facilityId?: number | string
  borrower_id?: number | string
  borrowerId?: number | string
  paymentDate: string
  cycleDueDate?: string
  cycle_due_date?: string
  cycleIndex?: number
  cycle_index?: number
  amount: number
  penaltyAmount?: number
  penalty_portion?: number
  method: string
  referenceNo?: string
  notes?: string
}

export interface LendingTransactionRecord {
  transaction_id: number
  facility_id: number
  transaction_ref_no?: string
  transaction_type: string
  payment_date: string
  due_date?: string
  cycle_due_date?: string
  cycle_index?: number
  is_late?: boolean
  days_late?: number
  amount: number
  penalty_portion?: number
  remaining_balance?: number
  payment_method: string
  reference_no?: string
  status: string
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface LendingLedgerResult {
  facility_id: string
  loan_ref_no: string
  borrower_name: string
  payment_frequency: string
  principal: number
  interest_rate: number
  total_payable: number
  amount_paid: number
  remaining_balance: number
  date_borrowed: string
  due_date: string
  term_days: number
  penalty_rate: number
  penalty_per_cycle: number
  total_penalties: number
  advance_amount: number
  installment_target: number
  compliance_status: string
  missed_cycles_count: number
  ledger_items: DailyPaymentRecord[]
  monthly_progress?: {
    totalMonths: number
    targetPerMonth: number
    totalPenalties: number
    advanceAmount: number
    complianceStatus: string
    missedCyclesCount: number
    monthDetails: Array<{
      month_index: number
      target: number
      paid: number
      remaining: number
      status: string
      dueDate: string
      isOverdue: boolean
      isLocked: boolean
      penalty?: number
    }>
    activeMonth: {
      month_index: number
      target: number
      paid: number
      remaining: number
      status: string
      dueDate: string
      isOverdue: boolean
      isLocked: boolean
      penalty?: number
    }
  }
  next_installment?: {
    periodLabel: string
    dueDate: string
    targetAmount: number
    isOverdue: boolean
    cycleIndex: number
    totalCycles: number
  }
}

export const LENDING_STORAGE_KEY = 'mct_filcap_lending_facilities_v2'

export const INITIAL_FACILITIES: LendingFacility[] = []

class LendingServiceGateway {
  /**
   * Load facilities from localStorage cache.
   */
  loadFromStorage(): LendingFacility[] {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LENDING_STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed)) {
            return parsed
          }
        }
      } catch (err) {
        console.error('Error loading stored lending facilities:', err)
      }
    }
    return []
  }

  /**
   * Save facilities to localStorage cache.
   */
  saveToStorage(facilities: LendingFacility[]): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LENDING_STORAGE_KEY, JSON.stringify(facilities))
        window.dispatchEvent(new CustomEvent('mct:notifications-updated'))
      } catch (err) {
        console.error('Error saving lending facilities to storage:', err)
      }
    }
  }

  /**
   * Calculate facility terms by calling backend service, with local fallback.
   */
  async calculateTerms(params: LendingCalculateParams): Promise<LendingCalculateResult> {
    const termDays = params.termDays || (params.paymentFrequency === 'Daily' ? 40 : 2)
    try {
      const res = await fetch('/api/v1/lending/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: params.principal,
          interest_rate: params.interestRate,
          payment_frequency: params.paymentFrequency,
          term_days: termDays,
          date_borrowed: params.dateBorrowed,
          due_date: params.dueDate || '',
        }),
      })
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('LendingServiceGateway.calculateTerms backend request failed, using local fallback:', err)
    }

    // Local fallback calculation
    const p = params.principal
    const r = params.interestRate
    const interest = Math.round((p * (r / 100)) * 100) / 100
    const total = p + interest
    let cycleCount = termDays
    if (params.paymentFrequency === 'Daily') {
      cycleCount = termDays
    } else {
      cycleCount = termDays <= 36 ? termDays : Math.max(1, Math.round(termDays / 30))
    }
    const installmentTarget = Math.round((total / Math.max(1, cycleCount)) * 100) / 100
    const penaltyRate = 5.0
    const penaltyPerCycle = Math.round((installmentTarget * (penaltyRate / 100)) * 100) / 100

    return {
      principal: p,
      interest_rate: r,
      interest: interest,
      total_payable: total,
      frequency: params.paymentFrequency,
      cycle_count: cycleCount,
      installment_target: installmentTarget,
      term_days: termDays,
      penalty_rate: penaltyRate,
      penalty_per_cycle: penaltyPerCycle,
      date_borrowed: params.dateBorrowed,
      due_date: params.dueDate || '',
    }
  }

  /**
   * Fetch borrowers list from backend with localStorage fallback.
   */
  async getFacilities(companyId?: number): Promise<LendingFacility[]> {
    try {
      const query = companyId ? `?company_id=${companyId}` : ''
      const res = await fetch(`/api/v1/lending/borrowers${query}`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          this.saveToStorage(data)
          return data
        }
      }
    } catch (err) {
      console.warn('LendingServiceGateway.getFacilities backend request failed, using cached storage:', err)
    }
    return this.loadFromStorage()
  }

  /**
   * Fetch single borrower by ID from backend with fallback to cached storage.
   */
  async getBorrower(borrowerId: string | number): Promise<LendingFacility | null> {
    const numId = typeof borrowerId === 'number' ? borrowerId : parseInt(String(borrowerId).replace(/\D/g, ''), 10)
    if (!isNaN(numId) && numId > 0) {
      try {
        const res = await fetch(`/api/v1/lending/borrowers/${numId}`)
        if (res.ok) {
          const data = await res.json()
          if (data && data.id) {
            return data
          }
        }
      } catch (err) {
        console.warn('LendingServiceGateway.getBorrower backend request failed:', err)
      }
    }
    const all = this.loadFromStorage()
    return all.find((f) => String(f.id) === String(borrowerId)) || null
  }

  /**
   * Create a new borrower via backend, saving directly to Supabase database.
   */
  async createFacility(payload: LendingCreateFacilityPayload): Promise<LendingFacility> {
    const termDays = payload.termDays || (payload.paymentFrequency === 'Daily' ? 40 : 2)
    try {
      const res = await fetch('/api/v1/lending/borrowers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower_name: payload.borrowerName,
          borrower_contact: payload.borrowerContact || '',
          borrower_address: payload.borrowerAddress || '',
          loan_amount: payload.loanAmount,
          interest_rate: payload.interestRate,
          payment_frequency: payload.paymentFrequency,
          term_days: termDays,
          date_borrowed: payload.dateBorrowed,
          due_date: payload.dueDate || '',
          notes: payload.notes || '',
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const friendly = formatUserFriendlyErrorMessage(
          errData?.detail || { status: res.status },
          'Unable to create borrower record. Please try again.'
        )
        throw new Error(friendly)
      }
      const created = await res.json()
      const existing = this.loadFromStorage()
      const updated = [created, ...existing]
      this.saveToStorage(updated)
      return created
    } catch (err: any) {
      console.error('LendingServiceGateway.createFacility failed:', err)
      throw new Error(
        formatUserFriendlyErrorMessage(err, 'Unable to create borrower record. Please try again.')
      )
    }
  }

  /**
   * Update an existing borrower in Supabase database.
   */
  async updateBorrower(
    borrowerId: string | number,
    payload: {
      borrowerName?: string
      loanAmount?: number
      interestRate?: number
      paymentFrequency?: string
      termDays?: number
      dateBorrowed?: string
      dueDate?: string
      status?: string
      notes?: string
    }
  ): Promise<LendingFacility> {
    const numId = typeof borrowerId === 'number' ? borrowerId : parseInt(String(borrowerId).replace(/\D/g, ''), 10)
    try {
      const res = await fetch('/api/v1/lending/borrowers/' + numId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower_name: payload.borrowerName,
          loan_amount: payload.loanAmount,
          interest_rate: payload.interestRate,
          payment_frequency: payload.paymentFrequency,
          term_days: payload.termDays,
          date_borrowed: payload.dateBorrowed,
          due_date: payload.dueDate,
          status: payload.status,
          notes: payload.notes,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const friendly = formatUserFriendlyErrorMessage(
          errData?.detail || { status: res.status },
          'Unable to update borrower details. Please try again.'
        )
        throw new Error(friendly)
      }
      const updated = await res.json()
      const cached = this.loadFromStorage()
      const nextList = cached.map((f) => (String(f.id) === String(borrowerId) || String(f.borrower_id) === String(numId) ? updated : f))
      this.saveToStorage(nextList)
      return updated
    } catch (err: any) {
      console.error('LendingServiceGateway.updateBorrower failed:', err)
      throw new Error(
        formatUserFriendlyErrorMessage(err, 'Unable to update borrower details. Please try again.')
      )
    }
  }

  /**
   * Delete an existing borrower and all associated transactions from Supabase database.
   */
  async deleteBorrower(borrowerId: string | number): Promise<{ success: boolean; message: string }> {
    const numId = typeof borrowerId === 'number' ? borrowerId : parseInt(String(borrowerId).replace(/\D/g, ''), 10)
    try {
      const res = await fetch('/api/v1/lending/borrowers/' + numId, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const friendly = formatUserFriendlyErrorMessage(
          errData?.detail || { status: res.status },
          'Unable to delete borrower record. Please try again.'
        )
        throw new Error(friendly)
      }
      const result = await res.json()
      const cached = this.loadFromStorage()
      const nextList = cached.filter((f) => String(f.id) !== String(borrowerId) && String(f.borrower_id) !== String(numId))
      this.saveToStorage(nextList)
      return result
    } catch (err: any) {
      console.error('LendingServiceGateway.deleteBorrower failed:', err)
      throw new Error(
        formatUserFriendlyErrorMessage(err, 'Unable to delete borrower record. Please try again.')
      )
    }
  }


  /**
   * Retrieve ledger and schedule analysis from backend service.
   */
  async getLedger(facilityId: string | number): Promise<LendingLedgerResult | null> {
    const numId = parseInt(String(facilityId).replace(/\D/g, ''), 10)
    if (!isNaN(numId) && numId > 0) {
      try {
        const res = await fetch(`/api/v1/lending/ledger/${numId}`)
        if (res.ok) {
          return await res.json()
        }
      } catch (err) {
        console.warn('LendingServiceGateway.getLedger backend request failed:', err)
      }
    }
    return null
  }

  /**
   * Record payment remittance via backend service.
   */
  async recordPayment(payload: LendingRecordPaymentPayload): Promise<{ success: boolean; message?: string; transaction?: any }> {
    const rawId = payload.borrower_id ?? payload.borrowerId ?? payload.facilityId
    const numId = typeof rawId === 'number' ? rawId : parseInt(String(rawId).replace(/\D/g, ''), 10)

    if (isNaN(numId) || numId <= 0) {
      return { success: false, message: 'Invalid borrower ID. Payment could not be recorded.' }
    }

    try {
      const res = await fetch('/api/v1/lending/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower_id: numId,
          payment_date: payload.paymentDate,
          cycle_due_date: payload.cycleDueDate || payload.cycle_due_date || null,
          cycle_index: payload.cycleIndex ?? payload.cycle_index ?? null,
          amount: payload.amount,
          penalty_amount: payload.penaltyAmount ?? payload.penalty_portion ?? 0,
          method: payload.method,
          reference_no: payload.referenceNo || '',
          notes: payload.notes || '',
        }),
      })

      if (res.ok) {
        const data = await res.json()
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('mct:notifications-updated'))
        }
        return { success: true, transaction: data }
      }

      // Handle server error responses (400, 404, 409, 422, 500)
      const err = await res.json().catch(() => null)
      const friendlyMsg = formatUserFriendlyErrorMessage(
        err || { status: res.status },
        'Unable to record payment remittance. Please try again.'
      )
      return { success: false, message: friendlyMsg }
    } catch (err: any) {
      console.error('LendingServiceGateway.recordPayment backend call failed:', err)
      const friendlyMsg = formatUserFriendlyErrorMessage(
        err,
        'Unable to record payment remittance. Please try again.'
      )
      return { success: false, message: friendlyMsg }
    }
  }

  /**
   * Retrieve all lending transactions from the database with optional borrower filter.
   */
  async getTransactions(borrowerId?: number | string): Promise<LendingTransactionRecord[]> {
    try {
      const numId = borrowerId ? parseInt(String(borrowerId).replace(/\D/g, ''), 10) : undefined
      const query = numId && !isNaN(numId) ? `?borrower_id=${numId}` : ''
      const res = await fetch(`/api/v1/lending/transactions${query}`)
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('LendingServiceGateway.getTransactions failed:', err)
    }
    return []
  }
}

export const lendingService = new LendingServiceGateway()

// --- Lending Calculation & Ledger Presentation Helpers ---

function formatToYYYYMMDD(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getMonthsBetween(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 1
  const s = new Date(startDate)
  const e = new Date(endDate)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1
  const diffYears = e.getFullYear() - s.getFullYear()
  const diffMonths = e.getMonth() - s.getMonth()
  const months = diffYears * 12 + diffMonths
  return Math.max(1, months)
}

export function getCycleDueDate(
  dateBorrowed: string,
  finalDueDate: string,
  frequency: 'Daily' | 'Monthly',
  cycleIndex: number,
  totalCycles: number
): string {
  if (!dateBorrowed) return finalDueDate
  if (cycleIndex >= totalCycles && finalDueDate) return finalDueDate

  const dateParts = dateBorrowed.split('T')[0].split('-')
  let startYear = parseInt(dateParts[0], 10)
  let startMonth = parseInt(dateParts[1], 10) - 1
  let startDay = parseInt(dateParts[2], 10)

  if (isNaN(startYear) || isNaN(startMonth) || isNaN(startDay)) {
    const parsed = new Date(dateBorrowed)
    if (isNaN(parsed.getTime())) return finalDueDate
    startYear = parsed.getFullYear()
    startMonth = parsed.getMonth()
    startDay = parsed.getDate()
  }

  if (frequency === 'Monthly') {
    const targetYear = startYear + Math.floor((startMonth + cycleIndex) / 12)
    const targetMonth = (startMonth + cycleIndex) % 12
    const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate()
    const targetDay = Math.min(startDay, maxDays)
    const target = new Date(targetYear, targetMonth, targetDay)
    return formatToYYYYMMDD(target)
  }
  const target = new Date(startYear, startMonth, startDay + cycleIndex)
  return formatToYYYYMMDD(target)
}

export function getMonthlyProgress(facility: LendingFacility) {
  const termDays = facility.termDays || 2
  let totalMonths = 2
  if (termDays <= 36) {
    totalMonths = Math.max(1, termDays)
  } else if (facility.dateBorrowed && facility.dueDate) {
    const start = new Date(facility.dateBorrowed)
    const due = new Date(facility.dueDate)
    if (!isNaN(start.getTime()) && !isNaN(due.getTime())) {
      totalMonths = Math.max(
        1,
        (due.getFullYear() - start.getFullYear()) * 12 + (due.getMonth() - start.getMonth())
      )
      if (due.getDate() > start.getDate()) totalMonths += 1
    }
  } else {
    totalMonths = Math.max(1, Math.round(termDays / 30))
  }
  const monthTarget = Math.round((facility.totalAmountPayable / totalMonths) * 100) / 100
  const penaltyPerMonth = Math.round((monthTarget * 0.05) * 100) / 100
  const todayStr = formatToYYYYMMDD(new Date())

  // Aggregate payments by monthIndex, cycleIndex, cycleDueDate or payment date
  const monthPaidMap = new Map<number, number>()
  ;(facility.dailyPayments || []).forEach((r) => {
    const cycleIdx = r.monthIndex ?? r.cycle_index ?? r.cycleIndex
    if (cycleIdx !== undefined && cycleIdx >= 1) {
      monthPaidMap.set(cycleIdx, (monthPaidMap.get(cycleIdx) || 0) + (r.amount || 0))
    } else if (r.cycle_due_date || r.cycleDueDate) {
      const targetDue = r.cycle_due_date || r.cycleDueDate
      let matched = false
      for (let i = 1; i <= totalMonths; i++) {
        const cDueDate = getCycleDueDate(facility.dateBorrowed, facility.dueDate, 'Monthly', i, totalMonths)
        if (cDueDate === targetDue) {
          monthPaidMap.set(i, (monthPaidMap.get(i) || 0) + (r.amount || 0))
          matched = true
          break
        }
      }
      if (!matched && r.date && facility.dateBorrowed) {
        const start = new Date(facility.dateBorrowed)
        const pDate = new Date(r.date)
        if (!isNaN(start.getTime()) && !isNaN(pDate.getTime()) && pDate >= start) {
          const mIdx = Math.min(totalMonths, Math.max(1, (pDate.getFullYear() - start.getFullYear()) * 12 + (pDate.getMonth() - start.getMonth()) + 1))
          monthPaidMap.set(mIdx, (monthPaidMap.get(mIdx) || 0) + (r.amount || 0))
        }
      }
    } else if (r.date && facility.dateBorrowed) {
      const start = new Date(facility.dateBorrowed)
      const pDate = new Date(r.date)
      if (!isNaN(start.getTime()) && !isNaN(pDate.getTime()) && pDate >= start) {
        const mIdx = Math.min(totalMonths, Math.max(1, (pDate.getFullYear() - start.getFullYear()) * 12 + (pDate.getMonth() - start.getMonth()) + 1))
        monthPaidMap.set(mIdx, (monthPaidMap.get(mIdx) || 0) + (r.amount || 0))
      }
    }
  })

  const months: Array<{
    monthIndex: number
    target: number
    paid: number
    remaining: number
    status: 'Paid' | 'Partial' | 'Partially Paid' | 'Unpaid' | 'Advance Paid' | 'Missed'
    dueDate: string
    isOverdue: boolean
    isLocked: boolean
    penalty?: number
  }> = []

  let availableCredit = 0
  let totalPenalties = 0
  let missedCount = 0

  for (let i = 1; i <= totalMonths; i++) {
    const isLast = i === totalMonths
    const target = isLast
      ? Math.max(0, Math.round((facility.totalAmountPayable - (monthTarget * (totalMonths - 1))) * 100) / 100)
      : monthTarget

    const directPaid = monthPaidMap.get(i) || 0
    const availableFunds = directPaid + availableCredit
    const cycleDueDate = getCycleDueDate(
      facility.dateBorrowed,
      facility.dueDate,
      'Monthly',
      i,
      totalMonths
    )

    let status: 'Paid' | 'Partial' | 'Partially Paid' | 'Unpaid' | 'Advance Paid' | 'Missed' = 'Unpaid'
    let remaining = target
    let isLocked = false
    let isOverdue = false
    let monthPenalty = 0

    if (directPaid >= target && target > 0) {
      remaining = 0
      status = 'Paid'
      isLocked = true
    } else if (directPaid > 0) {
      remaining = target - directPaid
      isOverdue = todayStr > cycleDueDate
      status = 'Partially Paid'
    } else {
      isOverdue = todayStr > cycleDueDate
      status = isOverdue ? 'Missed' : 'Unpaid'
    }

    months.push({
      monthIndex: i,
      target,
      paid: directPaid,
      remaining,
      status,
      dueDate: cycleDueDate,
      isOverdue,
      isLocked,
      penalty: 0,
    })
  }

  const activeMonth = months.find((m) => m.remaining > 0) || months[months.length - 1]

  return {
    totalMonths,
    monthTarget,
    months,
    activeMonth,
    totalPenalties: 0,
    advanceAmount: 0,
    complianceStatus: 'Compliant' as const,
    missedCyclesCount: 0,
  }
}

export function getNextInstallmentInfo(facility: LendingFacility): {
  periodLabel: string
  dueDate: string
  target: number
  remaining: number
  isOverdue: boolean
} | null {
  if (facility.remainingBalance <= 0) return null
  const freq = facility.paymentFrequency || 'Daily'
  const todayStr = formatToYYYYMMDD(new Date())

  if (freq === 'Daily') {
    const termDays = facility.termDays || 40
    const target = facility.installmentTarget || Math.round((facility.totalAmountPayable / termDays) * 100) / 100
    return {
      periodLabel: 'Today',
      dueDate: todayStr,
      target,
      remaining: Math.min(facility.remainingBalance, target),
      isOverdue: false,
    }
  }
  if (freq === 'Monthly') {
    const progress = getMonthlyProgress(facility)
    return {
      periodLabel: `Month ${progress.activeMonth.monthIndex}`,
      dueDate: progress.activeMonth.dueDate,
      target: progress.activeMonth.target,
      remaining: progress.activeMonth.remaining,
      isOverdue: progress.activeMonth.isOverdue,
    }
  }
  return null
}

export function buildDailyLedger(facility: LendingFacility): DailyPaymentRecord[] {
  const existingPayments = facility.dailyPayments || []
  if (facility.paymentFrequency && facility.paymentFrequency !== 'Daily') {
    return existingPayments
  }

  if (!facility.dateBorrowed) return existingPayments
  const start = new Date(facility.dateBorrowed)
  if (isNaN(start.getTime())) return existingPayments

  const termDays = facility.termDays || 40
  const target = facility.installmentTarget || Math.round((facility.totalAmountPayable / termDays) * 100) / 100
  const penaltyPerCycle = facility.penaltyPerCycle || Math.round((target * 0.05) * 100) / 100

  const todayStr = formatToYYYYMMDD(new Date())
  const today = new Date(todayStr)

  // Map payments by actual payment date
  const dayPayments = new Map<string, DailyPaymentRecord[]>()
  existingPayments.forEach((p) => {
    const list = dayPayments.get(p.date) || []
    list.push(p)
    dayPayments.set(p.date, list)
  })

  // End date is max(today, start + termDays - 1)
  const endDate = new Date(start)
  endDate.setDate(endDate.getDate() + Math.max(1, termDays) - 1)
  const finalEnd = today > endDate ? today : endDate

  let availableCredit = 0
  const rows: DailyPaymentRecord[] = []
  const cur = new Date(start)

  while (cur <= finalEnd) {
    const dateStr = formatToYYYYMMDD(cur)
    const list = dayPayments.get(dateStr) || []
    const paidToday = list.reduce((sum, item) => sum + (item.amount || 0), 0)

    if (paidToday >= target && target > 0) {
      const first = list[0]
      rows.push({
        id: first?.id || `day-${dateStr}`,
        date: dateStr,
        amount: paidToday,
        target,
        method: first?.method || 'Cash',
        referenceNo: first?.referenceNo || '-',
        notes: first?.notes || '-',
        status: 'Paid',
        penalty: 0,
        timestamp: first?.timestamp || `${dateStr}T10:00:00Z`,
        isLocked: true,
      })
    } else if (paidToday > 0) {
      const first = list[0]
      rows.push({
        id: first?.id || `day-${dateStr}`,
        date: dateStr,
        amount: paidToday,
        target,
        method: first?.method || 'Cash',
        referenceNo: first?.referenceNo || '-',
        notes: first?.notes || '-',
        status: 'Partially Paid',
        penalty: 0,
        timestamp: first?.timestamp || `${dateStr}T10:00:00Z`,
        isLocked: false,
      })
    } else {
      const isPast = cur < today
      const isToday = dateStr === todayStr
      rows.push({
        id: `day-${dateStr}`,
        date: dateStr,
        amount: 0,
        target,
        method: '-',
        referenceNo: '-',
        notes: '-',
        status: isPast ? 'Missed' : (isToday ? 'Pending' : 'Scheduled'),
        penalty: 0,
        timestamp: `${dateStr}T23:59:59Z`,
        isLocked: false,
      })
    }

    cur.setDate(cur.getDate() + 1)
  }

  // Sort descending (most recent date first)
  rows.sort((a, b) => b.date.localeCompare(a.date))
  return rows
}
