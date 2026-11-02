import { isCompanyMatch } from '@/utils/companyUtils'
/**
 * In-memory & LocalStorage store for Food Sales Receivables (Utang Management).
 * Supports External Customers & Staff food credit with real-time balance calculations,
 * aging buckets, payments, and payroll deductions.
 */

export type CustomerType = 'External' | 'Staff'
export type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid'
export type PaymentMethod = 'Cash' | 'GCash' | 'Bank' | 'Payroll Deduction'
export type PaymentOption = 'Paid in full' | 'Partial' | 'Pay Later'

export interface UtangPayment {
  id: string
  sale_id: string
  customer_name: string
  amount: number
  date: string // YYYY-MM-DD
  method: PaymentMethod
  notes?: string
  createdAt: string
}

export interface UtangSale {
  id: string
  company?: string
  date: string // YYYY-MM-DD
  customer_name: string
  customer_type: CustomerType
  customer_phone?: string
  customer_role?: string
  items_summary: string
  total_amount: number
  amount_paid: number
  balance: number
  payment_status: PaymentStatus
  notes?: string
  payments: UtangPayment[]
}

export interface PersonLedgerSummary {
  name: string
  type: CustomerType
  role_or_dept: string
  phone: string
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

// Initial Realistic Seed Data: 18 Sales, 10 Customers (5 Staff, 5 External)
const INITIAL_SALES: UtangSale[] = [
  {
    id: 'SALE-2026-001',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-11-02',
    customer_name: 'Maria Santos',
    customer_type: 'Staff',
    customer_role: 'Kitchen Cook',
    customer_phone: '0917-234-5678',
    items_summary: 'Pork Sisig Rice Meal (x2), Mountain Dew (x2)',
    total_amount: 380,
    amount_paid: 0,
    balance: 380,
    payment_status: 'Unpaid',
    notes: 'Dinner after afternoon kitchen shift',
    payments: [],
  },
  {
    id: 'SALE-2026-002',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-11-02',
    customer_name: 'Mang Jose Mercado',
    customer_type: 'External',
    customer_role: 'Regular Diner / Neighbor',
    customer_phone: '0922-345-6789',
    items_summary: 'Crispy Pata Regular, Sinigang na Baboy, Plain Rice (x3)',
    total_amount: 1450,
    amount_paid: 500,
    balance: 950,
    payment_status: 'Partial',
    notes: 'Down payment given via Cash; balance tomorrow',
    payments: [
      {
        id: 'PAY-101',
        sale_id: 'SALE-2026-002',
        customer_name: 'Mang Jose Mercado',
        amount: 500,
        date: '2026-11-02',
        method: 'Cash',
        notes: 'Initial cash down payment on dine-in bill',
        createdAt: '2026-11-02T12:30:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-003',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-11-01',
    customer_name: 'Juan Dela Cruz',
    customer_type: 'Staff',
    customer_role: 'Head Cashier',
    customer_phone: '0918-456-7890',
    items_summary: 'Beef Pares Mami with Egg, Garlic Rice',
    total_amount: 220,
    amount_paid: 220,
    balance: 0,
    payment_status: 'Paid',
    notes: 'Paid cash at counter',
    payments: [
      {
        id: 'PAY-102',
        sale_id: 'SALE-2026-003',
        customer_name: 'Juan Dela Cruz',
        amount: 220,
        date: '2026-11-01',
        method: 'Cash',
        notes: 'Paid in full upon pickup',
        createdAt: '2026-11-01T13:10:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-004',
    company: 'MCTolentino Hospitality Business Corporation',
    date: '2026-10-31',
    customer_name: 'Arlene Ramos',
    customer_type: 'Staff',
    customer_role: 'Barista',
    customer_phone: '0919-567-8901',
    items_summary: 'Chicken Inasal Platter, Extra Rice, Iced Tea',
    total_amount: 290,
    amount_paid: 100,
    balance: 190,
    payment_status: 'Partial',
    notes: 'Paid ₱100 via GCash, remaining ₱190 on payday',
    payments: [
      {
        id: 'PAY-103',
        sale_id: 'SALE-2026-004',
        customer_name: 'Arlene Ramos',
        amount: 100,
        date: '2026-10-31',
        method: 'GCash',
        notes: 'GCash ref #82910',
        createdAt: '2026-10-31T17:45:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-005',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-10-29',
    customer_name: 'Eduardo "Ed" Lim',
    customer_type: 'External',
    customer_role: 'Delivery Driver / Contractor',
    customer_phone: '0924-678-9012',
    items_summary: 'Breakfast Tapsilog (x3), Hot Brewed Coffee (x3)',
    total_amount: 570,
    amount_paid: 0,
    balance: 570,
    payment_status: 'Unpaid',
    notes: 'Driver team breakfast, to settle on weekly payout',
    payments: [],
  },
  {
    id: 'SALE-2026-006',
    company: 'MCTolentino Hospitality Business Corporation',
    date: '2026-10-27',
    customer_name: 'Michael Tan',
    customer_type: 'Staff',
    customer_role: 'Dining Server',
    customer_phone: '0920-789-0123',
    items_summary: 'Lechon Kawali Special, Coke (x2)',
    total_amount: 310,
    amount_paid: 0,
    balance: 310,
    payment_status: 'Unpaid',
    notes: 'Staff meal on credit',
    payments: [],
  },
  {
    id: 'SALE-2026-007',
    company: 'JK Global Headways Inc.',
    date: '2026-10-24',
    customer_name: 'Corazon "Cora" Aquino',
    customer_type: 'External',
    customer_role: 'Office Catering Client',
    customer_phone: '0923-890-1234',
    items_summary: 'Pancit Bihon Party Tray, Lumpiang Shanghai (x20)',
    total_amount: 2200,
    amount_paid: 1000,
    balance: 1200,
    payment_status: 'Partial',
    notes: 'Meeting snack package; bank transfer deposit received',
    payments: [
      {
        id: 'PAY-104',
        sale_id: 'SALE-2026-007',
        customer_name: 'Corazon "Cora" Aquino',
        amount: 1000,
        date: '2026-10-25',
        method: 'Bank',
        notes: 'BDO online transfer ref #BDO-9812',
        createdAt: '2026-10-25T09:15:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-008',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-10-21',
    customer_name: 'Grace Bautista',
    customer_type: 'Staff',
    customer_role: 'Shift Supervisor',
    customer_phone: '0921-901-2345',
    items_summary: 'Burger Steak Meal, Halo-Halo Special',
    total_amount: 260,
    amount_paid: 260,
    balance: 0,
    payment_status: 'Paid',
    notes: 'Settled via GCash',
    payments: [
      {
        id: 'PAY-105',
        sale_id: 'SALE-2026-008',
        customer_name: 'Grace Bautista',
        amount: 260,
        date: '2026-10-21',
        method: 'GCash',
        notes: 'Paid immediately via GCash',
        createdAt: '2026-10-21T18:00:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-009',
    company: 'JK Global Headways Inc.',
    date: '2026-10-18',
    customer_name: 'Capt. Rodolfo Reyes',
    customer_type: 'External',
    customer_role: 'Barangay 7 Hall Officer',
    customer_phone: '0925-012-3456',
    items_summary: 'Beef Caldereta Feast, Pork BBQ Skewers (x15), Rice (x10)',
    total_amount: 3400,
    amount_paid: 1500,
    balance: 1900,
    payment_status: 'Partial',
    notes: 'Barangay tanod dinner. Partial cash provided by treasurer.',
    payments: [
      {
        id: 'PAY-106',
        sale_id: 'SALE-2026-009',
        customer_name: 'Capt. Rodolfo Reyes',
        amount: 1500,
        date: '2026-10-19',
        method: 'Cash',
        notes: 'Cash voucher remittance',
        createdAt: '2026-10-19T10:00:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-010',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-10-15',
    customer_name: 'Elena Gomez',
    customer_type: 'External',
    customer_role: 'Nearby Store Owner',
    customer_phone: '0926-123-4567',
    items_summary: 'Kare-Kare Special, Rice (x2), Sago\'t Gulaman',
    total_amount: 480,
    amount_paid: 0,
    balance: 480,
    payment_status: 'Unpaid',
    notes: 'Listahan ni Aling Elena; to pay Friday',
    payments: [],
  },
  {
    id: 'SALE-2026-011',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-10-12',
    customer_name: 'Maria Santos',
    customer_type: 'Staff',
    customer_role: 'Kitchen Cook',
    customer_phone: '0917-234-5678',
    items_summary: 'Bangus Silog, Hot Tea',
    total_amount: 180,
    amount_paid: 180,
    balance: 0,
    payment_status: 'Paid',
    notes: 'Staff breakfast settled in cash',
    payments: [
      {
        id: 'PAY-107',
        sale_id: 'SALE-2026-011',
        customer_name: 'Maria Santos',
        amount: 180,
        date: '2026-10-12',
        method: 'Cash',
        notes: 'Paid upon preparation',
        createdAt: '2026-10-12T08:30:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-012',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-10-08',
    customer_name: 'Mang Jose Mercado',
    customer_type: 'External',
    customer_role: 'Regular Diner / Neighbor',
    customer_phone: '0922-345-6789',
    items_summary: 'Grilled Liempo with Rice, Calamansi Juice (x2)',
    total_amount: 360,
    amount_paid: 150,
    balance: 210,
    payment_status: 'Partial',
    notes: 'Gave ₱150 loose change; ₱210 carried over',
    payments: [
      {
        id: 'PAY-108',
        sale_id: 'SALE-2026-012',
        customer_name: 'Mang Jose Mercado',
        amount: 150,
        date: '2026-10-08',
        method: 'Cash',
        notes: 'Loose bill partial payment',
        createdAt: '2026-10-08T19:30:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-013',
    company: 'MCTolentino Hospitality Business Corporation',
    date: '2026-09-30',
    customer_name: 'Eduardo "Ed" Lim',
    customer_type: 'External',
    customer_role: 'Delivery Driver / Contractor',
    customer_phone: '0924-678-9012',
    items_summary: 'Chicharron Bulaklak, San Mig Light (x6)',
    total_amount: 980,
    amount_paid: 0,
    balance: 980,
    payment_status: 'Unpaid',
    notes: 'End of month after-shift gathering; promised settlement',
    payments: [],
  },
  {
    id: 'SALE-2026-014',
    company: 'MCTolentino Hospitality Business Corporation',
    date: '2026-09-25',
    customer_name: 'Michael Tan',
    customer_type: 'Staff',
    customer_role: 'Dining Server',
    customer_phone: '0920-789-0123',
    items_summary: 'Spaghetti with Garlic Bread, Fried Chicken (x2)',
    total_amount: 420,
    amount_paid: 150,
    balance: 270,
    payment_status: 'Partial',
    notes: 'Partial payment sent via GCash',
    payments: [
      {
        id: 'PAY-109',
        sale_id: 'SALE-2026-014',
        customer_name: 'Michael Tan',
        amount: 150,
        date: '2026-09-28',
        method: 'GCash',
        notes: 'GCash partial transfer',
        createdAt: '2026-09-28T14:10:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-015',
    company: 'JK Global Headways Inc.',
    date: '2026-09-18',
    customer_name: 'Corazon "Cora" Aquino',
    customer_type: 'External',
    customer_role: 'Office Catering Client',
    customer_phone: '0923-890-1234',
    items_summary: 'Arroz Caldo with Tokwa\'t Baboy (x5)',
    total_amount: 850,
    amount_paid: 850,
    balance: 0,
    payment_status: 'Paid',
    notes: 'Morning rainy day team snack; fully paid',
    payments: [
      {
        id: 'PAY-110',
        sale_id: 'SALE-2026-015',
        customer_name: 'Corazon "Cora" Aquino',
        amount: 850,
        date: '2026-09-18',
        method: 'GCash',
        notes: 'Full GCash settlement ref #77291',
        createdAt: '2026-09-18T11:20:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-016',
    company: 'MCTolentino Hospitality Business Corporation',
    date: '2026-09-12',
    customer_name: 'Arlene Ramos',
    customer_type: 'Staff',
    customer_role: 'Barista',
    customer_phone: '0919-567-8901',
    items_summary: 'Bicol Express Rice Bowl, Bottled Water',
    total_amount: 190,
    amount_paid: 0,
    balance: 190,
    payment_status: 'Unpaid',
    notes: 'Quick lunch takeaway',
    payments: [],
  },
  {
    id: 'SALE-2026-017',
    company: 'MyCity.Kitchen Corporation',
    date: '2026-09-05',
    customer_name: 'Elena Gomez',
    customer_type: 'External',
    customer_role: 'Nearby Store Owner',
    customer_phone: '0926-123-4567',
    items_summary: 'Crispy Pata Large, Party Rice',
    total_amount: 1650,
    amount_paid: 1650,
    balance: 0,
    payment_status: 'Paid',
    notes: 'Sunday family lunch; fully settled cash',
    payments: [
      {
        id: 'PAY-111',
        sale_id: 'SALE-2026-017',
        customer_name: 'Elena Gomez',
        amount: 1650,
        date: '2026-09-05',
        method: 'Cash',
        notes: 'Paid in full at counter',
        createdAt: '2026-09-05T13:40:00Z',
      },
    ],
  },
  {
    id: 'SALE-2026-018',
    company: 'JK Global Headways Inc.',
    date: '2026-08-28',
    customer_name: 'Capt. Rodolfo Reyes',
    customer_type: 'External',
    customer_role: 'Barangay 7 Hall Officer',
    customer_phone: '0925-012-3456',
    items_summary: 'Barangay Meeting Snacks & Coffee (x15)',
    total_amount: 1800,
    amount_paid: 0,
    balance: 1800,
    payment_status: 'Unpaid',
    notes: 'Awaiting barangay council fund disbursement',
    payments: [],
  },
]

class ReceivablesStore {
  private sales: UtangSale[] = []
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.sales = parsed.map((s) => ({
            ...s,
            company: s.company || 'MyCity.Kitchen Corporation',
          }))
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
      list = list.filter((s) => isCompanyMatch(s.company || 'MyCity.Kitchen Corporation', company))
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date))
  }

  public getAllPayments(company?: string): UtangPayment[] {
    const list: UtangPayment[] = []
    const salesList = company && company !== 'All Companies'
      ? this.sales.filter((s) => isCompanyMatch(s.company || 'MyCity.Kitchen Corporation', company))
      : this.sales

    salesList.forEach((s) => {
      (s.payments || []).forEach((p) => list.push(p))
    })
    return list.sort((a, b) => b.date.localeCompare(a.date))
  }

  public getPeopleSummaries(company?: string): PersonLedgerSummary[] {
    const map = new Map<string, {
      name: string
      type: CustomerType
      role: string
      phone: string
      sales: UtangSale[]
    }>()

    this.sales.forEach((s) => {
      if (company && company !== 'All Companies') {
        const saleCompany = s.company || 'MyCity.Kitchen Corporation'
        if (!isCompanyMatch(saleCompany, company)) {
          return
        }
      }
      const key = s.customer_name.trim().toLowerCase()
      if (!map.has(key)) {
        map.set(key, {
          name: s.customer_name,
          type: s.customer_type,
          role: s.customer_role || (s.customer_type === 'Staff' ? 'Staff Member' : 'Customer'),
          phone: s.customer_phone || '—',
          sales: [],
        })
      }
      map.get(key)!.sales.push(s)
    })

    const today = new Date('2026-11-02T00:00:00')

    const summaries: PersonLedgerSummary[] = Array.from(map.values()).map((p) => {
      const sortedSales = [...p.sales].sort((a, b) => a.date.localeCompare(b.date))
      const allPayments: UtangPayment[] = []
      sortedSales.forEach((s) => {
        (s.payments || []).forEach((pay) => allPayments.push(pay))
      })
      allPayments.sort((a, b) => a.date.localeCompare(b.date))

      const totalSalesAmount = sortedSales.reduce((acc, s) => acc + s.total_amount, 0)
      const totalAmountPaid = sortedSales.reduce((acc, s) => acc + s.amount_paid, 0)
      const totalOwed = Math.max(0, sortedSales.reduce((acc, s) => acc + s.balance, 0))

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

      // Last payment date
      const lastPayment = allPayments.length > 0 ? allPayments[allPayments.length - 1].date : null

      // Overall status
      let status: PaymentStatus = 'Paid'
      if (totalOwed > 0) {
        status = totalAmountPaid > 0 ? 'Partial' : 'Unpaid'
      }

      return {
        name: p.name,
        type: p.type,
        role_or_dept: p.role,
        phone: p.phone,
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

    // Sort: highest balance first, then name
    return summaries.sort((a, b) => {
      if (b.total_owed !== a.total_owed) {
        return b.total_owed - a.total_owed
      }
      return a.name.localeCompare(b.name)
    })
  }

  public getKPIs(dateRange?: { startDate?: string; endDate?: string }, company?: string): ReceivablesKPIs {
    const people = this.getPeopleSummaries(company)
    let filteredSales = this.sales
    if (company && company !== 'All Companies') {
      filteredSales = filteredSales.filter((s) =>
        isCompanyMatch(s.company || 'MyCity.Kitchen Corporation', company)
      )
    }
    if (dateRange?.startDate && dateRange?.endDate) {
      filteredSales = filteredSales.filter(
        (s) => s.date >= dateRange.startDate! && s.date <= dateRange.endDate!
      )
    }

    const totalSales = filteredSales.reduce((acc, s) => acc + s.total_amount, 0)

    // Cash collected = sum of payments made in that period (or all payments)
    const allPayments = this.getAllPayments(company)
    let filteredPayments = allPayments
    if (dateRange?.startDate && dateRange?.endDate) {
      filteredPayments = allPayments.filter(
        (p) => p.date >= dateRange.startDate! && p.date <= dateRange.endDate!
      )
    }
    const cashCollected = filteredPayments.reduce((acc, p) => acc + p.amount, 0)

    // Total outstanding = current total unpaid balance
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
   * Otherwise, applies in FIFO order (oldest unpaid sale first) until amount is exhausted.
   */
  public recordPayment(params: {
    customer_name: string
    amount: number
    date: string
    method: PaymentMethod
    sale_id?: string
    notes?: string
  }): { success: boolean; message: string } {
    const { customer_name, amount, date, method, sale_id, notes } = params
    if (!amount || amount <= 0) {
      return { success: false, message: 'Payment amount must be greater than zero.' }
    }

    const customerSales = this.sales.filter(
      (s) => s.customer_name.trim().toLowerCase() === customer_name.trim().toLowerCase()
    )

    if (customerSales.length === 0) {
      return { success: false, message: `No sales records found for ${customer_name}.` }
    }

    const totalBalance = customerSales.reduce((acc, s) => acc + s.balance, 0)
    if (amount > totalBalance + 0.005) {
      return {
        success: false,
        message: `Payment amount (₱${amount.toLocaleString()}) cannot exceed total balance (₱${totalBalance.toLocaleString()}).`,
      }
    }

    let remainingToApply = amount
    const paymentTimestamp = new Date().toISOString()

    if (sale_id) {
      const targetSale = this.sales.find((s) => s.id === sale_id)
      if (!targetSale) {
        return { success: false, message: 'Specified sale was not found.' }
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
        notes: notes || undefined,
        createdAt: paymentTimestamp,
      }

      targetSale.payments = targetSale.payments || []
      targetSale.payments.push(paymentRecord)
      targetSale.amount_paid += amount
      targetSale.balance = Math.max(0, targetSale.total_amount - targetSale.amount_paid)
      targetSale.payment_status =
        targetSale.balance <= 0.005 ? 'Paid' : targetSale.amount_paid > 0 ? 'Partial' : 'Unpaid'
    } else {
      // FIFO: Oldest unpaid first
      const unpaidSales = customerSales
        .filter((s) => s.balance > 0.005)
        .sort((a, b) => a.date.localeCompare(b.date))

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
          notes: notes || undefined,
          createdAt: paymentTimestamp,
        }

        sale.payments = sale.payments || []
        sale.payments.push(paymentRecord)
        sale.amount_paid += alloc
        sale.balance = Math.max(0, sale.total_amount - sale.amount_paid)
        sale.payment_status =
          sale.balance <= 0.005 ? 'Paid' : sale.amount_paid > 0 ? 'Partial' : 'Unpaid'

        remainingToApply -= alloc
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
   * Settle staff credit via payroll deduction (marks all outstanding sales as settled).
   */
  public settleStaffPayrollDeduction(customer_name: string, notes?: string): { success: boolean; message: string } {
    const staffSales = this.sales.filter(
      (s) =>
        s.customer_name.trim().toLowerCase() === customer_name.trim().toLowerCase() &&
        s.balance > 0.005
    )

    if (staffSales.length === 0) {
      return { success: false, message: `No outstanding balance found for staff ${customer_name}.` }
    }

    const todayStr = '2026-11-02'
    let totalDeducted = 0

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
    return {
      success: true,
      message: `Successfully deducted ₱${totalDeducted.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} from payroll for ${customer_name}. Balance settled.`,
    }
  }

  /**
   * Add a new food sale.
   */
  public addNewSale(params: {
    customer_name: string
    customer_type: CustomerType
    customer_phone?: string
    customer_role?: string
    items_summary: string
    total_amount: number
    payment_option: PaymentOption
    amount_paid?: number
    payment_method?: PaymentMethod
    date?: string
    notes?: string
    company?: string
  }): UtangSale {
    const saleId = `SALE-2026-${String(this.sales.length + 101).padStart(3, '0')}`
    const todayStr = params.date || '2026-11-02'
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
          notes: 'Partial payment on food sale',
          createdAt: new Date().toISOString(),
        })
      }
    } else {
      // Pay Later (Utang)
      amountPaid = 0
      paymentStatus = 'Unpaid'
    }

    const newSale: UtangSale = {
      id: saleId,
      company: params.company || 'MyCity.Kitchen Corporation',
      date: todayStr,
      customer_name: params.customer_name.trim(),
      customer_type: params.customer_type,
      customer_phone: params.customer_phone || undefined,
      customer_role: params.customer_role || undefined,
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
    return newSale
  }

  public resetToDefault(): void {
    this.sales = JSON.parse(JSON.stringify(INITIAL_SALES))
    this.save()
  }
}

export const receivablesStore = new ReceivablesStore()

