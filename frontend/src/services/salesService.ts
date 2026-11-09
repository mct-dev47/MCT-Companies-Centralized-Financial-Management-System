import type { DashboardTransactionItem } from './dashboardService'
import type { DailyGroupSummary } from '@/utils/dailyGroupUtils'
import { formatCreatedAt, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { removeLegacyAuditStorage, saveAuditReview } from './auditReviewApi'
import {
  type ParticularItem,
  parseParticulars,
  deriveRecordStatusFromParticulars,
} from '@/utils/particularsUtils'

export interface SalesItem {
  id: string
  refNo: string
  chequeNo?: string
  date: string // e.g. "10/01/26"
  rawDate: string // e.g. "2026-10-01"
  particulars: string
  withdrawal: number
  deposit: number
  netAmount: number
  category: string // user-configurable category (from DB Category table)
  paymentMethod?: string // payment method: GCash, Cash, Cheque, Bank Transfer, etc.
  company: string
  items?: ParticularItem[]
  status: 'Paid' | 'Pending' | 'Overdue' | 'On hold' | 'Unpaid'
  payment_status?: 'Paid' | 'Pending' | 'Unpaid'
  depositStatus?: 'Deposited' | 'Not Deposited'
  deposit_status?: 'Deposited' | 'Not Deposited'
  auditStatus: 'Verified' | 'Pending Audit' | 'Flagged'
  auditedBy?: string
  auditNotes?: string
  auditDate?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
  bankAccountId?: string
  bankName?: string
  remarks?: string
  type: 'Sales'
}

export interface DailySalesSummaryOut {
  date: string
  day_of_week: string
  transaction_count: number
  gross_total: number | string
  realized_cash: number | string
  audit_status: string
}

export interface NewSalesInput {
  date: string
  chequeNo?: string
  particulars: string
  amount: number
  category?: string // optional sales category (e.g. Sales Revenue, Catering)
  paymentMethod?: string // payment method (GCash, Cash, etc.)
  company: string
  status: 'Paid' | 'Pending' | 'On hold' | 'Unpaid'
  payment_status?: 'Paid' | 'Pending' | 'Unpaid'
  depositStatus?: 'Deposited' | 'Not Deposited'
  deposit_status?: 'Deposited' | 'Not Deposited'
  remarks?: string
  items?: ParticularItem[]
  bankAccountId?: string
  createdBy?: string
  updatedBy?: string
  updatedAt?: string
}

removeLegacyAuditStorage()

let inMemorySales: SalesItem[] = []

function mapBackendSaleToItem(b: any): SalesItem {
  const rawDate =
    b.transaction_date || (b.created_at ? b.created_at.split('T')[0] : '2026-10-01')
  const [year, month, day] = rawDate.split('-')
  const displayDate =
    month && day ? `${month}/${day}/${year?.slice(2) || '26'}` : rawDate
  const amt = Number(b.amount) || 0

  let chequeNo = b.cheque_no || b.chequeNo || b.reference_no || ''
  let particulars = b.particulars || b.description || 'Sales Entry'
  if (!chequeNo && particulars.includes('[Cheque:')) {
    const parts = particulars.split('[Cheque:')
    particulars = parts[0].trim()
    chequeNo = parts[1].replace(/\]/g, '').trim()
  }

  const rawPaymentStatus = b.payment_status || 'Paid'
  const fallbackStatus: 'Paid' | 'Pending' | 'Unpaid' =
    rawPaymentStatus === 'Unpaid'
      ? 'Unpaid'
      : rawPaymentStatus === 'Pending' || rawPaymentStatus === 'Partial'
        ? 'Pending'
        : 'Paid'

  const parsedItems = parseParticulars(particulars, null, amt)
  const derivedStatus = deriveRecordStatusFromParticulars(parsedItems, fallbackStatus)

  const resolvedPaymentStatus: 'Paid' | 'Pending' | 'Unpaid' =
    derivedStatus === 'Unpaid' ? 'Unpaid' : derivedStatus === 'Pending' ? 'Pending' : fallbackStatus

  const resolvedDepositStatus: 'Deposited' | 'Not Deposited' =
    b.deposit_status === 'Deposited' || b.depositStatus === 'Deposited'
      ? 'Deposited'
      : (b.deposit_status === 'Not Deposited' || b.depositStatus === 'Not Deposited')
      ? 'Not Deposited'
      : (resolvedPaymentStatus === 'Paid' ? 'Deposited' : 'Not Deposited')

  const saleId = String(b.sales_id)
  const resolvedAuditStatus: 'Verified' | 'Pending Audit' | 'Flagged' =
    b.audit_status === 'Verified' || b.audit_status === 'Flagged' ? b.audit_status : 'Pending Audit'

  return {
    id: saleId,
    refNo: chequeNo || `REF-${b.sales_id}`,
    chequeNo: chequeNo || undefined,
    date: displayDate,
    rawDate: rawDate,
    particulars: particulars || 'Sales Entry',
    withdrawal: 0,
    deposit: amt,
    netAmount: amt,
    category: b.category_name || 'None',
    paymentMethod: b.payment_method || undefined,
    company: b.company_name || 'MCT Kitchen',
    items: parsedItems,
    status: derivedStatus,
    payment_status: resolvedPaymentStatus,
    depositStatus: resolvedDepositStatus,
    deposit_status: resolvedDepositStatus,
    auditStatus: resolvedAuditStatus,
    auditedBy: b.audited_by || undefined,
    auditDate: b.audited_at ? formatCreatedAt(b.audited_at) : undefined,
    auditNotes: b.audit_remarks || undefined,
    createdBy: b.created_by || b.created_by_name || 'Finance Staff',
    createdAt: b.created_at || new Date().toISOString(),
    updatedAt: b.updated_at || undefined,
    updatedBy: b.updated_by || b.updated_by_name || undefined,
    bankAccountId: b.bank_account_id || b.bankAccountId || undefined,
    bankName: b.bank_name || b.bankName || undefined,
    remarks: b.remarks || undefined,
    type: 'Sales',
  }
}

