import { formatRealName } from '@/utils/formatRealName'
import * as React from 'react'
import {
  Download,
  Plus,
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Building2,
  Check,
  FileSpreadsheet,
  FileText,
  Calendar,
  TrendingUp,
  Wallet,
  AlertCircle,
  Trash2,
  Loader2,
  CheckCircle2,
  ArrowDownLeft,
  MoreVertical,
  Eye,
  Pencil,
  Lock,
  Receipt,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { Card } from '@/components/ui/card'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { CardSkeleton } from '@/components/common/CardSkeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
import { IncomeSummaryChart } from '@/components/dashboard/CategorySummaryChart'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { AddSalesModal } from '@/components/dashboard/AddSalesModal'
import { useReceivables } from '@/hooks/useReceivables'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'
import { notifyError, formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import {
  salesService,
  type SalesItem,
} from '@/services/salesService'
import { bankService } from '@/services/bankService'
import type { DashboardTransactionItem } from '@/services/dashboardService'
import { useSession } from '@/hooks/useSession'
import { formatPHP } from '@/lib/format'
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
import { useCompany } from '@/context/CompanyContext'
import { isCompanyMatch } from '@/utils/companyUtils'
import { loanService } from '@/services/loanService'
import { websocketService } from '@/services/websocketService'

const DEFAULT_COMPANY_LIST = ['All Companies']

// Period options: Daily, Quarterly, Monthly, Annually
const PERIOD_OPTIONS = ['Daily', 'Quarterly', 'Monthly', 'Annually'] as const
type PeriodType = (typeof PERIOD_OPTIONS)[number]

import { getRealizedCashForSale } from '@/utils/cashLedgerUtils'
import type { UtangSale } from '@/services/receivablesStore'
import { reportAuditSaveFailure } from '@/services/auditReviewApi'

const ITEMS_PER_PAGE = 10

export const SalesPage: React.FC = () => {
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
  const isAuditor = isAudit
  const isOwner = userRole === 'owner'
  const canAuditActions = isAudit && !isOwner
  const canAdd = !isAudit && !isOwner && (isCompanyUser || isFinance)
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'


  // Dynamic company list loaded strictly from the database
  const [companyList, setCompanyList] = React.useState<string[]>(() => {
    if (allCompanies && allCompanies.length > 0) return allCompanies
    return DEFAULT_COMPANY_LIST
  })

  // Keep in sync with dynamic companies from CompanyContext
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
  }, [allCompanies, isAdmin, isFinance, user])

  // Filter state
  const [selectedCompany, setSelectedCompany] = React.useState<string>(() => {
    if (isCompanyScoped && assignedCompany) return assignedCompany
    if (activeCompany && activeCompany !== 'All Companies') return activeCompany
    return activeCompany || 'All Companies'
  })

  // Prefetch bank accounts so /sales/add has Deposit Bank ready in 0ms
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

  const [dateRange, setDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
    preset: 'All Dates',
  })

  // Food Receivables store integration
  const {
    sales: utangSalesList,
    kpis: receivablesKpis,
    refreshFromBackend: refreshReceivablesFromBackend,
  } = useReceivables(
    {
      startDate: dateRange.startDate || undefined,
      endDate: dateRange.endDate || undefined,
    },
    isCompanyScoped ? assignedCompany : selectedCompany
  )
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<
    'All' | 'Paid' | 'Pending' | 'Unpaid'
  >('All')
  const [selectedPeriod, setSelectedPeriod] =
    React.useState<PeriodType>('Monthly')
  const [tableTab, setTableTab] = React.useState<'Deposit' | 'Sales Record'>(
    'Sales Record'
  )

  // Handle switching period (Daily, Quarterly, Monthly, Annually)
  const handlePeriodChange = (period: PeriodType) => {
    setSelectedPeriod(period)
    setIsPeriodDropdownOpen(false)
    const currentToday = formatToYYYYMMDD(new Date())
    const [currYear, currMonth, currDay] = currentToday.split('-')

    if (period === 'Daily') {
      setDateRange({
        startDate: currentToday,
        endDate: currentToday,
        label: `Today (${currMonth}/${currDay}/${currYear})`,
        preset: 'Daily',
      })
    } else if (period === 'Monthly') {
      setDateRange({
        startDate: `${currYear}-${currMonth}-01`,
        endDate: `${currYear}-${currMonth}-31`,
        label: 'This Month',
        preset: 'This Month',
      })
    } else if (period === 'Quarterly') {
      setDateRange({
        startDate: `${currYear}-10-01`,
        endDate: `${currYear}-12-31`,
        label: 'Q4 2026',
        preset: 'This Quarter',
      })
    } else if (period === 'Annually') {
      setDateRange({
        startDate: `${currYear}-01-01`,
        endDate: `${currYear}-12-31`,
        label: `Year ${currYear}`,
        preset: 'This Year',
      })
    }
  }

  // Dropdowns state
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] =
    React.useState(false)
  const [companySearch, setCompanySearch] = React.useState('')

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)

  const exportPos = useDropdownPosition(exportDropdownRef, isExportDropdownOpen)
  const periodPos = useDropdownPosition(periodDropdownRef, isPeriodDropdownOpen)
  const statusPos = useDropdownPosition(statusDropdownRef, isStatusDropdownOpen)
  const companyPos = useDropdownPosition(companyDropdownRef, isCompanyDropdownOpen)

  const filteredCompanyList = React.useMemo(() => {
    const q = companySearch.toLowerCase().trim()
    if (!q) return companyList
    return companyList.filter((c) => c.toLowerCase().includes(q))
  }, [companySearch, companyList])

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
  const [selectedSale, setSelectedSale] = React.useState<SalesItem | null>(null)
  const [deleteConfirmSale, setDeleteConfirmSale] =
    React.useState<SalesItem | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [selectedTx, setSelectedTx] =
    React.useState<DashboardTransactionItem | null>(null)
  const [isAuditModalOpen, setIsAuditModalOpen] = React.useState(false)

  // Highlight state for newly added sale
  const [highlightedSaleId, setHighlightedSaleId] = React.useState<
    string | null
  >(null)
  const highlightTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  // Clear highlight timeout on unmount
  React.useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // Handlers for edit and delete
  const handleSaleUpdated = (updatedItem: SalesItem) => {
    setSales((prev) =>
      prev.map((s) => (s.id === updatedItem.id ? updatedItem : s))
    )
    setSelectedSale(updatedItem)
    setSelectedTx(salesService.toDashboardTransaction(updatedItem))
    setHighlightedSaleId(updatedItem.id)
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedSaleId(null)
    }, 3000)
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmSale || isAdmin) return
    setIsDeleting(true)
    try {
      await salesService.deleteSale(deleteConfirmSale.id)
      setSales((prev) => prev.filter((s) => s.id !== deleteConfirmSale.id))
      setDeleteConfirmSale(null)
    } catch (err) {
      console.error('Delete sale error:', err)
      notifyError(err, 'Unable to delete sale record. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // 3-Dots Action Menu for Audit
  const [openMenuSaleId, setOpenMenuSaleId] = React.useState<string | null>(
    null
  )
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)
  const [activeMenuSale, setActiveMenuSale] = React.useState<SalesItem | null>(
    null
  )

  const handleMarkSaleAudit = (
    sale: SalesItem,
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
    const updated: SalesItem = {
      ...sale,
      auditStatus: status,
      auditedBy: auditorName,
      auditDate: timestamp,
    }
    setSales((prev) => prev.map((s) => (s.id === sale.id ? updated : s)))
    salesService.updateSaleAuditStatus(sale.id, status, auditorName).catch((err) => {
      // Spec 0014: show the real status again when the server did not save it.
      reportAuditSaveFailure(err)
      loadSales()
    })
    setOpenMenuSaleId(null)
    setMenuPosition(null)
    setActiveMenuSale(null)
  }

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)

  // Data state
  const [sales, setSales] = React.useState<SalesItem[]>([])
  const [loading, setLoading] = React.useState(true)

  // Load sales data. `silent` reloads without the loading skeleton (used by realtime updates).
  const loadSales = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const targetCompany = isCompanyScoped
        ? assignedCompany
        : selectedCompany === 'All Companies'
          ? undefined
          : selectedCompany
      const data = await salesService.getSales(targetCompany)
      setSales(data)
    } catch (err) {
      console.error('Failed to load sales data:', err)
      notifyError(err, 'Unable to load sales records. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [isCompanyScoped, assignedCompany, selectedCompany])

  React.useEffect(() => {
    loadSales()
  }, [loadSales])

  // Realtime: sync on SALES_UPDATED, RECEIVABLES_UPDATED, AUDIT_UPDATED, WS reconnect, and window focus (AC-10)
  React.useEffect(() => {
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        salesService.invalidateCache()
        void loadSales(true)
        void refreshReceivablesFromBackend()
      }, 250)
    }
    const unsubAudit = websocketService.subscribe('AUDIT_UPDATED', reload)
    const unsubSales = websocketService.subscribe('SALES_UPDATED', reload)
    const unsubReceivables = websocketService.subscribe('RECEIVABLES_UPDATED', reload)
    const unsubStatus = websocketService.subscribe('WS_STATUS_CHANGE', (data) => {
      if (data?.status === 'connected') {
        reload()
      }
    })
    window.addEventListener('focus', reload)
    return () => {
      if (timer) window.clearTimeout(timer)
      unsubAudit()
      unsubSales()
      unsubReceivables()
      unsubStatus()
      window.removeEventListener('focus', reload)
    }
  }, [loadSales, refreshReceivablesFromBackend])

  // Click-outside listeners for dropdowns
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
      if (
        companyDropdownRef.current &&
        !companyDropdownRef.current.contains(target)
      ) {
        setIsCompanyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Group linked receivables by sale_id so partial & full payments reflect accurately in Total Cash (AC-5)
  const receivablesBySaleId = React.useMemo(() => {
    const map = new Map<number, UtangSale[]>()
    for (const u of utangSalesList) {
      if (u.sale_id !== null && u.sale_id !== undefined) {
        const numId = Number(u.sale_id)
        if (!Number.isNaN(numId)) {
          const list = map.get(numId) || []
          list.push(u)
          map.set(numId, list)
        }
      }
    }
    return map
  }, [utangSalesList])

  const getRealizedCash = React.useCallback(
    (item: SalesItem): number => {
      const numId = Number(item.id)
      const linked = !Number.isNaN(numId) ? receivablesBySaleId.get(numId) : undefined
      return getRealizedCashForSale(item, linked)
    },
    [receivablesBySaleId]
  )

  // Map ONLY standalone legacy food utang sales (where sale_id is null) to SalesItem structure
  const mappedUtangSales = React.useMemo<SalesItem[]>(() => {
    return utangSalesList
      .filter((u) => !u.sale_id)
      .map((u) => {
        const rawDate = u.date
        const [year, month, day] = rawDate.split('-')
        const displayDate =
          month && day ? `${month}/${day}/${year?.slice(2) || '26'}` : rawDate

        return {
          id: `utang-${u.id}`,
          refNo: `FD-${u.id.replace('SALE-2026-', '')}`,
          chequeNo:
            u.payment_status === 'Paid'
              ? 'PAID-IN-FULL'
              : u.payment_status === 'Partial'
                ? 'PARTIAL-CREDIT'
                : 'PAY-LATER',
          date: displayDate,
          rawDate: u.date,
          particulars: `${u.items_summary} (${u.customer_name} • ${u.customer_type})`,
          withdrawal: 0,
          deposit: u.total_amount,
          netAmount: u.total_amount,
          category: 'Food Sales',
          paymentMethod:
            u.payment_status === 'Paid'
              ? 'Cash'
              : u.payment_status === 'Partial'
                ? 'Partial Credit'
                : 'Utang (Pay Later)',
          company: u.company || 'MyCity.Kitchen Corporation',
          items: [
            ...(u.amount_paid > 0
              ? [
                  {
                    particulars: `${u.items_summary} (Downpayment)`,
                    unitPrice: u.amount_paid,
                    quantity: 1,
                    total: u.amount_paid,
                    status: 'Paid' as const,
                  },
                ]
              : []),
            ...(u.balance > 0
              ? [
                  {
                    particulars: `${u.items_summary} (Utang Balance)`,
                    unitPrice: u.balance,
                    quantity: 1,
                    total: u.balance,
                    status: 'Unpaid' as const,
                  },
                ]
              : []),
          ],
          status: (u.payment_status === 'Paid'
            ? 'Paid'
            : u.payment_status === 'Partial'
              ? 'Pending'
              : 'Unpaid') as any,
          auditStatus: u.is_locked ? 'Verified' : 'Pending Audit',
          createdAt: `${u.date}T10:00:00Z`,
          type: 'Sales' as const,
          isStandaloneUtang: true,
          customer_name: u.customer_name,
          customer_type: u.customer_type,
          amount_paid: u.amount_paid,
          balance: u.balance,
          payment_status: u.payment_status,
        } as SalesItem & {
          isStandaloneUtang?: boolean
          customer_name?: string
          customer_type?: string
          amount_paid?: number
          balance?: number
          payment_status?: string
        }
      })
  }, [utangSalesList])

  const combinedSales = React.useMemo(() => {
    return [...mappedUtangSales, ...sales]
  }, [mappedUtangSales, sales])

  // 1. Base filtered sales (independent of Deposit / Sales Record tab so KPIs above stay constant)
  const baseFilteredSales = React.useMemo(() => {
    const targetCompany = isCompanyScoped ? assignedCompany : selectedCompany

    return combinedSales
      .filter((item) => {
        // 1. Company filter
        if (
          targetCompany !== 'All Companies' &&
          !isCompanyMatch(item.company, targetCompany)
        ) {
          return false
        }

        // 2. Date range filter
        if (
          !isDateInRange(
            item.rawDate || item.date,
            dateRange.startDate,
            dateRange.endDate
          )
        ) {
          return false
        }

        // 3. Particulars-aware Status filter ('All' | 'Paid' | 'Pending' | 'Unpaid')
        if (
          !matchesParticularsStatusFilter(
            item.particulars,
            item.items,
            item.status,
            statusFilter,
            item.deposit
          )
        ) {
          return false
        }

        // 4. Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim()
          const matchRef = (item.refNo || '').toLowerCase().includes(q)
          const matchCheque = (item.chequeNo || '').toLowerCase().includes(q)
          const matchParticulars = (item.particulars || '')
            .toLowerCase()
            .includes(q)
          const matchPaymentMethod = (item.paymentMethod || '')
            .toLowerCase()
            .includes(q)
          const matchCompany = (item.company || '').toLowerCase().includes(q)
          const matchStatus = (item.status || '').toLowerCase().includes(q)
          const matchAmount = String(
            item.netAmount || item.deposit || ''
          ).includes(q)

          if (
            !matchRef &&
            !matchCheque &&
            !matchParticulars &&
            !matchPaymentMethod &&
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
    combinedSales,
    selectedCompany,
    dateRange,
    statusFilter,
    searchQuery,
    isCompanyScoped,
    assignedCompany,
  ])

  // 2. Dynamic Tab Filtering ('Deposit' vs 'Sales Record') for Table & Chart
  const filteredSales = React.useMemo(() => {
    if (tableTab === 'Deposit') {
      return baseFilteredSales.filter((item) => getRealizedCash(item) > 0)
    }
    return baseFilteredSales
  }, [baseFilteredSales, tableTab, getRealizedCash])

  // Reset to page 1 on filter change
  React.useEffect(() => {
    setCurrentPage(1)
  }, [
    dateRange,
    searchQuery,
    statusFilter,
    selectedCompany,
    selectedPeriod,
    tableTab,
  ])

  // KPI Calculation: Total Sales & Total Cash (AC-5: includes partial & full payments without double-counting)
  const kpis = React.useMemo(() => {
    let salesTotal = 0
    let cashTotal = 0
    baseFilteredSales.forEach((s) => {
      salesTotal += s.deposit || 0
      cashTotal += getRealizedCash(s)
    })
    return {
      totalSales: salesTotal,
      totalCash: cashTotal,
      totalIncome: salesTotal,
      outstandingUtang: receivablesKpis.totalOutstanding,
    }
  }, [baseFilteredSales, getRealizedCash, receivablesKpis.totalOutstanding])

  // Effective status filter for particulars display in table & modal
  const effectiveParticularsStatusFilter = React.useMemo(() => {
    if (statusFilter !== 'All') return statusFilter
    if (tableTab === 'Deposit') return 'Paid'
    return 'All'
  }, [statusFilter, tableTab])

  // Pagination calculation
  const totalPages = Math.ceil(filteredSales.length / ITEMS_PER_PAGE) || 1
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredSales.length)
  const paginatedSales = filteredSales.slice(startIndex, endIndex)

  // Map sales to DashboardTransactionItems for IncomeSummaryChart (dynamically reflects Deposit vs Sales Record tab)
  const mappedTransactions = React.useMemo(() => {
    return filteredSales.map((s) => {
      const tx = salesService.toDashboardTransaction(s)
      if (tableTab === 'Deposit') {
        const paidAmt = getRealizedCash(s)
        return {
          ...tx,
          amount: paidAmt,
          deposit: paidAmt,
        }
      }
      return tx
    })
  }, [filteredSales, tableTab, getRealizedCash])

  // Export handlers
  const companyForExport = isCompanyScoped ? assignedCompany : selectedCompany

  const handleExportCsv = () => {
    salesService.exportCsv(
      filteredSales,
      `sales_summary_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
    )
    setIsExportDropdownOpen(false)
  }

  const handleExportPdf = () => {
    salesService.exportPdf(filteredSales, companyForExport)
    setIsExportDropdownOpen(false)
  }

  const handleSaleAdded = (newItem: SalesItem) => {
    setSales((prev) => [newItem, ...prev])
    setSearchQuery('')
    setStatusFilter('All')

    const newDateIso = newItem.rawDate || normalizeDateToYYYYMMDD(newItem.date)
    if (!isDateInRange(newDateIso, dateRange.startDate, dateRange.endDate)) {
      setDateRange((prev) => ({
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
    setHighlightedSaleId(newItem.id)

    setTimeout(() => {
      tableCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 100)

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedSaleId(null)
    }, 3000)
  }

  const handleOpenRow = (item: SalesItem) => {
    setSelectedSale(item)
    setSelectedTx(salesService.toDashboardTransaction(item))
    setIsAuditModalOpen(true)
  }

  const displayedCompanyTitle = isCompanyScoped
    ? assignedCompany
    : selectedCompany === 'All Companies'
      ? 'MCT Group of Companies'
      : selectedCompany

  return (
    <div className="space-y-6 pb-10 max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {/* 1. Header & Controls */}
      <div className="space-y-4">
        {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
              Sales
            </h1>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Here's the summary of sales in {displayedCompanyTitle}
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

            {/* Action Button: Add Sales */}
            {canAdd && (
              <Button
                type="button"
                onClick={() => navigate('/sales/add')}
                className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>Add Sales</span>
              </Button>
            )}
          </div>
        </div>

        {/* Second Row: Search Bar & Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-muted-fg absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Ref No. or Cheque No. (or customer)…"
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {/* Custom Period Dropdown: Daily, Quarterly, Monthly, Annually */}
            <div ref={periodDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsPeriodDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  isPeriodDropdownOpen &&
                    'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <Calendar className="h-4 w-4 text-muted-fg shrink-0" />
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
                      : 'absolute right-0 top-full mt-2 w-44'
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
                        {st === 'All'
                          ? 'All Status'
                          : st === 'Paid'
                            ? 'Paid'
                            : st === 'Pending'
                              ? 'Pending'
                              : 'Unpaid'}
                      </span>
                      {statusFilter === st && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Unified Date Range Picker */}
            <DateRangePicker
              value={dateRange}
              onChange={(newRange) => setDateRange(newRange)}
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
                  aria-label="Filter sales by company"
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
            )}

            {/* Dynamic Tab Switcher: Deposit / Sales Record (Drives Chart & Table below; KPIs above remain independent) */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setTableTab('Deposit')}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none',
                  tableTab === 'Deposit'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <ArrowDownLeft className="h-3.5 w-3.5 shrink-0" />
                Deposit
              </button>
              <button
                type="button"
                onClick={() => setTableTab('Sales Record')}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none',
                  tableTab === 'Sales Record'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                Sales Record
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Three Numbers Kept Separate: Total Sales, Cash Collected & Outstanding Utang Side by Side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Total Sales (date) = all sales that day/period, paid and unpaid */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-semibold text-muted-fg block">
              Total Sales
            </span>
            {loading ? (
              <CardSkeleton inline={true} />
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalSales)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  All sales volume (paid & credit) for {dateRange.label || 'selected period'}
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
            <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* 2. Cash Collected (date) = payments received that day/period, including payments on old utang */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-semibold text-muted-fg block">
              Cash Collected
            </span>
            {loading ? (
              <CardSkeleton inline={true} />
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalCash)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Cash collected today & on settled utang
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
            <Wallet className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* 3. Outstanding Utang = sum of all unpaid balances */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40 group">
          <div className="w-full max-w-[calc(100%-60px)]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-fg block">
                Outstanding Utang
              </span>
              <button
                type="button"
                onClick={() => navigate('/receivables')}
                className="inline-flex items-center text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
              >
                View Ledger &rarr;
              </button>
            </div>
            {loading ? (
              <CardSkeleton inline={true} />
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(receivablesKpis.totalOutstanding)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Ext: {formatPHP(receivablesKpis.totalExternalUtang)} &bull; Staff: {formatPHP(receivablesKpis.totalStaffUtang)}
                </p>
              </>
            )}
          </div>

          <div
            onClick={() => navigate('/receivables')}
            className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs cursor-pointer group-hover:bg-slate-200 transition-colors"
            title="Open Receivables Page"
          >
            <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
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
            <Skeleton className="h-56 sm:h-64 w-full rounded-2xl" />
          </Card>
        ) : (
          <IncomeSummaryChart
            transactions={mappedTransactions}
            className="w-full"
          />
        )}
      </div>

      {/* 5. Summary Transactions in Sales */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Dynamic Tab Context Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 mb-2 border-b border-slate-100">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border',
                tableTab === 'Deposit'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20'
              )}
            >
              {tableTab === 'Deposit' ? (
                <>
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Deposit View (Collected / Paid Inflows)</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Sales Record View (All Sales Particulars)</span>
                </>
              )}
            </span>

            {statusFilter !== 'All' && (
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
            )}
          </div>

          <span className="text-xs text-muted-fg font-medium">
            {filteredSales.length}{' '}
            {tableTab === 'Deposit' ? 'deposit' : 'sales'}{' '}
            {filteredSales.length === 1 ? 'record' : 'records'} shown
          </span>
        </div>

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
                <TableHead className="w-[12%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  DATE
                </TableHead>
                <TableHead className="w-[15%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  COMPANY
                </TableHead>
                <TableHead className="w-[11%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CHEQUE NO.
                </TableHead>
                <TableHead className="w-[21%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  PARTICULARS
                </TableHead>
                <TableHead className="w-[11%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  {tableTab === 'Deposit' ? 'DEPOSITED' : 'DEPOSIT'}
                </TableHead>
                <TableHead className="w-[11%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CATEGORY
                </TableHead>
                <TableHead className="w-[11%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  NET AMOUNT
                </TableHead>
                <TableHead className="w-[8%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableSkeleton rows={5} columns={8} />
              ) : paginatedSales.length === 0 ? (
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
                        No {tableTab === 'Deposit' ? 'deposit' : 'sales'} records
                        found
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        There are no{' '}
                        {tableTab === 'Deposit' ? 'deposit' : 'sales'}{' '}
                        transactions recorded for {displayedCompanyTitle} matching
                        your current filters.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedSales.map((sale) => {
                  const fallbackStatus = normalizeParticularStatus(
                    sale.status,
                    'Paid'
                  )
                  const summary = getParticularsSummary(
                    sale.particulars,
                    sale.items,
                    {
                      statusFilter: effectiveParticularsStatusFilter,
                      fallbackStatus,
                      fallbackTotal: sale.deposit,
                    }
                  )
                  const rowAmount =
                    tableTab === 'Deposit' && statusFilter === 'All'
                      ? getRealizedCash(sale)
                      : effectiveParticularsStatusFilter !== 'All'
                        ? summary.filteredTotal
                        : sale.deposit
                  const createdAtTime = formatCreatedAt(sale.createdAt, {
                    timeOnly: true,
                  })

                  return (
                    <TableRow
                      key={sale.id}
                      id={`sale-row-${sale.id}`}
                      onClick={() => handleOpenRow(sale)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-300 cursor-pointer',
                        highlightedSaleId === sale.id &&
                          'bg-amber-100/90 hover:bg-amber-100/90 ring-2 ring-amber-500 shadow-md font-semibold'
                      )}
                      title="Click to view complete details"
                    >
                      {/* 1. Date & Created At Time */}
                      <TableCell className="w-[12%] px-3.5 py-3.5 text-xs font-medium text-focus truncate text-left">
                        <div className="flex flex-col truncate">
                          <div className="flex items-center gap-1.5 truncate">
                            <span>{sale.date}</span>
                            {highlightedSaleId === sale.id && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#960C01] text-white shadow-xs animate-bounce shrink-0">
                                NEW
                              </span>
                            )}
                          </div>
                          {createdAtTime && (
                            <span
                              className="text-[10px] text-muted-fg font-mono mt-0.5"
                              title={`Created at ${formatCreatedAt(sale.createdAt)}`}
                            >
                              {createdAtTime}
                            </span>
                          )}
                          {sale.auditStatus &&
                            sale.auditStatus !== 'Pending Audit' && (
                              <div className="mt-1 flex items-center gap-1">
                                <span
                                  className={cn(
                                    'inline-block px-1.5 py-0.2 rounded text-[9.5px] font-bold border',
                                    sale.auditStatus === 'Verified'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-rose-50 text-rose-700 border-rose-200'
                                  )}
                                >
                                  {sale.auditStatus === 'Verified'
                                    ? 'Audited'
                                    : 'Discrepancy'}
                                </span>
                              </div>
                            )}
                          {sale.auditDate &&
                            sale.auditStatus === 'Verified' && (
                              <span className="text-[9.5px] text-muted-fg font-mono mt-0.5">
                                {sale.auditDate}
                              </span>
                            )}
                        </div>
                      </TableCell>

                      {/* 2. Company */}
                      <TableCell
                        className="w-[15%] px-3.5 py-3.5 text-xs font-semibold text-focus truncate text-left"
                        title={sale.company}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">{sale.company}</span>
                        </div>
                      </TableCell>

                      {/* 3. Cheque No */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs text-focus/90 truncate font-mono text-left">
                        {sale.chequeNo || '—'}
                      </TableCell>

                      {/* 4. Particulars & Payment Status Badge (Paid = green, Partial = amber, Unpaid = red) */}
                      <TableCell
                        className="w-[21%] px-3.5 py-3.5 text-xs text-focus/90 font-normal text-left"
                        title={sale.particulars}
                      >
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate block font-semibold text-focus">
                              {summary.firstItemName}
                            </span>
                            {/* Color-coded badge: Paid = green, Partial = amber, Unpaid = red */}
                            {(() => {
                              const st = (sale as any).payment_status || (sale.status === 'Overdue' ? 'Unpaid' : sale.status)
                              const isPaid = st === 'Paid'
                              const isPartial = st === 'Partial'
                              const isUnpaid = st === 'Unpaid'

                              return (
                                <span
                                  className={cn(
                                    'shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wide uppercase',
                                    isPaid && 'bg-emerald-50 text-emerald-700 border-emerald-300',
                                    isPartial && 'bg-amber-50 text-amber-700 border-amber-300',
                                    isUnpaid && 'bg-rose-50 text-rose-700 border-rose-300',
                                    !isPaid && !isPartial && !isUnpaid && 'bg-yellow-100 text-yellow-800 border-yellow-300'
                                  )}
                                >
                                  {st}
                                </span>
                              )
                            })()}
                            {summary.count > 1 && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                +{summary.count - 1} more
                              </span>
                            )}
                          </div>

                          {/* Customer / Debtor details for food utang sales */}
                          {(sale as any).customer_name && (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-fg flex-wrap">
                              <span className="font-medium text-slate-700">
                                {(sale as any).customer_name}
                              </span>
                              <span>&bull;</span>
                              <span className={cn(
                                'font-semibold',
                                (sale as any).customer_type === 'Staff' ? 'text-indigo-600' : 'text-slate-600'
                              )}>
                                {(sale as any).customer_type}
                              </span>
                              {((sale as any).balance || 0) > 0 && (
                                <>
                                  <span>&bull;</span>
                                  <span className="font-bold text-rose-600">
                                    Bal: {formatPHP((sale as any).balance)}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* 5. Deposit */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs font-semibold text-left tabular-nums whitespace-nowrap text-emerald-600">
                        {rowAmount > 0 ? formatPHP(rowAmount) : '—'}
                      </TableCell>

                      {/* 6. Category + Payment Method */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-xs text-focus font-medium text-left">
                        <span
                          className="truncate block font-semibold text-focus"
                          title={
                            sale.category && sale.category !== 'None'
                              ? sale.category
                              : 'Uncategorized'
                          }
                        >
                          {sale.category && sale.category !== 'None'
                            ? sale.category
                            : 'Uncategorized'}
                        </span>
                        <span
                          className="truncate block text-[11px] text-muted-fg"
                          title={sale.paymentMethod || 'Cash'}
                        >
                          {sale.paymentMethod || 'Cash'}
                        </span>
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
                                if (openMenuSaleId === sale.id) {
                                  setOpenMenuSaleId(null)
                                  setMenuPosition(null)
                                  setActiveMenuSale(null)
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
                                  setActiveMenuSale(sale)
                                  setOpenMenuSaleId(sale.id)
                                }
                              }}
                              className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                              title="Audit Actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          ) : isOwner ? (
                            <span className="text-muted-fg text-xs">—</span>
                          ) : sale.auditStatus === 'Verified' ? (
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
                                  navigate('/sales/add', {
                                    state: { editSale: sale },
                                  })
                                }
                                className="h-7 w-7 p-0 rounded-lg text-slate-500 hover:text-focus hover:bg-slate-100 cursor-pointer"
                                title="Edit Sale & Particulars"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmSale(sale)}
                                className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                title="Delete Sale"
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
            {filteredSales.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredSales.length} records`}
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


      {/* Add Sales Modal */}
      <AddSalesModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onSuccess={handleSaleAdded}
        assignedCompany={isCompanyScoped ? assignedCompany : selectedCompany}
      />

      {/* Delete Confirmation Dialog */}
      {!isAdmin && (
        <Dialog
          open={!!deleteConfirmSale}
          onOpenChange={(open) => !open && setDeleteConfirmSale(null)}
        >
          <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
            <DialogHeader>
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center mb-2">
                <Trash2 className="w-5 h-5" />
              </div>
              <DialogTitle className="text-lg font-bold text-focus">
                Delete Sale Record
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-1">
                Are you sure you want to delete this sale entry{' '}
                <strong className="text-focus">
                  {deleteConfirmSale?.particulars}
                </strong>{' '}
                ({deleteConfirmSale?.refNo}) for{' '}
                <strong className="text-focus">
                  {deleteConfirmSale?.deposit
                    ? formatPHP(deleteConfirmSale.deposit)
                    : ''}
                </strong>
                ? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteConfirmSale(null)}
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
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  'Delete'
                )}
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
            setSelectedSale(null)
            setSelectedTx(null)
          }
        }}
        transaction={selectedTx}
        sale={selectedSale}
        onSaleUpdated={handleSaleUpdated}
        editable={!isAdmin && selectedSale?.auditStatus !== 'Verified'}
        statusFilter={effectiveParticularsStatusFilter}
      />

      {/* 3-Dots Action Portal Menu for Audit */}
      {openMenuSaleId &&
        activeMenuSale &&
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
                handleMarkSaleAudit(activeMenuSale, 'Verified', e)
              }
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Mark as Audit</span>
            </button>

            <button
              type="button"
              onClick={(e) => handleMarkSaleAudit(activeMenuSale, 'Flagged', e)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Mark as Discrepancy</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const s = activeMenuSale
                setOpenMenuSaleId(null)
                setMenuPosition(null)
                setActiveMenuSale(null)
                if (s) handleOpenRow(s)
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
