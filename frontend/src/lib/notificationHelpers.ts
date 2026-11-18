export type TabId = 'all' | 'due_dates' | 'bills' | 'lending' | 'other'

export interface ParsedNotification {
  id: string
  notification_type: string
  title: string
  message: string
  created_at: string | null
  unread: boolean
  category: 'bills' | 'lending' | 'other'
  categoryLabel: string
  refType?: string | null
  refId?: number | null
  isDueReminder: boolean

  // Parsed payment fields
  isPayment: boolean
  borrowerName?: string
  loanRef?: string
  txRef?: string
  amountPaid?: number
  lateFee?: number
  paymentMethod?: string
  remainingBalance?: number
  dateKey: string // YYYY-MM-DD
}

export interface GroupedPaymentNotification {
  id: string
  isGroup: true
  borrowerName: string
  loanRef: string
  paymentCount: number
  totalAmount: number
  totalLateFee: number
  latestBalance?: number
  created_at: string | null
  unread: boolean
  category: 'lending'
  children: ParsedNotification[]
}

export type NotificationItemOrGroup =
  | (ParsedNotification & { isGroup?: false })
  | GroupedPaymentNotification

export interface SectionGroup {
  id: 'new' | 'today' | 'yesterday' | 'earlier'
  title: string
  items: NotificationItemOrGroup[]
}

const AVATAR_PALETTES = [
  { bg: '#FDE8E8', text: '#8B1A1A' }, // soft rose/wine
  { bg: '#E1E8F8', text: '#1E40AF' }, // soft blue
  { bg: '#E3F4EB', text: '#0B5C37' }, // soft mint/green
  { bg: '#FEF3C7', text: '#92400E' }, // soft amber
  { bg: '#F3E8FF', text: '#6B21A8' }, // soft purple
  { bg: '#CCFBF1', text: '#0F766E' }, // soft teal
  { bg: '#FFEDD5', text: '#9A3412' }, // soft orange
  { bg: '#EDE9FE', text: '#5B21B6' }, // soft indigo
]

/**
 * Extracts 2-letter uppercase initials deterministically from a name or title.
 */
export function getInitials(name?: string | null): string {
  if (!name || typeof name !== 'string') return '??'
  const clean = name.trim().replace(/[^\w\s-]/g, '')
  if (!clean) return '??'

  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'

  if (parts.length === 1) {
    const single = parts[0]
    return single.length >= 2 ? single.slice(0, 2).toUpperCase() : single.toUpperCase()
  }

  const first = parts[0][0]
  const last = parts[parts.length - 1][0]
  return (first + last).toUpperCase()
}

/**
 * Returns a deterministic soft background & text color for an avatar.
 */
export function getAvatarColor(name?: string | null): { bg: string; text: string } {
  if (!name || typeof name !== 'string') {
    return AVATAR_PALETTES[0]
  }

  let hash = 0
  const normalized = name.trim().toLowerCase()
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0
  }

  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

/**
 * Formats relative time ("3m", "24m", "2h", "Yesterday", or short date).
 */
export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'Recently'

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(date.getTime())) return 'Recently'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) {
    return '1m'
  }

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return `${diffMin}m`
  }

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    return `${diffHours}h`
  }

  // Check if yesterday
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday'
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) {
    return `${diffDays}d`
  }

  // Short month + day format e.g. "Nov 18"
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Parses numeric amount from string with optional commas and currency symbols.
 */
function parseAmount(val?: string | number | null): number | undefined {
  if (typeof val === 'number') return isNaN(val) ? undefined : val
  if (!val || typeof val !== 'string') return undefined
  const cleaned = val.replace(/[^0-9.-]/g, '')
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? undefined : parsed
}

/**
 * Converts a date string or Date object into a calendar date key (YYYY-MM-DD).
 */
