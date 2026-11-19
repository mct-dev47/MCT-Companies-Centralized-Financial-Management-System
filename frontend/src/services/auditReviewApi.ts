import { notifyError } from '@/utils/errorUtils'

// Saves an Audit review of a sale or expense on the server (spec 0014).
// The server decides who audited and when; the browser only sends the status and a remark.

export type AuditStatusValue = 'Verified' | 'Pending Audit' | 'Flagged'

// Audit results used to be kept only in this browser (spec 0008). They are not trusted anymore,
// so the old keys are removed. Records show as Pending Audit until Audit verifies them again.
const LEGACY_AUDIT_KEYS = ['mct_sales_audit_status_v1', 'mct_expense_audit_status_v1']

export function removeLegacyAuditStorage(): void {
  if (typeof window === 'undefined') return
  try {
    LEGACY_AUDIT_KEYS.forEach((key) => localStorage.removeItem(key))
  } catch {
    // ignore storage errors
  }
}

export type AuditResource =
  | 'sales'
  | 'expenses'
  | 'bills'
  | 'receivables'
  | 'receivables/payments'
  | 'loans'
  | 'loans/repayments'
  | 'petty-cash/topups'

/** PATCH /{resource}/{id}/audit. Throws an Error with the server's message when saving fails. */
export async function saveAuditReview(
  resource: AuditResource,
  numericId: string,
  auditStatus: AuditStatusValue,
  remarks?: string
): Promise<any> {
  const token =
    typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
  const res = await fetch(`/api/v1/${resource}/${numericId}/audit`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ audit_status: auditStatus, remarks: remarks || null }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : `Could not save the audit status (${res.status}).`
    )
  }
  return res.json()
}

/** Tell the user an audit save failed. The caller then reloads the real status from the server. */
export function reportAuditSaveFailure(err: unknown): void {
  notifyError(err, 'The audit status was not saved. Please try again.')
}

/**
 * Route an audit review from TransactionPage or AuditTransactionModal to the
 * canonical backend endpoint for that row type.
 */
export async function saveTransactionAuditReview(
  tx: { id: string; type?: string },
  auditStatus: AuditStatusValue,
  remarks?: string
): Promise<any> {
  const id = String(tx.id || '')
  if (id.startsWith('tx-') || tx.type === 'Bank') {
    const token =
      typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
    const res = await fetch(`/api/v1/bank-accounts/transactions/${encodeURIComponent(id)}/audit`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ audit_status: auditStatus, remarks: remarks || null }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(
        typeof body.detail === 'string'
          ? body.detail
          : `Could not save the audit status (${res.status}).`
      )
    }
    return res.json()
  }
  if (id.startsWith('rec_pmt_')) {
    const pmtId = id.replace(/^rec_pmt_/, '').split(':')[0]
    return saveAuditReview('receivables/payments', pmtId, auditStatus, remarks)
  }
  if (id.startsWith('tenant_')) {
    const leaseId = id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
    const token =
      typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
    const res = await fetch(`/api/v1/tenants/leases/${encodeURIComponent(leaseId)}/audit`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ audit_status: auditStatus, remarks: remarks || null }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(
        typeof body.detail === 'string'
          ? body.detail
          : `Could not save the audit status (${res.status}).`
      )
    }
    return res.json()
  }
  if (id.startsWith('loan_rep_')) {
    const repId = id.replace(/^loan_rep_/, '').split(':')[0]
    return saveAuditReview('loans/repayments', repId, auditStatus, remarks)
  }
  if (id.startsWith('loan_')) {
    const loanId = id.replace(/^loan_/, '').split(':')[0]
    return saveAuditReview('loans', loanId, auditStatus, remarks)
  }
  if (id.startsWith('petty_')) {
    const topupId = id.replace(/^petty_/, '').split(':')[0]
    return saveAuditReview('petty-cash/topups', topupId, auditStatus, remarks)
  }
  if (tx.type === 'Sales' || id.startsWith('sale_')) {
    const saleId = id.replace(/^sale_/, '').split(':')[0]
    return saveAuditReview('sales', saleId, auditStatus, remarks)
  }
  if (tx.type === 'Expense' || id.startsWith('exp_')) {
    const expId = id.replace(/^exp_/, '').split(':')[0]
    return saveAuditReview('expenses', expId, auditStatus, remarks)
  }
  return null
}
