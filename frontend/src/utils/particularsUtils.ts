export interface ParticularItem {
  id?: string
  particulars: string
  quantity: number
  unitPrice: number
  total: number
  status?: 'Paid' | 'Unpaid' | 'Pending' | 'On hold'
}

/**
 * Formats an array of particular items into a structured, readable string.
 * Each item is placed on its own line:
 * e.g. "Office Supplies (2x @ ₱500.00 = ₱1,000.00) [Paid]"
 */
export function formatParticularsString(items: ParticularItem[]): string {
  if (!items || items.length === 0) return ''

  if (items.length === 1) {
    const item = items[0]
    const statusSuffix = item.status ? ` [${item.status}]` : ''
    if (item.quantity === 1 && item.unitPrice === item.total) {
      return `${item.particulars.trim()}${statusSuffix}`
    }
  }

  return items
    .map((item) => {
      const name = item.particulars.trim()
      const qty = item.quantity || 1
      const price = typeof item.unitPrice === 'number' ? item.unitPrice : 0
      const total = typeof item.total === 'number' ? item.total : qty * price
      const priceStr = price.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      const totalStr = total.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      const statusSuffix = item.status ? ` [${item.status}]` : ''

      if (price > 0) {
        return `${name} (${qty}x @ ₱${priceStr} = ₱${totalStr})${statusSuffix}`
      }
      return `${name} (${qty}x)${statusSuffix}`
    })
    .join('\n')
}

/**
 * Parses raw particulars string or structured items into an array of ParticularItem objects.
 */
export function parseParticulars(
  rawParticulars?: string | null,
  explicitItems?: ParticularItem[] | null,
  fallbackTotal?: number
): ParticularItem[] {
  const amt = typeof fallbackTotal === 'number' && fallbackTotal > 0 ? fallbackTotal : 0

  if (explicitItems && Array.isArray(explicitItems) && explicitItems.length > 0) {
    return explicitItems.map((it, idx) => {
      const qty = it.quantity || 1
      const unitPrice =
        it.unitPrice > 0
          ? it.unitPrice
          : explicitItems.length === 1 && amt > 0
            ? amt / qty
            : 0
      const total =
        it.total > 0
          ? it.total
          : explicitItems.length === 1 && amt > 0
            ? amt
            : unitPrice * qty
      return {
        ...it,
        id: it.id || `item-${idx}`,
        quantity: qty,
        unitPrice,
        total,
      }
    })
  }

  if (!rawParticulars || !rawParticulars.trim()) {
    return []
  }

  const trimmed = rawParticulars.trim()

  // Multi-line particulars (one item per line)
  if (trimmed.includes('\n')) {
    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return lines.map((line, idx) => parseSingleParticularLine(line, idx))
  }

  // Single line: check if it has parentheses with qty / price or a status tag
  const parsedSingle = parseSingleParticularLine(trimmed, 0)
  if (
    parsedSingle.quantity > 1 ||
    parsedSingle.unitPrice > 0 ||
    parsedSingle.status
  ) {
    if (parsedSingle.unitPrice === 0 && parsedSingle.total === 0 && amt > 0) {
      const qty = parsedSingle.quantity || 1
      parsedSingle.unitPrice = amt / qty
      parsedSingle.total = amt
    }
    return [parsedSingle]
  }

  return [
    {
      id: `item-0`,
      particulars: trimmed,
      quantity: 1,
      unitPrice: amt,
      total: amt,
    },
  ]
}

function parseSingleParticularLine(line: string, index: number): ParticularItem {
  let cleanedLine = line.trim()
  let itemStatus: 'Paid' | 'Unpaid' | 'Pending' | 'On hold' | undefined = undefined

  const statusTagMatch = cleanedLine.match(/\[(Paid|Unpaid|Pending|On hold)\]/i)
  if (statusTagMatch) {
    const rawTag = statusTagMatch[1].toLowerCase()
    if (rawTag === 'paid') itemStatus = 'Paid'
    else if (rawTag === 'unpaid') itemStatus = 'Unpaid'
    else if (rawTag === 'pending') itemStatus = 'Pending'
    else if (rawTag === 'on hold') itemStatus = 'On hold'
    cleanedLine = cleanedLine.replace(statusTagMatch[0], '').trim()
  }

  // Pattern: Item Name (2x @ ₱500.00 = ₱1,000.00) or Item Name (2x @ ₱500.00) or Item Name (2x)
  const regex =
    /^(.+?)\s*\(\s*(?:(\d+(?:\.\d+)?)\s*x)?\s*(?:@\s*(?:₱|PHP|Php)?\s*([\d,]+(?:\.\d+)?))?(?:\s*=\s*(?:₱|PHP|Php)?\s*([\d,]+(?:\.\d+)?))?\s*\)$/
  const match = cleanedLine.match(regex)

  if (match) {
    const name = match[1].trim()
    const qty = match[2] ? parseFloat(match[2]) : 1
    const unitPrice = match[3] ? parseFloat(match[3].replace(/,/g, '')) : 0
    let total = match[4] ? parseFloat(match[4].replace(/,/g, '')) : qty * unitPrice
    if (isNaN(total) || total === 0) total = qty * unitPrice

    return {
      id: `item-${index}`,
      particulars: name,
      quantity: isNaN(qty) ? 1 : qty,
      unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
      total: isNaN(total) ? 0 : total,
      ...(itemStatus ? { status: itemStatus } : {}),
    }
  }

  return {
    id: `item-${index}`,
    particulars: cleanedLine,
    quantity: 1,
    unitPrice: 0,
    total: 0,
    ...(itemStatus ? { status: itemStatus } : {}),
  }
}

