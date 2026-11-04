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

/** PATCH /{resource}/{id}/audit. Throws an Error with the server's message when saving fails. */
export async function saveAuditReview(
  resource: 'sales' | 'expenses',
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
