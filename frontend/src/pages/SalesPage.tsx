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
  ArrowLeft,
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
  Landmark,
  Lock,
  Receipt,
  MessageSquare,
  HelpCircle,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { Card } from '@/components/ui/card'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TablePagination } from '@/components/common/TablePagination'
import { StatusPill } from '@/components/common/StatusPill'
import { CardSkeleton } from '@/components/common/CardSkeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
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
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DateRangePicker,
  type DateRange,
} from '@/components/ui/DateRangePicker'
import { TransactionDateRangeControl } from '@/components/transactions/TransactionDateRangeControl'
import { IncomeSummaryChart } from '@/components/dashboard/CategorySummaryChart'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { BankFilterSelect, useBankFilter } from '@/components/common/BankFilter'
import { DropdownFilter, type DropdownFilterOption } from '@/components/common/DropdownFilter'
import { DepositDateDialog } from '@/components/dashboard/DepositDateDialog'
import { AddSalesModal } from '@/components/dashboard/AddSalesModal'
import { useReceivables } from '@/hooks/useReceivables'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'
import { notifyError } from '@/utils/errorUtils'
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
  formatDisplayDate,
  formatToYYYYMMDD,
  formatCreatedAt,
} from '@/utils/dateUtils'
import { getCleanParticularsTitle } from '@/utils/transactionLifecycle'
import {
  getParticularsSummary,
  matchesParticularsStatusFilter,
  normalizeParticularStatus,
} from '@/utils/particularsUtils'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/context/CompanyContext'
import { useDailyRemarks } from '@/hooks/useDailyRemarks'
import { DayRemarkCell } from '@/components/dashboard/DayRemark'
import { isCompanyMatch } from '@/utils/companyUtils'
import { loanService } from '@/services/loanService'
import { websocketService } from '@/services/websocketService'

const DEFAULT_COMPANY_LIST = ['All Companies']

// Period options: Daily, Quarterly, Monthly, Annually
const PERIOD_OPTIONS = ['Daily', 'Quarterly', 'Monthly', 'Annually'] as const
type PeriodType = (typeof PERIOD_OPTIONS)[number]

