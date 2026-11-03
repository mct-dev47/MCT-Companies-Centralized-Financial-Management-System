/**
 * Tenant lease repeat schedule (spec 0015).
 *
 * Pure functions only: no storage, no network, no React. "Today" is always passed in as a
 * YYYY-MM-DD string so results are repeatable and easy to test.
 *
 * The schedule is never stored. It is worked out from the lease settings (repeat, first due date,
 * lease end date, late penalty, rent) and the payment records, each of which carries the period
 * number it starts from (`periodIndex`).
 */

export type LeaseRepeat = 'None' | 'Daily' | 'Monthly' | 'Quarterly' | 'Annually'

export const REPEAT_OPTIONS: LeaseRepeat[] = ['None', 'Daily', 'Monthly', 'Quarterly', 'Annually']

/** Hard cap on the number of periods a single lease can generate. */
export const MAX_PERIODS = 1000

const EPSILON = 0.005

export interface SchedulePayment {
  id: string
  date: string // YYYY-MM-DD, the date the money was received
  amount: number
  status?: string // 'Paid' | 'Missed' | undefined
  periodIndex?: number // 1 based starting period
  timestamp?: string
}

export interface ScheduleLease {
  repeat?: LeaseRepeat
  dueDate: string // First Due Date when repeating
  leaseEndDate?: string
  rentAmount: number
  penaltyRate?: number // percent, blank or missing means no penalty
  totalAmountPayable: number
  amountPaid: number
  remainingBalance: number
  dailyPayments: SchedulePayment[]
}

export type PeriodStatus = 'Paid' | 'Advance Paid' | 'Partially Paid' | 'Missed' | 'Unpaid'

export interface SchedulePeriod {
  index: number // 1 based
  label: string // Month 3, Quarter 1, Year 2, Day 5
  dueDate: string
  baseAmount: number
  penalty: number
  amountDue: number
  directPaid: number
  advancePaid: number
  paid: number
  remaining: number
  status: PeriodStatus
  isOverdue: boolean
}

export interface LeaseFinancials {
  totalDue: number
  amountPaid: number
  remaining: number
  nextPeriod: SchedulePeriod | null
  periodCount: number
  periodsPaid: number
  periods: SchedulePeriod[]
}

export interface PaymentAllocationLine {
  index: number
  label: string
  amount: number
  kind: 'direct' | 'advance'
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isRepeating(lease: { repeat?: LeaseRepeat } | null | undefined): boolean {
  return !!lease && !!lease.repeat && lease.repeat !== 'None'
}

interface Ymd {
  y: number
  m: number // 1 to 12
  d: number
}

function parseYmd(value: string | undefined | null): Ymd | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return { y, m, d }
}

