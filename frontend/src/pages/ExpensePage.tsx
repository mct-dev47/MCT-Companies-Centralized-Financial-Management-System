import { formatRealName } from '@/utils/formatRealName'
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
  ArrowLeft,
  AlertCircle,
  X,
  CheckCircle2,
  Wallet,
  ArrowDownLeft,
  MoreVertical,
  Eye,
  Pencil,
  Landmark,
  Lock,
  Loader2,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TablePagination } from '@/components/common/TablePagination'
import { StatusPill } from '@/components/common/StatusPill'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  DateRangePicker,
  type DateRange,
} from '@/components/ui/DateRangePicker'
import { TransactionDateRangeControl } from '@/components/transactions/TransactionDateRangeControl'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { BankFilterSelect, useBankFilter } from '@/components/common/BankFilter'
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
  formatDisplayDate,
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
import { useDailyRemarks } from '@/hooks/useDailyRemarks'
import { DayRemarkCell } from '@/components/dashboard/DayRemark'
import { isCompanyMatch } from '@/utils/companyUtils'

const DEFAULT_COMPANY_LIST = ['All Companies']

const PERIOD_OPTIONS = ['Daily', 'Monthly', 'Quarterly', 'Annually'] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

import { getPaidDisbursementForExpense } from '@/utils/cashLedgerUtils'
import { groupTransactionsByDate, type DailyGroupSummary } from '@/utils/dailyGroupUtils'
import { reportAuditSaveFailure } from '@/services/auditReviewApi'
import { notifyError } from '@/utils/errorUtils'

const ITEMS_PER_PAGE = 10