const salesCache = new Map<string, { data: SalesItem[]; timestamp: number }>()
const SALES_CACHE_TTL = 30000

export const salesService = {
  invalidateCache(): void {
    salesCache.clear()
  },

  async getDailySummary(params?: {
    company?: string
    startDate?: string
    endDate?: string
    viewType?: string
    search?: string
  }): Promise<DailySalesSummaryOut[]> {
    try {
      const query = new URLSearchParams()
      if (params?.company && params.company !== 'All Companies') {
        query.append('company_name', params.company)
      }
      if (params?.startDate) query.append('start_date', params.startDate)
      if (params?.endDate) query.append('end_date', params.endDate)
      if (params?.viewType) query.append('view_type', params.viewType)
      if (params?.search) query.append('search', params.search)

      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/sales/daily-summary?${query.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('Failed to fetch sales daily summary:', err)
    }
    return []
  },

  async getSales(company?: string, forceRefresh = false): Promise<SalesItem[]> {
    const cacheKey = company || 'All Companies'
    if (!forceRefresh) {
      const cached = salesCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < SALES_CACHE_TTL) {
        return cached.data
      }
    }

    try {
      const url =
        company && company !== 'All Companies'
          ? `/api/v1/sales?company_name=${encodeURIComponent(company)}`
          : '/api/v1/sales'

      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          const apiSales = data.map(mapBackendSaleToItem)
          const sorted = apiSales.sort((a, b) => {
            const dateA = a.rawDate || normalizeDateToYYYYMMDD(a.date)
            const dateB = b.rawDate || normalizeDateToYYYYMMDD(b.date)
            const cmp = dateB.localeCompare(dateA)
            if (cmp !== 0) return cmp
            return Number(b.id) - Number(a.id)
          })
          inMemorySales = sorted
          salesCache.set(cacheKey, { data: sorted, timestamp: Date.now() })
          return sorted
        }
      }
    } catch (err) {
      console.warn('Backend /sales fetch error, using local fallback:', err)
    }

    const list =
      !company || company === 'All Companies'
        ? [...inMemorySales]
        : inMemorySales.filter((s) => s.company === company)

    return list.sort((a, b) => {
      const dateA = a.rawDate || normalizeDateToYYYYMMDD(a.date)
      const dateB = b.rawDate || normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) return cmp
      return (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
    })
  },

  async addSale(input: NewSalesInput): Promise<SalesItem> {
    this.invalidateCache()
    let rawDate = input.date
    if (rawDate && rawDate.includes('/')) {
      const p = rawDate.split('/')
      if (p.length === 3) {
        const m = p[0].padStart(2, '0')
        const d = p[1].padStart(2, '0')
        const y = p[2].length === 2 ? `20${p[2]}` : p[2]
        rawDate = `${y}-${m}-${d}`
      }
    }
    const cleanAmount = Math.round(Number(input.amount || 0) * 100) / 100

    const payload = {
      company: input.company,
      transaction_date: rawDate,
      amount: cleanAmount,
      particulars: input.particulars,
      description: input.particulars,
      category: input.category && input.category !== 'None' ? input.category : null,
      payment_method: input.paymentMethod || null,
      payment_status: input.payment_status || (input.status === 'Overdue' ? 'Unpaid' : input.status) || 'Paid',
      deposit_status: input.deposit_status || input.depositStatus || undefined,
      chequeNo: input.chequeNo || undefined,
      bank_account_id: input.bankAccountId || undefined,
      remarks: input.remarks || undefined,
    }

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch('/api/v1/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const created = await res.json()
        const newItem = mapBackendSaleToItem(created)
        if (input.items && input.items.length > 0) {
          newItem.items = input.items
          newItem.status = deriveRecordStatusFromParticulars(
            input.items,
            input.status === 'Unpaid'
              ? 'Unpaid'
              : input.status === 'Pending' || input.status === 'On hold'
                ? 'Pending'
                : 'Paid'
          )
        }
        inMemorySales = [newItem, ...inMemorySales]
        this.invalidateCache()
        return newItem
      } else {
        const errData = await res.json().catch(() => ({}))
        let errorMsg = 'Failed to record sales entry.'
        if (typeof errData.detail === 'string') {
          errorMsg = errData.detail
        } else if (Array.isArray(errData.detail)) {
          errorMsg = errData.detail
            .map((d: any) => {
              const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : ''
              return field ? `${field}: ${d.msg}` : (d.msg || JSON.stringify(d))
            })
            .join('; ')
        } else if (errData.detail && typeof errData.detail === 'object') {
          errorMsg = errData.detail.msg || JSON.stringify(errData.detail)
        } else if (typeof errData.message === 'string') {
          errorMsg = errData.message
        }
        throw new Error(errorMsg)
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch')) {
        throw err
      }
      console.warn('Backend POST /sales failed, creating local record:', err)
      const id = `sale_${Date.now()}`
      const refNo = `REF-${input.date.replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`
      const [year, month, day] = input.date.split('-')
      const displayDate = `${month}/${day}/${year?.slice(2) || '26'}`
      const parsedItems =
        input.items || parseParticulars(input.particulars, null, input.amount)

      const newItem: SalesItem = {
        id,
        refNo,
        chequeNo: input.chequeNo || '',
        date: displayDate,
        rawDate: input.date,
        particulars: input.particulars,
        withdrawal: 0,
        deposit: input.amount,
        netAmount: input.amount,
        category: input.category || 'None',
        paymentMethod: input.paymentMethod,
        company: input.company,
        items: parsedItems,
        status: deriveRecordStatusFromParticulars(
          parsedItems,
          input.status === 'Unpaid'
            ? 'Unpaid'
            : input.status === 'Pending' || input.status === 'On hold'
              ? 'Pending'
              : 'Paid'
        ),
        auditStatus: 'Pending Audit',
        createdBy: 'Company Staff',
        createdAt: new Date().toISOString(),
        updatedBy: input.updatedBy || s.updatedBy,
        updatedAt: input.updatedAt || new Date().toISOString(),
        type: 'Sales',
      }

      inMemorySales = [newItem, ...inMemorySales]
      this.invalidateCache()
      return newItem
    }
  },

  async updateSale(
    id: string,
    input: Partial<NewSalesInput>
  ): Promise<SalesItem> {
    this.invalidateCache()
    const payload: Record<string, any> = {}
    if (input.date) payload.transaction_date = input.date
    if (input.amount !== undefined) payload.amount = input.amount
    if (input.particulars) {
      payload.particulars = input.particulars
      payload.description = input.particulars
    }
    if (input.category !== undefined) {
      payload.category = input.category === 'None' ? null : input.category
    }
    if (input.paymentMethod !== undefined)
      payload.payment_method = input.paymentMethod || null
    if (input.chequeNo !== undefined) payload.chequeNo = input.chequeNo
    if (input.payment_status !== undefined || input.status !== undefined) {
      payload.payment_status = input.payment_status || (input.status === 'Overdue' ? 'Unpaid' : input.status)
    }
    if (input.deposit_status !== undefined || input.depositStatus !== undefined) {
      payload.deposit_status = input.deposit_status || input.depositStatus
    }
    if (input.remarks !== undefined) {
      payload.remarks = input.remarks
    }

    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/sales/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const updated = await res.json()
        const mapped = mapBackendSaleToItem(updated)
        if (input.updatedBy) {
          mapped.updatedBy = input.updatedBy
        }
        if (input.updatedAt) {
          mapped.updatedAt = input.updatedAt
        }
        if (input.items && input.items.length > 0) {
          mapped.items = input.items
          mapped.status = deriveRecordStatusFromParticulars(
            input.items,
            mapped.status === 'Unpaid'
              ? 'Unpaid'
              : mapped.status === 'Pending'
                ? 'Pending'
                : 'Paid'
          )
        } else if (input.status) {
          mapped.status = input.status
        }
        inMemorySales = inMemorySales.map((s) => (s.id === id ? mapped : s))
        this.invalidateCache()
        return mapped
      }
    } catch (err) {
      console.warn('Backend update sale failed, updating locally:', err)
    }

    // Local update fallback
    inMemorySales = inMemorySales.map((s) => {
      if (s.id !== id) return s
      const amt = input.amount !== undefined ? input.amount : s.deposit
      const [year, month, day] = (input.date || s.rawDate || '').split('-')
      const displayDate =
        month && day ? `${month}/${day}/${year?.slice(2) || '26'}` : s.date
      const updatedParticulars = input.particulars || s.particulars
      const updatedItems =
        input.items || parseParticulars(updatedParticulars, s.items, amt)
      return {
        ...s,
        date: input.date ? displayDate : s.date,
        rawDate: input.date || s.rawDate,
        particulars: updatedParticulars,
        chequeNo: input.chequeNo !== undefined ? input.chequeNo : s.chequeNo,
        category: input.category || s.category,
        paymentMethod: input.paymentMethod || s.paymentMethod,
        company: input.company || s.company,
        status:
          input.status ||
          deriveRecordStatusFromParticulars(
            updatedItems,
            s.status === 'Unpaid'
              ? 'Unpaid'
              : s.status === 'Pending'
                ? 'Pending'
                : 'Paid'
          ),
        items: updatedItems,
        deposit: amt,
        netAmount: amt,
        updatedBy: input.updatedBy || s.updatedBy,
        updatedAt: input.updatedAt || new Date().toISOString(),
      }
    })
    this.invalidateCache()
    return inMemorySales.find((s) => s.id === id)!
  },

  async updateSaleDepositStatus(
    id: string,
    depositStatus: 'Deposited' | 'Not Deposited'
  ): Promise<SalesItem> {
    this.invalidateCache()
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null

    const res = await fetch(`/api/v1/sales/${id}/deposit-status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ deposit_status: depositStatus }),
    })

    if (res.ok) {
      const updated = await res.json()
      const mapped = mapBackendSaleToItem(updated)
      inMemorySales = inMemorySales.map((s) => (s.id === id ? mapped : s))
      this.invalidateCache()
      return mapped
    } else {
      const errData = await res.json().catch(() => ({}))
      let errorMsg = 'Failed to update deposit status.'
      if (typeof errData.detail === 'string') {
        errorMsg = errData.detail
      } else if (Array.isArray(errData.detail)) {
        errorMsg = errData.detail
          .map((d: any) => {
            const field = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : ''
            return field ? `${field}: ${d.msg}` : (d.msg || JSON.stringify(d))
          })
          .join('; ')
      } else if (errData.detail && typeof errData.detail === 'object') {
        errorMsg = errData.detail.msg || JSON.stringify(errData.detail)
      } else if (typeof errData.message === 'string') {
        errorMsg = errData.message
      }
      throw new Error(errorMsg)
    }
  },

  async updateSaleRemarks(id: string, remarks: string): Promise<SalesItem> {
    this.invalidateCache()
    const token =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('mct_access_token')
        : null

    const res = await fetch(`/api/v1/sales/${id}/remarks`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ remarks }),
    })

    if (res.ok) {
      const updated = await res.json()
      const mapped = mapBackendSaleToItem(updated)
      inMemorySales = inMemorySales.map((s) => (s.id === id ? mapped : s))
      this.invalidateCache()
      return mapped
    } else {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.detail || 'Failed to update remarks.')
    }
  },

  async deleteSale(id: string): Promise<boolean> {
    this.invalidateCache()
    try {
      const token =
        typeof window !== 'undefined'
          ? sessionStorage.getItem('mct_access_token')
          : null

      const res = await fetch(`/api/v1/sales/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.ok) {
        inMemorySales = inMemorySales.filter((s) => s.id !== id)
        this.invalidateCache()
        return true
      }
    } catch (err) {
      console.warn('Backend delete sale failed, deleting locally:', err)
    }

    inMemorySales = inMemorySales.filter((s) => s.id !== id)
    this.invalidateCache()
    return true
  },

  async updateSaleAuditStatus(
    id: string,
    auditStatus: 'Verified' | 'Pending Audit' | 'Flagged',
    auditedBy?: string,
    auditNotes?: string
  ): Promise<SalesItem | null> {
    // Spec 0014: the server saves the status and stamps who audited and when.
    // `auditedBy` is kept in the signature for existing callers; the server ignores it.
    void auditedBy
    try {
      const saved = await saveAuditReview('sales', id, auditStatus, auditNotes)
      const mapped = mapBackendSaleToItem(saved)
      inMemorySales = inMemorySales.map((s) =>
        s.id === id
          ? {
              ...s,
              auditStatus: mapped.auditStatus,
              auditedBy: mapped.auditedBy,
              auditDate: mapped.auditDate,
              auditNotes: mapped.auditNotes,
              updatedBy: input.updatedBy || s.updatedBy,
        updatedAt: input.updatedAt || new Date().toISOString(),
            }
          : s
      )
      return inMemorySales.find((s) => s.id === id) || mapped
    } finally {
      // Success or failure, the next read must come from the server.
      this.invalidateCache()
    }
  },

  exportCsv(items: SalesItem[], filename = 'sales_report.csv') {
    const headers = [
      'Date',
      'Ref No',
      'Cheque No',
      'Particulars',
      'Withdrawal',
      'Deposit',
      'Net Amount',
      'Payment Method',
      'Company',
    ]

    const rows = items.map((s) => [
      s.date,
      s.refNo,
      s.chequeNo || '—',
      `"${s.particulars.replace(/"/g, '""')}"`,
      s.withdrawal,
      s.deposit,
      s.netAmount,
      s.paymentMethod || 'Cash',
      s.company,
    ])

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  },

  exportPdf(items: SalesItem[], company = 'MCT Kitchen') {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const totalDeposit = items.reduce((sum, s) => sum + (s.deposit || 0), 0)
    const totalWithdrawal = items.reduce((sum, s) => sum + (s.withdrawal || 0), 0)
    const netTotal = totalDeposit - totalWithdrawal

    const rowsHtml =
      items.length === 0
        ? `<tr><td colspan="8" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No sales transactions recorded for this selection.</td></tr>`
        : items
            .map(
              (s) => `
      <tr>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${s.date}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${s.chequeNo || '—'}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${s.particulars}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #dc2626;">${s.withdrawal > 0 ? `₱${s.withdrawal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 600;">${s.deposit > 0 ? `₱${s.deposit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${s.paymentMethod || 'Cash'}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">₱${s.netAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${s.status}</td>
      </tr>
    `
            )
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Sales Summary Report - ${company}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding: 24px; }
            h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; color: #960C01; }
            p { font-size: 12px; color: #64748B; margin: 0 0 16px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; border-bottom: 2px solid #CBD5E1; }
            .summary { margin-top: 20px; padding: 12px 16px; background-color: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 12px; }
            @media print {
              body { padding: 10px; }
              @page { size: landscape; margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <h1>MCT Group of Companies</h1>
          <p>Sales Summary Report for <strong>${company}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Cheque No.</th>
                <th>Particulars</th>
                <th style="text-align: right;">Withdrawal</th>
                <th style="text-align: right;">Deposit</th>
                <th>Payment Method</th>
                <th style="text-align: right;">Net Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Records:</strong> ${items.length}</div>
            <div><strong>Total Sales (Inflows):</strong> ₱${totalDeposit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            <div><strong>Net Total:</strong> ₱${netTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  },

  exportDailySummaryCsv(groups: DailyGroupSummary<SalesItem>[], filename = 'sales_daily_summary.csv') {
    const headers = [
      'Date',
      'Day of Week',
      'Transaction Count',
      'Gross Total',
      'Realized Cash',
      'Audit Status',
    ]

    const rows = groups.map((g) => [
      g.date,
      g.dayOfWeek,
      g.transactionCount,
      g.grossTotal.toFixed(2),
      g.realizedCash.toFixed(2),
      g.auditStatus,
    ])

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  },

  exportDailySummaryPdf(groups: DailyGroupSummary<SalesItem>[], company = 'MCT Kitchen') {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const totalGross = groups.reduce((sum, g) => sum + (g.grossTotal || 0), 0)
    const totalRealized = groups.reduce((sum, g) => sum + (g.realizedCash || 0), 0)
    const totalTransactions = groups.reduce((sum, g) => sum + (g.transactionCount || 0), 0)

    const rowsHtml =
      groups.length === 0
        ? `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No daily sales records available for this selection.</td></tr>`
        : groups
            .map(
              (g) => `
      <tr>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${g.formattedDate || g.date}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${g.dayOfWeek}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${g.transactionCount}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 600;">₱${g.grossTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">₱${g.realizedCash.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; ${
            g.auditStatus === 'All Verified'
              ? 'background: #dcfce7; color: #15803d;'
              : g.auditStatus === 'Discrepancy'
              ? 'background: #ffe4e6; color: #be123c;'
              : 'background: #fef3c7; color: #b45309;'
          }">
            ${g.auditStatus}
          </span>
        </td>
      </tr>
    `
            )
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Daily Sales Summary Report - ${company}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding: 24px; }
            h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; color: #960C01; }
            p { font-size: 12px; color: #64748B; margin: 0 0 16px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; border-bottom: 2px solid #CBD5E1; }
            .summary { margin-top: 20px; padding: 12px 16px; background-color: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 12px; }
            @media print {
              body { padding: 10px; }
              @page { size: landscape; margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <h1>MCT Group of Companies</h1>
          <p>Daily Sales Summary Report for <strong>${company}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th style="text-align: center;">Transactions</th>
                <th style="text-align: right;">Gross Sales</th>
                <th style="text-align: right;">Realized Cash</th>
                <th>Audit Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Days:</strong> ${groups.length} (Total Tx: ${totalTransactions})</div>
            <div><strong>Total Gross Sales:</strong> ₱${totalGross.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            <div><strong>Total Realized Cash:</strong> ₱${totalRealized.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  },


  // Map a SalesItem to DashboardTransactionItem so it can be viewed in AuditTransactionModal
  toDashboardTransaction(sale: SalesItem): DashboardTransactionItem {
    return {
      id: sale.id,
      refNo: sale.refNo,
      chequeNo: sale.chequeNo,
      date: sale.date,
      type: 'Sales',
      company: sale.company,
      description: sale.particulars,
      particulars: sale.particulars,
      amount: sale.deposit,
      withdrawal: sale.withdrawal,
      deposit: sale.deposit,
      category: (sale.category || 'General') as any,
      paymentMethod: sale.paymentMethod,
      status: sale.status,
      auditStatus: sale.auditStatus,
      auditedBy: sale.auditedBy,
      auditNotes: sale.auditNotes,
      auditDate: sale.auditDate,
      createdBy: sale.createdBy,
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt,
      attachments: [],
      items: sale.items || parseParticulars(sale.particulars, null, sale.deposit),
    }
  },
}
