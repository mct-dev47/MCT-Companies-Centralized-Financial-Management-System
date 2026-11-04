import * as React from 'react'
import {
  TrendingDown,
  Building2,
  Calendar,
  ChevronDown,
  Check,
  Search,
  Plus,
  Download,
  FileSpreadsheet,
  FileText,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  CheckCircle2,
  Wallet,
  ArrowDownLeft,
  MoreVertical,
  Eye,
  Pencil,
  Lock,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DateRangePicker,
  type DateRange,
} from '@/components/ui/DateRangePicker'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { AddExpenseModal } from '@/components/dashboard/AddExpenseModal'
import { ExpenseSummaryChart } from '@/components/dashboard/CategorySummaryChart'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'
import { useSession } from '@/hooks/useSession'
import { formatPHP } from '@/lib/format'
import {
  expenseService,
  type ExpenseItem,
} from '@/services/expenseService'
import { bankService } from '@/services/bankService'
import type { DashboardTransactionItem } from '@/services/dashboardService'
import {
  isDateInRange,
  normalizeDateToYYYYMMDD,
  formatToYYYYMMDD,
  formatCreatedAt,
} from '@/utils/dateUtils'
import {
  getParticularsSummary,
  matchesParticularsStatusFilter,
  normalizeParticularStatus,
} from '@/utils/particularsUtils'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import { loanService } from '@/services/loanService'
import { websocketService } from '@/services/websocketService'
import { useCompany } from '@/context/CompanyContext'
import { isCompanyMatch } from '@/utils/companyUtils'

const DEFAULT_COMPANY_LIST = ['All Companies']

const PERIOD_OPTIONS = ['Daily', 'Monthly', 'Quarterly', 'Annually'] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

