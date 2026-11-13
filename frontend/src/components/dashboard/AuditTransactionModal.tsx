import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Pencil,
  ChevronDown,
  ChevronRight,
  Check,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Receipt,
  RotateCcw,
  Lock,
  History,
  Clock,
  ShieldCheck,
  UserCheck,
  PlusCircle,
  MessageSquare,
} from 'lucide-react'
import { UpdateLoanStatusModal } from './UpdateLoanStatusModal'
import { parseParticulars } from '@/utils/particularsUtils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPHP, formatPersonInitialAndLastName } from '@/lib/format'
import { CATEGORY_COLORS } from '@/utils/categoryConstants'
import { normalizeDateToYYYYMMDD, formatToYYYYMMDD, formatDisplayDate } from '@/utils/dateUtils'
import { bankService } from '@/services/bankService'
import { useDailyRemarks } from '@/hooks/useDailyRemarks'
import { DayRemarkCell } from './DayRemark'
import { notifyError } from '@/utils/errorUtils'
import {
  salesService,
  type SalesItem,
  type NewSalesInput,
} from '@/services/salesService'
import {
  expenseService,
  type ExpenseItem,
} from '@/services/expenseService'
import {
  loanService,
  type LoanItem,
} from '@/services/loanService'
import { tenantService } from '@/services/tenantService'
import { activityLogService, type EntityTimelineEvent } from '@/services/activityLogService'
import type { DashboardTransactionItem } from '@/services/dashboardService'
import { cn } from '@/lib/utils'
import { formatRealName } from '@/utils/formatRealName'
import { useSession } from '@/hooks/useSession'

interface AuditTransactionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: DashboardTransactionItem | null
  sale?: SalesItem | null
  onSaleUpdated?: (updatedItem: SalesItem) => void
  expense?: ExpenseItem | null
  onExpenseUpdated?: (updatedItem: ExpenseItem) => void
  loan?: LoanItem | null
  onLoanUpdated?: (updatedItem: LoanItem) => void
  onTransactionUpdated?: (updatedItem: DashboardTransactionItem) => void
  onOpenUpdateLoanStatus?: (loan: LoanItem | null) => void
  editable?: boolean
  /** Strictly read-only view mode (e.g. Finance transactions page): hides Edit and Remarks actions */
  viewOnly?: boolean
  initialIsEditing?: boolean
  /** Still passed by SalesPage and ExpensePage; the origin/dev modal does not use it yet. */
  statusFilter?: string
}

const SALES_PAYMENT_METHODS = [
  'Cash',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'Cheque',
  'Bank Transfer',
  'In-house',
]

const EXPENSE_PAYMENT_METHODS = [
  'Cash',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'Cheque',
  'Bank Transfer',
  'In-house',
  'Petty Cash',
]

const DEFAULT_SPECIFIC_CATEGORIES = [
  'General',
  'Petty Cash',
  'Rendered Fee',
  'BBMP Foundation',
  'HDMF',
  'Philhealth',
  'Electricity',
  'BIR',
  'Payroll',
  'SSS',
  'Hotel Supplies',
  'Revolving Funds',
]

function formatTimelineDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return String(dateStr)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return String(dateStr)
  }
}

