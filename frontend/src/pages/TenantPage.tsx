import { formatUserFriendlyErrorMessage, notifySuccess } from '@/utils/errorUtils'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Download,
  Plus,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  FileSpreadsheet,
  FileText,
  CreditCard,
  AlertCircle,
  Pencil,
  Trash2,
  MoreVertical,
  Store,
  CheckCircle2,
  ShieldCheck,
  Eye,
  Building2,
  Calendar,
  Coins,
  Lock,
  Receipt,
  Wallet,
  Loader2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { BackButton, ConfirmModal } from '@/components/common'
import { SharedPaymentModal } from '@/components/common/SharedPaymentModal'
import { RowActionsMenu } from '@/components/common/RowActionsMenu'
import { formatRealName } from '@/utils/formatRealName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useSession } from '@/hooks/useSession'
import { formatPHP, formatPersonInitialAndLastName } from '@/lib/format'
import { isDateInRange, formatToYYYYMMDD, normalizeDateToYYYYMMDD, formatCreatedAt } from '@/utils/dateUtils'
import { cn } from '@/lib/utils'
import { RepeatSelect, RepeatDetails } from '@/components/tenant/LeaseRepeatFields'
import { escapeHtml, csvCell } from '@/utils/exportSafety'
import {
  buildSchedule,
  getDefaultDatesForRepeat,
  countPeriods,
  describeRepeat,
  getLeaseFinancials,
  hasPeriodRecords,
  isRepeating,
  previewPayment,
  round2,
  sumRecordedPayments,
  validateEditAgainstPayments,
  validateRepeatSettings,
  getTenantPeriodFinancials,
  getTenantEffectiveStatus,
  type TenantPeriodFinancials,
  type TenantEffectiveStatus,
  type LeaseFinancials,
  type LeaseRepeat,
  type PeriodStatus,
  type SchedulePeriod,
} from '@/services/tenantScheduleService'
import {
  tenantService,
  removeLegacyTenantStorage,
  type DailyRentRecord,
  type PaymentInput,
  type TenantLease,
} from '@/services/tenantService'
import { websocketService } from '@/services/websocketService'

export type { DailyRentRecord, TenantLease }

const formatAuditTimestamp = (dateVal?: string | null, isoVal?: string | null): string => {
  if (dateVal && dateVal !== '-' && dateVal !== '—') {
    if (dateVal.includes('T') || dateVal.includes('Z')) {
      const formatted = formatCreatedAt(dateVal)
      if (formatted) return formatted
    } else {
      return dateVal
    }
  }
  if (isoVal) {
    const formatted = formatCreatedAt(isoVal)
    if (formatted) return formatted
  }
  return ''
}

// Tenant leases used to be kept in this browser. They are saved in the database now (spec 0017),
// so the old copy is deleted and never read.
removeLegacyTenantStorage()

const PERIOD_OPTIONS = ['All Periods', 'Daily', 'Monthly'] as const
type PeriodType = (typeof PERIOD_OPTIONS)[number]

const ITEMS_PER_PAGE = 10
const SCHEDULE_ITEMS_PER_PAGE = 13
const HISTORY_ITEMS_PER_PAGE = 13

const PERIOD_STATUS_STYLES: Record<PeriodStatus, string> = {
  Paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Advance Paid': 'bg-sky-50 text-sky-700 border-sky-200',
  'Partially Paid': 'bg-amber-50 text-amber-700 border-amber-200',
  Missed: 'bg-rose-50 text-rose-700 border-rose-200',
  Unpaid: 'bg-slate-100 text-slate-600 border-slate-200',
}

type LeaseFormData = {
  tenantName: string
  unitName: string
  rentAmount: string
  dueDate: string
  contractDate: string
  totalAmountPayable: string
  status: 'Active' | 'Completed' | 'Overdue' | 'Pending'
  notes: string
  repeat: LeaseRepeat
  leaseEndDate: string
  penaltyRate: string
}

const EMPTY_FORM: LeaseFormData = {
  tenantName: '',
  unitName: '',
  rentAmount: '',
  dueDate: '',
  contractDate: '',
  totalAmountPayable: '',
  status: 'Active',
  notes: '',
  repeat: 'Daily',
  leaseEndDate: '',
  penaltyRate: '',
}

