import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Pencil,
  ChevronDown,
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPHP, formatPersonInitialAndLastName } from '@/lib/format'
import { CATEGORY_COLORS } from '@/utils/categoryConstants'
import { normalizeDateToYYYYMMDD, formatToYYYYMMDD } from '@/utils/dateUtils'
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
  initialIsEditing: _initialIsEditing = false,
}) => {
  const navigate = useNavigate()
  const { user } = useSession()
  const roleLower = (user?.role || '').toLowerCase()
  const isAudit = roleLower.includes('audit')
  const isAdmin = roleLower === 'admin' || isAudit
  const isOwner = roleLower === 'owner'
  const canAudit = isAdmin && !isOwner

  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = React.useState(false)
  const [discrepancyReason, setDiscrepancyReason] = React.useState('')
  const [isSubmittingAudit, setIsSubmittingAudit] = React.useState(false)

  const [currentTx, setCurrentTx] = React.useState<DashboardTransactionItem | null>(transaction)
  const [currentSale, setCurrentSale] = React.useState<SalesItem | null>(sale || null)
  const [currentExpense, setCurrentExpense] = React.useState<ExpenseItem | null>(expense || null)
  const [currentLoan, setCurrentLoan] = React.useState<LoanItem | null>(loan || null)
  const [isEditing, setIsEditing] = React.useState(false)
  const [isUpdateLoanStatusOpen, setIsUpdateLoanStatusOpen] = React.useState(false)

  const [timelineEvents, setTimelineEvents] = React.useState<EntityTimelineEvent[]>([])
  const [isLoadingTimeline, setIsLoadingTimeline] = React.useState(false)

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
  const categoryContainerRef = React.useRef<HTMLDivElement>(null)

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
    } else {
      setIsEditing(false)
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
      id = activeSale?.id || (activeTx?.id ? String(activeTx.id).replace('sale_', '') : undefined)
      ref = activeSale?.refNo || activeTx?.refNo
    } else if (activeExpense || activeTx?.type === 'Expense') {
      type = 'expense'
      id = activeExpense?.id || (activeTx?.id ? String(activeTx.id).replace('expense_', '') : undefined)
      ref = activeExpense?.refNo || activeTx?.refNo
    } else if (activeLoan || activeTx?.type === 'Loan') {
      type = 'loan'
      id = activeLoan?.id || (activeTx?.id ? String(activeTx.id).replace('loan_', '') : undefined)
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
  const displayChequeNo =
    activeSale?.chequeNo || activeExpense?.chequeNo || activeLoan?.chequeNo || activeTx?.chequeNo || '—'
  const displayParticulars =
    activeSale?.particulars || activeExpense?.particulars || activeLoan?.particulars || activeTx?.particulars || activeTx?.description || '—'
  const displayStatus = isExpense
    ? 'Paid'
    : (activeSale?.status || activeExpense?.status || activeLoan?.status || activeTx?.status || '—')
  const displayCreatedAt =
    activeSale?.createdAt || activeExpense?.createdAt || activeLoan?.createdAt || activeTx?.createdAt
  const displayCreatedBy =
    activeSale?.createdBy || activeExpense?.createdBy || activeLoan?.createdBy || activeTx?.createdBy || (user?.fullName ? formatRealName(user.fullName, user.role || 'Staff') : undefined)
  const displayUpdatedAt =
    activeSale?.updatedAt || activeExpense?.updatedAt || activeLoan?.updatedAt || activeTx?.updatedAt
  const displayUpdatedBy =
    activeSale?.updatedBy || activeExpense?.updatedBy || activeLoan?.updatedBy || activeTx?.updatedBy
  const displayAuditNotes =
    activeSale?.auditNotes || activeExpense?.auditNotes || activeLoan?.auditNotes || activeTx?.auditNotes

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
  const isEditable = Boolean(editable && !isAdmin && !isAudited && !isOwner)

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

  const handleMarkAudit = async () => {
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
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: undefined,
        }
        setCurrentSale(updated)
        setCurrentTx(salesService.toDashboardTransaction(updated))
        await salesService.updateSaleAuditStatus(updated.id, 'Verified', auditorName)
        if (onSaleUpdated) onSaleUpdated(updated)
      } else if (activeExpense) {
        const updated: ExpenseItem = {
          ...activeExpense,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: undefined,
        }
        setCurrentExpense(updated)
        setCurrentTx(expenseService.toDashboardTransaction(updated))
        await expenseService.updateExpenseAuditStatus(updated.id, 'Verified', auditorName)
        if (onExpenseUpdated) onExpenseUpdated(updated)
      } else if (activeLoan) {
        const updated: LoanItem = {
          ...activeLoan,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: undefined,
        }
        setCurrentLoan(updated)
        setCurrentTx(loanService.toDashboardTransaction(updated))
        await loanService.updateLoan(updated.id, { auditStatus: 'Verified', auditedBy: auditorName, auditDate: today })
        if (onLoanUpdated) onLoanUpdated(updated)
      } else if (activeTx) {
        const updated: DashboardTransactionItem = {
          ...activeTx,
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: undefined,
        }
        setCurrentTx(updated)
        if (activeTx.type === 'Sales') {
          await salesService.updateSaleAuditStatus(activeTx.id, 'Verified', auditorName)
        } else if (activeTx.type === 'Expense') {
          await expenseService.updateExpenseAuditStatus(activeTx.id, 'Verified', auditorName)
        } else if (activeTx.type === 'Loan') {
          const loanId = activeTx.id.replace(/:lender$/, '')
          await loanService.updateLoan(loanId, { auditStatus: 'Verified', auditedBy: auditorName, auditDate: today })
        } else if (activeTx.type === 'Income') {
          const leaseId = activeTx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
          await tenantService.saveAuditReview(leaseId, 'Verified')
        }
        if (onTransactionUpdated) onTransactionUpdated(updated)
      }
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
          updatedBy: modifierName,
          updatedAt: nowIso,
        })
        if (!updatedExpenseItem) throw new Error('Expense item not found.')
        const mergedExpense = {
          ...updatedExpenseItem,
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
          updatedBy: modifierName,
          updatedAt: nowIso,
        }

        const updatedSaleItem = await salesService.updateSale(targetId, payload)
        const mergedSale = {
          ...updatedSaleItem,
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
          isEditing ? 'sm:max-w-[640px]' : (hasMultipleParticulars ? 'sm:max-w-[740px]' : 'sm:max-w-[580px]')
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
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="h-9 w-full rounded-xl border border-stroke/50 text-xs px-2.5 font-medium bg-white focus:outline-none focus:ring-1 focus:ring-focus text-focus cursor-pointer"
                >
                  {(isExpense ? EXPENSE_PAYMENT_METHODS : SALES_PAYMENT_METHODS).map((pm) => (
                    <option key={pm} value={pm}>
                      {pm}
                    </option>
                  ))}
                </select>
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
          <div className="space-y-3 pt-3">
            {/* Outflow vs Inflow Amount Summary Card */}
            {isLoan ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-medium text-muted-fg block">
                    Loan Amount
                  </span>
                  <span className="text-base sm:text-lg font-bold text-focus tabular-nums">
                    {formatPHP(loanVal)}
                  </span>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-slate-200/60 text-slate-700">
                  Loan Commitment
                </span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-medium text-muted-fg block">
                    Withdrawal (Outflow)
                  </span>
                  <span className="text-base sm:text-lg font-bold text-rose-600 tabular-nums">
                    {withdrawalVal > 0 ? formatPHP(withdrawalVal) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-medium text-muted-fg block">
                    Deposit (Inflow)
                  </span>
                  <span className="text-base sm:text-lg font-bold text-emerald-600 tabular-nums">
                    {depositVal > 0 ? formatPHP(depositVal) : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Key-Value Details */}
            <div className="space-y-1.5 text-xs">
              {/* Reference No */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Reference No:
                </span>
                <span className="font-mono text-xs font-semibold text-focus text-right break-all min-w-0">
                  {displayRefNo}
                </span>
              </div>

              {/* 1. Date */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Transaction Date:
                </span>
                <span className="text-xs font-semibold text-focus text-right">
                  {displayDate}
                </span>
              </div>

              {/* 2. Cheque Number */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Cheque Number:
                </span>
                <span className="font-mono text-xs font-semibold text-focus text-right break-all min-w-0">
                  {displayChequeNo}
                </span>
              </div>

              {/* 3. Particulars Section */}
              {hasMultipleParticulars ? (
                <div className="py-2.5 border-b border-stroke/10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-focus">
                      <Receipt className="w-3.5 h-3.5 text-[#960C01]" />
                      <span>Itemized Particulars</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                      {parsedParticularItems.length} particulars recorded
                    </span>
                  </div>

                  {/* Responsive Scrollable Container */}
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 overflow-hidden shadow-2xs">
                    <div className="max-h-[220px] sm:max-h-[260px] overflow-y-auto divide-y divide-slate-100">
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
                        <thead className="bg-slate-100/90 sticky top-0 text-[10px] uppercase font-bold text-muted-fg border-b border-slate-200/80 z-10">
                          <tr>
                            <th className="py-2 px-2 text-center">#</th>
                            <th className="py-2 px-2">Particulars / Item</th>
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
                              <td className="py-2 px-2 text-center font-mono text-[11px] text-muted-fg">
                                {idx + 1}
                              </td>
                              <td className="py-2 px-2 font-medium text-focus break-words [overflow-wrap:anywhere] leading-tight" title={item.particulars}>
                                {item.particulars}
                              </td>
                              {parsedParticularItems.some((it) => Boolean(it.status)) && (
                                <td className="py-2 px-2 text-center">
                                  {item.status ? (
                                    <span
                                      className={cn(
                                        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border',
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
                                    <span className="text-[10px] text-muted-fg">—</span>
                                  )}
                                </td>
                              )}
                              <td className="py-2 px-2 text-center font-semibold text-focus/80 tabular-nums">
                                {item.quantity}
                              </td>
                              <td className="py-2 px-2 text-right text-muted-fg tabular-nums whitespace-nowrap text-[11px]">
                                {item.unitPrice > 0 ? formatPHP(item.unitPrice) : '—'}
                              </td>
                              <td className="py-2 px-2 text-right font-bold text-focus tabular-nums whitespace-nowrap">
                                {formatPHP(item.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Summary row */}
                    <div className="bg-slate-100/95 border-t border-slate-200 px-3 py-2 flex items-center justify-between text-xs">
                      <span className="text-muted-fg font-medium">
                        Total items: <strong className="text-focus">{parsedParticularItems.length}</strong> ({totalItemQuantity} units)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] uppercase font-bold text-muted-fg">Sum:</span>
                        <span className="font-bold text-focus text-sm tabular-nums">
                          {formatPHP(totalItemAmount || (depositVal || withdrawalVal || loanVal))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                  <span className="text-[11px] font-medium text-muted-fg shrink-0">
                    Particulars:
                  </span>
                  <span className="text-xs font-medium text-focus text-right max-w-[280px] break-words [overflow-wrap:anywhere] min-w-0">
                    {displayParticulars}
                  </span>
                </div>
              )}

              {/* Payment Method */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Payment Method:
                </span>
                <span className="text-xs font-semibold text-focus text-right break-words [overflow-wrap:anywhere] min-w-0">
                  {displayPaymentMethod}
                </span>
              </div>

              {/* 4. Category (Expense only) */}
              {isExpense && (
                <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Category:
                </span>
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold select-none break-all max-w-[220px] truncate"
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

              {/* 5. Company */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Company:
                </span>
                <span className="text-xs font-semibold text-focus text-right break-words [overflow-wrap:anywhere] min-w-0">
                  {displayCompany}
                </span>
              </div>

              {/* 6. Payment Status */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10 min-w-0">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Payment Status:
                </span>
                <span className="text-xs font-semibold text-focus text-right">
                  {displayStatus}
                </span>
              </div>

              {/* 7. Amount / Net Amount */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  {isLoan ? 'Loan Amount:' : 'Net Amount:'}
                </span>
                <span className="text-xs sm:text-sm font-bold text-focus text-right tabular-nums">
                  {formatPHP(isLoan ? loanVal : netAmount)}
                </span>
              </div>

              {/* Audit Status */}
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stroke/10">
                <span className="text-[11px] font-medium text-muted-fg shrink-0">
                  Audit Status:
                </span>
                <div className="flex items-center gap-1.5 text-right">
                  {currentAuditStatus === 'Verified' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Audited</span>
                    </span>
                  ) : currentAuditStatus === 'Flagged' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                      <AlertCircle className="w-3 h-3 text-rose-600" />
                      <span>Discrepancy</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shadow-2xs">
                      <Clock className="w-3 h-3 text-amber-600" />
                      <span>Pending Audit</span>
                    </span>
                  )}
                  {displayAuditedBy && currentAuditStatus !== 'Pending Audit' && (
                    <span className="text-[10px] text-muted-fg italic">
                      by {formatRealName(displayAuditedBy, 'Audit Officer')} {displayAuditDate ? `(${displayAuditDate})` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Activity Timeline & Remarks Section */}
              <div className="pt-3 mt-1 border-t border-stroke/20 space-y-2.5">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-primary" />
                    Activity Timeline & Remarks
                  </span>
                  <span className="text-[10px] text-muted-fg font-mono">
                    ID: {activeTx?.id || activeSale?.id || activeExpense?.id || '—'}
                  </span>
                </div>

                <div className="rounded-xl border border-stroke/20 bg-slate-50/70 p-3 space-y-2.5 text-xs">
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
                          <div className="mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs shadow-2xs">
                            <strong className="text-rose-900 font-bold block mb-1 text-[11px] flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                              Auditor Remarks / Discrepancy Note:
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
              </div>
            </div>

            {/* Audit Actions: Mark as Audited, Flag Discrepancy, or Reset */}
            {canAudit && (
              <div className="sticky bottom-0 z-20 bg-white flex flex-wrap items-center justify-between gap-2.5 pt-3 pb-1 mt-2 border-t border-stroke/20">
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

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={isSubmittingAudit}
                    onClick={handleMarkAudit}
                    className="h-9 px-4 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                    title="Mark as Audited"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    <span>{currentAuditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmittingAudit}
                    onClick={() => {
                      setDiscrepancyReason(displayAuditNotes || '')
                      setIsDiscrepancyModalOpen(true)
                    }}
                    className="h-9 px-3.5 text-xs font-semibold rounded-xl border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                    title="Flag Discrepancy"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Flag Discrepancy</span>
                  </Button>

                  {currentAuditStatus !== 'Pending Audit' && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isSubmittingAudit}
                      onClick={handleUnmarkAudit}
                      className="h-9 px-3 text-xs font-medium rounded-xl text-muted-fg hover:text-focus hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                      title="Reset to Pending Audit"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-muted-fg" />
                      <span className="hidden sm:inline">Reset</span>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* View Mode Footer: Strictly read-only until the user clicks the Edit button */}
            {isEditable && (
              <div className="flex items-center justify-end gap-2.5 pt-3 mt-2 border-t border-stroke/20">
                {isLoan ? (
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
                )}
              </div>
            )}

            {/* If transaction has already been audited, operational user can no longer edit */}
            {isAudited && !isAdmin && (
              <div className="flex items-center justify-end gap-2 pt-3 mt-2 border-t border-stroke/20">
                <span className="text-xs font-medium text-muted-fg bg-slate-100/90 px-3.5 py-2 rounded-xl flex items-center gap-2 border border-stroke/30">
                  <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>This transaction has already been audited and can no longer be edited.</span>
                </span>
              </div>
            )}
          </div>
        )}
      </DialogContent>

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
