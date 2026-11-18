import type { DashboardTransactionItem } from './dashboardService'
import { HttpError, NetworkError } from '@/lib/requestErrors'

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem('mct_access_token') || localStorage.getItem('auth_token')
}

export interface TransactionQueryParams {
  company?: string
  company_id?: number
  startDate?: string
  endDate?: string
  type?: string
  auditStatus?: string
  search?: string
}

class TransactionService {
  /**
   * Fetch live database-backed transactions from the backend API.
   * Eliminates client-side memory synthesis and caching.
   */
  async getTransactions(params: TransactionQueryParams = {}): Promise<DashboardTransactionItem[]> {
    const token = getAuthToken()
    const sp = new URLSearchParams()

    if (params.company && params.company !== 'All' && params.company !== 'All Companies') {
      sp.set('company_name', params.company)
    }
    if (params.company_id) {
      sp.set('company_id', String(params.company_id))
    }
    if (params.startDate) {
      sp.set('start_date', params.startDate)
    }
    if (params.endDate) {
      sp.set('end_date', params.endDate)
    }
    if (params.type && params.type !== 'All') {
      sp.set('type', params.type)
    }
    if (params.auditStatus && params.auditStatus !== 'All') {
      sp.set('audit_status', params.auditStatus)
    }
    if (params.search) {
      sp.set('search', params.search)
    }

    const url = `/api/v1/transactions${sp.toString() ? `?${sp.toString()}` : ''}`

    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      if (!res.ok) {
        let errorMsg = `Server error ${res.status}`
        try {
          const errData = await res.json()
          errorMsg = errData.detail || errorMsg
        } catch {
          // keep fallback
        }
        throw new HttpError(errorMsg, res.status)
      }

      const data = await res.json()
      if (!Array.isArray(data)) return []

      return data.map((t: any): DashboardTransactionItem => ({
        id: String(t.id),
        refNo: t.refNo || '',
        chequeNo: t.chequeNo || '',
        date: t.date || '',
        type: t.type,
        company: t.company || '',
        description: t.description || '',
        particulars: t.particulars || t.description || '',
        amount: Number(t.amount || 0),
        withdrawal: Number(t.withdrawal || 0),
        deposit: Number(t.deposit || 0),
        category: t.category || 'General',
        paymentMethod: t.paymentMethod,
        status: t.status || 'Paid',
        auditStatus: t.auditStatus || 'Pending Audit',
        auditedBy: t.auditedBy,
        auditNotes: t.auditNotes,
        auditDate: t.auditDate,
        createdBy: t.createdBy,
        createdAt: t.createdAt || t.date,
        updatedAt: t.updatedAt,
        attachments: Array.isArray(t.attachments) ? t.attachments : [],
        paidAmount: t.paidAmount !== undefined ? Number(t.paidAmount) : undefined,
        bankAccountId: t.bankAccountId,
        bankName: t.bankName,
        remarks: t.remarks || '',
        sourceModule: t.sourceModule,
        depositStatus: t.depositStatus,
        deposit_status: t.depositStatus,
        depositDate: t.depositDate,
        deposit_date: t.depositDate,
        saleDate: t.saleDate || t.date || '',
        isMirrorRow: !!t.isMirrorRow,
        awaitingAudit: Boolean(t.awaitingAudit),
      }))
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new NetworkError(err instanceof Error ? err.message : 'Network error loading transactions')
    }
  }

  /**
   * Cascade delete a transaction and its underlying record/bank effects.
   */
  async deleteTransaction(transactionId: string): Promise<void> {
    const token = getAuthToken()
    try {
      const res = await fetch(`/api/v1/transactions/${encodeURIComponent(transactionId)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      if (!res.ok) {
        let errorMsg = `Server error ${res.status}`
        try {
          const errData = await res.json()
          errorMsg = errData.detail || errorMsg
        } catch {
          // keep fallback
        }
        throw new HttpError(errorMsg, res.status)
      }
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new NetworkError(err instanceof Error ? err.message : 'Network error deleting transaction')
    }
  }
}

export const transactionService = new TransactionService()