import { getPaidDisbursementForExpense } from '@/utils/cashLedgerUtils'
import { reportAuditSaveFailure } from '@/services/auditReviewApi'
import { notifyError, formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

const ITEMS_PER_PAGE = 10

export const ExpensePage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useSession()
  const { activeCompany, setActiveCompany, allCompanies } = useCompany()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isCompanyUser =
    (userRole === 'company' || userRole === 'supervisor') && !isAudit
  const isFinance = userRole === 'finance'
  const isAdmin = userRole === 'admin' || isAudit
  const isCompanyScoped = !isAdmin && !isFinance
  const isAuditor = isAudit
  const isOwner = userRole === 'owner'
  const canAuditActions = isAudit && !isOwner
  const canAdd = !isAudit && !isOwner && (isCompanyUser || isFinance)
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  const [expenses, setExpenses] = React.useState<ExpenseItem[]>([])
  const [loading, setLoading] = React.useState(true)

  // Dynamic companies list populated directly from database
  const [companyList, setCompanyList] =
    React.useState<string[]>(() => (
      allCompanies && allCompanies.length > 0 ? allCompanies : DEFAULT_COMPANY_LIST
    ))

  React.useEffect(() => {
    if (allCompanies && allCompanies.length > 0) {
      setCompanyList(allCompanies)
    }
  }, [allCompanies])

  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((companies) => {
      if (mounted && companies.length > 0) {
        const names = companies.map((c) => c.company_name).filter(Boolean)
        const combined = Array.from(new Set(['All Companies', ...names]))
        setCompanyList(combined)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  // Filter state
  const [selectedCompany, setSelectedCompany] = React.useState<string>(
    isCompanyScoped ? assignedCompany : activeCompany || 'All Companies'
  )

  // Prefetch bank accounts so /expense/add has Withdraw Bank ready in 0ms
  React.useEffect(() => {
    const targetComp = isCompanyScoped
      ? assignedCompany
      : selectedCompany === 'All Companies'
        ? undefined
        : selectedCompany
    bankService.prefetchAccounts(targetComp)
    bankService.prefetchAccounts()
  }, [isCompanyScoped, assignedCompany, selectedCompany])

  // Keep selectedCompany in sync if user profile loads after initial render
  React.useEffect(() => {
    if (isCompanyScoped && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    }
  }, [isCompanyScoped, user?.assignedCompany])

  // Keep selectedCompany in sync with global activeCompany from context
  React.useEffect(() => {
    if (!isCompanyScoped && activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany, isCompanyScoped])

  const [statusFilter, setStatusFilter] = React.useState<
    'All' | 'Paid' | 'Pending' | 'Unpaid'
  >('All')
  const [selectedPeriod, setSelectedPeriod] =
    React.useState<PeriodOption>('Monthly')
  const [dateRange, setDateRange] = React.useState<DateRange>({
    preset: 'All Dates',
    label: 'All Dates',
    startDate: null,
    endDate: null,
  })
  const [searchQuery, setSearchQuery] = React.useState('')
  const [currentPage, setCurrentPage] = React.useState(1)
  const [tableTab, setTableTab] = React.useState<'Withdraw' | 'Expense Record'>(
    'Expense Record'
  )

  // Dropdown menus
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] =
    React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [companySearch, setCompanySearch] = React.useState('')

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  const exportPos = useDropdownPosition(exportDropdownRef, isExportDropdownOpen)
  const companyPos = useDropdownPosition(companyDropdownRef, isCompanyDropdownOpen)
  const periodPos = useDropdownPosition(periodDropdownRef, isPeriodDropdownOpen)
  const statusPos = useDropdownPosition(statusDropdownRef, isStatusDropdownOpen)

  // Modals & Action state
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
  const [deleteConfirmExpense, setDeleteConfirmExpense] =
    React.useState<ExpenseItem | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  // Audit / Details modal state
  const [selectedTx, setSelectedTx] =
    React.useState<DashboardTransactionItem | null>(null)
  const [selectedExpense, setSelectedExpense] =
    React.useState<ExpenseItem | null>(null)
  const [isAuditModalOpen, setIsAuditModalOpen] = React.useState(false)
  const [highlightedExpenseId, setHighlightedExpenseId] = React.useState<
    string | null
  >(null)

  const handlePeriodChange = (period: PeriodOption) => {
    setSelectedPeriod(period)
    setIsPeriodDropdownOpen(false)
    const currentToday = formatToYYYYMMDD(new Date())
    const [currYear, currMonth] = currentToday.split('-')

    switch (period) {
      case 'Daily':
        setDateRange({
          preset: 'today',
          label: 'Today',
          startDate: currentToday,
          endDate: currentToday,
        })
        break
      case 'Monthly': {
        const lastDay = new Date(
          parseInt(currYear, 10),
          parseInt(currMonth, 10),
          0
        ).getDate()
        setDateRange({
          preset: 'this_month',
          label: 'This Month',
          startDate: `${currYear}-${currMonth}-01`,
          endDate: `${currYear}-${currMonth}-${String(lastDay).padStart(2, '0')}`,
        })
        break
      }
      case 'Quarterly': {
        const monthNum = parseInt(currMonth, 10)
        let qStartMonth = '01'
        let qEndMonth = '03'
        let qEndDay = '31'
        let qLabel = 'Q1'

        if (monthNum >= 4 && monthNum <= 6) {
          qStartMonth = '04'
          qEndMonth = '06'
          qEndDay = '30'
          qLabel = 'Q2'
        } else if (monthNum >= 7 && monthNum <= 9) {
          qStartMonth = '07'
          qEndMonth = '09'
          qEndDay = '30'
          qLabel = 'Q3'
        } else if (monthNum >= 10) {
          qStartMonth = '10'
          qEndMonth = '12'
          qEndDay = '31'
          qLabel = 'Q4'
        }

        setDateRange({
          preset: 'this_quarter',
          label: `This Quarter (${qLabel})`,
          startDate: `${currYear}-${qStartMonth}-01`,
          endDate: `${currYear}-${qEndMonth}-${qEndDay}`,
        })
        break
      }
      case 'Annually':
        setDateRange({
          preset: 'this_year',
          label: 'This Year',
          startDate: `${currYear}-01-01`,
          endDate: `${currYear}-12-31`,
        })
        break
      default:
        break
    }
  }

  // `silent` reloads without the loading skeleton (used by realtime updates).
  const loadExpenses = React.useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const targetCompany = isCompanyScoped
        ? assignedCompany
        : selectedCompany === 'All Companies'
          ? undefined
          : selectedCompany
      const data = await expenseService.getExpenses({
        company: targetCompany,
      })
      setExpenses(data)
    } catch (err) {
      console.error('Failed to load expenses:', err)
      notifyError(err, 'Unable to load expenses. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [isCompanyScoped, assignedCompany, selectedCompany])

  React.useEffect(() => {
    loadExpenses()
  }, [loadExpenses])

  // Realtime: when Audit saves a review (or any client changes an expense), reload the real values
  React.useEffect(() => {
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        expenseService.invalidateCache()
        void loadExpenses(true)
      }, 250)
    }
    const unsubs = [
      websocketService.subscribe('AUDIT_UPDATED', reload),
      websocketService.subscribe('EXPENSE_CREATED', reload),
      websocketService.subscribe('EXPENSE_UPDATED', reload),
      websocketService.subscribe('EXPENSE_DELETED', reload),
    ]
    return () => {
      if (timer) window.clearTimeout(timer)
      unsubs.forEach((unsub) => unsub())
    }
  }, [loadExpenses])

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        exportDropdownRef.current &&
        !exportDropdownRef.current.contains(target)
      ) {
        setIsExportDropdownOpen(false)
      }
      if (
        companyDropdownRef.current &&
        !companyDropdownRef.current.contains(target)
      ) {
        setIsCompanyDropdownOpen(false)
      }
      if (
        periodDropdownRef.current &&
        !periodDropdownRef.current.contains(target)
      ) {
        setIsPeriodDropdownOpen(false)
      }
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(target)
      ) {
        setIsStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 1. Base filtered expenses (independent of Deposit / Expense Record tab so KPIs above stay constant)
  const baseFilteredExpenses = React.useMemo(() => {
    const targetCompany = isCompanyScoped ? assignedCompany : selectedCompany

    return expenses
      .filter((item) => {
        if (
          targetCompany !== 'All Companies' &&
          !isCompanyMatch(item.company, targetCompany)
        ) {
          return false
        }

        if (
          !isDateInRange(
            item.rawDate || item.date,
            dateRange.startDate,
            dateRange.endDate
          )
        ) {
          return false
        }

        if (
          !matchesParticularsStatusFilter(
            item.particulars,
            item.items,
            item.status,
            statusFilter,
            item.withdrawal
          )
        ) {
          return false
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim()
          const matchRef = (item.refNo || '').toLowerCase().includes(q)
          const matchCheque = (item.chequeNo || '').toLowerCase().includes(q)
          const matchParticulars = (item.particulars || '')
            .toLowerCase()
            .includes(q)
          const matchCategory = (item.category || '').toLowerCase().includes(q)
          const matchCompany = (item.company || '').toLowerCase().includes(q)
          const matchStatus = (item.status || '').toLowerCase().includes(q)
          const matchAmount = String(item.withdrawal || '').includes(q)

          if (
            !matchRef &&
            !matchCheque &&
            !matchParticulars &&
            !matchCategory &&
            !matchCompany &&
            !matchStatus &&
            !matchAmount
          ) {
            return false
          }
        }

        return true
      })
      .sort((a, b) => {
        const dateA = a.rawDate || normalizeDateToYYYYMMDD(a.date)
        const dateB = b.rawDate || normalizeDateToYYYYMMDD(b.date)
        const cmp = dateB.localeCompare(dateA)
        if (cmp !== 0) return cmp
        return (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      })
  }, [
    expenses,
    selectedCompany,
    dateRange,
    statusFilter,
    searchQuery,
    isCompanyScoped,
    assignedCompany,
  ])

  // 2. Dynamic Tab Filtering ('Deposit' vs 'Expense Record')
  const filteredExpenses = React.useMemo(() => {
    if (tableTab === 'Withdraw') {
      return baseFilteredExpenses.filter(
        (item) => getPaidDisbursementForExpense(item) > 0
      )
    }
    return baseFilteredExpenses
  }, [baseFilteredExpenses, tableTab])

  React.useEffect(() => {
    setCurrentPage(1)
  }, [
    dateRange,
    searchQuery,
    selectedCompany,
    selectedPeriod,
    statusFilter,
    tableTab,
  ])

  // KPI Calculation: Total Expense & Total Cash (computed from baseFilteredExpenses so KPIs stay independent of tab switcher)
  const kpis = React.useMemo(() => {
    let expenseTotal = 0
    let cashTotal = 0
    baseFilteredExpenses.forEach((e) => {
      expenseTotal += e.withdrawal || 0
      cashTotal += getPaidDisbursementForExpense(e)
    })
    return {
      totalExpense: expenseTotal,
      totalCash: cashTotal,
    }
  }, [baseFilteredExpenses])

  // Effective status filter for particulars display in table & modal
  const effectiveParticularsStatusFilter = React.useMemo(() => {
    if (statusFilter !== 'All') return statusFilter
    if (tableTab === 'Withdraw') return 'Paid'
    return 'All'
  }, [statusFilter, tableTab])

  // Pagination
  const totalPages = Math.ceil(filteredExpenses.length / ITEMS_PER_PAGE) || 1
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(
    startIndex + ITEMS_PER_PAGE,
    filteredExpenses.length
  )
  const paginatedExpenses = filteredExpenses.slice(startIndex, endIndex)

  // Map expenses to DashboardTransactionItems for ExpenseSummaryChart
  const mappedTransactions = React.useMemo(() => {
    return filteredExpenses.map((e) => {
      const tx = expenseService.toDashboardTransaction(e)
      if (tableTab === 'Withdraw') {
        const paidAmt = getPaidDisbursementForExpense(e)
        return {
          ...tx,
          amount: paidAmt,
          withdrawal: paidAmt,
        }
      }
      return tx
    })
  }, [filteredExpenses, tableTab])

  // Export handlers
  const companyForExport = selectedCompany

  const handleExportCsv = () => {
    expenseService.exportCsv(
      filteredExpenses,
      `expense_summary_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
    )
    setIsExportDropdownOpen(false)
  }

  const handleExportPdf = () => {
    expenseService.exportPdf(filteredExpenses, companyForExport)
    setIsExportDropdownOpen(false)
  }

  const handleExpenseAdded = (newItem: ExpenseItem) => {
    setExpenses((prev) => [newItem, ...prev])
    setSearchQuery('')

    const newDateIso = newItem.rawDate || normalizeDateToYYYYMMDD(newItem.date)
    if (!isDateInRange(newDateIso, dateRange.startDate, dateRange.endDate)) {
      setDateRange((prev: DateRange) => ({
        ...prev,
        startDate:
          prev.startDate && prev.startDate < newDateIso
            ? prev.startDate
            : newDateIso,
        endDate:
          prev.endDate && prev.endDate > newDateIso ? prev.endDate : newDateIso,
      }))
    }

    setCurrentPage(1)
    setHighlightedExpenseId(newItem.id)

    setTimeout(() => {
      tableCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 150)

    setTimeout(() => {
      setHighlightedExpenseId(null)
    }, 3500)
  }

  const handleOpenRow = (expense: ExpenseItem) => {
    setSelectedExpense(expense)
    setSelectedTx(expenseService.toDashboardTransaction(expense))
    setIsAuditModalOpen(true)
  }

  const handleRowClick = (expense: ExpenseItem) => {
    handleOpenRow(expense)
  }

  const handleExpenseUpdated = (updatedItem: ExpenseItem) => {
    setExpenses((prev) =>
      prev.map((e) => (e.id === updatedItem.id ? updatedItem : e))
    )
    setSelectedExpense(updatedItem)
    setSelectedTx(expenseService.toDashboardTransaction(updatedItem))
    setHighlightedExpenseId(updatedItem.id)
    setTimeout(() => {
      setHighlightedExpenseId(null)
    }, 3000)
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmExpense || isAdmin) return
    try {
      setIsDeleting(true)
      await expenseService.deleteExpense(deleteConfirmExpense.id)
      setExpenses((prev) =>
        prev.filter((e) => e.id !== deleteConfirmExpense.id)
      )
      setDeleteConfirmExpense(null)
    } catch (err) {
      console.error('Failed to delete expense:', err)
      notifyError(err, 'Unable to delete expense. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // 3-Dots Action Menu for Audit
  const [openMenuExpenseId, setOpenMenuExpenseId] = React.useState<
    string | null
  >(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)
  const [activeMenuExpense, setActiveMenuExpense] =
    React.useState<ExpenseItem | null>(null)

  const handleMarkExpenseAudit = (
    expense: ExpenseItem,
    status: 'Verified' | 'Flagged',
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation()
    const timestamp = new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    const auditorName = user?.fullName || 'Audit'
    const updated: ExpenseItem = {
      ...expense,
      auditStatus: status,
      auditedBy: auditorName,
      auditDate: timestamp,
    }
    setExpenses((prev) =>
      prev.map((item) => (item.id === expense.id ? updated : item))
    )
    expenseService.updateExpenseAuditStatus(expense.id, status, auditorName).catch((err) => {
      // Spec 0014: show the real status again when the server did not save it.
      reportAuditSaveFailure(err)
      loadExpenses()
    })
    setOpenMenuExpenseId(null)
    setMenuPosition(null)
    setActiveMenuExpense(null)
  }

  const filteredCompanyList = React.useMemo(() => {
    if (!companySearch.trim()) return companyList
    return companyList.filter((c) =>
      c.toLowerCase().includes(companySearch.toLowerCase().trim())
    )
  }, [companySearch, companyList])

  const displayedCompanyTitle = isCompanyScoped
    ? assignedCompany
    : selectedCompany === 'All Companies'
      ? 'All Subsidiaries'
      : selectedCompany

  return (
    <div className="space-y-6 sm:space-y-8 max-w-[1600px] mx-auto pb-12">
      {/* 1. Header & Controls */}
      <div className="space-y-4">
        {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
              Expense
            </h1>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Comprehensive breakdown of operational expenses.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start sm:self-auto">
            {/* Export Dropdown Button */}
            <div ref={exportDropdownRef} className="relative inline-block">
              <Button
                type="button"
                variant={isAudit ? 'default' : 'outline'}
                onClick={() => setIsExportDropdownOpen((prev) => !prev)}
                className={cn(
                  'h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border',
                  isAudit
                    ? 'bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white'
                    : 'border border-stroke/50 bg-white text-focus hover:bg-surface'
                )}
                aria-haspopup="true"
                aria-expanded={isExportDropdownOpen}
              >

                <span>Export</span>
                <ChevronDown className={cn('h-3.5 w-3.5 ml-0.5', isAudit ? 'text-white/90' : 'text-muted-fg')} />
              </Button>

              {isExportDropdownOpen && (
                <div
                  style={exportPos.isMobile ? exportPos.style : undefined}
                  className={cn(
                    'bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                    exportPos.isMobile
                      ? 'w-[min(calc(100vw-32px),240px)]'
                      : 'absolute right-0 top-full mt-2 w-52'
                  )}
                >
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

            {/* Add Expense Button */}
            {canAdd && (
              <Button
                type="button"
                onClick={() => navigate('/expense/add')}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>Add Expense</span>
              </Button>
            )}
          </div>
        </div>

        {/* Second Row: Search Bar & Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
            <Input
              type="search"
              placeholder="Search by ref no, cheque, particulars, category…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {/* Period Dropdown */}
            <div ref={periodDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsPeriodDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                  isPeriodDropdownOpen &&
                    'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium text-focus/90">
                  {selectedPeriod}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
                    isPeriodDropdownOpen && 'transform rotate-180'
                  )}
                />
              </button>

              {isPeriodDropdownOpen && (
                <div
                  style={periodPos.isMobile ? periodPos.style : undefined}
                  className={cn(
                    'bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                    periodPos.isMobile
                      ? 'w-[min(calc(100vw-32px),220px)]'
                      : 'absolute right-0 top-full mt-2 w-40'
                  )}
                >
                  {PERIOD_OPTIONS.map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => handlePeriodChange(period)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        selectedPeriod === period
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{period}</span>
                      {selectedPeriod === period && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Status Dropdown */}
            <div ref={statusDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  statusFilter === 'Pending'
                    ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                    : statusFilter === 'Paid'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : statusFilter === 'Unpaid'
                        ? 'border-rose-300 bg-rose-50 text-rose-700'
                        : 'border-stroke/60',
                  isStatusDropdownOpen &&
                    'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium">
                  {statusFilter === 'All' ? 'Status' : statusFilter}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
                    isStatusDropdownOpen && 'transform rotate-180'
                  )}
                />
              </button>

              {isStatusDropdownOpen && (
                <div
                  style={statusPos.isMobile ? statusPos.style : undefined}
                  className={cn(
                    'bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                    statusPos.isMobile
                      ? 'w-[min(calc(100vw-32px),220px)]'
                      : 'absolute right-0 top-full mt-2 w-48'
                  )}
                >
                  {(['All', 'Paid', 'Pending', 'Unpaid'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setStatusFilter(st)
                        setIsStatusDropdownOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        statusFilter === st
                          ? st === 'Pending'
                            ? 'bg-yellow-100 text-yellow-800 font-semibold'
                            : 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {st !== 'All' && (
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full',
                              st === 'Paid'
                                ? 'bg-emerald-500'
                                : st === 'Pending'
                                  ? 'bg-yellow-400'
                                  : 'bg-rose-500'
                            )}
                          />
                        )}
                        {st === 'All' ? 'All Status' : st}
                      </span>
                      {statusFilter === st && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date Range Picker */}
            <DateRangePicker
              value={dateRange}
              onChange={(newRange: DateRange) => setDateRange(newRange)}
              hidePresets
            />

            {/* Company Scope: ONLY Finance and Audit have the dropdown filter */}
            {!isCompanyScoped && (
              <div ref={companyDropdownRef} className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setIsCompanyDropdownOpen((prev) => !prev)}
                  className={cn(
                    'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                    isCompanyDropdownOpen &&
                      'ring-2 ring-slate-100 border-slate-300'
                  )}
                  aria-label="Filter expenses by company"
                >
                  <span className="font-medium text-focus/90 truncate max-w-[150px]">
                    {selectedCompany}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
                  {selectedCompany !== 'All Companies' && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedCompany('All Companies')
                        setActiveCompany('All Companies')
                      }}
                      className="p-0.5 rounded-full hover:bg-slate-200 text-muted-fg hover:text-focus transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
                      title="Reset to All Companies"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </button>

                {isCompanyDropdownOpen && (
                  <div
                    style={companyPos.isMobile ? companyPos.style : undefined}
                    className={cn(
                      'bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                      companyPos.isMobile
                        ? 'w-[min(calc(100vw-32px),320px)]'
                        : 'absolute right-0 top-full mt-2 w-68'
                    )}
                  >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-stroke/20 px-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                        Filter By Company
                      </span>
                      {selectedCompany !== 'All Companies' && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCompany('All Companies')
                            setActiveCompany('All Companies')
                            setIsCompanyDropdownOpen(false)
                          }}
                          className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                        >
                          Clear Filter
                        </button>
                      )}
                    </div>

                    <div className="px-1 pb-2">
                      <Input
                        type="text"
                        placeholder="Search company…"
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                        className="h-8 text-xs rounded-lg"
                        autoFocus
                      />
                    </div>

                    <div className="space-y-0.5 max-h-56 overflow-y-auto pr-0.5">
                      {filteredCompanyList.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-fg">
                          No matching companies
                        </div>
                      ) : (
                        filteredCompanyList.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setSelectedCompany(c)
                              setActiveCompany(c)
                              setIsCompanyDropdownOpen(false)
                              setCompanySearch('')
                            }}
                            className={cn(
                              'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                              selectedCompany === c
                                ? 'bg-primary/10 text-primary font-semibold'
                                : 'text-focus/80 hover:bg-slate-50'
                            )}
                          >
                            <span className="truncate">{c}</span>
                            {selectedCompany === c && (
                              <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab Switcher: Withdraw / Expense Record */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setTableTab('Withdraw')}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none',
                  tableTab === 'Withdraw'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />
                Withdraw
              </button>
              <button
                type="button"
                onClick={() => setTableTab('Expense Record')}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none',
                  tableTab === 'Expense Record'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                Expense Record
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Total Expense & Total Cash KPI Cards (Independent of tab switcher) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Total Expense Card */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total Expense
            </span>
            {loading ? (
              <div className="space-y-1.5 mt-2">
                <div className="h-7 w-36 bg-slate-200/80 animate-pulse rounded-md" />
                <div className="h-3 w-56 bg-slate-200/60 animate-pulse rounded-md" />
              </div>
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-red-600 mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalExpense)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Total operational expense withdrawals for{' '}
                  {dateRange.label || 'the selected period'} in{' '}
                  {displayedCompanyTitle}
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-red-50 border border-red-200/60 flex items-center justify-center text-red-600 shrink-0 shadow-2xs">
            <TrendingDown className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* Total Cash (Disbursed) Card */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total Cash
            </span>
            {loading ? (
              <div className="space-y-1.5 mt-2">
                <div className="h-7 w-36 bg-slate-200/80 animate-pulse rounded-md" />
                <div className="h-3 w-56 bg-slate-200/60 animate-pulse rounded-md" />
              </div>
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-rose-600 mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalCash)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Actual cash disbursed for settled expenses in{' '}
                  {displayedCompanyTitle}
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-rose-50 border border-rose-200/60 flex items-center justify-center text-rose-600 shrink-0 shadow-2xs">
            <Wallet className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>
      </div>

      {/* 4. Charts Section */}
      <div className="w-full">
        {loading ? (
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-stroke/20">
              <div className="space-y-1.5">
                <div className="h-5 w-44 bg-slate-200/80 animate-pulse rounded-md" />
                <div className="h-3.5 w-64 bg-slate-200/60 animate-pulse rounded-md" />
              </div>
              <div className="h-9 w-28 bg-slate-200/60 animate-pulse rounded-xl" />
            </div>
            <div className="h-56 sm:h-64 w-full bg-slate-50/70 rounded-2xl flex items-end justify-between p-6 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="w-full bg-slate-200/70 animate-pulse rounded-t-lg"
                  style={{ height: `${25 + ((i * 17) % 65)}%` }}
                />
              ))}
            </div>
          </Card>
        ) : (
          <ExpenseSummaryChart
            transactions={mappedTransactions}
            className="w-full"
          />
        )}
      </div>

      {/* 5. Summary Transactions in Expense */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {statusFilter !== 'All' && (
          <div className="flex items-center justify-between pb-4 mb-2 border-b border-slate-100">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border',
                statusFilter === 'Paid'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : statusFilter === 'Pending'
                    ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
              )}
            >
              <span>Particulars Status: {statusFilter}</span>
              <button
                type="button"
                onClick={() => setStatusFilter('All')}
                className="hover:opacity-75 cursor-pointer"
                title="Clear status filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
            <span className="text-xs text-muted-fg font-medium">
              {filteredExpenses.length}{' '}
              {filteredExpenses.length === 1 ? 'record' : 'records'} shown
            </span>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[940px]">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                <TableHead className="w-[12%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  DATE
                </TableHead>
                <TableHead className="w-[15%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  COMPANY
                </TableHead>
                <TableHead className="w-[11%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CHEQUE NO.
                </TableHead>
                <TableHead className="w-[21%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  PARTICULARS
                </TableHead>
                <TableHead className="w-[11%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  WITHDRAWAL
                </TableHead>
                <TableHead className="w-[11%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CATEGORY
                </TableHead>
                <TableHead className="w-[11%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  NET AMOUNT
                </TableHead>
                <TableHead className="w-[8%] px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={idx} className="border-b border-slate-100">
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-16 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-28 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-20 bg-slate-200/60 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-32 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-16 bg-slate-200/70 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-5 w-16 bg-slate-200/60 animate-pulse rounded-full" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-16 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4 text-center">
                      <div className="h-6 w-14 bg-slate-200/60 animate-pulse rounded-md mx-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paginatedExpenses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-14 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                        <AlertCircle className="w-6 h-6 stroke-[1.5]" />
                      </div>
                      <p className="font-semibold text-focus text-sm sm:text-base">
                        No expense records found
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        There are no expense transactions recorded for{' '}
                        {displayedCompanyTitle} matching your current filters.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedExpenses.map((expense) => {
                  const fallbackStatus = normalizeParticularStatus(
                    expense.status,
                    'Paid'
                  )
                  const summary = getParticularsSummary(
                    expense.particulars,
                    expense.items,
                    {
                      statusFilter: effectiveParticularsStatusFilter,
                      fallbackStatus,
                      fallbackTotal: expense.withdrawal,
                    }
                  )
                  const rowAmount =
                    effectiveParticularsStatusFilter !== 'All'
                      ? summary.filteredTotal
                      : expense.withdrawal
                  const createdAtTime = formatCreatedAt(expense.createdAt, {
                    timeOnly: true,
                  })

                  return (
                    <TableRow
                      key={expense.id}
                      id={`expense-row-${expense.id}`}
                      onClick={() => handleRowClick(expense)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-300 cursor-pointer',
                        highlightedExpenseId === expense.id &&
                          'bg-amber-100/90 hover:bg-amber-100/90 ring-2 ring-amber-500 shadow-md font-semibold'
                      )}
                      title="Click to view complete details"
                    >
                      {/* 1. Date & Created At Time */}
                      <TableCell className="w-[12%] px-3.5 py-3.5 text-xs font-medium text-focus truncate text-left">
                        <div className="flex flex-col truncate">
                          <div className="flex items-center gap-1.5 truncate">
                            <span>{expense.date}</span>
                            {highlightedExpenseId === expense.id && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#960C01] text-white shadow-xs animate-bounce shrink-0">
                                NEW
                              </span>
                            )}
                          </div>
                          {createdAtTime && (
                            <span
                              className="text-[10px] text-muted-fg font-mono mt-0.5"
                              title={`Created at ${formatCreatedAt(expense.createdAt)}`}
                            >
                              {createdAtTime}
                            </span>
                          )}
                          {expense.auditStatus &&
                            expense.auditStatus !== 'Pending Audit' && (
                              <div className="mt-1 flex items-center gap-1">
                                <span
                                  className={cn(
                                    'inline-block px-1.5 py-0.2 rounded text-[9.5px] font-bold border',
                                    expense.auditStatus === 'Verified'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-rose-50 text-rose-700 border-rose-200'
                                  )}
                                >
                                  {expense.auditStatus === 'Verified'
                                    ? 'Audited'
                                    : 'Discrepancy'}
                                </span>
                              </div>
                            )}
                          {expense.auditDate &&
                            expense.auditStatus === 'Verified' && (
                              <span className="text-[9.5px] text-muted-fg font-mono mt-0.5">
                                {expense.auditDate}
                              </span>
                            )}
                        </div>
                      </TableCell>

                      {/* 2. Company */}
                      <TableCell
                        className="w-[15%] px-3.5 py-3.5 text-xs font-semibold text-focus truncate text-left"
                        title={expense.company}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">{expense.company}</span>
                        </div>
                      </TableCell>

                      {/* 3. Cheque No */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs text-focus/90 truncate font-mono text-left">
                        {expense.chequeNo || '—'}
                      </TableCell>

                      {/* 4. Particulars (filtered by statusFilter, with yellow Pending badge) */}
                      <TableCell
                        className="w-[21%] px-3.5 py-3.5 text-xs text-focus/90 font-normal truncate text-left"
                        title={expense.particulars}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate block font-medium">
                            {summary.firstItemName}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold border',
                              summary.firstItemStatus === 'Paid'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : summary.firstItemStatus === 'Pending'
                                  ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                            )}
                          >
                            {summary.firstItemStatus}
                          </span>
                          {summary.count > 1 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                              +{summary.count - 1} more
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* 5. Withdrawal */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs font-semibold text-left tabular-nums whitespace-nowrap text-red-600">
                        {rowAmount > 0 ? formatPHP(rowAmount) : '—'}
                      </TableCell>

                      {/* 6. Category & Payment Method */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs text-focus/90 font-medium truncate text-left">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span
                            className="truncate font-semibold text-focus"
                            title={expense.category || 'General'}
                          >
                            {expense.category || 'General'}
                          </span>
                          <span
                            className="text-[10px] text-muted-fg truncate"
                            title={expense.paymentMethod || 'Cash'}
                          >
                            {expense.paymentMethod || 'Cash'}
                          </span>
                        </div>
                      </TableCell>

                      {/* 7. Net Amount */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs font-bold text-left tabular-nums whitespace-nowrap text-focus">
                        {formatPHP(rowAmount)}
                      </TableCell>

                      {/* 8. Actions */}
                      <TableCell
                        className="w-[8%] px-3.5 py-3.5 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {canAuditActions ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (openMenuExpenseId === expense.id) {
                                  setOpenMenuExpenseId(null)
                                  setMenuPosition(null)
                                  setActiveMenuExpense(null)
                                } else {
                                  const rect =
                                    e.currentTarget.getBoundingClientRect()
                                  const openUpward =
                                    rect.bottom + 140 > window.innerHeight
                                  setMenuPosition({
                                    top: openUpward
                                      ? rect.top - 6
                                      : rect.bottom + 6,
                                    right: Math.max(
                                      12,
                                      window.innerWidth - rect.right
                                    ),
                                    openUpward,
                                  })
                                  setActiveMenuExpense(expense)
                                  setOpenMenuExpenseId(expense.id)
                                }
                              }}
                              className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                              title="Audit Actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          ) : isOwner ? (
                            <span className="text-muted-fg text-xs">—</span>
                          ) : expense.auditStatus === 'Verified' ? (
                            <span
                              className="h-7 w-7 rounded-lg text-emerald-600 bg-emerald-50 border border-emerald-200 flex items-center justify-center"
                              title="Audited by auditor (locked from editing)"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  navigate('/expense/add', {
                                    state: { editExpense: expense },
                                  })
                                }
                                className="h-7 w-7 p-0 rounded-lg text-slate-500 hover:text-focus hover:bg-slate-100 cursor-pointer"
                                title="Edit Expense & Particulars"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmExpense(expense)}
                                className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                title="Delete Expense"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* 6. Pagination Footer */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          <span className="font-medium text-focus/80">
            {filteredExpenses.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredExpenses.length} records`}
          </span>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs text-muted-fg italic">
              Page {currentPage} out of {totalPages}
            </span>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Add Expense Modal */}
      <AddExpenseModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onSuccess={handleExpenseAdded}
        assignedCompany={isAuditor ? assignedCompany : selectedCompany}
      />

      {/* Delete Confirmation Dialog */}
      {!isAdmin && (
        <Dialog
          open={Boolean(deleteConfirmExpense)}
          onOpenChange={(open) => !open && setDeleteConfirmExpense(null)}
        >
          <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-focus flex items-center gap-2 text-red-600">
                <Trash2 className="w-5 h-5 text-red-600" />
                <span>Confirm Deletion</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-1 leading-relaxed">
                Are you sure you want to delete this expense record? This action
                will remove the record from the company ledger.
              </DialogDescription>
            </DialogHeader>

            {deleteConfirmExpense && (
              <div className="my-4 p-4 rounded-2xl bg-red-50/60 border border-red-200/60 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-fg">Particulars:</span>
                  <span className="font-semibold text-focus truncate max-w-[200px]">
                    {deleteConfirmExpense.particulars}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-fg">Withdrawal:</span>
                  <span className="font-bold text-red-600">
                    {formatPHP(deleteConfirmExpense.withdrawal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-fg">Ref No:</span>
                  <span className="font-mono text-focus">
                    {deleteConfirmExpense.refNo}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteConfirmExpense(null)}
                disabled={isDeleting}
                className="h-9 px-4 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="h-9 px-5 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              >
                {isDeleting ? 'Deleting…' : 'Delete Record'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Transaction Details & Audit Modal */}
      <AuditTransactionModal
        open={isAuditModalOpen}
        onOpenChange={(open) => {
          setIsAuditModalOpen(open)
          if (!open) {
            setSelectedExpense(null)
            setSelectedTx(null)
          }
        }}
        transaction={selectedTx}
        expense={selectedExpense}
        onExpenseUpdated={handleExpenseUpdated}
        editable={!isAdmin}
        statusFilter={effectiveParticularsStatusFilter}
      />

      {/* 3-Dots Action Portal Menu for Audit */}
      {openMenuExpenseId &&
        activeMenuExpense &&
        menuPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-44 bg-white rounded-xl border border-slate-200 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) =>
                handleMarkExpenseAudit(activeMenuExpense, 'Verified', e)
              }
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Mark as Audit</span>
            </button>

            <button
              type="button"
              onClick={(e) =>
                handleMarkExpenseAudit(activeMenuExpense, 'Flagged', e)
              }
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Mark as Discrepancy</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const exp = activeMenuExpense
                setOpenMenuExpenseId(null)
                setMenuPosition(null)
                setActiveMenuExpense(null)
                if (exp) handleOpenRow(exp)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>View Details</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
