import type { DashboardTransactionItem } from '@/services/dashboardService'
import type { SalesItem } from '@/services/salesService'
import { formatToYYYYMMDD, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { getParticularsSummary, parseParticulars } from '@/utils/particularsUtils'

export type LifecycleStepKey = 'sold' | 'paid' | 'deposited' | 'audited'
export type LifecycleStepState = 'done' | 'waiting' | 'problem' | 'upcoming'

export interface LifecycleStep {
  key: LifecycleStepKey
  title: string
  state: LifecycleStepState
}

export type PaymentChannelKind = 'deposit' | 'transfer'
export type SalesSummaryBucket = 'deposited' | 'awaiting' | 'unpaid' | 'expense' | 'other'
export type PrimaryRowActionKind =
  | 'record_payment'
  | 'mark_deposited'
  | 'mark_transferred'
  | 'edit_expense'
  | 'none'

export interface TransactionLifecycleInfo {
  /** Classification bucket (Sales lifecycle buckets vs Expense vs other ledger rows). */
  bucket: SalesSummaryBucket
  /** Channel between Paid and Deposited: GCash -> transfer, Cash/Cheque -> deposit. */
  channelKind: PaymentChannelKind
  /** Normalized stored payment status string. */
  paymentStatus: 'Paid' | 'Unpaid' | 'Pending' | 'Partially Paid' | 'Overdue' | 'On hold'
  /** Effective deposit status (Sales only; null for Expenses and other non-deposit types). */
  depositStatus: 'Deposited' | 'Not Deposited' | null
  /** Effective YYYY-MM-DD deposit date (Sales only; null unless Paid and Deposited). */
  effectiveDepositDate: string | null
  /** True when auditStatus is Pending Audit (read-only for supervisor). */
  isAuditPending: boolean
  /**
   * Lifecycle stages:
   * - Sale: Sold -> Paid -> Deposited -> Audited (4 steps)
   * - Expense / non-sale: stored payment status -> Audited (2 steps; no Deposited step)
   */
  steps: LifecycleStep[]
  /** Always-rendered accessible lifecycle description. */
  label: string
  /** Concise status label for the Status column badge (e.g. "Awaiting transfer", "Audit pending", "Audited"). */
  shortStatusLabel: string
  /** Visual semantic tone for the text label. */
  tone: 'done' | 'waiting' | 'problem'
  /** Primary action button/state for the row's Action column. */
  primaryAction: {
    kind: PrimaryRowActionKind
    label: string
  }
  /** Number of overdue days for Paid-but-not-deposited sales older than 1 day (0 otherwise). */
  overdueDays: number
  /** Formatted tag e.g. "1 day overdue" or "3 days overdue", null if not overdue. */
  overdueLabel: string | null
}

export type LifecycleRowInput = Pick<
  DashboardTransactionItem,
  | 'id'
  | 'type'
  | 'status'
  | 'auditStatus'
  | 'paymentMethod'
  | 'chequeNo'
  | 'depositStatus'
  | 'deposit_status'
  | 'deposit_date'
  | 'depositDate'
  | 'saleDate'
  | 'date'
  | 'awaitingAudit'
> & {
  payment_status?: string
  rawDate?: string
}

/**
 * Classifies payment method into Cash/Cheque ('deposit') vs GCash ('transfer').
 */
export function getPaymentChannelKind(paymentMethod?: string | null): PaymentChannelKind {
  const pm = (paymentMethod || '').trim().toLowerCase()
  if (pm === 'gcash') return 'transfer'
  return 'deposit'
}

export function isChequeMethod(paymentMethod?: string | null): boolean {
  return (paymentMethod || '').trim().toLowerCase() === 'cheque'
}

/**
 * Strips trailing status tags like "[Paid]", "[Unpaid]", "[Pending]" and legacy "[Cheque: ...]" tags.
 */
export function stripStatusSuffix(text?: string | null): string {
  if (!text) return ''
  return text
    .replace(/\s*\[(Paid|Unpaid|Pending|On hold|Partial)\]\s*$/i, '')
    .replace(/\s*\[Cheque:\s*[^\]]*\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns clean display title for a transaction or drilldown item without "[Paid]" suffixes.
 */
export function getCleanParticularsTitle(
  rawParticulars?: string | null,
  items?: DashboardTransactionItem['items'] | SalesItem['items'],
  fallbackTotal?: number
): { title: string; itemCount: number } {
  const summary = getParticularsSummary(rawParticulars, items, {
    fallbackTotal,
  })
  const parsed = parseParticulars(rawParticulars, items, fallbackTotal)
  const cleanTitle = stripStatusSuffix(summary.firstItemName) || stripStatusSuffix(rawParticulars) || '—'
  return {
    title: cleanTitle,
    itemCount: Math.max(parsed.length, summary.count, cleanTitle !== '—' ? 1 : 0),
  }
}

/**
 * Normalizes sale/transaction payment status.
 */
export function normalizeLifecyclePaymentStatus(
  tx: Pick<LifecycleRowInput, 'status' | 'payment_status'>
): TransactionLifecycleInfo['paymentStatus'] {
  const raw = (tx.status || tx.payment_status || 'Paid').trim().toLowerCase()
  if (raw === 'paid' || raw === 'settled') return 'Paid'
  if (raw === 'unpaid') return 'Unpaid'
  if (raw === 'overdue') return 'Overdue'
  if (raw === 'partially paid' || raw === 'partial') return 'Partially Paid'
  if (raw === 'on hold') return 'On hold'
  if (raw === 'pending') return 'Pending'
  return 'Paid'
}

/**
 * Resolves the sale date ISO (YYYY-MM-DD) for a row.
 */
export function getRowSaleDateIso(tx: Pick<LifecycleRowInput, 'saleDate' | 'rawDate' | 'date'>): string {
  return normalizeDateToYYYYMMDD(tx.saleDate || tx.rawDate || tx.date || '')
}

/**
 * Computes how many whole days older than 1 day a Paid-but-not-deposited sale is.
 * Returns 0 when within 1 day or when not applicable.
 */
export function getPaidUndepositedOverdueDays(
  saleDateIso: string,
  todayIso: string = formatToYYYYMMDD(new Date())
): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDateIso) || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
    return 0
  }
  const [sy, sm, sd] = saleDateIso.split('-').map(Number)
  const [ty, tm, td] = todayIso.split('-').map(Number)
  const saleUtc = Date.UTC(sy, sm - 1, sd)
  const todayUtc = Date.UTC(ty, tm - 1, td)
  const ageDays = Math.floor((todayUtc - saleUtc) / 86_400_000)
  // Older than 1 day (ageDays > 1): 2 days since sale = 1 day past the 1-day deposit window.
  return ageDays > 1 ? ageDays - 1 : 0
}

