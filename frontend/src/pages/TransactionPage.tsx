import * as React from 'react'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCw,
  ArrowUpDown,
  FilterX,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  TrendingUp,
  ArrowDownLeft,
  Check,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { salesService } from '@/services/salesService'
import { expenseService } from '@/services/expenseService'
import { loanService, type LoanItem } from '@/services/loanService'
import { pettyCashService, type PettyCashMovement } from '@/services/pettyCashService'
import type { DashboardTransactionItem } from '@/services/dashboardService'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { isCompanyMatch } from '@/utils/companyUtils'
import { formatPHP } from '@/lib/format'
import { isDateInRange, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { getParticularsSummary } from '@/utils/particularsUtils'
import { getPaidDepositForSale, getPaidDisbursementForExpense } from '@/utils/cashLedgerUtils'
import { reportAuditSaveFailure } from '@/services/auditReviewApi'
import { websocketService } from '@/services/websocketService'
import { escapeHtml, csvCell } from '@/utils/exportSafety'
import { cn } from '@/lib/utils'

// ── Loan and petty cash rows (spec 0013) ─────────────────────────────────────────────────────
// The company that receives the money sees a Deposit; the company that funds it sees a Withdrawal.
// A record shows up from the moment Finance endorses it, and disappears if it is rejected.

/** Loan statuses that appear in the ledger: endorsed by Finance, through approval and repayment. */
const LEDGER_LOAN_STATUSES = new Set([
  'pending audit approval',
  'approved',
  'paid',
  'partially paid',
  'overdue',
])

const isAwaitingAudit = (status?: string | null): boolean =>
  (status || '').trim().toLowerCase() === 'pending audit approval'

/** YYYY-MM-DD -> MM/DD/YY, the same display format the other ledger rows use. */
const toLedgerDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : iso
}

/** True when a row is money in (Deposit). Used by the cash ledger direction filter. */
const isDepositRow = (t: DashboardTransactionItem): boolean => {
  if ((t.deposit || 0) > 0) return true
  if ((t.withdrawal || 0) > 0) return false
  return t.type === 'Sales' || t.type === 'Income'
}

/** The company has a real lender (not "Pending Finance Assignment" or an external lender). */
const loanHasLender = (l: LoanItem): boolean => {
  if (l.lenderId) return true
  const name = (l.lender || '').trim().toLowerCase()
  return !!name && name !== 'pending finance assignment' && name !== 'external lender'
}

/**
 * One loan becomes up to two rows: a Deposit for the borrower, a Withdrawal for the lender.
 */
const buildLoanRows = (l: LoanItem): DashboardTransactionItem[] => {
  if (!LEDGER_LOAN_STATUSES.has((l.status || '').trim().toLowerCase())) return []

  const awaitingAudit = isAwaitingAudit(l.status)
  const status: DashboardTransactionItem['status'] = awaitingAudit
    ? 'Pending'
    : (l.status || '').trim().toLowerCase() === 'overdue'
    ? 'Overdue'
    : 'Paid'
  const amount = l.amount || 0

  const base = {
    refNo: l.refNo,
    chequeNo: l.chequeNo || '',
    date: l.date,
    type: 'Loan' as const,
    amount,
    category: l.category as any,
    status,
    awaitingAudit,
    auditStatus: l.auditStatus,
    auditedBy: l.auditedBy,
    auditNotes: l.auditNotes,
    auditDate: l.auditDate,
    createdBy: l.createdBy,
    createdAt: l.createdAt || l.rawDate,
    updatedAt: l.updatedAt,
    attachments: [],
  }

  const rows: DashboardTransactionItem[] = [
    {
      ...base,
      id: l.id,
      company: l.borrower || l.company,
      description: l.particulars,
      particulars: l.particulars,
      deposit: amount,
      withdrawal: 0,
    },
  ]

  const sameCompany =
    (!!l.lenderId && !!l.borrowerId && l.lenderId === l.borrowerId) ||
    (l.lender || '').trim().toLowerCase() === (l.borrower || '').trim().toLowerCase()
  if (loanHasLender(l) && !sameCompany) {
    const particulars = `Loan disbursed to ${l.borrower}${l.particulars ? `: ${l.particulars}` : ''}`
    rows.push({
      ...base,
      id: `${l.id}:lender`,
      company: l.lender,
      description: particulars,
      particulars,
      deposit: 0,
      withdrawal: amount,
      isMirrorRow: true,
    })
  }
  return rows
}

/**
 * One petty cash top up becomes:
 *  - funded by another company: a Deposit for the requesting company, a Withdrawal for the funder
 *  - funded from the company's own bank account: a single Withdrawal, and no Deposit
 * Every petty cash row is a read only mirror (petty cash is audited on its own page).
 */
const buildPettyCashRows = (m: PettyCashMovement): DashboardTransactionItem[] => {
  const awaitingAudit = isAwaitingAudit(m.status)
  const base = {
    refNo: m.refNo,
    chequeNo: '',
    date: toLedgerDate(m.date),
    type: 'Petty Cash' as const,
    amount: m.amount,
    category: 'Petty Cash' as any,
    paymentMethod: 'Bank Transfer',
    status: (awaitingAudit ? 'Pending' : 'Paid') as DashboardTransactionItem['status'],
    awaitingAudit,
    // Internal Audit approving the top up is the audit, so an approved top up reads as audited.
    auditStatus: (awaitingAudit ? 'Pending Audit' : 'Verified') as DashboardTransactionItem['auditStatus'],
    createdAt: m.createdAt || m.date,
    attachments: [],
    isMirrorRow: true,
  }

  if (m.isOwnAccount) {
    const particulars = `Petty cash top up funded from own bank account (${m.refNo})`
    return [
      {
        ...base,
        id: `pc_${m.topupId}:out`,
        company: m.companyName,
        description: particulars,
        particulars,
        deposit: 0,
        withdrawal: m.amount,
      },
    ]
  }

  const received = `Petty cash top up from ${m.fundingCompanyName} (${m.refNo})`
  const funded = `Petty cash top up funded for ${m.companyName} (${m.refNo})`
  return [
    {
      ...base,
      id: `pc_${m.topupId}:in`,
      company: m.companyName,
      description: received,
      particulars: received,
      deposit: m.amount,
      withdrawal: 0,
    },
    {
      ...base,
      id: `pc_${m.topupId}:out`,
      company: m.fundingCompanyName,
      description: funded,
      particulars: funded,
      deposit: 0,
      withdrawal: m.amount,
    },
  ]
}

