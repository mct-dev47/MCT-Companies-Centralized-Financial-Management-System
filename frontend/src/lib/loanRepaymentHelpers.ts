export interface LoanRepaymentLike {
  id: string
  paymentDate: string
  amount: number
  remainingBalance: number
  referenceNo?: string
  paymentMethod?: string
  notes?: string
  createdAt?: string
}

function isSyntheticRepaymentId(id: string | undefined): boolean {
  if (!id) return true
  return id.startsWith('stmt-') || id.startsWith('rep_')
}

function normalizeReferenceNo(ref?: string): string {
  const trimmed = (ref || '').trim()
  if (trimmed === '—' || trimmed === '-') return ''
  return trimmed
}

function getRepaymentDedupKey(record: LoanRepaymentLike): string {
  if (!isSyntheticRepaymentId(record.id)) {
    return `id:${record.id}`
  }
  return `fallback:${record.paymentDate}-${record.amount}-${normalizeReferenceNo(record.referenceNo)}`
}

/** Map a backend /statement repayment payload into a UI LoanRepaymentLike record. */
export function mapStatementRepayment(
  r: any,
  idx: number,
  fallbackDate: string
): LoanRepaymentLike {
  const rawId = r.loan_repayment_id ?? r.repayment_id ?? r.id
  return {
    id: rawId !== undefined && rawId !== null && String(rawId) !== '' ? String(rawId) : `stmt-${idx}`,
    paymentDate: String(r.payment_date || r.paymentDate || fallbackDate),
    amount: Number(r.amount || 0),
    remainingBalance: Number(r.remaining_balance ?? r.remainingBalance ?? 0),
    referenceNo: String(r.reference_no || r.reference || r.referenceNo || ''),
    paymentMethod: String(r.payment_method || r.paymentMethod || 'Bank Transfer'),
    notes: String(r.notes || r.remarks || 'Loan repayment remittance'),
  }
}

/**
 * Merge authoritative /statement repayments with local loan.repayments without
 * duplicating records that have empty reference numbers or collapsing distinct
 * same-day equal-amount repayments that have different backend IDs.
 */
export function mergeLoanRepayments<T extends LoanRepaymentLike>(
  statementRepayments: T[],
  localRepayments: T[]
): T[] {
  const map = new Map<string, T>()
  for (const r of statementRepayments) {
    map.set(getRepaymentDedupKey(r), r)
  }
  for (const r of localRepayments) {
    const key = getRepaymentDedupKey(r)
    if (!map.has(key)) {
      map.set(key, r)
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    b.paymentDate.localeCompare(a.paymentDate)
  )
}
