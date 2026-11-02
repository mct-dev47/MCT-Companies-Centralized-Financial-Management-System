import { isCompanyMatch } from '@/utils/companyUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

export interface BillPaymentRecord {
  id: string
  periodKey?: string
  paymentDate: string
  amount: number
  billedAmount?: number
  paymentMethod: string
  refNo?: string
  referenceNo?: string
  notes?: string
  createdAt: string
}

export type BillStatus = 'Unpaid' | 'Paid' | 'Overdue' | 'Due Soon' | 'Partially Paid'
export type BillRecurring = 'Daily' | 'Monthly' | 'Yearly'

export interface BillPaymentPeriod {
  key: string
  label: string
  paid: boolean
  partiallyPaid?: boolean
  billedAmount?: number
  paidAmount?: number
  remainingAmount?: number
  paymentDate?: string
  periodDate?: string
  isFuture?: boolean
  isNextPayable?: boolean
  payments?: BillPaymentRecord[]
}

export interface BillItem {
  id: string
  billerName: string
  company: string
  amount: number
  latestAmount?: number
  dueDate: string // YYYY-MM-DD
  dueDayOfMonth?: number
  initialDueDate?: string
  billingCycle: BillRecurring
  reminderDaysBefore: number
  status: BillStatus
  notes?: string
  lastPaidDate?: string
  lastPaymentMethod?: string
  payments?: BillPaymentRecord[]
  periods?: BillPaymentPeriod[]
  nextPeriodKey?: string
  nextPeriodLabel?: string
  nextPeriodDate?: string
  createdAt: string
  updatedAt: string
  auditStatus?: 'Verified' | 'Pending Audit' | 'Flagged'
  auditDate?: string
  auditedBy?: string
}

export interface NewBillInput {
  billerName: string
  company: string
  amount?: number
  dueDate: string
  dueDayOfMonth?: number
  billingCycle?: BillRecurring
  reminderDaysBefore?: number
  notes?: string
}

export interface UpdateBillInput {
  billerName?: string
  company?: string
  amount?: number
  dueDate?: string
  dueDayOfMonth?: number
  billingCycle?: BillRecurring
  reminderDaysBefore?: number
  status?: BillStatus
  notes?: string
}

export interface BillStats {
  totalMonthlyAmount: number
  totalBillsCount: number
  paidAmount: number
  paidCount: number
  unpaidAmount: number
  unpaidCount: number
  overdueCount: number
  overdueAmount: number
  dueSoonCount: number
  dueSoonAmount: number
}

export interface BillReminder {
  bill: BillItem
  type: 'overdue' | 'due_today' | 'due_soon'
  daysDiff: number
  message: string
}

type BackendPeriod = {
  period_key: string
  period_label: string
  period_date: string
  paid: boolean
  partially_paid?: boolean
  billed_amount?: number | string
  paid_amount?: number | string
  remaining_amount?: number | string
  payment_date?: string
  is_future?: boolean
  is_next_payable?: boolean
  payments?: Array<{
    bill_payment_id: number
    period_key: string
    payment_date: string
    amount: number | string
    billed_amount?: number | string
    payment_method: string
    reference_no?: string
    notes?: string
    created_at?: string
  }>
}

type BackendBill = {
  bill_id: number
  company_id?: number
  company?: string
  bill_name: string
  amount: number | string
  latest_amount?: number | string
  recurring: 'daily' | 'monthly' | 'yearly'
  due_date: string
  due_date_reminder: number
  notes?: string
  status: 'unpaid' | 'paid' | 'overdue' | 'due soon' | 'partially paid'
  created_at?: string
  updated_at?: string
  payments?: Array<{
    bill_payment_id: number
    period_key: string
    payment_date: string
    amount: number | string
    billed_amount?: number | string
    payment_method: string
    reference_no?: string
    notes?: string
    created_at?: string
  }>
  next_period_key?: string
  next_period_label?: string
  next_period_date?: string
  periods?: BackendPeriod[]
}

// ==========================================
// CLIENT-SIDE VALIDATIONS
// ==========================================

export function validateBillAmount(amount: number | string): string | null {
  const str = String(amount).trim()
  if (!str) return 'Amount is required.'
  if (/^0\d+/.test(str)) {
    return 'Amount cannot start with leading zero (e.g., 01000).'
  }
  const num = Number(str)
  if (isNaN(num) || num <= 0) {
    return 'Amount must be greater than ₱0.00.'
  }
  return null
}