function formatYmd(parts: Ymd): string {
  return `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function toUtcDay(parts: Ymd): number {
  return Math.floor(Date.UTC(parts.y, parts.m - 1, parts.d) / 86400000)
}

/**
 * The n-th due date counted from the anchor (n = 0 is the anchor itself).
 * The day of the month stays the same as the anchor; when a month is too short it falls on the
 * last day of that month (Jan 31 + 1 month = Feb 28 or 29, but + 2 months = Mar 31).
 * Returns an empty string for an invalid anchor or frequency of 'None'.
 */
export function addPeriodClamped(anchorDate: string, frequency: LeaseRepeat, n: number): string {
  const anchor = parseYmd(anchorDate)
  if (!anchor || frequency === 'None' || n < 0) return ''

  if (frequency === 'Daily') {
    const ms = Date.UTC(anchor.y, anchor.m - 1, anchor.d) + n * 86400000
    const dt = new Date(ms)
    return formatYmd({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() })
  }

  const monthStep = frequency === 'Monthly' ? 1 : frequency === 'Quarterly' ? 3 : 12
  const totalMonths = anchor.y * 12 + (anchor.m - 1) + n * monthStep
  const y = Math.floor(totalMonths / 12)
  const m = (totalMonths % 12) + 1
  const d = Math.min(anchor.d, daysInMonth(y, m))
  return formatYmd({ y, m, d })
}

/**
 * Number of due dates from the first due date up to and including the end date.
 * Returns 0 when dates are invalid or the end is before the first due date. Never returns more
 * than MAX_PERIODS + 1, so callers can detect "too many" without looping for ever.
 */
export function countPeriods(firstDue: string, endDate: string, frequency: LeaseRepeat): number {
  const first = parseYmd(firstDue)
  const end = parseYmd(endDate)
  if (!first || !end || frequency === 'None') return 0
  if (toUtcDay(end) < toUtcDay(first)) return 0

  if (frequency === 'Daily') {
    return Math.min(MAX_PERIODS + 1, toUtcDay(end) - toUtcDay(first) + 1)
  }

  let count = 0
  while (count <= MAX_PERIODS) {
    const due = addPeriodClamped(firstDue, frequency, count)
    if (!due || due > endDate) break
    count++
  }
  return count
}

export function periodUnit(frequency: LeaseRepeat): string {
  switch (frequency) {
    case 'Daily':
      return 'Day'
    case 'Monthly':
      return 'Month'
    case 'Quarterly':
      return 'Quarter'
    case 'Annually':
      return 'Year'
    default:
      return 'Period'
  }
}

export function periodLabel(frequency: LeaseRepeat, index: number): string {
  return `${periodUnit(frequency)} ${index}`
}

/**
 * Automatically calculate first due date and default lease end date based on repeat mode.
 * - Daily: first due date = tomorrow (+1 day), default 30-day lease end date.
 * - Monthly: first due date = 1 month after today, default 12-month lease end date.
 * - Quarterly: first due date = 1 quarter (3 months) after today, default 4-quarter lease end date.
 * - Annually: first due date = 1 year after today, default 3-year lease end date.
 * - None: first due date = base date, lease end date = empty string.
 */
export function getDefaultDatesForRepeat(
  repeat: LeaseRepeat,
  baseDateStr?: string
): { dueDate: string; leaseEndDate: string } {
  const base = baseDateStr || formatYmd({
    y: new Date().getFullYear(),
    m: new Date().getMonth() + 1,
    d: new Date().getDate(),
  })
  if (repeat === 'Daily') {
    const firstDue = addPeriodClamped(base, 'Daily', 1)
    const end = addPeriodClamped(firstDue, 'Daily', 29)
    return { dueDate: firstDue, leaseEndDate: end }
  }
  if (repeat === 'Monthly') {
    const firstDue = addPeriodClamped(base, 'Monthly', 1)
    const end = addPeriodClamped(firstDue, 'Monthly', 11)
    return { dueDate: firstDue, leaseEndDate: end }
  }
  if (repeat === 'Quarterly') {
    const firstDue = addPeriodClamped(base, 'Quarterly', 1)
    const end = addPeriodClamped(firstDue, 'Quarterly', 3)
    return { dueDate: firstDue, leaseEndDate: end }
  }
  if (repeat === 'Annually') {
    const firstDue = addPeriodClamped(base, 'Annually', 1)
    const end = addPeriodClamped(firstDue, 'Annually', 2)
    return { dueDate: firstDue, leaseEndDate: end }
  }
  return { dueDate: base, leaseEndDate: '' }
}

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Google Calendar style summary, for example "Repeats monthly on the 15th, 12 payments". */
export function describeRepeat(frequency: LeaseRepeat, firstDue: string, periodCount: number): string {
  if (frequency === 'None') return 'Does not repeat'
  const first = parseYmd(firstDue)
  const payments = `${periodCount} ${periodCount === 1 ? 'payment' : 'payments'}`
  if (!first) return `Repeats ${frequency.toLowerCase()}, ${payments}`
  switch (frequency) {
    case 'Daily':
      return `Repeats daily, ${payments}`
    case 'Monthly':
      return `Repeats monthly on the ${ordinal(first.d)}, ${payments}`
    case 'Quarterly':
      return `Repeats every 3 months on the ${ordinal(first.d)}, ${payments}`
    case 'Annually':
      return `Repeats yearly on ${MONTH_NAMES[first.m - 1]} ${first.d}, ${payments}`
    default:
      return payments
  }
}

// ---------------------------------------------------------------------------------------------
// Validation (AC-4)
// ---------------------------------------------------------------------------------------------

export interface RepeatSettingsInput {
  repeat: LeaseRepeat
  contractDate: string
  dueDate: string // First Due Date
  leaseEndDate: string
  penaltyRate: string // raw form text, blank means none
}

/** Returns a map of form field name to message. Empty map means valid. */
export function validateRepeatSettings(input: RepeatSettingsInput): Record<string, string> {
  const errors: Record<string, string> = {}
  if (input.repeat === 'None') return errors

  const first = parseYmd(input.dueDate)
  const end = parseYmd(input.leaseEndDate)
  const contract = parseYmd(input.contractDate)

  if (!first) {
    errors.dueDate = 'First Due Date is required.'
  } else if (contract && toUtcDay(first) < toUtcDay(contract)) {
    errors.dueDate = 'First Due Date cannot be before the Date Contracted.'
  }

  if (!end) {
    errors.leaseEndDate = 'Lease End Date is required for a repeating lease.'
  } else if (first && toUtcDay(end) < toUtcDay(first)) {
    errors.leaseEndDate = 'Lease End Date must be on or after the First Due Date.'
  } else if (first) {
    const count = countPeriods(input.dueDate, input.leaseEndDate, input.repeat)
    if (count < 1) {
      errors.leaseEndDate = 'The schedule needs at least 1 payment.'
    } else if (count > MAX_PERIODS) {
      errors.leaseEndDate = `The schedule cannot have more than ${MAX_PERIODS} payments. Move the Lease End Date closer.`
    }
  }

  const rawPenalty = (input.penaltyRate || '').trim()
  if (rawPenalty !== '') {
    const rate = Number(rawPenalty)
    if (!isFinite(rate) || rate < 0 || rate > 100) {
      errors.penaltyRate = 'Late Penalty must be blank or a number from 0 to 100.'
    }
  }

  return errors
}

// ---------------------------------------------------------------------------------------------
// Schedule and allocation (AC-3, AC-9 to AC-12)
// ---------------------------------------------------------------------------------------------

function parsePenaltyRate(value: number | undefined): number {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) return 0
  return Math.min(100, value)
}

/** Payment records that carry money (not Missed marks), in the order they are replayed. */
function moneyPayments(payments: SchedulePayment[]): SchedulePayment[] {
  return (payments || [])
    .filter((p) => p.status !== 'Missed' && (p.amount || 0) > 0)
    .slice()
    .sort((a, b) => {
      const byDate = (a.date || '').localeCompare(b.date || '')
      if (byDate !== 0) return byDate
      return (a.timestamp || '').localeCompare(b.timestamp || '')
    })
}

interface Working {
  index: number
  dueDate: string
  base: number
  penaltyAmount: number // what the penalty would be if it applies
  baseCovered: number
  baseOnTime: number
  penaltyPaid: number
  direct: number
  advance: number
}

/**
 * Builds the schedule for a repeating lease. Returns [] for a lease that does not repeat or whose
 * settings are not valid.
 *
 * Allocation rule: payments are replayed in order of payment date then timestamp. Each payment
 * fills its starting period (rent first, then penalty) and any extra flows forward into the
 * following periods in order. Nothing goes to periods before the starting period.
 */
export function buildSchedule(lease: ScheduleLease, today: string, extraPayments: SchedulePayment[] = []): SchedulePeriod[] {
  if (!isRepeating(lease)) return []
  const repeat = lease.repeat as LeaseRepeat
  const count = Math.min(MAX_PERIODS, countPeriods(lease.dueDate, lease.leaseEndDate || '', repeat))
  if (count < 1) return []

  const rate = parsePenaltyRate(lease.penaltyRate)
  const base = round2(lease.rentAmount)
  const penaltyAmount = rate > 0 ? round2((base * rate) / 100) : 0

  const work: Working[] = []
  for (let i = 1; i <= count; i++) {
    work.push({
      index: i,
      dueDate: addPeriodClamped(lease.dueDate, repeat, i - 1),
      base,
      penaltyAmount,
      baseCovered: 0,
      baseOnTime: 0,
      penaltyPaid: 0,
      direct: 0,
      advance: 0,
    })
  }

  const replay = moneyPayments([...(lease.dailyPayments || []), ...extraPayments])
  for (const payment of replay) {
    let left = round2(payment.amount)
    const startIndex = Math.min(count, Math.max(1, Math.floor(payment.periodIndex || 1)))
    for (let i = startIndex - 1; i < count && left > EPSILON; i++) {
      const w = work[i]
      const isStart = i === startIndex - 1

      const baseRoom = round2(w.base - w.baseCovered)
      if (baseRoom > EPSILON) {
        const take = Math.min(left, baseRoom)
        w.baseCovered = round2(w.baseCovered + take)
        if (payment.date <= w.dueDate) w.baseOnTime = round2(w.baseOnTime + take)
        if (isStart) w.direct = round2(w.direct + take)
        else w.advance = round2(w.advance + take)
        left = round2(left - take)
      }

      if (left > EPSILON && w.penaltyAmount > 0 && payment.date > w.dueDate && today > w.dueDate && w.baseOnTime < w.base - EPSILON) {
        const penaltyRoom = round2(w.penaltyAmount - w.penaltyPaid)
        if (penaltyRoom > EPSILON) {
          const take = Math.min(left, penaltyRoom)
          w.penaltyPaid = round2(w.penaltyPaid + take)
          if (isStart) w.direct = round2(w.direct + take)
          else w.advance = round2(w.advance + take)
          left = round2(left - take)
        }
      }
    }
  }

  const missedPeriods = new Set<number>()
  if (repeat === 'Daily') {
    for (const p of lease.dailyPayments || []) {
      if (p.status === 'Missed' && p.periodIndex) missedPeriods.add(Math.floor(p.periodIndex))
    }
  }

  return work.map((w) => {
    const penaltyCharged =
      w.penaltyAmount > 0 && today > w.dueDate && w.baseOnTime < w.base - EPSILON ? w.penaltyAmount : 0
    const amountDue = round2(w.base + penaltyCharged)
    const paid = round2(w.baseCovered + w.penaltyPaid)
    const remaining = Math.max(0, round2(amountDue - paid))

    let status: PeriodStatus
    if (remaining <= EPSILON) {
      status = w.direct > EPSILON ? 'Paid' : 'Advance Paid'
    } else if (paid > EPSILON) {
      status = 'Partially Paid'
    } else if (repeat === 'Daily') {
      status = missedPeriods.has(w.index) ? 'Missed' : 'Unpaid'
    } else {
      status = today > w.dueDate ? 'Missed' : 'Unpaid'
    }

    return {
      index: w.index,
      label: periodLabel(repeat, w.index),
      dueDate: w.dueDate,
      baseAmount: w.base,
      penalty: penaltyCharged,
      amountDue,
      directPaid: w.direct,
      advancePaid: w.advance,
      paid,
      remaining,
      status,
      isOverdue: remaining > EPSILON && today > w.dueDate,
    }
  })
}

/** Total payment money in the records, ignoring Missed marks. */
export function sumRecordedPayments(payments: SchedulePayment[]): number {
  return round2(moneyPayments(payments).reduce((sum, p) => sum + p.amount, 0))
}

/**
 * Lease totals. For a lease that does not repeat this returns the stored values unchanged
 * (AC-6). For a repeating lease everything comes from the schedule (AC-13).
 */
export function getLeaseFinancials(lease: ScheduleLease, today: string): LeaseFinancials {
  if (!isRepeating(lease)) {
    return {
      totalDue: lease.totalAmountPayable,
      amountPaid: lease.amountPaid,
      remaining: lease.remainingBalance,
      nextPeriod: null,
      periodCount: 0,
      periodsPaid: 0,
      periods: [],
    }
  }
  const periods = buildSchedule(lease, today)
  if (periods.length === 0) {
    return {
      totalDue: lease.totalAmountPayable,
      amountPaid: lease.amountPaid,
      remaining: lease.remainingBalance,
      nextPeriod: null,
      periodCount: 0,
      periodsPaid: 0,
      periods,
    }
  }
  const totalDue = round2(periods.reduce((s, p) => s + p.amountDue, 0))
  const amountPaid = round2(periods.reduce((s, p) => s + p.paid, 0))
  const remaining = Math.max(0, round2(totalDue - amountPaid))
  return {
    totalDue,
    amountPaid,
    remaining,
    nextPeriod: periods.find((p) => p.remaining > EPSILON) || null,
    periodCount: periods.length,
    periodsPaid: periods.filter((p) => p.remaining <= EPSILON).length,
    periods,
  }
}

/**
 * Shows where a payment would land if it were saved now (AC-9, AC-10): one line per period it
 * touches, marked as direct (its own starting period) or advance (flowed forward).
 */
export function previewPayment(
  lease: ScheduleLease,
  today: string,
  startPeriod: number,
  amount: number,
  paymentDate: string
): PaymentAllocationLine[] {
  if (!isRepeating(lease) || !(amount > 0)) return []
  const before = buildSchedule(lease, today)
  const after = buildSchedule(lease, today, [
    {
      id: '__preview__',
      date: paymentDate,
      amount,
      periodIndex: startPeriod,
      status: 'Paid',
      timestamp: '9999-12-31T23:59:59Z',
    },
  ])
  const lines: PaymentAllocationLine[] = []
  for (let i = 0; i < after.length; i++) {
    const delta = round2(after[i].paid - (before[i]?.paid || 0))
    if (delta > EPSILON) {
      lines.push({
        index: after[i].index,
        label: after[i].label,
        amount: delta,
        kind: after[i].index === startPeriod ? 'direct' : 'advance',
      })
    }
  }
  return lines
}

// ---------------------------------------------------------------------------------------------
// Edit rules (AC-14)
// ---------------------------------------------------------------------------------------------

export interface EditSettingsInput {
  repeat: LeaseRepeat
  dueDate: string
  leaseEndDate: string
  rentAmount: number
  penaltyRate: number | undefined
}

/** True when a repeating lease already has records tied to its periods (money or Missed marks). */
export function hasPeriodRecords(lease: ScheduleLease): boolean {
  if (!isRepeating(lease)) return false
  return (lease.dailyPayments || []).some((p) => !!p.periodIndex)
}

/**
 * Checks proposed new settings against the payments already on the lease.
 * Returns field name to message. Empty map means the change is allowed.
 */
export function validateEditAgainstPayments(
  original: ScheduleLease,
  next: EditSettingsInput,
  today: string
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (hasPeriodRecords(original)) {
    if (next.repeat !== original.repeat) {
      errors.repeat = 'Repeat cannot be changed because payments are already recorded against its periods.'
    }
    if (next.dueDate !== original.dueDate) {
      errors.dueDate = 'First Due Date cannot be changed because payments are already recorded against its periods.'
    }
  }

  if (next.repeat === 'None') return errors

  const candidate: ScheduleLease = {
    ...original,
    repeat: next.repeat,
    dueDate: next.dueDate,
    leaseEndDate: next.leaseEndDate,
    rentAmount: next.rentAmount,
    penaltyRate: next.penaltyRate,
  }
  const newCount = Math.min(MAX_PERIODS, countPeriods(next.dueDate, next.leaseEndDate, next.repeat))
  if (newCount < 1) return errors

  const records = moneyPayments(original.dailyPayments)
  const highestStart = records.reduce((max, p) => Math.max(max, Math.floor(p.periodIndex || 1)), 0)

  if (highestStart > newCount) {
    errors.leaseEndDate = `Lease End Date cannot be moved earlier than ${periodLabel(next.repeat, highestStart)}, which already has a payment.`
    return errors
  }

  // Money applied to a period that the new End Date would remove (advance credit counts).
  const originalPeriods = isRepeating(original) ? buildSchedule(original, today) : []
  const originalApplied = originalPeriods.reduce((max, p) => (p.paid > EPSILON ? Math.max(max, p.index) : max), 0)
  if (originalApplied > newCount) {
    errors.leaseEndDate = `Lease End Date cannot be moved earlier than ${periodLabel(next.repeat, originalApplied)}, which already has money applied.`
    return errors
  }

  // Rebuild with the new settings: any money that no longer fits means the new total due is too low.
  const periods = buildSchedule(candidate, today)
  const recorded = sumRecordedPayments(original.dailyPayments)
  const placed = round2(periods.reduce((s, p) => s + p.paid, 0))
  if (recorded - placed > EPSILON) {
    errors.rentAmount =
      'The recorded payments are more than the new total due. Increase the Rent Amount or move the Lease End Date later.'
  }

  return errors
}
