import { isCompanyMatch } from '@/utils/companyUtils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { websocketService } from './websocketService'
import { receivablesService, type BackendReceivable } from './receivablesService'
import { salesService } from './salesService'

/**
 * In-memory & LocalStorage store for Food Sales Receivables (Utang Management).
 * Supports External Customers & Staff food credit with real-time balance calculations,
 * aging buckets, payments, payroll deductions, and bidirectional Sale sync.
 */

export type CustomerType = 'External' | 'Staff'
export type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid'
export type PaymentMethod = 'Cash' | 'GCash' | 'Bank' | 'Bank Transfer' | 'Payroll Deduction'
export type PaymentOption = 'Paid in full' | 'Partial' | 'Pay Later'

export interface UtangPayment {
  id: string
  sale_id: string
  customer_name: string
  amount: number
  date: string // YYYY-MM-DD
  method: PaymentMethod
  bank_account_id?: string | null
  notes?: string
  createdAt: string
}

export interface UtangSale {
  id: string
  company?: string
  company_id?: number
  sale_id?: number | null
  sale_line_index?: number | null
  expense_id?: number | null
  is_locked?: boolean
  date: string // YYYY-MM-DD
  customer_name: string
  customer_type: CustomerType
  items_summary: string
  total_amount: number
  amount_paid: number
  balance: number
  payment_status: PaymentStatus
  notes?: string
  /** Fixed deposit bank for this order (the sale's bank, else the first payment's bank) */
  origin_bank_account_id?: string | null
  origin_bank_name?: string | null
  /** Deposit status/date of the linked sale */
  deposit_status?: 'Deposited' | 'Not Deposited' | null
  deposit_date?: string | null
  payments: UtangPayment[]
}

export interface PersonLedgerSummary {
  key: string
  name: string
  type: CustomerType
  company: string
  company_id?: number
  has_locked: boolean
  all_locked: boolean
  total_sales_amount: number
  total_amount_paid: number
  total_owed: number
  oldest_unpaid_date: string | null
  last_payment_date: string | null
  status: PaymentStatus
  sales_count: number
  agingBucket: '0-7' | '8-30' | '30+'
  daysOverdue: number
  sales: UtangSale[]
  payments: UtangPayment[]
}

export interface ReceivablesKPIs {
  totalSales: number // all sales volume (paid + unpaid)
  cashCollected: number // actual cash/payments received
  totalOutstanding: number // total unpaid balances
  totalExternalUtang: number
  totalStaffUtang: number
  externalDebtorCount: number
  staffDebtorCount: number
  totalPeopleCount: number
}

const STORAGE_KEY = 'mct_food_receivables_v1'

function getLocalTodayStr(): string {
  return formatToYYYYMMDD(new Date())
}

// Initial Realistic Seed Data: 18 Sales, 10 Customers (5 Staff, 5 External)
const INITIAL_SALES: UtangSale[] = []

