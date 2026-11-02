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

const PERIOD_OPTIONS = ['Daily', 'Quarterly', 'Monthly', 'Annually'] as const
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
  const [selectedStatus, setSelectedStatus] = React.useState<string>('All')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodType>('Monthly')
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

  // Period change handler matching Sales and Expense pages
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

  // Filtered tenants
  const filteredTenants = React.useMemo(() => {
    return tenants
      .filter((tenant) => {
        // Status check
        if (selectedStatus !== 'All' && tenant.status !== selectedStatus) {
          return false
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
  }, [tenants, selectedStatus, searchQuery, dateRange, todayStr])

  // Reset to page 1 on filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedStatus, selectedPeriod, dateRange])

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

  // Submit Add
  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

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

  // Submit Edit
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTenant || !validateForm(activeTenant)) return

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

  // Submit Daily Payment / Missed Record
  const handleSubmitDailyPayment = async (e: React.FormEvent) => {
    e.preventDefault()
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

    try {
      let updated = await tenantService.addPayment(activeTenant.id, input)
      updated = await syncStatus(updated)
      applyLease(updated)
    } catch (err) {
      setPaymentError(messageOf(err))
      return
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
    if (!isRepeating(lease) || fin.periodCount === 0) return lease.dueDate
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

  // Render Full-Page Tenant Details View (Matching Lending Page UI)
  const renderDetailsPage = () => {
    if (!activeTenant) return null

    const LEDGER_ITEMS_PER_PAGE = 5
    const dailyTarget = Math.max(500, Math.round(activeTenant.rentAmount / 30))

    // Repeating leases read everything through the schedule (spec 0015); other leases are unchanged
    const fin = getFinancials(activeTenant)
    const repeatingLease = isRepeating(activeTenant) && fin.periodCount > 0
    const nextPeriod = fin.nextPeriod

    // Build unified ledger combining recorded payments and scheduled pending dates
    const recordedDates = new Set<string>()
    const ledgerRows: Array<{
      id: string
      date: string
      status: 'Paid' | 'Pending'
      amount: number
      method: string
      referenceNo: string
      notes: string
      /** Set for rows that come from a saved payment record (these can be edited or removed). */
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

    // Generate upcoming scheduled pending dates up to dueDate so Pending filter shows upcoming schedule
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

    const filteredLedger = ledgerRows.filter((r) => {
      if (ledgerStatusFilter === 'All') return true
      if (ledgerStatusFilter === 'Paid') return r.status === 'Paid'
      return r.status === 'Pending'
    })

    const totalLedgerPages = Math.max(1, Math.ceil(filteredLedger.length / LEDGER_ITEMS_PER_PAGE))
    const safeLedgerPage = Math.min(ledgerPage, totalLedgerPages)
    const paginatedLedger = filteredLedger.slice(
      (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE,
      safeLedgerPage * LEDGER_ITEMS_PER_PAGE
    )

    // Repeating leases: Payment Schedule (one row per period) plus the list of recorded payments
    const renderRepeatSchedulePanel = () => {
      const filteredPeriods = fin.periods.filter((p) => {
        if (ledgerStatusFilter === 'All') return true
        const isSettled = p.status === 'Paid' || p.status === 'Advance Paid'
        return ledgerStatusFilter === 'Paid' ? isSettled : !isSettled
      })
      const totalSchedulePages = Math.max(1, Math.ceil(filteredPeriods.length / SCHEDULE_ITEMS_PER_PAGE))
      const safeSchedulePage = Math.min(ledgerPage, totalSchedulePages)
      const scheduleRows = filteredPeriods.slice(
        (safeSchedulePage - 1) * SCHEDULE_ITEMS_PER_PAGE,
        safeSchedulePage * SCHEDULE_ITEMS_PER_PAGE
      )

      const historyRecords = (activeTenant.dailyPayments || [])
        .slice()
        .sort((a, b) => {
          const byDate = (b.date || '').localeCompare(a.date || '')
          return byDate !== 0 ? byDate : (b.timestamp || '').localeCompare(a.timestamp || '')
        })
      const totalHistoryPages = Math.max(1, Math.ceil(historyRecords.length / HISTORY_ITEMS_PER_PAGE))
      const safeHistoryPage = Math.min(historyPage, totalHistoryPages)
      const historyRows = historyRecords.slice(
        (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE,
        safeHistoryPage * HISTORY_ITEMS_PER_PAGE
      )
      const periodLabelByIndex = new Map(fin.periods.map((p) => [p.index, p.label]))
      // How many money payments started at each period (an untagged older payment starts at period 1)
      const startedAtPeriod = new Map<number, number>()
      ;(activeTenant.dailyPayments || []).forEach((r) => {
        if (r.status === 'Missed' || !(r.amount > 0)) return
        const idx = r.periodIndex || 1
        startedAtPeriod.set(idx, (startedAtPeriod.get(idx) || 0) + 1)
      })

      return (
        <div className="lg:col-span-3 space-y-4">
          {/* Payment Schedule */}
          <div className="bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-focus flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-emerald-600" />
                  <span>Payment Schedule</span>
                </h2>
                <p className="text-[11px] text-muted-fg mt-0.5">
                  Periods paid{' '}
                  <strong className="text-focus">
                    {fin.periodsPaid} of {fin.periodCount}
                  </strong>{' '}
                  •{' '}
                  {nextPeriod ? (
                    <span className={cn(nextPeriod.isOverdue && 'text-rose-600 font-semibold')}>
                      Next due {nextPeriod.dueDate} ({nextPeriod.label}
                      {nextPeriod.isOverdue ? ', overdue' : ''})
                    </span>
                  ) : (
                    <span className="text-emerald-700 font-semibold">Fully paid</span>
                  )}
                </p>
              </div>

              <div className="inline-flex items-center p-1 rounded-full bg-slate-100 border border-stroke/40 shadow-2xs self-start sm:self-auto">
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
                        'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
                        isActive ? 'bg-[#960C01] text-white shadow-xs' : 'text-muted-fg hover:text-focus'
                      )}
                    >
                      {statusOpt}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Period</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Due Date</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">Amount Due</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">Penalty</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">Paid</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">Remaining</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-center">Status</TableHead>
                    {!isAudit && (
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-center">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduleRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAudit ? 7 : 8} className="h-36 text-center text-xs text-muted-fg">
                        No periods match your filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    scheduleRows.map((period) => (
                      <TableRow
                        key={period.index}
                        className={cn(
                          'hover:bg-slate-50/60 border-b border-slate-100',
                          period.status === 'Advance Paid' && 'bg-sky-50/20',
                          period.status === 'Partially Paid' && 'bg-amber-50/20'
                        )}
                      >
                        <TableCell className="py-3 px-3 text-xs font-semibold text-focus whitespace-nowrap">
                          {period.label}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'py-3 px-3 font-mono text-xs font-semibold whitespace-nowrap',
                            period.isOverdue ? 'text-rose-600' : 'text-focus'
                          )}
                        >
                          {period.dueDate}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right text-xs font-bold tabular-nums text-focus whitespace-nowrap">
                          {formatPHP(period.amountDue)}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right text-xs tabular-nums whitespace-nowrap">
                          {period.penalty > 0 ? (
                            <span className="text-rose-600 font-semibold">{formatPHP(period.penalty)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right text-xs font-bold tabular-nums whitespace-nowrap">
                          {period.paid > 0 ? (
                            <span className={period.status === 'Advance Paid' ? 'text-sky-700' : 'text-emerald-700'}>
                              {formatPHP(period.paid)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right text-xs font-bold tabular-nums text-amber-700 whitespace-nowrap">
                          {period.remaining > 0 ? formatPHP(period.remaining) : <span className="text-slate-400">—</span>}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                              PERIOD_STATUS_STYLES[period.status]
                            )}
                            title={period.status === 'Advance Paid' ? 'Covered by advance payment' : undefined}
                          >
                            {period.status === 'Paid' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                            {period.status === 'Advance Paid' && <Lock className="h-2.5 w-2.5" />}
                            {period.status}
                          </span>
                          {period.status === 'Advance Paid' && (
                            <div className="text-[9.5px] text-muted-fg mt-0.5">Covered by advance payment</div>
                          )}
                        </TableCell>
                        {!isAudit && (
                          <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {period.remaining > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkPeriodPaid(period)}
                                  className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 cursor-pointer transition-colors"
                                  title={`Record a payment for ${period.label} (${formatPHP(period.remaining)} still owed)`}
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
                                <span
                                  className="text-[10px] text-muted-fg"
                                  title="This period is covered by advance money from an earlier payment. Edit or remove that payment instead."
                                >
                                  Covered by advance
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-muted-fg">
              <div>
                Showing{' '}
                <span className="font-semibold text-focus">
                  {filteredPeriods.length === 0 ? 0 : (safeSchedulePage - 1) * SCHEDULE_ITEMS_PER_PAGE + 1}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-focus">
                  {Math.min(safeSchedulePage * SCHEDULE_ITEMS_PER_PAGE, filteredPeriods.length)}
                </span>{' '}
                of <span className="font-semibold text-focus">{filteredPeriods.length}</span> periods
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeSchedulePage <= 1}
                  onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                  className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Prev
                </Button>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-focus font-semibold text-xs">
                  Page {safeSchedulePage} of {totalSchedulePages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeSchedulePage >= totalSchedulePages}
                  onClick={() => setLedgerPage((p) => Math.min(totalSchedulePages, p + 1))}
                  className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </div>

          {/* Payment History (the existing payment ledger, newest first) */}
          <div className="bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-focus flex items-center gap-2">
                <Coins className="h-4 w-4 text-emerald-600" />
                <span>Payment History ({historyRecords.length})</span>
              </h2>
              <p className="text-[11px] text-muted-fg mt-0.5">
                Each payment starts at the period shown. Extra money flows forward into the next periods.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Payment Date</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Starting Period</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">Amount Paid</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Method</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Reference No.</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">Remarks</TableHead>
                    {!isAudit && (
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-center">Actions</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAudit ? 6 : 7} className="h-28 text-center text-xs text-muted-fg">
                        No payments recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    historyRows.map((rec) => (
                      <TableRow key={rec.id} className="hover:bg-slate-50/60 border-b border-slate-100">
                        <TableCell className="py-3 px-3 font-mono text-xs font-semibold text-focus whitespace-nowrap">
                          {rec.date}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-xs text-focus whitespace-nowrap">
                          {rec.periodIndex ? periodLabelByIndex.get(rec.periodIndex) || `Period ${rec.periodIndex}` : '—'}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right text-xs font-bold tabular-nums whitespace-nowrap">
                          {rec.status === 'Missed' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider bg-rose-50 text-rose-700 border-rose-200">
                              Missed
                            </span>
                          ) : (
                            <span className="text-emerald-700">{formatPHP(rec.amount)}</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-xs text-focus whitespace-nowrap">{rec.method || '—'}</TableCell>
                        <TableCell className="py-3 px-3 font-mono text-xs text-muted-fg whitespace-nowrap">
                          {rec.referenceNo || '—'}
                        </TableCell>
                        <TableCell
                          className="py-3 px-3 text-xs text-muted-fg max-w-[220px] truncate"
                          title={rec.status === 'Missed' ? rec.missedReason || rec.notes : rec.notes}
                        >
                          {rec.status === 'Missed' ? rec.missedReason || rec.notes || '—' : rec.notes || '—'}
                        </TableCell>
                        {!isAudit && (
                          <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenEditRecord(rec)}
                                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer transition-colors"
                                title="Edit this payment"
                                aria-label={`Edit payment of ${rec.date}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoveTarget({ kind: 'record', record: rec })}
                                className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer transition-colors"
                                title="Remove this payment (the amount goes back to unpaid)"
                                aria-label={`Remove payment of ${rec.date}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-muted-fg">
              <div>
                Showing{' '}
                <span className="font-semibold text-focus">
                  {historyRecords.length === 0 ? 0 : (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE + 1}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-focus">
                  {Math.min(safeHistoryPage * HISTORY_ITEMS_PER_PAGE, historyRecords.length)}
                </span>{' '}
                of <span className="font-semibold text-focus">{historyRecords.length}</span> entries
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeHistoryPage <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Prev
                </Button>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-focus font-semibold text-xs">
                  Page {safeHistoryPage} of {totalHistoryPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeHistoryPage >= totalHistoryPages}
                  onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                  className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-5 pb-12 max-w-[1600px] mx-auto animate-in fade-in duration-200">
        {/* Top Action & Navigation Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setViewMode('list')}
              className="h-10 px-4 rounded-xl border-stroke/60 bg-white hover:bg-slate-50 text-focus font-semibold text-xs flex items-center gap-2 shadow-2xs cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back to Tenants</span>
            </Button>
          </div>
        </div>

        {/* Main Details Header (No container background, no status badge, buttons in same row as name) */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-1">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-focus tracking-tight">
              {activeTenant.tenantName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
              <span>
                Unit / Stall: <strong className="text-focus font-semibold">{activeTenant.unitName}</strong>
              </span>
              <span>
                {repeatingLease ? 'Next Due: ' : 'Due Date: '}
                <strong
                  className={cn(
                    'font-semibold',
                    repeatingLease && nextPeriod?.isOverdue ? 'text-rose-600' : 'text-focus'
                  )}
                >
                  {repeatingLease
                    ? nextPeriod
                      ? `${nextPeriod.dueDate} (${nextPeriod.label})`
                      : 'Fully paid'
                    : activeTenant.dueDate}
                </strong>
              </span>
            </div>
          </div>

          {/* Action Buttons in the same row as the Tenant Name */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!isAudit && (
              <>
                <Button
                  type="button"
                  onClick={(e) => handleOpenDailyPayment(activeTenant, e)}
                  disabled={fin.remaining <= 0}
                  className="h-10 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Coins className="h-4 w-4" />
                  <span>Record Payment</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={(e) => handleOpenEdit(activeTenant, e)}
                  className="h-10 px-4 rounded-xl border-stroke/60 bg-white hover:bg-slate-50 text-focus font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit Terms</span>
                </Button>
              </>
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

        {/* 6 Financial Overview KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
              Rental Rate
            </span>
            <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
              {formatPHP(activeTenant.rentAmount)}
            </span>
          </div>

          <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
              {repeatingLease ? 'Rent Per Payment' : 'Daily Target'}
            </span>
            <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
              {formatPHP(repeatingLease ? activeTenant.rentAmount : dailyTarget)}
            </span>
          </div>

          <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
              Total Payable
            </span>
            <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
              {formatPHP(fin.totalDue)}
            </span>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200/70 rounded-2xl p-4 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-emerald-800 block">
              Amount Paid
            </span>
            <span className="text-base sm:text-lg font-extrabold text-emerald-700 tabular-nums mt-1 block">
              {formatPHP(fin.amountPaid)}
            </span>
          </div>

          <div className="bg-amber-50/70 border border-amber-200/70 rounded-2xl p-4 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-amber-800 block">
              Remaining Balance
            </span>
            <span className="text-base sm:text-lg font-extrabold text-amber-700 tabular-nums mt-1 block">
              {formatPHP(fin.remaining)}
            </span>
          </div>

          <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
            <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
              {repeatingLease ? 'Next Due' : 'Due Date'}
            </span>
            <span
              className={cn(
                'text-base sm:text-lg font-extrabold tabular-nums mt-1 block',
                repeatingLease && nextPeriod?.isOverdue ? 'text-rose-600' : 'text-focus'
              )}
            >
              {repeatingLease ? (nextPeriod ? nextPeriod.dueDate : 'Fully paid') : activeTenant.dueDate}
            </span>
          </div>
        </div>

        {/* Split Section: Lease Agreement & Terms (Left) + Payment Schedule & History (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Left 1 Column: Lease Agreement & Terms */}
          <div className="lg:col-span-1 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <FileText className="h-4 w-4 text-[#960C01]" />
              <h2 className="text-sm font-bold text-focus">Lease Agreement & Terms</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">Tenant ID</span>
                <span className="font-mono font-bold text-[#960C01]">{activeTenant.tenantId}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">Tenant / Lessee</span>
                <span className="font-semibold text-focus text-right truncate max-w-[160px]">{activeTenant.tenantName}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">Leased Unit</span>
                <span className="font-semibold text-focus text-right truncate max-w-[160px]">{activeTenant.unitName}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">Date Contracted</span>
                <span className="font-mono font-semibold text-focus">{activeTenant.contractDate}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">{repeatingLease ? 'First Due Date' : 'Maturity / Due Date'}</span>
                <span className="font-mono font-semibold text-focus">{activeTenant.dueDate}</span>
              </div>
              {repeatingLease && (
                <>
                  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100">
                    <span className="text-muted-fg shrink-0">Repeat</span>
                    <span className="font-semibold text-focus text-right">
                      {describeRepeat(activeTenant.repeat as LeaseRepeat, activeTenant.dueDate, fin.periodCount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <span className="text-muted-fg">Lease End Date</span>
                    <span className="font-mono font-semibold text-focus">{activeTenant.leaseEndDate}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                    <span className="text-muted-fg">Late Penalty</span>
                    <span className="font-semibold text-focus">
                      {activeTenant.penaltyRate && activeTenant.penaltyRate > 0
                        ? `${activeTenant.penaltyRate}% of a period's rent`
                        : 'None'}
                    </span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">Assigned Company</span>
                <span className="font-semibold text-focus text-right truncate max-w-[160px]">{activeTenant.companyName}</span>
              </div>
              {activeTenant.auditStatus && (
                <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                  <span className="text-muted-fg">Audit Status</span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-[10.5px] font-bold border',
                      activeTenant.auditStatus === 'Verified'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    )}
                  >
                    {activeTenant.auditStatus} {activeTenant.auditDate ? `(${activeTenant.auditDate})` : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg block mb-1.5">
                Remarks & Notes
              </span>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-xs text-focus min-h-[64px] whitespace-pre-wrap">
                {activeTenant.notes || 'No additional remarks recorded for this tenant lease.'}
              </div>
            </div>
          </div>

          {/* Right 3 Columns: Payment Schedule & History Table (repeating leases get the period schedule) */}
          {repeatingLease ? (
            renderRepeatSchedulePanel()
          ) : (
          <div className="lg:col-span-3 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-focus flex items-center gap-2">
                    <Coins className="h-4 w-4 text-emerald-600" />
                    <span>Payment Schedule & History</span>
                  </h2>
                  <p className="text-[11px] text-muted-fg mt-0.5">
                    Showing 5 records per page • Filter by Paid or Pending status
                  </p>
                </div>

                {/* Status Filter Toggle (All / Paid / Pending) */}
                <div className="inline-flex items-center p-1 rounded-full bg-slate-100 border border-stroke/40 shadow-2xs self-start sm:self-auto">
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
                          'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
                          isActive
                            ? 'bg-[#960C01] text-white shadow-xs'
                            : 'text-muted-fg hover:text-focus'
                        )}
                      >
                        {statusOpt}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                        Payment Date
                      </TableHead>
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-center">
                        Status
                      </TableHead>
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">
                        Amount Paid
                      </TableHead>
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                        Method
                      </TableHead>
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                        Reference No.
                      </TableHead>
                      <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                        Remarks
                      </TableHead>
                      {!isAudit && (
                        <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-center">
                          Actions
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedLedger.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isAudit ? 6 : 7} className="h-36 text-center text-xs text-muted-fg">
                          No payment records match your filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedLedger.map((entry) => {
                        const badgeStyle =
                          entry.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'

                        return (
                          <TableRow key={entry.id} className="hover:bg-slate-50/60 border-b border-slate-100">
                            <TableCell className="py-3 px-3 font-mono text-xs font-semibold text-focus whitespace-nowrap">
                              {entry.date}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                                  badgeStyle
                                )}
                              >
                                {entry.status === 'Paid' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                {entry.status}
                              </span>
                            </TableCell>
                            <TableCell className="py-3 px-3 text-right font-bold text-xs tabular-nums whitespace-nowrap">
                              {entry.amount > 0 ? (
                                <span className="text-emerald-700">{formatPHP(entry.amount)}</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-xs text-focus whitespace-nowrap">
                              {entry.method || '—'}
                            </TableCell>
                            <TableCell className="py-3 px-3 font-mono text-xs text-muted-fg whitespace-nowrap">
                              {entry.referenceNo || '—'}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-xs text-muted-fg max-w-[220px] truncate" title={entry.notes}>
                              {entry.notes || '—'}
                            </TableCell>
                            {!isAudit && (
                              <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                                {entry.recordId ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const rec = activeTenant.dailyPayments.find((r) => r.id === entry.recordId)
                                        if (rec) handleOpenEditRecord(rec)
                                      }}
                                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer transition-colors"
                                      title="Edit this payment"
                                      aria-label={`Edit payment of ${entry.date}`}
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
                                      title="Remove this payment (the amount goes back to unpaid)"
                                      aria-label={`Remove payment of ${entry.date}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* 5-Row Pagination Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-muted-fg">
              <div>
                Showing{' '}
                <span className="font-semibold text-focus">
                  {filteredLedger.length === 0
                    ? 0
                    : (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE + 1}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-focus">
                  {Math.min(safeLedgerPage * LEDGER_ITEMS_PER_PAGE, filteredLedger.length)}
                </span>{' '}
                of <span className="font-semibold text-focus">{filteredLedger.length}</span> entries
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeLedgerPage <= 1}
                  onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                  className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Prev
                </Button>
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-focus font-semibold text-xs">
                  Page {safeLedgerPage} of {totalLedgerPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeLedgerPage >= totalLedgerPages}
                  onClick={() => setLedgerPage((p) => Math.min(totalLedgerPages, p + 1))}
                  className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </div>
          )}
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
      <form onSubmit={handleSubmitDailyPayment} className="space-y-5 mt-2">
        {paymentError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700" role="alert">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{paymentError}</span>
          </div>
        )}

        {isDailyLease && (
          <div className="inline-flex items-center p-1 rounded-full bg-slate-100 border border-stroke/40 shadow-2xs">
            {(['Paid', 'Missed'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setPaymentError('')
                  setPaymentStatusType(opt)
                }}
                className={cn(
                  'px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
                  paymentStatusType === opt ? 'bg-[#960C01] text-white shadow-xs' : 'text-muted-fg hover:text-focus'
                )}
              >
                {opt === 'Paid' ? 'Record Payment' : 'Mark Day as Missed'}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
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
              <div className="p-3.5 border border-emerald-200/70 bg-emerald-50/50 rounded-xl space-y-1.5 text-xs" aria-live="polite">
                <div className="font-bold text-emerald-800">Where this payment goes</div>
                {allocation.map((line) => (
                  <div key={line.index} className="flex justify-between items-center">
                    <span className="text-focus">
                      {line.label}
                      {line.kind === 'advance' && <span className="text-sky-700 font-semibold"> (advance)</span>}
                    </span>
                    <span className="font-semibold text-emerald-700">{formatPHP(line.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: payment details */}
          <div className="space-y-3.5">
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
                className="h-10 text-xs sm:text-sm rounded-xl"
              />
            </div>

            {isMissedMark ? (
              <div>
                <label className="text-xs font-semibold text-focus block mb-1">Reason</label>
                <Input
                  value={missedReason}
                  onChange={(e) => setMissedReason(e.target.value)}
                  className="h-10 text-xs sm:text-sm rounded-xl"
                />
                <p className="text-[10.5px] text-muted-fg mt-1">
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
                    <span className="text-[11px] text-muted-fg font-medium">Max: {formatPHP(maxAllowed)}</span>
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
                    className="h-10 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {paymentAmount && !isAmountValid && (
                    <p className="text-[11px] text-rose-600 mt-1">
                      {amountNum <= 0 || isNaN(amountNum)
                        ? 'Payment amount must be greater than 0.'
                        : `From ${selected?.label ?? 'this period'} onward the lease only has ${formatPHP(maxAllowed)} left to pay. Pick an earlier period to pay more.`}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
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
                    className="h-10 text-xs sm:text-sm rounded-xl font-mono"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-semibold text-focus block mb-1">Remarks / Notes</label>
              <textarea
                rows={3}
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="Enter payment remarks or notes..."
                className="w-full p-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none transition-all placeholder:text-muted-fg/60"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsUpdatePaymentModalOpen(false)}
            className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isMissedMark ? 'Mark as Missed' : 'Review & Confirm Payment'}
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

            {/* Status Dropdown */}
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
                  {selectedStatus === 'All' ? 'Status' : selectedStatus}
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
                  {['All', 'Active', 'Completed', 'Overdue', 'Pending'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setSelectedStatus(st)
                        setIsStatusDropdownOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        selectedStatus === st
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{st === 'All' ? 'All Status' : st}</span>
                      {selectedStatus === st && (
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

            {/* Company Scope Pill for JK Property and Ventures */}
            <div className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-xs">
              <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
              <span className="font-semibold text-focus/90">JK Property and Ventures</span>
            </div>
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
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  CONTRACT
                </TableHead>
                <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
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
                    <TableCell className="px-3.5 py-3.5 text-xs text-focus/90 text-center whitespace-nowrap">
                      {tenant.contractDate}
                    </TableCell>

                    {/* 5. Due Date (next unpaid period for a repeating lease) */}
                    <TableCell className="px-3.5 py-3.5 text-xs text-focus/90 text-center whitespace-nowrap">
                      {repeatingRow ? (
                        fin.nextPeriod ? (
                          <div className="flex flex-col items-center gap-0.5">
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
                        tenant.dueDate
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
                            'inline-flex items-center px-1.5 py-0.2 rounded-full text-[10px] font-semibold w-fit',
                            tenant.status === 'Active' && 'text-blue-700 bg-blue-50',
                            tenant.status === 'Completed' && 'text-emerald-700 bg-emerald-50',
                            tenant.status === 'Overdue' && 'text-rose-700 bg-rose-50',
                            tenant.status === 'Pending' && 'text-amber-700 bg-amber-50'
                          )}
                        >
                          {tenant.status}
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
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      rentAmount: e.target.value,
                      totalAmountPayable: formData.totalAmountPayable || e.target.value,
                    })
                  }
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
              onChange={(repeat) => setFormData({ ...formData, repeat })}
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
                className="h-10 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs cursor-pointer"
              >
                Create Lease
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
                  onChange={(e) => setFormData({ ...formData, rentAmount: e.target.value })}
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
                    onChange={(repeat) => setFormData({ ...formData, repeat })}
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
                className="h-10 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs cursor-pointer"
              >
                Save Changes
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
        <DialogContent className="sm:max-w-[860px] md:max-w-[920px] max-h-[88vh] overflow-y-auto bg-white rounded-[24px] p-6 sm:p-7 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-600" />
              <span>Record Payment</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg">
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
              <form onSubmit={handleSubmitDailyPayment} className="space-y-5 mt-2">
                {paymentError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{paymentError}</span>
                  </div>
                )}

                {isDateAlreadySettled && (
                  <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl space-y-1 text-xs text-amber-900">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
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

                    <div className="border border-stroke/60 rounded-xl p-3.5 bg-white space-y-2.5">
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
                      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-muted-fg uppercase py-1 border-b border-slate-100">
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
                              <div key={`cal-empty-${i}`} className="h-9" />
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
                                    'h-9 rounded-lg text-xs font-medium flex flex-col items-center justify-center relative transition-all',
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
                                  {isPaid && <Check className="h-2.5 w-2.5 text-emerald-600 -mt-0.5" />}
                                  {isPartial && !isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute bottom-1" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}

                      {/* Calendar Legend */}
                      <div className="flex flex-wrap items-center justify-between text-[10px] text-muted-fg pt-2 border-t border-slate-100 gap-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid (Locked)
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-[#960C01] inline-block" /> Selected
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Partially Paid
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Payment Amount, Payment Method, Receipt No., Remarks/Notes */}
                  <div className="space-y-3.5">
                    {/* Payment Amount Input */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-focus">
                          Payment Amount (₱) <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[11px] text-muted-fg font-medium">
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
                        className="h-10 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      {paymentAmount && !isAmountValid && (
                        <p className="text-[11px] text-rose-600 mt-1">
                          {currentPaymentNum < 1
                            ? 'Payment amount cannot be lower than ₱1.00.'
                            : `Payment amount cannot exceed ${formatPHP(maxAllowed)}.`}
                        </p>
                      )}
                      {isAmountValid && (
                        <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-xl border text-xs bg-slate-50/80 border-slate-200/80">
                          <span className="text-muted-fg font-medium">Transaction Status Tag:</span>
                          {willBePartiallyPaid ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Partially Paid ({formatPHP(Math.max(0, periodRemainingDue - currentPaymentNum))} short of target)
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
                        className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
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
                        className="h-10 text-xs sm:text-sm rounded-xl font-mono"
                      />
                    </div>

                    {/* Remarks / Notes */}
                    <div>
                      <label className="text-xs font-semibold text-focus block mb-1">
                        Remarks / Notes
                      </label>
                      <textarea
                        rows={3}
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        placeholder="Enter payment remarks or notes..."
                        className="w-full p-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none transition-all placeholder:text-muted-fg/60"
                      />
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsUpdatePaymentModalOpen(false)}
                    className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!isAmountValid || isDateAlreadySettled || !paymentDate}
                    className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                  >
                    Review & Confirm Payment
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