import { getRealizedCashForSale } from '@/utils/cashLedgerUtils'
import { groupTransactionsByDate, type DailyGroupSummary } from '@/utils/dailyGroupUtils'
import { receivablesStore, type UtangSale } from '@/services/receivablesStore'
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
  const isAdminUser = userRole === 'admin'
  const isSupervisor =
    userRole.includes('supervisor') ||
    userRole.includes('company') ||
    (!isAudit && !isFinance && !isOwner)
  const isCompanyScoped = isStrictlyCompanyScoped
  const showCompanyColumn = !isCompanyScoped && userRole !== 'supervisor' && userRole !== 'company'
  const isAuditor = isAudit
  const isOwner = userRole === 'owner'
  const canAuditActions = (isAudit || isAdminUser) && !isOwner
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
  const statusFilterOptions: DropdownFilterOption<string>[] = React.useMemo(
    () => [
      { value: 'All', label: 'All Statuses' },
      { value: 'Paid', label: 'Paid' },
      { value: 'Pending', label: 'Pending' },
      { value: 'Unpaid', label: 'Unpaid' },
    ],
    []
  )
  const [selectedPeriod, setSelectedPeriod] =
    React.useState<PeriodType>('Monthly')
  const [tableTab, setTableTab] = React.useState<'Deposit' | 'Sales Record'>(
    'Sales Record'
  )
  const [subTab, setSubTab] = React.useState<'Daily Summary' | 'All Transactions'>('Daily Summary')
  const [expandedDates, setExpandedDates] = React.useState<Set<string>>(new Set())
  const [expandedDepositIds, setExpandedDepositIds] = React.useState<Set<string>>(new Set())
  const [dailyPage, setDailyPage] = React.useState(1)

  // Operational remarks dialog state
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = React.useState(false)
  const [remarksTargetSale, setRemarksTargetSale] = React.useState<SalesItem | null>(null)
  const [remarksInput, setRemarksInput] = React.useState('')
  const [isSavingRemarks, setIsSavingRemarks] = React.useState(false)

  const toggleDateExpansion = (dateKey: string) => {
    setExpandedDates((prev) => (prev.has(dateKey) ? new Set() : new Set([dateKey])))
  }

  const toggleDepositExpansion = (depositId: string) => {
    setExpandedDepositIds((prev) => {
      const next = new Set(prev)
      if (next.has(depositId)) next.delete(depositId)
      else next.add(depositId)
      return next
    })
  }

  const handleSaveRemarks = async () => {
    if (!remarksTargetSale) return
    setIsSavingRemarks(true)
    try {
      const updated = await salesService.updateSaleRemarks(remarksTargetSale.id, remarksInput)
      setSales((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      showToast('Remarks updated successfully.', 'success')
      setIsRemarksDialogOpen(false)
      setRemarksTargetSale(null)
    } catch (err: any) {
      showToast(err?.message || 'Failed to update remarks.', 'error')
    } finally {
      setIsSavingRemarks(false)
    }
  }

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
  const [deleteConfirmDay, setDeleteConfirmDay] =
    React.useState<{ date: string; items: SalesItem[] } | null>(null)
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

  // Toast notification state
  const [toast, setToast] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => {
      setToast(null)
    }, 4500)
  }

  const handleDepositStatusChange = async (sale: SalesItem, newStatus: 'Deposited' | 'Not Deposited') => {
    if (sale.auditStatus === 'Verified') {
      showToast('This sale has been Verified by an Auditor and is locked as read-only.', 'error')
      return
    }

    const st = (sale as any).payment_status || (sale.status === 'Overdue' ? 'Unpaid' : sale.status)
    if (newStatus === 'Deposited') {
      if (st === 'Unpaid') {
        showToast('Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first.', 'error')
        return
      }
      if (st === 'Pending') {
        const pm = (sale.paymentMethod || '').trim().toLowerCase()
        const hasChq = Boolean(sale.chequeNo && sale.chequeNo.trim())
        if (pm !== 'cheque' || !hasChq) {
          showToast('Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance.', 'error')
          return
        }
      }
    }

    if (newStatus === 'Deposited') {
      // Ask which bank and which day the money arrived before saving
      setDepositDialogSale(sale)
      return
    }
    await applyDepositStatus(sale, newStatus)
  }

  const applyDepositStatus = async (
    sale: SalesItem,
    newStatus: 'Deposited' | 'Not Deposited',
    depositDate?: string,
    bankAccountId?: string
  ) => {
    try {
      const updated = await salesService.updateSaleDepositStatus(
        sale.id,
        newStatus,
        depositDate,
        bankAccountId
      )
      setSales((prev) =>
        prev.map((s) =>
          s.id === sale.id
            ? {
                ...s,
                depositStatus: newStatus,
                deposit_status: newStatus,
                deposit_date: newStatus === 'Deposited' ? depositDate || updated.deposit_date || s.rawDate : null,
                depositDate: newStatus === 'Deposited' ? depositDate || updated.depositDate || s.rawDate : null,
                bankAccountId: bankAccountId || updated.bankAccountId || s.bankAccountId,
              }
            : s
        )
      )
      showToast(`Deposit status updated to ${newStatus}.`, 'success')
    } catch (err: any) {
      showToast(err?.message || 'Failed to update deposit status.', 'error')
    }
  }

  const [depositDialogSale, setDepositDialogSale] = React.useState<SalesItem | null>(null)

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
      if (deleteConfirmSale.id.startsWith('utang-')) {
        // A receivable with no sale behind it: delete it from receivables, not from sales
        const result = await receivablesStore.deleteSale(deleteConfirmSale.id.slice('utang-'.length))
        if (!result.success) throw new Error(result.message)
        await refreshReceivablesFromBackend()
      } else {
        await salesService.deleteSale(deleteConfirmSale.id)
        await refreshReceivablesFromBackend()
      }
      setSales((prev) => prev.filter((s) => s.id !== deleteConfirmSale.id))
      setDeleteConfirmSale(null)
    } catch (err) {
      console.error('Delete sale error:', err)
      notifyError(err, 'Unable to delete sale record. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleConfirmDeleteDay = async () => {
    if (!deleteConfirmDay || isAdmin) return
    setIsDeleting(true)
    try {
      for (const item of deleteConfirmDay.items) {
        if (item.id.startsWith('utang-')) {
          await receivablesStore.deleteSale(item.id.slice('utang-'.length))
        } else {
          await salesService.deleteSale(item.id)
        }
      }
      await refreshReceivablesFromBackend()
      const idsToDelete = new Set(deleteConfirmDay.items.map((i) => i.id))
      setSales((prev) => prev.filter((s) => !idsToDelete.has(s.id)))
      setDeleteConfirmDay(null)
      showToast('Day records deleted successfully.', 'success')
    } catch (err) {
      console.error('Delete day error:', err)
      notifyError(err, 'Unable to delete day records. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  // 3-Dots Action Menu state
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

  const [dayMenu, setDayMenu] = React.useState<{
    date: string
    items: SalesItem[]
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
    if (!openMenuSaleId) return
    const handleCloseMenu = () => {
      setOpenMenuSaleId(null)
      setMenuPosition(null)
      setActiveMenuSale(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseMenu()
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('scroll', handleCloseMenu, true)
    window.addEventListener('resize', handleCloseMenu)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('scroll', handleCloseMenu, true)
      window.removeEventListener('resize', handleCloseMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuSaleId])

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
  const [loadError, setLoadError] = React.useState<string | null>(null)

  // Load sales data. `silent` reloads without the loading skeleton (used by realtime updates).
  const loadSales = React.useCallback(async (silent = false, forceRefresh = false) => {
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const targetCompany = isCompanyScoped
        ? assignedCompany
        : selectedCompany === 'All Companies'
          ? undefined
          : selectedCompany
      const data = await salesService.getSales(targetCompany, forceRefresh)
      setSales(data)
    } catch (err) {
      console.error('Failed to load sales data:', err)
      setLoadError('Unable to load sales records. Please check your connection and try again.')
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
        void loadSales(true, true)
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
          company: u.company || '',
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
          auditStatus: 'Pending Audit',
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
    const enrichedSales = sales.map((s) => {
      const numId = Number(s.id)
      const linkedList = !Number.isNaN(numId) ? receivablesBySaleId.get(numId) : undefined
      const linked = linkedList && linkedList.length > 0 ? linkedList[0] : undefined
      if (!linked) return s
      return {
        ...s,
        customer_name: linked.customer_name,
        customer_type:
          (linked.customer_type as string) === 'Internal' ? 'Staff' : linked.customer_type,
        amount_paid: linked.amount_paid,
        balance: linked.balance,
        payment_status: linked.payment_status,
        status:
          linked.payment_status === 'Unpaid'
            ? 'Unpaid'
            : linked.payment_status === 'Partial'
              ? 'Pending'
              : s.status,
      } as SalesItem & {
        customer_name?: string
        customer_type?: string
        amount_paid?: number
        balance?: number
        payment_status?: string
      }
    })
    return [...mappedUtangSales, ...enrichedSales]
  }, [mappedUtangSales, sales, receivablesBySaleId])

  // 1. Base filtered sales (independent of Deposit / Sales Record tab so KPIs above stay constant)
  const {
    accounts: allBankAccounts,
    available: bankOptions,
    selectedId: selectedBankId,
    setSelectedId: setSelectedBankId,
    bankLabel,
  } = useBankFilter(isCompanyScoped ? assignedCompany : selectedCompany)

  // Everything except the date range, so the Sales Record tab can range by sale date and the
  // Deposit tab by bank deposit date.
  const preDateFilteredSales = React.useMemo(() => {
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

        // Bank filter ('' = All Banks)
        if (selectedBankId && String(item.bankAccountId || '') !== selectedBankId) {
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
  }, [
    combinedSales,
    selectedCompany,
    statusFilter,
    searchQuery,
    isCompanyScoped,
    assignedCompany,
    selectedBankId,
  ])

  // Day the sale happened (Sales Record tab, KPIs)
  const getSaleDay = (s: SalesItem) => s.rawDate || normalizeDateToYYYYMMDD(s.date)
  // Day the money reached the bank (Deposit tab). Older rows without one fall back to the sale day.
  const getDepositDay = (s: SalesItem) =>
    s.deposit_date || s.depositDate || getSaleDay(s)

  // Small line under the deposit badge: when and where the money landed, or that it is still in transit
  const renderDepositInfo = (sale: SalesItem) => {
    const isDeposited =
      (sale.depositStatus || sale.deposit_status) === 'Deposited'
    if (isDeposited) {
      const bank = sale.bankName || (sale.bankAccountId ? bankLabel(sale.bankAccountId) : '')
      return (
        <span className="block mt-1 text-[10px] font-medium text-emerald-700">
          {tableTab === 'Deposit' ? '' : 'Deposited '}
          {formatDisplayDate(getDepositDay(sale))}
          {bank && bank !== 'No bank' ? ` (${bank})` : ''}
        </span>
      )
    }
    // Paid but not yet in the bank (e.g. GCash waiting to be swept)
    if (sale.payment_status === 'Paid') {
      return <span className="block mt-1 text-[10px] font-medium text-amber-700">In transit</span>
    }
    return null
  }

  const sortNewestFirst = (list: SalesItem[], getDay: (s: SalesItem) => string) =>
    [...list].sort((a, b) => {
      const cmp = getDay(b).localeCompare(getDay(a))
      if (cmp !== 0) return cmp
      return (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
    })

  const baseFilteredSales = React.useMemo(
    () =>
      sortNewestFirst(
        preDateFilteredSales.filter((item) =>
          isDateInRange(item.rawDate || item.date, dateRange.startDate, dateRange.endDate)
        ),
        getSaleDay
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preDateFilteredSales, dateRange]
  )

  // 2. Dynamic Tab Filtering ('Deposit' vs 'Sales Record') for Table & Chart
  const filteredSales = React.useMemo(() => {
    if (tableTab === 'Deposit') {
      // Deposit tab follows the bank passbook: ranged, sorted and grouped by deposit date
      return sortNewestFirst(
        preDateFilteredSales.filter(
          (item) =>
            (getRealizedCash(item) > 0 ||
              (item.depositStatus || item.deposit_status) === 'Deposited' ||
              item.auditStatus === 'Verified') &&
            isDateInRange(getDepositDay(item), dateRange.startDate, dateRange.endDate)
        ),
        getDepositDay
      )
    }
    return baseFilteredSales
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFilteredSales, preDateFilteredSales, dateRange, tableTab, getRealizedCash])

  // Daily grouped sales for Daily Summary subtab view
  const dailySalesGroups = React.useMemo(() => {
    return groupTransactionsByDate(filteredSales, {
      getDate: (s) => (tableTab === 'Deposit' ? getDepositDay(s) : s.rawDate || s.date),
      getGrossAmount: (s) => (tableTab === 'Deposit' ? getRealizedCashForSale(s) : s.deposit),
      getRealizedCash: (s) => getRealizedCashForSale(s),
      getAuditStatus: (s) => s.auditStatus,
    }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales, tableTab])

  const depositCount = React.useMemo(() => {
    return preDateFilteredSales.filter(
      (s) => (s.depositStatus || s.deposit_status) === 'Deposited' || s.payment_status === 'Paid'
    ).length
  }, [preDateFilteredSales])

  const depositBalanceByKey = React.useMemo(() => {
    const ordered = [...combinedSales].filter((s) => {
      return (s.depositStatus || s.deposit_status) === 'Deposited' || s.payment_status === 'Paid'
    }).sort((a, b) => {
      const da = a.deposit_date || a.depositDate || a.rawDate || a.date
      const db = b.deposit_date || b.depositDate || b.rawDate || b.date
      const byDate = String(da).localeCompare(String(db))
      if (byDate !== 0) return byDate
      return (a.id || '').localeCompare(b.id || '')
    })
    const running = new Map<string, number>()
    const balances = new Map<string, number>()
    ordered.forEach((s) => {
      const groupKey = selectedBankId ? selectedBankId : (s.company || '').toLowerCase().trim()
      if (!running.has(groupKey)) {
        const seedBank = selectedBankId ? allBankAccounts.find((b) => String(b.id) === selectedBankId) : null
        running.set(groupKey, seedBank ? (Number(seedBank.startingBalance) || 0) : 0)
      }
      const prev = running.get(groupKey)!
      const amt = getRealizedCashForSale(s) || s.deposit || 0
      const next = Math.round((prev + amt) * 100) / 100
      running.set(groupKey, next)
      balances.set(s.id, next)
    })
    return balances
  }, [combinedSales, selectedBankId, allBankAccounts])

  const closingBalanceDates = React.useMemo(() => {
    const ordered = [...combinedSales].filter((s) => {
      return (s.depositStatus || s.deposit_status) === 'Deposited' || s.payment_status === 'Paid'
    }).sort((a, b) => {
      const da = normalizeDateToYYYYMMDD(a.deposit_date || a.depositDate || a.rawDate || a.date)
      const db = normalizeDateToYYYYMMDD(b.deposit_date || b.depositDate || b.rawDate || b.date)
      const byDate = da.localeCompare(db)
      if (byDate !== 0) return byDate
      return (a.id || '').localeCompare(b.id || '')
    })
    const latest = new Map<string, number>()
    const closing = new Map<string, number>()
    ordered.forEach((s) => {
      const groupKey = selectedBankId ? selectedBankId : (s.company || '').toLowerCase().trim()
      latest.set(groupKey, depositBalanceByKey.get(s.id) ?? latest.get(groupKey) ?? 0)
      let total = 0
      latest.forEach((v) => (total += v))
      const dateKey = normalizeDateToYYYYMMDD(s.deposit_date || s.depositDate || s.rawDate || s.date)
      closing.set(dateKey, Math.round(total * 100) / 100)
    })
    return Array.from(closing.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [combinedSales, depositBalanceByKey, selectedBankId])

  const formatToShortDate = React.useCallback((val: string | null | undefined): string => {
    if (!val) return '—'
    const trimmed = String(val).trim()
    if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) return trimmed
    const mLong = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
    if (mLong) return `${mLong[1]}/${mLong[2]}/${mLong[3].slice(2)}`
    const mIso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
    if (mIso) return `${mIso[2]}/${mIso[3]}/${mIso[1].slice(2)}`
    return trimmed
  }, [])

  const activeStartingBalance = React.useMemo(() => {
    if (selectedBankId) {
      const b = allBankAccounts.find((acc) => String(acc.id) === selectedBankId)
      return b ? Number(b.startingBalance) || 0 : 0
    }
    return Math.round(
      allBankAccounts.reduce((sum, acc) => sum + (Number(acc.startingBalance) || 0), 0) * 100
    ) / 100
  }, [selectedBankId, allBankAccounts])

  const getDayOpeningBalance = React.useCallback(
    (date: string) => {
      const norm = normalizeDateToYYYYMMDD(date) || date
      const earlier = closingBalanceDates.filter(([d]) => d < norm)
      if (earlier.length > 0) {
        return earlier[earlier.length - 1][1]
      }
      return activeStartingBalance
    },
    [closingBalanceDates, activeStartingBalance]
  )

  const getClosingBalance = React.useCallback(
    (date: string) => {
      const normDate = normalizeDateToYYYYMMDD(date) || date
      let result: number | null = null
      for (const [d, v] of closingBalanceDates) {
        if (d <= normDate) result = v
        else break
      }
      if (result === null) {
        if (selectedBankId) {
          const seedBank = allBankAccounts.find((b) => String(b.id) === selectedBankId)
          return seedBank ? Number(seedBank.startingBalance) || 0 : 0
        }
        return activeStartingBalance
      }
      return result
    },
    [closingBalanceDates, selectedBankId, allBankAccounts, activeStartingBalance]
  )

  const hasFocusedDay = React.useMemo(
    () => dailySalesGroups.some((g) => expandedDates.has(g.date)),
    [dailySalesGroups, expandedDates]
  )
  const totalDailyPages = Math.max(1, Math.ceil(dailySalesGroups.length / ITEMS_PER_PAGE))
  const paginatedDailyGroups = React.useMemo(() => {
    if (hasFocusedDay) {
      return dailySalesGroups.filter((g) => expandedDates.has(g.date))
    }
    const start = (dailyPage - 1) * ITEMS_PER_PAGE
    return dailySalesGroups.slice(start, start + ITEMS_PER_PAGE)
  }, [dailySalesGroups, hasFocusedDay, expandedDates, dailyPage])

  // Day remarks: one note per company, per date (sales). Supervisors and Finance can edit.
  const dayRemarkCompanies = React.useMemo(
    () => paginatedDailyGroups.flatMap((g) => g.items.map((item) => item.company)),
    [paginatedDailyGroups]
  )
  const { getRemark: getDayRemark, saveRemark: saveDayRemark } = useDailyRemarks(
    'sales',
    dayRemarkCompanies
  )
  const canEditDayRemark =
    isFinance || userRole === 'supervisor' || userRole === 'company'

  // Reset to page 1 on filter change
  React.useEffect(() => {
    setCurrentPage(1)
    setDailyPage(1)
  }, [
    dateRange,
    searchQuery,
    statusFilter,
    selectedCompany,
    selectedPeriod,
    tableTab,
    subTab,
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

  // Deposit tab is paid by definition, so a leftover "Paid" filter is dropped
  React.useEffect(() => {
    if (tableTab === 'Deposit' && statusFilter === 'Paid') setStatusFilter('All')
  }, [tableTab, statusFilter])

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
    if (subTab === 'Daily Summary') {
      salesService.exportDailySummaryCsv(
        dailySalesGroups,
        `sales_daily_summary_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
      )
    } else {
      salesService.exportCsv(
        filteredSales,
        `sales_summary_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
      )
    }
    setIsExportDropdownOpen(false)
  }

  const handleExportPdf = () => {
    if (subTab === 'Daily Summary') {
      salesService.exportDailySummaryPdf(dailySalesGroups, companyForExport)
    } else {
      salesService.exportPdf(filteredSales, companyForExport)
    }
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
    <div className="space-y-6 pb-10 w-full max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {/* 1. Header & Controls */}
      <div className="space-y-4">
        {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
                Sales
              </h1>
              <span
                className="text-muted-fg hover:text-focus transition-colors cursor-help inline-flex items-center"
                title="Overview of company revenue, sales receipts, and bank deposit settlements"
              >
                <HelpCircle className="h-5 w-5" />
              </span>
            </div>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Sales records and bank deposits for {displayedCompanyTitle}
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
                  'h-10 sm:h-11 px-4 sm:px-5 rounded-full font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border',
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

        {/* Primary Tab Switcher: Deposit (Bank Ledger) | Sales Record (All Transactions) */}
        <div
          role="tablist"
          aria-label="Sales views"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tableTab === 'Deposit'}
            onClick={() => setTableTab('Deposit')}
            className={cn(
              'min-h-[64px] w-full rounded-[16px] px-5 py-3.5 text-left transition-all border cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 flex items-center justify-between gap-3',
              tableTab === 'Deposit'
                ? 'bg-[#960C01] border-[#960C01] text-white shadow-xs'
                : 'bg-white border-stroke/40 text-focus hover:bg-surface/60'
            )}
          >
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold leading-tight">Deposit</div>
              <div
                className={cn(
                  'text-xs mt-0.5 leading-snug',
                  tableTab === 'Deposit' ? 'text-white/85' : 'text-muted-fg'
                )}
              >
                Bank ledger of sales
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums',
                tableTab === 'Deposit' ? 'bg-white/20 text-white' : 'bg-surface text-focus/80'
              )}
            >
              {depositCount}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tableTab === 'Sales Record'}
            onClick={() => setTableTab('Sales Record')}
            className={cn(
              'min-h-[64px] w-full rounded-[16px] px-5 py-3.5 text-left transition-all border cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 flex items-center justify-between gap-3',
              tableTab === 'Sales Record'
                ? 'bg-[#960C01] border-[#960C01] text-white shadow-xs'
                : 'bg-white border-stroke/40 text-focus hover:bg-surface/60'
            )}
          >
            <div className="min-w-0">
              <div className="text-sm sm:text-base font-bold leading-tight">Sales Record</div>
              <div
                className={cn(
                  'text-xs mt-0.5 leading-snug',
                  tableTab === 'Sales Record' ? 'text-white/85' : 'text-muted-fg'
                )}
              >
                All sales transactions
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums',
                tableTab === 'Sales Record' ? 'bg-white/20 text-white' : 'bg-surface text-focus/80'
              )}
            >
              {filteredSales.length}
            </span>
          </button>
        </div>

        {/* Controls Container / Shared Filters */}
        <div className="flex flex-col gap-3 pt-1">
          {/* Row 1: Company + Bank + Status + Date + All Records / By Day toggle */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 w-full">
            <div className="flex flex-1 flex-wrap sm:flex-nowrap items-center gap-2.5 min-w-0">
              {/* Company Scope */}
              {!isCompanyScoped ? (
                <div ref={companyDropdownRef} className="relative flex-1 min-w-[200px] sm:min-w-[240px]">
                  <button
                    type="button"
                    onClick={() => setIsCompanyDropdownOpen((prev) => !prev)}
                    className={cn(
                      'inline-flex items-center justify-between gap-2 min-h-[44px] h-11 w-full px-4 rounded-full border border-stroke/40 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40',
                      isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                    )}
                    aria-label="Filter sales by company"
                  >
                    <span className="font-semibold text-focus truncate flex-1 text-left">
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
                  className="inline-flex items-center justify-between gap-2 min-h-[44px] h-11 flex-1 min-w-[200px] sm:min-w-[240px] px-4 rounded-full border border-stroke/50 bg-surface/70 text-focus text-xs sm:text-sm font-semibold shadow-xs select-none"
                  title={selectedCompany}
                >
                  <span className="truncate min-w-0">{selectedCompany}</span>
                </div>
              )}

              {/* Bank Filter Select */}
              <div className="flex-1 min-w-[190px] sm:min-w-[220px]">
                <BankFilterSelect
                  accounts={bankOptions}
                  value={selectedBankId}
                  onChange={setSelectedBankId}
                  className="w-full"
                />
              </div>

              {/* Status Filter Dropdown beside the bank */}
              <div className="w-full sm:w-auto min-w-[130px] shrink-0">
                <DropdownFilter
                  value={statusFilter}
                  onChange={(val) => {
                    setStatusFilter(val as any)
                    setDailyPage(1)
                    setCurrentPage(1)
                  }}
                  options={statusFilterOptions}
                  defaultValue="All"
                  placeholder="Status"
                  fullWidth
                />
              </div>

              {/* Date Range Control in Row 1 */}
              <div className="w-full sm:w-auto min-w-[180px] shrink-0">
                <TransactionDateRangeControl
                  value={dateRange}
                  onChange={(newRange) => {
                    setDateRange(newRange)
                    setDailyPage(1)
                    setCurrentPage(1)
                  }}
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

      {/* 3. KPI Cards: Total Sales & Cash Collected Side by Side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        {/* 2. Cash Collected (date) = total cash deposited into bank for the period */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-semibold text-muted-fg block">
              Total Cash (Deposited)
            </span>
            {loading ? (
              <CardSkeleton inline={true} />
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalCash)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Total cash deposited to bank for {dateRange.label || 'selected period'}
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 mb-2 border-b border-slate-100">
          {subTab === 'Daily Summary' && hasFocusedDay ? (
            <button
              type="button"
              onClick={() => setExpandedDates(new Set())}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-stroke/40 bg-surface/80 hover:bg-surface text-xs font-semibold text-focus transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to all {dailySalesGroups.length} days</span>
            </button>
          ) : (
            <span className="text-xs text-muted-fg font-medium">
              {subTab === 'Daily Summary'
                ? `${dailySalesGroups.length} ${dailySalesGroups.length === 1 ? 'day' : 'days'} (${filteredSales.length} total records)`
                : `${filteredSales.length} ${tableTab === 'Deposit' ? 'deposit' : 'sales'} ${filteredSales.length === 1 ? 'record' : 'records'} shown`}
            </span>
          )}
        </div>

        {subTab === 'Daily Summary' ? (
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed min-w-[1000px]">
              <colgroup>
                {(tableTab === 'Deposit'
                  ? [16, 12, 14, 14, 15, 12, 13, 4]
                  : [16, 11, 15, 15, 20, 14, 9]
                ).map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <TableHeader>
                {tableTab === 'Deposit' ? (
                  <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                    <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                      DATE
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                      TRANSACTIONS
                    </TableHead>
                    <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                      TOTAL DEPOSIT
                    </TableHead>
                    <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                      TOTAL WITHDRAWAL
                    </TableHead>
                    <TableHead
                      className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right"
                      title="End-of-day balance"
                    >
                      END-OF-DAY BALANCE
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                      AUDIT STATUS
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                      PASSBOOK CHECK
                    </TableHead>
                    <TableHead className="px-1 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                ) : (
                  <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                    <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                      SALES DATE & DAY
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                      TRANSACTIONS
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                      GROSS SALES
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
                )}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={5} columns={tableTab === 'Deposit' ? 8 : 7} />
                ) : loadError ? (
                  <TableErrorState
                    colSpan={tableTab === 'Deposit' ? 8 : 7}
                    message={loadError}
                    onRetry={() => loadSales(false, true)}
                  />
                ) : paginatedDailyGroups.length === 0 ? (
                  <TableEmptyState
                    colSpan={tableTab === 'Deposit' ? 8 : 7}
                    title={`No daily ${tableTab === 'Deposit' ? 'deposit' : 'sales'} records found`}
                    description={`There are no ${tableTab === 'Deposit' ? 'deposit' : 'sales'} transactions recorded for this period matching your filters.`}
                  />
                ) : (
                  paginatedDailyGroups.map((group) => {
                    if (tableTab === 'Deposit') {
                      const isExpanded = expandedDates.has(group.date)
                      const dayBal = getClosingBalance(group.date)
                      const openingBal = getDayOpeningBalance(group.date)
                      const dayTotalDeposit = group.realizedCash || group.grossTotal || 0
                      const dayTotalWithdrawal = 0
                      const expectedClosing = Math.round((openingBal + dayTotalDeposit - dayTotalWithdrawal) * 100) / 100
                      const passbookDiff = Math.round((dayBal - expectedClosing) * 100) / 100
                      const isBalanced = passbookDiff === 0
                      const pendingCount = group.items.filter((s) => s.auditStatus !== 'Verified' && s.auditStatus !== 'Flagged').length
                      const hasDiscrepancy = group.items.some((s) => s.auditStatus === 'Flagged')

                      return (
                        <React.Fragment key={group.date}>
                          <TableRow
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            onClick={() => toggleDateExpansion(group.date)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                toggleDateExpansion(group.date)
                              }
                            }}
                            className={cn(
                              'border-b border-slate-100 transition-colors cursor-pointer select-none',
                              isExpanded ? 'bg-slate-50/90 font-medium' : 'hover:bg-slate-50/50'
                            )}
                          >
                            {/* 1. DATE with Chevron */}
                            <TableCell className="px-2.5 sm:px-3 py-3 text-left">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-primary shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-fg shrink-0" />
                                )}
                                <span className="text-xs font-bold text-focus truncate">
                                  {group.formattedDate}
                                </span>
                              </div>
                            </TableCell>

                            {/* 2. TRANSACTIONS */}
                            <TableCell className="px-2.5 sm:px-3 py-3 text-center text-xs">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-focus border border-slate-200">
                                {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                              </span>
                            </TableCell>

                            {/* 3. TOTAL DEPOSIT */}
                            <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-emerald-700">
                              {dayTotalDeposit > 0 ? (
                                `+${formatPHP(dayTotalDeposit)}`
                              ) : (
                                <span className="text-muted-fg/40 font-normal">—</span>
                              )}
                            </TableCell>

                            {/* 4. TOTAL WITHDRAWAL */}
                            <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-rose-700">
                              <span className="text-muted-fg/40 font-normal">—</span>
                            </TableCell>

                            {/* 5. END-OF-DAY BALANCE */}
                            <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-focus">
                              {dayBal < 0 ? `−${formatPHP(Math.abs(dayBal))}` : formatPHP(dayBal)}
                            </TableCell>

                            {/* 6. AUDIT STATUS */}
                            <TableCell className="px-2.5 sm:px-3 py-3 text-center text-xs whitespace-nowrap">
                              <span
                                className={cn(
                                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
                                  hasDiscrepancy
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : pendingCount > 0
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                )}
                              >
                                {hasDiscrepancy ? 'Discrepancy' : pendingCount > 0 ? `${pendingCount} pending` : 'All audited'}
                              </span>
                            </TableCell>

                            {/* 7. PASSBOOK CHECK */}
                            <TableCell className="px-2.5 sm:px-3 py-3 text-left text-xs whitespace-nowrap">
                              <div className="flex items-center">
                                {isBalanced ? (
                                  <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                                    ✓ Balanced
                                  </span>
                                ) : (
                                  <span className="text-amber-700 font-semibold inline-flex items-center gap-1">
                                    ⚠ {formatPHP(Math.abs(passbookDiff))} {passbookDiff < 0 ? 'short' : 'over'}
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            {/* 8. ACTION */}
                            <TableCell className="px-1 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (dayMenu?.date === group.date) {
                                    setDayMenu(null)
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const openUpward = rect.bottom + 120 > window.innerHeight
                                    setDayMenu({
                                      date: group.date,
                                      top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                      right: Math.max(12, window.innerWidth - rect.right),
                                      openUpward,
                                      items: group.items,
                                    })
                                  }
                                }}
                                className="h-8 w-8 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors mx-auto"
                                title="Day actions"
                                aria-label="Open day action menu"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>

                          {/* Expanded Content for By Day Deposit */}
                          {isExpanded && (
                            <TableRow className="bg-slate-50/40 border-b border-slate-200 hover:bg-slate-50/40">
                              <TableCell colSpan={8} className="p-3 sm:p-4">
                                <div className="space-y-3.5">
                                  {/* Formula Banner */}
                                  <div
                                    className={cn(
                                      'rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-between border',
                                      isBalanced
                                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                        : 'bg-amber-50/70 border-amber-200 text-amber-900'
                                    )}
                                  >
                                    <span>
                                      Opening {formatPHP(openingBal)} + Deposits {formatPHP(dayTotalDeposit)} − Withdrawals ₱0.00 = Closing {formatPHP(dayBal)} {isBalanced ? '✓' : `(⚠ ${formatPHP(Math.abs(passbookDiff))} ${passbookDiff < 0 ? 'short' : 'over'})`}
                                    </span>
                                  </div>

                                  {/* Transactions sub-table on this day */}
                                  <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
                                    <table className="w-full text-left text-xs table-fixed">
                                      <colgroup>
                                        <col style={{ width: '12%' }} />
                                        <col style={{ width: '18%' }} />
                                        <col style={{ width: '28%' }} />
                                        <col style={{ width: '14%' }} />
                                        <col style={{ width: '14%' }} />
                                        <col style={{ width: '10%' }} />
                                        <col style={{ width: '4%' }} />
                                      </colgroup>
                                      <thead className="bg-slate-50 text-muted-fg font-semibold uppercase text-[10px] tracking-wider border-b border-slate-100">
                                        <tr>
                                          <th className="px-2.5 py-2 font-semibold">TYPE</th>
                                          <th className="px-2.5 py-2 font-semibold">BANK / METHOD</th>
                                          <th className="px-2.5 py-2 font-semibold">PARTICULARS</th>
                                          <th className="px-2.5 py-2 text-right font-semibold">DEPOSIT</th>
                                          <th className="px-2.5 py-2 text-right font-semibold">WITHDRAWAL</th>
                                          <th className="px-2.5 py-2 text-center font-semibold">AUDIT STATUS</th>
                                          <th className="px-1 py-2 text-center font-semibold">
                                            <span className="sr-only">Actions</span>
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {group.items.length === 0 ? (
                                          <tr>
                                            <td colSpan={7} className="px-3 py-6 text-center text-muted-fg text-xs">
                                              No deposits recorded for this day.
                                            </td>
                                          </tr>
                                        ) : (
                                          group.items.map((sale) => {
                                            const itemsCount = (sale.items && sale.items.length > 0) ? sale.items.length : 1
                                            const depAmt = getRealizedCashForSale(sale) || sale.deposit || 0
                                            const bankMethod = sale.bankName || (sale.bankAccountId ? bankLabel(sale.bankAccountId) : '') || sale.paymentMethod || 'Cash'
                                            const depositDiff = Math.round((depAmt - (sale.deposit || depAmt)) * 100) / 100

                                            return (
                                              <tr
                                                key={sale.id}
                                                onClick={() => handleOpenRow(sale)}
                                                title="Click to view transaction details"
                                                className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                                              >
                                                {/* 1. TYPE */}
                                                <td className="px-2.5 py-2.5 align-top whitespace-nowrap">
                                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                                                    Sales
                                                  </span>
                                                </td>

                                                {/* 2. BANK / METHOD */}
                                                <td className="px-2.5 py-2.5 align-top text-xs text-focus/90 font-medium truncate">
                                                  <div className="truncate font-medium">{bankMethod}</div>
                                                </td>

                                                {/* 3. PARTICULARS */}
                                                <td className="px-2.5 py-2.5 align-top text-xs">
                                                  <div className="font-semibold text-focus leading-snug">
                                                    Bank deposit · {itemsCount} {itemsCount === 1 ? 'sale' : 'sales'}
                                                  </div>
                                                  <div className="mt-0.5 text-[11px] text-muted-fg truncate">
                                                    {(sale.company || '') + (sale.refNo ? ` · ${sale.refNo}` : '')}
                                                  </div>
                                                  {depositDiff !== 0 && (
                                                    <div className="mt-0.5 text-[10px] font-medium text-amber-700">
                                                      ⚠ {formatPHP(Math.abs(depositDiff))} {depositDiff < 0 ? 'short' : 'over'}
                                                    </div>
                                                  )}
                                                </td>

                                                {/* 4. DEPOSIT */}
                                                <td className="px-2.5 py-2.5 align-top text-right text-xs font-bold tabular-nums whitespace-nowrap text-emerald-700">
                                                  {depAmt > 0 ? `+${formatPHP(depAmt)}` : '—'}
                                                </td>

                                                {/* 5. WITHDRAWAL */}
                                                <td className="px-2.5 py-2.5 align-top text-right text-xs font-bold tabular-nums whitespace-nowrap text-rose-700">
                                                  <span className="text-muted-fg/40 font-normal">—</span>
                                                </td>

                                                {/* 6. AUDIT STATUS */}
                                                <td className="px-2.5 py-2.5 align-top text-center whitespace-nowrap">
                                                  <span
                                                    className={cn(
                                                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                                                      sale.auditStatus === 'Verified'
                                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                                        : sale.auditStatus === 'Flagged'
                                                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                                                        : 'bg-amber-50 text-amber-800 border-amber-200'
                                                    )}
                                                  >
                                                    {sale.auditStatus === 'Verified' ? 'Audited' : sale.auditStatus === 'Flagged' ? 'Flagged' : 'Pending'}
                                                  </span>
                                                </td>

                                                {/* 7. ACTION (3 dots) */}
                                                <td
                                                  className="px-1 py-2 text-center whitespace-nowrap align-top"
                                                  onClick={(e) => e.stopPropagation()}
                                                >
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
                                                        const rect = e.currentTarget.getBoundingClientRect()
                                                        const openUpward = rect.bottom + 160 > window.innerHeight
                                                        setMenuPosition({
                                                          top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                                          right: Math.max(12, window.innerWidth - rect.right),
                                                          openUpward,
                                                        })
                                                        setActiveMenuSale(sale)
                                                        setOpenMenuSaleId(sale.id)
                                                      }
                                                    }}
                                                    className="h-8 w-8 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors mx-auto"
                                                    title="Actions"
                                                    aria-label="Open action menu"
                                                  >
                                                    <MoreVertical className="w-4 h-4" />
                                                  </Button>
                                                </td>
                                              </tr>
                                            )
                                          })
                                        )}
                                      </tbody>
                                      <tfoot className="border-t border-slate-200 text-xs font-semibold bg-slate-50/50">
                                        <tr>
                                          <td colSpan={3} className="px-2.5 py-2.5 text-focus font-bold">
                                            {group.items.length} {group.items.length === 1 ? 'transaction' : 'transactions'}
                                          </td>
                                          <td className="px-2.5 py-2.5 text-right font-bold text-emerald-700 tabular-nums">
                                            {dayTotalDeposit > 0 ? `+${formatPHP(dayTotalDeposit)}` : '—'}
                                          </td>
                                          <td className="px-2.5 py-2.5 text-right font-bold text-rose-700 tabular-nums">
                                            —
                                          </td>
                                          <td colSpan={2} className="px-2.5 py-2.5 text-center text-muted-fg text-[11px]">
                                            {pendingCount === 0 ? (
                                              <span className="text-emerald-700 font-semibold">All audited</span>
                                            ) : (
                                              <span>{pendingCount} pending</span>
                                            )}
                                          </td>
                                        </tr>
                                      </tfoot>
                                    </table>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      )
                    }

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
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-right font-bold tabular-nums text-emerald-600 text-xs">
                            {formatPHP(group.realizedCash)}
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-2.5 text-left" onClick={(e) => e.stopPropagation()}>
                            <DayRemarkCell
                              companyNames={group.items.map((item) => item.company)}
                              date={group.date}
                              formattedDate={group.formattedDate}
                              kindLabel="Sales"
                              canEdit={canEditDayRemark}
                              getRemark={getDayRemark}
                              onSave={saveDayRemark}
                              entries={group.items.map((s) => ({
                                id: s.id,
                                ref: s.chequeNo || s.refNo,
                                particulars: s.particulars,
                                amount: tableTab === 'Deposit' ? getRealizedCashForSale(s) : s.deposit,
                                status: s.status,
                                depositStatus: s.depositStatus || s.deposit_status,
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
                                      Transactions on {group.formattedDate}
                                    </span>
                                    <span className="text-2xs text-muted-fg font-medium">
                                      ({group.items.length} total)
                                    </span>
                                  </div>
                                  <div className="text-2xs text-muted-fg">
                                    Inspect, edit, delete, or audit individual day records
                                  </div>
                                </div>
                                {(() => {
                                  const byBank = new Map<string, { count: number; total: number }>()
                                  group.items.forEach((it) => {
                                    const key = String(it.bankAccountId || '')
                                    const entry = byBank.get(key) || { count: 0, total: 0 }
                                    entry.count += 1
                                    entry.total += (tableTab === 'Deposit' ? getRealizedCashForSale(it) : it.deposit)
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
                                      {group.items.map((sale) => {
                                        const summary = getParticularsSummary(
                                          sale.particulars,
                                          sale.items,
                                          {
                                            statusFilter: effectiveParticularsStatusFilter,
                                            fallbackStatus: normalizeParticularStatus(sale.status, 'Paid'),
                                            fallbackTotal: sale.deposit,
                                          }
                                        )

                                        return (
                                          <tr
                                            key={sale.id}
                                            onClick={() => setSelectedSale(sale)}
                                            className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                                          >
                                            <td className="px-3 py-2 font-medium text-focus whitespace-nowrap align-top">
                                              {formatDisplayDate(sale.rawDate || sale.date)}
                                            </td>
                                            <td className="px-3 py-2 text-xs align-top">
                                              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                                <span className="font-semibold text-focus break-words leading-snug">
                                                  {summary.title || sale.particulars}
                                                </span>
                                                {summary.itemCount > 1 && (
                                                  <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                                    +{summary.itemCount - 1} more
                                                  </span>
                                                )}
                                              </div>
                                              {sale.company && (
                                                <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                                                  {sale.company}
                                                </div>
                                              )}
                                              <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                                                {sale.refNo || (sale as any).reference_no || '—'}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-focus/90 font-medium truncate align-top">
                                              {sale.paymentMethod || 'Cash'}
                                            </td>
                                            <td className="px-3 py-2 font-bold text-right tabular-nums whitespace-nowrap align-top text-emerald-700">
                                              +{formatPHP(sale.deposit)}
                                            </td>
                                            <td className="px-3 py-2 font-mono text-focus/80 truncate align-top">
                                              {sale.chequeNo || '—'}
                                            </td>
                                            <td className="px-3 py-2 font-medium whitespace-nowrap align-top">
                                              {(sale.deposit_date || sale.depositDate) ? (
                                                <span className="text-emerald-700">{formatDisplayDate(sale.deposit_date || sale.depositDate)}</span>
                                              ) : (
                                                <span className="text-muted-fg/50">—</span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 font-bold text-right tabular-nums whitespace-nowrap align-top">
                                              {(sale.depositStatus || sale.deposit_status) === 'Deposited' ? (
                                                <span className="text-emerald-700">{formatPHP(getRealizedCashForSale(sale) || sale.deposit)}</span>
                                              ) : (
                                                <span className="text-muted-fg/50 font-normal">—</span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-center align-top">
                                              <span
                                                className={cn(
                                                  'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border tracking-wide uppercase',
                                                  sale.status === 'Paid'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                                    : sale.status === 'Pending'
                                                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                                                    : 'bg-rose-50 text-rose-700 border-rose-300'
                                                )}
                                              >
                                                {sale.status || 'Paid'}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-center align-top" onClick={(e) => e.stopPropagation()}>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  if (openMenuSaleId === sale.id) {
                                                    setOpenMenuSaleId(null)
                                                    setMenuPosition(null)
                                                    setActiveMenuSale(null)
                                                  } else {
                                                    const rect = e.currentTarget.getBoundingClientRect()
                                                    const openUpward = rect.bottom + 160 > window.innerHeight
                                                    setMenuPosition({
                                                      top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                                      right: Math.max(12, window.innerWidth - rect.right),
                                                      openUpward,
                                                    })
                                                    setActiveMenuSale(sale)
                                                    setOpenMenuSaleId(sale.id)
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
          <div className="overflow-x-auto">
          <Table className="w-full table-fixed min-w-[860px] lg:min-w-0">
            <colgroup>
              {(tableTab === 'Deposit'
                ? [11, 9, 10, 26, 13, 11, 11, 6, 3]
                : [10, 23, 9, 11, 10, 11, 11, 9, 6]
              ).map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <TableHeader>
              {tableTab === 'Deposit' ? (
                <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                    DATE
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                    TYPE
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                    CHEQUE NO.
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                    PARTICULARS
                  </TableHead>
                  <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                    DEPOSIT
                  </TableHead>
                  <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                    WITHDRAWAL
                  </TableHead>
                  <TableHead
                    className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right"
                    title="Balance of the bank"
                  >
                    BANK BALANCE
                  </TableHead>
                  <TableHead className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                    AUDIT STATUS
                  </TableHead>
                  <TableHead className="px-1 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              ) : (
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
              )}
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableSkeleton rows={5} columns={tableTab === 'Deposit' ? 9 : 9} />
              ) : loadError ? (
                <TableErrorState
                  colSpan={tableTab === 'Deposit' ? 9 : 9}
                  message={loadError}
                  onRetry={() => loadSales(false, true)}
                />
              ) : paginatedSales.length === 0 ? (
                <TableEmptyState
                  colSpan={tableTab === 'Deposit' ? 9 : 9}
                  title={`No ${tableTab === 'Deposit' ? 'deposit' : 'sales'} records found`}
                  description={`There are no ${tableTab === 'Deposit' ? 'deposit' : 'sales'} transactions recorded for ${displayedCompanyTitle} matching your current filters.`}
                  action={
                    tableTab !== 'Deposit' ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => setIsAddModalOpen(true)}
                        className="rounded-[10px]"
                      >
                        Record New Sale
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                paginatedSales.map((sale) => {
                  if (tableTab === 'Deposit') {
                    const rowBal = depositBalanceByKey.get(sale.id) ?? 0
                    const isExpanded = expandedDepositIds.has(sale.id)
                    const items = sale.items && sale.items.length > 0 ? sale.items : []
                    const salesCount = items.length > 0 ? items.length : 1
                    const hasSubItems = items.length > 0
                    const depAmt = getRealizedCashForSale(sale) || sale.deposit || 0
                    const depositDiff = Math.round((depAmt - (sale.deposit || depAmt)) * 100) / 100
                    const saleDateShort = formatToShortDate(sale.deposit_date || sale.depositDate || sale.rawDate || sale.date)
                    const refNo = sale.refNo || (sale as any).reference_no || '—'
                    const company = sale.company || ''
                    const subtitle = company ? `${company} · ${refNo}` : refNo

                    return (
                      <React.Fragment key={sale.id}>
                        <TableRow
                          id={`sales-row-${sale.id}`}
                          onClick={() => {
                            if (hasSubItems) toggleDepositExpansion(sale.id)
                            else handleOpenRow(sale)
                          }}
                          className={cn(
                            'border-b border-slate-100 transition-colors cursor-pointer',
                            isExpanded ? 'bg-slate-50/90 font-medium' : 'hover:bg-slate-50/60'
                          )}
                          title="Click to expand sales in deposit or view complete details"
                        >
                          {/* 1. DATE with Chevron */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-medium text-focus whitespace-nowrap">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {hasSubItems ? (
                                isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-primary shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-fg shrink-0" />
                                )
                              ) : null}
                              <span>{saleDateShort}</span>
                            </div>
                          </TableCell>

                          {/* 2. TYPE */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                              Sales
                            </span>
                          </TableCell>

                          {/* 3. CHEQUE NO. */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-mono text-focus/80 truncate">
                            {sale.chequeNo || '—'}
                          </TableCell>

                          {/* 4. PARTICULARS */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs">
                            <div className="font-semibold text-focus leading-snug truncate">
                              Bank deposit · {salesCount} {salesCount === 1 ? 'sale' : 'sales'}
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-fg truncate">
                              {subtitle}
                            </div>
                          </TableCell>

                          {/* 5. DEPOSIT */}
                          <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs text-right tabular-nums whitespace-nowrap">
                            <div className="font-bold text-emerald-700">+{formatPHP(depAmt)}</div>
                            <div
                              className={cn(
                                'text-[11px] font-medium leading-tight',
                                depositDiff === 0 ? 'text-emerald-700' : 'text-amber-700'
                              )}
                            >
                              {depositDiff === 0
                                ? `✓ matches ${salesCount} ${salesCount === 1 ? 'sale' : 'sales'}`
                                : `⚠ ${formatPHP(Math.abs(depositDiff))} ${depositDiff < 0 ? 'short' : 'over'}`}
                            </div>
                          </TableCell>

                          {/* 6. WITHDRAWAL */}
                          <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-rose-700">
                            <span className="text-muted-fg/40 font-normal">—</span>
                          </TableCell>

                          {/* 7. BANK BALANCE */}
                          <TableCell
                            className={cn(
                              'pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap',
                              rowBal < 0 ? 'text-rose-600' : 'text-focus'
                            )}
                            title="Balance of the bank"
                          >
                            {rowBal < 0 ? `−${formatPHP(Math.abs(rowBal))}` : formatPHP(rowBal)}
                          </TableCell>

                          {/* 8. AUDIT STATUS */}
                          <TableCell className="px-2 py-3 text-center whitespace-nowrap">
                            <span
                              className={cn(
                                'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
                                sale.auditStatus === 'Verified'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : sale.auditStatus === 'Flagged'
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              )}
                            >
                              {sale.auditStatus === 'Verified' ? 'Audited' : sale.auditStatus === 'Flagged' ? 'Flagged' : 'Pending'}
                            </span>
                          </TableCell>

                          {/* 9. ACTION 3 dots */}
                          <TableCell
                            className="px-1 py-2.5 text-center whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const openUpward = rect.bottom + 160 > window.innerHeight
                                  setMenuPosition({
                                    top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                    right: Math.max(12, window.innerWidth - rect.right),
                                    openUpward,
                                  })
                                  setActiveMenuSale(sale)
                                  setOpenMenuSaleId(sale.id)
                                }
                              }}
                              className="h-8 w-8 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors mx-auto"
                              title="Actions"
                              aria-label="Open action menu"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>

                        {/* Expanded sub-table showing sales in deposit */}
                        {isExpanded && (
                          <TableRow className="bg-slate-50/50 hover:bg-slate-50/50 border-b border-slate-200">
                            <TableCell colSpan={9} className="p-3 sm:p-4">
                              <div className="bg-white rounded-xl border border-slate-200/80 p-3 sm:p-4 shadow-xs">
                                <div className="text-xs font-bold text-focus mb-2">
                                  Sales in deposit {refNo}
                                </div>
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-50 text-muted-fg font-semibold uppercase text-[10px] tracking-wider border-b border-slate-100">
                                    <tr>
                                      <th className="px-2.5 py-2 font-semibold">SALES DATE</th>
                                      <th className="px-2.5 py-2 font-semibold">PARTICULARS</th>
                                      <th className="px-2.5 py-2 font-semibold">METHOD</th>
                                      <th className="px-2.5 py-2 text-right font-semibold">AMOUNT</th>
                                      <th className="px-2.5 py-2 font-semibold">DEPOSIT DATE</th>
                                      <th className="px-2.5 py-2 text-center font-semibold">STATUS</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {items.map((it, idx) => {
                                      const itDate = formatToShortDate((it as any).date || sale.date)
                                      const itTitle = (it as any).name || (it as any).particulars || (it as any).description || 'Sale item'
                                      const itMethod = sale.paymentMethod || 'Cash'
                                      const itAmt = (it as any).amount || (it as any).total || 0
                                      const itDepositDate = saleDateShort

                                      return (
                                        <tr key={idx} className="hover:bg-slate-50/50">
                                          <td className="px-2.5 py-2 whitespace-nowrap text-focus/80">{itDate}</td>
                                          <td className="px-2.5 py-2 text-focus font-medium">{itTitle}</td>
                                          <td className="px-2.5 py-2 text-focus/80">{itMethod}</td>
                                          <td className="px-2.5 py-2 text-right font-medium text-focus tabular-nums">{formatPHP(itAmt)}</td>
                                          <td className="px-2.5 py-2 whitespace-nowrap text-focus/80">{itDepositDate}</td>
                                          <td className="px-2.5 py-2 text-center">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                              Deposited
                                            </span>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                  <tfoot className="border-t border-slate-200 text-xs font-semibold">
                                    <tr>
                                      <td colSpan={3} className="px-2.5 py-2.5 text-focus font-bold">
                                        {items.length} {items.length === 1 ? 'sale' : 'sales'} = {formatPHP(depAmt)}
                                      </td>
                                      <td colSpan={3} className="px-2.5 py-2.5 text-right font-bold">
                                        {depositDiff === 0 ? (
                                          <span className="text-emerald-700">✓ Matches the deposit</span>
                                        ) : (
                                          <span className="text-amber-700">⚠ {formatPHP(Math.abs(depositDiff))} {depositDiff < 0 ? 'short' : 'over'}</span>
                                        )}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  }
                  const fallbackStatus = normalizeParticularStatus(sale.status, 'Paid')
                  const summary = getParticularsSummary(sale.particulars, sale.items, {
                    statusFilter: effectiveParticularsStatusFilter,
                    fallbackStatus,
                    fallbackTotal: sale.deposit,
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
                      {/* 1. Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium text-focus whitespace-nowrap align-top">
                        {formatDisplayDate(sale.rawDate || sale.date)}
                      </TableCell>

                      {/* 2. Particulars: Title on Line 1, Company on Line 2, Ref on Line 3 (No cheque, no badge) */}
                      <TableCell className="px-2.5 sm:px-3 py-3 text-xs text-focus/90 align-top" title={sale.particulars}>
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-focus break-words leading-snug">
                            {summary.title || sale.particulars}
                          </span>
                          {summary.itemCount > 1 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                              +{summary.itemCount - 1} more
                            </span>
                          )}
                        </div>
                        {sale.company && (
                          <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                            {sale.company}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                          {sale.refNo || (sale as any).reference_no || '—'}
                        </div>
                      </TableCell>

                      {/* 3. Method */}
                      <TableCell className="px-2 py-3 text-xs text-focus/90 font-medium truncate align-top">
                        {sale.paymentMethod || 'Cash'}
                      </TableCell>

                      {/* 4. Signed Gross Amount */}
                      <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top text-emerald-700">
                        +{formatPHP(sale.deposit)}
                      </TableCell>

                      {/* 5. Cheque No. */}
                      <TableCell className="px-2 py-3 text-xs font-mono text-focus/80 truncate align-top">
                        {sale.chequeNo || '—'}
                      </TableCell>

                      {/* 6. Deposit Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium whitespace-nowrap align-top">
                        {(sale.deposit_date || sale.depositDate) ? (
                          <span className="text-emerald-700">{formatDisplayDate(sale.deposit_date || sale.depositDate)}</span>
                        ) : (
                          <span className="text-muted-fg/50">—</span>
                        )}
                      </TableCell>

                      {/* 7. Deposit Amount */}
                      <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top">
                        {(sale.depositStatus || sale.deposit_status) === 'Deposited' ? (
                          <span className="text-emerald-700">{formatPHP(getRealizedCashForSale(sale) || sale.deposit)}</span>
                        ) : (
                          <span className="text-muted-fg/50 font-normal">—</span>
                        )}
                      </TableCell>

                      {/* 8. Status Badge */}
                      <TableCell className="pl-3 pr-2 py-3 text-center align-top">
                        <StatusPill status={sale.status || 'Paid'} />
                      </TableCell>

                      {/* 9. Action: 3 dots action button */}
                      <TableCell
                        className="px-1.5 py-2.5 text-center whitespace-nowrap align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center">
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
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 160 > window.innerHeight
                                setMenuPosition({
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                                setActiveMenuSale(sale)
                                setOpenMenuSaleId(sale.id)
                              }
                            }}
                            className="h-9 w-9 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                            title="Actions"
                            aria-label="Open actions menu"
                          >
                            <MoreVertical className="w-4 h-4" />
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
                Viewing transactions for {paginatedDailyGroups[0]?.formattedDate}
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
              totalRecords={dailySalesGroups.length}
              pageSize={ITEMS_PER_PAGE}
              onPageChange={setDailyPage}
              itemLabel="days"
            />
          )
        ) : (
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalRecords={filteredSales.length}
            startIndex={startIndex}
            endIndex={endIndex}
            pageSize={ITEMS_PER_PAGE}
            onPageChange={setCurrentPage}
            itemLabel="records"
          />
        )}
      </Card>


      {/* Deposit date + bank prompt when marking a sale as Deposited */}
      <DepositDateDialog
        sale={depositDialogSale}
        accounts={allBankAccounts}
        onClose={() => setDepositDialogSale(null)}
        onConfirm={async (depositDate, bankAccountId) => {
          if (!depositDialogSale) return
          await applyDepositStatus(depositDialogSale, 'Deposited', depositDate, bankAccountId)
          setDepositDialogSale(null)
        }}
      />

      {/* Add Sales Modal */}
      <AddSalesModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onSuccess={handleSaleAdded}
        assignedCompany={isCompanyScoped ? assignedCompany : selectedCompany}
      />

      {/* Delete Confirmation Dialog */}
      {!isAdmin && (
        <ConfirmModal
          open={Boolean(deleteConfirmSale)}
          onOpenChange={(open) => !open && setDeleteConfirmSale(null)}
          title="Delete Sale Record"
          description={
            <>
              Are you sure you want to delete this sale entry{' '}
              <strong className="text-focus">{deleteConfirmSale?.particulars}</strong> (
              {deleteConfirmSale?.refNo}) for{' '}
              <strong className="text-focus">
                {deleteConfirmSale?.deposit ? formatPHP(deleteConfirmSale.deposit) : ''}
              </strong>
              ? This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
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
          title="Delete Day Records"
          description={
            <>
              Are you sure you want to delete all {deleteConfirmDay?.items.length} records for{' '}
              <strong className="text-focus">{deleteConfirmDay ? formatDisplayDate(deleteConfirmDay.date) : ''}</strong>? This action cannot be undone.
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

      {/* 3-Dots Action Portal Menu */}
      {openMenuSaleId &&
        activeMenuSale &&
        menuPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-52 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 1. Audit Buttons (Audit role & Admin): mark as audited, flag discrepancy */}
            {canAuditActions && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    const s = activeMenuSale
                    setOpenMenuSaleId(null)
                    setMenuPosition(null)
                    setActiveMenuSale(null)
                    handleMarkSaleAudit(s, 'Verified', e)
                  }}
                  className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{activeMenuSale.auditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                </button>

                {activeMenuSale.auditStatus !== 'Verified' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      const s = activeMenuSale
                      setOpenMenuSaleId(null)
                      setMenuPosition(null)
                      setActiveMenuSale(null)
                      handleMarkSaleAudit(s, 'Flagged', e)
                    }}
                    className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>Flag Discrepancy</span>
                  </button>
                )}
              </>
            )}

            {/* 2. Supervisor / Admin: Edit */}
            {(isSupervisor || isAdminUser) && !isAudit && !isFinance && (
              <button
                type="button"
                onClick={() => {
                  const s = activeMenuSale
                  setOpenMenuSaleId(null)
                  setMenuPosition(null)
                  setActiveMenuSale(null)
                  navigate('/sales/add', {
                    state: { editSale: s },
                  })
                }}
                className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Edit</span>
              </button>
            )}

            {/* 3. Supervisor / Admin: Delete */}
            {(isSupervisor || isAdminUser) && !isAudit && !isFinance && (
              <div className="border-t border-slate-100 mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const s = activeMenuSale
                    setOpenMenuSaleId(null)
                    setMenuPosition(null)
                    setActiveMenuSale(null)
                    setDeleteConfirmSale(s)
                  }}
                  className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Delete…</span>
                </button>
              </div>
            )}

            {/* 4. Supervisor / Finance / Admin: Add Remarks */}
            {(isSupervisor || isFinance || isAdminUser) && !isAudit && (
              <button
                type="button"
                onClick={() => {
                  const s = activeMenuSale
                  setOpenMenuSaleId(null)
                  setMenuPosition(null)
                  setActiveMenuSale(null)
                  setRemarksTargetSale(s)
                  setRemarksInput(s.remarks || '')
                  setIsRemarksDialogOpen(true)
                }}
                className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/5 transition-colors text-left cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{activeMenuSale.remarks ? 'Edit Remarks' : 'Add Remarks'}</span>
              </button>
            )}

            {/* 5. View Details for ALL roles */}
            <button
              type="button"
              onClick={() => {
                const s = activeMenuSale
                setOpenMenuSaleId(null)
                setMenuPosition(null)
                setActiveMenuSale(null)
                if (s) handleOpenRow(s)
              }}
              className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>View Details</span>
            </button>
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
                      navigate('/sales/add', {
                        state: { editSale: target },
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
              const pending = dayMenu.items.filter((s) => s.auditStatus !== 'Verified' && s.auditStatus !== 'Flagged')
              return (
                <>
                  <button
                    type="button"
                    disabled={pending.length === 0}
                    onClick={() => {
                      pending.forEach((s) => {
                        handleMarkSaleAudit(s, 'Verified')
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
                      pending.forEach((s) => {
                        handleMarkSaleAudit(s, 'Flagged')
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

      {/* Remarks Dialog Modal */}
      <Dialog
        open={isRemarksDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isSavingRemarks) {
            setIsRemarksDialogOpen(nextOpen)
            if (!nextOpen) {
              setRemarksInput('')
              setRemarksTargetSale(null)
            }
          }
        }}
      >
        <DialogContent className="max-w-[440px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                  {remarksTargetSale?.remarks ? 'Edit Remarks' : 'Add Remarks'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Enter operational remarks for {remarksTargetSale?.particulars || 'sale'}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-4 space-y-3">
            <label className="text-xs font-bold text-focus uppercase tracking-wider block">
              Remarks Note
            </label>
            <textarea
              value={remarksInput}
              onChange={(e) => setRemarksInput(e.target.value)}
              placeholder="e.g., Deposited via BDO check, verified by supervisor..."
              rows={4}
              maxLength={500}
              className="w-full rounded-xl border border-stroke/50 bg-surface/50 p-3 text-xs text-focus placeholder:text-muted-fg focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
            />
            <div className="flex justify-between items-center text-[11px] text-muted-fg font-medium">
              <span>Visible to supervisors, finance, and auditors.</span>
              <span>{remarksInput.length}/500</span>
            </div>
          </div>

          <DialogFooter className="pt-3 border-t border-stroke/30 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={isSavingRemarks}
              onClick={() => {
                setIsRemarksDialogOpen(false)
                setRemarksInput('')
                setRemarksTargetSale(null)
              }}
              className="h-10 px-4 text-xs font-semibold rounded-xl border-stroke/50 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSavingRemarks}
              onClick={handleSaveRemarks}
              className="h-10 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#960C01]/90 text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isSavingRemarks ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <span>Save Remarks</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast Notification */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-6 right-6 z-50 p-4 rounded-2xl text-white shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5 duration-200 max-w-md',
            toast.type === 'error' ? 'bg-rose-700' : 'bg-emerald-700'
          )}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-200 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-semibold">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 rounded-lg hover:bg-white/20 text-white ml-2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