class ReceivablesStore {
  private sales: UtangSale[] = []
  private listeners: Set<() => void> = new Set()
  private wsRefreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.load()
    if (typeof window !== 'undefined') {
      void this.refreshFromBackend()
      const scheduleRefresh = () => {
        if (this.wsRefreshTimer) clearTimeout(this.wsRefreshTimer)
        this.wsRefreshTimer = setTimeout(() => {
          void this.refreshFromBackend()
        }, 250)
      }
      websocketService.subscribe('RECEIVABLES_UPDATED', scheduleRefresh)
      websocketService.subscribe('SALES_UPDATED', scheduleRefresh)
      websocketService.subscribe('AUDIT_UPDATED', scheduleRefresh)
    }
  }

  public async refreshFromBackend(): Promise<void> {
    try {
      const data = await receivablesService.listReceivables()
      if (Array.isArray(data)) {
        this.sales = data.map((r: BackendReceivable) => ({
          id: String(r.receivable_id),
          company: r.company_name || '',
          company_id: r.company_id,
          sale_id: r.sale_id ?? null,
          sale_line_index: r.sale_line_index ?? null,
          expense_id: r.expense_id ?? null,
          is_locked: Boolean(r.is_locked),
          date: r.transaction_date,
          customer_name: r.customer_name,
          customer_type: (r.customer_type === 'Internal' ? 'Staff' : 'External') as CustomerType,
          items_summary: r.items_summary,
          total_amount: Number(r.total_amount),
          amount_paid: Number(r.amount_paid),
          balance: Number(r.balance),
          payment_status: r.payment_status as PaymentStatus,
          notes: r.notes || undefined,
          origin_bank_account_id: r.origin_bank_account_id ?? null,
          origin_bank_name: r.origin_bank_name ?? null,
          deposit_status: r.sale_deposit_status ?? null,
          deposit_date: r.sale_deposit_date ?? null,
          payments: (r.payments || []).map((p) => ({
            id: String(p.payment_id),
            sale_id: String(p.receivable_id),
            customer_name: r.customer_name,
            amount: Number(p.amount),
            date: p.payment_date,
            method: (p.payment_method || 'Cash') as PaymentMethod,
            bank_account_id: p.bank_account_id ?? null,
            notes: p.notes || undefined,
            createdAt: p.created_at || new Date().toISOString(),
          })),
        }))
        this.saveToStorageOnly()
        this.notify()
      }
    } catch {
      // Keep optimistic cached data on network error
    }
  }

  private saveToStorageOnly(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sales))
    } catch {
      // ignore quota errors
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.sales = parsed.map((s) => {
            const copy = { ...s }
            delete copy.customer_phone
            delete copy.customer_role
            return {
              ...copy,
              company: copy.company || '',
            }
          })
          return
        }
      }
    } catch {
      // ignore parsing errors
    }
    this.sales = JSON.parse(JSON.stringify(INITIAL_SALES))
    this.save()
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sales))
    } catch {
      // ignore quota errors
    }
    this.notify()
  }

  private notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn()
      } catch (err) {
        console.error('Receivables listener error:', err)
      }
    })
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  public getSales(company?: string): UtangSale[] {
    let list = this.sales
    if (company && company !== 'All Companies') {
      list = list.filter((s) => isCompanyMatch(s.company || '', company))
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date))
  }

  public getAllPayments(company?: string): UtangPayment[] {
    const list: UtangPayment[] = []
    const salesList =
      company && company !== 'All Companies'
        ? this.sales.filter((s) => isCompanyMatch(s.company || '', company))
        : this.sales

    salesList.forEach((s) => {
      ;(s.payments || []).forEach((p) => list.push(p))
    })
    return list.sort((a, b) => b.date.localeCompare(a.date))
  }

  public getPeopleSummaries(company?: string): PersonLedgerSummary[] {
    const map = new Map<
      string,
      {
        key: string
        name: string
        type: CustomerType
        company: string
        company_id?: number
        sales: UtangSale[]
      }
    >()

    const isAllCompanies = !company || company === 'All Companies'

    this.sales.forEach((s) => {
      const saleCompany = s.company || ''
      if (!isAllCompanies && !isCompanyMatch(saleCompany, company!)) {
        return
      }
      const normalizedName = s.customer_name.trim().toLowerCase()
      const groupKey = isAllCompanies
        ? `${saleCompany.trim().toLowerCase()}::${normalizedName}`
        : normalizedName

      if (!map.has(groupKey)) {
        map.set(groupKey, {
          key: groupKey,
          name: s.customer_name,
          type: s.customer_type,
          company: saleCompany,
          company_id: s.company_id,
          sales: [],
        })
      }
      const entry = map.get(groupKey)!
      if (!entry.company_id && s.company_id) {
        entry.company_id = s.company_id
      }
      entry.sales.push(s)
    })

    const todayStr = getLocalTodayStr()
    const today = new Date(`${todayStr}T00:00:00`)

    const summaries: PersonLedgerSummary[] = Array.from(map.values()).map((p) => {
      const sortedSales = [...p.sales].sort((a, b) => a.date.localeCompare(b.date))
      const allPayments: UtangPayment[] = []
      sortedSales.forEach((s) => {
        ;(s.payments || []).forEach((pay) => allPayments.push(pay))
      })
      allPayments.sort((a, b) => a.date.localeCompare(b.date))

      const totalSalesAmount = sortedSales.reduce((acc, s) => acc + s.total_amount, 0)
      const totalAmountPaid = sortedSales.reduce((acc, s) => acc + s.amount_paid, 0)
      const totalOwed = Math.max(0, sortedSales.reduce((acc, s) => acc + s.balance, 0))

      const hasLocked = sortedSales.some((s) => Boolean(s.is_locked))
      const allLocked = sortedSales.length > 0 && sortedSales.every((s) => Boolean(s.is_locked))

      // Oldest unpaid sale date
      const unpaidSales = sortedSales.filter((s) => s.balance > 0.005)
      const oldestUnpaid = unpaidSales.length > 0 ? unpaidSales[0].date : null

      // Days overdue from oldest unpaid
      let daysOverdue = 0
      let agingBucket: '0-7' | '8-30' | '30+' = '0-7'
      if (oldestUnpaid) {
        const d = new Date(`${oldestUnpaid}T00:00:00`)
        const diffMs = today.getTime() - d.getTime()
        daysOverdue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
        if (daysOverdue > 30) {
          agingBucket = '30+'
        } else if (daysOverdue >= 8) {
          agingBucket = '8-30'
        } else {
          agingBucket = '0-7'
        }
      }

      const lastPayment = allPayments.length > 0 ? allPayments[allPayments.length - 1].date : null

      let status: PaymentStatus = 'Paid'
      if (totalOwed > 0.005) {
        status = totalAmountPaid > 0.005 ? 'Partial' : 'Unpaid'
      }

      return {
        key: p.key,
        name: p.name,
        type: p.type,
        company: p.company,
        company_id: p.company_id,
        has_locked: hasLocked,
        all_locked: allLocked,
        total_sales_amount: totalSalesAmount,
        total_amount_paid: totalAmountPaid,
        total_owed: totalOwed,
        oldest_unpaid_date: oldestUnpaid,
        last_payment_date: lastPayment,
        status,
        sales_count: sortedSales.length,
        agingBucket,
        daysOverdue,
        sales: [...sortedSales].reverse(),
        payments: [...allPayments].reverse(),
      }
    })

    return summaries.sort((a, b) => {
      if (b.total_owed !== a.total_owed) {
        return b.total_owed - a.total_owed
      }
      return a.name.localeCompare(b.name)
    })
  }

  public getKPIs(
    dateRange?: { startDate?: string; endDate?: string },
    company?: string
  ): ReceivablesKPIs {
    const people = this.getPeopleSummaries(company)
    let filteredSales = this.sales
    if (company && company !== 'All Companies') {
      filteredSales = filteredSales.filter((s) =>
        isCompanyMatch(s.company || '', company)
      )
    }
    if (dateRange?.startDate && dateRange?.endDate) {
      filteredSales = filteredSales.filter(
        (s) => s.date >= dateRange.startDate! && s.date <= dateRange.endDate!
      )
    }

    const totalSales = filteredSales.reduce((acc, s) => acc + s.total_amount, 0)

    const allPayments = this.getAllPayments(company)
    let filteredPayments = allPayments
    if (dateRange?.startDate && dateRange?.endDate) {
      filteredPayments = allPayments.filter(
        (p) => p.date >= dateRange.startDate! && p.date <= dateRange.endDate!
      )
    }
    const cashCollected = filteredPayments.reduce((acc, p) => acc + p.amount, 0)

    const totalOutstanding = people.reduce((acc, p) => acc + p.total_owed, 0)
    const totalExternalUtang = people
      .filter((p) => p.type === 'External')
      .reduce((acc, p) => acc + p.total_owed, 0)
    const totalStaffUtang = people
      .filter((p) => p.type === 'Staff')
      .reduce((acc, p) => acc + p.total_owed, 0)

    const externalDebtorCount = people.filter((p) => p.type === 'External' && p.total_owed > 0).length
    const staffDebtorCount = people.filter((p) => p.type === 'Staff' && p.total_owed > 0).length

    return {
      totalSales,
      cashCollected,
      totalOutstanding,
      totalExternalUtang,
      totalStaffUtang,
      externalDebtorCount,
      staffDebtorCount,
      totalPeopleCount: people.length,
    }
  }

  /**
   * Record payment for a customer.
   * If sale_id is provided, applies directly to that sale.
   * Otherwise, applies in FIFO order (oldest non-locked unpaid sale first) until amount is exhausted.
   */
  public recordPayment(params: {
    customer_name: string
    amount: number
    date: string
    method: PaymentMethod
    sale_id?: string
    company?: string
    company_id?: number
    bank_account_id?: string
    notes?: string
  }): { success: boolean; message: string } {
    const { customer_name, amount, date, method, sale_id, company, company_id, bank_account_id, notes } =
      params
    if (!amount || amount <= 0) {
      return { success: false, message: 'Payment amount must be greater than zero.' }
    }

    const customerSales = this.sales.filter((s) => {
      const sameName = s.customer_name.trim().toLowerCase() === customer_name.trim().toLowerCase()
      if (!sameName) return false
      if (company && company !== 'All Companies') {
        return isCompanyMatch(s.company || '', company)
      }
      return true
    })

    if (customerSales.length === 0) {
      return { success: false, message: `No sales records found for ${customer_name}.` }
    }

    const unlockedSales = customerSales.filter((s) => !s.is_locked)
    if (unlockedSales.length === 0) {
      return {
        success: false,
        message: 'All linked sales for this account are Verified and locked against modification.',
      }
    }

    const totalBalance = unlockedSales.reduce((acc, s) => acc + s.balance, 0)
    if (amount > totalBalance + 0.005) {
      return {
        success: false,
        message: `Payment amount (₱${amount.toLocaleString()}) cannot exceed unlocked balance (₱${totalBalance.toLocaleString()}).`,
      }
    }

    let remainingToApply = amount
    const paymentTimestamp = new Date().toISOString()

    if (sale_id) {
      const targetSale = this.sales.find((s) => s.id === sale_id)
      if (!targetSale) {
        return { success: false, message: 'Specified sale was not found.' }
      }
      if (targetSale.is_locked) {
        return {
          success: false,
          message: 'This receivable is locked because its linked sale has been Verified by an Auditor.',
        }
      }
      if (amount > targetSale.balance + 0.005) {
        return {
          success: false,
          message: `Payment amount (₱${amount.toLocaleString()}) exceeds sale balance (₱${targetSale.balance.toLocaleString()}).`,
        }
      }

      const paymentRecord: UtangPayment = {
        id: `PAY-${Date.now()}`,
        sale_id: targetSale.id,
        customer_name: targetSale.customer_name,
        amount,
        date,
        method,
        // The order's own bank always wins (the server enforces the same)
        bank_account_id:
          method === 'Payroll Deduction' ? null : targetSale.origin_bank_account_id || bank_account_id || null,
        notes: notes || undefined,
        createdAt: paymentTimestamp,
      }

      targetSale.payments = targetSale.payments || []
      targetSale.payments.push(paymentRecord)
      targetSale.amount_paid += amount
      targetSale.balance = Math.max(0, targetSale.total_amount - targetSale.amount_paid)
      targetSale.payment_status =
        targetSale.balance <= 0.005 ? 'Paid' : targetSale.amount_paid > 0 ? 'Partial' : 'Unpaid'

      const numId = parseInt(targetSale.id, 10)
      if (!isNaN(numId)) {
        receivablesService
          .recordPayment(numId, {
            amount,
            date,
            payment_method: method,
            bank_account_id,
            notes,
          })
          .then(() => {
            salesService.invalidateCache()
            return this.refreshFromBackend()
          })
          .catch(() => {
            salesService.invalidateCache()
            void this.refreshFromBackend()
          })
      }
    } else {
      // FIFO: Oldest non-locked unpaid first
      const unpaidSales = unlockedSales
        .filter((s) => s.balance > 0.005)
        .sort((a, b) => a.date.localeCompare(b.date))

      const backendPromises: Promise<unknown>[] = []

      for (const sale of unpaidSales) {
        if (remainingToApply <= 0.005) break
        const alloc = Math.min(remainingToApply, sale.balance)
        const paymentRecord: UtangPayment = {
          id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sale_id: sale.id,
          customer_name: sale.customer_name,
          amount: alloc,
          date,
          method,
          bank_account_id:
            method === 'Payroll Deduction' ? null : sale.origin_bank_account_id || bank_account_id || null,
          notes: notes || undefined,
          createdAt: paymentTimestamp,
        }

        sale.payments = sale.payments || []
        sale.payments.push(paymentRecord)
        sale.amount_paid += alloc
        sale.balance = Math.max(0, sale.total_amount - sale.amount_paid)
        sale.payment_status =
          sale.balance <= 0.005 ? 'Paid' : sale.amount_paid > 0 ? 'Partial' : 'Unpaid'

        const numId = parseInt(sale.id, 10)
        if (!isNaN(numId) && method !== 'Payroll Deduction') {
          backendPromises.push(
            receivablesService.recordPayment(numId, {
              amount: alloc,
              date,
              payment_method: method,
              bank_account_id,
              notes,
            })
          )
        }

        remainingToApply -= alloc
      }

      if (method === 'Payroll Deduction') {
        receivablesService
          .settlePayroll(customer_name, company_id, notes)
          .then(() => {
            salesService.invalidateCache()
            return this.refreshFromBackend()
          })
          .catch(() => {
            salesService.invalidateCache()
            void this.refreshFromBackend()
          })
      } else if (backendPromises.length > 0) {
        Promise.allSettled(backendPromises).then(() => {
          void this.refreshFromBackend()
        })
      }
    }

    this.save()
    return {
      success: true,
      message: `Successfully recorded payment of ₱${amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} for ${customer_name}.`,
    }
  }

  /**
   * Settle staff credit via payroll deduction (marks all non-locked outstanding sales as settled).
   */
  public settleStaffPayrollDeduction(
    customer_name: string,
    notes?: string,
    company_id?: number,
    company?: string
  ): { success: boolean; message: string } {
    const staffSales = this.sales.filter((s) => {
      const sameName = s.customer_name.trim().toLowerCase() === customer_name.trim().toLowerCase()
      if (!sameName || s.balance <= 0.005 || s.is_locked) return false
      if (company && company !== 'All Companies') {
        return isCompanyMatch(s.company || '', company)
      }
      return true
    })

    if (staffSales.length === 0) {
      return {
        success: false,
        message: `No unlocked outstanding balance found for staff ${customer_name}.`,
      }
    }

    const todayStr = getLocalTodayStr()
    let totalDeducted = 0
    const targetCompanyId = company_id || staffSales[0]?.company_id

    staffSales.forEach((sale) => {
      const balanceToDeduct = sale.balance
      totalDeducted += balanceToDeduct

      const paymentRecord: UtangPayment = {
        id: `PAY-PAYROLL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sale_id: sale.id,
        customer_name: sale.customer_name,
        amount: balanceToDeduct,
        date: todayStr,
        method: 'Payroll Deduction',
        notes: notes || 'Settled via semi-monthly payroll deduction',
        createdAt: new Date().toISOString(),
      }

      sale.payments = sale.payments || []
      sale.payments.push(paymentRecord)
      sale.amount_paid = sale.total_amount
      sale.balance = 0
      sale.payment_status = 'Paid'
    })

    this.save()
    receivablesService
      .settlePayroll(customer_name, targetCompanyId, notes)
      .then(() => this.refreshFromBackend())
      .catch(() => {
        void this.refreshFromBackend()
      })

    return {
      success: true,
      message: `Successfully deducted ₱${totalDeducted.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} from payroll for ${customer_name}. Balance settled.`,
    }
  }

  /**
   * Add a new food sale / receivable entry.
   */
  public addNewSale(params: {
    customer_name: string
    customer_type: CustomerType
    items_summary: string
    total_amount: number
    payment_option: PaymentOption
    amount_paid?: number
    payment_method?: PaymentMethod
    bank_account_id?: string
    date?: string
    notes?: string
    company?: string
    company_id?: number
    sale_id?: number
    sale_line_index?: number
    expense_id?: number
  }): UtangSale {
    const saleId = `SALE-2026-${String(this.sales.length + 101).padStart(3, '0')}`
    const todayStr = params.date || getLocalTodayStr()
    const totalAmount = Math.max(0, params.total_amount)

    let amountPaid = 0
    let paymentStatus: PaymentStatus = 'Unpaid'
    const payments: UtangPayment[] = []

    if (params.payment_option === 'Paid in full') {
      amountPaid = totalAmount
      paymentStatus = 'Paid'
      payments.push({
        id: `PAY-${Date.now()}`,
        sale_id: saleId,
        customer_name: params.customer_name,
        amount: totalAmount,
        date: todayStr,
        method: params.payment_method || 'Cash',
        bank_account_id: params.bank_account_id || null,
        notes: 'Paid in full at counter',
        createdAt: new Date().toISOString(),
      })
    } else if (params.payment_option === 'Partial') {
      amountPaid = Math.min(totalAmount, Math.max(0, params.amount_paid || 0))
      paymentStatus = amountPaid >= totalAmount ? 'Paid' : amountPaid > 0 ? 'Partial' : 'Unpaid'
      if (amountPaid > 0) {
        payments.push({
          id: `PAY-${Date.now()}`,
          sale_id: saleId,
          customer_name: params.customer_name,
          amount: amountPaid,
          date: todayStr,
          method: params.payment_method || 'Cash',
          bank_account_id: params.bank_account_id || null,
          notes: 'Partial payment on food sale',
          createdAt: new Date().toISOString(),
        })
      }
    } else {
      amountPaid = 0
      paymentStatus = 'Unpaid'
    }

    const newSale: UtangSale = {
      id: saleId,
      company: params.company || '',
      company_id: params.company_id,
      sale_id: params.sale_id ?? null,
      sale_line_index: params.sale_line_index ?? null,
      expense_id: params.expense_id ?? null,
      is_locked: false,
      date: todayStr,
      customer_name: params.customer_name.trim(),
      customer_type: params.customer_type,
      items_summary: params.items_summary.trim(),
      total_amount: totalAmount,
      amount_paid: amountPaid,
      balance: Math.max(0, totalAmount - amountPaid),
      payment_status: paymentStatus,
      notes: params.notes || undefined,
      payments,
    }

    this.sales.unshift(newSale)
    this.save()

    const customerTypeApi = params.customer_type === 'Staff' ? 'Internal' : 'External'
    receivablesService
      .createReceivable({
        customer_name: params.customer_name.trim(),
        customer_type: customerTypeApi,
        items_summary: params.items_summary.trim(),
        total_amount: totalAmount,
        amount_paid: amountPaid,
        payment_option: params.payment_option,
        payment_method: params.payment_method,
        bank_account_id: params.bank_account_id,
        notes: params.notes,
        company_name: params.company || '',
        company_id: params.company_id,
        sale_id: params.sale_id,
        sale_line_index: params.sale_line_index,
        expense_id: params.expense_id,
        date: todayStr,
      })
      .then((created) => {
        if (created?.receivable_id) {
          newSale.id = String(created.receivable_id)
          newSale.company_id = created.company_id
          this.saveToStorageOnly()
          this.notify()
        }
      })
      .catch(() => {})

    return newSale
  }

  public async editSale(
    saleId: string,
    params: {
      customer_name?: string
      customer_type?: CustomerType
      items_summary?: string
      total_amount?: number
      notes?: string
      date?: string
      payment_status?: PaymentStatus
      payment_method?: string
      bank_account_id?: string
      deposit_status?: 'Deposited' | 'Not Deposited'
      deposit_date?: string
    }
  ): Promise<{ success: boolean; message: string }> {
    const sale = this.sales.find((s) => s.id === saleId)
    if (!sale) return { success: false, message: 'Receivable not found' }
    if (sale.is_locked) {
      return {
        success: false,
        message: 'This receivable is locked because its linked sale has been Verified by an Auditor.',
      }
    }

    const numId = parseInt(saleId, 10)
    if (!isNaN(numId)) {
      try {
        await receivablesService.updateReceivable(numId, {
          customer_name: params.customer_name,
          customer_type:
            params.customer_type === 'Staff'
              ? 'Internal'
              : params.customer_type === 'External'
                ? 'External'
                : undefined,
          items_summary: params.items_summary,
          total_amount: params.total_amount,
          notes: params.notes,
          transaction_date: params.date,
          payment_status: params.payment_status,
          payment_method: params.payment_method,
          bank_account_id: params.bank_account_id,
          deposit_status: params.deposit_status,
          deposit_date: params.deposit_status === 'Deposited' ? params.deposit_date : undefined,
        })
        salesService.invalidateCache()
        await this.refreshFromBackend()
        return { success: true, message: 'Receivable updated successfully' }
      } catch (err: any) {
        return { success: false, message: err?.message || 'Failed to update on server' }
      }
    }

    if (params.customer_name) sale.customer_name = params.customer_name.trim()
    if (params.customer_type) sale.customer_type = params.customer_type
    if (params.items_summary) sale.items_summary = params.items_summary.trim()
    if (params.notes !== undefined) sale.notes = params.notes
    if (params.date) sale.date = params.date
    if (params.total_amount !== undefined) {
      sale.total_amount = Math.max(0, params.total_amount)
    }
    if (params.payment_status === 'Unpaid') {
      sale.payments = []
      sale.amount_paid = 0
      sale.balance = sale.total_amount
      sale.payment_status = 'Unpaid'
    } else if (params.payment_status === 'Paid') {
      const rem = Math.max(0, sale.total_amount - sale.amount_paid)
      if (rem > 0) {
        sale.payments = sale.payments || []
        sale.payments.push({
          id: `PAY-${Date.now()}`,
          sale_id: sale.id,
          customer_name: sale.customer_name,
          amount: rem,
          date: params.date || getLocalTodayStr(),
          method: (params.payment_method || 'Cash') as PaymentMethod,
          bank_account_id: params.bank_account_id || null,
          createdAt: new Date().toISOString(),
        })
      }
      sale.amount_paid = sale.total_amount
      sale.balance = 0
      sale.payment_status = 'Paid'
    } else {
      sale.balance = Math.max(0, sale.total_amount - sale.amount_paid)
      sale.payment_status =
        sale.balance <= 0.005 ? 'Paid' : sale.amount_paid > 0 ? 'Partial' : 'Unpaid'
    }
    this.save()
    return { success: true, message: 'Receivable updated successfully' }
  }

  public async updateDebtor(params: {
    old_customer_name: string
    new_customer_name: string
    customer_type: CustomerType
    company?: string
    company_id?: number
  }): Promise<{ success: boolean; message: string }> {
    const newName = params.new_customer_name.trim()
    if (!newName) {
      return { success: false, message: 'Customer or staff name cannot be empty.' }
    }

    const hasBackendRecords = this.sales.some(
      (s) =>
        s.customer_name.trim().toLowerCase() === params.old_customer_name.trim().toLowerCase() &&
        !isNaN(parseInt(s.id, 10))
    )

    if (hasBackendRecords) {
      try {
        await receivablesService.updateDebtor({
          old_customer_name: params.old_customer_name,
          new_customer_name: newName,
          customer_type: params.customer_type === 'Staff' ? 'Internal' : 'External',
          company_id: params.company_id,
          company_name:
            params.company && params.company !== 'All Companies' ? params.company : undefined,
        })
        await this.refreshFromBackend()
        return { success: true, message: `Updated debtor profile for ${newName}.` }
      } catch (err: any) {
        return { success: false, message: err?.message || 'Failed to update debtor profile.' }
      }
    }

    this.sales.forEach((s) => {
      const sameName =
        s.customer_name.trim().toLowerCase() === params.old_customer_name.trim().toLowerCase()
      const sameCompany =
        !params.company ||
        params.company === 'All Companies' ||
        isCompanyMatch(s.company || '', params.company)
      if (sameName && sameCompany && !s.is_locked) {
        s.customer_name = newName
        s.customer_type = params.customer_type
      }
    })
    this.save()
    return { success: true, message: `Updated debtor profile for ${newName}.` }
  }

  public async deleteDebtor(params: {
    customer_name: string
    company?: string
    company_id?: number
  }): Promise<{ success: boolean; message: string }> {
    const matching = this.sales.filter((s) => {
      const sameName =
        s.customer_name.trim().toLowerCase() === params.customer_name.trim().toLowerCase()
      const sameCompany =
        !params.company ||
        params.company === 'All Companies' ||
        isCompanyMatch(s.company || '', params.company)
      return sameName && sameCompany
    })

    if (matching.some((s) => s.is_locked)) {
      return {
        success: false,
        message: 'Cannot delete debtor account because one or more linked sales are Verified and locked.',
      }
    }

    const hasBackendRecords = matching.some((s) => !isNaN(parseInt(s.id, 10)))
    if (hasBackendRecords) {
      try {
        await receivablesService.deleteDebtor({
          customer_name: params.customer_name,
          company_id: params.company_id,
          company_name:
            params.company && params.company !== 'All Companies' ? params.company : undefined,
        })
        await this.refreshFromBackend()
        return { success: true, message: `Deleted debtor account for ${params.customer_name}.` }
      } catch (err: any) {
        return { success: false, message: err?.message || 'Failed to delete debtor account.' }
      }
    }

    this.sales = this.sales.filter((s) => !matching.includes(s))
    this.save()
    return { success: true, message: `Deleted debtor account for ${params.customer_name}.` }
  }

  public async deleteSale(saleId: string): Promise<{ success: boolean; message: string }> {
    const target = this.sales.find((s) => s.id === saleId)
    if (target?.is_locked) {
      return {
        success: false,
        message: 'This receivable is locked because its linked sale has been Verified by an Auditor.',
      }
    }

    const numId = parseInt(saleId, 10)
    if (!isNaN(numId)) {
      try {
        await receivablesService.deleteReceivable(numId)
        await this.refreshFromBackend()
        return { success: true, message: 'Receivable deleted successfully' }
      } catch (err: any) {
        return { success: false, message: err?.message || 'Failed to delete on server' }
      }
    }
    this.sales = this.sales.filter((s) => s.id !== saleId)
    this.save()
    return { success: true, message: 'Receivable deleted successfully' }
  }

  public async deletePayment(paymentId: string): Promise<{ success: boolean; message: string }> {
    const parentSale = this.sales.find((s) => (s.payments || []).some((p) => p.id === paymentId))
    if (parentSale?.is_locked) {
      return {
        success: false,
        message: 'Cannot reverse payment because its linked sale has been Verified by an Auditor.',
      }
    }

    const numId = parseInt(paymentId, 10)
    if (!isNaN(numId)) {
      try {
        await receivablesService.deletePayment(numId)
        await this.refreshFromBackend()
        return { success: true, message: 'Payment reversed successfully' }
      } catch (err: any) {
        return { success: false, message: err?.message || 'Failed to reverse payment on server' }
      }
    }
    for (const sale of this.sales) {
      const pIdx = (sale.payments || []).findIndex((p) => p.id === paymentId)
      if (pIdx !== -1) {
        const removedPay = sale.payments[pIdx]
        sale.payments.splice(pIdx, 1)
        sale.amount_paid = Math.max(0, sale.amount_paid - removedPay.amount)
        sale.balance = Math.max(0, sale.total_amount - sale.amount_paid)
        sale.payment_status =
          sale.balance <= 0.005 ? 'Paid' : sale.amount_paid > 0 ? 'Partial' : 'Unpaid'
        break
      }
    }
    this.save()
    return { success: true, message: 'Payment reversed successfully' }
  }

  public resetToDefault(): void {
    this.sales = JSON.parse(JSON.stringify(INITIAL_SALES))
    this.save()
  }
}

export const receivablesStore = new ReceivablesStore()
