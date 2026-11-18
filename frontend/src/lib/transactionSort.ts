import { normalizeDateToYYYYMMDD } from '../utils/dateUtils.ts'

/**
 * Parses a transaction timestamp (ISO 8601 or datetime string) into epoch milliseconds.
 * Date-only strings without a time component return 0 so missing timestamps do not
 * masquerade as midnight UTC.
 */
export function parseTransactionTimestamp(ts: string | null | undefined): number {
  if (!ts) return 0
  const trimmed = String(ts).trim()
  if (!trimmed || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 0
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? 0 : parsed
}

export interface ChronologicalComparable {
  id: string | number
  date: string
  createdAt?: string | null
  updatedAt?: string | null
}

/**
 * Compares two transactions newest-first:
 * 1. Transaction date (normalized YYYY-MM-DD)
 * 2. Timestamp of that transaction (createdAt, falling back to updatedAt)
 * 3. Numeric-aware ID tie-breaker
 */
export function compareTransactionsDesc(
  a: ChronologicalComparable,
  b: ChronologicalComparable,
  getDate: (item: ChronologicalComparable) => string = (item) => normalizeDateToYYYYMMDD(item.date) || '',
  getTimestamp: (item: ChronologicalComparable) => number = (item) =>
    parseTransactionTimestamp(item.createdAt) || parseTransactionTimestamp(item.updatedAt),
): number {
  const dateA = getDate(a)
  const dateB = getDate(b)
  if (dateA !== dateB) return dateB.localeCompare(dateA)

  const timeA = getTimestamp(a)
  const timeB = getTimestamp(b)
  if (timeA !== timeB) return timeB - timeA

  return String(b.id || '').localeCompare(String(a.id || ''), undefined, { numeric: true })
}

/**
 * Compares two transactions in the requested sort direction ('desc' = latest first, 'asc' = oldest first).
 */
export function compareTransactions(
  a: ChronologicalComparable,
  b: ChronologicalComparable,
  sortOrder: 'desc' | 'asc' = 'desc',
  getDate?: (item: ChronologicalComparable) => string,
  getTimestamp?: (item: ChronologicalComparable) => number,
): number {
  const cmp = compareTransactionsDesc(a, b, getDate, getTimestamp)
  return sortOrder === 'desc' ? cmp : -cmp
}