export function getDateKey(dateInput?: string | Date | null): string {
  if (!dateInput) return 'unknown-date'
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (isNaN(date.getTime())) return 'unknown-date'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Parses raw notification item fields and extracts structured payment metadata.
 */
export function parseNotificationDetails(raw: {
  id: string
  notification_type: string
  title: string
  message: string
  created_at?: string | null
  unread: boolean
  category: 'bills' | 'lending' | 'other'
  categoryLabel: string
  refType?: string | null
  refId?: number | null
  isDueReminder: boolean
  extra_data?: Record<string, any> | null
}): ParsedNotification {
  const nt = (raw.notification_type || '').toUpperCase()
  const message = raw.message || ''
  const title = raw.title || ''
  const extra = raw.extra_data || {}

  const isPayment =
    nt.startsWith('LENDING_PAYMENT') ||
    nt.startsWith('LENDING_FULLY') ||
    nt === 'LOAN_REPAYMENT_RECEIVED' ||
    message.includes(' paid ₱') ||
    message.includes(' paid via ') ||
    title.toLowerCase().includes('payment received')

  let borrowerName = extra.borrower_name || extra.borrower || ''
  let loanRef = extra.loan_ref_no || extra.loan_ref || ''
  let txRef = extra.transaction_ref_no || extra.tx_ref || ''
  let paymentMethod = extra.method || extra.payment_method || ''
  let amountPaid = parseAmount(extra.amount || extra.amount_paid)
  let lateFee = parseAmount(extra.penalty || extra.penalty_portion || extra.late_fee)
  let remainingBalance = parseAmount(extra.remaining_balance || extra.balance)

  // 1. Borrower & Loan Ref from message: e.g. "Jasmine (LN-20261118-0178) paid..."
  if (!borrowerName) {
    const nameRefMatch = message.match(/^([^(]+?)\s*\((LN-[A-Za-z0-9-]+|\d+)\)\s+paid/i)
    if (nameRefMatch) {
      borrowerName = nameRefMatch[1].trim()
      if (!loanRef) loanRef = nameRefMatch[2].trim()
    } else {
      const titleMatch = title.match(/(?:Payment Received|Settled):\s*(.+)$/i)
      if (titleMatch) {
        borrowerName = titleMatch[1].trim()
      }
    }
  }

  // 2. Loan Ref fallback from text if not extracted yet
  if (!loanRef) {
    const loanMatch = message.match(/\b(LN-[A-Za-z0-9-]+)\b/) || message.match(/Ref:\s*([A-Za-z0-9-]+)/i)
    if (loanMatch) {
      loanRef = loanMatch[1]
    }
  }

  // 3. Amount Paid from message: e.g. "paid ₱240.00"
  if (amountPaid === undefined) {
    const amountMatch = message.match(/paid\s*₱\s*([\d,]+(?:\.\d{1,2})?)/i)
    if (amountMatch) {
      amountPaid = parseAmount(amountMatch[1])
    }
  }

  // 4. Late Fee from message: e.g. "(+₱10.00 late fee)"
  if (lateFee === undefined) {
    const lateMatch = message.match(/\(\+₱\s*([\d,]+(?:\.\d{1,2})?)\s*late fee\)/i)
    if (lateMatch) {
      lateFee = parseAmount(lateMatch[1])
    }
  }

  // 5. Payment Method & Tx Ref: e.g. "via Cash (TX-20261118-0231)"
  if (!paymentMethod) {
    const methodMatch = message.match(/via\s+([A-Za-z0-9\s]+?)(?:\s*\((TX-[A-Za-z0-9-]+)\)|\.|\s*Remaining)/i)
    if (methodMatch) {
      paymentMethod = methodMatch[1].trim()
      if (!txRef && methodMatch[2]) {
        txRef = methodMatch[2].trim()
      }
    }
  }

  if (!txRef) {
    const txMatch = message.match(/\b(TX-[A-Za-z0-9-]+)\b/)
    if (txMatch) {
      txRef = txMatch[1]
    }
  }

  // 6. Remaining Balance: e.g. "Remaining balance: ₱960.00."
  if (remainingBalance === undefined) {
    const balMatch = message.match(/(?:Remaining\s+balance|Outstanding\s+balance):\s*₱\s*([\d,]+(?:\.\d{1,2})?)/i)
    if (balMatch) {
      remainingBalance = parseAmount(balMatch[1])
    }
  }

  const dateKey = getDateKey(raw.created_at)

  return {
    id: raw.id,
    notification_type: raw.notification_type,
    title: raw.title,
    message: raw.message,
    created_at: raw.created_at || null,
    unread: raw.unread,
    category: raw.category,
    categoryLabel: raw.categoryLabel,
    refType: raw.refType,
    refId: raw.refId,
    isDueReminder: raw.isDueReminder,
    isPayment,
    borrowerName: borrowerName || undefined,
    loanRef: loanRef || undefined,
    txRef: txRef || undefined,
    amountPaid,
    lateFee,
    paymentMethod: paymentMethod || undefined,
    remainingBalance,
    dateKey,
  }
}

/**
 * Grouping rule:
 * If one borrower has 2 or more payment notifications on the same loan within the same day,
 * collapse them into one row: "{borrowerName} made {count} payments · {totalAmount} total".
 */
export function groupPaymentNotifications(
  items: ParsedNotification[]
): NotificationItemOrGroup[] {
  // 1. Group candidates by: borrowerName (lowercase) + loanRef (or refId) + dateKey
  const paymentBuckets = new Map<string, ParsedNotification[]>()
  const nonGroupableIndices = new Set<string>()

  for (const item of items) {
    if (item.isPayment && item.borrowerName && (item.loanRef || item.refId)) {
      const key = `${item.borrowerName.toLowerCase().trim()}::${(item.loanRef || item.refId)}::${item.dateKey}`
      const bucket = paymentBuckets.get(key) || []
      bucket.push(item)
      paymentBuckets.set(key, bucket)
    } else {
      nonGroupableIndices.add(item.id)
    }
  }

  // Map each grouped key to a GroupedPaymentNotification if count >= 2
  const groupedByKey = new Map<string, GroupedPaymentNotification>()
  const childIdToGroupKey = new Map<string, string>()

  for (const [key, bucket] of paymentBuckets.entries()) {
    if (bucket.length >= 2) {
      // Sort children newest to oldest
      bucket.sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
        return timeB - timeA
      })

      const newest = bucket[0]
      const totalAmount = bucket.reduce((sum, item) => sum + (item.amountPaid || 0), 0)
      const totalLateFee = bucket.reduce((sum, item) => sum + (item.lateFee || 0), 0)
      const hasUnread = bucket.some((c) => c.unread)

      // Find latest balance available from children
      const latestBalance = bucket.find((c) => c.remainingBalance !== undefined)?.remainingBalance

      const grouped: GroupedPaymentNotification = {
        id: `grouped_${key}`,
        isGroup: true,
        borrowerName: newest.borrowerName || 'Borrower',
        loanRef: newest.loanRef || (newest.refId ? `LN-${newest.refId}` : ''),
        paymentCount: bucket.length,
        totalAmount,
        totalLateFee,
        latestBalance,
        created_at: newest.created_at,
        unread: hasUnread,
        category: 'lending',
        children: bucket,
      }

      groupedByKey.set(key, grouped)
      for (const child of bucket) {
        childIdToGroupKey.set(child.id, key)
      }
    }
  }

  // Build the final ordered list preserving order of the first occurrence of each item/group
  const result: NotificationItemOrGroup[] = []
  const emittedGroupKeys = new Set<string>()

  for (const item of items) {
    const groupKey = childIdToGroupKey.get(item.id)
    if (groupKey) {
      if (!emittedGroupKeys.has(groupKey)) {
        emittedGroupKeys.add(groupKey)
        const groupObj = groupedByKey.get(groupKey)
        if (groupObj) {
          result.push(groupObj)
        }
      }
    } else {
      result.push({ ...item, isGroup: false })
    }
  }

  return result
}

