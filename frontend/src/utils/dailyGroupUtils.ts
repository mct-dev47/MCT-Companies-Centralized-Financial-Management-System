import { normalizeDateToYYYYMMDD, formatDisplayDate } from './dateUtils'

export interface DailyGroupSummary<T> {
  date: string // ISO date YYYY-MM-DD
  formattedDate: string // e.g. "Oct 15, 2026"
  dayOfWeek: string // e.g. "Thursday"
  transactionCount: number
  grossTotal: number
  realizedCash: number
  auditStatus: 'All Verified' | 'Pending Audit' | 'Discrepancy'
  items: T[]
}

/**
 * Derives the rolled up audit status badge for a daily group of transactions.
 * If any transaction has a discrepancy or flag, the day status is Discrepancy.
 * If all transactions are verified, the day status is All Verified.
 * Otherwise, the day status is Pending Audit.
 */
export function rollUpAuditStatus(statuses: (string | undefined | null)[]): 'All Verified' | 'Pending Audit' | 'Discrepancy' {
  if (!statuses || statuses.length === 0) return 'Pending Audit'

  const cleaned = statuses
    .filter((s): s is string => Boolean(s && s.trim()))
    .map((s) => s.trim().toLowerCase())

  if (cleaned.length === 0) return 'Pending Audit'

  if (cleaned.some((s) => s === 'discrepancy' || s === 'flagged')) {
    return 'Discrepancy'
  }

  const allVerified = cleaned.every(
    (s) => s === 'verified' || s === 'all verified'
  )

  return allVerified ? 'All Verified' : 'Pending Audit'
}

/**
 * Returns the day of the week (e.g., "Monday", "Tuesday") from a date string or Date object.
 */
export function getDayOfWeek(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return ''
  const iso = normalizeDateToYYYYMMDD(dateInput)
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''

  const [y, m, d] = iso.split('-')
  const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
  if (isNaN(dateObj.getTime())) return ''

  return dateObj.toLocaleDateString('en-US', { weekday: 'long' })
}

/**
 * Groups an array of transaction items by their normalized date in descending order.
 */
export function groupTransactionsByDate<T>(
  items: T[],
  options: {
    getDate: (item: T) => string | Date | null | undefined
    getGrossAmount: (item: T) => number
    getRealizedCash: (item: T) => number
    getAuditStatus: (item: T) => string | undefined | null
  }
): DailyGroupSummary<T>[] {
  const groupsMap = new Map<string, T[]>()

  for (const item of items) {
    const raw = options.getDate(item)
    const isoDate = normalizeDateToYYYYMMDD(raw) || 'Unknown Date'
    const existing = groupsMap.get(isoDate)
    if (existing) {
      existing.push(item)
    } else {
      groupsMap.set(isoDate, [item])
    }
  }

  // Sort dates descending
  const sortedDates = Array.from(groupsMap.keys()).sort((a, b) => {
    if (a === 'Unknown Date') return 1
    if (b === 'Unknown Date') return -1
    return b.localeCompare(a)
  })

  return sortedDates.map((dateStr) => {
    const groupItems = groupsMap.get(dateStr) || []
    const dayOfWeek = getDayOfWeek(dateStr)
    const formattedDate = dateStr === 'Unknown Date' ? 'Unknown Date' : formatDisplayDate(dateStr)

    let grossTotal = 0
    let realizedCash = 0
    const auditStatuses: (string | undefined | null)[] = []

    for (const it of groupItems) {
      grossTotal += options.getGrossAmount(it) || 0
      realizedCash += options.getRealizedCash(it) || 0
      auditStatuses.push(options.getAuditStatus(it))
    }

    return {
      date: dateStr,
      formattedDate,
      dayOfWeek,
      transactionCount: groupItems.length,
      grossTotal,
      realizedCash,
      auditStatus: rollUpAuditStatus(auditStatuses),
      items: groupItems,
    }
  })
}