export function validateBillInput(input: Partial<NewBillInput>): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  if (!input.billerName || !input.billerName.trim()) {
    errors.billerName = 'Biller name is required.'
  }

  if (!input.company || !input.company.trim() || input.company === 'All Companies') {
    errors.company = 'Assigned company is required.'
  }

  if (input.amount !== undefined && input.amount !== null && input.amount !== 0) {
    const amountErr = validateBillAmount(input.amount)
    if (amountErr) {
      errors.amount = amountErr
    }
  }

  if (!input.dueDate) {
    errors.dueDate = 'Due date is required.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

export function validatePaymentInput(payment: {
  amount: number | string
  paymentDate: string
  paymentMethod: string
  remainingAmount?: number
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  const amountErr = validateBillAmount(payment.amount)
  if (amountErr) {
    errors.amount = amountErr
  } else if (
    payment.remainingAmount !== undefined &&
    payment.remainingAmount > 0 &&
    Number(payment.amount) > payment.remainingAmount + 0.01
  ) {
    errors.amount = `Amount cannot exceed remaining balance of ₱${payment.remainingAmount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
    })}.`
  }

  if (!payment.paymentDate) {
    errors.paymentDate = 'Payment date is required.'
  }

  if (!payment.paymentMethod || !payment.paymentMethod.trim()) {
    errors.paymentMethod = 'Payment method is required.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

// ==========================================
// BACKEND SERIALIZATION HELPERS
// ==========================================

function emitBillsNotificationRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mct:notifications-updated'))
  }
}

function backendHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function getBackendError(response: Response, defaultFallback = 'Server request failed. Please try again.'): Promise<Error> {
  try {
    const data = await response.json()
    const friendly = formatUserFriendlyErrorMessage(
      data?.detail || { status: response.status },
      defaultFallback
    )
    return new Error(friendly)
  } catch {
    // Ignore JSON parse failure
  }
  const friendly = formatUserFriendlyErrorMessage({ status: response.status }, defaultFallback)
  return new Error(friendly)
}

function mapStatus(status: string): BillStatus {
  const s = (status || '').toLowerCase().trim()
  if (s === 'paid') return 'Paid'
  if (s === 'overdue') return 'Overdue'
  if (s === 'due soon') return 'Due Soon'
  if (s === 'partially paid') return 'Partially Paid'
  return 'Unpaid'
}

function mapBackendBill(data: BackendBill): BillItem {
  const recurring: BillRecurring =
    data.recurring === 'daily' ? 'Daily' : data.recurring === 'yearly' ? 'Yearly' : 'Monthly'

  const payments: BillPaymentRecord[] = (data.payments || []).map((payment) => ({
    id: String(payment.bill_payment_id),
    periodKey: payment.period_key,
    paymentDate: payment.payment_date,
    amount: Number(payment.amount) || 0,
    billedAmount: payment.billed_amount !== undefined && payment.billed_amount !== null ? Number(payment.billed_amount) : undefined,
    paymentMethod: payment.payment_method,
    refNo: payment.reference_no,
    referenceNo: payment.reference_no,
    notes: payment.notes,
    createdAt: payment.created_at || payment.payment_date,
  }))

  const periods: BillPaymentPeriod[] = (data.periods || []).map((p) => ({
    key: p.period_key,
    label: p.period_label,
    paid: p.paid,
    partiallyPaid: p.partially_paid,
    billedAmount: p.billed_amount !== undefined && p.billed_amount !== null ? Number(p.billed_amount) : undefined,
    paidAmount: Number(p.paid_amount) || 0,
    remainingAmount: Number(p.remaining_amount) || 0,
    paymentDate: p.payment_date,
    periodDate: p.period_date,
    isFuture: p.is_future,
    isNextPayable: p.is_next_payable,
    payments: (p.payments || []).map((pay) => ({
      id: String(pay.bill_payment_id),
      periodKey: pay.period_key,
      paymentDate: pay.payment_date,
      amount: Number(pay.amount) || 0,
      billedAmount: pay.billed_amount !== undefined && pay.billed_amount !== null ? Number(pay.billed_amount) : undefined,
      paymentMethod: pay.payment_method,
      refNo: pay.reference_no,
      referenceNo: pay.reference_no,
      notes: pay.notes,
      createdAt: pay.created_at || pay.payment_date,
    })),
  }))

  const latestPayment = payments[0]

  let dueDay = 15
  if (data.due_date) {
    const parts = data.due_date.split('-')
    if (parts.length === 3) dueDay = parseInt(parts[2], 10) || 15
  }

  return {
    id: String(data.bill_id),
    billerName: data.bill_name,
    company: data.company || '',
    amount: Number(data.amount) || 0,
    latestAmount: data.latest_amount !== undefined && data.latest_amount !== null ? Number(data.latest_amount) : undefined,
    dueDate: data.next_period_date || data.due_date,
    dueDayOfMonth: dueDay,
    initialDueDate: data.due_date,
    billingCycle: recurring,
    reminderDaysBefore: data.due_date_reminder ?? 3,
    status: mapStatus(data.status),
    notes: data.notes || '',
    lastPaidDate: latestPayment?.paymentDate,
    lastPaymentMethod: latestPayment?.paymentMethod,
    payments,
    periods,
    nextPeriodKey: data.next_period_key,
    nextPeriodLabel: data.next_period_label,
    nextPeriodDate: data.next_period_date,
    createdAt: data.created_at || new Date().toISOString(),
    updatedAt: data.updated_at || new Date().toISOString(),
  }
}

// ==========================================
// PERIOD & SCHEDULE OPTIONS HELPER
// ==========================================

export function getBillPaymentOptions(
  bill: BillItem,
  _referenceDate?: Date
): { periods: BillPaymentPeriod[]; nextPayable: BillPaymentPeriod } {
  if (bill.periods && bill.periods.length > 0) {
    const nextPayable =
      bill.periods.find((p) => p.isNextPayable) ||
      bill.periods.find((p) => !p.paid) ||
      bill.periods[0]

    return {
      periods: bill.periods,
      nextPayable: nextPayable || {
        key: bill.dueDate?.slice(0, 7) || 'current',
        label: 'Current Period',
        paid: false,
        periodDate: bill.dueDate,
        paidAmount: 0,
        remainingAmount: bill.latestAmount || bill.amount,
      },
    }
  }

  // Fallback period if periods array is not provided
  const key = bill.nextPeriodKey || bill.dueDate?.slice(0, 7) || 'current'
  const fallbackPeriod: BillPaymentPeriod = {
    key,
    label: bill.nextPeriodLabel || 'Current Period',
    paid: bill.status === 'Paid',
    partiallyPaid: bill.status === 'Partially Paid',
    paidAmount: 0,
    remainingAmount: bill.latestAmount || bill.amount,
    periodDate: bill.nextPeriodDate || bill.dueDate,
    isNextPayable: true,
  }
  return {
    periods: [fallbackPeriod],
    nextPayable: fallbackPeriod,
  }
}

// ==========================================
// BILLS SERVICE (API CLIENT)
// ==========================================

export const billsService = {
  async getBills(companyFilter?: string): Promise<BillItem[]> {
    try {
      const query =
        companyFilter && companyFilter !== 'All Companies'
          ? `?company_name=${encodeURIComponent(companyFilter)}`
          : ''
      const response = await fetch(`/api/v1/bills${query}`, { headers: backendHeaders() })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to load bills. Please try again.')
      }
      const data: BackendBill[] = await response.json()
      return data.map(mapBackendBill)
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to load bills. Please try again.'))
    }
  },

  async getBillById(id: string): Promise<BillItem> {
    try {
      const response = await fetch(`/api/v1/bills/${encodeURIComponent(id)}`, {
        headers: backendHeaders(),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to retrieve bill details. Please try again.')
      }
      return mapBackendBill(await response.json())
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to retrieve bill details. Please try again.'))
    }
  },

  async createBill(input: NewBillInput): Promise<BillItem> {
    const validation = validateBillInput(input)
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0]
      throw new Error(firstError)
    }

    const payload = {
      company: input.company,
      bill_name: input.billerName.trim(),
      amount: input.amount !== undefined ? Number(input.amount) : 0,
      recurring: (input.billingCycle || 'Monthly').toLowerCase(),
      due_date: input.dueDate,
      due_date_reminder: input.reminderDaysBefore ?? 3,
      notes: input.notes?.trim() || null,
    }

    try {
      const response = await fetch('/api/v1/bills', {
        method: 'POST',
        headers: backendHeaders(),
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to create bill record. Please try again.')
      }
      const created = mapBackendBill(await response.json())
      emitBillsNotificationRefresh()
      return created
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to create bill record. Please try again.'))
    }
  },

  async updateBill(id: string, input: UpdateBillInput): Promise<BillItem> {
    if (input.amount !== undefined && input.amount > 0) {
      const err = validateBillAmount(input.amount)
      if (err) throw new Error(err)
    }

    const payload: Record<string, unknown> = {}
    if (input.billerName !== undefined) payload.bill_name = input.billerName.trim()
    if (input.company !== undefined) payload.company = input.company.trim()
    if (input.amount !== undefined) payload.amount = Number(input.amount)
    if (input.billingCycle !== undefined) payload.recurring = input.billingCycle.toLowerCase()
    if (input.dueDate !== undefined) payload.due_date = input.dueDate
    if (input.reminderDaysBefore !== undefined) payload.due_date_reminder = input.reminderDaysBefore
    if (input.notes !== undefined) payload.notes = input.notes?.trim() || null

    try {
      const response = await fetch(`/api/v1/bills/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: backendHeaders(),
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to update bill record. Please try again.')
      }
      const updated = mapBackendBill(await response.json())
      emitBillsNotificationRefresh()
      return updated
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to update bill record. Please try again.'))
    }
  },

  async deleteBill(id: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/v1/bills/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: backendHeaders(),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to delete bill record. Please try again.')
      }
      emitBillsNotificationRefresh()
      return true
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to delete bill record. Please try again.'))
    }
  },

  async recordPayment(
    id: string,
    payment: {
      amount: number
      paymentDate: string
      periodKey?: string
      paymentMethod: string
      refNo?: string
      referenceNo?: string
      notes?: string
      billedAmount?: number
      remainingAmount?: number
    }
  ): Promise<BillItem> {
    const validation = validatePaymentInput(payment)
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0]
      throw new Error(firstError)
    }

    try {
      const response = await fetch(`/api/v1/bills/${encodeURIComponent(id)}/payments`, {
        method: 'POST',
        headers: backendHeaders(),
        body: JSON.stringify({
          period_key: payment.periodKey || null,
          payment_date: payment.paymentDate,
          amount: Number(payment.amount),
          billed_amount: payment.billedAmount !== undefined ? Number(payment.billedAmount) : null,
          payment_method: payment.paymentMethod.trim(),
          reference_no: (payment.referenceNo || payment.refNo)?.trim() || null,
          notes: payment.notes?.trim() || null,
        }),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to record payment. Please try again.')
      }
      const recorded = mapBackendBill(await response.json())
      emitBillsNotificationRefresh()
      return recorded
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to record payment. Please try again.'))
    }
  },

  async deletePayment(id: string, paymentId: string): Promise<BillItem> {
    try {
      const response = await fetch(
        `/api/v1/bills/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`,
        {
          method: 'DELETE',
          headers: backendHeaders(),
        }
      )
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to delete payment record. Please try again.')
      }
      const afterDelete = mapBackendBill(await response.json())
      emitBillsNotificationRefresh()
      return afterDelete
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to delete payment record. Please try again.'))
    }
  },

  async markAsUnpaid(id: string): Promise<BillItem> {
    try {
      const response = await fetch(`/api/v1/bills/${encodeURIComponent(id)}/latest-payment`, {
        method: 'DELETE',
        headers: backendHeaders(),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to reset bill status. Please try again.')
      }
      const reset = mapBackendBill(await response.json())
      emitBillsNotificationRefresh()
      return reset
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to reset bill status. Please try again.'))
    }
  },

  async getSchedule(id: string, asOf?: string) {
    try {
      const query = asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''
      const response = await fetch(`/api/v1/bills/${encodeURIComponent(id)}/schedule${query}`, {
        headers: backendHeaders(),
      })
      if (!response.ok) {
        throw await getBackendError(response, 'Unable to load bill schedule. Please try again.')
      }
      return response.json()
    } catch (err: any) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to load bill schedule. Please try again.'))
    }
  },

  getStats(bills: BillItem[]): BillStats {
    let totalMonthlyAmount = 0
    let paidAmount = 0
    let paidCount = 0
    let unpaidAmount = 0
    let unpaidCount = 0
    let overdueCount = 0
    let overdueAmount = 0
    let dueSoonCount = 0
    let dueSoonAmount = 0

    bills.forEach((b) => {
      const amt = b.latestAmount || b.amount || 0
      totalMonthlyAmount += amt
      if (b.status === 'Paid') {
        paidAmount += amt
        paidCount += 1
      } else {
        unpaidAmount += amt
        unpaidCount += 1
        if (b.status === 'Overdue') {
          overdueCount += 1
          overdueAmount += amt
        } else if (b.status === 'Due Soon') {
          dueSoonCount += 1
          dueSoonAmount += amt
        }
      }
    })

    return {
      totalMonthlyAmount,
      totalBillsCount: bills.length,
      paidAmount,
      paidCount,
      unpaidAmount,
      unpaidCount,
      overdueCount,
      overdueAmount,
      dueSoonCount,
      dueSoonAmount,
    }
  },

  getReminders(bills: BillItem[], todayStr = new Date().toISOString().slice(0, 10)): BillReminder[] {
    const reminders: BillReminder[] = []
    const todayObj = new Date(`${todayStr}T00:00:00`)

    bills.forEach((b) => {
      const options = getBillPaymentOptions(b)
      const nextDue = options.nextPayable?.periodDate || b.dueDate
      if (!nextDue) return

      const dueObj = new Date(`${nextDue}T00:00:00`)
      const diffTime = dueObj.getTime() - todayObj.getTime()
      const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      if (daysDiff < 0) {
        reminders.push({
          bill: b,
          type: 'overdue',
          daysDiff: Math.abs(daysDiff),
          message: `${b.billerName} (${b.company}) was due on ${nextDue} (${Math.abs(daysDiff)} day${
            Math.abs(daysDiff) > 1 ? 's' : ''
          } overdue)`,
        })
      } else if (daysDiff === 0) {
        reminders.push({
          bill: b,
          type: 'due_today',
          daysDiff: 0,
          message: `${b.billerName} (${b.company}) is due TODAY!`,
        })
      } else if (daysDiff <= (b.reminderDaysBefore || 3)) {
        reminders.push({
          bill: b,
          type: 'due_soon',
          daysDiff,
          message: `${b.billerName} (${b.company}) is due in ${daysDiff} day${
            daysDiff > 1 ? 's' : ''
          } (${nextDue})`,
        })
      }
    })

    const typePriority: Record<string, number> = {
      overdue: 1,
      due_today: 2,
      due_soon: 3,
    }

    return reminders.sort((a, b) => {
      const priorityDiff = (typePriority[a.type] ?? 99) - (typePriority[b.type] ?? 99)
      if (priorityDiff !== 0) return priorityDiff

      // If both are overdue: highest overdue days first (most overdue needs attention the most)
      if (a.type === 'overdue' && b.type === 'overdue') {
        if (b.daysDiff !== a.daysDiff) {
          return b.daysDiff - a.daysDiff
        }
        const amtA = a.bill.latestAmount || a.bill.amount || 0
        const amtB = b.bill.latestAmount || b.bill.amount || 0
        return amtB - amtA
      }

      // If both are due today: highest amount first
      if (a.type === 'due_today' && b.type === 'due_today') {
        const amtA = a.bill.latestAmount || a.bill.amount || 0
        const amtB = b.bill.latestAmount || b.bill.amount || 0
        return amtB - amtA
      }

      // If both are due soon: closest due date first (e.g., 1 day away before 3 days away)
      if (a.daysDiff !== b.daysDiff) {
        return a.daysDiff - b.daysDiff
      }
      const amtA = a.bill.latestAmount || a.bill.amount || 0
      const amtB = b.bill.latestAmount || b.bill.amount || 0
      return amtB - amtA
    })
  },

  exportCsv(bills: BillItem[], filename = 'monthly_bills_report.csv') {
    const headers = [
      'Biller Name',
      'Company',
      'Amount',
      'Due Date',
      'Billing Cycle',
      'Status',
      'Notes',
    ]

    const rows = bills.map((b) => [
      `"${(b.billerName || '').replace(/"/g, '""')}"`,
      `"${(b.company || '').replace(/"/g, '""')}"`,
      b.latestAmount || b.amount,
      b.dueDate,
      b.billingCycle,
      b.status,
      `"${(b.notes || '').replace(/"/g, '""')}"`,
    ])

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  },
}
