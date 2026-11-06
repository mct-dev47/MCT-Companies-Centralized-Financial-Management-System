/**
 * Tenant leases and payments, saved in the database through /api/v1/tenants (spec 0017).
 * Nothing is kept in localStorage. The server decides who audited and when, the reference
 * number, the totals for a repeating lease, and what each user may see or change.
 */
import type { LeaseRepeat } from '@/services/tenantScheduleService'
import { notifyNotificationsUpdated } from '@/services/notificationService'

export const TENANT_COMPANY_NAME = 'JK Property and Ventures'

// Tenant leases used to live in this browser (spec 0017). That copy is not trusted or imported.
const LEGACY_TENANT_KEYS = ['mct_jk_tenants_leases_v1']

export interface DailyRentRecord {
  id: string
  date: string // YYYY-MM-DD
  amount: number
  method: string // Cash | GCash | Bank Transfer | Cheque | N/A
  referenceNo?: string
  notes?: string
  status?: 'Paid' | 'Missed'
  missedReason?: string
  timestamp: string
  /** Starting period (1 based) of a payment on a repeating lease. Extra money flows forward from it. */
  periodIndex?: number
  createdBy?: number
  createdByName?: string
}

export interface TenantLease {
  id: string
  tenantId: string // the server made reference, like TNT-JK-2026-001
  tenantName: string
  unitName: string
  rentAmount: number
  contractDate: string
  dueDate: string // First Due Date when the lease repeats
  totalAmountPayable: number
  amountPaid: number
  remainingBalance: number
  status: 'Active' | 'Completed' | 'Overdue' | 'Pending'
  companyName: string
  notes?: string
  dailyPayments: DailyRentRecord[]
  repeat?: LeaseRepeat
  leaseEndDate?: string
  penaltyRate?: number
  auditStatus?: 'Verified' | 'Flagged'
  auditDate?: string
  auditedBy?: string
  auditRemarks?: string
}

/** The lease fields the New Lease and Edit forms send. */
export interface LeaseInput {
  tenantName: string
  unitName: string
  rentAmount: number
  contractDate: string
  dueDate: string
  leaseEndDate?: string
  repeat: LeaseRepeat
  penaltyRate?: number
  totalAmountPayable?: number
  status: TenantLease['status']
  notes?: string
}

export interface PaymentInput {
  date: string
  amount: number
  method?: string
  referenceNo?: string
  notes?: string
  status: 'Paid' | 'Missed'
  missedReason?: string
  periodIndex?: number
}

export function removeLegacyTenantStorage(): void {
  if (typeof window === 'undefined') return
  try {
    LEGACY_TENANT_KEYS.forEach((key) => localStorage.removeItem(key))
  } catch {
    // ignore storage errors
  }
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1/tenants${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  if (!res.ok) {
    let message = `The server could not save this change (${res.status}).`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') message = body.detail
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) message = String(body.detail[0].msg)
    } catch {
      // keep the default message
    }
    throw new Error(message)
  }
  if (init?.method && init.method.toUpperCase() !== 'GET') notifyNotificationsUpdated()
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function formatAuditDate(iso?: string | null): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapLease(b: any): TenantLease {
  const repeat = (b.repeat_mode || 'None') as LeaseRepeat
  return {
    id: String(b.lease_id),
    tenantId: b.tenant_ref,
    tenantName: b.tenant_name,
    unitName: b.unit_name,
    rentAmount: Number(b.rent_amount),
    contractDate: String(b.contract_date).slice(0, 10),
    dueDate: String(b.due_date).slice(0, 10),
    totalAmountPayable: Number(b.total_amount_payable),
    amountPaid: Number(b.amount_paid || 0),
    remainingBalance: Number(b.remaining_balance || 0),
    status: b.status,
    companyName: b.company_name || TENANT_COMPANY_NAME,
    notes: b.notes || undefined,
    repeat,
    leaseEndDate: b.lease_end_date ? String(b.lease_end_date).slice(0, 10) : undefined,
    penaltyRate: b.penalty_rate === null || b.penalty_rate === undefined ? undefined : Number(b.penalty_rate),
    auditStatus: b.audit_status === 'Verified' || b.audit_status === 'Flagged' ? b.audit_status : undefined,
    auditDate: formatAuditDate(b.audited_at),
    auditedBy: b.audited_by || undefined,
    auditRemarks: b.audit_remarks || undefined,
    dailyPayments: (b.payments || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any): DailyRentRecord => ({
        id: String(p.payment_id),
        date: String(p.payment_date).slice(0, 10),
        amount: Number(p.amount || 0),
        method: p.method || 'N/A',
        referenceNo: p.reference_no || undefined,
        notes: p.notes || undefined,
        status: p.status === 'Missed' ? 'Missed' : 'Paid',
        missedReason: p.missed_reason || undefined,
        timestamp: p.created_at || `${String(p.payment_date).slice(0, 10)}T00:00:00Z`,
        periodIndex: p.period_index ?? undefined,
        createdBy: p.created_by ?? undefined,
        createdByName: p.created_by_name || undefined,
      })
    ),
  }
}