/**
 * Normalizes a status string to 'Paid' | 'Pending' | 'Unpaid'.
 */
export function normalizeParticularStatus(
  status?: string | null,
  fallback: 'Paid' | 'Pending' | 'Unpaid' = 'Paid'
): 'Paid' | 'Pending' | 'Unpaid' {
  const s = (status || '').trim().toLowerCase()
  if (s === 'paid' || s === 'settled') return 'Paid'
  if (s === 'pending' || s === 'on hold') return 'Pending'
  if (s === 'unpaid' || s === 'overdue') return 'Unpaid'
  return fallback
}

/**
 * Derives overall transaction status from itemized particulars.
 */
export function deriveRecordStatusFromParticulars(
  items?: ParticularItem[] | null,
  fallbackStatus: 'Paid' | 'Pending' | 'Unpaid' = 'Paid'
): 'Paid' | 'Pending' | 'Unpaid' {
  if (!items || items.length === 0) return fallbackStatus

  const statuses = items
    .map((it) => (it.status ? normalizeParticularStatus(it.status, fallbackStatus) : null))
    .filter((s): s is 'Paid' | 'Pending' | 'Unpaid' => Boolean(s))

  if (statuses.length === 0) return fallbackStatus

  if (statuses.every((s) => s === 'Paid')) return 'Paid'
  if (statuses.every((s) => s === 'Unpaid')) return 'Unpaid'
  if (statuses.some((s) => s === 'Pending')) return 'Pending'
  // Mixed Paid & Unpaid defaults to Pending so user sees it has pending/remaining items
  return 'Pending'
}

/**
 * Filters a list of ParticularItem objects by status ('All' | 'Paid' | 'Pending' | 'Unpaid').
 */
export function filterParticularsByStatus(
  items: ParticularItem[],
  statusFilter?: string | null,
  fallbackStatus: 'Paid' | 'Pending' | 'Unpaid' = 'Paid'
): ParticularItem[] {
  if (!statusFilter || statusFilter === 'All') {
    return items.map((it) => ({
      ...it,
      status: normalizeParticularStatus(it.status, fallbackStatus),
    }))
  }

  const target = normalizeParticularStatus(statusFilter, fallbackStatus)
  return items
    .map((it) => ({
      ...it,
      status: normalizeParticularStatus(it.status, fallbackStatus),
    }))
    .filter((it) => it.status === target)
}

/**
 * Checks whether a transaction record matches the given statusFilter ('All' | 'Paid' | 'Pending' | 'Unpaid')
 * by checking both its itemized particulars and fallback record status.
 */
export function matchesParticularsStatusFilter(
  rawParticulars: string | null | undefined,
  explicitItems: ParticularItem[] | null | undefined,
  recordStatus: string | undefined,
  statusFilter: string | undefined,
  fallbackTotal?: number
): boolean {
  if (!statusFilter || statusFilter === 'All') return true

  const fallback = normalizeParticularStatus(recordStatus, 'Paid')
  const items = parseParticulars(rawParticulars, explicitItems, fallbackTotal)
  if (items.length === 0) {
    return fallback === normalizeParticularStatus(statusFilter, 'Paid')
  }

  const matching = filterParticularsByStatus(items, statusFilter, fallback)
  return matching.length > 0
}

/**
 * Returns summary information for table row display, optionally filtered by statusFilter.
 */
export function getParticularsSummary(
  rawParticulars?: string | null,
  explicitItems?: ParticularItem[] | null,
  options?: {
    statusFilter?: string
    fallbackStatus?: 'Paid' | 'Pending' | 'Unpaid'
    fallbackTotal?: number
  }
): {
  firstItemName: string
  firstItemStatus: 'Paid' | 'Pending' | 'Unpaid'
  count: number
  filteredItems: ParticularItem[]
  filteredTotal: number
} {
  const fallbackStatus = options?.fallbackStatus || 'Paid'
  const items = parseParticulars(rawParticulars, explicitItems, options?.fallbackTotal)
  const filteredItems = filterParticularsByStatus(
    items,
    options?.statusFilter,
    fallbackStatus
  )

  if (filteredItems.length === 0) {
    if (items.length === 0) {
      return {
        firstItemName: rawParticulars || '—',
        firstItemStatus: fallbackStatus,
        count: 0,
        filteredItems: [],
        filteredTotal: options?.fallbackTotal || 0,
      }
    }
    const first = items[0]
    return {
      firstItemName: first.particulars,
      firstItemStatus: normalizeParticularStatus(first.status, fallbackStatus),
      count: items.length,
      filteredItems: items,
      filteredTotal: items.reduce((sum, i) => sum + (Number(i.total) || 0), 0),
    }
  }

  const filteredTotal = filteredItems.reduce(
    (sum, i) => sum + (Number(i.total) || 0),
    0
  )

  return {
    firstItemName: filteredItems[0].particulars,
    firstItemStatus: normalizeParticularStatus(
      filteredItems[0].status,
      fallbackStatus
    ),
    count: filteredItems.length,
    filteredItems,
    filteredTotal:
      filteredTotal > 0 ? filteredTotal : options?.fallbackTotal || 0,
  }
}

/**
 * Returns standard Tailwind classes for a particular status badge ('Paid' | 'Pending' | 'Unpaid').
 * Pending is explicitly styled yellow.
 */
export function getParticularStatusBadgeClass(status?: string | null): string {
  const normalized = normalizeParticularStatus(status, 'Paid')
  if (normalized === 'Paid') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
  if (normalized === 'Pending') {
    return 'bg-yellow-100 text-yellow-800 border-yellow-300'
  }
  return 'bg-rose-50 text-rose-700 border-rose-200'
}
