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
  Eye,
  Building2,
  Calendar,
  Coins,
  Lock,
  Receipt,
  Loader2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
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
import { formatPHP } from '@/lib/format'
import { isDateInRange, formatToYYYYMMDD, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
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

// Tenant leases used to be kept in this browser. They are saved in the database now (spec 0017),
// so the old copy is deleted and never read.
removeLegacyTenantStorage()

const PERIOD_OPTIONS = ['All Periods', 'Daily', 'Monthly', 'Quarterly', 'Annually'] as const
type PeriodType = (typeof PERIOD_OPTIONS)[number]

const ITEMS_PER_PAGE = 10
const SCHEDULE_ITEMS_PER_PAGE = 10
const HISTORY_ITEMS_PER_PAGE = 5

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
  repeat: 'None',
  leaseEndDate: '',
  penaltyRate: '',
}

export const TenantPage: React.FC = () => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')

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
      setLoadError(err instanceof Error ? err.message : 'Could not load tenant leases.')
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
  const messageOf = (err: unknown): string => (err instanceof Error ? err.message : 'The change could not be saved.')

  // Audit review: saved on the server, which records who reviewed and when (spec 0017)
  const saveAudit = async (lease: TenantLease, status: 'Verified' | 'Flagged') => {
    setActionError('')
    try {
      applyLease(await tenantService.saveAuditReview(lease.id, status))
    } catch (err) {
      setActionError(messageOf(err))
    }
  }

  // Filter states
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'All' | 'Paid' | 'Unpaid' | 'Pending'>('All')
  const [detailTab, setDetailTab] = React.useState<'schedule' | 'history'>('schedule')
  const [detailSearchQuery, setDetailSearchQuery] = React.useState('')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodType>('Monthly')
  const [isSubmittingAdd, setIsSubmittingAdd] = React.useState(false)
  const [isSubmittingEdit, setIsSubmittingEdit] = React.useState(false)
  const [isSubmittingPayment, setIsSubmittingPayment] = React.useState(false)
  const [isSubmittingRecord, setIsSubmittingRecord] = React.useState(false)
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
  type RecordForm = {
    date: string
    amount: string
    method: string
    referenceNo: string
    notes: string
    periodIndex: number
    status: 'Paid' | 'Missed'
    missedReason: string
  }
  const [editingRecord, setEditingRecord] = React.useState<DailyRentRecord | null>(null)
  const [recordForm, setRecordForm] = React.useState<RecordForm>({
    date: '',
    amount: '',
    method: 'Cash',
    referenceNo: '',
    notes: '',
    periodIndex: 1,
    status: 'Paid',
    missedReason: 'Stall closed for the day',
  })
  const [recordError, setRecordError] = React.useState('')
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
    } else if (period === 'Quarterly') {
      const q = Math.ceil(mNum / 3)
      const qStartMonth = String((q - 1) * 3 + 1).padStart(2, '0')
      const qEndMonthNum = q * 3
      const qEndMonth = String(qEndMonthNum).padStart(2, '0')
      const qEndDay = new Date(yNum, qEndMonthNum, 0).getDate()
      setDateRange({
        startDate: `${currYear}-${qStartMonth}-01`,
        endDate: `${currYear}-${qEndMonth}-${String(qEndDay).padStart(2, '0')}`,
        label: `Q${q} ${currYear}`,
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
          const fin = getLeaseFinancials(tenant, todayStr)
          const isPaid = tenant.status === 'Completed' || (fin.remaining <= 0.005 && fin.amountPaid > 0)
          const isPending = tenant.status === 'Pending'
          const isUnpaid = !isPaid && !isPending

          if (statusFilter === 'Paid' && !isPaid) return false
          if (statusFilter === 'Unpaid' && !isUnpaid) return false
          if (statusFilter === 'Pending' && !isPending) return false
        }

        // Search check
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim()
          const matchesId = (tenant.tenantId || '').toLowerCase().includes(q)
          const matchesName = (tenant.tenantName || '').toLowerCase().includes(q)
          const matchesUnit = (tenant.unitName || '').toLowerCase().includes(q)
          const leaseFin = getLeaseFinancials(tenant, todayStr)
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
      .sort((a, b) => b.contractDate.localeCompare(a.contractDate))
  }, [tenants, statusFilter, searchQuery, dateRange, todayStr])

  // Reset to page 1 on filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, selectedPeriod, dateRange])

  // KPI calculations matching Sales & Expense
  // Lease totals per row, read through the schedule helper (stored values for leases that do not repeat)
  const financialsById = React.useMemo(() => {
    const map = new Map<string, LeaseFinancials>()
    filteredTenants.forEach((item) => map.set(item.id, getLeaseFinancials(item, todayStr)))
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
    setFormData({
      ...EMPTY_FORM,
      contractDate: formatToYYYYMMDD(new Date()),
    })
    setFormErrors({})
    setIsAddModalOpen(true)
  }

  // Open Edit Modal
  const handleOpenEdit = (tenant: TenantLease, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setActiveTenant(tenant)
    setFormData({
      tenantName: tenant.tenantName,
      unitName: tenant.unitName,
      rentAmount: tenant.rentAmount.toString(),
      dueDate: tenant.dueDate,
      contractDate: tenant.contractDate,
      totalAmountPayable: tenant.totalAmountPayable.toString(),
      status: tenant.status,
      notes: tenant.notes || '',
      repeat: tenant.repeat || 'None',
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
    if (!formData.tenantName.trim()) {
      errors.tenantName = 'Tenant Name is required.'
    }
    if (!formData.unitName.trim()) {
      errors.unitName = 'Leased Unit / Stall is required.'
    }
    if (!formData.contractDate) {
      errors.contractDate = 'Date Contracted is required.'
    }
    if (!formData.dueDate) {
      errors.dueDate = repeating ? 'First Due Date is required.' : 'Due Date is required.'
    }
    const rent = parseFloat(formData.rentAmount)
    if (isNaN(rent) || rent <= 0) {
      errors.rentAmount = 'Rent amount must be greater than 0.'
    }
    if (!repeating) {
      const payable = parseFloat(formData.totalAmountPayable || formData.rentAmount)
      if (isNaN(payable) || payable <= 0) {
        errors.totalAmountPayable = 'Total amount payable must be greater than 0.'
      }
    } else {
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

    // Edit locks that depend on payments already recorded (also stops turning repeat off or moving dates)
    // (Also covers turning a repeat on for an older lease: its saved payments must fit the new schedule.)
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

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!activeTenant) return
    try {
      await tenantService.deleteLease(activeTenant.id)
    } catch (err) {
      setActionError(messageOf(err))
      setIsDeleteModalOpen(false)
      return
    }
    setTenants((prev) => prev.filter((t) => t.id !== activeTenant.id))
    setIsDeleteModalOpen(false)
    setActiveTenant(null)
    setViewMode('list')
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
        input = {
          date: paymentDate,
          amount: amt,
          method: paymentMethod,
          referenceNo: paymentRef.trim() || undefined,
          notes: paymentNotes.trim() || 'Rent payment',
          status: 'Paid',
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
        notes: paymentNotes.trim() || 'Daily rent remittance',
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
    setRecordForm({
      date: record.date,
      amount: record.status === 'Missed' ? '' : String(record.amount || ''),
      method: record.method && record.method !== 'N/A' ? record.method : 'Cash',
      referenceNo: record.referenceNo && record.referenceNo !== 'MISSED' ? record.referenceNo : '',
      notes: record.status === 'Missed' && (record.notes || '').startsWith('Unpaid:') ? '' : record.notes || '',
      periodIndex: record.periodIndex || 1,
      status: record.status === 'Missed' ? 'Missed' : 'Paid',
      missedReason: record.missedReason || 'Stall closed for the day',
    })
    setRecordError('')
  }

  const handleSubmitEditRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmittingRecord) return
    if (!activeTenant || !editingRecord) return
    const lease = activeTenant
    const repeating = isRepeating(lease)
    // Missed marks exist on leases that do not repeat and on Daily leases only
    const canMarkMissed = !repeating || lease.repeat === 'Daily'
    const isMissed = recordForm.status === 'Missed' && canMarkMissed

    if (!recordForm.date) {
      setRecordError('Date is required.')
      return
    }
    let amount = 0
    if (!isMissed) {
      amount = round2(parseFloat(recordForm.amount))
      if (isNaN(amount) || amount <= 0) {
        setRecordError('Payment amount must be greater than 0.')
        return
      }
    }
    if (repeating) {
      const count = getLeaseFinancials(lease, todayStr).periodCount
      if (recordForm.periodIndex < 1 || recordForm.periodIndex > count) {
        setRecordError('Pick a period that is on this lease.')
        return
      }
    }

    const input: PaymentInput = {
      date: recordForm.date,
      amount,
      method: isMissed ? 'N/A' : recordForm.method,
      referenceNo: isMissed ? 'MISSED' : recordForm.referenceNo.trim() || undefined,
      notes: recordForm.notes.trim() || (isMissed ? `Unpaid: ${recordForm.missedReason}` : 'Rent payment'),
      status: isMissed ? 'Missed' : 'Paid',
      missedReason: isMissed ? recordForm.missedReason : undefined,
      periodIndex: repeating ? recordForm.periodIndex : undefined,
    }

    // Quick check before asking the server: refuse a change that would put more money on the lease than it owes
    const next: DailyRentRecord = { ...editingRecord, date: input.date, amount, status: input.status, periodIndex: input.periodIndex }
    const payments = lease.dailyPayments.map((r) => (r.id === editingRecord.id ? next : r))
    if (repeating) {
      const fin = getLeaseFinancials({ ...lease, dailyPayments: payments }, todayStr)
      if (round2(sumRecordedPayments(payments) - fin.amountPaid) > 0.005) {
        setRecordError(
          `This change puts more money on the lease than it owes. The most it can take is ${formatPHP(fin.totalDue)} in total.`
        )
        return
      }
    } else {
      const newPaid = round2(lease.amountPaid + moneyOf(payments) - moneyOf(lease.dailyPayments))
      if (newPaid > lease.totalAmountPayable + 0.005) {
        setRecordError(
          `This change puts more money on the lease than it owes. The most it can take is ${formatPHP(lease.totalAmountPayable)} in total.`
        )
        return
      }
    }

    try {
      let updated = await tenantService.updatePayment(lease.id, editingRecord.id, input)
      updated = await syncStatus(updated)
      applyLease(updated)
    } catch (err) {
      setRecordError(messageOf(err))
      return
    }
    setEditingRecord(null)
  }

  const handleConfirmRemove = async () => {
    if (!activeTenant || !removeTarget) return
    const ids =
      removeTarget.kind === 'record' ? [removeTarget.record.id] : removeTarget.records.map((r) => r.id)
    try {
      let updated = activeTenant
      for (const id of ids) {
        updated = await tenantService.deletePayment(activeTenant.id, id)
      }
      updated = await syncStatus(updated)
      applyLease(updated)
    } catch (err) {
      setActionError(messageOf(err))
      // Show what the server really has after a partly finished removal
      void loadTenants(true)
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
  const getDueDateText = (lease: TenantLease, fin: LeaseFinancials): string => {
    if (!isRepeating(lease) || fin.periodCount === 0) return `${lease.dueDate} (One Time)`
    if (!fin.nextPeriod) return 'Fully paid'
    return `${fin.nextPeriod.dueDate} (${fin.nextPeriod.label})`
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
      const fin = getFinancials(t)
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
        csvCell(t.status),
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
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${escapeHtml(t.status)}</td>
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

    const LEDGER_ITEMS_PER_PAGE = 8
    const SCHEDULE_ITEMS_PER_PAGE = 8
    const HISTORY_ITEMS_PER_PAGE = 8

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

    // Filter repeating history records
    const historyRecords = (activeTenant.dailyPayments || [])
      .slice()
      .sort((a, b) => {
        const byDate = (b.date || '').localeCompare(a.date || '')
        return byDate !== 0 ? byDate : (b.timestamp || '').localeCompare(a.timestamp || '')
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

    // Pagination for non-repeating ledger
    const totalLedgerPages = Math.max(1, Math.ceil(filteredLedger.length / LEDGER_ITEMS_PER_PAGE))
    const safeLedgerPage = Math.min(ledgerPage, totalLedgerPages)
    const paginatedLedger = filteredLedger.slice(
      (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE,
      safeLedgerPage * LEDGER_ITEMS_PER_PAGE
    )

    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        {/* Top navigation row */}
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setViewMode('list')}
            className="h-10 px-4 rounded-xl font-semibold text-xs sm:text-sm border border-stroke/60 bg-white text-focus hover:bg-surface flex items-center gap-2 cursor-pointer shadow-2xs self-start"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back to Tenants</span>
          </Button>
        </div>

        {/* Tenant & Lease Header (Matching FilCap Lending exactly) */}
        <div className="pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-focus tracking-tight">
                  {activeTenant.tenantName}
                </h1>
                {activeTenant.auditStatus && (
                  <span
                    className={cn(
                      'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider',
                      activeTenant.auditStatus === 'Verified'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20'
                    )}
                  >
                    {activeTenant.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Ref No: <strong className="text-focus font-mono">{activeTenant.tenantId || `TN-${activeTenant.id}`}</strong>
                </span>
                <span className="text-muted-fg/40">•</span>
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Unit / Stall: <strong className="text-focus">{activeTenant.unitName}</strong>
                </span>
                <span className="text-muted-fg/40">•</span>
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Schedule: <strong className="text-focus">{repeatingLease ? describeRepeat(activeTenant.repeat as LeaseRepeat, activeTenant.dueDate, fin.periodCount) : 'One-Time Lease'}</strong>
                </span>
                {activeTenant.leaseEndDate && (
                  <>
                    <span className="text-muted-fg/40">•</span>
                    <span className="text-xs sm:text-sm text-muted-fg font-medium">
                      Lease End: <strong className="text-focus font-mono">{activeTenant.leaseEndDate}</strong>
                    </span>
                  </>
                )}
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

              {!isAudit && (
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

              {isAudit && (
                <>
                  <Button
                    type="button"
                    onClick={() => void saveAudit(activeTenant, 'Verified')}
                    className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Mark as Audited</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveAudit(activeTenant, 'Flagged')}
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
            </div>
          </div>

          {/* Right Column: Full Width Payment History & Schedule Table */}
          <div className="lg:col-span-7 xl:col-span-8 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
            <div className="flex-1 flex flex-col space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Coins className="h-4 w-4 text-emerald-600 shrink-0" />
                  {repeatingLease ? (
                    <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-stroke/40 shadow-2xs">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailTab('schedule')
                          setLedgerPage(1)
                        }}
                        className={cn(
                          'px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer',
                          detailTab === 'schedule'
                            ? 'bg-[#960C01] text-white shadow-xs'
                            : 'text-muted-fg hover:text-focus'
                        )}
                      >
                        Payment Schedule ({filteredPeriods.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailTab('history')
                          setHistoryPage(1)
                        }}
                        className={cn(
                          'px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer',
                          detailTab === 'history'
                            ? 'bg-[#960C01] text-white shadow-xs'
                            : 'text-muted-fg hover:text-focus'
                        )}
                      >
                        Payment History ({historyRecords.length})
                      </button>
                    </div>
                  ) : (
                    <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                      Payment Schedule & History ({filteredLedger.length})
                    </h3>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
                  {/* Status Toggle: All, Paid, Pending */}
                  <div className="inline-flex items-center p-1 rounded-full bg-slate-100 border border-stroke/40 shadow-2xs">
                    {(['All', 'Paid', 'Pending'] as const).map((statusOpt) => {
                      const isActive = ledgerStatusFilter === statusOpt
                      return (
                        <button
                          key={statusOpt}
                          type="button"
                          onClick={() => {
                            setLedgerStatusFilter(statusOpt)
                            setLedgerPage(1)
                          }}
                          className={cn(
                            'px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
                            isActive ? 'bg-[#960C01] text-white shadow-xs' : 'text-muted-fg hover:text-focus'
                          )}
                        >
                          {statusOpt}
                        </button>
                      )
                    })}
                  </div>

                  {/* Search bar */}
                  <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-fg pointer-events-none" />
                    <Input
                      type="text"
                      value={detailSearchQuery}
                      onChange={(e) => {
                        setDetailSearchQuery(e.target.value)
                        setLedgerPage(1)
                        setHistoryPage(1)
                      }}
                      placeholder="Search dates..."
                      className="pl-8 pr-7 h-8 text-xs rounded-xl bg-slate-50 border-stroke/60 focus:bg-white"
                    />
                    {detailSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setDetailSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus text-xs p-0.5 cursor-pointer"
                        title="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Table Body Area */}
              <div className="flex-1 flex flex-col">
                {repeatingLease && detailTab === 'schedule' ? (
                  // Repeating Lease Schedule Periods Table
                  filteredPeriods.length === 0 ? (
                    <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                        <Coins className="w-7 h-7" />
                      </div>
                      <h4 className="text-sm font-bold text-focus">No Periods Found</h4>
                      <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                        No scheduled lease periods match your current status or search filter.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 flex-1">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-muted-fg font-semibold">
                          <tr>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Period</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Due Date</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Amount Due</th>
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Penalty</th>
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Paid</th>
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Remaining</th>
                            {!isAudit && (
                              <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Actions</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paginatedPeriods.map((period) => (
                            <tr
                              key={period.index}
                              className={cn(
                                'hover:bg-slate-50/70 transition-colors',
                                period.status === 'Advance Paid' && 'bg-sky-50/20',
                                period.status === 'Partially Paid' && 'bg-amber-50/20'
                              )}
                            >
                              <td className="py-2.5 px-3.5 font-medium text-focus whitespace-nowrap">
                                {period.label}
                              </td>
                              <td
                                className={cn(
                                  'py-2.5 px-3.5 font-mono whitespace-nowrap font-medium',
                                  period.isOverdue ? 'text-rose-600 font-semibold' : 'text-focus'
                                )}
                              >
                                {period.dueDate}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                                    PERIOD_STATUS_STYLES[period.status]
                                  )}
                                >
                                  {period.status === 'Paid' && <Check className="w-2.5 h-2.5 text-emerald-600 stroke-[3]" />}
                                  {period.status === 'Advance Paid' && <Lock className="w-2.5 h-2.5" />}
                                  {period.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold tabular-nums text-focus whitespace-nowrap">
                                {formatPHP(period.amountDue)}
                              </td>
                              <td className="py-2.5 px-3.5 text-right tabular-nums whitespace-nowrap">
                                {period.penalty > 0 ? (
                                  <span className="text-rose-600 font-semibold">{formatPHP(period.penalty)}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold tabular-nums whitespace-nowrap">
                                {period.paid > 0 ? (
                                  <span className={period.status === 'Advance Paid' ? 'text-sky-700' : 'text-emerald-700'}>
                                    {formatPHP(period.paid)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold tabular-nums text-amber-700 whitespace-nowrap">
                                {period.remaining > 0 ? formatPHP(period.remaining) : <span className="text-slate-400">—</span>}
                              </td>
                              {!isAudit && (
                                <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5 justify-center">
                                    {period.remaining > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleMarkPeriodPaid(period)}
                                        className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 cursor-pointer transition-colors"
                                        title={`Record a payment for ${period.label} (${formatPHP(period.remaining)} owed)`}
                                      >
                                        Mark as Paid
                                      </button>
                                    )}
                                    {(startedAtPeriod.get(period.index) || 0) > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => handleRequestMarkUnpaid(period)}
                                        className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 cursor-pointer transition-colors"
                                        title={`Remove the payments that started at ${period.label}`}
                                      >
                                        Mark as Unpaid
                                      </button>
                                    ) : period.status === 'Advance Paid' ? (
                                      <span className="text-[10px] text-muted-fg">Covered</span>
                                    ) : null}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : repeatingLease && detailTab === 'history' ? (
                  // Repeating Lease Payment History Table
                  historyRecords.length === 0 ? (
                    <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                        <Coins className="w-7 h-7" />
                      </div>
                      <h4 className="text-sm font-bold text-focus">No Payments Recorded Yet</h4>
                      <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                        This tenant has not started paying yet. All recorded payment transactions will appear here.
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
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Payment Date</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Starting Period</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Amount Paid</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Method</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Receipt / Ref No.</th>
                            <th className="py-2.5 px-3.5 text-left">Remarks</th>
                            {!isAudit && (
                              <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Actions</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paginatedHistory.map((rec) => (
                            <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                {rec.date}
                              </td>
                              <td className="py-2.5 px-3.5 text-focus whitespace-nowrap font-medium">
                                {rec.periodIndex ? periodLabelByIndex.get(rec.periodIndex) || `Period ${rec.periodIndex}` : '—'}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                {rec.status === 'Missed' ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                    <AlertCircle className="w-2.5 h-2.5 text-[#960C01]" />
                                    <span>Missed</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Check className="w-2.5 h-2.5 text-emerald-600 stroke-[3]" />
                                    <span>Paid</span>
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                                {formatPHP(rec.amount)}
                              </td>
                              <td className="py-2.5 px-3.5 text-focus whitespace-nowrap">
                                {rec.method || '—'}
                              </td>
                              <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap">
                                {rec.referenceNo || '—'}
                              </td>
                              <td className="py-2.5 px-3.5 text-muted-fg max-w-[200px] truncate" title={rec.notes}>
                                {rec.notes || '—'}
                              </td>
                              {!isAudit && (
                                <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1 justify-center">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditRecord(rec)}
                                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer transition-colors"
                                      title="Edit this payment"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRemoveTarget({ kind: 'record', record: rec })}
                                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer transition-colors"
                                      title="Remove this payment"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  // Non-repeating Unified Ledger Table
                  filteredLedger.length === 0 ? (
                    <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                        <Coins className="w-7 h-7" />
                      </div>
                      <h4 className="text-sm font-bold text-focus">No Records Found</h4>
                      <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                        No payment or schedule records match your filter criteria.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 flex-1">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-muted-fg font-semibold">
                          <tr>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Payment Date</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Amount Paid</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Method</th>
                            <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Receipt / Ref No.</th>
                            <th className="py-2.5 px-3.5 text-left">Remarks</th>
                            {!isAudit && (
                              <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Actions</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paginatedLedger.map((entry) => (
                            <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                {entry.date}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                                    entry.status === 'Paid'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  )}
                                >
                                  {entry.status === 'Paid' && <Check className="w-2.5 h-2.5 stroke-[3] text-emerald-600" />}
                                  {entry.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-bold tabular-nums whitespace-nowrap">
                                {entry.amount > 0 ? (
                                  <span className="text-emerald-700">{formatPHP(entry.amount)}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-focus whitespace-nowrap">
                                {entry.method || '—'}
                              </td>
                              <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap">
                                {entry.referenceNo || '—'}
                              </td>
                              <td className="py-2.5 px-3.5 text-muted-fg max-w-[200px] truncate" title={entry.notes}>
                                {entry.notes || '—'}
                              </td>
                              {!isAudit && (
                                <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                                  {entry.recordId ? (
                                    <div className="inline-flex items-center gap-1 justify-center">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const rec = activeTenant.dailyPayments.find((r) => r.id === entry.recordId)
                                          if (rec) handleOpenEditRecord(rec)
                                        }}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer transition-colors"
                                        title="Edit this payment"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const rec = activeTenant.dailyPayments.find((r) => r.id === entry.recordId)
                                          if (rec) setRemoveTarget({ kind: 'record', record: rec })
                                        }}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer transition-colors"
                                        title="Remove this payment"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Pagination Footer (matching FilCap Lending) */}
            <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
              <span className="font-medium text-focus/80">
                {repeatingLease && detailTab === 'schedule'
                  ? filteredPeriods.length === 0
                    ? 'Showing 0-0 of 0 periods'
                    : `Showing ${(safeSchedulePage - 1) * SCHEDULE_ITEMS_PER_PAGE + 1}-${Math.min(safeSchedulePage * SCHEDULE_ITEMS_PER_PAGE, filteredPeriods.length)} of ${filteredPeriods.length} periods`
                  : repeatingLease && detailTab === 'history'
                  ? historyRecords.length === 0
                    ? 'Showing 0-0 of 0 records'
                    : `Showing ${(safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE + 1}-${Math.min(safeHistoryPage * HISTORY_ITEMS_PER_PAGE, historyRecords.length)} of ${historyRecords.length} records`
                  : filteredLedger.length === 0
                  ? 'Showing 0-0 of 0 records'
                  : `Showing ${(safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE + 1}-${Math.min(safeLedgerPage * LEDGER_ITEMS_PER_PAGE, filteredLedger.length)} of ${filteredLedger.length} records`}
              </span>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className="text-xs text-muted-fg font-medium">
                  Page{' '}
                  {repeatingLease && detailTab === 'schedule'
                    ? safeSchedulePage
                    : repeatingLease && detailTab === 'history'
                    ? safeHistoryPage
                    : safeLedgerPage}{' '}
                  out of{' '}
                  {repeatingLease && detailTab === 'schedule'
                    ? totalSchedulePages
                    : repeatingLease && detailTab === 'history'
                    ? totalHistoryPages
                    : totalLedgerPages}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    repeatingLease && detailTab === 'schedule'
                      ? safeSchedulePage <= 1
                      : repeatingLease && detailTab === 'history'
                      ? safeHistoryPage <= 1
                      : safeLedgerPage <= 1
                  }
                  onClick={() => {
                    if (repeatingLease && detailTab === 'schedule') {
                      setLedgerPage((p) => Math.max(1, p - 1))
                    } else if (repeatingLease && detailTab === 'history') {
                      setHistoryPage((p) => Math.max(1, p - 1))
                    } else {
                      setLedgerPage((p) => Math.max(1, p - 1))
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
                    repeatingLease && detailTab === 'schedule'
                      ? safeSchedulePage >= totalSchedulePages
                      : repeatingLease && detailTab === 'history'
                      ? safeHistoryPage >= totalHistoryPages
                      : safeLedgerPage >= totalLedgerPages
                  }
                  onClick={() => {
                    if (repeatingLease && detailTab === 'schedule') {
                      setLedgerPage((p) => Math.min(totalSchedulePages, p + 1))
                    } else if (repeatingLease && detailTab === 'history') {
                      setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))
                    } else {
                      setLedgerPage((p) => Math.min(totalLedgerPages, p + 1))
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
        </div>
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
                <Download className={cn('h-4 w-4 shrink-0', isAudit ? 'text-white' : 'text-focus/70')} />
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
            {!isAudit && (
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
                <Calendar className="h-4 w-4 text-muted-fg shrink-0" />
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

      {/* 2. Total Tenant Receivables KPI Card (Exact UI match with Sales & Expense) */}
      <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
        <div className="w-full max-w-[calc(100%-60px)]">
          <span className="text-xs font-medium text-muted-fg block">
            Total Tenant Receivables
          </span>
          <h3 className="text-xl sm:text-2xl font-bold text-emerald-600 mt-1 tabular-nums tracking-tight">
            {formatPHP(totalReceivables)}
          </h3>
          <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
            Collected: <span className="font-medium text-emerald-600">{formatPHP(totalCollected)}</span> · Remaining Balance: <span className="font-medium text-amber-600">{formatPHP(totalRemaining)}</span> ({filteredTenants.length} active tenant leases) in JK Property and Ventures
          </p>
        </div>

        <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-600 shrink-0 shadow-2xs">
          <Store className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </Card>

      {/* 3. Summary Tenants Table (Following Sales & Expense layout) */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Table matching Sales/Expense formatting */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[1050px]">
            <colgroup>
              <col style={{ width: '13%' }} />
              <col style={{ width: '21%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TENANT ID
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TENANT & UNIT
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  RENT RATE
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CONTRACT DATE
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  DUE DATE
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TOTAL PAYABLE
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  AMOUNT PAID
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  BALANCE
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {paginatedTenants.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-14 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                        <AlertCircle className="w-6 h-6 stroke-[1.5]" />
                      </div>
                      <p className="font-semibold text-focus text-sm sm:text-base">
                        {isLoading ? 'Loading tenant leases...' : 'No tenant lease records found'}
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        {isLoading
                          ? 'Getting the leases from the database.'
                          : (
                            <>
                              There are no tenant leases recorded for JK Property and Ventures matching your current filters. {!isAudit && 'Click "New Tenant Lease" above to register a commercial lease.'}
                            </>
                          )}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTenants.map((tenant) => {
                  const fin = financialsById.get(tenant.id) ?? getFinancials(tenant)
                  const repeatingRow = isRepeating(tenant) && fin.periodCount > 0
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
                    {/* 1. Tenant ID */}
                    <TableCell className="px-3.5 py-3.5 text-xs font-semibold text-focus truncate text-left">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-[#960C01] font-bold">{tenant.tenantId}</span>
                        {highlightedTenantId === tenant.id && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#960C01] text-white shadow-xs animate-bounce shrink-0">
                            NEW
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* 2. Tenant & Unit */}
                    <TableCell className="px-3.5 py-3.5 text-xs font-medium text-focus truncate text-left" title={tenant.tenantName}>
                      <div className="truncate font-semibold text-focus">{tenant.tenantName}</div>
                      <div className="text-[11px] text-muted-fg flex items-center gap-1 mt-0.5 truncate">
                        <Store className="w-3 h-3 text-muted-fg/70 shrink-0" />
                        <span className="truncate">{tenant.unitName}</span>
                      </div>
                    </TableCell>

                    {/* 3. Rent Rate */}
                    <TableCell className="px-3.5 py-3.5 text-xs font-semibold text-left tabular-nums whitespace-nowrap text-focus">
                      {formatPHP(tenant.rentAmount)}
                    </TableCell>

                    {/* 4. Contract Date */}
                    <TableCell className="px-3.5 py-3.5 text-xs text-focus/90 text-left whitespace-nowrap">
                      {tenant.contractDate}
                    </TableCell>

                    {/* 5. Due Date (next unpaid period for a repeating lease) */}
                    <TableCell className="px-3.5 py-3.5 text-xs text-focus/90 text-left whitespace-nowrap">
                      {repeatingRow ? (
                        fin.nextPeriod ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span
                              className={cn(
                                'font-semibold',
                                fin.nextPeriod.isOverdue ? 'text-rose-600' : 'text-focus'
                              )}
                            >
                              {fin.nextPeriod.dueDate}
                            </span>
                            <span
                              className={cn(
                                'text-[10px]',
                                fin.nextPeriod.isOverdue ? 'text-rose-600 font-semibold' : 'text-muted-fg'
                              )}
                            >
                              {fin.nextPeriod.label}
                              {fin.nextPeriod.isOverdue ? ' · Overdue' : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-emerald-700 bg-emerald-50">
                            Fully paid
                          </span>
                        )
                      ) : (
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="font-semibold text-focus">{tenant.dueDate}</span>
                          <span className="text-[10px] text-muted-fg">One Time</span>
                        </div>
                      )}
                    </TableCell>

                    {/* 6. Total Payable */}
                    <TableCell className="px-3.5 py-3.5 text-xs font-bold text-left tabular-nums whitespace-nowrap text-focus">
                      {formatPHP(fin.totalDue)}
                    </TableCell>

                    {/* 7. Amount Paid */}
                    <TableCell className="px-3.5 py-3.5 text-xs font-semibold text-left tabular-nums whitespace-nowrap text-emerald-600">
                      {formatPHP(fin.amountPaid)}
                    </TableCell>

                    {/* 8. Balance & Status */}
                    <TableCell className="px-3.5 py-3.5 text-xs text-left tabular-nums whitespace-nowrap">
                      <div className="font-bold text-amber-600">{formatPHP(fin.remaining)}</div>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                            (tenant.status === 'Completed' || fin.remaining <= 0.005)
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : tenant.status === 'Pending'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : tenant.status === 'Overdue'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-rose-50/80 text-rose-600 border-rose-200'
                          )}
                        >
                          {tenant.status === 'Completed' || fin.remaining <= 0.005
                            ? 'Paid'
                            : tenant.status === 'Pending'
                            ? 'Pending'
                            : tenant.status === 'Overdue'
                            ? 'Overdue'
                            : 'Unpaid'}
                        </span>
                        {tenant.auditStatus && (
                          <div className="flex items-center gap-1">
                            <span
                              className={cn(
                                'inline-block px-1.5 py-0.2 rounded text-[9.5px] font-bold border',
                                tenant.auditStatus === 'Verified'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              )}
                            >
                              {tenant.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                            </span>
                          </div>
                        )}
                        {tenant.auditDate && (
                          <span className="text-[9.5px] text-muted-fg font-mono">
                            {tenant.auditDate}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* 9. Actions */}
                    <TableCell
                      className="px-3.5 py-3.5 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (menuOpenTenantId === tenant.id) {
                            setMenuOpenTenantId(null)
                            setMenuPosition(null)
                            return
                          }
                          const rect = e.currentTarget.getBoundingClientRect()
                          const windowHeight = window.innerHeight
                          const spaceBelow = windowHeight - rect.bottom
                          const openUpward = spaceBelow < 180
                          setMenuPosition({
                            top: openUpward ? rect.top - 6 : rect.bottom + 6,
                            right: Math.max(16, window.innerWidth - rect.right),
                            openUpward,
                          })
                          setActiveTenant(tenant)
                          setMenuOpenTenantId(tenant.id)
                        }}
                        className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer mx-auto flex items-center justify-center transition-colors"
                        title="Actions"
                        aria-label="Tenant actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
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
              top: menuPosition.top,
              right: menuPosition.right,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : undefined,
            }}
            className="fixed w-48 bg-white rounded-2xl border border-stroke/30 shadow-xl p-1.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {isAudit ? (
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
                    if (t) void saveAudit(t, 'Flagged')
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
        <DialogContent className="sm:max-w-[680px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-7">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
                <Store className="w-4 h-4 text-white" />
              </div>
              <DialogTitle className="text-base sm:text-lg font-bold text-focus leading-tight">
                New Tenant Lease Agreement
              </DialogTitle>
            </div>
            <DialogDescription className="text-[11px] text-muted-fg font-normal mt-1">
              Register a new commercial stall or office space tenant for JK Property and Ventures.
            </DialogDescription>
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
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  {formData.repeat !== 'None' ? 'First Due Date' : 'Due Date'} <span className="text-red-500">*</span>
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
            </div>

            <RepeatDetails
              repeat={formData.repeat}
              dueDate={formData.dueDate}
              leaseEndDate={formData.leaseEndDate}
              penaltyRate={formData.penaltyRate}
              rentAmount={formData.rentAmount}
              onEndDateChange={(leaseEndDate) => setFormData({ ...formData, leaseEndDate })}
              onPenaltyRateChange={(penaltyRate) => setFormData({ ...formData, penaltyRate })}
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
              <label className="text-xs font-semibold text-focus block">Notes / Remarks</label>
              <Input
                type="text"
                placeholder="Optional lease terms or notes..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="h-10 text-xs sm:text-sm rounded-xl border-stroke/50"
              />
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
        <DialogContent className="sm:max-w-[680px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-7">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
                <Pencil className="w-4 h-4 text-white" />
              </div>
              <DialogTitle className="text-base sm:text-lg font-bold text-focus leading-tight">
                Edit Tenant Lease Agreement
              </DialogTitle>
            </div>
            <DialogDescription className="text-[11px] text-muted-fg font-normal mt-1">
              Update lease details for {activeTenant?.tenantName} ({activeTenant?.tenantId}).
            </DialogDescription>
          </DialogHeader>

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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  Rent Amount (₱) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  step="any"
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
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-focus block">
                  Total Payable (₱) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  step="any"
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

            {(() => {
              // Once payments are tied to periods, Repeat and First Due Date are locked (AC-14)
              const periodsLocked = !!activeTenant && hasPeriodRecords(activeTenant)
              return (
                <>
                  <RepeatSelect
                    value={formData.repeat}
                    onChange={(repeat) => {
                      if (repeat === 'Daily') {
                        setFormData({ ...formData, repeat, dueDate: todayStr })
                      } else {
                        setFormData({ ...formData, repeat })
                      }
                    }}
                    disabled={periodsLocked}
                    lockedReason="Locked because payments are already recorded against this schedule."
                    error={formErrors.repeat}
                  />

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
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-focus block">
                        {formData.repeat !== 'None' ? 'First Due Date' : 'Due Date'} <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="date"
                        value={formData.dueDate}
                        disabled={periodsLocked}
                        onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                        className={cn(
                          'h-10 text-xs sm:text-sm rounded-xl border-stroke/50 disabled:opacity-60 disabled:cursor-not-allowed',
                          formErrors.dueDate && 'border-red-500'
                        )}
                      />
                      {formErrors.dueDate && (
                        <p className="text-[10px] text-red-600 font-medium">{formErrors.dueDate}</p>
                      )}
                    </div>
                  </div>
                </>
              )
            })()}

            <RepeatDetails
              repeat={formData.repeat}
              dueDate={formData.dueDate}
              leaseEndDate={formData.leaseEndDate}
              penaltyRate={formData.penaltyRate}
              rentAmount={formData.rentAmount}
              onEndDateChange={(leaseEndDate) => setFormData({ ...formData, leaseEndDate })}
              onPenaltyRateChange={(penaltyRate) => setFormData({ ...formData, penaltyRate })}
              errors={formErrors}
            />

            {(formErrors.rentAmount || formErrors.totalAmountPayable) && formData.repeat !== 'None' && (
              <p className="text-[11px] text-red-600 font-medium">{formErrors.rentAmount || formErrors.totalAmountPayable}</p>
            )}

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
              <label className="text-xs font-semibold text-focus block">Notes / Remarks</label>
              <Input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="h-10 text-xs sm:text-sm rounded-xl border-stroke/50"
              />
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
        </DialogContent>
      </Dialog>

      {/* MODAL 3: Delete Confirmation Modal (Matching Sales / Expense pages) */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[560px] rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="text-center sm:text-left">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mb-3 mx-auto sm:mx-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-focus">
              Delete Tenant Lease
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-1">
              Are you sure you want to delete the lease agreement for{' '}
              <strong className="text-focus">{activeTenant?.tenantName}</strong> ({activeTenant?.tenantId})?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDeleteModalOpen(false)}
              className="h-9 px-4 text-xs font-medium rounded-xl border-stroke/50 hover:bg-slate-50 text-focus cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmDelete}
              className="h-9 px-5 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-xs"
            >
              Delete Lease
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: Record Payment (Two-Column Layout Matching Lending Page) */}
      <Dialog open={isUpdatePaymentModalOpen} onOpenChange={setIsUpdatePaymentModalOpen}>
        <DialogContent className="sm:max-w-[840px] md:max-w-[890px] max-h-[85vh] sm:max-h-[82vh] flex flex-col bg-white rounded-[24px] p-5 sm:p-6 shadow-2xl overflow-hidden">
          <DialogHeader className="shrink-0 pb-2.5 border-b border-stroke/20 pr-8">
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-600" />
              <span>Record Payment</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-0.5">
              Record payment remittance for{' '}
              <strong className="text-focus">{activeTenant?.tenantName}</strong> ({activeTenant?.unitName}).
            </DialogDescription>
          </DialogHeader>

          {activeTenant && isRepeating(activeTenant) && renderRepeatPaymentForm(activeTenant)}

          {activeTenant && !isRepeating(activeTenant) && (() => {
            const dailyTarget = Math.max(500, Math.round(activeTenant.rentAmount / 30))
            const maxAllowed = activeTenant.remainingBalance
            const currentPaymentNum = parseFloat(paymentAmount)
            const isAmountValid =
              !isNaN(currentPaymentNum) &&
              currentPaymentNum >= 1 &&
              currentPaymentNum <= maxAllowed

            const alreadyPaidOnSelectedDate = (activeTenant.dailyPayments || [])
              .filter((p) => p.date === paymentDate && p.status !== 'Missed')
              .reduce((sum, p) => sum + (p.amount || 0), 0)

            const isDateAlreadySettled =
              alreadyPaidOnSelectedDate >= dailyTarget - 0.005 && dailyTarget > 0

            const periodRemainingDue = Math.min(
              maxAllowed,
              Math.max(0, Math.round((dailyTarget - alreadyPaidOnSelectedDate) * 100) / 100)
            )

            const willBePartiallyPaid =
              isAmountValid &&
              currentPaymentNum < periodRemainingDue - 0.005 &&
              maxAllowed - currentPaymentNum > 0.005

            return (
              <form onSubmit={handleSubmitDailyPayment} className="space-y-3.5 mt-1.5 flex flex-col flex-1 min-h-0">
                {paymentError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700 shrink-0">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{paymentError}</span>
                  </div>
                )}

                {isDateAlreadySettled && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl space-y-1 text-xs text-amber-900 shrink-0">
                    <div className="flex items-center gap-1.5 font-bold text-amber-800">
                      <Lock className="w-4 h-4 shrink-0 text-amber-600" />
                      <span>Date Already Settled ({paymentDate})</span>
                    </div>
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      Full rent payment for this calendar date has already been recorded and locked. Please select an unpaid or partially paid date from the calendar on the left.
                    </p>
                  </div>
                )}

                {/* Two-Column Layout: Left = Calendar, Right = Payment Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start overflow-y-auto pr-1 flex-1 min-h-0">
                  {/* Left Column: Interactive Calendar Date Picker */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-focus">
                        Payment Date <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[11px] font-mono font-bold text-focus">
                        {paymentDate ? `Selected: ${paymentDate}` : 'Please select date'}
                      </span>
                    </div>

                    <div className="border border-stroke/60 rounded-xl p-3 bg-white space-y-2">
                      {/* Month Header & Controls */}
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-focus">
                          {paymentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const prev = new Date(paymentCalendarMonth)
                              prev.setMonth(prev.getMonth() - 1)
                              setPaymentCalendarMonth(prev)
                            }}
                            className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                            aria-label="Previous month"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Date(paymentCalendarMonth)
                              next.setMonth(next.getMonth() + 1)
                              setPaymentCalendarMonth(next)
                            }}
                            className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                            aria-label="Next month"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Weekday labels */}
                      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-fg uppercase py-0.5 border-b border-slate-100">
                        <span>Su</span>
                        <span>Mo</span>
                        <span>Tu</span>
                        <span>We</span>
                        <span>Th</span>
                        <span>Fr</span>
                        <span>Sa</span>
                      </div>

                      {/* Days Grid */}
                      {(() => {
                        const calYear = paymentCalendarMonth.getFullYear()
                        const calMonth = paymentCalendarMonth.getMonth()
                        const firstDay = new Date(calYear, calMonth, 1).getDay()
                        const totalDays = new Date(calYear, calMonth + 1, 0).getDate()

                        const paidByDateMap = new Map<string, number>()
                        ;(activeTenant.dailyPayments || []).forEach((p) => {
                          if (!p.date || p.status === 'Missed') return
                          paidByDateMap.set(p.date, (paidByDateMap.get(p.date) || 0) + (p.amount || 0))
                        })

                        const startContract = activeTenant.contractDate || ''

                        return (
                          <div className="grid grid-cols-7 gap-1 text-center">
                            {Array.from({ length: firstDay }).map((_, i) => (
                              <div key={`cal-empty-${i}`} className="h-8" />
                            ))}

                            {Array.from({ length: totalDays }).map((_, i) => {
                              const d = i + 1
                              const dStr = String(d).padStart(2, '0')
                              const mStr = String(calMonth + 1).padStart(2, '0')
                              const dateStr = `${calYear}-${mStr}-${dStr}`

                              const isBefore = startContract ? dateStr < startContract : false
                              const paidOnDate = paidByDateMap.get(dateStr) || 0
                              const isPaid = paidOnDate >= dailyTarget - 0.005 && dailyTarget > 0
                              const isPartial = !isPaid && paidOnDate > 0
                              const isSelected = paymentDate === dateStr
                              const isDisabled = isBefore || isPaid

                              return (
                                <button
                                  key={dateStr}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => {
                                    if (!isDisabled) {
                                      setPaymentError('')
                                      setPaymentDate(dateStr)
                                    }
                                  }}
                                  className={cn(
                                    'h-8 rounded-lg text-xs font-medium flex flex-col items-center justify-center relative transition-all',
                                    isSelected &&
                                      'bg-[#960C01] text-white font-bold shadow-xs ring-2 ring-[#960C01]/30 z-10',
                                    !isSelected &&
                                      isPaid &&
                                      'bg-emerald-50 text-emerald-700 border border-emerald-200/80 cursor-not-allowed opacity-90',
                                    !isSelected &&
                                      isPartial &&
                                      'bg-amber-50 text-amber-800 border border-amber-300 cursor-pointer font-semibold',
                                    !isSelected &&
                                      isBefore &&
                                      'text-slate-300 cursor-not-allowed bg-slate-50/50',
                                    !isSelected &&
                                      !isPaid &&
                                      !isPartial &&
                                      !isBefore &&
                                      'hover:bg-slate-100 text-focus cursor-pointer hover:font-bold border border-transparent'
                                  )}
                                  title={
                                    isPaid
                                      ? `${dateStr}: Fully Paid & Locked`
                                      : isBefore
                                      ? `${dateStr}: Prior to contract date`
                                      : isPartial
                                      ? `${dateStr}: Partially Paid (${formatPHP(paidOnDate)})`
                                      : `Select ${dateStr}`
                                  }
                                >
                                  <span>{d}</span>
                                  {isPaid && <Check className="h-2 w-2 text-emerald-600 -mt-0.5" />}
                                  {isPartial && !isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute bottom-0.5" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}

                      {/* Calendar Legend */}
                      <div className="flex flex-wrap items-center justify-between text-[10px] text-muted-fg pt-1.5 border-t border-slate-100 gap-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-[#960C01] inline-block" /> Selected
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Partial
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Payment Amount, Payment Method, Receipt No., Remarks/Notes */}
                  <div className="space-y-2.5">
                    {/* Payment Amount Input */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-focus">
                          Payment Amount (₱) <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[10.5px] text-muted-fg font-medium">
                          Target: {formatPHP(periodRemainingDue)} • Max: {formatPHP(maxAllowed)}
                        </span>
                      </div>
                      <Input
                        required
                        type="number"
                        min="1"
                        max={maxAllowed}
                        step="any"
                        value={paymentAmount}
                        onWheel={(e) => e.currentTarget.blur()}
                        onChange={(e) => {
                          setPaymentError('')
                          setPaymentStatusType('Paid')
                          setPaymentAmount(e.target.value)
                        }}
                        placeholder="Enter payment amount"
                        className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      {paymentAmount && !isAmountValid && (
                        <p className="text-[10.5px] text-rose-600 mt-1">
                          {currentPaymentNum < 1
                            ? 'Payment amount cannot be lower than ₱1.00.'
                            : `Payment amount cannot exceed ${formatPHP(maxAllowed)}.`}
                        </p>
                      )}
                      {isAmountValid && (
                        <div className="mt-1.5 flex items-center justify-between px-3 py-1.5 rounded-xl border text-xs bg-slate-50/80 border-slate-200/80">
                          <span className="text-muted-fg font-medium">Status Tag:</span>
                          {willBePartiallyPaid ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Partially Paid ({formatPHP(Math.max(0, periodRemainingDue - currentPaymentNum))} short)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Paid</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Payment Method */}
                    <div>
                      <label className="text-xs font-semibold text-focus block mb-1">
                        Payment Method
                      </label>
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

                    {/* Receipt / Ref No. */}
                    <div>
                      <label className="text-xs font-semibold text-focus block mb-1">
                        Receipt / Ref No.
                      </label>
                      <Input
                        value={paymentRef}
                        onChange={(e) => setPaymentRef(e.target.value)}
                        placeholder="e.g. OR-JK-101"
                        className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl font-mono"
                      />
                    </div>

                    {/* Remarks / Notes */}
                    <div>
                      <label className="text-xs font-semibold text-focus block mb-1">
                        Remarks / Notes
                      </label>
                      <textarea
                        rows={2}
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        placeholder="Enter payment remarks or notes..."
                        className="w-full h-16 p-2.5 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none transition-all placeholder:text-muted-fg/60"
                      />
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
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
                    disabled={!isAmountValid || isDateAlreadySettled || !paymentDate || isSubmittingPayment}
                    className="h-9 sm:h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center gap-2"
                  >
                    {isSubmittingPayment && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
                    <span>{isSubmittingPayment ? 'Saving...' : 'Review & Confirm Payment'}</span>
                  </Button>
                </div>
              </form>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* MODAL 5: Edit a recorded payment (spec 0016) */}
      <Dialog open={!!editingRecord} onOpenChange={(open) => { if (!open) setEditingRecord(null) }}>
        <DialogContent className="sm:max-w-[560px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <Pencil className="h-4 w-4 text-focus" />
              <span>Edit Payment</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg">
              Change this payment for <strong className="text-focus">{activeTenant?.tenantName}</strong>. The amounts,
              balance and period status are recalculated from the payments.
            </DialogDescription>
          </DialogHeader>

          {activeTenant && editingRecord && (() => {
            const repeating = isRepeating(activeTenant)
            const canMarkMissed = !repeating || activeTenant.repeat === 'Daily'
            const isMissed = recordForm.status === 'Missed' && canMarkMissed
            const editPeriods = repeating ? getFinancials(activeTenant).periods : []
            return (
              <form onSubmit={handleSubmitEditRecord} className="space-y-3.5 mt-2">
                {recordError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700" role="alert">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{recordError}</span>
                  </div>
                )}

                {canMarkMissed && (
                  <div className="inline-flex items-center p-1 rounded-full bg-slate-100 border border-stroke/40 shadow-2xs">
                    {(['Paid', 'Missed'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setRecordError('')
                          setRecordForm({ ...recordForm, status: opt })
                        }}
                        className={cn(
                          'px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
                          recordForm.status === opt ? 'bg-[#960C01] text-white shadow-xs' : 'text-muted-fg hover:text-focus'
                        )}
                      >
                        {opt === 'Paid' ? 'Paid' : 'Unpaid (Missed)'}
                      </button>
                    ))}
                  </div>
                )}

                {repeating && (
                  <div className="space-y-1">
                    <label htmlFor="edit-payment-period" className="text-xs font-semibold text-focus block">
                      {isMissed ? 'Day' : 'Pay Starting From'} <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="edit-payment-period"
                      value={recordForm.periodIndex}
                      onChange={(e) => setRecordForm({ ...recordForm, periodIndex: Number(e.target.value) })}
                      className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                    >
                      {editPeriods.map((p) => (
                        <option key={p.index} value={p.index}>
                          {p.label} · due {p.dueDate}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="edit-payment-date" className="text-xs font-semibold text-focus block">
                      {isMissed ? 'Date Marked' : 'Payment Date'} <span className="text-red-500">*</span>
                    </label>
                    <Input
                      id="edit-payment-date"
                      type="date"
                      value={recordForm.date}
                      onChange={(e) => setRecordForm({ ...recordForm, date: e.target.value })}
                      className="h-10 text-xs sm:text-sm rounded-xl"
                    />
                  </div>

                  {!isMissed && (
                    <div className="space-y-1">
                      <label htmlFor="edit-payment-amount" className="text-xs font-semibold text-focus block">
                        Amount (₱) <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="edit-payment-amount"
                        type="number"
                        min="0.01"
                        step="any"
                        value={recordForm.amount}
                        onWheel={(e) => e.currentTarget.blur()}
                        onChange={(e) => setRecordForm({ ...recordForm, amount: e.target.value })}
                        className="h-10 text-xs sm:text-sm rounded-xl font-semibold"
                      />
                    </div>
                  )}
                </div>

                {isMissed ? (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-focus block">Reason</label>
                    <Input
                      value={recordForm.missedReason}
                      onChange={(e) => setRecordForm({ ...recordForm, missedReason: e.target.value })}
                      className="h-10 text-xs sm:text-sm rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-focus block">Payment Method</label>
                      <select
                        value={recordForm.method}
                        onChange={(e) => setRecordForm({ ...recordForm, method: e.target.value })}
                        className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                      >
                        <option value="Cash">Cash</option>
                        <option value="GCash">GCash</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Cheque">Cheque</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-focus block">Receipt / Ref No.</label>
                      <Input
                        value={recordForm.referenceNo}
                        onChange={(e) => setRecordForm({ ...recordForm, referenceNo: e.target.value })}
                        className="h-10 text-xs sm:text-sm rounded-xl font-mono"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-focus block">Remarks / Notes</label>
                  <textarea
                    rows={2}
                    value={recordForm.notes}
                    onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })}
                    className="w-full p-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none"
                  />
                </div>

                {activeTenant.auditStatus && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    This lease is marked {activeTenant.auditStatus === 'Verified' ? 'Audited' : 'Flagged'}. Saving a change
                    sets it back to pending audit.
                  </p>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingRecord(null)}
                    className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer shadow-xs"
                  >
                    Save Changes
                  </Button>
                </div>
              </form>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* MODAL 6: Confirm removing a payment, or marking a period unpaid (spec 0016) */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}>
        <DialogContent className="sm:max-w-[520px] rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mb-3">
              <Trash2 className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-focus">
              {removeTarget?.kind === 'period' ? `Mark ${removeTarget.period.label} as Unpaid` : 'Remove Payment'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-1">
              {removeTarget?.kind === 'period'
                ? `This removes ${removeTarget.records.length === 1 ? 'the payment' : `${removeTarget.records.length} payments`} that started at ${removeTarget.period.label}. The money goes back to unpaid.`
                : removeTarget
                ? `This removes the ${removeTarget.record.status === 'Missed' ? 'missed day mark' : `${formatPHP(removeTarget.record.amount)} payment`} dated ${removeTarget.record.date}. ${removeTarget.record.status === 'Missed' ? '' : 'The money goes back to unpaid.'}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          {removeTarget?.kind === 'period' && removeTarget.affected.length > 0 && (
            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 text-xs" aria-live="polite">
              <div className="font-bold text-focus">Periods that become less paid</div>
              {removeTarget.affected.map((a) => (
                <div key={a.label} className="flex justify-between items-center">
                  <span className="text-focus">{a.label}</span>
                  <span className="font-semibold text-rose-600">-{formatPHP(a.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {activeTenant?.auditStatus && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              This lease is marked {activeTenant.auditStatus === 'Verified' ? 'Audited' : 'Flagged'}. This change sets it
              back to pending audit.
            </p>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirmRemove}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs"
            >
              {removeTarget?.kind === 'period' ? 'Mark as Unpaid' : 'Remove Payment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