function leaseBody(input: Partial<LeaseInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (input.tenantName !== undefined) body.tenant_name = input.tenantName
  if (input.unitName !== undefined) body.unit_name = input.unitName
  if (input.rentAmount !== undefined) body.rent_amount = input.rentAmount
  if (input.contractDate !== undefined) body.contract_date = input.contractDate
  if (input.dueDate !== undefined) body.due_date = input.dueDate
  if (input.repeat !== undefined) body.repeat_mode = input.repeat
  if (input.totalAmountPayable !== undefined) body.total_amount_payable = input.totalAmountPayable
  if (input.status !== undefined) body.status = input.status
  if (input.notes !== undefined) body.notes = input.notes
  return body
}

function paymentBody(p: PaymentInput): Record<string, unknown> {
  return {
    payment_date: p.date,
    amount: p.amount,
    method: p.method,
    reference_no: p.referenceNo,
    notes: p.notes,
    status: p.status,
    missed_reason: p.missedReason,
    period_index: p.periodIndex ?? null,
  }
}

export const tenantService = {
  async listLeases(): Promise<TenantLease[]> {
    const rows = await request<unknown[]>(`/leases?company_name=${encodeURIComponent(TENANT_COMPANY_NAME)}`)
    return rows.map(mapLease)
  },

  async createLease(input: LeaseInput): Promise<TenantLease> {
    const body = leaseBody(input)
    body.company_name = TENANT_COMPANY_NAME
    if (input.repeat !== 'None') {
      body.lease_end_date = input.leaseEndDate
      if (input.penaltyRate !== undefined) body.penalty_rate = input.penaltyRate
    }
    return mapLease(await request('/leases', { method: 'POST', body: JSON.stringify(body) }))
  },

  async updateLease(id: string, input: Partial<LeaseInput>): Promise<TenantLease> {
    const body = leaseBody(input)
    if (input.repeat !== undefined) {
      if (input.repeat === 'None') {
        body.clear_lease_end_date = true
        body.clear_penalty_rate = true
      } else {
        body.lease_end_date = input.leaseEndDate
        if (input.penaltyRate === undefined) body.clear_penalty_rate = true
        else body.penalty_rate = input.penaltyRate
      }
    }
    return mapLease(await request(`/leases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }))
  },

  async setStatus(id: string, status: TenantLease['status']): Promise<TenantLease> {
    return mapLease(await request(`/leases/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }))
  },

  async deleteLease(id: string): Promise<void> {
    await request(`/leases/${id}`, { method: 'DELETE' })
  },

  async addPayment(leaseId: string, payment: PaymentInput): Promise<TenantLease> {
    return mapLease(await request(`/leases/${leaseId}/payments`, { method: 'POST', body: JSON.stringify(paymentBody(payment)) }))
  },

  async updatePayment(leaseId: string, paymentId: string, payment: PaymentInput): Promise<TenantLease> {
    return mapLease(
      await request(`/leases/${leaseId}/payments/${paymentId}`, { method: 'PATCH', body: JSON.stringify(paymentBody(payment)) })
    )
  },

  async deletePayment(leaseId: string, paymentId: string): Promise<TenantLease> {
    return mapLease(await request(`/leases/${leaseId}/payments/${paymentId}`, { method: 'DELETE' }))
  },

  /** Audit and Admin only. The server stamps who and when. */
  async saveAuditReview(leaseId: string, status: 'Verified' | 'Flagged' | 'Pending Audit', remarks?: string): Promise<TenantLease> {
    return mapLease(
      await request(`/leases/${leaseId}/audit`, {
        method: 'PATCH',
        body: JSON.stringify({ audit_status: status, remarks: remarks || null }),
      })
    )
  },
}