export const TransactionPage: React.FC = () => {
  const { user } = useSession()
  const { activeCompany } = useCompany()
  const isFinance = user?.role === 'Finance'
  const isAdmin = user?.role === 'Admin' || user?.role === 'Audit'
  const isCompanyScoped = !isAdmin && !isFinance
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  const [transactions, setTransactions] = React.useState<DashboardTransactionItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Switch bar tab: 'deposit' (cash/bank ledger) | 'all' (full accrual ledger)
  const [activeTab, setActiveTab] = React.useState<'deposit' | 'all'>('deposit')

  // Independent Filters & Pagination for DEPOSIT (cash ledger) Tab
  const [depositSearchQuery, setDepositSearchQuery] = React.useState('')
  // Direction filter for the cash ledger: All | Deposits (money in) | Withdrawals (money out)
  const [depositDirectionFilter, setDepositDirectionFilter] = React.useState<'All' | 'Deposits' | 'Withdrawals'>('All')
  const [depositDateRange, setDepositDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
  })
  const [depositSortOrder, setDepositSortOrder] = React.useState<'desc' | 'asc'>('desc')
  const [depositCurrentPage, setDepositCurrentPage] = React.useState(1)


  // Independent Filters & Pagination for ALL TRANSACTIONS (accrual) Tab
  const [salesSearchQuery, setSalesSearchQuery] = React.useState('')
  const [salesStatusFilter, setSalesStatusFilter] = React.useState<'All' | 'Paid' | 'Unpaid' | 'Pending' | 'On hold'>('All')
  // Record-type filter for the accrual ledger: All | Sales | Expense | Loan | Petty Cash
  const [salesTypeFilter, setSalesTypeFilter] = React.useState<
    'All' | 'Sales' | 'Expense' | 'Loan' | 'Petty Cash'
  >('All')
  const [salesDateRange, setSalesDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
  })
  const [salesSortOrder, setSalesSortOrder] = React.useState<'desc' | 'asc'>('desc')
  const [salesCurrentPage, setSalesCurrentPage] = React.useState(1)
  const [isSalesStatusDropdownOpen, setIsSalesStatusDropdownOpen] = React.useState(false)
  const salesStatusDropdownRef = React.useRef<HTMLDivElement>(null)
  const [isSalesTypeDropdownOpen, setIsSalesTypeDropdownOpen] = React.useState(false)
  const salesTypeDropdownRef = React.useRef<HTMLDivElement>(null)

  // Export dropdown state
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)

  const itemsPerPage = 12

  // Modal inspection
  const [selectedTx, setSelectedTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  // Close dropdowns on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (salesStatusDropdownRef.current && !salesStatusDropdownRef.current.contains(target)) {
        setIsSalesStatusDropdownOpen(false)
      }
      if (salesTypeDropdownRef.current && !salesTypeDropdownRef.current.contains(target)) {
        setIsSalesTypeDropdownOpen(false)
      }

    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch all transactions across Sales, Expenses, and Loans
  const fetchAllTransactions = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const targetCompany = isCompanyScoped
        ? assignedCompany
        : activeCompany !== 'All Companies'
        ? activeCompany
        : undefined
      const [salesData, expenseData, loanData, pettyCashData] = await Promise.all([
        salesService.getSales(targetCompany),
        expenseService.getExpenses({ company: targetCompany }),
        loanService.getLoans({ company: targetCompany }),
        // A petty cash failure must not break the rest of the ledger.
        pettyCashService.getMovements(targetCompany).catch(() => [] as PettyCashMovement[]),
      ])

      const unifiedSales: DashboardTransactionItem[] = salesData.map((s) => ({
        id: s.id,
        refNo: s.refNo,
        chequeNo: s.chequeNo || '',
        date: s.date,
        type: 'Sales',
        company: s.company,
        description: s.particulars,
        particulars: s.particulars,
        amount: s.deposit || s.withdrawal || 0,
        withdrawal: s.withdrawal || 0,
        deposit: s.deposit || 0,
        category: s.category as any,
        paymentMethod: s.paymentMethod,
        status: s.status,
        auditStatus: s.auditStatus,
        auditedBy: s.auditedBy,
        auditNotes: s.auditNotes,
        auditDate: s.auditDate,
        createdBy: s.createdBy,
        createdAt: s.createdAt || s.rawDate,
        updatedAt: s.updatedAt,
        attachments: [],
        items: s.items,
        paidAmount: getPaidDepositForSale(s),
      }))

      const unifiedExpenses: DashboardTransactionItem[] = expenseData.map((e) => ({
        id: e.id,
        refNo: e.refNo,
        chequeNo: e.chequeNo || '',
        date: e.date,
        type: 'Expense',
        company: e.company,
        description: e.particulars,
        particulars: e.particulars,
        amount: e.withdrawal || e.netAmount || 0,
        withdrawal: e.withdrawal || e.netAmount || 0,
        deposit: 0,
        category: e.category as any,
        paymentMethod: e.paymentMethod,
        status: e.status,
        auditStatus: e.auditStatus,
        auditedBy: e.auditedBy,
        auditNotes: e.auditNotes,
        auditDate: e.auditDate,
        createdBy: e.createdBy,
        createdAt: e.createdAt || e.rawDate,
        updatedAt: e.updatedAt,
        attachments: [],
        items: e.items,
        paidAmount: getPaidDisbursementForExpense(e),
      }))

      // Spec 0013: each loan and petty cash top up shows each company's own side of the money.
      const unifiedLoans: DashboardTransactionItem[] = loanData.flatMap(buildLoanRows)
      const unifiedPettyCash: DashboardTransactionItem[] = pettyCashData.flatMap(buildPettyCashRows)

      const combined = [...unifiedSales, ...unifiedExpenses, ...unifiedLoans, ...unifiedPettyCash]
      setTransactions(combined)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [isCompanyScoped, assignedCompany, activeCompany])

  React.useEffect(() => {
    fetchAllTransactions(false)
  }, [fetchAllTransactions])

  // Realtime: an Audit review of a sale or expense, or an Audit approval of a loan or petty cash
  // top up, reloads the ledger for everyone (Finance, Audit and company users). Reloads are
  // silent (no loading skeleton) and bunched together when several messages arrive at once.
  React.useEffect(() => {
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // Each service keeps a 30 second cache. Clear them so the reload shows what the server has now.
        salesService.invalidateCache()
        expenseService.invalidateCache()
        loanService.invalidateCache()
        pettyCashService.invalidateCache()
        void fetchAllTransactions(true)
      }, 250)
    }
    const unsubs = [
      websocketService.subscribe('EXPENSE_CREATED', reload),
      websocketService.subscribe('EXPENSE_UPDATED', reload),
      websocketService.subscribe('EXPENSE_DELETED', reload),
      websocketService.subscribe('SALES_UPDATED', reload),
      websocketService.subscribe('BANK_UPDATED', reload),
      websocketService.subscribe('LOANS_UPDATED', reload),
      websocketService.subscribe('PETTY_CASH_UPDATED', reload),
      websocketService.subscribe('AUDIT_UPDATED', reload),
    ]
    return () => {
      if (timer) window.clearTimeout(timer)
      unsubs.forEach((off) => off())
    }
  }, [fetchAllTransactions])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchAllTransactions(false)
  }

  // 1. FILTERED CASH LEDGER
  //    Deposits    = paid sales, plus money a company receives from a loan or petty cash top up
  //    Withdrawals = paid expenses, plus money a company funds out for a loan or petty cash top up
  //    Loan and petty cash rows appear once Audit approves them and are removed if the record is
  //    rejected (spec 0013, narrowed by spec 0016).
  //    Spec 0016: loans and petty cash top ups still waiting for Audit are not money movement yet, so
  //    they are kept off this tab. They stay on the All tab, marked pending.
  const depositBaseList = React.useMemo(() => {
    // Spec 0013 AC-10: a sale or expense is listed when any part of it is paid, and the row shows
    // only the paid amount (same rule as the Sales Deposit tab and the Expense Withdraw tab).
    let list = transactions
      .filter((t) =>
        t.type === 'Sales' || t.type === 'Expense'
          ? (t.paidAmount || 0) > 0
          : (t.type === 'Loan' || t.type === 'Petty Cash') && !t.awaitingAudit
      )
      .map((t): DashboardTransactionItem => {
        const paid = t.paidAmount || 0
        if (t.type === 'Sales') return { ...t, amount: paid, deposit: paid, withdrawal: 0 }
        if (t.type === 'Expense') return { ...t, amount: paid, deposit: 0, withdrawal: paid }
        return t
      })

    // Company scope
    if (isCompanyScoped) {
      list = list.filter((t) => isCompanyMatch(t.company, assignedCompany))
    } else if (activeCompany && activeCompany !== 'All Companies') {
      list = list.filter((t) => isCompanyMatch(t.company, activeCompany))
    }
    return list
  }, [transactions, isCompanyScoped, assignedCompany, activeCompany])

  // Running balance per company (deposits minus withdrawals, oldest first). It is worked out over
  // the whole company scoped ledger, before the search, direction and date filters, so a filter
  // never restarts it. Keyed by record type and id.
  const depositBalanceByKey = React.useMemo(() => {
    const ordered = [...depositBaseList].sort((a, b) => {
      const byDate = normalizeDateToYYYYMMDD(a.date).localeCompare(normalizeDateToYYYYMMDD(b.date))
      if (byDate !== 0) return byDate
      return (a.createdAt || a.id).localeCompare(b.createdAt || b.id)
    })
    const running = new Map<string, number>()
    const balances = new Map<string, number>()
    ordered.forEach((t) => {
      const companyKey = (t.company || '').toLowerCase().trim()
      const next = Math.round(((running.get(companyKey) || 0) + (t.deposit || 0) - (t.withdrawal || 0)) * 100) / 100
      running.set(companyKey, next)
      balances.set(`${t.type}:${t.id}`, next)
    })
    return balances
  }, [depositBaseList])

  const filteredDepositTransactions = React.useMemo(() => {
    let list = depositBaseList

    // Direction filter: All | Deposits (money in) | Withdrawals (money out)
    if (depositDirectionFilter === 'Deposits') {
      list = list.filter(isDepositRow)
    } else if (depositDirectionFilter === 'Withdrawals') {
      list = list.filter((t) => !isDepositRow(t))
    }

    // Search query
    const q = depositSearchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (t) =>
          t.refNo.toLowerCase().includes(q) ||
          (t.chequeNo && t.chequeNo.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q) ||
          (t.particulars && t.particulars.toLowerCase().includes(q)) ||
          t.company.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      )
    }

    // Date range
    if (depositDateRange.startDate && depositDateRange.endDate) {
      list = list.filter((t) =>
        isDateInRange(t.date, depositDateRange.startDate, depositDateRange.endDate)
      )
    }

    // Sort
    list = [...list].sort((a, b) => {
      const dateA = normalizeDateToYYYYMMDD(a.date)
      const dateB = normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) {
        return depositSortOrder === 'desc' ? cmp : -cmp
      }
      const timeCmp = (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      return depositSortOrder === 'desc' ? timeCmp : -timeCmp
    })

    return list
  }, [
    depositBaseList,
    depositDirectionFilter,
    depositSearchQuery,
    depositDateRange,
    depositSortOrder,
  ])

  const depositTotalPages = Math.max(1, Math.ceil(filteredDepositTransactions.length / itemsPerPage))
  const displayedDepositTransactions = React.useMemo(() => {
    const start = (depositCurrentPage - 1) * itemsPerPage
    return filteredDepositTransactions.slice(start, start + itemsPerPage)
  }, [filteredDepositTransactions, depositCurrentPage, itemsPerPage])

  // 2. FILTERED ALL TRANSACTIONS (full accrual ledger: sales + expenses + loans, every status)
  const filteredSalesTransactions = React.useMemo(() => {
    let list = transactions.slice()

    // Company scope
    if (isCompanyScoped) {
      list = list.filter((t) => isCompanyMatch(t.company, assignedCompany))
    } else if (activeCompany && activeCompany !== 'All Companies') {
      list = list.filter((t) => isCompanyMatch(t.company, activeCompany))
    }

    // Record-type filter: All | Sales | Expense | Loan | Petty Cash
    if (salesTypeFilter !== 'All') {
      list = list.filter((t) => t.type === salesTypeFilter)
    }

    // Status filter: All | Paid | Unpaid | Pending | On hold
    if (salesStatusFilter !== 'All') {
      if (salesStatusFilter === 'Unpaid') {
        list = list.filter((t) => t.status !== 'Paid')
      } else {
        list = list.filter((t) => t.status === salesStatusFilter)
      }
    }

    // Search query
    const q = salesSearchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (t) =>
          t.refNo.toLowerCase().includes(q) ||
          (t.chequeNo && t.chequeNo.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q) ||
          (t.particulars && t.particulars.toLowerCase().includes(q)) ||
          t.company.toLowerCase().includes(q) ||
          (t.paymentMethod && t.paymentMethod.toLowerCase().includes(q))
      )
    }

    // Date range
    if (salesDateRange.startDate && salesDateRange.endDate) {
      list = list.filter((t) =>
        isDateInRange(t.date, salesDateRange.startDate, salesDateRange.endDate)
      )
    }

    // Sort
    list = [...list].sort((a, b) => {
      const dateA = normalizeDateToYYYYMMDD(a.date)
      const dateB = normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) {
        return salesSortOrder === 'desc' ? cmp : -cmp
      }
      const timeCmp = (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      return salesSortOrder === 'desc' ? timeCmp : -timeCmp
    })

    return list
  }, [
    transactions,
    isCompanyScoped,
    assignedCompany,
    activeCompany,
    salesTypeFilter,
    salesStatusFilter,
    salesSearchQuery,
    salesDateRange,
    salesSortOrder,
  ])

  const salesTotalPages = Math.max(1, Math.ceil(filteredSalesTransactions.length / itemsPerPage))
  const displayedSalesTransactions = React.useMemo(() => {
    const start = (salesCurrentPage - 1) * itemsPerPage
    return filteredSalesTransactions.slice(start, start + itemsPerPage)
  }, [filteredSalesTransactions, salesCurrentPage, itemsPerPage])

  // Active dataset & clear filters check
  const activeDataset = activeTab === 'deposit' ? filteredDepositTransactions : filteredSalesTransactions
  // Non-narrowed copy for use inside the per-tab toolbar branches, where TypeScript
  // otherwise narrows `activeTab` to a single literal and flags the switcher comparisons.
  const currentTab: 'deposit' | 'all' = activeTab
  const hasDepositActiveFilters =
    depositSearchQuery.trim().length > 0 ||
    (depositDateRange.startDate !== null && depositDateRange.endDate !== null)

  const hasSalesActiveFilters =
    salesSearchQuery.trim().length > 0 ||
    salesStatusFilter !== 'All' ||
    salesTypeFilter !== 'All' ||
    (salesDateRange.startDate !== null && salesDateRange.endDate !== null)

  const handleClearDepositFilters = () => {
    setDepositSearchQuery('')
    setDepositDirectionFilter('All')
    setDepositDateRange({ startDate: null, endDate: null, label: 'All Dates' })
    setDepositCurrentPage(1)
  }

  const handleClearSalesFilters = () => {
    setSalesSearchQuery('')
    setSalesStatusFilter('All')
    setSalesTypeFilter('All')
    setSalesDateRange({ startDate: null, endDate: null, label: 'All Dates' })
    setSalesCurrentPage(1)
  }

  // Resolve a row into bank-statement style deposit (money in) / withdrawal (money out) amounts.
  // Loan and petty cash rows carry their own direction (Deposit for the receiving company,
  // Withdrawal for the funding company). Sales are inflows and expenses outflows. Each row is
  // one direction only.
  const getRowAmounts = React.useCallback(
    (t: DashboardTransactionItem): { deposit: number; withdrawal: number } => {
      // Prefer the record's explicit deposit/withdrawal fields when present.
      if ((t.deposit || 0) > 0) {
        return { deposit: t.deposit, withdrawal: 0 }
      }
      if ((t.withdrawal || 0) > 0) {
        return { deposit: 0, withdrawal: t.withdrawal }
      }
      // Fall back to the record type to decide the direction of the raw amount.
      const amt = t.amount || 0
      if (t.type === 'Sales' || t.type === 'Income') {
        return { deposit: amt, withdrawal: 0 }
      }
      // Expense (and any other record without its own direction) is money out.
      return { deposit: 0, withdrawal: amt }
    },
    []
  )

  // Totals of the rows that match the current filters on the active tab (spec 0016)
  const activeTotals = React.useMemo(() => {
    let deposits = 0
    let withdrawals = 0
    activeDataset.forEach((t) => {
      const { deposit, withdrawal } = getRowAmounts(t)
      deposits += deposit || 0
      withdrawals += withdrawal || 0
    })
    deposits = Math.round(deposits * 100) / 100
    withdrawals = Math.round(withdrawals * 100) / 100
    return { deposits, withdrawals, net: Math.round((deposits - withdrawals) * 100) / 100 }
  }, [activeDataset, getRowAmounts])

  const handleRowClick = (tx: DashboardTransactionItem) => {
    // Mirror rows show the other side of a record (the lender's loan row, petty cash rows).
    // They are read only here: the record is reviewed on its own page (spec 0013, AC-9).
    if (tx.isMirrorRow) return
    // The cash ledger tab shows only the paid part of a record. The detail window needs the full record.
    const fullRecord = transactions.find((t) => t.id === tx.id && t.type === tx.type) || tx
    setSelectedTx(fullRecord)
    setIsModalOpen(true)
  }

  const handleMarkTxAudited = (tx: DashboardTransactionItem, e: React.MouseEvent) => {
    e.stopPropagation()
    // Never save a verification against a mirrored row (it could land on the wrong company),
    // and loans are audited by Audit's approval (spec 0014, AC-8).
    if (tx.isMirrorRow || tx.type === 'Loan') return
    const today = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    })
    const auditorName = user?.fullName || 'Admin'

    const updatedTx: DashboardTransactionItem = {
      ...tx,
      auditStatus: 'Verified',
      auditedBy: auditorName,
      auditDate: today,
    }

    setTransactions((prev) =>
      prev.map((t) => (t.id === tx.id ? updatedTx : t))
    )

    // Spec 0014: the server saves the review. If it fails, tell the user and reload the real status.
    // Loans and petty cash are audited by Audit's approval, so they have no verify button here.
    const failed = (err: unknown) => {
      reportAuditSaveFailure(err)
      fetchAllTransactions()
    }
    if (tx.type === 'Sales') {
      salesService.updateSaleAuditStatus(tx.id, 'Verified', auditorName).catch(failed)
    } else if (tx.type === 'Expense') {
      expenseService.updateExpenseAuditStatus(tx.id, 'Verified', auditorName).catch(failed)
    }
  }

  const handleTransactionUpdated = (updatedItem: DashboardTransactionItem) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === updatedItem.id ? updatedItem : t))
    )
    setSelectedTx(updatedItem)
  }

  // Export CSV handler
  const handleExportCsv = () => {
    const isDeposit = activeTab === 'deposit'
    const headers = isDeposit
      ? ['DATE', 'COMPANY', 'TYPE', 'CHEQUE NO.', 'PARTICULARS', 'CATEGORY', 'DEPOSIT', 'WITHDRAWAL', 'BALANCE', 'AUDIT STATUS']
      : ['DATE', 'COMPANY', 'TYPE', 'REF NO.', 'PARTICULARS', 'PAYMENT METHOD', 'DEPOSIT', 'WITHDRAWAL', 'NET AMOUNT', 'STATUS', 'AUDIT STATUS']

    const rows = (isDeposit ? filteredDepositTransactions : filteredSalesTransactions).map((t) => {
      const { deposit, withdrawal } = getRowAmounts(t)
      if (isDeposit) {
        return [
          csvCell(t.date),
          csvCell(t.company),
          csvCell(t.type),
          csvCell(t.chequeNo || '—'),
          csvCell(t.particulars || t.description),
          csvCell(t.category),
          deposit || 0,
          withdrawal || 0,
          depositBalanceByKey.get(`${t.type}:${t.id}`) ?? 0,
          csvCell(t.auditStatus || 'Pending Audit'),
        ]
      }
      return [
        csvCell(t.date),
        csvCell(t.company),
        csvCell(t.type),
        csvCell(t.refNo || '—'),
        csvCell(t.particulars || t.description),
        csvCell(t.paymentMethod || 'Cash'),
        deposit || 0,
        withdrawal || 0,
        Math.round(((deposit || 0) - (withdrawal || 0)) * 100) / 100,
        csvCell(t.status || 'Paid'),
        csvCell(t.auditStatus || 'Pending Audit'),
      ]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `mct_${activeTab}_records_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setIsExportDropdownOpen(false)
  }

  // Export PDF handler
  const handleExportPdf = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Pop-up blocked. Please allow pop-ups for this site to export PDF.')
      return
    }

    const isDeposit = activeTab === 'deposit'
    const records = isDeposit ? filteredDepositTransactions : filteredSalesTransactions

    const fmtAmt = (n: number) =>
      n > 0 ? `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'
    // Signed amount for the Balance and Net Amount columns (zero and negative values still show)
    const fmtSigned = (n: number) =>
      `${n < 0 ? '-' : ''}₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

    const rowsHtml =
      records.length === 0
        ? `<tr><td colspan="${isDeposit ? 10 : 11}" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No ${isDeposit ? 'deposit' : 'transaction'} records found for this selection.</td></tr>`
        : records
            .map((tx) => {
              const { deposit, withdrawal } = getRowAmounts(tx)
              if (isDeposit) {
                return `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.date)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(tx.company || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.type)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${escapeHtml(tx.chequeNo || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.particulars || tx.description)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.category)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 700;">${fmtAmt(deposit)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #dc2626; font-weight: 700;">${fmtAmt(withdrawal)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">${fmtSigned(depositBalanceByKey.get(`${escapeHtml(tx.type)}:${tx.id}`) ?? 0)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${tx.auditStatus === 'Verified' ? 'Audited' : 'Pending Audit'}</td>
        </tr>
      `
              }
              return `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.date)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(tx.company || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.type)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${escapeHtml(tx.refNo || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.particulars || tx.description)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.paymentMethod || 'Cash')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 700;">${fmtAmt(deposit)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #dc2626; font-weight: 700;">${fmtAmt(withdrawal)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">${fmtSigned(Math.round((deposit - withdrawal) * 100) / 100)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(tx.status || 'Paid')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${tx.auditStatus === 'Verified' ? 'Audited' : 'Pending Audit'}</td>
        </tr>
      `
            })
            .join('')

    const displayedTitle = isCompanyScoped
      ? assignedCompany
      : activeCompany !== 'All Companies'
      ? activeCompany
      : 'All Subsidiaries'

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${isDeposit ? 'Bank Cash Ledger' : 'All Transactions'} Report - ${displayedTitle}</title>
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
          <p>Consolidated <strong>${isDeposit ? 'Bank Cash Ledger' : 'All Transactions'}</strong> for <strong>${displayedTitle}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Company</th>
                <th>Type</th>
                <th>${isDeposit ? 'Cheque No.' : 'Ref No.'}</th>
                <th>Particulars</th>
                <th>${isDeposit ? 'Category' : 'Payment Method'}</th>
                <th style="text-align: right;">Deposit</th>
                <th style="text-align: right;">Withdrawal</th>
                <th style="text-align: right;">${isDeposit ? 'Balance' : 'Net Amount'}</th>
                ${!isDeposit ? '<th>Status</th>' : ''}
                <th>Audit Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Records:</strong> ${records.length}</div>
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
    setIsExportDropdownOpen(false)
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300 select-none">
      {/* 1. Header & Actions Block */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
            Transactions
          </h1>
          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
            {isCompanyScoped
              ? `Financial transaction ledger for ${assignedCompany}`
              : activeCompany !== 'All Companies'
              ? `Financial transaction ledger for ${activeCompany}`
              : 'Bank cash ledger and the full record of sales, expenses, and loans'}
          </p>
        </div>

        {/* Top Right Action Buttons: Sort, Refresh, Live Date & Red Export Dropdown */}
        <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (activeTab === 'deposit') {
                setDepositSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
              } else {
                setSalesSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
              }
            }}
            className="h-10 sm:h-11 px-3.5 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer"
            title="Toggle chronological sorting order"
          >
            <ArrowUpDown className="h-4 w-4 text-focus/70 shrink-0" />
            <span className="hidden sm:inline">
              {(activeTab === 'deposit' ? depositSortOrder : salesSortOrder) === 'desc'
                ? 'Latest First'
                : 'Oldest First'}
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer"
            aria-label="Refresh transaction records"
          >
            <RotateCw
              className={`h-4 w-4 text-focus/70 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {/* Export Button with CSV & PDF options (Red across all accounts) */}
          <div ref={exportDropdownRef} className="relative inline-block">
            <Button
              type="button"
              disabled={activeDataset.length === 0}
              onClick={() => setIsExportDropdownOpen((prev) => !prev)}
              className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-50"
              aria-haspopup="true"
              aria-expanded={isExportDropdownOpen}
              aria-label="Export transaction records"
            >
              <Download className="h-4 w-4 shrink-0 text-white" />
              <span>Export</span>
              <ChevronDown className="h-3.5 w-3.5 ml-0.5 text-white/90" />
            </Button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Download as CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Download as PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* 3. Independent Filters Toolbar per Active Tab */}
      {activeTab === 'deposit' ? (
        /* DEPOSIT FILTERS TOOLBAR */
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg" />
            <Input
              type="search"
              placeholder="Search deposited transactions by Cheque No., particulars, category..."
              value={depositSearchQuery}
              onChange={(e) => {
                setDepositSearchQuery(e.target.value)
                setDepositCurrentPage(1)
              }}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          {/* Right Controls: Date Range Picker, Clear Button, and Tab Switcher */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">


            <DateRangePicker
              value={depositDateRange}
              onChange={(newRange) => {
                setDepositDateRange(newRange)
                setDepositCurrentPage(1)
              }}
            />

            {hasDepositActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearDepositFilters}
                className="h-10 px-3 rounded-full text-xs font-semibold text-muted-fg hover:text-focus hover:bg-surface flex items-center gap-1.5 cursor-pointer"
              >
                <FilterX className="h-3.5 w-3.5" />
                <span>Clear</span>
              </Button>
            )}

            {/* Tab Switcher: Deposit / All Transactions (Right Side, matching Sales & Expense page) */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('deposit')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'deposit'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <ArrowDownLeft className="h-4 w-4 shrink-0" />
                <span>Deposit</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'deposit' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredDepositTransactions.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'all'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <TrendingUp className="h-4 w-4 shrink-0" />
                <span>All Transactions</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredSalesTransactions.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ALL TRANSACTIONS FILTERS TOOLBAR (type + status filters over sales, expenses and loans) */
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg" />
            <Input
              type="search"
              placeholder="Search all transactions by particulars, Ref No., company, payment method..."
              value={salesSearchQuery}
              onChange={(e) => {
                setSalesSearchQuery(e.target.value)
                setSalesCurrentPage(1)
              }}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          {/* Right Controls: Type Filter, Status Filter (Paid/Unpaid/Pending), Date Range Picker & Clear Button */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
            {/* Type Filter Dropdown (All / Sales / Expense / Loan) */}
            <div ref={salesTypeDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsSalesTypeDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-10 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                  isSalesTypeDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-semibold text-focus/90">
                  {salesTypeFilter === 'All' ? 'Type: All' : `Type: ${salesTypeFilter}`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
              </button>

              {isSalesTypeDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="space-y-1">
                    {[
                      { label: 'All Types', value: 'All' as const, dot: 'bg-slate-400' },
                      { label: 'Sales', value: 'Sales' as const, dot: 'bg-emerald-500' },
                      { label: 'Expense', value: 'Expense' as const, dot: 'bg-rose-500' },
                      { label: 'Loan', value: 'Loan' as const, dot: 'bg-sky-500' },
                      { label: 'Petty Cash', value: 'Petty Cash' as const, dot: 'bg-amber-500' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSalesTypeFilter(opt.value)
                          setIsSalesTypeDropdownOpen(false)
                          setSalesCurrentPage(1)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                          salesTypeFilter === opt.value
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-focus/80 hover:bg-slate-50'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', opt.dot)} />
                          <span>{opt.label}</span>
                        </div>
                        {salesTypeFilter === opt.value && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Status Filter Dropdown */}
            <div ref={salesStatusDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsSalesStatusDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-10 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                  isSalesStatusDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-semibold text-focus/90">
                  {salesStatusFilter === 'All' ? 'Status: All' : `Status: ${salesStatusFilter}`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
              </button>

              {isSalesStatusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="space-y-1">
                    {[
                      { label: 'All Statuses', value: 'All' as const, dot: 'bg-slate-400' },
                      { label: 'Paid', value: 'Paid' as const, dot: 'bg-emerald-500' },
                      { label: 'Unpaid', value: 'Unpaid' as const, dot: 'bg-rose-500' },
                      { label: 'Pending', value: 'Pending' as const, dot: 'bg-amber-500' },
                      { label: 'On hold', value: 'On hold' as const, dot: 'bg-stone-500' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSalesStatusFilter(opt.value)
                          setIsSalesStatusDropdownOpen(false)
                          setSalesCurrentPage(1)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                          salesStatusFilter === opt.value
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-focus/80 hover:bg-slate-50'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', opt.dot)} />
                          <span>{opt.label}</span>
                        </div>
                        {salesStatusFilter === opt.value && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Date Range Picker */}
            <DateRangePicker
              value={salesDateRange}
              onChange={(newRange) => {
                setSalesDateRange(newRange)
                setSalesCurrentPage(1)
              }}
            />

            {hasSalesActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearSalesFilters}
                className="h-10 px-3 rounded-full text-xs font-semibold text-muted-fg hover:text-focus hover:bg-surface flex items-center gap-1.5 cursor-pointer"
              >
                <FilterX className="h-3.5 w-3.5" />
                <span>Clear</span>
              </Button>
            )}

            {/* Tab Switcher: Deposit / All Transactions (Right Side) */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('deposit')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'deposit'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <ArrowDownLeft className="h-4 w-4 shrink-0" />
                <span>Deposit</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'deposit' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredDepositTransactions.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'all'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <TrendingUp className="h-4 w-4 shrink-0" />
                <span>All Transactions</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredSalesTransactions.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Table Card Rendering Based on Active Tab */}
      <div className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs">
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  DATE
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  COMPANY
                </TableHead>
                {/* Type (Sales, Expense, Loan, Petty Cash) shows on both tabs */}
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  TYPE
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  {activeTab === 'deposit' ? 'CHEQUE NO.' : 'REF NO.'}
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  PARTICULARS
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  {activeTab === 'deposit' ? 'CATEGORY' : 'PAYMENT METHOD'}
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  DEPOSIT
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  WITHDRAWAL
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  {activeTab === 'deposit' ? 'BALANCE' : 'NET AMOUNT'}
                </TableHead>
                {activeTab === 'all' && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                    STATUS
                  </TableHead>
                )}
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  AUDIT STATUS
                </TableHead>
                {isAdmin && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                    ACTION
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-slate-100">
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-28 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-24 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-48 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                    <TableCell className="px-4 py-3.5 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                    <TableCell className="px-4 py-3.5 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                    {activeTab === 'all' && (
                      <TableCell className="px-4 py-3.5 text-center"><Skeleton className="h-5 w-16 rounded-full mx-auto" /></TableCell>
                    )}
                    <TableCell className="px-4 py-3.5 text-center"><Skeleton className="h-5 w-16 rounded-full mx-auto" /></TableCell>
                    {isAdmin && (
                      <TableCell className="px-4 py-3.5 text-center">
                        <Skeleton className="h-6 w-16 rounded-md mx-auto" />
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (activeTab === 'deposit' ? displayedDepositTransactions : displayedSalesTransactions).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={activeTab === 'all' ? (isAdmin ? 12 : 11) : (isAdmin ? 11 : 10)}
                    className="py-12 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    No {activeTab === 'deposit' ? 'deposit records' : 'transaction records'} found for the selected filter criteria.
                  </TableCell>
                </TableRow>
              ) : (
                (activeTab === 'deposit' ? displayedDepositTransactions : displayedSalesTransactions).map((tx) => {
                  const { deposit: depositAmt, withdrawal: withdrawalAmt } = getRowAmounts(tx)

                  return (
                    <TableRow
                      key={tx.id}
                      onClick={() => handleRowClick(tx)}
                      title={tx.isMirrorRow ? undefined : 'Click to view transaction details'}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/60 transition-colors',
                        tx.isMirrorRow ? 'cursor-default' : 'cursor-pointer'
                      )}
                    >
                      {/* 1. Date */}
                      <TableCell className="px-4 py-3.5 text-xs font-medium text-focus whitespace-nowrap">
                        {tx.date}
                      </TableCell>

                      {/* 2. Company */}
                      <TableCell className="px-4 py-3.5 text-xs font-medium text-focus/90 truncate max-w-[160px]" title={tx.company}>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200/60 max-w-full truncate">
                          {tx.company || '—'}
                        </span>
                      </TableCell>

                      {/* 2b. Type (both tabs): Sales, Expense, Loan or Petty Cash */}
                      <TableCell className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                            tx.type === 'Sales'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : tx.type === 'Expense'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : tx.type === 'Loan'
                              ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : tx.type === 'Petty Cash'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          )}
                        >
                          {tx.type}
                        </span>
                      </TableCell>

                      {/* 3. Cheque No / Ref No */}
                      <TableCell className="px-4 py-3.5 text-xs text-focus/90 whitespace-nowrap font-mono">
                        {activeTab === 'deposit' ? (tx.chequeNo || '—') : (tx.refNo || '—')}
                      </TableCell>

                      {/* 4. Particulars */}
                      <TableCell className="px-4 py-3.5 text-xs text-focus/90 font-normal max-w-xs" title={tx.particulars || tx.description}>
                        {(() => {
                          const summary = getParticularsSummary(tx.particulars || tx.description, tx.items)
                          if (summary.count > 1) {
                            return (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate block font-medium">{summary.firstItemName}</span>
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                  +{summary.count - 1} more
                                </span>
                              </div>
                            )
                          }
                          if (tx.awaitingAudit) {
                            // Only reachable on the All tab: Finance endorsed it, Audit has not approved yet
                            return (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate block font-medium">{summary.firstItemName}</span>
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200"
                                  title="Endorsed by Finance. Waiting for Internal Audit approval."
                                >
                                  Pending Audit
                                </span>
                              </div>
                            )
                          }
                          return <span className="truncate block font-medium">{summary.firstItemName}</span>
                        })()}
                      </TableCell>

                      {/* 5. Category or Payment Method */}
                      <TableCell className="px-4 py-3.5 text-xs text-focus/90 font-medium whitespace-nowrap">
                        {activeTab === 'deposit' ? tx.category : (tx.paymentMethod || 'Cash')}
                      </TableCell>

                      {/* 6. Deposit (money in) */}
                      <TableCell className="px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap text-emerald-600">
                        {depositAmt > 0 ? formatPHP(depositAmt) : <span className="text-muted-fg/50 font-normal">—</span>}
                      </TableCell>

                      {/* 7. Withdrawal (money out) */}
                      <TableCell className="px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap text-rose-600">
                        {withdrawalAmt > 0 ? formatPHP(withdrawalAmt) : <span className="text-muted-fg/50 font-normal">—</span>}
                      </TableCell>

                      {/* 7b. Balance (Deposit tab: running total per company) or Net Amount (All tab: deposit minus withdrawal) */}
                      {(() => {
                        const shown =
                          activeTab === 'deposit'
                            ? depositBalanceByKey.get(`${escapeHtml(tx.type)}:${tx.id}`) ?? 0
                            : Math.round((depositAmt - withdrawalAmt) * 100) / 100
                        return (
                          <TableCell
                            className={cn(
                              'px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap',
                              shown < 0 ? 'text-rose-600' : 'text-focus'
                            )}
                          >
                            {shown < 0 ? `-${formatPHP(Math.abs(shown))}` : formatPHP(shown)}
                          </TableCell>
                        )
                      })()}

                      {/* 8. Status (All Transactions tab only: Paid, Unpaid, Pending, On hold) */}
                      {activeTab === 'all' && (
                        <TableCell className="px-4 py-3.5 text-center whitespace-nowrap">
                          {tx.status === 'Paid' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Paid
                            </span>
                          ) : tx.status === 'Pending' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Pending
                            </span>
                          ) : tx.status === 'On hold' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-700 border border-stone-200">
                              On hold
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              Unpaid
                            </span>
                          )}
                        </TableCell>
                      )}

                      {/* 8. Audit Status Badge */}
                      <TableCell className="px-4 py-3.5 text-center whitespace-nowrap">
                        {tx.auditStatus === 'Verified' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Audited</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shadow-2xs">
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            <span>Pending</span>
                          </span>
                        )}
                      </TableCell>

                      {/* 9. Action for Admin */}
                      {isAdmin && (
                        <TableCell
                          className="px-4 py-3.5 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center">
                            {tx.isMirrorRow || tx.type === 'Loan' ? (
                              <span className="text-muted-fg/50 font-normal text-xs">—</span>
                            ) : tx.auditStatus === 'Verified' ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRowClick(tx)}
                                className="h-7 px-2.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100/80 flex items-center gap-1.5 cursor-pointer border border-emerald-300/80 shadow-2xs transition-all"
                                title="Audited (Click to inspect or unmark)"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Audited</span>
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(e) => handleMarkTxAudited(tx, e)}
                                className="h-7 px-2.5 rounded-lg text-xs font-semibold text-focus/80 hover:text-primary hover:bg-red-50/50 flex items-center gap-1.5 cursor-pointer border border-slate-200/80 hover:border-primary/30 shadow-2xs transition-all"
                                title="Click to verify and mark as audited"
                              >
                                <FileText className="w-3.5 h-3.5 text-primary" />
                                <span>Audit</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* 4b. Totals for the rows that match the current filters (spec 0016) */}
        <div
          className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs"
          aria-label="Totals for the filtered rows"
          data-testid="ledger-totals"
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-emerald-200/70 bg-emerald-50/60">
            <span className="font-semibold text-emerald-800">Total Deposits</span>
            <span className="font-bold tabular-nums text-emerald-700">{formatPHP(activeTotals.deposits)}</span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-rose-200/70 bg-rose-50/60">
            <span className="font-semibold text-rose-800">Total Withdrawals</span>
            <span className="font-bold tabular-nums text-rose-700">{formatPHP(activeTotals.withdrawals)}</span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
            <span className="font-semibold text-focus">Net Amount</span>
            <span
              className={cn(
                'font-bold tabular-nums',
                activeTotals.net < 0 ? 'text-rose-600' : 'text-focus'
              )}
            >
              {activeTotals.net < 0 ? `-${formatPHP(Math.abs(activeTotals.net))}` : formatPHP(activeTotals.net)}
            </span>
          </div>
        </div>

        {/* 5. Pagination Footer */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          {/* Record summary */}
          <span className="font-medium text-focus/80">
            {activeTab === 'deposit'
              ? filteredDepositTransactions.length === 0
                ? 'Showing 0 of 0 deposit records'
                : `Showing ${(depositCurrentPage - 1) * itemsPerPage + 1}-${Math.min(
                    depositCurrentPage * itemsPerPage,
                    filteredDepositTransactions.length
                  )} of ${filteredDepositTransactions.length} deposit records`
              : filteredSalesTransactions.length === 0
              ? 'Showing 0 of 0 transaction records'
              : `Showing ${(salesCurrentPage - 1) * itemsPerPage + 1}-${Math.min(
                  salesCurrentPage * itemsPerPage,
                  filteredSalesTransactions.length
                )} of ${filteredSalesTransactions.length} transaction records`}
          </span>

          {/* Page Indicator & Navigation */}
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs text-muted-fg italic">
              Page {activeTab === 'deposit' ? depositCurrentPage : salesCurrentPage} out of{' '}
              {activeTab === 'deposit' ? depositTotalPages : salesTotalPages}
            </span>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                activeTab === 'deposit' ? depositCurrentPage <= 1 : salesCurrentPage <= 1
              }
              onClick={() => {
                if (activeTab === 'deposit') {
                  setDepositCurrentPage((p) => Math.max(1, p - 1))
                } else {
                  setSalesCurrentPage((p) => Math.max(1, p - 1))
                }
              }}
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                activeTab === 'deposit'
                  ? depositCurrentPage >= depositTotalPages
                  : salesCurrentPage >= salesTotalPages
              }
              onClick={() => {
                if (activeTab === 'deposit') {
                  setDepositCurrentPage((p) => Math.min(depositTotalPages, p + 1))
                } else {
                  setSalesCurrentPage((p) => Math.min(salesTotalPages, p + 1))
                }
              }}
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 6. Transaction Details Modal (If audited, editing is locked; if not audited, provides edit in Excel sheet) */}
      <AuditTransactionModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        transaction={selectedTx}
        onTransactionUpdated={handleTransactionUpdated}
        editable={!isAdmin}
      />
    </div>
  )
}
