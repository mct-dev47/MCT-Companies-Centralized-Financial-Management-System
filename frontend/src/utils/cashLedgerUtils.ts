// The paid part of a sale or expense, in one place (spec 0013, AC-10 & spec 0028, AC-5).
// The Sales page "Deposit" tab, the Expense page "Withdraw" tab and the Transaction page cash
// ledger tab all use these, so a record's paid amount is consistent across pages.

import type { SalesItem } from '@/services/salesService'
import type { ExpenseItem } from '@/services/expenseService'
import type { UtangSale } from '@/services/receivablesStore'
import { normalizeParticularStatus, parseParticulars } from '@/utils/particularsUtils'

/** Money actually received for a sale from its [Paid] particulars alone. */
export function getPaidDepositForSale(sale: SalesItem): number {
  const items = parseParticulars(sale.particulars, sale.items, sale.deposit)
  if (items.length > 0) {
    const fallback = normalizeParticularStatus(sale.status, 'Paid')
    return items.reduce((sum, it) => {
      const st = normalizeParticularStatus(it.status, fallback)
      return st === 'Paid' ? sum + (Number(it.total) || 0) : sum
    }, 0)
  }
  return normalizeParticularStatus(sale.status, 'Paid') === 'Paid' ? sale.deposit || 0 : 0
}

/**
 * Realized cash collected for a sale (Spec 0028 AC-5):
 * - For standalone utang records without a linked `sales` row, returns `amount_paid`.
 * - For `sales` rows without linked receivables, returns `getPaidDepositForSale(sale)`.
 * - For `sales` rows with linked receivables, sums [Paid] lines NOT tracked by a linked
 *   receivable PLUS `amount_paid` across all linked receivables, so partial payments
 *   count toward Total Cash immediately while [Paid] receivable lines are never double-counted.
 */
export function getRealizedCashForSale(
  sale: SalesItem,
  linkedReceivables?: UtangSale[]
): number {
  const saleWithMeta = sale as SalesItem & {
    isStandaloneUtang?: boolean
    amount_paid?: number
  }
  if (saleWithMeta.isStandaloneUtang) {
    return Math.max(0, Number(saleWithMeta.amount_paid) || 0)
  }

  if (!linkedReceivables || linkedReceivables.length === 0) {
    return getPaidDepositForSale(sale)
  }

  const items = parseParticulars(sale.particulars, sale.items, sale.deposit)
  const receivablePaidSum = linkedReceivables.reduce(
    (sum, r) => sum + Math.max(0, Number(r.amount_paid) || 0),
    0
  )

  if (items.length === 0) {
    return receivablePaidSum
  }

  const claimedIndices = new Set<number>()
  for (const r of linkedReceivables) {
    if (
      typeof r.sale_line_index === 'number' &&
      r.sale_line_index >= 0 &&
      r.sale_line_index < items.length &&
      !claimedIndices.has(r.sale_line_index)
    ) {
      claimedIndices.add(r.sale_line_index)
      continue
    }
    const targetName = (r.items_summary || '').trim().toLowerCase()
    const targetAmt = Number(r.total_amount) || 0
    let matchedIdx = items.findIndex(
      (it, idx) =>
        !claimedIndices.has(idx) &&
        it.particulars.trim().toLowerCase() === targetName &&
        Math.abs((Number(it.total) || 0) - targetAmt) <= 0.05
    )
    if (matchedIdx === -1 && targetName) {
      matchedIdx = items.findIndex(
        (it, idx) =>
          !claimedIndices.has(idx) &&
          it.particulars.trim().toLowerCase() === targetName
      )
    }
    if (matchedIdx !== -1) {
      claimedIndices.add(matchedIdx)
    }
  }

  const fallback = normalizeParticularStatus(sale.status, 'Paid')
  const nonReceivablePaidSum = items.reduce((sum, it, idx) => {
    if (claimedIndices.has(idx)) return sum
    const st = normalizeParticularStatus(it.status, fallback)
    return st === 'Paid' ? sum + (Number(it.total) || 0) : sum
  }, 0)

  return nonReceivablePaidSum + receivablePaidSum
}

/** Money actually paid out for an expense: paid particulars, or the repayments made so far. */
export function getPaidDisbursementForExpense(exp: ExpenseItem): number {
  const items = parseParticulars(exp.particulars, exp.items, exp.withdrawal)
  if (items.length > 0) {
    const fallback = normalizeParticularStatus(exp.status, 'Paid')
    const paidFromItems = items.reduce((sum, it) => {
      const st = normalizeParticularStatus(it.status, fallback)
      return st === 'Paid' ? sum + (Number(it.total) || 0) : sum
    }, 0)
    if (exp.totalPaid && exp.totalPaid > paidFromItems) return exp.totalPaid
    return paidFromItems
  }
  if (exp.totalPaid && exp.totalPaid > 0) return exp.totalPaid
  return normalizeParticularStatus(exp.status, 'Paid') === 'Paid' ? exp.withdrawal || 0 : 0
}