/**
 * Filters items/groups by active tab.
 */
export function filterNotificationsByTab(
  items: NotificationItemOrGroup[],
  tab: TabId
): NotificationItemOrGroup[] {
  switch (tab) {
    case 'due_dates':
      return items.filter((n) => {
        if (n.isGroup) return false
        return n.isDueReminder
      })
    case 'bills':
      return items.filter((n) => {
        if (n.isGroup) return false
        return n.category === 'bills'
      })
    case 'lending':
      return items.filter((n) => {
        if (n.isGroup) return true
        return n.category === 'lending' || n.isPayment
      })
    case 'other':
      return items.filter((n) => {
        if (n.isGroup) return false
        return n.category === 'other' && !n.isDueReminder && !n.isPayment
      })
    case 'all':
    default:
      return items
  }
}

/**
 * Calculates unread count per tab based on individual notifications.
 */
export function calculateTabUnreadCounts(items: ParsedNotification[]): Record<TabId, number> {
  const counts: Record<TabId, number> = {
    all: 0,
    due_dates: 0,
    bills: 0,
    lending: 0,
    other: 0,
  }

  for (const item of items) {
    if (!item.unread) continue

    counts.all += 1

    if (item.isDueReminder) {
      counts.due_dates += 1
    } else if (item.category === 'bills') {
      counts.bills += 1
    } else if (item.category === 'lending' || item.isPayment) {
      counts.lending += 1
    } else {
      counts.other += 1
    }
  }

  return counts
}

/**
 * Partitions items/groups into sections:
 * - New (unread)
 * - Today (read, created today)
 * - Yesterday (read, created yesterday)
 * - Earlier (read, created earlier)
 * Hides empty sections.
 */