export function formatOverdueDaysLabel(overdueDays: number): string | null {
  if (overdueDays <= 0) return null
  return overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`
}

/**
 * Derives the 4-stage lifecycle (Sold -> Paid -> Deposited -> Audited), summary bucket,
 * primary row action, and exception flags strictly from existing client fields.
 */
export function deriveTransactionLifecycle(
  tx: LifecycleRowInput,
  todayIso: string = formatToYYYYMMDD(new Date())
): TransactionLifecycleInfo {
  const paymentStatus = normalizeLifecyclePaymentStatus(tx)
  const channelKind = getPaymentChannelKind(tx.paymentMethod)
  const isAuditVerified = tx.auditStatus === 'Verified'
  const isAuditFlagged = tx.auditStatus === 'Flagged'
  const isAuditPending = !isAuditVerified && !isAuditFlagged

  // Non-sale entries (Expense, Loan, Petty Cash, Income):
  // Use only the payment statuses already stored plus read-only Audited.
  // Never invent or show a Deposited stage or deposit action on expenses.
  if (tx.type !== 'Sales') {
    const isPaid = paymentStatus === 'Paid'
    const isProblemStatus = paymentStatus === 'Unpaid' || paymentStatus === 'Overdue'
    const paidStepTitle = paymentStatus === 'Partially Paid' ? 'Partially paid' : paymentStatus
    const paidStepState: LifecycleStepState = isPaid
      ? 'done'
      : isProblemStatus
        ? 'problem'
        : 'waiting'

    const auditedState: LifecycleStepState = isAuditVerified
      ? 'done'
      : isAuditFlagged
        ? 'problem'
        : isPaid
          ? 'waiting'
          : 'upcoming'

    let label: string
    let shortStatusLabel: string
    if (isPaid) {
      label = isAuditVerified
        ? 'Paid · Audited'
        : isAuditFlagged
          ? 'Paid · Flagged'
          : 'Paid · Audit pending'
      shortStatusLabel = isAuditVerified
        ? 'Audited'
        : isAuditFlagged
          ? 'Flagged'
          : 'Audit pending'
    } else {
      const base = tx.awaitingAudit ? 'Pending audit approval' : paidStepTitle
      label = isAuditFlagged
        ? `${base} · Flagged`
        : isAuditVerified
          ? `${base} · Audited`
          : base
      shortStatusLabel = label
    }

    const tone: TransactionLifecycleInfo['tone'] =
      isProblemStatus || isAuditFlagged
        ? 'problem'
        : isPaid && isAuditVerified
          ? 'done'
          : 'waiting'

    const primaryAction: TransactionLifecycleInfo['primaryAction'] =
      tx.type === 'Expense' && !isPaid && !isAuditVerified
        ? { kind: 'edit_expense', label: 'Edit' }
        : { kind: 'none', label: 'No action needed' }

    return {
      bucket: tx.type === 'Expense' ? 'expense' : 'other',
      channelKind,
      paymentStatus,
      depositStatus: null,
      effectiveDepositDate: null,
      isAuditPending,
      steps: [
        { key: 'paid', title: paidStepTitle, state: paidStepState },
        { key: 'audited', title: 'Audited', state: auditedState },
      ],
      label,
      shortStatusLabel,
      tone,
      primaryAction,
      overdueDays: 0,
      overdueLabel: null,
    }
  }

  // Domain Rule 5: Deposit status and deposit date apply only to Paid sales.
  const isPaid = paymentStatus === 'Paid'
  const rawDeposited = (tx.depositStatus || tx.deposit_status) === 'Deposited'
  const depositStatus: 'Deposited' | 'Not Deposited' =
    isPaid && rawDeposited ? 'Deposited' : 'Not Deposited'

  const rawDepDate = normalizeDateToYYYYMMDD(tx.deposit_date || tx.depositDate || '')
  const saleDateIso = getRowSaleDateIso(tx)
  const effectiveDepositDate =
    depositStatus === 'Deposited' ? rawDepDate || saleDateIso || null : null

  // 1. Unpaid / Pending / Overdue / On hold / Partially Paid
  if (!isPaid) {
    const paidStepState: LifecycleStepState =
      paymentStatus === 'Unpaid' || paymentStatus === 'Overdue' ? 'problem' : 'waiting'
    const auditedStepState: LifecycleStepState = isAuditFlagged
      ? 'problem'
      : isAuditVerified
        ? 'done'
        : 'upcoming'

    const baseLabel =
      paymentStatus === 'Unpaid'
        ? 'Unpaid'
        : paymentStatus === 'Overdue'
          ? 'Overdue'
          : paymentStatus === 'Partially Paid'
            ? 'Partially paid'
            : paymentStatus === 'On hold'
              ? 'On hold'
              : 'Payment pending'

    const label = isAuditFlagged ? `${baseLabel} · Flagged` : baseLabel
    const tone: TransactionLifecycleInfo['tone'] =
      paidStepState === 'problem' || isAuditFlagged ? 'problem' : 'waiting'

    return {
      bucket: 'unpaid',
      channelKind,
      paymentStatus,
      depositStatus: 'Not Deposited',
      effectiveDepositDate: null,
      isAuditPending,
      steps: [
        { key: 'sold', title: 'Sold', state: 'done' },
        { key: 'paid', title: 'Paid', state: paidStepState },
        { key: 'deposited', title: 'Deposited', state: 'upcoming' },
        { key: 'audited', title: 'Audited', state: auditedStepState },
      ],
      label,
      shortStatusLabel: label,
      tone,
      primaryAction: { kind: 'record_payment', label: 'Record payment' },
      overdueDays: 0,
      overdueLabel: null,
    }
  }

  // 2. Paid, NOT yet deposited/transferred
  if (depositStatus !== 'Deposited') {
    const overdueDays = getPaidUndepositedOverdueDays(saleDateIso, todayIso)
    const overdueLabel = formatOverdueDaysLabel(overdueDays)
    const waitingShort =
      channelKind === 'transfer' ? 'Awaiting transfer' : 'Awaiting deposit'
    const waitingLabel = `Paid · ${waitingShort}`
    const label = isAuditFlagged ? `${waitingLabel} · Flagged` : waitingLabel
    const shortStatusLabel = isAuditFlagged ? `${waitingShort} · Flagged` : waitingShort

    const primaryAction: TransactionLifecycleInfo['primaryAction'] =
      channelKind === 'transfer'
        ? { kind: 'mark_transferred', label: 'Mark as Transferred' }
        : { kind: 'mark_deposited', label: 'Mark as Deposited' }

    const auditedStepState: LifecycleStepState = isAuditFlagged
      ? 'problem'
      : isAuditVerified
        ? 'done'
        : 'upcoming'

    return {
      bucket: 'awaiting',
      channelKind,
      paymentStatus,
      depositStatus: 'Not Deposited',
      effectiveDepositDate: null,
      isAuditPending,
      steps: [
        { key: 'sold', title: 'Sold', state: 'done' },
        { key: 'paid', title: 'Paid', state: 'done' },
        {
          key: 'deposited',
          title: channelKind === 'transfer' ? 'Transferred' : 'Deposited',
          state: 'waiting',
        },
        { key: 'audited', title: 'Audited', state: auditedStepState },
      ],
      label,
      shortStatusLabel,
      tone: isAuditFlagged ? 'problem' : 'waiting',
      primaryAction,
      overdueDays,
      overdueLabel,
    }
  }

  // 3. Paid & Deposited
  const auditedStepState: LifecycleStepState = isAuditVerified
    ? 'done'
    : isAuditFlagged
      ? 'problem'
      : 'waiting'

  const label = isAuditVerified
    ? 'Deposited · Audited'
    : isAuditFlagged
      ? 'Deposited · Flagged'
      : 'Deposited · Audit pending'

  const shortStatusLabel = isAuditVerified
    ? 'Audited'
    : isAuditFlagged
      ? 'Flagged'
      : 'Audit pending'

  const tone: TransactionLifecycleInfo['tone'] = isAuditVerified
    ? 'done'
    : isAuditFlagged
      ? 'problem'
      : 'waiting'

  return {
    bucket: 'deposited',
    channelKind,
    paymentStatus,
    depositStatus: 'Deposited',
    effectiveDepositDate,
    isAuditPending,
    steps: [
      { key: 'sold', title: 'Sold', state: 'done' },
      { key: 'paid', title: 'Paid', state: 'done' },
      { key: 'deposited', title: 'Deposited', state: 'done' },
      { key: 'audited', title: 'Audited', state: auditedStepState },
    ],
    label,
    shortStatusLabel,
    tone,
    primaryAction: { kind: 'none', label: 'No action needed' },
    overdueDays: 0,
    overdueLabel: null,
  }
}

export function isTransactionOutflow(
  tx: Pick<DashboardTransactionItem, 'type' | 'deposit' | 'withdrawal'>
): boolean {
  if (tx.type === 'Expense') return true
  if (tx.type === 'Sales' || tx.type === 'Income') return false
  return (tx.withdrawal || 0) > 0 && (tx.deposit || 0) === 0
}

export interface TransactionTypeMeta {
  label: string
  isOutflow: boolean
  badgeClassName: string
}

/**
 * Returns accessible label, direction, and ONE UI chip classes for a row's Type chip.
 */
export function getTransactionTypeMeta(
  tx: Pick<DashboardTransactionItem, 'type' | 'deposit' | 'withdrawal'>
): TransactionTypeMeta {
  const isOutflow = isTransactionOutflow(tx)
  if (tx.type === 'Sales') {
    return {
      label: 'Sale',
      isOutflow: false,
      badgeClassName: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    }
  }
  if (tx.type === 'Expense') {
    return {
      label: 'Expense',
      isOutflow: true,
      badgeClassName: 'bg-rose-50 text-rose-800 border-rose-200',
    }
  }
  if (tx.type === 'Loan') {
    return {
      label: 'Loan',
      isOutflow,
      badgeClassName: 'bg-sky-50 text-sky-800 border-sky-200',
    }
  }
  if (tx.type === 'Petty Cash') {
    return {
      label: 'Petty Cash',
      isOutflow,
      badgeClassName: 'bg-amber-50 text-amber-800 border-amber-200',
    }
  }
  return {
    label: tx.type || 'Income',
    isOutflow,
    badgeClassName: 'bg-slate-100 text-slate-800 border-slate-200',
  }
}

/**
 * Formats an unsigned currency value with explicit "+" (money in) or "−" (money out).
 */
export function formatSignedTransactionAmount(
  tx: Pick<DashboardTransactionItem, 'type' | 'deposit' | 'withdrawal'>,
  amount: number,
  formatPhp: (value: number) => string
): string {
  const formatted = formatPhp(Math.abs(amount || 0))
  return isTransactionOutflow(tx) ? `−${formatted}` : `+${formatted}`
}

/**
 * Resolves the amount actually deposited to the bank for a row (0 when not yet deposited or for outflows).
 */
export function getDepositedAmountForRow(
  tx: Pick<
    DashboardTransactionItem,
    'type' | 'status' | 'depositStatus' | 'deposit_status' | 'paidAmount' | 'deposit' | 'withdrawal' | 'amount' | 'awaitingAudit'
  >
): number {
  if (tx.type === 'Expense') return 0
  if (tx.type === 'Sales') {
    const isDeposited = (tx.depositStatus || tx.deposit_status) === 'Deposited'
    if (!isDeposited) return 0
    if ((tx.paidAmount || 0) > 0) return Math.round((tx.paidAmount || 0) * 100) / 100
    const normalized = (tx.status || 'Paid').trim().toLowerCase()
    if (normalized === 'paid' || normalized === 'settled') {
      return Math.round((tx.deposit || tx.amount || 0) * 100) / 100
    }
    return 0
  }
  if (tx.type === 'Income') {
    return Math.round(((tx.paidAmount || tx.deposit || tx.amount || 0)) * 100) / 100
  }
  if (!isTransactionOutflow(tx) && !tx.awaitingAudit) {
    return Math.round(((tx.deposit || tx.amount || 0)) * 100) / 100
  }
  return 0
}