export const ExpensePage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useSession()
  const { activeCompany, setActiveCompany, allCompanies, isCompanyScoped: isStrictlyCompanyScoped } = useCompany()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isCompanyUser =
    (userRole === 'company' || userRole === 'supervisor') && !isAudit
  const isFinance = userRole === 'finance'
  const isAdmin = userRole === 'admin' || isAudit
  const isCompanyScoped = isStrictlyCompanyScoped
  const showCompanyColumn = !isCompanyScoped && userRole !== 'supervisor' && userRole !== 'company'
  const isAuditor = isAudit
  const isOwner = userRole === 'owner'
  const canAuditActions = isAudit && !isOwner
  const canAdd = !isAudit && !isOwner && (isCompanyUser || isFinance)
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  const [expenses, setExpenses] = React.useState<ExpenseItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

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
    if (!isAdmin && !isFinance && allCompanies && allCompanies.length > 0) {
      return
    }
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
  }, [allCompanies, isAdmin, isFinance])

  // Filter state
  const [selectedCompany, setSelectedCompany] = React.useState<string>(() => {
    if (isCompanyScoped && assignedCompany) return assignedCompany
    if (activeCompany && activeCompany !== 'All Companies') return activeCompany
    return activeCompany || 'All Companies'
  })

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
    if (activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany])

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
  const [subTab, setSubTab] = React.useState<'Daily Summary' | 'All Transactions'>('Daily Summary')
  const [expandedDates, setExpandedDates] = React.useState<Set<string>>(new Set())
  const [dailyPage, setDailyPage] = React.useState(1)

  const toggleDateExpansion = (dateKey: string) => {
    setExpandedDates((prev) => (prev.has(dateKey) ? new Set() : new Set([dateKey])))
  }

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
  const [deleteConfirmDay, setDeleteConfirmDay] =
    React.useState<{ date: string; items: ExpenseItem[] } | null>(null)
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
    setLoadError(null)
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
  const {
    accounts: allBankAccounts,
    available: bankOptions,
    selectedId: selectedBankId,
    setSelectedId: setSelectedBankId,
    bankLabel,
  } = useBankFilter(isCompanyScoped ? assignedCompany : selectedCompany)

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

        // Bank filter ('' = All Banks)
        if (selectedBankId && String(item.bankAccountId || '') !== selectedBankId) {
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
    selectedBankId,
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

  // Daily grouped expenses for Daily Summary subtab view
  const dailyExpenseGroups = React.useMemo(() => {
    return groupTransactionsByDate(filteredExpenses, {
      getDate: (e) => e.rawDate || e.date,
      getGrossAmount: (e) => (tableTab === 'Withdraw' ? getPaidDisbursementForExpense(e) : e.withdrawal),
      getRealizedCash: (e) => getPaidDisbursementForExpense(e),
      getAuditStatus: (e) => e.auditStatus,
    })
  }, [filteredExpenses, tableTab])

  const withdrawCount = React.useMemo(() => {
    return baseFilteredExpenses.filter(
      (e) => getPaidDisbursementForExpense(e) > 0 || e.status === 'Paid'
    ).length
  }, [baseFilteredExpenses])

  const withdrawBalanceByKey = React.useMemo(() => {
    const ordered = [...expenses]
      .filter((e) => getPaidDisbursementForExpense(e) > 0 || e.status === 'Paid')
      .sort((a, b) => {
        const da = a.disbursement_date || a.rawDate || a.date
        const db = b.disbursement_date || b.rawDate || b.date
        const byDate = String(da).localeCompare(String(db))
        if (byDate !== 0) return byDate
        return (a.id || '').localeCompare(b.id || '')
      })
    const running = new Map<string, number>()
    const balances = new Map<string, number>()
    ordered.forEach((e) => {
      const groupKey = selectedBankId ? selectedBankId : (e.company || '').toLowerCase().trim()
      if (!running.has(groupKey)) {
        const seedBank = selectedBankId ? allBankAccounts.find((b) => String(b.id) === selectedBankId) : null
        running.set(groupKey, seedBank ? (Number(seedBank.startingBalance) || 0) : 0)
      }
      const prev = running.get(groupKey)!
      const amt = getPaidDisbursementForExpense(e) || e.withdrawal || 0
      const next = Math.round((prev - amt) * 100) / 100
      running.set(groupKey, next)
      balances.set(e.id, next)
    })
    return balances
  }, [expenses, selectedBankId, allBankAccounts])

  const hasFocusedDay = React.useMemo(
    () => dailyExpenseGroups.some((g) => expandedDates.has(g.date)),
    [dailyExpenseGroups, expandedDates]
  )
  const totalDailyPages = Math.max(1, Math.ceil(dailyExpenseGroups.length / ITEMS_PER_PAGE))
  const paginatedDailyGroups = React.useMemo(() => {
    if (hasFocusedDay) {
      return dailyExpenseGroups.filter((g) => expandedDates.has(g.date))
    }
    const start = (dailyPage - 1) * ITEMS_PER_PAGE
    return dailyExpenseGroups.slice(start, start + ITEMS_PER_PAGE)
  }, [dailyExpenseGroups, hasFocusedDay, expandedDates, dailyPage])

  // Day remarks: one note per company, per date (expense). Supervisors and Finance can edit.
  const dayRemarkCompanies = React.useMemo(
    () => paginatedDailyGroups.flatMap((g) => g.items.map((item) => item.company)),
    [paginatedDailyGroups]
  )
  const { getRemark: getDayRemark, saveRemark: saveDayRemark } = useDailyRemarks(
    'expense',
    dayRemarkCompanies
  )
  const canEditDayRemark =
    isFinance || userRole === 'supervisor' || userRole === 'company'

  React.useEffect(() => {
    setCurrentPage(1)
    setDailyPage(1)
  }, [
    dateRange,
    searchQuery,
    selectedCompany,
    selectedPeriod,
    statusFilter,
    tableTab,
    subTab,
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

  // Withdraw tab is paid by definition, so a leftover "Paid" filter is dropped
  React.useEffect(() => {
    if (tableTab === 'Withdraw' && statusFilter === 'Paid') setStatusFilter('All')
  }, [tableTab, statusFilter])

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
    if (subTab === 'Daily Summary') {
      expenseService.exportDailySummaryCsv(
        dailyExpenseGroups,
        `expense_daily_summary_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
      )
    } else {
      expenseService.exportCsv(
        filteredExpenses,
        `expense_summary_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
      )
    }
    setIsExportDropdownOpen(false)
  }

  const handleExportPdf = () => {
    if (subTab === 'Daily Summary') {
      expenseService.exportDailySummaryPdf(dailyExpenseGroups, companyForExport)
    } else {
      expenseService.exportPdf(filteredExpenses, companyForExport)
    }
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

  const handleConfirmDeleteDay = async () => {
    if (!deleteConfirmDay || isAdmin) return
    try {
      setIsDeleting(true)
      for (const item of deleteConfirmDay.items) {
        await expenseService.deleteExpense(item.id)
      }
      const idsToDelete = new Set(deleteConfirmDay.items.map((i) => i.id))
      setExpenses((prev) => prev.filter((e) => !idsToDelete.has(e.id)))
      setDeleteConfirmDay(null)
    } catch (err) {
      console.error('Failed to delete day expenses:', err)
      notifyError(err, 'Unable to delete day expense records. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // 3-Dots Action Menu
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

  const [dayMenu, setDayMenu] = React.useState<{
    date: string
    items: ExpenseItem[]
    top: number
    right: number
    openUpward: boolean
  } | null>(null)

  React.useEffect(() => {
    if (!dayMenu) return
    const handleClose = () => setDayMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('click', handleClose)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dayMenu])

  React.useEffect(() => {
    if (!openMenuExpenseId) return
    const handleClose = () => {
      setOpenMenuExpenseId(null)
      setMenuPosition(null)
      setActiveMenuExpense(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('click', handleClose)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuExpenseId])

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
    const auditorName = formatRealName(user?.fullName || user?.name || user?.email || 'Audit Officer', user?.role || 'Audit Officer')
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
    <div className="space-y-6 sm:space-y-8 w-full max-w-[1600px] mx-auto pb-12">
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
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-focus hover:bg-surface transition-colors text-left cursor-pointer min-h-[44px]"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Download as CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium text-focus hover:bg-surface transition-colors text-left cursor-pointer min-h-[44px]"
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

        {/* Primary Tab Switcher: Withdraw (Bank Ledger) | Expense Record (All Transactions) */}
        <div
          role="tablist"
          aria-label="Expense views"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tableTab === 'Withdraw'}
            onClick={() => setTableTab('Withdraw')}
            className={cn(
              'min-h-[64px] w-full rounded-[16px] px-5 py-3.5 text-left transition-all border cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 flex items-center justify-between gap-3',
              tableTab === 'Withdraw'
                ? 'bg-[#960C01] border-[#960C01] text-white shadow-xs'
                : 'bg-white border-stroke/40 text-focus hover:bg-surface/60'
            )}
          >
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold leading-tight">Withdraw</div>
              <div
                className={cn(
                  'text-xs mt-0.5 leading-snug',
                  tableTab === 'Withdraw' ? 'text-white/85' : 'text-muted-fg'
                )}
              >
                Bank ledger of expenses
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums',
                tableTab === 'Withdraw' ? 'bg-white/20 text-white' : 'bg-surface text-focus/80'
              )}
            >
              {withdrawCount}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tableTab === 'Expense Record'}
            onClick={() => setTableTab('Expense Record')}
            className={cn(
              'min-h-[64px] w-full rounded-[16px] px-5 py-3.5 text-left transition-all border cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 flex items-center justify-between gap-3',
              tableTab === 'Expense Record'
                ? 'bg-[#960C01] border-[#960C01] text-white shadow-xs'
                : 'bg-white border-stroke/40 text-focus hover:bg-surface/60'
            )}
          >
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold leading-tight">Expense Record</div>
              <div
                className={cn(
                  'text-xs mt-0.5 leading-snug',
                  tableTab === 'Expense Record' ? 'text-white/85' : 'text-muted-fg'
                )}
              >
                All expense transactions
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums',
                tableTab === 'Expense Record' ? 'bg-white/20 text-white' : 'bg-surface text-focus/80'
              )}
            >
              {filteredExpenses.length}
            </span>
          </button>
        </div>

        {/* Controls Container / Shared Filters */}
        <div className="flex flex-col gap-3 pt-1">
          {/* Row 1: Company + Bank + Date + All Records / By Day toggle */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 w-full">
            <div className="flex flex-1 flex-wrap sm:flex-nowrap items-center gap-2.5 min-w-0">
              {/* Company Scope */}
              {!isCompanyScoped ? (
                <div ref={companyDropdownRef} className="relative flex-1 min-w-[170px]">
                  <button
                    type="button"
                    onClick={() => setIsCompanyDropdownOpen((prev) => !prev)}
                    className={cn(
                      'inline-flex items-center justify-between gap-2 min-h-[44px] h-11 w-full px-3.5 rounded-[10px] border border-stroke/40 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40',
                      isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                    )}
                    aria-label="Filter expenses by company"
                  >
                    <span className="font-semibold text-focus truncate max-w-[240px]">
                      {selectedCompany}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {selectedCompany !== 'All Companies' && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedCompany('All Companies')
                            setActiveCompany('All Companies')
                          }}
                          className="p-0.5 rounded-full hover:bg-slate-200 text-muted-fg hover:text-focus transition-colors inline-flex items-center justify-center cursor-pointer"
                          title="Reset to All Companies"
                        >
                          <X className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <ChevronDown className="h-4 w-4 text-muted-fg shrink-0" />
                    </div>
                  </button>

                  {isCompanyDropdownOpen && (
                    <div
                      style={companyPos.isMobile ? companyPos.style : undefined}
                      className={cn(
                        'bg-white rounded-[16px] border border-stroke/30 shadow-soft p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                        companyPos.isMobile
                          ? 'w-[min(calc(100vw-32px),320px)]'
                          : 'absolute left-0 top-full mt-2 w-72'
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

                      <div className="relative mb-2 px-1">
                        <Search className="w-3.5 h-3.5 text-muted-fg absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={companySearch}
                          onChange={(e) => setCompanySearch(e.target.value)}
                          placeholder="Search company…"
                          className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-stroke/40 bg-slate-50/70 text-xs text-focus placeholder:text-muted-fg/60 focus:outline-none focus:ring-1 focus:ring-focus focus:bg-white"
                        />
                        {companySearch && (
                          <button
                            type="button"
                            onClick={() => setCompanySearch('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
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
              ) : (
                <div
                  className="inline-flex items-center justify-between gap-2 min-h-[44px] h-11 flex-1 min-w-[170px] px-4 rounded-full border border-stroke/50 bg-surface/70 text-focus text-xs sm:text-sm font-semibold shadow-xs select-none"
                  title={selectedCompany}
                >
                  <span className="truncate min-w-0">{selectedCompany}</span>
                </div>
              )}

              {/* Bank Filter Select */}
              <div className="flex-1 min-w-[170px]">
                <BankFilterSelect
                  accounts={bankOptions}
                  value={selectedBankId}
                  onChange={setSelectedBankId}
                  className="w-full min-h-[44px] h-11 text-xs sm:text-sm"
                />
              </div>

              {/* Date Range Control in Row 1 */}
              <div className="w-full sm:w-auto min-w-[190px] shrink-0">
                <TransactionDateRangeControl
                  value={dateRange}
                  onChange={(newRange) => setDateRange(newRange)}
                  fullWidth
                />
              </div>
            </div>

            {/* All Records / By Day Toggle */}
            <div className="shrink-0 flex items-center">
              <div
                role="group"
                aria-label="Group records"
                className="inline-flex items-center rounded-full border border-stroke/50 bg-slate-100/80 p-0.5 shrink-0"
              >
                <button
                  type="button"
                  aria-pressed={subTab === 'All Transactions'}
                  onClick={() => setSubTab('All Transactions')}
                  className={cn(
                    'min-h-[44px] px-4 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    subTab === 'All Transactions'
                      ? 'bg-[#960C01] text-white shadow-xs'
                      : 'text-focus/70 hover:text-focus hover:bg-white/60'
                  )}
                >
                  All Records
                </button>
                <button
                  type="button"
                  aria-pressed={subTab === 'Daily Summary'}
                  onClick={() => setSubTab('Daily Summary')}
                  className={cn(
                    'min-h-[44px] px-4 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    subTab === 'Daily Summary'
                      ? 'bg-[#960C01] text-white shadow-xs'
                      : 'text-focus/70 hover:text-focus hover:bg-white/60'
                  )}
                >
                  By Day
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Full-width Search Bar */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-muted-fg absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search particulars, Ref No., Cheque No., company, method…"
              className="min-h-[44px] h-11 pl-11 pr-4 rounded-full border border-stroke/50 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-2 focus-visible:ring-focus w-full"
            />
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
        {/* Dynamic Tab Context Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 mb-2 border-b border-slate-100">
          {subTab === 'Daily Summary' && hasFocusedDay ? (
            <button
              type="button"
              onClick={() => setExpandedDates(new Set())}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stroke/40 bg-surface/80 hover:bg-surface text-xs font-semibold text-focus transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to all {dailyExpenseGroups.length} days</span>
            </button>
          ) : (
            <span className="text-xs text-muted-fg font-medium">
              {subTab === 'Daily Summary'
                ? `${dailyExpenseGroups.length} ${dailyExpenseGroups.length === 1 ? 'day' : 'days'} (${filteredExpenses.length} total records)`
                : `${filteredExpenses.length} ${tableTab === 'Withdraw' ? 'withdrawal' : 'expense'} ${filteredExpenses.length === 1 ? 'record' : 'records'} shown`}
            </span>
          )}
        </div>

        {subTab === 'Daily Summary' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <Table className="w-full table-fixed min-w-[1000px]">
              <colgroup>
                <col style={{ width: '16%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '9%' }} />
              </colgroup>
              <TableHeader>
                <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                    DATE & DAY
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                    TRANSACTIONS
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                    {tableTab === 'Withdraw' ? 'TOTAL WITHDRAWN' : 'GROSS EXPENSES'}
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                    REALIZED CASH
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                    DAY REMARK
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                    AUDIT STATUS
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                    ACTION
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={5} columns={7} />
                ) : loadError ? (
                  <TableErrorState
                    colSpan={7}
                    message={loadError}
                    onRetry={() => loadExpenses(false, true)}
                  />
                ) : paginatedDailyGroups.length === 0 ? (
                  <TableEmptyState
                    colSpan={7}
                    title="No daily expense records found"
                    description="There are no expense transactions recorded for this period matching your filters."
                  />
                ) : (
                  paginatedDailyGroups.map((group) => {
                    const isExpanded = expandedDates.has(group.date)
                    return (
                      <React.Fragment key={group.date}>
                        <TableRow
                          onClick={() => toggleDateExpansion(group.date)}
                          className={cn(
                            'border-b border-slate-100 transition-colors cursor-pointer select-none',
                            isExpanded ? 'bg-slate-50/90 font-medium' : 'hover:bg-slate-50/50'
                          )}
                        >
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-left">
                            <div className="flex items-center gap-2 min-w-0">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-primary shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-fg shrink-0" />
                              )}
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold text-focus">{group.formattedDate}</span>
                                <span className="text-[11px] text-muted-fg font-medium">{group.dayOfWeek}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-focus border border-slate-200">
                              {group.transactionCount} {group.transactionCount === 1 ? 'record' : 'records'}
                            </span>
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-right font-bold tabular-nums text-focus text-xs">
                            {formatPHP(group.grossTotal)}
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-right font-bold tabular-nums text-rose-600 text-xs">
                            {formatPHP(group.realizedCash)}
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-left" onClick={(e) => e.stopPropagation()}>
                            <DayRemarkCell
                              companyNames={group.items.map((item) => item.company)}
                              date={group.date}
                              formattedDate={group.formattedDate}
                              kindLabel="Expense"
                              canEdit={canEditDayRemark}
                              getRemark={getDayRemark}
                              onSave={saveDayRemark}
                              entries={group.items.map((e) => ({
                                id: e.id,
                                ref: e.chequeNo || e.refNo,
                                particulars: e.particulars,
                                amount: tableTab === 'Withdraw' ? getPaidDisbursementForExpense(e) : e.withdrawal,
                                status: e.status,
                              }))}
                            />
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-center">
                            <span
                              className={cn(
                                'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
                                group.auditStatus === 'All Verified'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : group.auditStatus === 'Discrepancy'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              )}
                            >
                              {group.auditStatus}
                            </span>
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 160 > window.innerHeight
                                setDayMenu({
                                  date: group.date,
                                  items: group.items,
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                              }}
                              className="h-8 w-8 p-0 text-muted-fg hover:text-focus hover:bg-slate-200/60 rounded-lg inline-flex items-center justify-center cursor-pointer transition-colors"
                              title="Day Actions"
                              aria-label="Open day actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>

                        {/* Expandable Accordion Row */}
                        {isExpanded && (
                          <TableRow className="bg-slate-50/40 border-b border-slate-200">
                            <TableCell colSpan={7} className="p-3 sm:p-4">
                              <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
                                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-focus">
                                      Disbursements on {group.formattedDate}
                                    </span>
                                    <span className="text-2xs text-muted-fg font-medium">
                                      ({group.items.length} total)
                                    </span>
                                  </div>
                                  <div className="text-2xs text-muted-fg">
                                    Inspect, edit, delete, or audit individual vouchers
                                  </div>
                                </div>
                                {(() => {
                                  const byBank = new Map<string, { count: number; total: number }>()
                                  group.items.forEach((it) => {
                                    const key = String(it.bankAccountId || '')
                                    const entry = byBank.get(key) || { count: 0, total: 0 }
                                    entry.count += 1
                                    entry.total += (tableTab === 'Withdraw' ? getPaidDisbursementForExpense(it) : it.withdrawal)
                                    byBank.set(key, entry)
                                  })
                                  return (
                                    <div className="px-4 py-3 border-b border-slate-200 bg-white">
                                      <p className="text-2xs font-bold uppercase tracking-wider text-muted-fg mb-2">By bank</p>
                                      <div className="flex flex-wrap gap-2">
                                        {Array.from(byBank.entries()).map(([key, v]) => (
                                          <div
                                            key={key || 'none'}
                                            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs"
                                          >
                                            <Landmark className="w-3.5 h-3.5 text-primary shrink-0" />
                                            <span className="font-semibold text-focus">{bankLabel(key)}</span>
                                            <span className="text-muted-fg">{v.count} {v.count === 1 ? 'record' : 'records'}</span>
                                            <span className="font-bold tabular-nums text-focus">{formatPHP(v.total)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })()}
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <colgroup>
                                      <col style={{ width: '10%' }} />
                                      <col style={{ width: '23%' }} />
                                      <col style={{ width: '9%' }} />
                                      <col style={{ width: '11%' }} />
                                      <col style={{ width: '10%' }} />
                                      <col style={{ width: '11%' }} />
                                      <col style={{ width: '11%' }} />
                                      <col style={{ width: '9%' }} />
                                      <col style={{ width: '6%' }} />
                                    </colgroup>
                                    <thead className="bg-slate-100/60 text-muted-fg text-[11px] uppercase tracking-wider border-b border-slate-100">
                                      <tr>
                                        <th className="px-3 py-2 font-bold text-left">DATE</th>
                                        <th className="px-3 py-2 font-bold text-left">PARTICULARS</th>
                                        <th className="px-3 py-2 font-bold text-left">METHOD</th>
                                        <th className="px-3 py-2 font-bold text-right">AMOUNT</th>
                                        <th className="px-3 py-2 font-bold text-left">CHEQUE NO.</th>
                                        <th className="px-3 py-2 font-bold text-left">DEPOSIT DATE</th>
                                        <th className="px-3 py-2 font-bold text-right">AMOUNT DEPOSIT</th>
                                        <th className="px-3 py-2 font-bold text-center">STATUS</th>
                                        <th className="px-3 py-2 font-bold text-center">ACTION</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {group.items.map((expense) => {
                                        const summary = getParticularsSummary(
                                          expense.particulars,
                                          expense.items,
                                          {
                                            statusFilter: effectiveParticularsStatusFilter,
                                            fallbackStatus: normalizeParticularStatus(expense.status, 'Paid'),
                                            fallbackTotal: expense.withdrawal,
                                          }
                                        )

                                        return (
                                          <tr
                                            key={expense.id}
                                            onClick={() => setSelectedExpense(expense)}
                                            className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                                          >
                                            <td className="px-3 py-2 font-medium text-focus whitespace-nowrap align-top">
                                              {formatDisplayDate(expense.rawDate || expense.date)}
                                            </td>
                                            <td className="px-3 py-2 text-xs align-top">
                                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                                <span className="font-semibold text-focus break-words leading-snug">
                                                  {summary.title || expense.particulars}
                                                </span>
                                                {summary.itemCount > 1 && (
                                                  <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                                    +{summary.itemCount - 1} more
                                                  </span>
                                                )}
                                              </div>
                                              {expense.company && (
                                                <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                                                  {expense.company}
                                                </div>
                                              )}
                                              <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                                                {expense.refNo || (expense as any).reference_no || '—'}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-focus/90 font-medium truncate align-top">
                                              {expense.paymentMethod || 'Cash'}
                                            </td>
                                            <td className="px-3 py-2 font-bold text-right tabular-nums whitespace-nowrap align-top text-rose-700">
                                              -{formatPHP(expense.withdrawal)}
                                            </td>
                                            <td className="px-3 py-2 font-mono text-focus/80 truncate align-top">
                                              {expense.chequeNo || '—'}
                                            </td>
                                            <td className="px-3 py-2 font-medium whitespace-nowrap align-top">
                                              <span className="text-muted-fg/50">—</span>
                                            </td>
                                            <td className="px-3 py-2 font-bold text-right tabular-nums whitespace-nowrap align-top">
                                              <span className="text-muted-fg/50 font-normal">—</span>
                                            </td>
                                            <td className="px-3 py-2 text-center align-top">
                                              <span
                                                className={cn(
                                                  'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border tracking-wide uppercase',
                                                  expense.status === 'Paid'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                                    : expense.status === 'Pending'
                                                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                                                    : 'bg-rose-50 text-rose-700 border-rose-300'
                                                )}
                                              >
                                                {expense.status || 'Paid'}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-center align-top" onClick={(e) => e.stopPropagation()}>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  if (openMenuExpenseId === expense.id) {
                                                    setOpenMenuExpenseId(null)
                                                    setMenuPosition(null)
                                                    setActiveMenuExpense(null)
                                                  } else {
                                                    const rect = e.currentTarget.getBoundingClientRect()
                                                    const openUpward = rect.bottom + 160 > window.innerHeight
                                                    setMenuPosition({
                                                      top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                                      right: Math.max(12, window.innerWidth - rect.right),
                                                      openUpward,
                                                    })
                                                    setActiveMenuExpense(expense)
                                                    setOpenMenuExpenseId(expense.id)
                                                  }
                                                }}
                                                className="h-7 w-7 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors"
                                                title="Actions"
                                                aria-label="Open actions menu"
                                              >
                                                <MoreVertical className="w-3.5 h-3.5" />
                                              </button>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[860px] lg:min-w-0">
            <colgroup>
              <col style={{ width: '10%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                  DATE
                </TableHead>
                <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                  PARTICULARS
                </TableHead>
                <TableHead className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                  METHOD
                </TableHead>
                <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                  AMOUNT
                </TableHead>
                <TableHead className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                  CHEQUE NO.
                </TableHead>
                <TableHead className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                  DEPOSIT DATE
                </TableHead>
                <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                  AMOUNT DEPOSIT
                </TableHead>
                <TableHead className="pl-3 pr-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                  STATUS
                </TableHead>
                <TableHead className="px-1.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                  ACTION
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableSkeleton rows={5} columns={9} />
              ) : loadError ? (
                <TableErrorState
                  colSpan={9}
                  message={loadError}
                  onRetry={() => loadExpenses(false, true)}
                />
              ) : paginatedExpenses.length === 0 ? (
                <TableEmptyState
                  colSpan={9}
                  title="No expense records found"
                  description={`There are no expense transactions recorded for ${displayedCompanyTitle} matching your current filters.`}
                  action={
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setIsAddModalOpen(true)}
                      className="rounded-[10px]"
                    >
                      Record New Expense
                    </Button>
                  }
                />
              ) : (
                paginatedExpenses.map((expense) => {
                  const fallbackStatus = normalizeParticularStatus(expense.status, 'Paid')
                  const summary = getParticularsSummary(expense.particulars, expense.items, {
                    statusFilter: effectiveParticularsStatusFilter,
                    fallbackStatus,
                    fallbackTotal: expense.withdrawal,
                  })

                  return (
                    <TableRow
                      key={expense.id}
                      id={`expense-row-${expense.id}`}
                      onClick={() => handleOpenRow(expense)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-300 cursor-pointer',
                        highlightedExpenseId === expense.id &&
                          'bg-amber-100/90 hover:bg-amber-100/90 ring-2 ring-amber-500 shadow-md font-semibold'
                      )}
                      title="Click to view complete details"
                    >
                      {/* 1. Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium text-focus whitespace-nowrap align-top">
                        {formatDisplayDate(expense.rawDate || expense.date)}
                      </TableCell>

                      {/* 2. Particulars: Title on Line 1, Company on Line 2, Ref on Line 3 (No cheque, no badge) */}
                      <TableCell className="px-2.5 sm:px-3 py-3 text-xs text-focus/90 align-top" title={expense.particulars}>
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-focus break-words leading-snug">
                            {summary.title || expense.particulars}
                          </span>
                          {summary.itemCount > 1 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                              +{summary.itemCount - 1} more
                            </span>
                          )}
                        </div>
                        {expense.company && (
                          <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                            {expense.company}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                          {expense.refNo || (expense as any).reference_no || '—'}
                        </div>
                      </TableCell>

                      {/* 3. Method */}
                      <TableCell className="px-2 py-3 text-xs text-focus/90 font-medium truncate align-top">
                        {expense.paymentMethod || 'Cash'}
                      </TableCell>

                      {/* 4. Signed Gross Amount */}
                      <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top text-rose-700">
                        -{formatPHP(expense.withdrawal)}
                      </TableCell>

                      {/* 5. Cheque No. */}
                      <TableCell className="px-2 py-3 text-xs font-mono text-focus/80 truncate align-top">
                        {expense.chequeNo || '—'}
                      </TableCell>

                      {/* 6. Deposit Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium whitespace-nowrap align-top">
                        <span className="text-muted-fg/50">—</span>
                      </TableCell>

                      {/* 7. Deposit Amount */}
                      <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top">
                        <span className="text-muted-fg/50 font-normal">—</span>
                      </TableCell>

                      {/* 8. Status Badge */}
                      <TableCell className="pl-3 pr-2 py-3 text-center align-top">
                        <StatusPill status={expense.status || 'Paid'} />
                      </TableCell>

                      {/* 9. Action: 3 dots action button */}
                      <TableCell
                        className="px-1.5 py-3 text-center whitespace-nowrap align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center">
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
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 160 > window.innerHeight
                                setMenuPosition({
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                                setActiveMenuExpense(expense)
                                setOpenMenuExpenseId(expense.id)
                              }
                            }}
                            className="h-7 w-7 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors"
                            title="Actions"
                            aria-label="Open actions menu"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        )}

        {/* 6. Pagination Footer */}
        {subTab === 'Daily Summary' ? (
          hasFocusedDay ? (
            <div className="pt-4 mt-2 flex items-center justify-between w-full text-xs text-muted-fg">
              <span className="font-semibold text-focus">
                Viewing disbursements for {paginatedDailyGroups[0]?.formattedDate}
              </span>
              <button
                type="button"
                onClick={() => setExpandedDates(new Set())}
                className="text-xs text-primary font-semibold hover:underline cursor-pointer"
              >
                Back to all days
              </button>
            </div>
          ) : (
            <TablePagination
              currentPage={dailyPage}
              totalPages={totalDailyPages}
              totalRecords={dailyExpenseGroups.length}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={setDailyPage}
              itemLabel="days"
            />
          )
        ) : (
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={filteredExpenses.length}
            startIndex={startIndex}
            endIndex={endIndex}
            pageSize={ITEMS_PER_PAGE}
            onPageChange={setCurrentPage}
            itemLabel="records"
          />
        )}
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
        <ConfirmModal
          open={Boolean(deleteConfirmExpense)}
          onOpenChange={(open) => !open && setDeleteConfirmExpense(null)}
          title="Delete Expense Record"
          description={
            <>
              Are you sure you want to delete this expense record? This action will remove the record from the company ledger.
              {deleteConfirmExpense && (
                <div className="mt-3 p-3.5 rounded-xl bg-rose-50/60 border border-rose-200/60 space-y-1.5 text-xs text-left">
                  <div className="flex justify-between">
                    <span className="text-muted-fg">Particulars:</span>
                    <span className="font-semibold text-focus truncate max-w-[200px]">
                      {deleteConfirmExpense.particulars}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-fg">Withdrawal:</span>
                    <span className="font-bold text-rose-600">
                      {formatPHP(deleteConfirmExpense.withdrawal)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-fg">Ref No:</span>
                    <span className="font-mono text-focus">{deleteConfirmExpense.refNo}</span>
                  </div>
                </div>
              )}
            </>
          }
          confirmLabel="Delete Record"
          loadingLabel="Deleting…"
          variant="destructive"
          action="delete"
          isLoading={isDeleting}
          onConfirm={handleConfirmDelete}
        />
      )}

      {/* Delete Day Confirmation Dialog */}
      {!isAdmin && (
        <ConfirmModal
          open={Boolean(deleteConfirmDay)}
          onOpenChange={(open) => !open && setDeleteConfirmDay(null)}
          title="Delete Day Expense Records"
          description={
            <>
              Are you sure you want to delete all {deleteConfirmDay?.items.length} expense records for{' '}
              <strong className="text-focus">{deleteConfirmDay ? formatDisplayDate(deleteConfirmDay.date) : ''}</strong>? This action will remove all disbursements on this day from the ledger.
            </>
          }
          confirmLabel="Delete Day"
          loadingLabel="Deleting…"
          variant="destructive"
          action="delete"
          isLoading={isDeleting}
          onConfirm={handleConfirmDeleteDay}
        />
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

      {/* 3-Dots Action Portal Menu */}
      {openMenuExpenseId &&
        activeMenuExpense &&
        menuPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-48 bg-white rounded-xl border border-slate-200 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
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
              onClick={(e) => {
                e.stopPropagation()
                const exp = activeMenuExpense
                setOpenMenuExpenseId(null)
                setMenuPosition(null)
                setActiveMenuExpense(null)
                if (exp) handleOpenRow(exp)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>See Details</span>
            </button>

            {canAuditActions && (
              <>
                <button
                  type="button"
                  onClick={(e) =>
                    handleMarkExpenseAudit(activeMenuExpense, 'Verified', e)
                  }
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Mark as Audited</span>
                </button>

                <button
                  type="button"
                  onClick={(e) =>
                    handleMarkExpenseAudit(activeMenuExpense, 'Flagged', e)
                  }
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Flag Discrepancy</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )}

      {/* Day-Level 3-Dots Portal Menu */}
      {dayMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-52 bg-white rounded-2xl border border-slate-200 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${dayMenu.top}px`,
              right: `${dayMenu.right}px`,
              transform: dayMenu.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                toggleDateExpansion(dayMenu.date)
                setDayMenu(null)
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>{expandedDates.has(dayMenu.date) ? 'Hide Transactions' : 'View Transactions'}</span>
            </button>

            {isCompanyUser && !isOwner && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const target = dayMenu.items[0]
                    setDayMenu(null)
                    if (target) {
                      navigate('/expense/add', {
                        state: { editExpense: target },
                      })
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const items = dayMenu.items
                    const date = dayMenu.date
                    setDayMenu(null)
                    if (items && items.length > 0) {
                      setDeleteConfirmDay({ date, items })
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Delete</span>
                </button>
              </>
            )}

            {canAuditActions && (() => {
              const pending = dayMenu.items.filter((e) => e.auditStatus !== 'Verified' && e.auditStatus !== 'Flagged')
              return (
                <>
                  <button
                    type="button"
                    disabled={pending.length === 0}
                    onClick={() => {
                      pending.forEach((e) => {
                        handleMarkExpenseAudit(e, 'Verified')
                      })
                      setDayMenu(null)
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Mark day as Audited {pending.length > 0 ? `(${pending.length})` : ''}</span>
                  </button>
                  <button
                    type="button"
                    disabled={pending.length === 0}
                    onClick={() => {
                      pending.forEach((e) => {
                        handleMarkExpenseAudit(e, 'Flagged')
                      })
                      setDayMenu(null)
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>Flag Day Discrepancy</span>
                  </button>
                </>
              )
            })()}
          </div>,
          document.body
        )}
    </div>
  )
}