export function partitionBySection(items: NotificationItemOrGroup[]): SectionGroup[] {
  const newItems: NotificationItemOrGroup[] = []
  const todayItems: NotificationItemOrGroup[] = []
  const yesterdayItems: NotificationItemOrGroup[] = []
  const earlierItems: NotificationItemOrGroup[] = []

  const now = new Date()
  const todayKey = getDateKey(now)

  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(now.getDate() - 1)
  const yesterdayKey = getDateKey(yesterdayDate)

  for (const item of items) {
    if (item.unread) {
      newItems.push(item)
      continue
    }

    const itemDateKey = item.created_at ? getDateKey(item.created_at) : 'unknown'
    if (itemDateKey === todayKey) {
      todayItems.push(item)
    } else if (itemDateKey === yesterdayKey) {
      yesterdayItems.push(item)
    } else {
      earlierItems.push(item)
    }
  }

  const sections: SectionGroup[] = []

  if (newItems.length > 0) {
    sections.push({ id: 'new', title: 'NEW', items: newItems })
  }
  if (todayItems.length > 0) {
    sections.push({ id: 'today', title: 'TODAY', items: todayItems })
  }
  if (yesterdayItems.length > 0) {
    sections.push({ id: 'yesterday', title: 'YESTERDAY', items: yesterdayItems })
  }
  if (earlierItems.length > 0) {
    sections.push({ id: 'earlier', title: 'EARLIER', items: earlierItems })
  }

  return sections
}

/**
 * Format money helper with ₱ symbol and standard 2 decimal places.
 */
export function formatCurrencyPHP(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '₱0.00'
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Determines the target route URL when clicking a notification.
 * If a transaction reference exists for a payment/financial transaction,
 * routes to the transaction page to display the receipt modal.
 * Otherwise routes to the lender page, borrower page, lending facility, bills, etc.
 */
export function getNotificationRedirectUrl(item: ParsedNotification): string {
  const nt = (item.notification_type || '').toUpperCase()
  const refType = (item.refType || '').toLowerCase()
  const msg = (item.message || '').toLowerCase()
  const title = (item.title || '').toLowerCase()

  // 1. Transaction Receipt: If transaction ref exists
  if (item.txRef) {
    return `/transaction?tab=all&ref=${encodeURIComponent(item.txRef)}`
  }

  // 2. Inter-Company Loans: Lender vs Borrower
  if (refType === 'loan' || refType === 'loan_repayment' || nt.includes('LOAN')) {
    const isLender =
      nt.includes('LENDER') ||
      title.includes('lender') ||
      msg.includes('lender') ||
      title.includes('payment not received') ||
      title.includes('repayment received') ||
      msg.includes('received a payment') ||
      msg.includes('lent')

    const isBorrower =
      nt.includes('BORROWER') ||
      title.includes('borrower') ||
      msg.includes('borrower') ||
      title.includes('request')

    const searchSuffix = item.loanRef ? `?search=${encodeURIComponent(item.loanRef)}` : ''

    if (isLender) {
      return `/loan/lender${searchSuffix}`
    }
    if (isBorrower) {
      return `/loan/borrower${searchSuffix}`
    }
    return `/loan${searchSuffix}`
  }

  // 3. Filcap Lending Facility
  if (
    item.category === 'lending' ||
    refType === 'lending' ||
    refType === 'borrower' ||
    nt.startsWith('LENDING_')
  ) {
    const searchSuffix = item.borrowerName
      ? `?search=${encodeURIComponent(item.borrowerName)}`
      : item.loanRef
      ? `?search=${encodeURIComponent(item.loanRef)}`
      : ''
    return `/lending${searchSuffix}`
  }

  // 4. Bills
  if (item.category === 'bills' || refType === 'bill' || nt.startsWith('BILL_')) {
    if (item.refId && item.refId > 0) {
      return `/bills/${item.refId}`
    }
    return '/bills'
  }

  // 5. Tenants
  if (refType === 'tenant' || nt.startsWith('TENANT_')) {
    return '/tenant'
  }

  // 6. Petty Cash
  if (refType === 'petty_cash' || nt.includes('PETTY_CASH')) {
    return '/petty-cash'
  }

  // 7. Sales / Deposits
  if (refType === 'deposit' || refType === 'sale' || nt.includes('DEPOSIT')) {
    return '/sales'
  }

  // 8. Expense
  if (refType === 'expense' || nt.startsWith('EXPENSE_')) {
    return '/expense'
  }

  // 9. Activity Log / System
  if (refType === 'activity_log' || nt === 'SYSTEM_ACTIVITY_NOTICE') {
    return '/activity-log'
  }

  return '/dashboard'
}
