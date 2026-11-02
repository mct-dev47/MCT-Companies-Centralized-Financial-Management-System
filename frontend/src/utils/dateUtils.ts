/**
 * Date normalization and comparison utilities for MCT Centralized Financial Management System
 */

const MONTH_NAMES: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
}

/**
 * Formats a Date object into local YYYY-MM-DD string without timezone skew
 */
export function formatToYYYYMMDD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Formats any date input into human-readable "MMM D, YYYY" (e.g. "Oct 31, 2026")
 */
export function formatDisplayDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '—'
  const iso = normalizeDateToYYYYMMDD(dateInput)
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return typeof dateInput === 'string' ? dateInput : '—'
  }
  const [y, m, d] = iso.split('-')
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10))
  if (isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Normalizes any date string or Date object into ISO YYYY-MM-DD format
 */
export function normalizeDateToYYYYMMDD(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return ''

  if (dateInput instanceof Date) {
    return formatToYYYYMMDD(dateInput)
  }

  const str = String(dateInput).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str
  }

  // Handle format with timestamp like "2026-10-12T01:41:36" or "2026-10-12 01:41:36"
  const isoPrefix = str.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoPrefix) {
    return isoPrefix[1]
  }

  // Handle format like "October 1, 2026" or "Oct 01, 2026"
  const wordMatch = str.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})/)
  if (wordMatch) {
    const monthKey = wordMatch[1].toLowerCase()
    const m = MONTH_NAMES[monthKey]
    if (m) {
      const d = wordMatch[2].padStart(2, '0')
      const y = wordMatch[3]
      return `${y}-${m}-${d}`
    }
  }

  // Handle format like "10/01/2026" or "10/01/26"
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0')
    const d = slashMatch[2].padStart(2, '0')
    const yearStr = slashMatch[3]
    const y = yearStr.length === 2 ? `20${yearStr}` : yearStr
    return `${y}-${m}-${d}`
  }

  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear()
    const m = String(parsed.getMonth() + 1).padStart(2, '0')
    const d = String(parsed.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  return str
}

/**
 * Checks if a date falls within a given start and end date range (inclusive).
 * Supports null boundaries (e.g. all dates if both null).
 */
export function isDateInRange(
  dateInput: string | Date | null | undefined,
  startDate: string | null | undefined,
  endDate: string | null | undefined
): boolean {
  if (!dateInput) return false
  if (!startDate && !endDate) return true

  const iso = normalizeDateToYYYYMMDD(dateInput)
  if (!iso) return false

  const startIso = startDate ? normalizeDateToYYYYMMDD(startDate) : null
  const endIso = endDate ? normalizeDateToYYYYMMDD(endDate) : null

  if (startIso && endIso) {
    // If start > end, handle inverted range gracefully
    const min = startIso <= endIso ? startIso : endIso
    const max = startIso <= endIso ? endIso : startIso
    return iso >= min && iso <= max
  }

  if (startIso) {
    return iso >= startIso
  }

  if (endIso) {
    return iso <= endIso
  }

  return true
}

/**
 * Formats YYYY-MM-DD into MM/DD/YYYY
 */
export function formatToMMDDYYYY(iso: string | null | undefined): string {
  if (!iso) return ''
  const normalized = normalizeDateToYYYYMMDD(iso)
  const parts = normalized.split('-')
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`
  }
  return iso
}

/**
 * Parses a timestamp (including naive UTC strings from SQLite/PostgreSQL or ISO strings)
 * and formats it into the user's local timezone as "MM/DD/YY, hh:mm AM/PM"
 * (or "hh:mm AM/PM" if timeOnly is true).
 */
export function formatCreatedAt(
  dateInput: string | Date | null | undefined,
  options?: { timeOnly?: boolean }
): string {
  if (!dateInput) return ''

  let parsedDate: Date | null = null

  if (dateInput instanceof Date) {
    parsedDate = isNaN(dateInput.getTime()) ? null : dateInput
  } else {
    const str = String(dateInput).trim()
    if (!str) return ''

    // If string is date-only YYYY-MM-DD or MM/DD/YY without time component
    if (/^\d{4}-\d{2}-\d{2}$/.test(str) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) {
      if (options?.timeOnly) return ''
      return str
    }

    // Check if it looks like an ISO or SQLite timestamp without timezone offset
    // e.g. "2026-10-28 07:47:55" or "2026-10-28T07:47:55.123456"
    const hasExplicitTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(str)
    const isIsoLike = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str)

    const normalizedIso =
      isIsoLike && !hasExplicitTz ? `${str.replace(' ', 'T')}Z` : str

    const d = new Date(normalizedIso)
    if (!isNaN(d.getTime())) {
      parsedDate = d
    } else {
      const fallback = new Date(str)
      if (!isNaN(fallback.getTime())) {
        parsedDate = fallback
      }
    }
  }

  if (!parsedDate) {
    return typeof dateInput === 'string' ? dateInput : ''
  }

  const timeFormatted = parsedDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  if (options?.timeOnly) {
    return timeFormatted
  }

  const month = String(parsedDate.getMonth() + 1).padStart(2, '0')
  const day = String(parsedDate.getDate()).padStart(2, '0')
  const year = String(parsedDate.getFullYear()).slice(-2)

  return `${month}/${day}/${year}, ${timeFormatted}`
}