export const AuditTransactionModal: React.FC<AuditTransactionModalProps> = ({
  open,
  onOpenChange,
  transaction,
  sale,
  onSaleUpdated,
  expense,
  onExpenseUpdated,
  loan,
  onLoanUpdated,
  onTransactionUpdated,
  onOpenUpdateLoanStatus: _onOpenUpdateLoanStatus,
  editable = false,
  viewOnly = false,
  initialIsEditing: _initialIsEditing = false,
}) => {
  const navigate = useNavigate()
  const { user } = useSession()
  const roleLower = (user?.role || '').toLowerCase()
  const isAudit = roleLower.includes('audit')
  const isAdmin = roleLower === 'admin' || isAudit
  const isOwner = roleLower === 'owner'
  const isFinance = roleLower.includes('finance')
  const canAudit = isAdmin && !isOwner

  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = React.useState(false)
  const [discrepancyReason, setDiscrepancyReason] = React.useState('')
  const [isMarkAuditModalOpen, setIsMarkAuditModalOpen] = React.useState(false)
  const [markAuditRemarks, setMarkAuditRemarks] = React.useState('')
  const [localRemarksAuthor, setLocalRemarksAuthor] = React.useState<{
    name: string
    timestamp?: string
  } | null>(null)
  const [isSubmittingAudit, setIsSubmittingAudit] = React.useState(false)

  const [currentTx, setCurrentTx] = React.useState<DashboardTransactionItem | null>(transaction)
  const [currentSale, setCurrentSale] = React.useState<SalesItem | null>(sale || null)
  const [currentExpense, setCurrentExpense] = React.useState<ExpenseItem | null>(expense || null)
  const [currentLoan, setCurrentLoan] = React.useState<LoanItem | null>(loan || null)
  const [isEditing, setIsEditing] = React.useState(false)
  const [isUpdateLoanStatusOpen, setIsUpdateLoanStatusOpen] = React.useState(false)

  const [timelineEvents, setTimelineEvents] = React.useState<EntityTimelineEvent[]>([])
  const [isLoadingTimeline, setIsLoadingTimeline] = React.useState(false)
  const [isRemarksExpanded, setIsRemarksExpanded] = React.useState(false)
  const [isTimelineExpanded, setIsTimelineExpanded] = React.useState(false)

  // Form states for editing
  const [date, setDate] = React.useState('')
  const [chequeNo, setChequeNo] = React.useState('')
  const [particulars, setParticulars] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [paymentMethod, setPaymentMethod] = React.useState('Cash')
  const [category, setCategory] = React.useState('General')
  const [categoryOptions, setCategoryOptions] = React.useState<string[]>(DEFAULT_SPECIFIC_CATEGORIES)
  const [isCategoryOpen, setIsCategoryOpen] = React.useState(false)
  const [newCategoryName, setNewCategoryName] = React.useState('')
  const [isCreatingCategory, setIsCreatingCategory] = React.useState(false)
  const [remarks, setRemarks] = React.useState('')
  const categoryContainerRef = React.useRef<HTMLDivElement>(null)

  // Immediate Remarks Modal states for Finance and Supervisor
  const [isRemarksModalOpen, setIsRemarksModalOpen] = React.useState(false)
  const [remarksInput, setRemarksInput] = React.useState('')
  const [isSubmittingRemarks, setIsSubmittingRemarks] = React.useState(false)

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    date?: string
    particulars?: string
    amount?: string
    category?: string
  }>({})

  const todayIso = React.useMemo(() => formatToYYYYMMDD(new Date()), [])

  // Fetch categories from database
  React.useEffect(() => {
    let isMounted = true
    const fetchCats = async () => {
      try {
        const cats = await expenseService.getCategories()
        if (isMounted && cats && cats.length > 0) {
          const names = Array.from(new Set([...DEFAULT_SPECIFIC_CATEGORIES, ...cats.map((c) => c.name)]))
          setCategoryOptions(names)
        }
      } catch (err) {
        console.warn('Could not load categories:', err)
      }
    }
    fetchCats()
    return () => {
      isMounted = false
    }
  }, [open])

  // Sync internal state when props change
  React.useEffect(() => {
    setCurrentTx(transaction)
    setCurrentSale(sale || null)
    setCurrentExpense(expense || null)
    setCurrentLoan(loan || null)
  }, [transaction, sale, expense, loan])

  // Reset or initialize edit fields when modal opens or target changes (always start in read-only View Mode)
  React.useEffect(() => {
    if (open) {
      setIsEditing(false)
      setError('')
      setFieldErrors({})

      const activeSale = sale || currentSale
      const activeExpense = expense || currentExpense
      const activeLoan = loan || currentLoan
      const activeTx = transaction || currentTx

      if (activeSale) {
        setDate(activeSale.rawDate || normalizeDateToYYYYMMDD(activeSale.date))
        setChequeNo(activeSale.chequeNo || '')
        setParticulars(activeSale.particulars || '')
        setAmount(String(activeSale.deposit || activeSale.netAmount || ''))
        setCategory(activeSale.category || 'General')
        setPaymentMethod(activeSale.paymentMethod || 'Cash')
        setRemarks(activeSale.remarks || '')
      } else if (activeExpense) {
        setDate(activeExpense.rawDate || normalizeDateToYYYYMMDD(activeExpense.date))
        setChequeNo(activeExpense.chequeNo || '')
        setParticulars(activeExpense.particulars || '')
        setAmount(String(activeExpense.withdrawal || activeExpense.netAmount || ''))
        setCategory(activeExpense.category || 'General')
        setPaymentMethod(activeExpense.paymentMethod || 'Cash')
        setRemarks(activeExpense.remarks || '')
      } else if (activeLoan) {
        setDate(activeLoan.rawDate || normalizeDateToYYYYMMDD(activeLoan.date))
        setChequeNo(activeLoan.chequeNo || '')
        setParticulars(activeLoan.particulars || '')
        setAmount(String(activeLoan.amount || ''))
        setCategory(activeLoan.category || 'General')
        setPaymentMethod('Cash')
        setRemarks('')
      } else if (activeTx) {
        setDate(normalizeDateToYYYYMMDD(activeTx.date))
        setChequeNo(activeTx.chequeNo || '')
        setParticulars(activeTx.particulars || activeTx.description || '')
        const txAmount =
          activeTx.type === 'Expense'
            ? activeTx.withdrawal || activeTx.amount || ''
            : activeTx.type === 'Loan'
            ? activeTx.amount || activeTx.withdrawal || ''
            : activeTx.deposit || activeTx.amount || ''
        setAmount(String(txAmount))
        setCategory(activeTx.category || 'General')
        setPaymentMethod(activeTx.paymentMethod || 'Cash')
        setRemarks(activeTx.remarks || '')
      }
    } else {
      setIsEditing(false)
      setIsRemarksExpanded(false)
      setIsTimelineExpanded(false)
      setIsMarkAuditModalOpen(false)
      setMarkAuditRemarks('')
      setLocalRemarksAuthor(null)
      setError('')
      setFieldErrors({})
    }
  }, [open, sale, expense, loan, transaction, currentSale, currentExpense, currentLoan, currentTx])

  // Click outside category dropdown
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        categoryContainerRef.current &&
        !categoryContainerRef.current.contains(e.target as Node)
      ) {
        setIsCategoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredCategoryOptions = React.useMemo(() => {
    const q = category.trim().toLowerCase()
    if (!q) return categoryOptions
    return categoryOptions.filter((opt) => opt.toLowerCase().includes(q))
  }, [category, categoryOptions])

  const handleAddNewCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) return
    setIsCreatingCategory(true)
    try {
      await expenseService.createCategory(trimmed)
      if (!categoryOptions.includes(trimmed)) {
        setCategoryOptions((prev) => [...prev, trimmed])
      }
      setCategory(trimmed)
      setNewCategoryName('')
      setIsCategoryOpen(false)
    } catch (err) {
      console.error('Failed to create category:', err)
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const activeTx = currentTx || transaction
  const activeSale = currentSale || sale
  const activeExpense = currentExpense || expense
  const activeLoan = currentLoan || loan

  const resolvedTarget = React.useMemo(() => {
    let type = 'transaction'
    let id: string | number | undefined = undefined
    let ref: string | undefined = undefined

    if (activeSale || activeTx?.type === 'Sales') {
      type = 'sale'
      const rawId = activeSale?.id || activeTx?.id
      id = rawId ? String(rawId).replace(/^sale_/, '') : undefined
      ref = activeSale?.refNo || activeTx?.refNo
    } else if (activeExpense || activeTx?.type === 'Expense') {
      type = 'expense'
      const rawId = activeExpense?.id || activeTx?.id
      id = rawId ? String(rawId).replace(/^(exp|expense)_/, '') : undefined
      ref = activeExpense?.refNo || activeTx?.refNo
    } else if (activeLoan || activeTx?.type === 'Loan') {
      type = 'loan'
      const rawId = activeLoan?.id || activeTx?.id
      id = rawId ? String(rawId).replace(/^loan_/, '').replace(/:lender$/, '') : undefined
      ref = activeLoan?.refNo || activeTx?.refNo
    } else if (activeTx?.type === 'Petty Cash' || (activeTx?.id && String(activeTx.id).startsWith('pc_'))) {
      type = 'petty_cash'
      id = activeTx?.id ? String(activeTx.id).replace('pc_', '').split(':')[0] : undefined
      ref = activeTx?.refNo
    } else if (activeTx?.id && String(activeTx.id).startsWith('tenant_')) {
      type = 'tenant'
      id = activeTx?.id ? String(activeTx.id).replace('tenant_lease_', '').replace('tenant_pmt_', '') : undefined
      ref = activeTx?.refNo
    }

    return { type, id, ref }
  }, [activeSale, activeExpense, activeLoan, activeTx])

  React.useEffect(() => {
    if (!open) {
      setTimelineEvents([])
      return
    }
    let isMounted = true
    setIsLoadingTimeline(true)

    activityLogService
      .getEntityTimeline({
        recordType: resolvedTarget.type,
        recordId: resolvedTarget.id,
        refNo: resolvedTarget.ref,
      })
      .then((events) => {
        if (isMounted) {
          setTimelineEvents(events)
        }
      })
      .catch((err) => {
        console.warn('Could not load entity timeline:', err)
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingTimeline(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [open, resolvedTarget.type, resolvedTarget.id, resolvedTarget.ref])

  const isExpense = Boolean(activeExpense || activeTx?.type === 'Expense')
  const isLoan = Boolean(activeLoan || activeTx?.type === 'Loan')

  const displayRefNo =
    activeSale?.refNo || activeExpense?.refNo || activeLoan?.refNo || activeTx?.refNo || '—'
  const displayCompany =
    activeSale?.company || activeExpense?.company || activeLoan?.company || activeTx?.company || '—'
  const displayCategory = isEditing
    ? category
    : activeSale?.category || activeExpense?.category || activeLoan?.category || activeTx?.category || 'General'
  const displayPaymentMethod = isEditing
    ? paymentMethod
    : activeSale?.paymentMethod || activeExpense?.paymentMethod || activeTx?.paymentMethod || 'Cash'
  const categoryColor =
    CATEGORY_COLORS[displayCategory as keyof typeof CATEGORY_COLORS] || '#475569'

  const displayDate =
    activeSale?.date || activeExpense?.date || activeLoan?.date || activeTx?.date || '—'
  // Sale vs bank deposit (spec 0043): a sale keeps its own date; the deposit date and target bank show
  // when the money cleared so the auditor can verify the sale-day record knowing the bank side.
  const depositSource: any = activeSale || (activeTx?.type === 'Sales' ? activeTx : null)
  const isDepositedSale =
    !!depositSource && (depositSource.depositStatus || depositSource.deposit_status) === 'Deposited'
  const depositDateRaw: string | null | undefined = depositSource?.deposit_date || depositSource?.depositDate
  const depositBankLabel: string | undefined = depositSource
    ? (() => {
        const acc = depositSource.bankAccountId
          ? bankService
              .getCachedAccounts()
              .find((a) => String(a.id) === String(depositSource.bankAccountId))
          : undefined
        if (acc) return `${acc.bankName}${acc.accountName ? ` - ${acc.accountName}` : ''}`
        return depositSource.bankName || undefined
      })()
    : undefined
  // Day remark (spec 0041): one note per company, per date, per kind. Sales and expense records only.
  const dayRemarkKind: 'sales' | 'expense' | null = isLoan
    ? null
    : isExpense
      ? 'expense'
      : activeSale || activeTx?.type === 'Sales'
        ? 'sales'
        : null
  const dayRemarkCompany = displayCompany === '—' ? '' : displayCompany
  const dayRemarkDate =
    activeSale?.rawDate ||
    activeExpense?.rawDate ||
    normalizeDateToYYYYMMDD(activeSale?.date || activeExpense?.date || activeTx?.date || '')
  const { getRemark: getDayRemark, saveRemark: saveDayRemark } = useDailyRemarks(
    dayRemarkKind ?? 'sales',
    dayRemarkKind && dayRemarkCompany ? [dayRemarkCompany] : []
  )
  const canEditDayRemark =
    !viewOnly &&
    (roleLower === 'finance' || roleLower === 'supervisor' || roleLower === 'company')

  const displayChequeNo =
    activeSale?.chequeNo || activeExpense?.chequeNo || activeLoan?.chequeNo || activeTx?.chequeNo || '—'
  const displayParticulars =
    activeSale?.particulars || activeExpense?.particulars || activeLoan?.particulars || activeTx?.particulars || activeTx?.description || '—'
  const displayStatus = isExpense
    ? 'Paid'
    : (activeSale?.status || activeExpense?.status || activeLoan?.status || activeTx?.status || '—')
  const displayCreatedAt =
    activeSale?.createdAt || activeExpense?.createdAt || activeLoan?.createdAt || activeTx?.createdAt
  const rawStoredCreatedBy =
    activeSale?.createdBy || activeExpense?.createdBy || activeLoan?.createdBy || activeTx?.createdBy
  const timelineCreatedEvent = React.useMemo(
    () => timelineEvents.find((e) => e.event_type === 'created'),
    [timelineEvents]
  )
  const displayCreatedBy = React.useMemo(() => {
    const isGenericOrId = (val?: string | null) => {
      const v = (val || '').trim()
      if (!v) return true
      if (/^\d+$/.test(v)) return true
      return ['finance staff', 'company staff', 'authorized staff', 'staff'].includes(v.toLowerCase())
    }
    const storedStr = rawStoredCreatedBy ? String(rawStoredCreatedBy).trim() : ''
    if (
      timelineCreatedEvent?.actor_name &&
      !isGenericOrId(timelineCreatedEvent.actor_name) &&
      isGenericOrId(storedStr)
    ) {
      return formatRealName(timelineCreatedEvent.actor_name, timelineCreatedEvent.actor_role || 'Staff')
    }
    if (storedStr && !/^\d+$/.test(storedStr)) {
      return formatRealName(storedStr, timelineCreatedEvent?.actor_role || 'Staff')
    }
    if (timelineCreatedEvent?.actor_name) {
      return formatRealName(timelineCreatedEvent.actor_name, timelineCreatedEvent.actor_role || 'Staff')
    }
    return '—'
  }, [timelineCreatedEvent, rawStoredCreatedBy])
  const displayUpdatedAt =
    activeSale?.updatedAt || activeExpense?.updatedAt || activeLoan?.updatedAt || activeTx?.updatedAt
  const displayUpdatedBy =
    activeSale?.updatedBy || activeExpense?.updatedBy || activeLoan?.updatedBy || activeTx?.updatedBy
  const displayAuditNotes =
    activeSale?.auditNotes || activeExpense?.auditNotes || activeLoan?.auditNotes || activeTx?.auditNotes
  const displayRemarks =
    activeSale?.remarks || activeExpense?.remarks || activeTx?.remarks || ''

  const timelineRemarksEvent = React.useMemo(() => {
    return [...timelineEvents].reverse().find((e) => {
      if (e.event_type === 'audited') return false
      if (e.notes && String(e.notes).trim()) return true
      return Boolean(e.changes && Object.prototype.hasOwnProperty.call(e.changes, 'remarks'))
    })
  }, [timelineEvents])

  const remarksAuthorInfo = React.useMemo(() => {
    if (!displayRemarks) return null
    if (localRemarksAuthor) return localRemarksAuthor
    if (timelineRemarksEvent?.actor_name) {
      return {
        name: formatRealName(timelineRemarksEvent.actor_name, timelineRemarksEvent.actor_role || 'Staff'),
        timestamp: timelineRemarksEvent.timestamp,
      }
    }
    if ((!displayUpdatedAt || displayUpdatedAt === displayCreatedAt) && displayCreatedBy !== '—') {
      return { name: displayCreatedBy, timestamp: displayCreatedAt }
    }
    return null
  }, [displayRemarks, localRemarksAuthor, timelineRemarksEvent, displayUpdatedAt, displayCreatedAt, displayCreatedBy])

  const handleSaveImmediateRemarks = async () => {
    const targetId = activeSale?.id || activeExpense?.id || activeTx?.id
    if (!targetId) return
    setIsSubmittingRemarks(true)
    try {
      const trimmed = remarksInput.trim()
      if (isExpense || activeTx?.type === 'Expense') {
        const updatedExpense = await expenseService.updateExpenseRemarks(targetId, trimmed)
        setCurrentExpense(updatedExpense)
        const tx = expenseService.toDashboardTransaction(updatedExpense)
        setCurrentTx(tx)
        if (onExpenseUpdated) onExpenseUpdated(updatedExpense)
        if (onTransactionUpdated) onTransactionUpdated(tx)
      } else {
        const updatedSale = await salesService.updateSaleRemarks(targetId, trimmed)
        setCurrentSale(updatedSale)
        const tx = salesService.toDashboardTransaction(updatedSale)
        setCurrentTx(tx)
        if (onSaleUpdated) onSaleUpdated(updatedSale)
        if (onTransactionUpdated) onTransactionUpdated(tx)
      }
      setLocalRemarksAuthor(
        trimmed
          ? {
              name: formatRealName(user?.fullName || user?.email || 'Staff', user?.role || 'Staff'),
              timestamp: new Date().toISOString(),
            }
          : null
      )
      setIsRemarksModalOpen(false)
    } catch (err: any) {
      notifyError(err?.message || 'Failed to update remarks')
    } finally {
      setIsSubmittingRemarks(false)
    }
  }

  const withdrawalVal = isExpense
    ? (activeExpense?.withdrawal ?? activeTx?.withdrawal ?? 0)
    : (activeSale?.withdrawal ?? activeTx?.withdrawal ?? 0)
  const depositVal = isExpense || isLoan
    ? 0
    : (activeSale?.deposit ?? activeTx?.deposit ?? (activeTx?.amount || 0))
  const loanVal = activeLoan?.amount ?? (isLoan ? (activeTx?.amount || activeTx?.withdrawal || 0) : 0)
  const netAmount = isLoan
    ? loanVal
    : isExpense
    ? (activeExpense?.netAmount ?? withdrawalVal)
    : ((depositVal || 0) - (withdrawalVal || 0))

  const currentAuditStatus =
    activeSale?.auditStatus ||
    activeExpense?.auditStatus ||
    activeLoan?.auditStatus ||
    activeTx?.auditStatus ||
    'Pending Audit'

  const isAudited = currentAuditStatus === 'Verified'
  const isEditable = Boolean(!viewOnly && editable && !isAdmin && !isAudited && !isOwner)

  const handleEditInSheet = () => {
    if (isAudited) return
    onOpenChange(false)
    if (isExpense) {
      navigate('/expense/add', {
        state: {
          editExpense: activeExpense || (activeTx?.type === 'Expense' ? activeTx : null),
        },
      })
    } else {
      navigate('/sales/add', {
        state: {
          editSale: activeSale || (activeTx?.type === 'Sales' ? activeTx : null),
        },
      })
    }
  }

  const displayAuditedBy =
    activeSale?.auditedBy ||
    activeExpense?.auditedBy ||
    activeLoan?.auditedBy ||
    activeTx?.auditedBy

  const displayAuditDate =
    activeSale?.auditDate ||
    activeExpense?.auditDate ||
    activeLoan?.auditDate ||
    activeTx?.auditDate

  const handleMarkAudit = async (optionalRemarks?: string) => {
    setIsSubmittingAudit(true)
    const trimmedNotes = (optionalRemarks ?? markAuditRemarks).trim() || undefined
    const today = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    })
    const auditorName = formatRealName(user?.fullName || user?.email || 'Internal Auditor', user?.role || 'Audit Officer')

    try {
      if (activeSale) {
        const updated: SalesItem = {
          ...activeSale,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedNotes,
        }
        setCurrentSale(updated)
        setCurrentTx(salesService.toDashboardTransaction(updated))
        await salesService.updateSaleAuditStatus(updated.id, 'Verified', auditorName, trimmedNotes)
        if (onSaleUpdated) onSaleUpdated(updated)
      } else if (activeExpense) {
        const updated: ExpenseItem = {
          ...activeExpense,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedNotes,
        }
        setCurrentExpense(updated)
        setCurrentTx(expenseService.toDashboardTransaction(updated))
        await expenseService.updateExpenseAuditStatus(updated.id, 'Verified', auditorName, trimmedNotes)
        if (onExpenseUpdated) onExpenseUpdated(updated)
      } else if (activeLoan) {
        const updated: LoanItem = {
          ...activeLoan,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedNotes,
        }
        setCurrentLoan(updated)
        setCurrentTx(loanService.toDashboardTransaction(updated))
        await loanService.updateLoan(updated.id, {
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedNotes,
        })
        if (onLoanUpdated) onLoanUpdated(updated)
      } else if (activeTx) {
        const updated: DashboardTransactionItem = {
          ...activeTx,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedNotes,
        }
        setCurrentTx(updated)
        if (activeTx.type === 'Sales') {
          await salesService.updateSaleAuditStatus(activeTx.id, 'Verified', auditorName, trimmedNotes)
        } else if (activeTx.type === 'Expense') {
          await expenseService.updateExpenseAuditStatus(activeTx.id, 'Verified', auditorName, trimmedNotes)
        } else if (activeTx.type === 'Loan') {
          const loanId = activeTx.id.replace(/:lender$/, '')
          await loanService.updateLoan(loanId, {
            auditStatus: 'Verified',
            auditedBy: auditorName,
            auditDate: today,
            auditNotes: trimmedNotes,
          })
        } else if (activeTx.type === 'Income') {
          const leaseId = activeTx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
          await tenantService.saveAuditReview(leaseId, 'Verified', trimmedNotes)
        }
        if (onTransactionUpdated) onTransactionUpdated(updated)
      }
      setIsMarkAuditModalOpen(false)
      setMarkAuditRemarks('')
    } catch (err: any) {
      console.error('Failed to mark transaction as audited:', err)
      notifyError(err, 'Failed to update audit review. Please try again.')
    } finally {
      setIsSubmittingAudit(false)
    }
  }

  const handleConfirmDiscrepancy = async () => {
    const trimmedRemarks = discrepancyReason.trim()
    if (!trimmedRemarks) return
    setIsSubmittingAudit(true)
    const today = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    })
    const auditorName = formatRealName(user?.fullName || user?.email || 'Internal Auditor', user?.role || 'Audit Officer')

    try {
      if (activeSale) {
        const updated: SalesItem = {
          ...activeSale,
          auditStatus: 'Flagged',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedRemarks,
        }
        setCurrentSale(updated)
        setCurrentTx(salesService.toDashboardTransaction(updated))
        await salesService.updateSaleAuditStatus(updated.id, 'Flagged', auditorName, trimmedRemarks)
        if (onSaleUpdated) onSaleUpdated(updated)
      } else if (activeExpense) {
        const updated: ExpenseItem = {
          ...activeExpense,
          auditStatus: 'Flagged',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedRemarks,
        }
        setCurrentExpense(updated)
        setCurrentTx(expenseService.toDashboardTransaction(updated))
        await expenseService.updateExpenseAuditStatus(updated.id, 'Flagged', auditorName, trimmedRemarks)
        if (onExpenseUpdated) onExpenseUpdated(updated)
      } else if (activeLoan) {
        const updated: LoanItem = {
          ...activeLoan,
          auditStatus: 'Flagged',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedRemarks,
        }
        setCurrentLoan(updated)
        setCurrentTx(loanService.toDashboardTransaction(updated))
        await loanService.updateLoan(updated.id, { auditStatus: 'Flagged', auditedBy: auditorName, auditDate: today, auditNotes: trimmedRemarks })
        if (onLoanUpdated) onLoanUpdated(updated)
      } else if (activeTx) {
        const updated: DashboardTransactionItem = {
          ...activeTx,
          auditStatus: 'Flagged',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedRemarks,
        }
        setCurrentTx(updated)
        if (activeTx.type === 'Sales') {
          await salesService.updateSaleAuditStatus(activeTx.id, 'Flagged', auditorName, trimmedRemarks)
        } else if (activeTx.type === 'Expense') {
          await expenseService.updateExpenseAuditStatus(activeTx.id, 'Flagged', auditorName, trimmedRemarks)
        } else if (activeTx.type === 'Loan') {
          const loanId = activeTx.id.replace(/:lender$/, '')
          await loanService.updateLoan(loanId, { auditStatus: 'Flagged', auditedBy: auditorName, auditDate: today, auditNotes: trimmedRemarks })
        } else if (activeTx.type === 'Income') {
          const leaseId = activeTx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
          await tenantService.saveAuditReview(leaseId, 'Flagged', trimmedRemarks)
        }
        if (onTransactionUpdated) onTransactionUpdated(updated)
      }
      setIsDiscrepancyModalOpen(false)
      setDiscrepancyReason('')
    } catch (err: any) {
      console.error('Failed to flag discrepancy:', err)
      notifyError(err, 'Failed to flag audit discrepancy. Please try again.')
    } finally {
      setIsSubmittingAudit(false)
    }
  }

  const handleUnmarkAudit = async () => {
    setIsSubmittingAudit(true)
    try {
      if (activeSale) {
        const updated: SalesItem = {
          ...activeSale,
          auditStatus: 'Pending Audit',
          auditedBy: undefined,
          auditDate: undefined,
          auditNotes: undefined,
        }
        setCurrentSale(updated)
        setCurrentTx(salesService.toDashboardTransaction(updated))
        await salesService.updateSaleAuditStatus(updated.id, 'Pending Audit')
        if (onSaleUpdated) onSaleUpdated(updated)
      } else if (activeExpense) {
        const updated: ExpenseItem = {
          ...activeExpense,
          auditStatus: 'Pending Audit',
          auditedBy: undefined,
          auditDate: undefined,
          auditNotes: undefined,
        }
        setCurrentExpense(updated)
        setCurrentTx(expenseService.toDashboardTransaction(updated))
        await expenseService.updateExpenseAuditStatus(updated.id, 'Pending Audit')
        if (onExpenseUpdated) onExpenseUpdated(updated)
      } else if (activeLoan) {
        const updated: LoanItem = {
          ...activeLoan,
          auditStatus: 'Pending Audit',
          auditedBy: undefined,
          auditDate: undefined,
          auditNotes: undefined,
        }
        setCurrentLoan(updated)
        setCurrentTx(loanService.toDashboardTransaction(updated))
        await loanService.updateLoan(updated.id, { auditStatus: 'Pending Audit', auditedBy: undefined, auditDate: undefined, auditNotes: undefined })
        if (onLoanUpdated) onLoanUpdated(updated)
      } else if (activeTx) {
        const updated: DashboardTransactionItem = {
          ...activeTx,
          auditStatus: 'Pending Audit',
          auditedBy: undefined,
          auditDate: undefined,
          auditNotes: undefined,
        }
        setCurrentTx(updated)
        if (activeTx.type === 'Sales') {
          await salesService.updateSaleAuditStatus(activeTx.id, 'Pending Audit')
        } else if (activeTx.type === 'Expense') {
          await expenseService.updateExpenseAuditStatus(activeTx.id, 'Pending Audit')
        } else if (activeTx.type === 'Loan') {
          const loanId = activeTx.id.replace(/:lender$/, '')
          await loanService.updateLoan(loanId, { auditStatus: 'Pending Audit', auditedBy: undefined, auditDate: undefined })
        } else if (activeTx.type === 'Income') {
          const leaseId = activeTx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
          await tenantService.saveAuditReview(leaseId, 'Pending Audit')
        }
        if (onTransactionUpdated) onTransactionUpdated(updated)
      }
    } catch (err: any) {
      console.error('Failed to reset audit status:', err)
      notifyError(err, 'Failed to reset audit status. Please try again.')
    } finally {
      setIsSubmittingAudit(false)
    }
  }

  // Itemized particulars parsing (for transactions with 1, 3, or >5 particulars)
  const rawItems = activeSale?.items || activeExpense?.items || activeTx?.items
  const rawParticularsText = displayParticulars
  const parsedParticularItems = React.useMemo(() => {
    return parseParticulars(
      rawParticularsText,
      rawItems,
      isLoan ? loanVal : isExpense ? (withdrawalVal || netAmount) : (depositVal || netAmount)
    )
  }, [rawParticularsText, rawItems, isLoan, isExpense, loanVal, withdrawalVal, depositVal, netAmount])

  const hasMultipleParticulars = parsedParticularItems.length > 1

  const totalItemQuantity = React.useMemo(() => {
    return parsedParticularItems.reduce((sum, item) => sum + (item.quantity || 1), 0)
  }, [parsedParticularItems])

  const totalItemAmount = React.useMemo(() => {
    return parsedParticularItems.reduce((sum, item) => sum + (item.total || 0), 0)
  }, [parsedParticularItems])

  const handleCancel = () => {
    if (activeSale) {
      setDate(activeSale.rawDate || normalizeDateToYYYYMMDD(activeSale.date))
      setChequeNo(activeSale.chequeNo || '')
      setParticulars(activeSale.particulars || '')
      setAmount(String(activeSale.deposit || activeSale.netAmount || ''))
      setCategory(activeSale.category || 'General')
      setPaymentMethod(activeSale.paymentMethod || 'Cash')
    } else if (activeExpense) {
      setDate(activeExpense.rawDate || normalizeDateToYYYYMMDD(activeExpense.date))
      setChequeNo(activeExpense.chequeNo || '')
      setParticulars(activeExpense.particulars || '')
      setAmount(String(activeExpense.withdrawal || activeExpense.netAmount || ''))
      setCategory(activeExpense.category || 'General')
      setPaymentMethod(activeExpense.paymentMethod || 'Cash')
    } else if (activeLoan) {
      setDate(activeLoan.rawDate || normalizeDateToYYYYMMDD(activeLoan.date))
      setChequeNo(activeLoan.chequeNo || '')
      setParticulars(activeLoan.particulars || '')
      setAmount(String(activeLoan.amount || ''))
      setCategory(activeLoan.category || 'General')
      setPaymentMethod('Cash')
    } else if (activeTx) {
      setDate(normalizeDateToYYYYMMDD(activeTx.date))
      setChequeNo(activeTx.chequeNo || '')
      setParticulars(activeTx.particulars || activeTx.description || '')
      const txAmount =
        activeTx.type === 'Expense'
          ? activeTx.withdrawal || activeTx.amount || ''
          : activeTx.type === 'Loan'
          ? activeTx.amount || activeTx.withdrawal || ''
          : activeTx.deposit || activeTx.amount || ''
      setAmount(String(txAmount))
      setCategory(activeTx.category || 'General')
      setPaymentMethod(activeTx.paymentMethod || 'Cash')
    }
    setError('')
    setFieldErrors({})
    setIsEditing(false)
  }

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!isEditable) return
    setError('')
    const errors: { date?: string; particulars?: string; amount?: string; category?: string } = {}

    const todayIso = formatToYYYYMMDD(new Date())
    if (!date.trim()) {
      errors.date = 'Date is required.'
    } else if (date.trim() > todayIso) {
      errors.date = 'Date cannot be in the future (maximum date is today).'
    }

    if (!particulars.trim()) {
      errors.particulars = 'Particulars is required.'
    }

    const cleanAmount = amount.trim().replace(/,/g, '')
    if (!cleanAmount) {
      errors.amount = 'Amount is required.'
    } else if (/[a-zA-Z]/.test(cleanAmount) || !/^\d+(\.\d{1,2})?$/.test(cleanAmount)) {
      errors.amount = 'Amount must be a valid positive number without letters.'
    } else {
      const parsedAmount = parseFloat(cleanAmount)
      if (isNaN(parsedAmount) || parsedAmount < 1.0) {
        errors.amount = 'Amount must be at least 1.00 (cannot be 0 or negative).'
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields.')
      return
    }

    setFieldErrors({})
    setIsSubmitting(true)

    const parsedAmount = parseFloat(cleanAmount)
    const modifierName = formatRealName(user?.fullName || user?.name || user?.email || 'Authorized User', user?.role || 'Staff')
    const nowIso = new Date().toISOString()

    try {
      const targetId =
        activeSale?.id || activeExpense?.id || activeLoan?.id || activeTx?.id
      if (!targetId) throw new Error('Transaction identifier not found.')

      if (isExpense) {
        const updatedExpenseItem = await expenseService.updateExpense(targetId, {
          date: date.trim(),
          chequeNo: chequeNo.trim(),
          particulars: particulars.trim(),
          withdrawal: parsedAmount,
          netAmount: parsedAmount,
          paymentMethod: paymentMethod.trim() || 'Cash',
          category: category.trim() || 'General',
          remarks: remarks.trim(),
          updatedBy: modifierName,
          updatedAt: nowIso,
        })
        if (!updatedExpenseItem) throw new Error('Expense item not found.')
        const mergedExpense = {
          ...updatedExpenseItem,
          remarks: remarks.trim(),
          updatedBy: modifierName,
          updatedAt: nowIso,
        }
        const updatedTxItem = expenseService.toDashboardTransaction(mergedExpense)

        setCurrentExpense(mergedExpense)
        setCurrentTx(updatedTxItem)

        if (onExpenseUpdated) {
          onExpenseUpdated(mergedExpense)
        }
      } else if (isLoan) {
        const updatedLoanItem = await loanService.updateLoan(targetId, {
          date: date.trim(),
          chequeNo: chequeNo.trim(),
          particulars: particulars.trim(),
          amount: parsedAmount,
          category: category.trim() || 'General',
          updatedBy: modifierName,
          updatedAt: nowIso,
        })
        if (!updatedLoanItem) throw new Error('Loan item not found.')
        const mergedLoan = {
          ...updatedLoanItem,
          updatedBy: modifierName,
          updatedAt: nowIso,
        }
        const updatedTxItem = loanService.toDashboardTransaction(mergedLoan)

        setCurrentLoan(mergedLoan)
        setCurrentTx(updatedTxItem)

        if (onLoanUpdated) {
          onLoanUpdated(mergedLoan)
        }
      } else {
        const payload: Partial<NewSalesInput> = {
          date: date.trim(),
          chequeNo: chequeNo.trim(),
          particulars: particulars.trim(),
          amount: parsedAmount,
          paymentMethod: paymentMethod.trim() || 'Cash',
          category: category.trim() || 'General',
          remarks: remarks.trim(),
          updatedBy: modifierName,
          updatedAt: nowIso,
        }

        const updatedSaleItem = await salesService.updateSale(targetId, payload)
        const mergedSale = {
          ...updatedSaleItem,
          remarks: remarks.trim(),
          updatedBy: modifierName,
          updatedAt: nowIso,
        }
        const updatedTxItem = salesService.toDashboardTransaction(mergedSale)

        setCurrentSale(mergedSale)
        setCurrentTx(updatedTxItem)

        if (onSaleUpdated) {
          onSaleUpdated(mergedSale)
        }
      }

      setIsEditing(false)
    } catch (err: any) {
      setError(err?.message || 'Failed to save changes.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!activeTx && !activeSale && !activeExpense && !activeLoan) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setIsEditing(false)
          setError('')
          setFieldErrors({})
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className={cn(
          'rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl transition-all duration-200 max-h-[85vh] overflow-y-auto overflow-x-hidden w-full max-w-[calc(100vw-2rem)]',
          isEditing ? 'sm:max-w-[660px]' : (hasMultipleParticulars ? 'sm:max-w-[780px]' : 'sm:max-w-[660px]')
        )}
      >
        {/* Header */}
        <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
              {isEditing ? (
                <Pencil className="w-5 h-5 text-white" />
              ) : (
                <FileText className="w-5 h-5 text-white" />
              )}
            </div>
            <div>
              <DialogTitle className="text-lg sm:text-xl font-bold text-focus leading-tight">
                {isEditing ? 'Edit Transaction Details' : (isAdmin ? 'Audit Transaction Details' : 'Transaction Details')}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg font-normal mt-0.5">
                {isEditing
                  ? 'Update the transaction details directly below, then save changes'
                  : (isAdmin ? 'Complete audit record and transaction details' : 'Complete transaction record')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Body */}
        {isEditing ? (
          /* ================= EDIT MODE ================= */
          <form onSubmit={handleSave} className="space-y-3.5 pt-3">
            {error && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Date & Cheque No: date field width exact to the end of date icon, cheque no extended */}
            <div className="flex items-start gap-3">
              <div className="w-[126px] shrink-0 space-y-1">
                <Label className="text-xs font-semibold text-focus block">
                  Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="date"
                  max={todayIso}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value)
                    if (fieldErrors.date) {
                      setFieldErrors((prev) => ({ ...prev, date: undefined }))
                    }
                  }}
                  className={cn(
                    'h-9 px-2 text-xs font-medium rounded-xl border-stroke/50',
                    fieldErrors.date && 'border-red-500 focus-visible:ring-red-200'
                  )}
                />
                {fieldErrors.date && (
                  <p className="text-[10px] text-red-600 font-medium leading-tight">{fieldErrors.date}</p>
                )}
              </div>

              <div className="flex-1 space-y-1 min-w-0">
                <Label className="text-xs font-semibold text-focus block">
                  Cheque No. (Optional)
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. CHQ-8892"
                  value={chequeNo}
                  maxLength={50}
                  onChange={(e) => setChequeNo(e.target.value)}
                  className="h-9 rounded-xl border-stroke/50 text-xs font-mono"
                />
              </div>
            </div>

            {/* Particulars */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus block">
                Particulars <span className="text-red-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder={isExpense ? "e.g. Office Supplies" : isLoan ? "e.g. Loan Commitment" : "e.g. Catering Deposit"}
                value={particulars}
                maxLength={255}
                onChange={(e) => {
                  setParticulars(e.target.value)
                  if (fieldErrors.particulars) {
                    setFieldErrors((prev) => ({ ...prev, particulars: undefined }))
                  }
                }}
                className={cn(
                  'h-9 rounded-xl border-stroke/50 text-xs',
                  fieldErrors.particulars && 'border-red-500 focus-visible:ring-red-200'
                )}
              />
              {fieldErrors.particulars && (
                <p className="text-[10px] text-red-600 font-medium">{fieldErrors.particulars}</p>
              )}
            </div>

            {/* Amount & Payment Method */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus block">
                  Amount (PHP) <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="1.00"
                  value={amount}
                  maxLength={20}
                  onKeyDown={(e) => {
                    if (['-', '+', 'e', 'E'].includes(e.key)) {
                      e.preventDefault()
                    }
                  }}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                      setAmount(val)
                      if (fieldErrors.amount) {
                        setFieldErrors((prev) => ({ ...prev, amount: undefined }))
                      }
                    }
                  }}
                  className={cn(
                    'h-9 rounded-xl border-stroke/50 text-xs font-semibold tabular-nums',
                    fieldErrors.amount && 'border-red-500 focus-visible:ring-red-200'
                  )}
                />
                {fieldErrors.amount && (
                  <p className="text-[10px] text-red-600 font-medium">{fieldErrors.amount}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus block">
                  Payment Method
                </Label>
                <Dropdown
                  value={paymentMethod}
                  size="sm"
                  onChange={(val) => setPaymentMethod(String(val))}
                  options={(isExpense ? EXPENSE_PAYMENT_METHODS : SALES_PAYMENT_METHODS).map((pm) => ({
                    value: pm,
                    label: pm,
                  }))}
                  aria-label="Payment Method"
                />
              </div>
            </div>

            {/* Category (Specific Category with Search and Add Specific Category) - Expense Only */}
            {isExpense && (
              <div className="space-y-1" ref={categoryContainerRef}>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-focus block">
                  Category (Specific)
                </Label>
                <span className="text-[10px] text-muted-fg">Configurable dropdown</span>
              </div>
              <div className="relative">
                <Input
                  type="text"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setIsCategoryOpen(true)
                  }}
                  onFocus={() => setIsCategoryOpen(true)}
                  placeholder="Select or enter category…"
                  className="h-9 rounded-xl border-stroke/50 text-xs pr-8 font-medium bg-white"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIsCategoryOpen((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5 rounded cursor-pointer"
                >
                  <ChevronDown
                    className={cn(
                      'w-3.5 h-3.5 transition-transform duration-200',
                      isCategoryOpen && 'rotate-180'
                    )}
                  />
                </button>

                {isCategoryOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-stroke/30 shadow-2xl p-1.5 z-50 max-h-56 overflow-y-auto">
                    <div className="space-y-0.5">
                      {filteredCategoryOptions.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setCategory(opt)
                            setIsCategoryOpen(false)
                          }}
                          className={cn(
                            'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer',
                            category.toLowerCase() === opt.toLowerCase()
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'text-focus/80 hover:bg-slate-50'
                          )}
                        >
                          <span>{opt}</span>
                          {category.toLowerCase() === opt.toLowerCase() && (
                            <Check className="w-3.5 h-3.5 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Quick Add Custom Specific Category */}
                    <div className="pt-2 mt-1.5 border-t border-stroke/20 px-1">
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="text"
                          placeholder="+ Add specific category…"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleAddNewCategory()
                            }
                          }}
                          className="h-7 text-xs rounded-lg px-2 border-stroke/50"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={!newCategoryName.trim() || isCreatingCategory}
                          onClick={handleAddNewCategory}
                          className="h-7 px-2.5 text-[11px] rounded-lg bg-primary text-white hover:bg-primary/90 shrink-0 cursor-pointer"
                        >
                          {isCreatingCategory ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            'Add'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* Remarks (Supervisor and Finance Notes) */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus block">
                Remarks (Optional)
              </Label>
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Add operational notes or remarks…"
                className="w-full rounded-xl border border-stroke/50 text-xs p-2.5 font-normal focus:outline-none focus:ring-1 focus:ring-focus bg-white resize-y"
              />
            </div>

            {/* Read-only Context (Company) */}
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
              <span className="text-[11px] font-medium text-muted-fg">Company:</span>
              <span className="font-semibold text-focus">{displayCompany}</span>
            </div>

            {/* Actions: Cancel & Save Changes */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
                className="h-9 px-4 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-9 px-5 text-xs font-semibold rounded-xl bg-primary hover:bg-primary/90 text-white cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </form>
        ) : (
          /* ================= VIEW MODE ================= */
          <div className="space-y-4 pt-3">
            {/* 1. Primary Amount & Audit Status Banner */}
            <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              {isLoan ? (
                <div>
                  <span className="text-xs font-medium text-muted-fg block">
                    Loan Commitment Amount
                  </span>
                  <span className="text-xl sm:text-2xl font-bold text-focus tabular-nums">
                    {formatPHP(loanVal)}
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-6">
                  {depositVal > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-fg block">
                        Deposit (Money In)
                      </span>
                      <span className="text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
                        +{formatPHP(depositVal)}
                      </span>
                    </div>
                  )}
                  {withdrawalVal > 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-fg block">
                        Withdrawal (Money Out)
                      </span>
                      <span className="text-xl sm:text-2xl font-bold text-rose-700 tabular-nums">
                        −{formatPHP(withdrawalVal)}
                      </span>
                    </div>
                  )}
                  {depositVal <= 0 && withdrawalVal <= 0 && (
                    <div>
                      <span className="text-xs font-medium text-muted-fg block">
                        Net Amount
                      </span>
                      <span className="text-xl sm:text-2xl font-bold text-focus tabular-nums">
                        {formatPHP(netAmount)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:items-end gap-1">
                {currentAuditStatus === 'Verified' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs w-fit">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Audited</span>
                  </span>
                ) : currentAuditStatus === 'Flagged' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs w-fit">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Discrepancy</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs w-fit">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    <span>Pending Audit</span>
                  </span>
                )}
                {displayAuditedBy && currentAuditStatus !== 'Pending Audit' && (
                  <span className="text-xs text-muted-fg">
                    by {formatRealName(displayAuditedBy, 'Audit Officer')}{displayAuditDate ? ` · ${displayAuditDate}` : ''}
                  </span>
                )}
              </div>
            </div>

            {/* 2. Key Details Grid (Label-above-value for easy scanning) */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  Reference No.
                </span>
                <span className="font-mono text-sm font-semibold text-focus break-all mt-0.5 block">
                  {displayRefNo}
                </span>
              </div>

              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  Company
                </span>
                <span className="text-sm font-semibold text-focus break-words mt-0.5 block">
                  {displayCompany}
                </span>
              </div>

              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  {depositSource ? 'Sale Date' : 'Transaction Date'}
                </span>
                <span className="text-sm font-semibold text-focus mt-0.5 block">
                  {displayDate}
                </span>
              </div>

              {isDepositedSale && depositDateRaw && (
                <div className="min-w-0">
                  <span className="text-xs font-medium text-muted-fg block">
                    Deposit Date{depositBankLabel ? ' · Target Bank' : ''}
                  </span>
                  <span className="text-sm font-semibold text-emerald-700 mt-0.5 block">
                    {formatDisplayDate(depositDateRaw)}
                    {depositBankLabel ? <span className="text-focus font-medium"> · {depositBankLabel}</span> : null}
                  </span>
                </div>
              )}

              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  Payment Method
                </span>
                <span className="text-sm font-semibold text-focus mt-0.5 block">
                  {displayPaymentMethod}
                </span>
              </div>

              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  Cheque Number
                </span>
                <span className="font-mono text-sm font-semibold text-focus break-all mt-0.5 block">
                  {displayChequeNo}
                </span>
              </div>

              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  Payment Status
                </span>
                <span className="text-sm font-semibold text-focus mt-0.5 block">
                  {displayStatus}
                </span>
              </div>

              {/* Visible for all roles (Audit, Finance, Supervisor), aligned below Cheque Number */}
              <div className="min-w-0">
                <span className="text-xs font-medium text-muted-fg block">
                  Created By
                </span>
                <span className="text-sm font-semibold text-focus break-words mt-0.5 block">
                  {displayCreatedBy}
                </span>
              </div>

              {isExpense && (
                <div className="min-w-0">
                  <span className="text-xs font-medium text-muted-fg block mb-1">
                    Category
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold select-none max-w-full truncate"
                    style={{
                      backgroundColor: `${categoryColor}15`,
                      color: categoryColor,
                      border: `1px solid ${categoryColor}35`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: categoryColor }}
                    />
                    <span className="truncate">{displayCategory}</span>
                  </span>
                </div>
              )}
            </div>

            {/* 3. Particulars Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 space-y-2.5">
              {hasMultipleParticulars ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-focus">
                      <Receipt className="w-4 h-4 text-[#960C01]" />
                      <span>Itemized Particulars</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                      {parsedParticularItems.length} items
                    </span>
                  </div>

                  {/* Responsive Scrollable Container */}
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 overflow-hidden shadow-2xs">
                    <div className="max-h-[240px] overflow-y-auto divide-y divide-slate-100">
                      <table className="w-full text-left text-xs table-fixed">
                        <colgroup>
                          {parsedParticularItems.some((it) => Boolean(it.status)) ? (
                            <>
                              <col style={{ width: '7%' }} />
                              <col style={{ width: '37%' }} />
                              <col style={{ width: '16%' }} />
                              <col style={{ width: '10%' }} />
                              <col style={{ width: '15%' }} />
                              <col style={{ width: '15%' }} />
                            </>
                          ) : (
                            <>
                              <col style={{ width: '8%' }} />
                              <col style={{ width: '46%' }} />
                              <col style={{ width: '14%' }} />
                              <col style={{ width: '16%' }} />
                              <col style={{ width: '16%' }} />
                            </>
                          )}
                        </colgroup>
                        <thead className="bg-slate-100/90 sticky top-0 text-xs uppercase font-bold text-muted-fg border-b border-slate-200/80 z-10">
                          <tr>
                            <th className="py-2 px-2 text-center">#</th>
                            <th className="py-2 px-2">Item</th>
                            {parsedParticularItems.some((it) => Boolean(it.status)) && (
                              <th className="py-2 px-2 text-center">Status</th>
                            )}
                            <th className="py-2 px-2 text-center">Qty</th>
                            <th className="py-2 px-2 text-right">Price</th>
                            <th className="py-2 px-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {parsedParticularItems.map((item, idx) => (
                            <tr key={item.id || idx} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-2 text-center font-mono text-xs text-muted-fg">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-2 font-medium text-focus break-words [overflow-wrap:anywhere] leading-snug" title={item.particulars}>
                                {item.particulars}
                              </td>
                              {parsedParticularItems.some((it) => Boolean(it.status)) && (
                                <td className="py-2.5 px-2 text-center">
                                  {item.status ? (
                                    <span
                                      className={cn(
                                        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
                                        item.status === 'Paid'
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                          : item.status === 'On hold'
                                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                                          : 'bg-rose-50 text-rose-700 border-rose-200'
                                      )}
                                    >
                                      {item.status}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-fg">—</span>
                                  )}
                                </td>
                              )}
                              <td className="py-2.5 px-2 text-center font-semibold text-focus/80 tabular-nums">
                                {item.quantity}
                              </td>
                              <td className="py-2.5 px-2 text-right text-muted-fg tabular-nums whitespace-nowrap text-xs">
                                {item.unitPrice > 0 ? formatPHP(item.unitPrice) : '—'}
                              </td>
                              <td className="py-2.5 px-2 text-right font-bold text-focus tabular-nums whitespace-nowrap">
                                {formatPHP(item.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Summary row */}
                    <div className="bg-slate-100/95 border-t border-slate-200 px-3.5 py-2.5 flex items-center justify-between text-xs">
                      <span className="text-muted-fg font-medium">
                        Total items: <strong className="text-focus">{parsedParticularItems.length}</strong> ({totalItemQuantity} units)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs uppercase font-bold text-muted-fg">Sum:</span>
                        <span className="font-bold text-focus text-sm tabular-nums">
                          {formatPHP(totalItemAmount || (depositVal || withdrawalVal || loanVal))}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="min-w-0">
                  <span className="text-xs font-medium text-muted-fg block">
                    Particulars
                  </span>
                  <p className="text-sm font-medium text-focus mt-1 break-words [overflow-wrap:anywhere] leading-relaxed">
                    {displayParticulars}
                  </p>
                </div>
              )}
            </div>

            {/* 4. Collapsible Sections (Remarks + Day Remark + Activity Timeline) */}
            <div className="space-y-2.5">
              {/* Remarks (Collapsible Chevron) */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-3.5 py-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setIsRemarksExpanded((prev) => !prev)}
                    aria-expanded={isRemarksExpanded}
                    className="inline-flex items-center gap-2 min-h-[36px] py-1 text-left text-xs font-bold uppercase tracking-wider text-muted-fg hover:text-focus transition-colors cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {isRemarksExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-fg shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-fg shrink-0" />
                    )}
                    <span>Remarks</span>
                    {!isRemarksExpanded && (displayRemarks || displayAuditNotes) && (
                      <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary normal-case tracking-normal">
                        Has note
                      </span>
                    )}
                  </button>
                  {!isAudited && !isOwner && (!viewOnly || isFinance) && (!isAdmin || isFinance) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRemarksInput(displayRemarks || '')
                        setIsRemarksModalOpen(true)
                      }}
                      className="h-8 px-3 text-xs font-semibold rounded-lg border-primary/30 bg-white hover:bg-primary/5 text-primary flex items-center gap-1.5 shrink-0 cursor-pointer"
                      title="Add or update remarks"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-primary" />
                      <span>{displayRemarks ? 'Edit Remarks' : 'Add Remarks'}</span>
                    </Button>
                  )}
                </div>
                {isRemarksExpanded && (
                  <div className="mt-2 pb-1.5 pl-6 space-y-2.5">
                    <div>
                      {displayRemarks ? (
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-focus whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                            {displayRemarks}
                          </p>
                          {remarksAuthorInfo && (
                            <p className="text-xs text-muted-fg">
                              Added by <span className="font-semibold text-focus">{remarksAuthorInfo.name}</span>
                              {remarksAuthorInfo.timestamp
                                ? ` · ${formatTimelineDateTime(remarksAuthorInfo.timestamp)}`
                                : ''}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-fg/70 italic font-normal text-xs">No operational remarks provided</span>
                      )}
                    </div>

                    {displayAuditNotes && (
                      <div
                        className={cn(
                          'rounded-lg border px-3 py-2 text-xs space-y-1',
                          currentAuditStatus === 'Verified'
                            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50/70 border-rose-200 text-rose-900'
                        )}
                      >
                        <span className="font-bold block">
                          {currentAuditStatus === 'Verified' ? 'Audit Remarks' : 'Audit Discrepancy Note'}
                        </span>
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                          {displayAuditNotes}
                        </p>
                        {displayAuditedBy && (
                          <p className="text-[11px] opacity-85">
                            By <span className="font-semibold">{formatRealName(displayAuditedBy, 'Audit Officer')}</span>
                            {displayAuditDate ? ` · ${displayAuditDate}` : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Activity Timeline & Remarks Section (Collapsible Chevron) */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 px-3.5 py-2 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setIsTimelineExpanded((prev) => !prev)}
                  aria-expanded={isTimelineExpanded}
                  className="w-full flex items-center justify-between min-h-[36px] py-1 text-left cursor-pointer rounded-md hover:text-focus transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-fg flex items-center gap-2">
                    {isTimelineExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-fg shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-fg shrink-0" />
                    )}
                    <History className="w-3.5 h-3.5 text-primary" />
                    <span>Activity Timeline & Remarks</span>
                  </span>
                  <span className="text-xs text-muted-fg font-mono">
                    ID: {activeTx?.id || activeSale?.id || activeExpense?.id || '—'}
                  </span>
                </button>

                {isTimelineExpanded && (
                  <div className="rounded-xl border border-stroke/20 bg-white p-3 space-y-2.5 text-xs">
                  {isLoadingTimeline ? (
                    <div className="py-4 flex items-center justify-center gap-2 text-xs text-muted-fg">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span>Loading complete activity timeline...</span>
                    </div>
                  ) : timelineEvents.length > 0 ? (
                    <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-slate-200">
                      {timelineEvents.map((event, idx) => {
                        let iconColor = 'bg-blue-100 text-blue-600 border-blue-200'
                        let IconComponent = FileText
                        if (event.event_type === 'created') {
                          iconColor = 'bg-blue-100 text-blue-600 border-blue-200'
                          IconComponent = PlusCircle
                        } else if (event.event_type === 'edited') {
                          iconColor = 'bg-amber-100 text-amber-700 border-amber-200'
                          IconComponent = Pencil
                        } else if (event.event_type === 'endorsed') {
                          iconColor = 'bg-indigo-100 text-indigo-700 border-indigo-200'
                          IconComponent = UserCheck
                        } else if (event.event_type === 'audited') {
                          const isVer =
                            event.status_badge === 'Verified' ||
                            event.title.toLowerCase().includes('verified') ||
                            event.title.toLowerCase().includes('approved')
                          iconColor = isVer
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-rose-100 text-rose-700 border-rose-200'
                          IconComponent = ShieldCheck
                        } else if (event.event_type === 'disbursed' || event.event_type === 'payment') {
                          iconColor = 'bg-teal-100 text-teal-700 border-teal-200'
                          IconComponent = CheckCircle2
                        }

                        return (
                          <div key={event.id || idx} className="relative flex items-start gap-3 pl-1">
                            <div className={cn('relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border shadow-2xs', iconColor)}>
                              <IconComponent className="h-3 w-3" />
                            </div>
                            <div className="min-w-0 flex-1 rounded-xl border border-stroke/20 bg-white/90 p-2.5 text-xs shadow-2xs space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-focus">{event.title}</span>
                                  {event.status_badge && (
                                    <span
                                      className={cn(
                                        'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
                                        event.status_badge === 'Verified' ||
                                          event.status_badge === 'Approved' ||
                                          event.status_badge === 'Paid' ||
                                          event.status_badge === 'Settled'
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                          : event.status_badge === 'Flagged' ||
                                            event.status_badge.toLowerCase().includes('disapproved')
                                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                                          : 'bg-amber-50 text-amber-700 border-amber-200'
                                      )}
                                    >
                                      {event.status_badge}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-muted-fg font-mono shrink-0">
                                  {formatTimelineDateTime(event.timestamp)}
                                </span>
                              </div>

                              <div className="text-[11px] text-muted-fg flex items-center gap-1.5 flex-wrap">
                                <span>By</span>
                                <span className="font-semibold text-focus">
                                  {formatRealName(event.actor_name, event.actor_role || 'Staff')}
                                </span>
                                {event.actor_role && (
                                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">
                                    {event.actor_role}
                                  </span>
                                )}
                              </div>

                              {event.description && (
                                <p className="text-[11px] text-slate-600 leading-relaxed">
                                  {event.description}
                                </p>
                              )}

                              {/* Changes Diff */}
                              {event.changes && Object.keys(event.changes).length > 0 && (
                                <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                                    Changes Made:
                                  </span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(event.changes).map(([field, val]) => {
                                      const fieldLabel = field.replace(/_/g, ' ')
                                      let changeText = ''
                                      if (typeof val === 'object' && val !== null) {
                                        const fromVal = (val as any).from ?? (val as any).old
                                        const toVal = (val as any).to ?? (val as any).new
                                        changeText = fromVal !== undefined ? `${fromVal} → ${toVal}` : String(toVal)
                                      } else {
                                        changeText = String(val)
                                      }
                                      return (
                                        <span
                                          key={field}
                                          className="inline-flex items-center gap-1 text-[10px] bg-slate-50 border border-slate-200 rounded-md px-1.5 py-0.5"
                                        >
                                          <span className="font-semibold capitalize text-slate-700">{fieldLabel}:</span>
                                          <span className="font-mono text-slate-600">{changeText}</span>
                                        </span>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Notes / Remarks */}
                              {event.notes && (
                                <div className="mt-1.5 p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
                                  <span className="font-semibold block text-[10px] uppercase text-amber-800">Remark / Note:</span>
                                  <span className="whitespace-pre-wrap">{event.notes}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    /* Fallback Timeline */
                    <>
                      {/* Created Event */}
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-focus">
                            Created by{' '}
                            <span className="text-primary font-bold">
                              {formatRealName(displayCreatedBy || 'Authorized Staff', 'Staff')}
                            </span>
                          </span>
                          <span className="text-[10px] text-muted-fg font-mono shrink-0">
                            {formatTimelineDateTime(displayCreatedAt)}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-fg">
                          Initial record added to {displayCompany} ledger
                        </p>
                      </div>

                      {/* Modified Event (if updated) */}
                      {displayUpdatedAt && displayUpdatedAt !== displayCreatedAt && (
                        <div className="pt-2 border-t border-stroke/15 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-focus">
                              Last modified
                              {' '}by{' '}
                              <span className="text-blue-600 font-bold">
                                {formatRealName(displayUpdatedBy || user?.fullName || 'Authorized Staff', user?.role || 'Supervisor')}
                              </span>
                            </span>
                            <span className="text-[10px] text-muted-fg font-mono shrink-0">
                              {formatTimelineDateTime(displayUpdatedAt)}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-fg">
                            Transaction details or items modified
                          </p>
                        </div>
                      )}

                      {/* Audit Review Event */}
                      <div className="pt-2 border-t border-stroke/15 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-focus">
                            {currentAuditStatus === 'Verified' ? (
                              <span className="text-emerald-700 font-bold">
                                Audited & Verified
                                {displayAuditedBy ? ` by ${formatRealName(displayAuditedBy, 'Audit Officer')}` : ''}
                              </span>
                            ) : currentAuditStatus === 'Flagged' ? (
                              <span className="text-rose-700 font-bold">
                                Flagged for Audit Review
                                {displayAuditedBy ? ` by ${formatRealName(displayAuditedBy, 'Audit Officer')}` : ''}
                              </span>
                            ) : (
                              <span className="text-amber-700 font-semibold">
                                Pending Audit Review
                              </span>
                            )}
                          </span>
                          {displayAuditDate && (
                            <span className="text-[10px] text-muted-fg font-mono shrink-0">
                              {formatTimelineDateTime(displayAuditDate)}
                            </span>
                          )}
                        </div>
                        {displayAuditNotes ? (
                          <div
                            className={cn(
                              'mt-2 p-2.5 rounded-xl border text-xs shadow-2xs',
                              currentAuditStatus === 'Verified'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-rose-50 border-rose-200 text-rose-900'
                            )}
                          >
                            <strong
                              className={cn(
                                'font-bold block mb-1 text-[11px] flex items-center gap-1.5',
                                currentAuditStatus === 'Verified' ? 'text-emerald-900' : 'text-rose-900'
                              )}
                            >
                              {currentAuditStatus === 'Verified' ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  Auditor Remarks:
                                </>
                              ) : (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                  Auditor Remarks / Discrepancy Note:
                                </>
                              )}
                            </strong>
                            <p className="leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{displayAuditNotes}</p>
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-fg mt-0.5">
                            {currentAuditStatus === 'Verified'
                              ? 'Approved and verified by Internal Audit.'
                              : currentAuditStatus === 'Flagged'
                              ? 'Flagged for audit review.'
                              : 'Pending review by Internal Audit team.'}
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {/* Reference / Cheque Remark */}
                  {displayChequeNo && displayChequeNo !== '—' && (
                    <div className="flex items-center justify-between pt-2 border-t border-stroke/15 text-[11px]">
                      <span className="text-muted-fg font-medium">
                        Cheque / Reference No:
                      </span>
                      <span className="font-mono font-semibold text-focus bg-white px-2 py-0.5 rounded border border-stroke/30">
                        {displayChequeNo}
                      </span>
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>

            {/* Audit Actions: Mark as Audited (or Re-Audit when already audited), Flag Discrepancy when not audited */}
            {canAudit && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 mt-2 border-t border-stroke/20">
                <div className="text-[11px] text-muted-fg font-medium">
                  {currentAuditStatus === 'Verified' ? (
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      Audited & Verified
                    </span>
                  ) : currentAuditStatus === 'Flagged' ? (
                    <span className="text-rose-700 font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      Discrepancy Flagged
                    </span>
                  ) : (
                    <span className="text-amber-700 font-medium flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      Pending Audit Review
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSubmittingAudit}
                    onClick={() => {
                      setMarkAuditRemarks(displayAuditNotes || '')
                      setIsMarkAuditModalOpen(true)
                    }}
                    className="!h-7 px-2.5 text-[11px] font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                    title={isAudited ? 'Re-Audit' : 'Mark as Audited'}
                  >
                    <CheckCircle2 className="w-3 h-3 text-white shrink-0" />
                    <span>{isAudited ? 'Re-Audit' : 'Mark as Audited'}</span>
                  </Button>

                  {!isAudited && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSubmittingAudit}
                      onClick={() => {
                        setDiscrepancyReason(displayAuditNotes || '')
                        setIsDiscrepancyModalOpen(true)
                      }}
                      className="!h-7 px-2.5 text-[11px] font-semibold rounded-lg border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 inline-flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                      title="Flag Discrepancy"
                    >
                      <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                      <span>Flag Discrepancy</span>
                    </Button>
                  )}

                  {currentAuditStatus !== 'Pending Audit' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isSubmittingAudit}
                      onClick={handleUnmarkAudit}
                      className="!h-7 px-2 text-[11px] font-medium rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                      title="Reset to Pending Audit"
                    >
                      <RotateCcw className="w-3 h-3 text-muted-fg shrink-0" />
                      <span className="hidden sm:inline">Reset</span>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Edit Actions & Audit Lock Footer (Remarks action lives in the Remarks card above) */}
            {(isEditable || (isAudited && !isAdmin)) && (
              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 mt-2 border-t border-stroke/20">
                <div className="flex items-center gap-2">
                  {isEditable && (
                    isLoan ? (
                      <Button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="h-9 px-5 text-xs font-semibold rounded-xl bg-primary hover:bg-primary/90 text-white flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5 text-white" />
                        <span>Edit</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={handleEditInSheet}
                        className="h-9 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                        title="Edit transaction in Excel Sheet"
                      >
                        <Pencil className="w-3.5 h-3.5 text-white" />
                        <span>Edit</span>
                      </Button>
                    )
                  )}

                  {isAudited && !isAdmin && (
                    <span className="text-xs font-medium text-muted-fg bg-slate-100/90 px-3 py-1.5 rounded-xl flex items-center gap-1.5 border border-stroke/30">
                      <Lock className="w-3 h-3 text-slate-500 shrink-0" />
                      <span>Audited</span>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>

      {/* Immediate Remarks Dialog for Finance / Supervisor */}
      <Dialog open={isRemarksModalOpen} onOpenChange={setIsRemarksModalOpen}>
        <DialogContent className="max-w-[460px] rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-focus leading-tight">
                  Update Remarks
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Enter operational remarks for supervisor and finance records.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Remarks
              </Label>
              <textarea
                rows={4}
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                placeholder="Enter remarks or notes here…"
                className="w-full rounded-xl border border-stroke/50 text-xs p-3 font-normal focus:outline-none focus:ring-1 focus:ring-focus bg-white resize-y"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke/15">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingRemarks}
                onClick={() => setIsRemarksModalOpen(false)}
                className="h-8.5 px-3.5 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isSubmittingRemarks}
                onClick={handleSaveImmediateRemarks}
                className="h-8.5 px-4 text-xs font-semibold rounded-xl bg-primary hover:bg-primary/90 text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isSubmittingRemarks ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <span>Save Remarks</span>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Embedded Update Loan Status Modal when opened from transaction details */}
      {activeLoan && (
        <UpdateLoanStatusModal
          open={isUpdateLoanStatusOpen}
          onOpenChange={setIsUpdateLoanStatusOpen}
          loan={activeLoan}
          onSuccess={(updatedLoan) => {
            setCurrentLoan(updatedLoan)
            setCurrentTx(loanService.toDashboardTransaction(updatedLoan))
            if (onLoanUpdated) {
              onLoanUpdated(updatedLoan)
            }
          }}
        />
      )}
      {/* Modal: Mark as Audited (with optional remarks) */}
      <Dialog
        open={isMarkAuditModalOpen}
        onOpenChange={(nextOpen) => {
          if (!isSubmittingAudit) {
            setIsMarkAuditModalOpen(nextOpen)
            if (!nextOpen) setMarkAuditRemarks('')
          }
        }}
      >
        <DialogContent className="max-w-[460px] rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-focus leading-tight">
                  {isAudited ? 'Re-Audit Transaction' : 'Mark as Audited'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Confirm audit verification for this transaction. Adding remarks is optional.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Audit Remarks <span className="text-muted-fg font-normal">(Optional)</span>
              </Label>
              <textarea
                rows={3}
                value={markAuditRemarks}
                onChange={(e) => setMarkAuditRemarks(e.target.value)}
                placeholder="Optional audit remarks or verification notes (leave blank if none)..."
                className="w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-normal leading-relaxed resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingAudit}
                onClick={() => {
                  setIsMarkAuditModalOpen(false)
                  setMarkAuditRemarks('')
                }}
                className="h-9 px-4 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isSubmittingAudit}
                onClick={() => handleMarkAudit(markAuditRemarks)}
                className="h-9 px-4 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSubmittingAudit ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    <span>{isAudited ? 'Confirm Re-Audit' : 'Confirm & Mark Audited'}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Flag Discrepancy Reason */}
      <Dialog open={isDiscrepancyModalOpen} onOpenChange={setIsDiscrepancyModalOpen}>
        <DialogContent className="max-w-[460px] rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-focus leading-tight">
                  Flag Audit Discrepancy
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Describe the discrepancy or required correction for this transaction.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Discrepancy Reason / Remarks <span className="text-rose-600">*</span>
              </Label>
              <textarea
                rows={3}
                value={discrepancyReason}
                onChange={(e) => setDiscrepancyReason(e.target.value)}
                placeholder="e.g. Voucher amount does not match the attached official receipt..."
                className="w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-1 focus:ring-rose-500 font-normal leading-relaxed resize-none"
              />
              {!discrepancyReason.trim() && (
                <p className="text-[10px] text-muted-fg leading-tight">
                  A reason is required so Finance and Operations can address the discrepancy.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingAudit}
                onClick={() => {
                  setIsDiscrepancyModalOpen(false)
                  setDiscrepancyReason('')
                }}
                className="h-9 px-4 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!discrepancyReason.trim() || isSubmittingAudit}
                onClick={handleConfirmDiscrepancy}
                className="h-9 px-4 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSubmittingAudit ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Flagging…</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-white" />
                    <span>Flag Discrepancy</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