export const TenantPage: React.FC = () => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isOwner = userRole === 'owner'
  const canAuditActions = (isAudit || userRole === 'admin') && !isOwner

  // Leases come from the database. `loadError` is set when the last load failed: the page then shows
  // the last copy it had (if any) with a warning, and every save is refused by the server call.
  const [tenants, setTenants] = React.useState<TenantLease[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')
  const [actionError, setActionError] = React.useState('')

  // Load the leases from the database. `silent` reloads without the loading state (used by realtime updates).
  const loadTenants = React.useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const list = await tenantService.listLeases()
      setTenants(list)
      setLoadError('')
      // Keep the open lease in step with what the server has (or close it if someone deleted it)
      setActiveTenant((prev) => (prev ? list.find((t) => t.id === prev.id) ?? null : prev))
    } catch (err) {
      setLoadError(formatUserFriendlyErrorMessage(err, 'Could not load tenant leases.'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadTenants()
  }, [loadTenants])

  // Realtime: another user changed a lease, a payment or an audit mark
  React.useEffect(() => {
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void loadTenants(true)
      }, 250)
    }
    const unsubs = [
      websocketService.subscribe('TENANTS_UPDATED', reload),
      websocketService.subscribe('AUDIT_UPDATED', reload),
    ]
    return () => {
      if (timer) window.clearTimeout(timer)
      unsubs.forEach((off) => off())
    }
  }, [loadTenants])

  // Put one lease the server returned into the list and the open lease
  const applyLease = (lease: TenantLease) => {
    setTenants((prev) =>
      prev.some((t) => t.id === lease.id) ? prev.map((t) => (t.id === lease.id ? lease : t)) : [lease, ...prev]
    )
    setActiveTenant((prev) => (prev && prev.id === lease.id ? lease : prev))
  }

  // After a payment change, keep the lease status in step with the schedule (Completed when nothing is owed)
  const syncStatus = async (lease: TenantLease): Promise<TenantLease> => {
    const fin = getLeaseFinancials(lease, formatToYYYYMMDD(new Date()))
    let next = lease.status
    if (fin.remaining <= 0.005 && fin.amountPaid > 0) next = 'Completed'
    else if (lease.status === 'Completed') next = 'Active'
    if (next === lease.status) return lease
    try {
      return await tenantService.setStatus(lease.id, next)
    } catch {
      return lease
    }
  }

  // Turn a server error into one clear message for the banner
  const messageOf = (err: unknown): string => formatUserFriendlyErrorMessage(err, 'The change could not be saved.')

  // Audit review: saved on the server, which records who reviewed and when (spec 0017)
  const saveAudit = async (lease: TenantLease, status: 'Verified' | 'Flagged', remarks?: string) => {
    setActionError('')
    setIsSubmittingAudit(true)
    try {
      const updated = await tenantService.saveAuditReview(lease.id, status, remarks)
      applyLease(updated)
      if (status === 'Verified') {
        showToast(`Lease for ${lease.tenantName} successfully marked as audited.`)
      } else {
        showToast(`Audit discrepancy flagged for ${lease.tenantName}.`)
      }
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setIsSubmittingAudit(false)
      setIsAuditConfirmModalOpen(false)
      setIsDiscrepancyModalOpen(false)
      setDiscrepancyReason('')
    }
  }

  // Filter states
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'All' | 'Paid' | 'Unpaid' | 'Pending'>('All')
  const [detailTab, setDetailTab] = React.useState<'schedule' | 'history'>('schedule')
  const [detailSearchQuery, setDetailSearchQuery] = React.useState('')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodType>('All Periods')
  const [isAuditConfirmModalOpen, setIsAuditConfirmModalOpen] = React.useState(false)
  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = React.useState(false)
  const [discrepancyReason, setDiscrepancyReason] = React.useState('')
  const [isSubmittingAudit, setIsSubmittingAudit] = React.useState(false)

  const showToast = (msg: string) => {
    notifySuccess(msg)
  }

  // Fallback if saved filter was Quarterly or Annually
  React.useEffect(() => {
    if (selectedPeriod === ('Quarterly' as any) || selectedPeriod === ('Annually' as any)) {
      setSelectedPeriod('All Periods')
    }
  }, [selectedPeriod])
  const [isSubmittingAdd, setIsSubmittingAdd] = React.useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = React.useState(false)
  const [isSubmittingPayment, setIsSubmittingPayment] = React.useState(false)
  const [isSubmittingDelete, setIsSubmittingDelete] = React.useState(false)
  const [dateRange, setDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
    preset: 'All Dates',
  })

  // Pagination states
  const [currentPage, setCurrentPage] = React.useState(1)

  // Highlight state for newly added / updated tenant
  const [highlightedTenantId, setHighlightedTenantId] = React.useState<string | null>(null)
  const highlightTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  // Dropdown states
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)

  // 3-dots action dropdown state (viewport positioning)
  const [menuOpenTenantId, setMenuOpenTenantId] = React.useState<string | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  // Modals & View Mode state
  const [viewMode, setViewMode] = React.useState<'list' | 'details'>('list')
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false)
  const [isUpdatePaymentModalOpen, setIsUpdatePaymentModalOpen] = React.useState(false)
  const [isDeletingRecord, setIsDeletingRecord] = React.useState(false)

  // Active target tenant
  const [activeTenant, setActiveTenant] = React.useState<TenantLease | null>(null)
  const [ledgerStatusFilter, setLedgerStatusFilter] = React.useState<'All' | 'Paid' | 'Pending'>('All')
  const [ledgerPage, setLedgerPage] = React.useState(1)
  const [paymentCalendarMonth, setPaymentCalendarMonth] = React.useState<Date>(() => new Date())

  // Form state for Add / Edit
  const [formData, setFormData] = React.useState<LeaseFormData>(EMPTY_FORM)
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({})

  // Today as a local YYYY-MM-DD string. Every schedule calculation uses this one value.
  const todayStr = formatToYYYYMMDD(new Date())
  const getFinancials = (lease: TenantLease): LeaseFinancials => getLeaseFinancials(lease, todayStr)

  // Form state for Daily Payment Update
  const [paymentDate, setPaymentDate] = React.useState(formatToYYYYMMDD(new Date()))
  const [paymentAmount, setPaymentAmount] = React.useState('')
  const [paymentMethod, setPaymentMethod] = React.useState('Cash')
  const [paymentRef, setPaymentRef] = React.useState('')
  const [paymentNotes, setPaymentNotes] = React.useState('')
  const [paymentStatusType, setPaymentStatusType] = React.useState<'Paid' | 'Missed'>('Paid')
  const [missedReason, setMissedReason] = React.useState('Stall closed for the day')
  const [paymentError, setPaymentError] = React.useState('')
  // Repeating leases: the period a payment starts from, and the page of the payment history list
  const [paymentPeriod, setPaymentPeriod] = React.useState<number>(1)
  const [historyPage, setHistoryPage] = React.useState(1)

  // Edit and remove recorded payments (spec 0016)
  const [editingRecord, setEditingRecord] = React.useState<DailyRentRecord | null>(null)
  // What the remove confirmation is about: one payment record, or all payments that started at a period
  const [removeTarget, setRemoveTarget] = React.useState<
    | { kind: 'record'; record: DailyRentRecord }
    | { kind: 'period'; period: SchedulePeriod; records: DailyRentRecord[]; affected: Array<{ label: string; amount: number }> }
    | null
  >(null)

  // Clear highlight timeout on unmount
  React.useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // Close dropdowns on outside click and window scroll
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (periodDropdownRef.current && !periodDropdownRef.current.contains(target)) {
        setIsPeriodDropdownOpen(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false)
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpenTenantId(null)
        setMenuPosition(null)
      }
    }

    const handleScroll = (e: Event) => {
      // Don't close if scrolling inside the modal dialog
      if ((e.target as HTMLElement)?.closest?.('[role="dialog"]')) return
      setMenuOpenTenantId(null)
      setMenuPosition(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  // Period change handler matching Sales and Expense pages (AC-7 dynamic period calculations)
  const handlePeriodChange = (period: PeriodType) => {
    setSelectedPeriod(period)
    setIsPeriodDropdownOpen(false)
    const currentToday = formatToYYYYMMDD(new Date())
    const [currYear, currMonth, currDay] = currentToday.split('-')
    const yNum = Number(currYear)
    const mNum = Number(currMonth)

    if (period === 'All Periods') {
      setDateRange({
        startDate: null,
        endDate: null,
        label: 'All Dates',
        preset: 'All Dates',
      })
    } else if (period === 'Daily') {
      setDateRange({
        startDate: currentToday,
        endDate: currentToday,
        label: `Today (${currMonth}/${currDay}/${currYear})`,
        preset: 'Daily',
      })
    } else if (period === 'Monthly') {
      const lastDayOfMonth = new Date(yNum, mNum, 0).getDate()
      setDateRange({
        startDate: `${currYear}-${currMonth}-01`,
        endDate: `${currYear}-${currMonth}-${String(lastDayOfMonth).padStart(2, '0')}`,
        label: 'This Month',
        preset: 'This Month',
      })
    } else {
      setDateRange({
        startDate: null,
        endDate: null,
        label: 'All Dates',
        preset: 'All Dates',
      })
    }
  }

  // Filtered tenants
  const filteredTenants = React.useMemo(() => {
    return tenants
      .filter((tenant) => {
        // Period frequency filter check (AC-7)
        if (selectedPeriod !== 'All Periods') {
          if (tenant.repeat !== selectedPeriod) return false
        }

        // Status filter check (Paid, Unpaid, Pending)
        if (statusFilter !== 'All') {
          const fin = getTenantPeriodFinancials(tenant, todayStr)
          if (statusFilter === 'Paid' && fin.status !== 'Paid') return false
          if (statusFilter === 'Unpaid' && fin.status !== 'Unpaid' && fin.status !== 'Overdue') return false
          if (statusFilter === 'Pending' && fin.status !== 'Pending') return false
        }

        // Search check
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim()
          const matchesId = (tenant.tenantId || '').toLowerCase().includes(q)
          const matchesName = (tenant.tenantName || '').toLowerCase().includes(q)
          const matchesUnit = (tenant.unitName || '').toLowerCase().includes(q)
          const leaseFin = getTenantPeriodFinancials(tenant, todayStr)
          const matchesRent = String(tenant.rentAmount || '').includes(q)
          const matchesPayable = String(leaseFin.totalDue || '').includes(q)
          const matchesBalance = String(leaseFin.remaining || '').includes(q)
          if (!matchesId && !matchesName && !matchesUnit && !matchesRent && !matchesPayable && !matchesBalance) {
            return false
          }
        }

        // Date range check (matches contractDate, dueDate, leaseEndDate, or active lease span overlap)
        if (dateRange.startDate || dateRange.endDate) {
          const contractDateNorm = normalizeDateToYYYYMMDD(tenant.contractDate)
          const leaseEndBound = normalizeDateToYYYYMMDD(tenant.leaseEndDate || tenant.dueDate)
          const contractInRange = isDateInRange(tenant.contractDate, dateRange.startDate, dateRange.endDate)
          const dueInRange = isDateInRange(tenant.dueDate, dateRange.startDate, dateRange.endDate)
          const endInRange = tenant.leaseEndDate
            ? isDateInRange(tenant.leaseEndDate, dateRange.startDate, dateRange.endDate)
            : false
          const spanOverlapsRange =
            Boolean(contractDateNorm && leaseEndBound) &&
            (!dateRange.endDate || contractDateNorm <= dateRange.endDate) &&
            (!dateRange.startDate || leaseEndBound >= dateRange.startDate)
          if (!contractInRange && !dueInRange && !endInRange && !spanOverlapsRange) {
            return false
          }
        }

        return true
      })
      .sort((a, b) => b.contractDate.localeCompare(a.contractDate) || Number(b.id) - Number(a.id))
  }, [tenants, statusFilter, searchQuery, dateRange, todayStr])

  // Reset to page 1 on filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, selectedPeriod, dateRange])

  // KPI calculations matching Sales & Expense
  // Lease totals per row, read through the schedule helper (stored values for leases that do not repeat)
  const financialsById = React.useMemo(() => {
    const map = new Map<string, TenantPeriodFinancials>()
    filteredTenants.forEach((item) => map.set(item.id, getTenantPeriodFinancials(item, todayStr)))
    return map
  }, [filteredTenants, todayStr])

  const totalReceivables = React.useMemo(() => {
    return filteredTenants.reduce((sum, item) => sum + (financialsById.get(item.id)?.totalDue || 0), 0)
  }, [filteredTenants, financialsById])

  const totalCollected = React.useMemo(() => {
    return filteredTenants.reduce((sum, item) => sum + (financialsById.get(item.id)?.amountPaid || 0), 0)
  }, [filteredTenants, financialsById])

  const totalRemaining = React.useMemo(() => {
    return filteredTenants.reduce((sum, item) => sum + (financialsById.get(item.id)?.remaining || 0), 0)
  }, [filteredTenants, financialsById])

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTenants.length / ITEMS_PER_PAGE))
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredTenants.length)
  const paginatedTenants = React.useMemo(() => {
    return filteredTenants.slice(startIndex, endIndex)
  }, [filteredTenants, startIndex, endIndex])

  // Open Add Modal
  const handleOpenAdd = () => {
    const today = formatToYYYYMMDD(new Date())
    const defaults = getDefaultDatesForRepeat('Daily', today)
    setFormData({
      ...EMPTY_FORM,
      repeat: 'Daily',
      contractDate: today,
      dueDate: defaults.dueDate,
      leaseEndDate: defaults.leaseEndDate,
      penaltyRate: '',
    })
    setFormErrors({})
    setIsAddModalOpen(true)
  }

  // Open Edit Modal
  const handleOpenEdit = (tenant: TenantLease, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setActiveTenant(tenant)
    const effectiveRepeat = tenant.repeat === 'Monthly' ? 'Monthly' : 'Daily'
    setFormData({
      tenantName: tenant.tenantName,
      unitName: tenant.unitName,
      rentAmount: tenant.rentAmount.toString(),
      dueDate: tenant.dueDate,
      contractDate: tenant.contractDate,
      totalAmountPayable: tenant.totalAmountPayable.toString(),
      status: tenant.status,
      notes: tenant.notes || '',
      repeat: effectiveRepeat,
      leaseEndDate: tenant.leaseEndDate || '',
      penaltyRate: typeof tenant.penaltyRate === 'number' ? String(tenant.penaltyRate) : '',
    })
    setFormErrors({})
    setMenuOpenTenantId(null)
    setMenuPosition(null)
    setIsEditModalOpen(true)
  }

  // Open Delete Modal
  const handleOpenDelete = (tenant: TenantLease, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setActiveTenant(tenant)
    setMenuOpenTenantId(null)
    setMenuPosition(null)
    setIsDeleteModalOpen(true)
  }

  // Open Daily Payment Modal
  const handleOpenDailyPayment = (tenant: TenantLease, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const todayStr = formatToYYYYMMDD(new Date())
    setActiveTenant(tenant)
    setPaymentDate(todayStr)
    setPaymentCalendarMonth(new Date(`${todayStr.slice(0, 7)}-01T00:00:00`))
    const dailyTarget = Math.max(500, Math.round(tenant.rentAmount / 30))
    if (isRepeating(tenant)) {
      // Repeating lease: start at the earliest period with a balance, amount defaults to what it still owes
      const nextPeriod = getLeaseFinancials(tenant, todayStr).nextPeriod
      setPaymentPeriod(nextPeriod ? nextPeriod.index : 1)
      setPaymentAmount(nextPeriod ? String(nextPeriod.remaining) : '')
    } else {
      setPaymentAmount(String(Math.min(tenant.remainingBalance || dailyTarget, dailyTarget)))
    }
    setPaymentMethod('Cash')
    setPaymentRef('')
    setPaymentNotes('')
    setPaymentStatusType('Paid')
    setMissedReason('Stall closed for the day')
    setPaymentError('')
    setMenuOpenTenantId(null)
    setMenuPosition(null)
    setEditingRecord(null)
    setIsUpdatePaymentModalOpen(true)
  }

  // Open Row Details Page View (Like Lending Page)
  const handleOpenDetail = (tenant: TenantLease) => {
    setActiveTenant(tenant)
    setLedgerStatusFilter('All')
    setLedgerPage(1)
    setHistoryPage(1)
    setViewMode('details')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Blank Late Penalty means no penalty (never a default value)
  const parsePenaltyInput = (raw: string): number | undefined => {
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    const n = Number(trimmed)
    return isFinite(n) ? n : undefined
  }

  // Total payable for the form as it stands: rent × payments when repeating, typed value otherwise
  const getFormPayable = (): number => {
    const rent = parseFloat(formData.rentAmount)
    if (formData.repeat !== 'None') {
      const count = countPeriods(formData.dueDate, formData.leaseEndDate, formData.repeat)
      return isNaN(rent) ? NaN : round2(rent * count)
    }
    return parseFloat(formData.totalAmountPayable || formData.rentAmount)
  }

  // Validate Add/Edit form. Pass the lease being edited so payment based locks are checked too.
  const validateForm = (existing?: TenantLease) => {
    const errors: Record<string, string> = {}
    const repeating = formData.repeat !== 'None'
    const hasPayments = Boolean(
      existing && (((existing.dailyPayments?.length || 0) > 0) || ((existing.amountPaid || 0) > 0))
    )

    const trimmedTenant = formData.tenantName.trim()
    if (!trimmedTenant) {
      errors.tenantName = 'Tenant Name is required.'
    } else if (trimmedTenant.length < 2 || trimmedTenant.length > 100) {
      errors.tenantName = 'Tenant Name must be between 2 and 100 characters.'
    }

    const trimmedUnit = formData.unitName.trim()
    if (!trimmedUnit) {
      errors.unitName = 'Leased Unit / Stall is required.'
    } else if (trimmedUnit.length > 50) {
      errors.unitName = 'Leased Unit / Stall must be between 1 and 50 characters.'
    }

    if (!formData.contractDate || isNaN(new Date(formData.contractDate).getTime())) {
      errors.contractDate = 'Date Contracted is required and must be a valid date.'
    }

    if (!formData.dueDate || isNaN(new Date(formData.dueDate).getTime())) {
      errors.dueDate = repeating ? 'First Due Date is required.' : 'Due Date is required.'
    } else if (formData.contractDate && formData.dueDate < formData.contractDate) {
      errors.dueDate = 'First Due Date must be on or after Date Contracted.'
    }

    const rent = parseFloat(formData.rentAmount)
    if (isNaN(rent) || rent <= 0) {
      errors.rentAmount = 'Rent amount must be a positive number greater than 0.'
    }

    if (!repeating) {
      const payable = parseFloat(formData.totalAmountPayable || formData.rentAmount)
      if (isNaN(payable) || payable <= 0) {
        errors.totalAmountPayable = 'Total amount payable must be greater than 0.'
      }
    } else {
      if (!formData.leaseEndDate || isNaN(new Date(formData.leaseEndDate).getTime())) {
        errors.leaseEndDate = 'Lease End Date is required and must be a valid date.'
      } else if (formData.dueDate && formData.leaseEndDate < formData.dueDate) {
        errors.leaseEndDate = 'Lease End Date must be on or after First Due Date.'
      }

      Object.assign(
        errors,
        validateRepeatSettings({
          repeat: formData.repeat,
          contractDate: formData.contractDate,
          dueDate: formData.dueDate,
          leaseEndDate: formData.leaseEndDate,
          penaltyRate: formData.penaltyRate,
        })
      )
    }

    if (formData.notes && formData.notes.length > 255) {
      errors.notes = 'Notes cannot exceed 255 characters.'
    }

    // Edit locks that depend on payments already recorded (AC-6)
    if (existing && hasPayments) {
      if (rent !== existing.rentAmount) {
        errors.rentAmount = 'Rent Amount cannot be changed once payments exist.'
      }
      if (formData.repeat !== existing.repeat) {
        errors.repeat = 'Payment Schedule cannot be changed once payments exist.'
      }
      if (formData.contractDate !== existing.contractDate) {
        errors.contractDate = 'Date Contracted cannot be changed once payments exist.'
      }
      if (formData.dueDate !== existing.dueDate) {
        errors.dueDate = 'First Due Date cannot be changed once payments exist.'
      }
      if (formData.leaseEndDate !== (existing.leaseEndDate || '')) {
        errors.leaseEndDate = 'Lease End Date cannot be changed once payments exist.'
      }
    }

    // Additional edit locks against payments
    if (existing && (isRepeating(existing) || repeating) && Object.keys(errors).length === 0) {
      Object.assign(
        errors,
        validateEditAgainstPayments(
          existing,
          {
            repeat: formData.repeat,
            dueDate: formData.dueDate,
            leaseEndDate: formData.leaseEndDate,
            rentAmount: rent,
            penaltyRate: parsePenaltyInput(formData.penaltyRate),
          },
          todayStr
        )
      )
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  // Submit Add (AC-1 submission lock)
  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingAdd) return
    if (!validateForm()) return

    setIsSubmittingAdd(true)
    const rent = parseFloat(formData.rentAmount)
    const repeating = formData.repeat !== 'None'
    const payable = getFormPayable()

    // The server makes the tenant reference and, for a repeating lease, sets the total
    let newTenant: TenantLease
    try {
      newTenant = await tenantService.createLease({
        tenantName: formData.tenantName.trim(),
        unitName: formData.unitName.trim(),
        rentAmount: rent,
        contractDate: formData.contractDate,
        dueDate: formData.dueDate,
        leaseEndDate: repeating ? formData.leaseEndDate : undefined,
        repeat: formData.repeat,
        penaltyRate: repeating ? parsePenaltyInput(formData.penaltyRate) : undefined,
        totalAmountPayable: repeating ? undefined : payable,
        status: formData.status,
        notes: formData.notes.trim(),
      })
    } catch (err) {
      setFormErrors({ form: messageOf(err) })
      return
    } finally {
      setIsSubmittingAdd(false)
    }

    applyLease(newTenant)
    setIsAddModalOpen(false)

    // Highlight new tenant
    setCurrentPage(1)
    setHighlightedTenantId(newTenant.id)
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedTenantId(null)
    }, 3000)

    setTimeout(() => {
      tableCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  // Submit Edit (AC-1 submission lock)
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingEdit) return
    if (!activeTenant || !validateForm(activeTenant)) return

    setIsSubmittingEdit(true)
    const rent = parseFloat(formData.rentAmount)
    const repeating = formData.repeat !== 'None'
    const payable = getFormPayable()

    let updatedTenant: TenantLease
    try {
      updatedTenant = await tenantService.updateLease(activeTenant.id, {
        tenantName: formData.tenantName.trim(),
        unitName: formData.unitName.trim(),
        rentAmount: rent,
        contractDate: formData.contractDate,
        dueDate: formData.dueDate,
        leaseEndDate: repeating ? formData.leaseEndDate : undefined,
        repeat: formData.repeat,
        penaltyRate: repeating ? parsePenaltyInput(formData.penaltyRate) : undefined,
        totalAmountPayable: repeating ? undefined : payable,
        status: formData.status,
        notes: formData.notes.trim(),
      })
      updatedTenant = await syncStatus(updatedTenant)
    } catch (err) {
      setFormErrors({ form: messageOf(err) })
      return
    } finally {
      setIsSubmittingEdit(false)
    }

    applyLease(updatedTenant)
    setIsEditModalOpen(false)
  }

  // Confirm Delete (with submission lock and loading state)
  const handleConfirmDelete = async () => {
    if (!activeTenant || isSubmittingDelete) return
    setIsSubmittingDelete(true)
    try {
      await tenantService.deleteLease(activeTenant.id)
      setTenants((prev) => prev.filter((t) => t.id !== activeTenant.id))
      setIsDeleteModalOpen(false)
      setActiveTenant(null)
      setViewMode('list')
    } catch (err) {
      setActionError(messageOf(err))
      setIsDeleteModalOpen(false)
    } finally {
      setIsSubmittingDelete(false)
    }
  }

  // Submit Daily Payment / Missed Record (AC-1 submission lock)
  const handleSubmitDailyPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingPayment) return
    if (!activeTenant) return

    if (!paymentDate) {
      setPaymentError('Date is required.')
      return
    }

    let input: PaymentInput

    if (isRepeating(activeTenant)) {
      // Repeating leases: the payment starts at the chosen period and extra money flows forward
      const fin = getLeaseFinancials(activeTenant, todayStr)
      const period = fin.periods.find((p) => p.index === paymentPeriod)
      if (!period) {
        setPaymentError('Select the period this payment is for.')
        return
      }

      if (paymentStatusType === 'Missed') {
        if (activeTenant.repeat !== 'Daily') {
          setPaymentError('Missed days can only be marked on Daily leases.')
          return
        }
        if (period.remaining <= 0.005) {
          setPaymentError(`${period.label} is already fully paid.`)
          return
        }
        input = {
          date: period.dueDate,
          amount: 0,
          method: 'N/A',
          referenceNo: 'MISSED',
          notes: paymentNotes.trim() || `Unpaid: ${missedReason}`,
          status: 'Missed',
          missedReason,
          periodIndex: period.index,
        }
      } else {
        const amt = round2(parseFloat(paymentAmount))
        if (period.remaining <= 0.005) {
          setPaymentError(`${period.label} is already fully paid. Pick a period with a balance.`)
          return
        }
        if (isNaN(amt) || amt <= 0) {
          setPaymentError('Payment amount must be greater than 0.')
          return
        }
        const room = round2(fin.periods.filter((p) => p.index >= period.index).reduce((sum, p) => sum + p.remaining, 0))
        if (amt > room + 0.005) {
          setPaymentError(
            `From ${period.label} onward the lease only has ${formatPHP(room)} left to pay. Pick an earlier period to pay more.`
          )
          return
        }
        const isPartial = amt < period.remaining - 0.005
        input = {
          date: paymentDate,
          amount: amt,
          method: paymentMethod,
          referenceNo: paymentRef.trim() || undefined,
          notes: paymentNotes.trim() || undefined,
          status: isPartial ? 'Partially Paid' : 'Paid',
          periodIndex: period.index,
        }
      }
    } else if (paymentStatusType === 'Paid') {
      const amt = round2(parseFloat(paymentAmount))
      if (isNaN(amt) || amt <= 0) {
        setPaymentError('Payment amount must be greater than 0.')
        return
      }
      if (amt > activeTenant.remainingBalance + 0.005) {
        setPaymentError(`Payment amount cannot exceed the remaining balance of ${formatPHP(activeTenant.remainingBalance)}.`)
        return
      }
      input = {
        date: paymentDate,
        amount: amt,
        method: paymentMethod,
        referenceNo: paymentRef.trim() || undefined,
        notes: paymentNotes.trim() || undefined,
        status: 'Paid',
      }
    } else {
      // Missed / Did Not Pay Today
      input = {
        date: paymentDate,
        amount: 0,
        method: 'N/A',
        referenceNo: 'MISSED',
        notes: paymentNotes.trim() || `Unpaid: ${missedReason}`,
        status: 'Missed',
        missedReason,
      }
    }

    setIsSubmittingPayment(true)
    try {
      let updated = await tenantService.addPayment(activeTenant.id, input)
      updated = await syncStatus(updated)
      applyLease(updated)
    } catch (err) {
      setPaymentError(messageOf(err))
      return
    } finally {
      setIsSubmittingPayment(false)
    }
    setHistoryPage(1)
    setLedgerPage(1)
    setIsUpdatePaymentModalOpen(false)
  }

  // ---------------------------------------------------------------------------------------------
  // Edit, remove, mark paid and mark unpaid (spec 0016)
  // A period's status is always worked out from the payments, so "paid" and "unpaid" are changed by
  // adding, editing or removing payments, never by typing a status. The server saves the change,
  // clears an earlier Audited or Flagged mark, and sends the updated lease back.
  // ---------------------------------------------------------------------------------------------

  // Money recorded in a list of payments (Missed marks carry no money)
  const moneyOf = (records: DailyRentRecord[]): number =>
    round2(records.filter((r) => r.status !== 'Missed').reduce((sum, r) => sum + (r.amount || 0), 0))

  const handleOpenEditRecord = (record: DailyRentRecord) => {
    setEditingRecord(record)
    setIsUpdatePaymentModalOpen(true)
  }

  const handleConfirmRemove = async () => {
    if (!activeTenant || !removeTarget || isDeletingRecord) return
    setIsDeletingRecord(true)
    const ids =
      removeTarget.kind === 'record' ? [removeTarget.record.id] : removeTarget.records.map((r) => r.id)
    try {
      let updated = activeTenant
      for (const id of ids) {
        updated = await tenantService.deletePayment(activeTenant.id, id)
      }
      updated = await syncStatus(updated)
      applyLease(updated)
      await loadTenants(true)
      showToast('Payment removed successfully.')
    } catch (err) {
      setActionError(messageOf(err))
      // Show what the server really has after a partly finished removal
      void loadTenants(true)
    } finally {
      setIsDeletingRecord(false)
    }
    setRemoveTarget(null)
    setLedgerPage(1)
    setHistoryPage(1)
  }

  // "Mark as Paid" on a schedule row: open Record Payment for that period with what it still owes
  const handleMarkPeriodPaid = (period: SchedulePeriod) => {
    if (!activeTenant) return
    handleOpenDailyPayment(activeTenant)
    setPaymentPeriod(period.index)
    setPaymentAmount(String(period.remaining))
  }

  // "Mark as Unpaid" on a schedule row: remove the payments that started at that period, after a confirm
  const handleRequestMarkUnpaid = (period: SchedulePeriod) => {
    if (!activeTenant) return
    const records = activeTenant.dailyPayments.filter(
      (r) => r.status !== 'Missed' && (r.amount || 0) > 0 && (r.periodIndex || 1) === period.index
    )
    if (records.length === 0) return
    const kept = activeTenant.dailyPayments.filter((r) => !records.includes(r))
    const before = buildSchedule(activeTenant, todayStr)
    const after = buildSchedule({ ...activeTenant, dailyPayments: kept }, todayStr)
    const affected = before
      .map((p, i) => ({ label: p.label, amount: round2(p.paid - (after[i]?.paid || 0)) }))
      .filter((a) => a.amount > 0.005)
    setRemoveTarget({ kind: 'period', period, records, affected })
  }

  // Due Date text shared by the table and both exports (AC-8): next unpaid period for a repeating lease
  const getDueDateText = (lease: TenantLease, fin: TenantPeriodFinancials): string => {
    if (!isRepeating(lease) || fin.periodCount === 0) return `${lease.dueDate} (One Time)`
    if (fin.status === 'Paid') {
      return fin.nextDueDateLabel === 'Fully Paid' ? 'Fully Paid' : `${fin.nextDueDate} (${fin.nextDueDateLabel})`
    }
    return `${fin.activePeriodDueDate} (${fin.activePeriodLabel})`
  }

  // Export to CSV: Exports only table contents
  const handleExportCSV = () => {
    setIsExportDropdownOpen(false)
    const headers = [
      'Tenant ID',
      "Tenant's Name",
      'Leased Stall/Unit',
      'Rental Rate',
      'Contract Date',
      'Due Date',
      'Total Payable',
      'Amount Paid',
      'Remaining Balance',
      'Status',
      'Company',
    ]

    const rows = filteredTenants.map((t) => {
      const fin = financialsById.get(t.id) ?? getTenantPeriodFinancials(t, todayStr)
      return [
        csvCell(t.tenantId),
        csvCell(t.tenantName),
        csvCell(t.unitName),
        t.rentAmount,
        t.contractDate,
        csvCell(getDueDateText(t, fin)),
        fin.totalDue,
        fin.amountPaid,
        fin.remaining,
        csvCell(fin.status),
        csvCell(t.companyName),
      ]
    })

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute(
      'download',
      `tenant_leases_summary_JK_Property_and_Ventures_${Date.now()}.csv`
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Export to PDF: Formats and exports ONLY the content of the table (matching Sales & Expense)
  const handleExportPDF = () => {
    setIsExportDropdownOpen(false)
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const rowsHtml =
      filteredTenants.length === 0
        ? `<tr><td colspan="9" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No tenant leases found matching the selected filters.</td></tr>`
        : filteredTenants
            .map((t) => {
              const fin = getFinancials(t)
              return `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px; font-weight: 600; color: #960C01;">${escapeHtml(t.tenantId)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(t.tenantName)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #475569;">${escapeHtml(t.unitName)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right;">₱${t.rentAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${t.contractDate}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${escapeHtml(getDueDateText(t, fin))}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 600;">₱${fin.totalDue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 600;">₱${fin.amountPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #d97706; font-weight: 700;">₱${fin.remaining.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${escapeHtml(fin.status)}</td>
        </tr>
      `
            })
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Tenant Leases Report - JK Property and Ventures</title>
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
          <p>Tenant Leases Summary Report for <strong>JK Property and Ventures</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Tenant ID</th>
                <th>Tenant's Name</th>
                <th>Leased Stall / Unit</th>
                <th style="text-align: right;">Rent Rate</th>
                <th style="text-align: center;">Contract Date</th>
                <th style="text-align: center;">Due Date</th>
                <th style="text-align: right;">Total Payable</th>
                <th style="text-align: right;">Amount Paid</th>
                <th style="text-align: right;">Remaining Balance</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Leases:</strong> ${filteredTenants.length}</div>
            <div><strong>Total Receivables:</strong> ₱${totalReceivables.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            <div><strong>Total Collected:</strong> ₱${totalCollected.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            <div><strong>Total Remaining Balance:</strong> ₱${totalRemaining.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
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
  }

  // Render Full-Page Tenant Details View (Matching FilCap Lending Page UI)
  const renderDetailsPage = () => {
    if (!activeTenant) return null

    const LEDGER_ITEMS_PER_PAGE = 13
    const SCHEDULE_ITEMS_PER_PAGE = 13
    const HISTORY_ITEMS_PER_PAGE = 13

    const fin = getFinancials(activeTenant)
    const repeatingLease = isRepeating(activeTenant) && fin.periodCount > 0
    const nextPeriod = fin.nextPeriod

    // For non-repeating leases: build unified payment and scheduled ledger
    const recordedDates = new Set<string>()
    const ledgerRows: Array<{
      id: string
      date: string
      status: 'Paid' | 'Pending'
      amount: number
      method: string
      referenceNo: string
      notes: string
      recordId?: string
    }> = []

    ;(activeTenant.dailyPayments || []).forEach((p) => {
      if (p.date) recordedDates.add(p.date)
      const isPaidRecord = p.status !== 'Missed' && (p.amount || 0) > 0
      ledgerRows.push({
        id: p.id,
        recordId: p.id,
        date: p.date,
        status: isPaidRecord ? 'Paid' : 'Pending',
        amount: p.amount || 0,
        method: p.method || '—',
        referenceNo: p.referenceNo || '—',
        notes: p.status === 'Missed' ? p.missedReason || p.notes || 'Unpaid' : p.notes || '—',
      })
    })

    const dailyTarget = Math.max(500, Math.round(activeTenant.rentAmount / 30))
    if (!repeatingLease && activeTenant.contractDate && activeTenant.dueDate && activeTenant.remainingBalance > 0) {
      const start = new Date(`${activeTenant.contractDate}T00:00:00`)
      const end = new Date(`${activeTenant.dueDate}T00:00:00`)
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const cursor = new Date(start)
        let count = 0
        while (cursor <= end && count < 60) {
          const dStr = formatToYYYYMMDD(cursor)
          if (!recordedDates.has(dStr)) {
            ledgerRows.push({
              id: `sched-${dStr}`,
              date: dStr,
              status: 'Pending',
              amount: 0,
              method: '—',
              referenceNo: '—',
              notes: `Scheduled (${formatPHP(dailyTarget)})`,
            })
          }
          cursor.setDate(cursor.getDate() + 1)
          count++
        }
      }
    }

    // Filter non-repeating ledger by ledgerStatusFilter & detailSearchQuery
    const filteredLedger = ledgerRows.filter((r) => {
      if (ledgerStatusFilter === 'Paid' && r.status !== 'Paid') return false
      if (ledgerStatusFilter === 'Pending' && r.status !== 'Pending') return false
      if (detailSearchQuery.trim()) {
        const q = detailSearchQuery.toLowerCase().trim()
        if (
          !r.date.toLowerCase().includes(q) &&
          !r.notes.toLowerCase().includes(q) &&
          !r.referenceNo.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })

    // Filter repeating periods
    const filteredPeriods = fin.periods.filter((p) => {
      if (ledgerStatusFilter === 'Paid') {
        const isSettled = p.status === 'Paid' || p.status === 'Advance Paid'
        if (!isSettled) return false
      } else if (ledgerStatusFilter === 'Pending') {
        const isSettled = p.status === 'Paid' || p.status === 'Advance Paid'
        if (isSettled) return false
      }
      if (detailSearchQuery.trim()) {
        const q = detailSearchQuery.toLowerCase().trim()
        if (!p.label.toLowerCase().includes(q) && !p.dueDate.toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })

    // Filter repeating history records (newest on top)
    const historyRecords = (activeTenant.dailyPayments || [])
      .slice()
      .sort((a, b) => {
        const periodA = a.periodIndex ? fin.periods.find((p) => p.index === a.periodIndex) : undefined
        const periodB = b.periodIndex ? fin.periods.find((p) => p.index === b.periodIndex) : undefined
        const instA = periodA ? periodA.dueDate : (a.date || '')
        const instB = periodB ? periodB.dueDate : (b.date || '')

        // 1. Installment date descending (newest installment first)
        const byInstallment = (instB || '').localeCompare(instA || '')
        if (byInstallment !== 0) return byInstallment

        // 2. Payment date (cash received date) descending (newest payment date first)
        const byDate = (b.date || '').localeCompare(a.date || '')
        if (byDate !== 0) return byDate

        // 3. Timestamp descending (newest transaction time first)
        const byTimestamp = (b.timestamp || '').localeCompare(a.timestamp || '')
        if (byTimestamp !== 0) return byTimestamp

        // 4. Numeric ID descending (highest / newest transaction ID first)
        const idA = Number(a.id) || 0
        const idB = Number(b.id) || 0
        return idB - idA
      })
      .filter((rec) => {
        if (detailSearchQuery.trim()) {
          const q = detailSearchQuery.toLowerCase().trim()
          const matchesDate = (rec.date || '').toLowerCase().includes(q)
          const matchesRef = (rec.referenceNo || '').toLowerCase().includes(q)
          const matchesNotes = (rec.notes || '').toLowerCase().includes(q)
          if (!matchesDate && !matchesRef && !matchesNotes) return false
        }
        return true
      })

    // Track how many payments started at each period
    const startedAtPeriod = new Map<number, number>()
    ;(activeTenant.dailyPayments || []).forEach((r) => {
      if (r.status === 'Missed' || !(r.amount > 0)) return
      const idx = r.periodIndex || 1
      startedAtPeriod.set(idx, (startedAtPeriod.get(idx) || 0) + 1)
    })
    const periodLabelByIndex = new Map(fin.periods.map((p) => [p.index, p.label]))

    // Build cycle settlement map to know whether an installment cycle has reached its full target (matching Lending)
    const isDaily = !activeTenant.repeat || activeTenant.repeat === 'Daily'
    const cycleDailyTarget = activeTenant.rentAmount || 0
    const cycleSettledMap = new Map<string, boolean>()

    if (isDaily) {
      const paidByInstallmentDate = new Map<string, number>()
      ;(activeTenant.dailyPayments || []).forEach((p) => {
        if (p.status === 'Missed') return
        const matchedPeriod = p.periodIndex
          ? fin.periods.find((per) => per.index === p.periodIndex)
          : undefined
        const d = matchedPeriod ? matchedPeriod.dueDate : (p.date || '')
        if (d) {
          paidByInstallmentDate.set(d, (paidByInstallmentDate.get(d) || 0) + (p.amount || 0))
        }
      })
      paidByInstallmentDate.forEach((total, d) => {
        if (total >= cycleDailyTarget - 0.005 || fin.remaining <= 0.005) {
          cycleSettledMap.set(d, true)
        }
      })
    } else {
      fin.periods.forEach((m) => {
        if (m.status === 'Paid' || m.remaining <= 0.005 || fin.remaining <= 0.005) {
          cycleSettledMap.set(m.dueDate, true)
        }
      })
    }

    // Pagination for schedule periods
    const totalSchedulePages = Math.max(1, Math.ceil(filteredPeriods.length / SCHEDULE_ITEMS_PER_PAGE))
    const safeSchedulePage = Math.min(ledgerPage, totalSchedulePages)
    const paginatedPeriods = filteredPeriods.slice(
      (safeSchedulePage - 1) * SCHEDULE_ITEMS_PER_PAGE,
      safeSchedulePage * SCHEDULE_ITEMS_PER_PAGE
    )

    // Pagination for history records
    const totalHistoryPages = Math.max(1, Math.ceil(historyRecords.length / HISTORY_ITEMS_PER_PAGE))
    const safeHistoryPage = Math.min(historyPage, totalHistoryPages)
    const paginatedHistory = historyRecords.slice(
      (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE,
      safeHistoryPage * HISTORY_ITEMS_PER_PAGE
    )
    const historyStartIndex = (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE
    const historyEndIndex = Math.min(safeHistoryPage * HISTORY_ITEMS_PER_PAGE, historyRecords.length)

    // Pagination for non-repeating ledger
    const totalLedgerPages = Math.max(1, Math.ceil(filteredLedger.length / LEDGER_ITEMS_PER_PAGE))
    const safeLedgerPage = Math.min(ledgerPage, totalLedgerPages)
    const paginatedLedger = filteredLedger.slice(
      (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE,
      safeLedgerPage * LEDGER_ITEMS_PER_PAGE
    )

    return (
      <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-200">
        {/* Top navigation row */}
        <div className="flex items-center justify-between gap-3">
          <BackButton onClick={() => setViewMode('list')} label="Back to Tenants" />
        </div>

        {/* Tenant & Lease Header (Matching FilCap Lending exactly) */}
        <div className="pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-focus tracking-tight">
                  {activeTenant.tenantName}
                </h1>
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Ref No: <strong className="text-focus font-mono">{activeTenant.tenantId || `TN-${activeTenant.id}`}</strong>
                </span>
                <span className="text-muted-fg/40">•</span>
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Unit / Stall: <strong className="text-focus">{activeTenant.unitName}</strong>
                </span>
              </div>
            </div>

            {/* Action Buttons in the same row as the Tenant Name */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
              {!isAudit && fin.remaining > 0 && (
                <Button
                  type="button"
                  onClick={(e) => handleOpenDailyPayment(activeTenant, e)}
                  className="h-10 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Coins className="h-4 w-4" />
                  <span>Record Payment</span>
                </Button>
              )}

              {!isAudit && !isOwner && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={(e) => handleOpenEdit(activeTenant, e)}
                  className="h-10 px-3.5 rounded-xl border border-stroke/60 bg-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer hover:bg-surface text-focus shadow-2xs"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit Terms</span>
                </Button>
              )}

              {canAuditActions && (
                <>
                  <Button
                    type="button"
                    onClick={() => setIsAuditConfirmModalOpen(true)}
                    className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{activeTenant.auditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDiscrepancyReason(activeTenant.auditRemarks || '')
                      setIsDiscrepancyModalOpen(true)
                    }}
                    className="h-10 px-4 rounded-xl border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>Flag Discrepancy</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Two Section Layout: Terms & Financial Receipt (Left) & Complete Schedule Ledger (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left Column: Lease Agreement & Terms Styled Like a Financial Receipt */}
          <div className="lg:col-span-5 xl:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
            {/* Main Receipt Content with tight, natural receipt layout */}
            <div className="space-y-3.5">
              {/* Receipt Header */}
              <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-focus">
                    <Receipt className="w-4 h-4 text-focus" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                      Lease Agreement & Terms
                    </h3>
                    <span className="text-[10px] text-muted-fg font-medium">Official Agreement Receipt</span>
                  </div>
                </div>
                <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold border border-slate-200">
                  {activeTenant.tenantId || `TN-${activeTenant.id}`}
                </span>
              </div>

              {/* Terms & Schedule Parameters */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                  <span className="text-muted-fg">Date Contracted:</span>
                  <span className="font-mono text-focus">{activeTenant.contractDate}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                  <span className="text-muted-fg">Maturity / Next Due:</span>
                  <span className="font-mono text-focus">
                    {repeatingLease
                      ? nextPeriod
                        ? `${nextPeriod.dueDate} (${nextPeriod.label})`
                        : 'Fully paid'
                      : activeTenant.dueDate}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                  <span className="text-muted-fg">Leased Unit / Stall:</span>
                  <span className="font-semibold text-focus">{activeTenant.unitName}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                  <span className="text-muted-fg">Schedule / Repeat:</span>
                  <span className="font-semibold text-focus">
                    {repeatingLease
                      ? describeRepeat(activeTenant.repeat as LeaseRepeat, activeTenant.dueDate, fin.periodCount)
                      : 'One-Time Lease'}
                  </span>
                </div>
                {activeTenant.leaseEndDate && (
                  <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                    <span className="text-muted-fg">Lease End Date:</span>
                    <span className="font-mono text-focus">{activeTenant.leaseEndDate}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-fg">Assigned Company:</span>
                  <span className="font-semibold text-focus truncate max-w-[180px]">
                    {activeTenant.companyName || 'JK Property and Ventures'}
                  </span>
                </div>
              </div>

              {/* Dashed Perforation */}
              <div className="border-t border-dashed border-slate-200" />

              {/* Financial Breakdown */}
              <div className="space-y-1.5 text-xs">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                  Financial Breakdown
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-fg">Rental Rate:</span>
                  <span className="font-mono font-bold text-focus">{formatPHP(activeTenant.rentAmount)}</span>
                </div>
                {repeatingLease && (
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-fg">Lease Duration:</span>
                    <span className="font-mono font-bold text-focus">
                      {fin.periodCount} {fin.periodCount === 1 ? 'Period' : 'Periods'}
                    </span>
                  </div>
                )}
                {activeTenant.penaltyRate && activeTenant.penaltyRate > 0 ? (
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-fg">Penalty Rate:</span>
                    <span className="font-mono font-bold text-[#960C01]">
                      {activeTenant.penaltyRate}%
                    </span>
                  </div>
                ) : null}
                <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-sm">
                  <span className="text-focus">Total Payable:</span>
                  <span className="font-mono text-focus">{formatPHP(fin.totalDue)}</span>
                </div>
              </div>

              {/* Dashed Perforation */}
              <div className="border-t border-dashed border-slate-200" />

              {/* Collections & Balances */}
              <div className="space-y-2 text-xs">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                  Collections & Balances
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-fg">Amount Paid:</span>
                  <span className="font-mono font-bold text-emerald-600">{formatPHP(fin.amountPaid)}</span>
                </div>
                {(fin.totalPenalties || 0) > 0 && (
                  <div className="flex justify-between items-center py-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-fg">Late Penalty:</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#960C01]/10 text-[#960C01] font-bold border border-[#960C01]/20">
                        Late Overdue
                      </span>
                    </div>
                    <span className="font-mono font-bold text-[#960C01]">
                      {formatPHP(fin.totalPenalties)}
                    </span>
                  </div>
                )}

                {/* Remaining Balance Receipt Box */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-focus block">Remaining Balance</span>
                    <span className="text-[10px] text-muted-fg">Balance to complete</span>
                  </div>
                  <span
                    className={cn(
                      'text-base font-mono font-extrabold',
                      fin.remaining <= 0.005 ? 'text-emerald-600' : 'text-amber-600'
                    )}
                  >
                    {formatPHP(fin.remaining)}
                  </span>
                </div>

                {/* Target Receipt Box */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-focus block">
                      {repeatingLease ? 'Rent Per Period' : 'Target Rent'}
                    </span>
                    <span className="text-[10px] text-muted-fg">
                      {repeatingLease ? `${activeTenant.repeat} cycle` : 'Target per payment'}
                    </span>
                  </div>
                  <span className="text-sm font-mono font-bold text-focus">
                    {formatPHP(activeTenant.rentAmount)}
                  </span>
                </div>
              </div>

              {/* Agreement Notes (if any) */}
              {activeTenant.notes && (
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-muted-fg">
                  <strong className="text-focus font-semibold block mb-0.5 text-[11px]">Agreement Notes:</strong>
                  {activeTenant.notes}
                </div>
              )}

              {/* Dashed Perforation */}
              <div className="border-t border-dashed border-slate-200" />

              {/* Dedicated Audit Review Panel (AC-1: Mirroring FilCap Lending) */}
              <div className="p-3.5 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-focus" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">
                      Audit Review
                    </span>
                  </div>
                  {(() => {
                    const st = activeTenant.auditStatus || (activeTenant as any).audit_status
                    if (st === 'Verified') {
                      return (
                        <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                          AUDITED
                        </span>
                      )
                    }
                    if (st === 'Flagged') {
                      return (
                        <span className="text-xs font-bold uppercase tracking-wide text-[#960C01]">
                          DISCREPANCY
                        </span>
                      )
                    }
                    return (
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        PENDING AUDIT
                      </span>
                    )
                  })()}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-fg">Audited By:</span>
                    <span className="font-semibold text-focus">
                      {activeTenant.auditedBy || (activeTenant as any).audited_by || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-fg">Audit Date:</span>
                    <span className="font-mono text-focus">
                      {formatAuditTimestamp(activeTenant.auditDate, activeTenant.audited_at || (activeTenant as any).auditedAt) || '—'}
                    </span>
                  </div>
                </div>

                {(activeTenant.auditRemarks || (activeTenant as any).audit_remarks) && (
                  <div className="pt-2 border-t border-slate-200/70 text-xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg block mb-1">
                      Auditor Remarks:
                    </span>
                    <p className="text-xs text-focus/90 bg-white p-2.5 rounded-lg border border-slate-200/80 leading-relaxed whitespace-pre-wrap">
                      {activeTenant.auditRemarks || (activeTenant as any).audit_remarks}
                    </p>
                  </div>
                )}
              </div>


            </div>
          </div>

          {/* Right Column: Full Width Payment Schedule & History Table (Matching FilCap) */}
          <div className="lg:col-span-7 xl:col-span-8 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
            <div className="flex-1 flex flex-col space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                    Payment Schedule & History ({historyRecords.length})
                  </h3>
                </div>

                {/* Payment Search Bar (filter dates or remarks) */}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg pointer-events-none" />
                  <Input
                    type="text"
                    value={detailSearchQuery}
                    onChange={(e) => {
                      setDetailSearchQuery(e.target.value)
                      setHistoryPage(1)
                    }}
                    placeholder="Search dates or remarks..."
                    className="pl-9 pr-8 h-9 text-xs rounded-xl bg-slate-50 border-stroke/60 focus:bg-white"
                  />
                  {detailSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailSearchQuery('')
                        setHistoryPage(1)
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus text-xs p-0.5 cursor-pointer"
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Payment Schedule & History Table or Empty State */}
              <div className="flex-1 flex flex-col">
                {(activeTenant.dailyPayments || []).length === 0 ? (
                  <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                      <Coins className="w-7 h-7" />
                    </div>
                    <h4 className="text-sm font-bold text-focus">No Payments Recorded Yet</h4>
                    <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                      This tenant has not started paying yet. All recorded payment transactions, dates, amounts, and receipt references will appear here as a payment log.
                    </p>
                    {!isAudit && fin.remaining > 0 && (
                      <Button
                        type="button"
                        onClick={(e) => handleOpenDailyPayment(activeTenant, e)}
                        className="h-9 px-4 rounded-xl font-semibold text-xs bg-focus hover:bg-focus/90 text-white flex items-center gap-2 cursor-pointer shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Record Payment</span>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 flex-1">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-muted-fg font-semibold">
                        <tr>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Installment Date</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Payment Date</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Amount Paid</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Method</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Receipt / Ref No.</th>
                          <th className="py-2.5 px-3.5 text-left">Remarks</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Created By</th>
                          {!isAudit && !isOwner && (
                            <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedHistory.length === 0 ? (
                          <tr>
                            <td colSpan={!isAudit && !isOwner ? 9 : 8} className="py-12 text-center text-muted-fg text-xs">
                              <div className="flex flex-col items-center justify-center">
                                <Coins className="w-6 h-6 text-muted-fg/40 mb-2" />
                                <p className="font-semibold text-focus">
                                  No payment records matching &quot;{detailSearchQuery}&quot;
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          paginatedHistory.map((rec) => {
                            const matchedPeriod = rec.periodIndex
                              ? fin.periods.find((p) => p.index === rec.periodIndex)
                              : undefined
                            const installmentDate = matchedPeriod ? matchedPeriod.dueDate : rec.date
                            const isCycleSettled = cycleSettledMap.has(installmentDate)
                            const isMissed = rec.status === 'Missed'
                            const isPartial = !isMissed && !isCycleSettled

                            return (
                              <tr
                                key={rec.id}
                                className={cn(
                                  'hover:bg-slate-50/70 transition-colors',
                                  isPartial && 'bg-amber-50/20'
                                )}
                              >
                                <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                  {installmentDate}
                                </td>
                                <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap font-medium">
                                  {rec.date}
                                </td>
                                <td className="py-2.5 px-3.5 whitespace-nowrap">
                                  {isMissed ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#960C01]">
                                      <AlertCircle className="w-3 h-3 text-[#960C01]" />
                                      <span>Missed</span>
                                    </span>
                                  ) : isPartial ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                                      <span>Partially Paid</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center text-xs font-bold text-emerald-600">
                                      <span>Paid</span>
                                    </span>
                                  )}
                                </td>
                                <td className={cn(
                                  'py-2.5 px-3.5 font-bold whitespace-nowrap',
                                  isPartial ? 'text-amber-700' : 'text-emerald-600'
                                )}>
                                  <div>{formatPHP(rec.amount)}</div>
                                </td>
                                <td className="py-2.5 px-3.5 text-focus whitespace-nowrap">
                                  {rec.method || 'Cash'}
                                </td>
                                <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap">
                                  {rec.referenceNo || '-'}
                                </td>
                                {(() => {
                                  const displayRemarks = (rec.notes || (rec as any).remarks || '').trim() || '-'

                                  return (
                                    <td
                                      className="py-2.5 px-3.5 text-muted-fg whitespace-normal break-words max-w-[320px] text-xs leading-relaxed"
                                      title={displayRemarks !== '-' ? displayRemarks : undefined}
                                    >
                                      {displayRemarks}
                                    </td>
                                  )
                                })()}
                                {(() => {
                                  const rawCreatedBy = rec.createdByName
                                  const resolvedFullName = rawCreatedBy ? formatRealName(rawCreatedBy) : ''
                                  const fullCreatedBy = resolvedFullName || rawCreatedBy || ''
                                  const displayCreatedBy = formatPersonInitialAndLastName(fullCreatedBy)
                                  const hasName = Boolean(fullCreatedBy && fullCreatedBy !== '—' && fullCreatedBy !== '-')
                                  const tooltipText = hasName ? fullCreatedBy : undefined

                                  return (
                                    <td
                                      className="py-2.5 px-3.5 text-focus font-medium whitespace-nowrap max-w-[160px] truncate"
                                      title={tooltipText}
                                    >
                                      <span
                                        className={cn(hasName ? 'cursor-help' : 'text-muted-fg/40 font-mono')}
                                        title={tooltipText}
                                      >
                                        {hasName ? displayCreatedBy : '-'}
                                      </span>
                                    </td>
                                  )
                                })()}
                                {!isAudit && !isOwner && (
                                  <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                                    <div className="inline-flex items-center justify-center">
                                      <RowActionsMenu
                                        canEdit
                                        canDelete
                                        onEdit={() => handleOpenEditRecord(rec)}
                                        onDelete={() => setRemoveTarget({ kind: 'record', record: rec })}
                                        editLabel="Edit Payment"
                                        deleteLabel="Remove Payment"
                                      />
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Schedule & History Pagination Footer (Anchored at Bottom Matching FilCap) */}
            <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
              <span className="font-medium text-focus/80">
                {historyRecords.length === 0
                  ? 'Showing 0-0 of 0 records'
                  : `Showing ${historyStartIndex + 1}-${historyEndIndex} of ${historyRecords.length} records`}
              </span>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className="text-xs text-muted-fg font-medium">
                  Page {safeHistoryPage} out of {totalHistoryPages}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeHistoryPage <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  aria-label="Previous history page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeHistoryPage >= totalHistoryPages}
                  onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                  className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  aria-label="Next history page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>        </div>
      </div>
    )
  }

  // Record Payment form for a repeating lease: pick the starting period, extra money flows forward (AC-9, AC-10)
  const renderRepeatPaymentForm = (lease: TenantLease) => {
    const fin = getFinancials(lease)
    const isDailyLease = lease.repeat === 'Daily'
    const selectablePeriods = fin.periods.filter((p) => p.remaining > 0.005)
    const selected = selectablePeriods.find((p) => p.index === paymentPeriod) || null
    const isMissedMark = isDailyLease && paymentStatusType === 'Missed'
    const amountNum = parseFloat(paymentAmount)
    // Money only flows forward, so the most a payment can take is what the chosen period and the
    // periods after it still owe. Anything more would have nowhere to go.
    const maxAllowed = selected
      ? round2(fin.periods.filter((p) => p.index >= selected.index).reduce((sum, p) => sum + p.remaining, 0))
      : fin.remaining
    const isAmountValid = !isNaN(amountNum) && amountNum > 0 && amountNum <= maxAllowed + 0.005
    const allocation =
      !isMissedMark && selected && isAmountValid
        ? previewPayment(lease, todayStr, selected.index, round2(amountNum), paymentDate)
        : []
    const canSubmit = !!paymentDate && !!selected && (isMissedMark || isAmountValid)

    const handlePeriodSelect = (index: number) => {
      setPaymentError('')
      setPaymentPeriod(index)
      const period = fin.periods.find((p) => p.index === index)
      if (period) setPaymentAmount(String(period.remaining))
    }

    return (
      <form onSubmit={handleSubmitDailyPayment} className="space-y-3.5 mt-1.5 flex flex-col flex-1 min-h-0">
        {paymentError && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700 shrink-0" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{paymentError}</span>
          </div>
        )}

        {isDailyLease && (
          <div className="inline-flex items-center p-0.5 rounded-full bg-slate-100 border border-stroke/40 shadow-2xs shrink-0 self-start">
            {(['Paid', 'Missed'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setPaymentError('')
                  setPaymentStatusType(opt)
                }}
                className={cn(
                  'px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
                  paymentStatusType === opt ? 'bg-[#960C01] text-white shadow-xs' : 'text-muted-fg hover:text-focus'
                )}
              >
                {opt === 'Paid' ? 'Record Payment' : 'Mark Day as Missed'}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start overflow-y-auto pr-1 flex-1 min-h-0">
          {/* Left: starting period and what it owes */}
          <div className="space-y-3.5">
            <div>
              <label htmlFor="payment-period" className="text-xs font-semibold text-focus block mb-1">
                {isMissedMark ? 'Day' : 'Pay Starting From'} <span className="text-red-500">*</span>
              </label>
              <select
                id="payment-period"
                value={selected ? selected.index : ''}
                onChange={(e) => handlePeriodSelect(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
              >
                {selectablePeriods.length === 0 && <option value="">Every period is fully paid</option>}
                {selectablePeriods.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.label} · due {p.dueDate} · {formatPHP(p.remaining)} left
                    {p.isOverdue ? ' · overdue' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10.5px] text-muted-fg mt-1">
                Fully paid periods are not listed. Any extra money flows forward into the next periods.
              </p>
            </div>

            {selected && (
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Period</span>
                  <span className="font-semibold text-focus">{selected.label}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Due date</span>
                  <span className={cn('font-mono font-semibold', selected.isOverdue ? 'text-rose-600' : 'text-focus')}>
                    {selected.dueDate}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Amount due{selected.penalty > 0 ? ' (with penalty)' : ''}</span>
                  <span className="font-semibold text-focus">{formatPHP(selected.amountDue)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Already paid</span>
                  <span className="font-semibold text-emerald-700">{formatPHP(selected.paid)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-200/60 pt-1.5">
                  <span className="font-bold text-focus">Still owed</span>
                  <span className="font-bold text-amber-700">{formatPHP(selected.remaining)}</span>
                </div>
              </div>
            )}

            {!isMissedMark && allocation.length > 0 && (
              <div className="p-3 border border-emerald-200/70 bg-emerald-50/50 rounded-xl space-y-1 text-xs max-h-36 overflow-y-auto pr-1" aria-live="polite">
                <div className="font-bold text-emerald-800 text-[11px] uppercase tracking-wider sticky top-0 bg-emerald-50/95 py-0.5">Where this payment goes</div>
                {allocation.map((line) => (
                  <div key={line.index} className="flex justify-between items-center text-xs">
                    <span className="text-focus truncate max-w-[150px]">
                      {line.label}
                      {line.kind === 'advance' && <span className="text-sky-700 font-semibold"> (adv)</span>}
                    </span>
                    <span className="font-semibold text-emerald-700 tabular-nums">{formatPHP(line.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: payment details */}
          <div className="space-y-2.5">
            <div>
              <label htmlFor="payment-date" className="text-xs font-semibold text-focus block mb-1">
                {isMissedMark ? 'Date Marked' : 'Payment Date'} <span className="text-red-500">*</span>
              </label>
              <Input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => {
                  setPaymentError('')
                  setPaymentDate(e.target.value)
                }}
                className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl"
              />
            </div>

            {isMissedMark ? (
              <div>
                <label className="text-xs font-semibold text-focus block mb-1">Reason</label>
                <Input
                  value={missedReason}
                  onChange={(e) => setMissedReason(e.target.value)}
                  className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl"
                />
                <p className="text-[10px] text-muted-fg mt-1">
                  The day stays owed. It can still be paid later.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="payment-amount" className="text-xs font-semibold text-focus">
                      Payment Amount (₱) <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[10.5px] text-muted-fg font-medium">Max: {formatPHP(maxAllowed)}</span>
                  </div>
                  <Input
                    id="payment-amount"
                    required
                    type="number"
                    min="0.01"
                    max={maxAllowed}
                    step="any"
                    value={paymentAmount}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => {
                      setPaymentError('')
                      setPaymentAmount(e.target.value)
                    }}
                    placeholder="Enter payment amount"
                    className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {paymentAmount && !isAmountValid && (
                    <p className="text-[10.5px] text-rose-600 mt-1">
                      {amountNum <= 0 || isNaN(amountNum)
                        ? 'Payment amount must be greater than 0.'
                        : `Lease has only ${formatPHP(maxAllowed)} left. Pick earlier period to pay more.`}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full h-9 sm:h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                  >
                    <option value="Cash">Cash</option>
                    <option value="GCash">GCash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">Receipt / Ref No.</label>
                  <Input
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="e.g. OR-JK-101"
                    className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl font-mono"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-semibold text-focus block mb-1">Remarks / Notes</label>
              <textarea
                rows={2}
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Enter remarks or notes..."
                className="w-full h-16 p-2.5 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none transition-all placeholder:text-muted-fg/60"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2.5 border-t border-slate-100 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsUpdatePaymentModalOpen(false)}
            className="h-9 sm:h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit || isSubmittingPayment}
            className="h-9 sm:h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center gap-2"
          >
            {isSubmittingPayment && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span>{isSubmittingPayment ? 'Saving...' : (isMissedMark ? 'Mark as Missed' : 'Review & Confirm Payment')}</span>
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-6 pb-10 max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {/* Server problems (spec 0017): the page never saves anything only in this browser */}
      {loadError && (
        <div
          className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start justify-between gap-3 text-xs text-amber-900"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
            <span>
              {loadError}{' '}
              {tenants.length > 0
                ? 'You are looking at the last copy that was loaded. Changes cannot be saved until the connection is back.'
                : 'No tenant leases could be loaded.'}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadTenants()}
            className="h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer shrink-0"
          >
            Try again
          </Button>
        </div>
      )}
      {actionError && (
        <div
          className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between gap-3 text-xs text-rose-700"
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError('')}
            className="text-rose-700 font-semibold hover:underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
      {viewMode === 'details' && activeTenant ? (
        renderDetailsPage()
      ) : (
        <>
          {/* 1. Header & Controls (Matching Sales & Expense pages) */}
      <div className="space-y-4">
        {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
              Tenants
            </h1>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Here's the summary of tenant leases and collections in JK Property and Ventures
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start shrink-0">
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
                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Download as CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPDF}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Download as PDF</span>
                  </button>
                </div>
              )}
            </div>

            {/* New Tenant Lease Button (Operational users) */}
            {!isAudit && !isOwner && (
              <Button
                type="button"
                onClick={handleOpenAdd}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>New Tenant Lease</span>
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
              placeholder="Search by tenant name, stall/unit, or tenant ID..."
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
                  isPeriodDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium text-focus/90">{selectedPeriod}</span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
                    isPeriodDropdownOpen && 'transform rotate-180'
                  )}
                />
              </button>

              {isPeriodDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
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

            {/* Status Dropdown: Paid, Unpaid and Pending Filter (Matching FilCap Lending Page) */}
            <div ref={statusDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  isStatusDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium text-focus/90">
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
                <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  {(['All', 'Paid', 'Unpaid', 'Pending'] as const).map((st) => (
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
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{st === 'All' ? 'All Status' : st}</span>
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
          </div>
        </div>
      </div>

      {/* 3. Summary Tenants Table (Following Sales & Expense layout) */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Table matching FilCap Lending layout: clean columns, no separate ID, dedicated Status, Audit & Actions */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[1000px]">
            <colgroup>
              <col style={{ width: '21%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="w-[21%] px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  TENANT&apos;S NAME
                </TableHead>
                <TableHead className="w-[13%] px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  RENT RATE
                </TableHead>
                <TableHead className="w-[15%] px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  TOTAL PAYABLE
                </TableHead>
                <TableHead className="w-[13%] px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  AMOUNT PAID
                </TableHead>
                <TableHead className="w-[14%] px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  REMAINING BALANCE
                </TableHead>
                <TableHead className="w-[9%] px-2.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                  STATUS
                </TableHead>
                <TableHead className="w-[9%] px-2.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                  AUDIT TAG
                </TableHead>
                <TableHead className="w-[6%] px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={8} />
              ) : paginatedTenants.length === 0 ? (
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
                        No tenant lease records found
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        There are no tenant leases recorded for JK Property and Ventures matching your current filters. {!isAudit && 'Click "New Tenant Lease" above to register a commercial lease.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTenants.map((tenant) => {
                  const fin = financialsById.get(tenant.id) ?? getTenantPeriodFinancials(tenant, todayStr)
                  const repeatingRow = isRepeating(tenant) && fin.periodCount > 0

                  const statusTextColor = {
                    Paid: 'text-emerald-700',
                    'Advance Paid': 'text-sky-700',
                    'Partially Paid': 'text-amber-700',
                    Missed: 'text-rose-700',
                    Overdue: 'text-[#960C01]',
                    Unpaid: 'text-slate-600',
                  }[fin.status] || 'text-slate-600'

                  return (
                    <TableRow
                      key={tenant.id}
                      id={`tenant-row-${tenant.id}`}
                      onClick={() => handleOpenDetail(tenant)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-200 cursor-pointer',
                        highlightedTenantId === tenant.id &&
                          'bg-amber-100/90 hover:bg-amber-100/90 ring-2 ring-amber-500 shadow-md font-semibold'
                      )}
                      title="Click to view complete details"
                    >
                      {/* 1. Tenant's Name (clean primary name text only) */}
                      <TableCell className="w-[21%] px-3.5 py-3 text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-focus truncate max-w-[240px]" title={tenant.tenantName}>
                            {tenant.tenantName}
                          </span>
                          {highlightedTenantId === tenant.id && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#960C01] text-white shadow-xs animate-bounce shrink-0">
                              NEW
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* 2. Rent Rate */}
                      <TableCell className="w-[13%] px-3.5 py-3 text-left font-semibold text-xs text-focus tabular-nums whitespace-nowrap">
                        <div>{formatPHP(tenant.rentAmount)}</div>
                      </TableCell>

                      {/* 3. Total Amount Payable */}
                      <TableCell className="w-[15%] px-3.5 py-3 text-left font-bold text-xs text-focus tabular-nums whitespace-nowrap">
                        <div>{formatPHP(fin.totalDue)}</div>
                      </TableCell>

                      {/* 4. Amount Paid */}
                      <TableCell className="w-[13%] px-3.5 py-3 text-left font-semibold text-xs text-emerald-600 tabular-nums whitespace-nowrap">
                        <div>{formatPHP(fin.amountPaid)}</div>
                      </TableCell>

                      {/* 5. Remaining Balance */}
                      <TableCell className="w-[14%] px-3.5 py-3 text-left font-bold text-xs tabular-nums whitespace-nowrap">
                        <div className={fin.remaining <= 0.005 ? 'text-emerald-600' : 'text-amber-600'}>
                          {formatPHP(fin.remaining)}
                        </div>
                      </TableCell>

                      {/* 6. Status (Clean colored text without background pill or border) */}
                      <TableCell className="w-[9%] px-2.5 py-3 text-center whitespace-nowrap">
                        <span className={cn('text-xs font-bold uppercase tracking-wider', statusTextColor)}>
                          {fin.status}
                        </span>
                      </TableCell>

                      {/* 7. Audit Tag (Visible to all authenticated roles) */}
                      <TableCell className="w-[9%] px-2.5 py-3 text-center whitespace-nowrap">
                        {(() => {
                          const isVerified = tenant.auditStatus === 'Verified'
                          const isFlagged = tenant.auditStatus === 'Flagged'

                          if (!isVerified && !isFlagged) {
                            return <span className="text-xs text-muted-fg/40 font-mono">-</span>
                          }

                          const tooltipLines: string[] = []
                          if (tenant.auditedBy && tenant.auditedBy !== '-') {
                            tooltipLines.push(`Audited by: ${formatRealName(tenant.auditedBy)}`)
                          }
                          if (tenant.auditDate) {
                            tooltipLines.push(`Date: ${tenant.auditDate}`)
                          }
                          if (tenant.auditRemarks) {
                            tooltipLines.push(`Remarks: ${tenant.auditRemarks}`)
                          }
                          const tooltip = tooltipLines.length > 0 ? tooltipLines.join('\n') : (isVerified ? 'Audited' : 'Discrepancy')

                          return (
                            <span
                              title={tooltip}
                              className={cn(
                                'text-xs font-bold uppercase tracking-wider whitespace-nowrap cursor-help',
                                isVerified ? 'text-emerald-700' : 'text-[#960C01]'
                              )}
                            >
                              {isVerified ? 'Audited' : 'Discrepancy'}
                            </span>
                          )
                        })()}
                      </TableCell>

                      {/* 8. Actions: 3 dots dropdown (Edit, Delete, Update for staff; Mark Audit / Flag Discrepancy for Auditor) */}
                      <TableCell
                        className="w-[6%] px-2 py-3 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isOwner ? (
                          <span className="text-muted-fg text-xs">-</span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (menuOpenTenantId === tenant.id) {
                                setMenuOpenTenantId(null)
                                setMenuPosition(null)
                              } else {
                                setActiveTenant(tenant)
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 190 > window.innerHeight
                                setMenuPosition({
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                                setMenuOpenTenantId(tenant.id)
                              }
                            }}
                            className="h-8 w-8 p-0 rounded-lg hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                            aria-label="Open actions menu"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* 4. Pagination Footer (Exact Sales & Expense matching) */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          {/* Left: Record summary */}
          <span className="font-medium text-focus/80">
            {filteredTenants.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredTenants.length} records`}
          </span>

          {/* Right: Page Indicator & Navigation */}
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
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
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
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Floating Actions Portal Menu (Fixed positioning without scroll offset bug) */}
      {menuOpenTenantId && menuPosition && activeTenant && (
        createPortal(
          <div
            ref={menuRef}
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            className="fixed w-48 bg-white rounded-2xl border border-stroke/30 shadow-xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {canAuditActions ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const t = activeTenant
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                    if (t) void saveAudit(t, 'Verified')
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Mark as Audit</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = activeTenant
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                    if (t) {
                      setActiveTenant(t)
                      setDiscrepancyReason('')
                      setIsDiscrepancyModalOpen(true)
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Mark as Discrepancy</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = activeTenant
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                    if (t) handleOpenDetail(t)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>View Details</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const t = activeTenant
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                    if (t) handleOpenDetail(t)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>View Details</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    handleOpenDailyPayment(activeTenant, e)
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CreditCard className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Update Rent Payment</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    handleOpenEdit(activeTenant, e)
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>Edit Lease</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    handleOpenDelete(activeTenant, e)
                    setMenuOpenTenantId(null)
                    setMenuPosition(null)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Delete Lease</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )
      )}
        </>
      )}

      {/* MODAL 1: New Tenant Lease (Matching system modal UI) */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[680px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal max-h-[85vh] overflow-y-auto">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-7">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
                <Store className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                  New Tenant Lease Agreement
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg font-normal mt-0.5">
                  Register a new commercial stall or office space tenant for JK Property and Ventures.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmitAdd} className="space-y-3.5 pt-3">
            {formErrors.form && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700" role="alert">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{formErrors.form}</span>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-focus block">
                Tenant / Lessee Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. Maria Santos (Santos Refreshments)"
                value={formData.tenantName}
                onChange={(e) => setFormData({ ...formData, tenantName: e.target.value })}
                className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.tenantName && 'border-red-500')}
              />
              {formErrors.tenantName && (
                <p className="text-[10px] text-red-600 font-medium">{formErrors.tenantName}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-focus block">
                Leased Unit / Stall Number <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. Stall 14 - Ground Floor Food Hall"
                value={formData.unitName}
                onChange={(e) => setFormData({ ...formData, unitName: e.target.value })}
                className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.unitName && 'border-red-500')}
              />
              {formErrors.unitName && (
                <p className="text-[10px] text-red-600 font-medium">{formErrors.unitName}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  Rent Amount (₱) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  step="any"
                  placeholder="30000"
                  value={formData.rentAmount}
                  onChange={(e) => {
                    const val = e.target.value
                    setFormData((prev) => ({
                      ...prev,
                      rentAmount: val,
                      totalAmountPayable: prev.repeat === 'None' ? val : prev.totalAmountPayable,
                    }))
                  }}
                  className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.rentAmount && 'border-red-500')}
                />
                {formErrors.rentAmount && (
                  <p className="text-[10px] text-red-600 font-medium">{formErrors.rentAmount}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  Total Payable (₱) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  step="any"
                  placeholder="35000"
                  readOnly={formData.repeat !== 'None'}
                  value={
                    formData.repeat !== 'None'
                      ? (() => {
                          const calc = getFormPayable()
                          return isNaN(calc) || calc <= 0 ? '' : String(calc)
                        })()
                      : formData.totalAmountPayable
                  }
                  onChange={(e) => setFormData({ ...formData, totalAmountPayable: e.target.value })}
                  className={cn(
                    'h-10 text-xs sm:text-sm rounded-xl border-stroke/50',
                    formData.repeat !== 'None' && 'bg-slate-50 text-muted-fg cursor-not-allowed',
                    formErrors.totalAmountPayable && 'border-red-500'
                  )}
                />
                {formData.repeat !== 'None' && (
                  <p className="text-[10px] text-muted-fg">Calculated: rent × number of payments.</p>
                )}
                {formErrors.totalAmountPayable && (
                  <p className="text-[10px] text-red-600 font-medium">{formErrors.totalAmountPayable}</p>
                )}
              </div>
            </div>

            <RepeatSelect
              value={formData.repeat}
              onChange={(repeat) => {
                const defaults = getDefaultDatesForRepeat(repeat, todayStr)
                setFormData((prev) => ({
                  ...prev,
                  repeat,
                  dueDate: defaults.dueDate,
                  leaseEndDate: defaults.leaseEndDate,
                  totalAmountPayable: repeat === 'None' ? prev.rentAmount : prev.totalAmountPayable,
                }))
              }}
              error={formErrors.repeat}
            />

            {/* Row 1: Date Contracted (left col) & Lease End Date (right col) (AC-8) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  Date Contracted <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={formData.contractDate}
                  onChange={(e) => setFormData({ ...formData, contractDate: e.target.value })}
                  className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.contractDate && 'border-red-500')}
                />
                {formErrors.contractDate && (
                  <p className="text-[10px] text-red-600 font-medium">{formErrors.contractDate}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  Lease End Date <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={formData.leaseEndDate}
                  onChange={(e) => setFormData({ ...formData, leaseEndDate: e.target.value })}
                  className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.leaseEndDate && 'border-red-500')}
                />
                {formErrors.leaseEndDate && (
                  <p className="text-[10px] text-red-600 font-medium">{formErrors.leaseEndDate}</p>
                )}
              </div>
            </div>

            {/* Row 2: First Due Date (left col) & Status (right col) (AC-9) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  First Due Date <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                  className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.dueDate && 'border-red-500')}
                />
                {formErrors.dueDate && (
                  <p className="text-[10px] text-red-600 font-medium">{formErrors.dueDate}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-1 focus:ring-focus"
                >
                  <option value="Active">Active</option>
                  <option value="Pending">Pending</option>
                  <option value="Overdue">Overdue</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-focus block">
                Notes / Remarks <span className="text-muted-fg font-normal">(Optional, up to 255 chars)</span>
              </label>
              <Input
                type="text"
                maxLength={255}
                placeholder="Optional lease terms or notes..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value.slice(0, 255) })}
                className="h-10 text-xs sm:text-sm rounded-xl border-stroke/50"
              />
              {formErrors.notes && (
                <p className="text-[10px] text-red-600 font-medium">{formErrors.notes}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsAddModalOpen(false)}
                className="h-10 px-4 text-xs font-medium rounded-xl border-stroke/50 hover:bg-slate-50 text-focus cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmittingAdd}
                className="h-10 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmittingAdd && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                <span>{isSubmittingAdd ? 'Saving...' : 'Create Lease'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: Edit Tenant Lease (Matching system modal UI) */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[680px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal max-h-[85vh] overflow-y-auto">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-7">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
                <Pencil className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                  Edit Tenant Lease Agreement
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg font-normal mt-0.5">
                  Update lease details for {activeTenant?.tenantName} ({activeTenant?.tenantId}).
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {(() => {
            const hasPayments = Boolean(
              activeTenant && (((activeTenant.dailyPayments?.length || 0) > 0) || ((activeTenant.amountPaid || 0) > 0))
            )
            return (
              <form onSubmit={handleSubmitEdit} className="space-y-3.5 pt-3">
                {formErrors.form && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700" role="alert">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{formErrors.form}</span>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-focus block">
                    Tenant / Lessee Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="text"
                    value={formData.tenantName}
                    onChange={(e) => setFormData({ ...formData, tenantName: e.target.value })}
                    className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.tenantName && 'border-red-500')}
                  />
                  {formErrors.tenantName && (
                    <p className="text-[10px] text-red-600 font-medium">{formErrors.tenantName}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-focus block">
                    Leased Unit / Stall Number <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="text"
                    value={formData.unitName}
                    onChange={(e) => setFormData({ ...formData, unitName: e.target.value })}
                    className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', formErrors.unitName && 'border-red-500')}
                  />
                  {formErrors.unitName && (
                    <p className="text-[10px] text-red-600 font-medium">{formErrors.unitName}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-focus block">
                      Rent Amount (₱) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      step="any"
                      readOnly={hasPayments}
                      disabled={hasPayments}
                      value={formData.rentAmount}
                      onChange={(e) => {
                        const val = e.target.value
                        setFormData((prev) => ({
                          ...prev,
                          rentAmount: val,
                          totalAmountPayable: prev.repeat === 'None' ? val : prev.totalAmountPayable,
                        }))
                      }}
                      className={cn(
                        'h-10 text-xs sm:text-sm rounded-xl border-stroke/50',
                        hasPayments && 'bg-slate-50 text-muted-fg cursor-not-allowed',
                        formErrors.rentAmount && 'border-red-500'
                      )}
                    />
                    {formErrors.rentAmount && (
                      <p className="text-[10px] text-red-600 font-medium">{formErrors.rentAmount}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-focus block">
                      Total Payable (₱) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      step="any"
                      readOnly={true}
                      disabled={hasPayments}
                      value={
                        formData.repeat !== 'None'
                          ? (() => {
                              const calc = getFormPayable()
                              return isNaN(calc) || calc <= 0 ? '' : String(calc)
                            })()
                          : formData.totalAmountPayable
                      }
                      onChange={(e) => setFormData({ ...formData, totalAmountPayable: e.target.value })}
                      className={cn(
                        'h-10 text-xs sm:text-sm rounded-xl border-stroke/50 bg-slate-50 text-muted-fg cursor-not-allowed',
                        formErrors.totalAmountPayable && 'border-red-500'
                      )}
                    />
                    {formErrors.totalAmountPayable && (
                      <p className="text-[10px] text-red-600 font-medium">{formErrors.totalAmountPayable}</p>
                    )}
                  </div>
                </div>

                <RepeatSelect
                  value={formData.repeat}
                  onChange={(repeat) => {
                    if (repeat === 'Daily') {
                      setFormData({ ...formData, repeat, dueDate: todayStr })
                    } else {
                      setFormData({ ...formData, repeat })
                    }
                  }}
                  disabled={hasPayments}
                  lockedReason={hasPayments ? 'Locked because payments are already recorded against this schedule.' : undefined}
                  error={formErrors.repeat}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-focus block">
                      Date Contracted <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="date"
                      readOnly={hasPayments}
                      disabled={hasPayments}
                      value={formData.contractDate}
                      onChange={(e) => setFormData({ ...formData, contractDate: e.target.value })}
                      className={cn(
                        'h-10 text-xs sm:text-sm rounded-xl border-stroke/50',
                        hasPayments && 'bg-slate-50 text-muted-fg cursor-not-allowed',
                        formErrors.contractDate && 'border-red-500'
                      )}
                    />
                    {formErrors.contractDate && (
                      <p className="text-[10px] text-red-600 font-medium">{formErrors.contractDate}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-focus block">
                      First Due Date <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="date"
                      value={formData.dueDate}
                      readOnly={hasPayments}
                      disabled={hasPayments}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                      className={cn(
                        'h-10 text-xs sm:text-sm rounded-xl border-stroke/50',
                        hasPayments && 'bg-slate-50 text-muted-fg cursor-not-allowed',
                        formErrors.dueDate && 'border-red-500'
                      )}
                    />
                    {formErrors.dueDate && (
                      <p className="text-[10px] text-red-600 font-medium">{formErrors.dueDate}</p>
                    )}
                  </div>
                </div>

                <RepeatDetails
                  repeat={formData.repeat}
                  disabled={hasPayments}
                  dueDate={formData.dueDate}
                  leaseEndDate={formData.leaseEndDate}
                  onEndDateChange={(leaseEndDate) => setFormData({ ...formData, leaseEndDate })}
                  errors={formErrors}
                />

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-focus block">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-1 focus:ring-focus"
                  >
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Overdue">Overdue</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-focus block">
                    Notes / Remarks <span className="text-muted-fg font-normal">(Optional, up to 255 chars)</span>
                  </label>
                  <Input
                    type="text"
                    maxLength={255}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value.slice(0, 255) })}
                    className="h-10 text-xs sm:text-sm rounded-xl border-stroke/50"
                  />
                  {formErrors.notes && (
                    <p className="text-[10px] text-red-600 font-medium">{formErrors.notes}</p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-stroke/20">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditModalOpen(false)}
                    className="h-10 px-4 text-xs font-medium rounded-xl border-stroke/50 hover:bg-slate-50 text-focus cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmittingEdit}
                    className="h-10 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isSubmittingEdit && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                    <span>{isSubmittingEdit ? 'Saving...' : 'Save Changes'}</span>
                  </Button>
                </div>
              </form>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* MODAL 3: Delete Confirmation Modal */}
      <ConfirmModal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        title="Delete Tenant Lease"
        description={
          <>
            Are you sure you want to delete the lease agreement for{' '}
            <strong className="text-focus">{activeTenant?.tenantName}</strong> ({activeTenant?.tenantId})?
            This action cannot be undone.
          </>
        }
        confirmLabel="Delete Lease"
        loadingLabel="Deleting..."
        variant="destructive"
        action="delete"
        isLoading={isSubmittingDelete}
        onConfirm={handleConfirmDelete}
      />

      {/* MODAL 4: Record / Edit Payment (Shared with FilCap Lending) */}
      {activeTenant && (() => {
        const tenantFin = getLeaseFinancials(activeTenant, todayStr)
        const editInitialData = editingRecord
          ? {
              id: editingRecord.id,
              paymentDate: editingRecord.date,
              targetInstallmentDate: (() => {
                const matchedPeriod = editingRecord.periodIndex
                  ? tenantFin.periods.find((per) => per.index === editingRecord.periodIndex)
                  : undefined
                return matchedPeriod ? matchedPeriod.dueDate : editingRecord.date
              })(),
              cycleIndex: editingRecord.periodIndex,
              amount: editingRecord.amount,
              method: editingRecord.method && editingRecord.method !== 'N/A' ? editingRecord.method : 'Cash',
              referenceNo: editingRecord.referenceNo && editingRecord.referenceNo !== 'MISSED' ? editingRecord.referenceNo : '',
              notes: editingRecord.notes || (editingRecord as any).remarks || '',
              status: editingRecord.status,
            }
          : null

        return (
          <SharedPaymentModal
            open={isUpdatePaymentModalOpen}
            onOpenChange={(isOpen) => {
              setIsUpdatePaymentModalOpen(isOpen)
              if (!isOpen) {
                setEditingRecord(null)
              }
            }}
            editInitialData={editInitialData}
            isAudit={isAudit}
            entityName={activeTenant.tenantName}
            entitySubtitle={activeTenant.unitName}
            accountTypeLabel="Lease"
            referenceNumber={activeTenant.tenantId || `TN-${activeTenant.id}`}
            paymentFrequency={activeTenant.repeat || 'Daily'}
            dailyTarget={activeTenant.rentAmount}
            remainingBalance={tenantFin.remaining}
            contractDate={activeTenant.contractDate}
            firstDueDate={activeTenant.dueDate}
            leaseEndDate={activeTenant.leaseEndDate}
            dueDate={activeTenant.leaseEndDate || activeTenant.dueDate}
            existingPayments={(activeTenant.dailyPayments || []).map((p) => {
              const matchedPeriod = p.periodIndex
                ? tenantFin.periods.find((per) => per.index === p.periodIndex)
                : undefined
              const cycleDueDate = matchedPeriod ? matchedPeriod.dueDate : p.date
              return {
                id: p.id,
                date: p.date,
                amount: p.amount,
                cycleDueDate,
                status: p.status,
              }
            })}
            monthlyProgress={
              activeTenant.repeat === 'Monthly'
                ? tenantFin.periods.map((p) => ({
                    monthIndex: p.index,
                    dueDate: p.dueDate,
                    target: p.amount,
                    paid: p.paid,
                    remaining: p.remaining,
                    status: p.status,
                    isOverdue: p.isOverdue,
                  }))
                : undefined
            }
            onSubmitPayment={async (subData) => {
              let periodIndex: number | undefined = undefined
              if (isRepeating(activeTenant)) {
                const matchedPeriod = tenantFin.periods.find(
                  (p) => p.dueDate === subData.targetInstallmentDate
                )
                if (matchedPeriod) {
                  periodIndex = matchedPeriod.index
                } else if (
                  typeof subData.cycleIndex === 'number' &&
                  subData.cycleIndex >= 1 &&
                  subData.cycleIndex <= tenantFin.periods.length
                ) {
                  periodIndex = subData.cycleIndex
                } else {
                  const fallbackPeriod =
                    tenantFin.periods.find((p) => p.remaining > 0.005) || tenantFin.periods[0]
                  if (fallbackPeriod) {
                    periodIndex = fallbackPeriod.index
                  }
                }
              }

              const input: PaymentInput = {
                date: subData.paymentDate,
                amount: subData.amount,
                method: subData.method,
                referenceNo: subData.referenceNo.trim() || undefined,
                notes: subData.notes.trim() || undefined,
                status: subData.status || 'Paid',
                periodIndex,
              }

              let updated: TenantLease
              if (editingRecord) {
                updated = await tenantService.updatePayment(activeTenant.id, editingRecord.id, input)
                showToast('Payment remittance updated successfully.')
              } else {
                updated = await tenantService.addPayment(activeTenant.id, input)
                showToast('Payment remittance recorded successfully.')
              }
              updated = await syncStatus(updated)
              applyLease(updated)
              setEditingRecord(null)
            }}
          />
        )
      })()}

      {/* Modal: Mark as Audited Confirmation */}
      <Dialog open={isAuditConfirmModalOpen} onOpenChange={setIsAuditConfirmModalOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-[24px] p-6 sm:p-7 border border-stroke/50 shadow-modal">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus">
                  Mark Lease as Audited
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Confirm that you have reviewed the lease terms, payments, and agreement for{' '}
                  <strong className="text-focus">{activeTenant?.tenantName}</strong> ({activeTenant?.unitName}).
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 space-y-1">
            <p className="font-semibold text-emerald-800">
              Audit Verification
            </p>
            <p className="text-[11px] text-emerald-700 leading-relaxed">
              This record will be officially stamped with your name and today's date. Once marked as audited, further modifications will reset the status to pending audit.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/30">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmittingAudit}
              onClick={() => setIsAuditConfirmModalOpen(false)}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSubmittingAudit}
              onClick={() => {
                if (activeTenant) void saveAudit(activeTenant, 'Verified')
              }}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              {isSubmittingAudit && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              <span>{isSubmittingAudit ? 'Saving...' : 'Confirm & Mark as Audited'}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Flag Discrepancy with Reason */}
      <Dialog open={isDiscrepancyModalOpen} onOpenChange={setIsDiscrepancyModalOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-[24px] p-6 sm:p-7 border border-stroke/50 shadow-modal">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus">
                  Flag Audit Discrepancy
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Please provide the reason or details of the discrepancy found on{' '}
                  <strong className="text-focus">{activeTenant?.tenantName}</strong>'s lease.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!discrepancyReason.trim() || !activeTenant) return
              void saveAudit(activeTenant, 'Flagged', discrepancyReason.trim())
            }}
            className="space-y-4 mt-2"
          >
            <div>
              <label className="text-xs font-semibold text-focus block mb-1">
                Discrepancy Reason / Remarks <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={4}
                value={discrepancyReason}
                onChange={(e) => setDiscrepancyReason(e.target.value)}
                placeholder="Describe the discrepancy, variance, or missing documents..."
                className="w-full p-3 rounded-xl border border-rose-300 bg-rose-50/20 text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-rose-500/20 resize-none transition-all placeholder:text-muted-fg/60"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/30">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingAudit}
                onClick={() => setIsDiscrepancyModalOpen(false)}
                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!discrepancyReason.trim() || isSubmittingAudit}
                className="h-10 px-5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmittingAudit && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                <span>{isSubmittingAudit ? 'Submitting...' : 'Confirm Discrepancy'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 6: Confirm removing a payment, or marking a period unpaid (spec 0016) */}
      <ConfirmModal
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={removeTarget?.kind === 'period' ? `Mark ${removeTarget.period.label} as Unpaid` : 'Remove Payment'}
        description={
          <>
            {removeTarget?.kind === 'period'
              ? `This removes ${removeTarget.records.length === 1 ? 'the payment' : `${removeTarget.records.length} payments`} that started at ${removeTarget.period.label}. The money goes back to unpaid.`
              : removeTarget
              ? `This removes the ${removeTarget.record.status === 'Missed' ? 'missed day mark' : `${formatPHP(removeTarget.record.amount)} payment`} dated ${removeTarget.record.date}. ${removeTarget.record.status === 'Missed' ? '' : 'The money goes back to unpaid.'}`
              : ''}
            {removeTarget?.kind === 'period' && removeTarget.affected.length > 0 && (
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 text-xs mt-3 text-left" aria-live="polite">
                <div className="font-bold text-focus">Periods that become less paid</div>
                {removeTarget.affected.map((a) => (
                  <div key={a.label} className="flex justify-between items-center">
                    <span className="text-focus">{a.label}</span>
                    <span className="font-semibold text-rose-600">-{formatPHP(a.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {activeTenant?.auditStatus && (activeTenant.auditStatus === 'Verified' || activeTenant.auditStatus === 'Flagged') && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-2 text-left">
                This lease is marked {activeTenant.auditStatus === 'Verified' ? 'Audited' : 'Flagged'}. This change sets it
                back to pending audit.
              </p>
            )}
          </>
        }
        confirmLabel={removeTarget?.kind === 'period' ? 'Mark as Unpaid' : 'Remove Payment'}
        loadingLabel="Deleting..."
        variant="destructive"
        action="delete"
        isLoading={isDeletingRecord}
        onConfirm={handleConfirmRemove}
      />
    </div>
  )
}
