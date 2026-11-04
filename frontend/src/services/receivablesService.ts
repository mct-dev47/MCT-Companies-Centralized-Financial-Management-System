export interface BackendReceivablePayment {
  payment_id: number
  receivable_id: number
  payment_date: string
  amount: number
  payment_method: string
  bank_account_id?: string | null
  reference_no?: string | null
  notes?: string | null
  received_by?: string | null
  created_at?: string | null
}

export interface BackendReceivable {
  receivable_id: number
  company_id: number
  company_name: string
  customer_name: string
  customer_type: 'Internal' | 'External'
  sale_id?: number | null
  sale_line_index?: number | null
  expense_id?: number | null
  transaction_date: string
  items_summary: string
  total_amount: number
  amount_paid: number
  balance: number
  payment_status: 'Unpaid' | 'Partial' | 'Paid'
  is_locked?: boolean
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  payments: BackendReceivablePayment[]
}

export interface BackendReceivablesKPIs {
  totalSales: number
  cashCollected: number
  totalOutstanding: number
  totalExternalUtang: number
  totalStaffUtang: number
  externalDebtorCount: number
  staffDebtorCount: number
  totalPeopleCount: number
}

export interface DebtorBatchUpdateResponse {
  updated_count: number
  skipped_locked_count: number
  customer_name: string
  customer_type: 'Internal' | 'External'
}

export interface DebtorBatchDeleteResponse {
  deleted_count: number
  reversed_payments_total: number
}

function backendHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('mct_access_token') ||
        sessionStorage.getItem('auth_token') ||
        localStorage.getItem('auth_token')
      : null

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export const receivablesService = {
  async listReceivables(params?: {
    company_id?: number
    company_name?: string
    customer_type?: string
    status?: string
    start_date?: string
    end_date?: string
    search?: string
  }): Promise<BackendReceivable[]> {
    const query = new URLSearchParams()
    if (params?.company_id) query.set('company_id', String(params.company_id))
    if (params?.company_name && params.company_name !== 'All Companies') {
      query.set('company_name', params.company_name)
    }
    if (params?.customer_type && params.customer_type !== 'All') {
      query.set('customer_type', params.customer_type)
    }
    if (params?.status && params.status !== 'All') {
      query.set('status', params.status)
    }
    if (params?.start_date) query.set('start_date', params.start_date)
    if (params?.end_date) query.set('end_date', params.end_date)
    if (params?.search) query.set('search', params.search)

    const url = `/api/v1/receivables${query.toString() ? `?${query.toString()}` : ''}`
    const res = await fetch(url, {
      method: 'GET',
      headers: backendHeaders(),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch receivables: ${res.statusText}`)
    }
    return res.json()
  },

  async getSummary(companyName?: string): Promise<BackendReceivablesKPIs> {
    const query = new URLSearchParams()
    if (companyName && companyName !== 'All Companies') {
      query.set('company_name', companyName)
    }
    const url = `/api/v1/receivables/summary${query.toString() ? `?${query.toString()}` : ''}`
    const res = await fetch(url, {
      method: 'GET',
      headers: backendHeaders(),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch receivables summary: ${res.statusText}`)
    }
    return res.json()
  },

  async getReceivable(id: number): Promise<BackendReceivable> {
    const res = await fetch(`/api/v1/receivables/${id}`, {
      method: 'GET',
      headers: backendHeaders(),
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch receivable #${id}`)
    }
    return res.json()
  },

  async createReceivable(data: {
    customer_name: string
    customer_type: string
    items_summary: string
    total_amount: number
    amount_paid?: number
    payment_option?: string
    payment_method?: string
    bank_account_id?: string
    date?: string
    transaction_date?: string
    notes?: string
    company_name?: string
    company_id?: number
    sale_id?: number
    sale_line_index?: number
    expense_id?: number
  }): Promise<BackendReceivable> {
    const res = await fetch('/api/v1/receivables', {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to create receivable: ${res.statusText}`)
    }
    return res.json()
  },

  async updateReceivable(
    id: number,
    data: {
      customer_name?: string
      customer_type?: string
      items_summary?: string
      total_amount?: number
      notes?: string
      transaction_date?: string
      payment_status?: 'Unpaid' | 'Partial' | 'Paid'
      payment_method?: string
      bank_account_id?: string
    }
  ): Promise<BackendReceivable> {
    const res = await fetch(`/api/v1/receivables/${id}`, {
      method: 'PUT',
      headers: backendHeaders(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to update receivable: ${res.statusText}`)
    }
    return res.json()
  },

  async deleteReceivable(id: number): Promise<void> {
    const res = await fetch(`/api/v1/receivables/${id}`, {
      method: 'DELETE',
      headers: backendHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to delete receivable: ${res.statusText}`)
    }
  },

  async updateDebtor(data: {
    current_customer_name?: string
    old_customer_name?: string
    new_customer_name: string
    customer_type: string
    company_id?: number
    company_name?: string
  }): Promise<DebtorBatchUpdateResponse> {
    const payload = {
      current_customer_name: data.current_customer_name || data.old_customer_name || '',
      new_customer_name: data.new_customer_name,
      customer_type: data.customer_type,
      company_id: data.company_id,
      company_name: data.company_name,
    }
    const res = await fetch('/api/v1/receivables/debtor', {
      method: 'PUT',
      headers: backendHeaders(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to update debtor: ${res.statusText}`)
    }
    return res.json()
  },

  async deleteDebtor(data: {
    customer_name: string
    company_id?: number
    company_name?: string
  }): Promise<DebtorBatchDeleteResponse> {
    const params = new URLSearchParams({ customer_name: data.customer_name })
    if (data.company_id !== undefined) params.set('company_id', String(data.company_id))
    if (data.company_name) params.set('company_name', data.company_name)
    const res = await fetch(`/api/v1/receivables/debtor?${params.toString()}`, {
      method: 'DELETE',
      headers: backendHeaders(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to delete debtor: ${res.statusText}`)
    }
    return res.json()
  },

  async recordPayment(
    receivableId: number,
    data: {
      amount: number
      payment_date?: string
      date?: string
      payment_method?: string
      bank_account_id?: string
      reference_no?: string
      notes?: string
    }
  ): Promise<BackendReceivablePayment> {
    const res = await fetch(`/api/v1/receivables/${receivableId}/payments`, {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to record payment: ${res.statusText}`)
    }
    return res.json()
  },

  async settlePayroll(customerName: string, companyId?: number, notes?: string): Promise<any> {
    const res = await fetch('/api/v1/receivables/settle-payroll', {
      method: 'POST',
      headers: backendHeaders(),
      body: JSON.stringify({
        customer_name: customerName,
        company_id: companyId,
        notes,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to settle payroll: ${res.statusText}`)
    }
    return res.json()
  },

  async deletePayment(paymentId: number): Promise<void> {
    const res = await fetch(`/api/v1/receivables/payments/${paymentId}`, {
      method: 'DELETE',
      headers: backendHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Failed to delete payment: ${res.statusText}`)
    }
  },
}
