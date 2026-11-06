import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Wallet,
  Plus,
  Search,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Building2,
  Calendar,
  Check,
  FileSpreadsheet,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Download,
  AlertCircle,
  ArrowUpRight,
  MessageSquare,
  Pencil,
  Trash2,
  MoreVertical,
  Eye,
  Receipt,
  User,
  History,
} from 'lucide-react'
import { ReimbursementModal } from '@/components/dashboard/ReimbursementModal'
import { formatRealName } from '@/utils/formatRealName'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  TopUpPettyCashModal,
} from '@/components/dashboard/TopUpPettyCashModal'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isDateInRange, formatCreatedAt } from '@/utils/dateUtils'
import { notifyError, formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import { getParticularsSummary } from '@/utils/particularsUtils'
import { loanService } from '@/services/loanService'
import { bankService, type BankAccount } from '@/services/bankService'
import {
  pettyCashService,
  type PettyCashLedgerEntry,
} from '@/services/pettyCashService'
import { websocketService } from '@/services/websocketService'

export type PettyCashTransaction = PettyCashLedgerEntry

const COMPANY_LIST = [
  'All Companies',
]

const PERIOD_OPTIONS = ['Daily', 'Quarterly', 'Monthly', 'Annually'] as const
type PeriodType = (typeof PERIOD_OPTIONS)[number]

function downloadReceipt(url: string, name?: string) {
  if (!url) return
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name || 'official_receipt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch {
    window.open(url, '_blank')
  }
}

function formatTimelineDateTime(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export const PettyCashPage: React.FC = () => {
  const { user } = useSession()
  const { activeCompany, setActiveCompany, allCompanies, isCompanyScoped: isStrictlyCompanyScoped } = useCompany()

  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isFinance = userRole === 'finance'
  const isSupervisor = userRole === 'supervisor'
  const isAdmin = userRole === 'admin'
  const isFinanceOrAdmin = isFinance || isAdmin
  const isCompanyScoped = isStrictlyCompanyScoped
  const isOwner = userRole === 'owner'
  const canAuditActions = isAudit && !isOwner
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  // Selected company filter
  const [selectedCompany, setSelectedCompany] = React.useState<string>(() => {
    if (isCompanyScoped && assignedCompany) return assignedCompany
    if (activeCompany && activeCompany !== 'All Companies') return activeCompany
    return activeCompany || 'All Companies'
  })

  // Synchronize with activeCompany
  React.useEffect(() => {
    if (activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany])

  // Dynamic company options from backend
  const [companyList, setCompanyList] = React.useState<string[]>(COMPANY_LIST)

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

  // Company balances & ledger directly from backend
  const [balances, setBalances] = React.useState<Record<string, number>>({})
  const [ledger, setLedger] = React.useState<PettyCashTransaction[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  // Filters state
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<
    'All' | 'Approved' | 'Pending Finance Endorsement' | 'Pending Audit Approval' | 'Disapproved' | 'Expense'
  >('All')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodType>('Monthly')
  const [dateRange, setDateRange] = React.useState<DateRange>({
    startDate: '',
    endDate: '',
    label: 'All Time',
    preset: 'All Time',
  })

  // Dropdowns state
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false)

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)
  const requestDropdownRef = React.useRef<HTMLDivElement>(null)
  const typeDropdownRef = React.useRef<HTMLDivElement>(null)
  const [isRequestDropdownOpen, setIsRequestDropdownOpen] = React.useState(false)
  const [typeFilter, setTypeFilter] = React.useState<'All' | 'Top-up' | 'Reimbursement'>('All')
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = React.useState(false)
  const [isReimbursementModalOpen, setIsReimbursementModalOpen] = React.useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)
  const [itemsPerPage, setItemsPerPage] = React.useState(10)

  // Modals state
  const [isTopUpModalOpen, setIsTopUpModalOpen] = React.useState(false)
  const [isSummaryModalOpen, setIsSummaryModalOpen] = React.useState(false)
  const [previewReceipt, setPreviewReceipt] = React.useState<{ url: string; name: string } | null>(null)
  const [isReviewConfirmModalOpen, setIsReviewConfirmModalOpen] = React.useState(false)

  // Target entry & review data
  const [targetEntry, setTargetEntry] = React.useState<PettyCashTransaction | null>(null)
  const [reviewAction, setReviewAction] = React.useState<'endorse' | 'reject' | 'approve' | 'disapprove'>('endorse')
  const [reviewRemark, setReviewRemark] = React.useState('')
  const [reviewError, setReviewError] = React.useState('')
  const [isSubmittingReview, setIsSubmittingReview] = React.useState(false)

  // Spec 0012: funding bank Finance chooses when endorsing a petty cash request.
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>([])
  const [selectedFundingBankId, setSelectedFundingBankId] = React.useState('')
  const [approvalFeedback, setApprovalFeedback] = React.useState<string | null>(null)

  // Audit Actions Menu State
  const [openMenuPettyId, setOpenMenuPettyId] = React.useState<string | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{ top: number; left: number } | null>(null)
  const [activeMenuPetty, setActiveMenuPetty] = React.useState<PettyCashTransaction | null>(null)

  React.useEffect(() => {
    const handleCloseMenu = () => setOpenMenuPettyId(null)
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('scroll', handleCloseMenu, true)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('scroll', handleCloseMenu, true)
    }
  }, [])

  const handleMarkPettyAudit = (entry: PettyCashTransaction, status: 'Verified' | 'Flagged') => {
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const updatedEntry: PettyCashTransaction = {
      ...entry,
      auditStatus: status,
      auditDate: timestamp,
      auditedBy: formatRealName(user?.fullName || user?.name || user?.email || 'Audit Officer', user?.role || 'Audit Officer'),
      status: status === 'Verified' && entry.status === 'Pending Audit Approval' ? 'Approved' : entry.status,
    }
    setLedger((prev) => prev.map((e) => (e.id === entry.id ? updatedEntry : e)))
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('petty_cash_audit_records')
      } catch {
        // ignore
      }
    }
    setOpenMenuPettyId(null)
  }

  // Load live data from backend database
  const loadData = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const compParam = selectedCompany !== 'All Companies' ? selectedCompany : undefined
      const [summariesRes, ledgerRes] = await Promise.allSettled([
        pettyCashService.getAllSummaries(),
        pettyCashService.getLedger(compParam, {
          startDate: dateRange.startDate || undefined,
          endDate: dateRange.endDate || undefined,
        }),
      ])

      if (summariesRes.status === 'fulfilled') {
        const balanceMap: Record<string, number> = {}
        summariesRes.value.forEach((s) => {
          balanceMap[s.companyName] = s.balance
        })
        setBalances(balanceMap)
      } else {
        console.error('Failed to load petty cash summaries from backend:', summariesRes.reason)
      }

      if (ledgerRes.status === 'fulfilled') {
        setLedger(ledgerRes.value)
      } else {
        console.error('Failed to load petty cash ledger from backend:', ledgerRes.reason)
      }
    } catch (err: any) {
      console.error('Failed to load petty cash data from backend:', err)
      notifyError(err, 'Unable to load petty cash records. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [selectedCompany, dateRange.startDate, dateRange.endDate])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  // Realtime multi-tab WebSocket synchronization
  React.useEffect(() => {
    const unsubscribe = websocketService.subscribe('PETTY_CASH_UPDATED', () => {
      // Another user (for example Audit) changed a top up: drop the 30 second cache so the reload is real
      pettyCashService.invalidateCache()
      loadData()
    })
    return () => {
      unsubscribe()
    }
  }, [loadData])

  // Edit and Delete State for pending petty cash requests
  const [editEntry, setEditEntry] = React.useState<PettyCashTransaction | null>(null)
  const [editAmount, setEditAmount] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [isEditing, setIsEditing] = React.useState(false)
  const [editError, setEditError] = React.useState('')

  const [deleteConfirmEntry, setDeleteConfirmEntry] = React.useState<PettyCashTransaction | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState('')

  const handleOpenEdit = (entry: PettyCashTransaction) => {
    setEditEntry(entry)
    setEditAmount(entry.amountRequested ? String(entry.amountRequested) : '')
    setEditDescription(entry.description || '')
    setEditError('')
  }

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editEntry) return
    const numericAmount = parseFloat(editAmount)
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setEditError('Please enter a valid requested amount greater than 0.')
      return
    }
    setIsEditing(true)
    setEditError('')
    try {
      await pettyCashService.updateTopUp(editEntry.recordId, {
        amount: numericAmount,
        description: editDescription.trim(),
      })
      setEditEntry(null)
      await loadData()
      setApprovalFeedback('Petty cash request updated successfully.')
      setTimeout(() => setApprovalFeedback(null), 5000)
    } catch (err: any) {
      const msg = formatUserFriendlyErrorMessage(err, 'Failed to update request.')
      setEditError(msg)
      notifyError(err, 'Failed to update request.')
    } finally {
      setIsEditing(false)
    }
  }

  const handleOpenDelete = (entry: PettyCashTransaction) => {
    setDeleteConfirmEntry(entry)
    setDeleteError('')
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmEntry) return
    setIsDeleting(true)
    setDeleteError('')
    try {
      await pettyCashService.deleteTopUp(deleteConfirmEntry.recordId)
      setDeleteConfirmEntry(null)
      await loadData()
      setApprovalFeedback('Petty cash request deleted successfully.')
      setTimeout(() => setApprovalFeedback(null), 5000)
    } catch (err: any) {
      const msg = formatUserFriendlyErrorMessage(err, 'Failed to delete request.')
      setDeleteError(msg)
      notifyError(err, 'Failed to delete request.')
    } finally {
      setIsDeleting(false)
    }
  }

  // Close dropdowns on outside click
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
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(target)) {
        setIsCompanyDropdownOpen(false)
      }
      if (requestDropdownRef.current && !requestDropdownRef.current.contains(target)) {
        setIsRequestDropdownOpen(false)
      }
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(target)) {
        setIsTypeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Current balance calculation
  const isAllCompanies = selectedCompany === 'All Companies'
  const currentBalance = React.useMemo(() => {
    if (isAllCompanies) {
      return Object.values(balances).reduce((sum, b) => sum + b, 0)
    }
    if (balances[selectedCompany] !== undefined) {
      return balances[selectedCompany]
    }
    const matchedKey = Object.keys(balances).find((k) => isCompanyMatch(k, selectedCompany))
    if (matchedKey && balances[matchedKey] !== undefined) {
      return balances[matchedKey]
    }
    return 0
  }, [balances, selectedCompany, isAllCompanies])

  // Filtered ledger records
  const filteredLedger = React.useMemo(() => {
    return ledger.filter((item) => {
      // 0. Exclude any seeded sample records
      if (item.referenceNo && item.referenceNo.toUpperCase().startsWith('SEED-')) {
        return false
      }

      // 0.1 If Auditor, hide initial unendorsed transactions
      if (isAudit && (item.status === 'Pending Finance Endorsement' || item.status === 'Pending Finance Approval')) {
        return false
      }

      // 1. Company Filter (using alias & entity matching)
      if (!isAllCompanies) {
        if (!isCompanyMatch(item.companyName, selectedCompany)) {
          return false
        }
      }

      // 2. Status Filter
      if (statusFilter !== 'All') {
        if (statusFilter === 'Approved' && item.status !== 'Approved') return false
        if (
          statusFilter === 'Pending Finance Endorsement' &&
          item.status !== 'Pending Finance Endorsement' &&
          item.status !== 'Pending Finance Approval'
        ) {
          return false
        }
        if (statusFilter === 'Pending Audit Approval' && item.status !== 'Pending Audit Approval') return false
        if (statusFilter === 'Disapproved' && !['Disapproved', 'Rejected', 'Rejected by Finance', 'Disapproved by Audit'].includes(item.status)) {
          return false
        }
        if (statusFilter === 'Expense' && item.type !== 'expense') return false
      }

      // 2b. Type Filter (All / Top-up / Reimbursement)
      if (typeFilter !== 'All') {
        const reqType = (item.requestType || (item.type === 'expense' ? 'expense' : 'topup')).toLowerCase()
        if (typeFilter === 'Top-up' && (reqType !== 'topup' || item.type === 'expense')) return false
        if (typeFilter === 'Reimbursement' && reqType !== 'reimbursement') return false
      }

      // 3. Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesDesc = (item.description || '').toLowerCase().includes(q)
        const matchesComp = (item.companyName || '').toLowerCase().includes(q)
        const matchesCat = (item.category || '').toLowerCase().includes(q)
        const matchesRemark = (item.remark || '').toLowerCase().includes(q)
        const matchesFinRemark = (item.financeRemark || '').toLowerCase().includes(q)
        const matchesPaidBy = (item.paidBy || '').toLowerCase().includes(q)
        const matchesItems = (item.items || '').toLowerCase().includes(q)
        if (!matchesDesc && !matchesComp && !matchesCat && !matchesRemark && !matchesFinRemark && !matchesPaidBy && !matchesItems) {
          return false
        }
      }

      // 4. Date Range Filter
      if (dateRange.startDate && dateRange.endDate) {
        if (!isDateInRange(item.date, dateRange.startDate, dateRange.endDate)) {
          return false
        }
      }

      return true
    })
  }, [ledger, isAllCompanies, selectedCompany, statusFilter, typeFilter, searchQuery, dateRange, isAudit])

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLedger.length / itemsPerPage))
  const paginatedLedger = React.useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return filteredLedger.slice(start, start + itemsPerPage)
  }, [filteredLedger, currentPage, itemsPerPage])

  // Open Transaction Detail Summary
  const handleOpenSummary = (entry: PettyCashTransaction) => {
    setTargetEntry(entry)
    setIsSummaryModalOpen(true)
  }

  // Load bank accounts once, so Finance can pick a funding bank when endorsing (spec 0012).
  React.useEffect(() => {
    let mounted = true
    bankService
      .getAccounts()
      .then((accounts) => {
        if (mounted && accounts) setBankAccounts(accounts)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  // Open Confirmation Modal for Endorse, Reject, Approve or Disapprove
  const handleOpenReviewConfirm = (action: 'endorse' | 'reject' | 'approve' | 'disapprove') => {
    setReviewAction(action)
    setReviewRemark('')
    setReviewError('')
    // For a Finance endorsement, preselect the requesting company's own bank account when it
    // exists (Finance may change it to an outside funder). Otherwise leave it unchosen.
    if (action === 'endorse') {
      const ownAccount = bankAccounts.find((acc) =>
        isCompanyMatch(acc.companyName || '', targetEntry?.companyName || '')
      )
      setSelectedFundingBankId(ownAccount ? ownAccount.id : '')
    } else {
      setSelectedFundingBankId('')
    }
    setIsReviewConfirmModalOpen(true)
  }

  // Submit Review / Endorsement decision with required remark
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetEntry) return

    if (!reviewRemark.trim()) {
      setReviewError('A remark is required when submitting your review decision.')
      return
    }

    // Spec 0012: Finance must choose a funding bank before endorsing top-ups.
    const isReimbursement = (targetEntry.requestType || '').toLowerCase() === 'reimbursement'
    if (reviewAction === 'endorse' && !isReimbursement && !selectedFundingBankId) {
      setReviewError('Please choose a funding bank account before endorsing.')
      return
    }

    setIsSubmittingReview(true)
    setReviewError('')

    try {
      if (reviewAction === 'endorse' || reviewAction === 'reject') {
        await pettyCashService.endorseTopUp(
          targetEntry.recordId,
          reviewAction,
          reviewRemark.trim(),
          reviewAction === 'endorse' ? selectedFundingBankId : undefined,
        )
      } else {
        await pettyCashService.reviewTopUp(targetEntry.recordId, reviewAction, reviewRemark.trim())
      }
      await loadData()

      setIsReviewConfirmModalOpen(false)
      setIsSummaryModalOpen(false)
      setTargetEntry(null)

      let actionText = 'Reviewed'
      if (reviewAction === 'endorse') actionText = 'Endorsed to Audit'
      else if (reviewAction === 'reject') actionText = 'Rejected by Finance'
      else if (reviewAction === 'approve') actionText = 'Approved'
      else if (reviewAction === 'disapprove') actionText = 'Disapproved by Audit'

      setApprovalFeedback(`Petty cash request has been ${actionText} with the remark recorded.`)
      setTimeout(() => setApprovalFeedback(null), 5000)
    } catch (err: any) {
      const msg = formatUserFriendlyErrorMessage(err, 'Failed to submit decision.')
      setReviewError(msg)
      notifyError(err, 'Failed to submit decision.')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  // Handle new request success
  const handleTopUpSuccess = async () => {
    setCurrentPage(1)
    setStatusFilter('All')
    setSearchQuery('')
    await loadData()
    setApprovalFeedback(isFinance ? 'Petty cash top up endorsed directly to Internal Audit.' : 'Petty cash request submitted to the Finance team successfully.')
    setTimeout(() => setApprovalFeedback(null), 5000)
  }

  // Export CSV
  const handleExportCsv = () => {
    setIsExportDropdownOpen(false)
    const headers = [
      'Date',
      'Company',
      'Particulars',
      'Amount Requested (PHP)',
      'Cash In (PHP)',
      'Cash Out (PHP)',
      'Running Balance (PHP)',
      'Status',
      'Remark',
      'Reviewed By',
    ]

    const rows = filteredLedger.map((e) => [
      `"${e.date}"`,
      `"${(e.companyName || '').replace(/"/g, '""')}"`,
      `"${(e.description || '').replace(/"/g, '""')}"`,
      e.amountRequested,
      e.amountIn,
      e.amountOut,
      e.runningBalance,
      `"${e.status}"`,
      `"${(e.remark || '').replace(/"/g, '""')}"`,
      `"${(e.reviewedBy || '').replace(/"/g, '""')}"`,
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute(
      'download',
      `Petty_Cash_${selectedCompany.replace(/\s+/g, '_')}_${dateRange.startDate || 'all'}_to_${dateRange.endDate || 'all'}.csv`
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Export PDF
  const handleExportPdf = () => {
    setIsExportDropdownOpen(false)
    window.print()
  }

  const displayedCompanyTitle = isAllCompanies ? 'All Subsidiaries' : selectedCompany
  const pendingCount = ledger.filter((l) => l.status === 'Pending Finance Approval').length

  return (
    <div className="space-y-6 sm:space-y-8 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300">
      {/* Feedback Banner */}
      {approvalFeedback && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-semibold text-emerald-800 flex items-center justify-between shadow-xs animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{approvalFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setApprovalFeedback(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header Row */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
                Petty Cash
              </h1>
              {pendingCount > 0 && isFinanceOrAdmin && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-700 border border-amber-500/20 animate-pulse">
                  <Clock className="w-3.5 h-3.5" />
                  {pendingCount} Pending Finance Review
                </span>
              )}
            </div>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Petty cash requests, approvals, and disbursements connected live to the MCT database
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 sm:gap-3 self-start sm:self-auto sm:ml-auto shrink-0">
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

            {/* Request Petty Cash Dropdown Button (Hidden for Audit) */}
            {!isAudit && !isOwner && (
              <div ref={requestDropdownRef} className="relative inline-block">
                <Button
                  type="button"
                  onClick={() => setIsRequestDropdownOpen((prev) => !prev)}
                  className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
                  aria-haspopup="true"
                  aria-expanded={isRequestDropdownOpen}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>Request Petty Cash</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 ml-0.5 text-white/90 transition-transform duration-200', isRequestDropdownOpen && 'transform rotate-180')} />
                </Button>

                {isRequestDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                    <button
                      type="button"
                      onClick={() => {
                        setIsRequestDropdownOpen(false)
                        setIsTopUpModalOpen(true)
                      }}
                      className="w-full flex items-start gap-3 p-3 rounded-xl text-left hover:bg-slate-50 transition-colors cursor-pointer group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#960C01]/10 text-[#960C01] flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-[#960C01] group-hover:text-white transition-colors">
                        <Wallet className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-focus group-hover:text-[#960C01] transition-colors">Top-up Request</div>
                        <div className="text-[11px] text-muted-fg leading-snug mt-0.5">
                          Ask for more petty cash funds when your current balance is short.
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsRequestDropdownOpen(false)
                        setIsReimbursementModalOpen(true)
                      }}
                      className="w-full flex items-start gap-3 p-3 rounded-xl text-left hover:bg-slate-50 transition-colors cursor-pointer group border-t border-stroke/20 mt-1"
                    >
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-700 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                        <Receipt className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-focus group-hover:text-amber-700 transition-colors">Reimbursement Request</div>
                        <div className="text-[11px] text-muted-fg leading-snug mt-0.5">
                          Get paid back for expenses you paid out of your own pocket.
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Second Row: Search Bar & Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-1">
          {/* Search Bar & Type Filter Dropdown Group */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
              <Input
                type="search"
                placeholder="Search particulars, company, category…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setCurrentPage(1)
                }}
                className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
              />
            </div>

            {/* Type Filter Dropdown Button */}
            <div ref={typeDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => setIsTypeDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  typeFilter !== 'All' && 'bg-[#960C01]/5 border-[#960C01]/40 text-[#960C01] font-semibold',
                  isTypeDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium">
                  {typeFilter === 'All'
                    ? 'All'
                    : typeFilter === 'Top-up'
                    ? 'Petty Cash Request'
                    : 'Reimbursement'}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
                    isTypeDropdownOpen && 'transform rotate-180'
                  )}
                />
              </button>

              {isTypeDropdownOpen && (
                <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  {[
                    { id: 'All', label: 'All' },
                    { id: 'Top-up', label: 'Petty Cash Request' },
                    { id: 'Reimbursement', label: 'Reimbursement' },
                  ].map((tp) => (
                    <button
                      key={tp.id}
                      type="button"
                      onClick={() => {
                        setTypeFilter(tp.id as any)
                        setIsTypeDropdownOpen(false)
                        setCurrentPage(1)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        typeFilter === tp.id
                          ? 'bg-[#960C01]/10 text-[#960C01] font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{tp.label}</span>
                      {typeFilter === tp.id && (
                        <Check className="h-3.5 w-3.5 text-[#960C01] shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {/* Custom Period Dropdown */}
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
                      onClick={() => {
                        setSelectedPeriod(period)
                        setIsPeriodDropdownOpen(false)
                      }}
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

            {/* Status Filter Dropdown */}
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
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  {[
                    { id: 'All', label: 'All Transactions' },
                    ...(isAudit
                      ? [{ id: 'Pending Audit Approval', label: 'Pending Audit Review' }]
                      : [
                          { id: 'Pending Finance Endorsement', label: 'Pending Finance' },
                          { id: 'Pending Audit Approval', label: 'Pending Audit' },
                        ]),
                    { id: 'Approved', label: 'Approved' },
                    { id: 'Disapproved', label: 'Rejected / Disapproved' },
                    { id: 'Expense', label: 'Expenses' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setStatusFilter(st.id as any)
                        setIsStatusDropdownOpen(false)
                        setCurrentPage(1)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        statusFilter === st.id
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{st.label}</span>
                      {statusFilter === st.id && (
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
              onChange={(newRange) => {
                setDateRange(newRange)
                setCurrentPage(1)
              }}
              hidePresets
            />

            {/* Company Scope Dropdown: ONLY Finance and Audit have the dropdown filter */}
            {!isCompanyScoped && (
              <div ref={companyDropdownRef} className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setIsCompanyDropdownOpen((prev) => !prev)}
                  className={cn(
                    'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                    isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                  )}
                >
                  <span className="font-medium text-focus/90 truncate max-w-[140px]">
                    {selectedCompany}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
                      isCompanyDropdownOpen && 'transform rotate-180'
                    )}
                  />
                </button>

                {isCompanyDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150 max-h-64 overflow-y-auto">
                    {companyList.map((comp) => (
                      <button
                        key={comp}
                        type="button"
                        onClick={() => {
                          setSelectedCompany(comp)
                          setActiveCompany(comp)
                          setIsCompanyDropdownOpen(false)
                          setCurrentPage(1)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                          selectedCompany === comp
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-focus/80 hover:bg-slate-50'
                        )}
                      >
                        <span className="truncate">{comp}</span>
                        {selectedCompany === comp && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Top Summary KPI Card */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-6 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-2xs sm:text-xs font-bold uppercase tracking-wider text-muted-fg">
            Current Balance
          </span>
          <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
            {isLoading ? (
              <Skeleton className="h-7 w-36 rounded-md my-1" />
            ) : (
              formatPHP(currentBalance)
            )}
          </h3>
          <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
            Available petty cash reserve for operational disbursements • {displayedCompanyTitle}
          </p>
        </div>
        <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
          <Wallet className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </Card>

      {/* 3. Main Table Card */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6">
        {/* Clean Table Structure: Reference / Voucher No and Funding Source are Removed */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[1000px]">
            <colgroup>
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  DATE
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  COMPANY
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  TYPE
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  PARTICULARS
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  FUNDING BANK
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  AMOUNT REQUESTED
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  IN (+)
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  OUT (-)
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  RUNNING BALANCE
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  STATUS
                </TableHead>
                <TableHead className="px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={11} />
              ) : paginatedLedger.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-44 text-center text-muted-fg text-xs sm:text-sm">
                    <Wallet className="w-8 h-8 text-muted-fg/40 mx-auto mb-2" />
                    No petty cash transactions found for the selected criteria.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedLedger.map((entry) => {
                  const isPendingFinance = entry.status === 'Pending Finance Endorsement' || entry.status === 'Pending Finance Approval'
                  const isPendingAudit = entry.status === 'Pending Audit Approval'
                  const isApproved = entry.status === 'Approved'
                  const isRejectedFinance = entry.status === 'Rejected by Finance'
                  const isDisapprovedAudit = entry.status === 'Disapproved by Audit' || entry.status === 'Disapproved' || entry.status === 'Rejected'

                  return (
                    <TableRow
                      key={entry.id}
                      onClick={() => handleOpenSummary(entry)}
                      className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer"
                      title="Click transaction to view details or review"
                    >
                      {/* 1. Date */}
                      <TableCell className="px-3 py-3.5 text-xs text-muted-fg tabular-nums font-medium">
                        <div className="flex flex-col gap-0.5">
                          <span>{entry.date}</span>
                          {entry.createdAt && (
                            <span className="text-[10px] text-slate-500 font-normal flex items-center gap-1" title={`Created at: ${formatCreatedAt(entry.createdAt)}`}>
                              <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="tabular-nums">{formatCreatedAt(entry.createdAt, { timeOnly: true })}</span>
                            </span>
                          )}
                          {entry.auditDate && (
                            <span className="text-[10px] text-slate-500 font-normal flex items-center gap-1" title={`Audited at: ${entry.auditDate}`}>
                              <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="truncate max-w-[120px]">{entry.auditDate}</span>
                            </span>
                          )}
                          {entry.auditStatus && (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold w-fit",
                              entry.auditStatus === 'Verified' ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80" : "bg-amber-50 text-amber-700 border border-amber-200/80"
                            )}>
                              {entry.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* 2. Company */}
                      <TableCell className="px-3 py-3.5">
                        <div
                          className="font-semibold text-xs text-focus truncate"
                          title={entry.companyName || ''}
                        >
                          {entry.companyName || '—'}
                        </div>
                      </TableCell>

                      {/* 2b. Type Indicator */}
                      <TableCell className="px-3 py-3.5 text-center">
                        {entry.requestType === 'reimbursement' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-700 border border-amber-500/20 whitespace-nowrap">
                            <Receipt className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Reimbursement</span>
                          </span>
                        ) : entry.type === 'expense' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                            <span>Expense</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-700 border border-blue-500/20 whitespace-nowrap">
                            <Wallet className="w-3 h-3 text-blue-600 shrink-0" />
                            <span>Top-up</span>
                          </span>
                        )}
                      </TableCell>

                      {/* 3. Particulars & Category (Remarks shown in modal per specification) */}
                      <TableCell className="px-3 py-3.5">
                        {entry.requestType === 'reimbursement' && entry.paidBy && (
                          <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1 mb-1">
                            <User className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">Paid by: <strong>{formatRealName(entry.paidBy)}</strong></span>
                            {entry.receiptUrl && (
                              <span className="inline-flex items-center text-[10px] text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200/60 ml-1">
                                <Receipt className="w-2.5 h-2.5 text-emerald-600 mr-0.5" />
                                Receipt
                              </span>
                            )}
                          </div>
                        )}
                        {(() => {
                          const summary = getParticularsSummary(entry.description)
                          if (summary.count > 1) {
                            return (
                              <div className="flex items-center gap-1.5 min-w-0" title={entry.description}>
                                <span className="font-semibold text-xs text-focus truncate block">{summary.firstItemName}</span>
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                  +{summary.count - 1} more
                                </span>
                              </div>
                            )
                          }
                          return (
                            <div className="font-semibold text-xs text-focus line-clamp-1" title={entry.description}>
                              {summary.firstItemName || '—'}
                            </div>
                          )
                        })()}
                        <div className="text-[11px] text-muted-fg line-clamp-1 mt-0.5">
                          {entry.category || 'General'}
                        </div>
                      </TableCell>

                      {/* 3b. Funding Bank (spec 0014): the bank Finance chose and the company that owns it */}
                      <TableCell className="px-3 py-3.5">
                        {entry.fundingBankName ? (
                          <div className="min-w-0" title={`${entry.fundingBankName} · ${entry.fundingAccountName || ''} (${entry.fundingCompanyName || ''})`}>
                            <div className="font-semibold text-xs text-focus truncate">{entry.fundingBankName}</div>
                            <div className="text-[11px] text-muted-fg truncate">
                              {entry.isOwnAccount ? 'Own account' : entry.fundingCompanyName || ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-fg/60 text-xs">—</span>
                        )}
                      </TableCell>

                      {/* 4. Amount Requested */}
                      <TableCell className="px-3 py-3.5 text-right font-semibold text-xs text-focus tabular-nums">
                        {entry.amountRequested > 0 ? formatPHP(entry.amountRequested) : '—'}
                      </TableCell>

                      {/* 5. In (+) */}
                      <TableCell className="px-3 py-3.5 text-right font-bold text-xs text-emerald-700 tabular-nums">
                        {isApproved && entry.amountIn > 0 ? formatPHP(entry.amountIn) : '—'}
                      </TableCell>

                      {/* 6. Out (-) */}
                      <TableCell className="px-3 py-3.5 text-right font-bold text-xs text-rose-600 tabular-nums">
                        {entry.amountOut > 0 ? formatPHP(entry.amountOut) : '—'}
                      </TableCell>

                      {/* 7. Running Balance */}
                      <TableCell className="px-3 py-3.5 text-right font-semibold text-xs text-focus tabular-nums">
                        {formatPHP(entry.runningBalance)}
                      </TableCell>

                      {/* 8. Status */}
                      <TableCell className="px-3 py-3.5 text-center">
                        {isPendingFinance ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-700 border border-amber-500/20 whitespace-nowrap">
                            <Clock className="w-3 h-3 shrink-0" />
                            <span>Pending Finance</span>
                          </span>
                        ) : isPendingAudit ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/10 text-indigo-700 border border-indigo-500/20 whitespace-nowrap">
                            <Clock className="w-3 h-3 shrink-0" />
                            <span>Pending Audit</span>
                          </span>
                        ) : isRejectedFinance ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
                            <XCircle className="w-3 h-3" />
                            <span>Rejected (Finance)</span>
                          </span>
                        ) : isDisapprovedAudit ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
                            <XCircle className="w-3 h-3" />
                            <span>Disapproved (Audit)</span>
                          </span>
                        ) : entry.type === 'expense' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200 whitespace-nowrap">
                            <ArrowUpRight className="w-3 h-3" />
                            <span>Expense</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                            <Check className="w-3 h-3" />
                            <span>Approved</span>
                          </span>
                        )}
                      </TableCell>

                      {/* 9. Actions */}
                      <TableCell className="px-3 py-3.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {canAuditActions ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              const rect = e.currentTarget.getBoundingClientRect()
                              setMenuPosition({
                                top: rect.bottom + window.scrollY + 4,
                                left: Math.min(window.innerWidth - 180, Math.max(10, rect.right + window.scrollX - 160)),
                              })
                              setActiveMenuPetty(entry)
                              setOpenMenuPettyId(openMenuPettyId === entry.id ? null : entry.id)
                            }}
                            className="h-7 w-7 p-0 rounded-lg text-slate-500 hover:text-focus hover:bg-slate-100 cursor-pointer"
                            title="Audit Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        ) : isOwner ? (
                          <span className="text-muted-fg text-xs">—</span>
                        ) : isPendingFinance && entry.type === 'topup' ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenEdit(entry)}
                              className="h-7 w-7 p-0 rounded-lg text-slate-500 hover:text-focus hover:bg-slate-100 cursor-pointer"
                              title="Edit Top Up Request"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenDelete(entry)}
                              className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                              title="Delete Top Up Request"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenSummary(entry)}
                            className="h-7 px-2 text-[11px] text-muted-fg hover:text-focus hover:bg-slate-100 rounded-lg cursor-pointer"
                            title="View details"
                          >
                            View
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

        {/* Pagination Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-5 mt-2 border-t border-slate-100 text-xs text-muted-fg">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="h-7 px-2 rounded-lg border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span className="ml-2">
              Showing {filteredLedger.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to{' '}
              {Math.min(currentPage * itemsPerPage, filteredLedger.length)} of {filteredLedger.length} records
            </span>
          </div>

          <div className="flex items-center gap-1 self-end sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 p-0 border-stroke/60"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs font-semibold px-2">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 w-8 p-0 border-stroke/60"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* MODAL 1: Transaction Detail & Action Dialog on Row Click */}
      <Dialog open={isSummaryModalOpen} onOpenChange={setIsSummaryModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="pb-3 border-b border-stroke/20">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                <span>Petty Cash Transaction Details</span>
              </DialogTitle>
              <span
                className={cn(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider',
                  targetEntry?.status === 'Approved' && 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                  targetEntry?.status === 'Pending Finance Approval' &&
                    'bg-amber-50 text-amber-700 border border-amber-200',
                  (targetEntry?.status === 'Disapproved' || targetEntry?.status === 'Rejected') &&
                    'bg-red-50 text-red-700 border border-red-200'
                )}
              >
                {targetEntry?.status}
              </span>
            </div>
            <DialogDescription className="text-xs text-muted-fg">
              {targetEntry?.companyName} • {targetEntry?.date}
            </DialogDescription>
          </DialogHeader>

          {targetEntry && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 border border-stroke/30 text-xs">
                <div>
                  <span className="text-[11px] text-muted-fg">Transaction Date</span>
                  <div className="font-semibold text-focus mt-0.5">{targetEntry.date}</div>
                  {targetEntry.createdAt && (
                    <div className="text-[11px] text-slate-500 font-normal mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                      <span>Created: {formatCreatedAt(targetEntry.createdAt)}</span>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-[11px] text-muted-fg">Subsidiary / Company</span>
                  <div className="font-semibold text-focus mt-0.5">{targetEntry.companyName}</div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-fg">Amount Requested</span>
                  <div className="font-semibold text-focus mt-0.5">
                    {targetEntry.amountRequested > 0 ? formatPHP(targetEntry.amountRequested) : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-fg">Cash In (Received)</span>
                  <div className="font-bold text-emerald-700 mt-0.5">
                    {targetEntry.status === 'Approved' && targetEntry.amountIn > 0
                      ? formatPHP(targetEntry.amountIn)
                      : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-fg">Cash Out (Spent)</span>
                  <div className="font-bold text-rose-600 mt-0.5">
                    {targetEntry.amountOut > 0 ? formatPHP(targetEntry.amountOut) : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-muted-fg">Running Balance</span>
                  <div className="font-bold text-focus mt-0.5">{formatPHP(targetEntry.runningBalance)}</div>
                </div>
              </div>

              {/* If Reimbursement: Show Paid By, Line Items, and Receipt Proof */}
              {targetEntry.requestType === 'reimbursement' && (
                <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/60 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Receipt className="w-3.5 h-3.5 text-amber-700" />
                      <span>Reimbursement Details</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-800">
                      Paid By: {targetEntry.paidBy || 'Employee'}
                    </span>
                  </div>

                  {/* Line Items breakdown if present */}
                  {(() => {
                    if (!targetEntry.items) return null
                    try {
                      const items: Array<{ particulars: string; category?: string; amount: number }> = JSON.parse(targetEntry.items)
                      if (!Array.isArray(items) || items.length === 0) return null
                      return (
                        <div className="rounded-lg border border-amber-200/80 overflow-hidden bg-white mt-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-amber-100/50 text-amber-900 font-bold border-b border-amber-200/60 text-[11px]">
                                <th className="px-3 py-1.5 text-left">Particulars</th>
                                <th className="px-3 py-1.5 text-left">Category</th>
                                <th className="px-3 py-1.5 text-right">Amount (₱)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-100">
                              {items.map((it, idx) => (
                                <tr key={idx}>
                                  <td className="px-3 py-1.5 text-focus font-medium">{it.particulars}</td>
                                  <td className="px-3 py-1.5 text-muted-fg">{it.category || '—'}</td>
                                  <td className="px-3 py-1.5 text-right font-semibold text-focus tabular-nums">{formatPHP(it.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    } catch {
                      return null
                    }
                  })()}

                  {/* Receipt Attachments Section */}
                  {(() => {
                    let files: Array<{ file_url: string; file_name: string; file_size?: number }> = []
                    if (targetEntry.attachments) {
                      try {
                        const parsed = typeof targetEntry.attachments === 'string'
                          ? JSON.parse(targetEntry.attachments)
                          : targetEntry.attachments
                        if (Array.isArray(parsed)) {
                          files = parsed.map((item: any, idx: number) => ({
                            file_url: item.file_url || item.url || '',
                            file_name: item.file_name || item.name || item.filename || `Receipt #${idx + 1}`,
                            file_size: item.file_size || item.size,
                          })).filter((f) => Boolean(f.file_url))
                        }
                      } catch {
                        // ignore
                      }
                    }
                    if (files.length === 0 && targetEntry.receiptUrl) {
                      files = [{ file_url: targetEntry.receiptUrl, file_name: 'Official Receipt' }]
                    }

                    if (files.length === 0) {
                      return (
                        <div className="pt-1">
                          <span className="text-[11px] font-semibold text-focus block mb-1">Receipt / Proof Attachments:</span>
                          <div className="p-3 rounded-xl bg-slate-50 border border-stroke/30 text-xs text-muted-fg italic flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>No receipt attached</span>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div className="pt-1 space-y-2">
                        <span className="text-[11px] font-semibold text-focus block">
                          Receipt / Proof Attachments ({files.length}):
                        </span>
                        {files.map((file, fIdx) => (
                          <div key={fIdx} className="p-2.5 rounded-xl bg-white border border-stroke/40 flex items-center justify-between gap-3 shadow-2xs">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-focus truncate max-w-[200px] sm:max-w-[280px]">
                                  {file.file_name}
                                </div>
                                <div className="text-[10px] text-emerald-700 font-medium">Verified attachment</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setPreviewReceipt({ url: file.file_url, name: file.file_name })}
                                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-[#960C01] bg-[#960C01]/10 hover:bg-[#960C01]/20 flex items-center gap-1 transition-colors cursor-pointer"
                                title="Preview proof"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>View</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadReceipt(file.file_url, file.file_name)}
                                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-white bg-[#960C01] hover:bg-[#800a01] flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                                title="Download proof"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Download</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Funding bank chosen by Finance (spec 0014). Top ups and requests only, never the account number. */}
              {targetEntry.type !== 'expense' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-stroke/30 space-y-1 text-xs">
                  <span className="text-[11px] font-bold text-muted-fg uppercase tracking-wider block">
                    Funding Bank
                  </span>
                  {targetEntry.fundingBankName ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-[11px] text-muted-fg">Bank</span>
                        <div className="font-semibold text-focus mt-0.5">{targetEntry.fundingBankName}</div>
                        {targetEntry.fundingAccountName && (
                          <div className="text-[11px] text-slate-500">{targetEntry.fundingAccountName}</div>
                        )}
                      </div>
                      <div>
                        <span className="text-[11px] text-muted-fg">Bank Owner Company</span>
                        <div className="font-semibold text-focus mt-0.5">
                          {targetEntry.fundingCompanyName || '—'}
                        </div>
                        {targetEntry.isOwnAccount && (
                          <div className="text-[11px] text-emerald-700 font-medium">Own account</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-fg italic">Not assigned yet</div>
                  )}
                </div>
              )}

              <div className="space-y-1 text-xs">
                <span className="font-semibold text-focus">Particulars / Description</span>
                <p className="p-3 rounded-xl bg-surface border border-stroke/40 text-focus leading-relaxed text-xs">
                  {targetEntry.description}
                </p>
              </div>

              {/* Activity Timeline & Remarks Section (unified without circle bullet) */}
              <div className="pt-3 mt-1 border-t border-stroke/20 space-y-2.5">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-primary" />
                    Activity Timeline & Remarks
                  </span>
                  <span className="text-[10px] text-muted-fg font-mono">
                    ID: {targetEntry.id || '—'}
                  </span>
                </div>

                <div className="rounded-xl border border-stroke/20 bg-slate-50/70 p-3 space-y-2.5 text-xs">
                  {/* Created / Requested Event */}
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-focus">
                        {targetEntry.requestType === 'reimbursement' ? 'Reimbursement filed by' : 'Requested by'}{' '}
                        <span className="text-primary font-bold">
                          {formatRealName(targetEntry.requestedBy || targetEntry.paidBy || 'Employee', 'Staff')}
                        </span>
                      </span>
                      <span className="text-[10px] text-muted-fg font-mono shrink-0">
                        {formatTimelineDateTime(targetEntry.createdAt || targetEntry.date)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-fg mt-0.5">
                      {targetEntry.requestType === 'reimbursement'
                        ? `Filed for ${targetEntry.companyName || 'Company'} petty cash fund`
                        : `Top-up request initiated for ${targetEntry.companyName || 'Company'}`}
                    </p>
                  </div>

                  {/* Finance Endorsement Event */}
                  {(targetEntry.endorsedBy || targetEntry.financeRemark) && (
                    <div className="pt-2 border-t border-stroke/15 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-focus">
                          {targetEntry.endorsedBy ? (
                            <>
                              Endorsed by Finance:{' '}
                              <span className="text-blue-600 font-bold">{formatRealName(targetEntry.endorsedBy, 'Finance Officer')}</span>
                            </>
                          ) : (
                            <span className="text-blue-600 font-semibold">Finance Endorsement</span>
                          )}
                        </span>
                        {targetEntry.endorsedAt && (
                          <span className="text-[10px] text-muted-fg font-mono shrink-0">
                            {formatTimelineDateTime(targetEntry.endorsedAt)}
                          </span>
                        )}
                      </div>
                      {targetEntry.financeRemark && (
                        <div className="mt-1.5 p-2 rounded-lg bg-blue-50/90 border border-blue-200/80 text-blue-900 text-[11px] italic">
                          Remarks: &ldquo;{targetEntry.financeRemark}&rdquo;
                        </div>
                      )}
                    </div>
                  )}

                  {/* Audit Review Event */}
                  <div className="pt-2 border-t border-stroke/15 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-focus">
                        {targetEntry.status === 'Approved' ? (
                          <span className="text-emerald-700 font-bold">
                            Audited & Approved
                            {targetEntry.reviewedBy ? ` by ${formatRealName(targetEntry.reviewedBy, 'Audit Officer')}` : ''}
                          </span>
                        ) : targetEntry.status === 'Disapproved' ? (
                          <span className="text-rose-700 font-bold">
                            Rejected / Disapproved
                            {targetEntry.reviewedBy ? ` by ${formatRealName(targetEntry.reviewedBy, 'Audit Officer')}` : ''}
                          </span>
                        ) : targetEntry.status === 'Pending Audit Approval' ? (
                          <span className="text-amber-700 font-semibold">
                            Pending Audit Review
                          </span>
                        ) : (
                          <span className="text-slate-600 font-medium">
                            {targetEntry.status}
                          </span>
                        )}
                      </span>
                      {targetEntry.reviewedAt && (
                        <span className="text-[10px] text-muted-fg font-mono shrink-0">
                          {formatTimelineDateTime(targetEntry.reviewedAt)}
                        </span>
                      )}
                    </div>
                    {targetEntry.remark ? (
                      <div className="mt-1.5 p-2 rounded-lg bg-amber-50/90 border border-amber-200/80 text-amber-900 text-[11px] italic">
                        Remarks: &ldquo;{targetEntry.remark}&rdquo;
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-fg mt-0.5">
                        {targetEntry.status === 'Approved'
                          ? 'Approved by Internal Audit.'
                          : targetEntry.status === 'Disapproved'
                          ? 'Request rejected by reviewer.'
                          : 'Awaiting audit review and verification.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-stroke/20 gap-2 flex-wrap">


                {/* Pending Finance: Allow Edit / Delete for topups */}
                {targetEntry.type === 'topup' &&
                  (targetEntry.status === 'Pending Finance Endorsement' || targetEntry.status === 'Pending Finance Approval') &&
                  !isAudit && !isOwner && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const item = targetEntry
                          setIsSummaryModalOpen(false)
                          handleOpenEdit(item)
                        }}
                        className="h-9 px-3 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit Request</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const item = targetEntry
                          setIsSummaryModalOpen(false)
                          handleOpenDelete(item)
                        }}
                        className="h-9 px-3 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Request</span>
                      </Button>
                    </div>
                  )}

                {/* Finance Team Actions: Endorse to Audit or Reject */}
                {!isAudit && isFinanceOrAdmin && (targetEntry.status === 'Pending Finance Endorsement' || targetEntry.status === 'Pending Finance Approval') && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleOpenReviewConfirm('reject')}
                      className="h-9 px-4 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleOpenReviewConfirm('endorse')}
                      className="h-9 px-4 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Endorse to Audit</span>
                    </Button>
                  </div>
                )}

                {/* Audit Team Actions: Approve or Disapprove */}
                {canAuditActions && targetEntry.status === 'Pending Audit Approval' && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleOpenReviewConfirm('disapprove')}
                      className="h-9 px-4 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Disapprove</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleOpenReviewConfirm('approve')}
                      className="h-9 px-4 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL 2: Confirmation Modal with Mandatory Remark */}
      <Dialog open={isReviewConfirmModalOpen} onOpenChange={setIsReviewConfirmModalOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="pb-3 border-b border-stroke/20">
            <DialogTitle
              className={cn(
                'text-lg font-bold flex items-center gap-2',
                reviewAction === 'endorse' || reviewAction === 'approve' ? 'text-emerald-800' : 'text-rose-700'
              )}
            >
              {reviewAction === 'endorse' ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Confirm Finance Endorsement to Audit</span>
                </>
              ) : reviewAction === 'reject' ? (
                <>
                  <XCircle className="w-5 h-5 text-rose-600" />
                  <span>Confirm Finance Rejection</span>
                </>
              ) : reviewAction === 'approve' ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Confirm Petty Cash Audit Approval</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-rose-600" />
                  <span>Confirm Petty Cash Audit Disapproval</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg pt-1">
              {reviewAction === 'endorse'
                ? `You are endorsing this petty cash request for ${targetEntry?.companyName} to the Internal Audit team. An endorsement remark is required.`
                : reviewAction === 'reject'
                ? `You are rejecting this petty cash request for ${targetEntry?.companyName} as Finance. A rejection remark is required.`
                : reviewAction === 'approve'
                ? `You are granting final Audit approval for ${targetEntry?.companyName}'s petty cash top-up. A remark is required.`
                : `You are disapproving this petty cash request for ${targetEntry?.companyName} upon Audit compliance review. A remark is required.`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitReview} className="space-y-4 pt-2">
            {reviewError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reviewError}</span>
              </div>
            )}

            {/* Transaction Brief */}
            <div className="p-3 rounded-xl bg-slate-50 border border-stroke/30 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-fg">Company:</span>
                <span className="font-semibold text-focus">{targetEntry?.companyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Amount:</span>
                <span className="font-bold text-focus">{formatPHP(targetEntry?.amountRequested || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Particulars:</span>
                <span className="font-medium text-focus truncate max-w-[240px]">{targetEntry?.description}</span>
              </div>
            </div>

            {/* Funding Bank Picker (Finance endorsement only, spec 0012) */}
            {reviewAction === 'endorse' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Funding Bank Account <span className="text-red-500">* (Required)</span>
                </Label>
                <div className="relative">
                  <select
                    value={selectedFundingBankId}
                    onChange={(e) => {
                      setSelectedFundingBankId(e.target.value)
                      if (reviewError) setReviewError('')
                    }}
                    className="w-full h-11 pl-3 pr-9 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none focus:ring-2 focus:ring-focus appearance-none cursor-pointer"
                    required
                  >
                    <option value="" disabled>
                      Choose the bank that funds this top-up...
                    </option>
                    {bankAccounts.map((acc) => {
                      const isOwn = isCompanyMatch(acc.companyName || '', targetEntry?.companyName || '')
                      return (
                        <option key={acc.id} value={acc.id}>
                          {acc.bankName} · {acc.accountName} ({acc.companyName})
                          {isOwn ? ' — own account, no deduction' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
                </div>
                {bankAccounts.length === 0 && (
                  <p className="text-[11px] text-amber-700 font-medium">
                    No bank accounts found. Add a bank account before endorsing.
                  </p>
                )}
                <p className="text-[11px] text-muted-fg">
                  Pick the requesting company's own account to fund it without any bank deduction.
                  Pick a different company's account and the amount is withdrawn from it and
                  deposited into {targetEntry?.companyName}'s bank on approval.
                </p>
              </div>
            )}

            {/* Mandatory Remark Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-focus block">
                  Remark / Justification <span className="text-red-500">* (Required)</span>
                </Label>
                <span className="text-[11px] text-muted-fg font-medium">Mandatory</span>
              </div>
              <textarea
                value={reviewRemark}
                onChange={(e) => {
                  setReviewRemark(e.target.value)
                  if (reviewError) setReviewError('')
                }}
                rows={3}
                placeholder={
                  reviewAction === 'endorse'
                    ? 'Enter finance endorsement notes, budget availability, or verification remarks (required)...'
                    : reviewAction === 'reject'
                    ? 'Enter reason for finance rejection (required)...'
                    : reviewAction === 'approve'
                    ? 'Enter audit verification notes or compliance approval justification (required)...'
                    : 'Enter audit disapproval reason or missing requirement details (required)...'
                }
                className="w-full p-3 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none focus:ring-2 focus:ring-focus placeholder:text-muted-fg resize-none"
                required
              />
              <p className="text-[11px] text-muted-fg">
                This remark is permanent and will be recorded in the official audit trail.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsReviewConfirmModalOpen(false)}
                className="h-9 text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingReview}
                className={cn(
                  'h-9 px-4 text-xs font-bold text-white shadow-xs cursor-pointer',
                  reviewAction === 'endorse' || reviewAction === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                )}
              >
                {isSubmittingReview
                  ? 'Saving...'
                  : reviewAction === 'endorse'
                  ? 'Confirm Endorsement'
                  : reviewAction === 'reject'
                  ? 'Confirm Rejection'
                  : reviewAction === 'approve'
                  ? 'Confirm Approval'
                  : 'Confirm Disapproval'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Top Up Request Modal */}
      <Dialog open={Boolean(editEntry)} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="pb-3 border-b border-stroke/20">
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" />
              <span>Edit Petty Cash Request</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg">
              Update the requested amount or particulars before finance reviews it.
            </DialogDescription>
          </DialogHeader>

          {editEntry && (
            <form onSubmit={handleSubmitEdit} className="space-y-4 pt-2">
              {editError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                  {editError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus">Company</Label>
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-stroke/40 text-xs font-semibold text-focus">
                  {editEntry.companyName}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-amount" className="text-xs font-semibold text-focus">
                  Requested Amount (PHP) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="edit-amount"
                  type="number"
                  step="0.01"
                  min="1"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="h-10 text-xs rounded-xl"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-desc" className="text-xs font-semibold text-focus">
                  Particulars / Description
                </Label>
                <Input
                  id="edit-desc"
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Reason or purpose for top up"
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/20">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditEntry(null)}
                  className="h-9 px-3 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isEditing}
                  className="h-9 px-4 text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white"
                >
                  {isEditing ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Top Up Confirmation Modal */}
      <Dialog
        open={Boolean(deleteConfirmEntry)}
        onOpenChange={(open) => !open && setDeleteConfirmEntry(null)}
      >
        <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg font-bold text-focus">
              Delete Petty Cash Request
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg font-normal">
              Are you sure you want to delete this pending request? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {deleteError}
            </div>
          )}

          {deleteConfirmEntry && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 my-2">
              <div className="flex justify-between">
                <span className="text-muted-fg">Company:</span>
                <span className="font-semibold text-focus">{deleteConfirmEntry.companyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Particulars:</span>
                <span className="font-medium text-focus truncate max-w-[200px]">
                  {deleteConfirmEntry.description || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Amount:</span>
                <span className="font-bold text-red-600">
                  {formatPHP(deleteConfirmEntry.amountRequested || deleteConfirmEntry.amountIn)}
                </span>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmEntry(null)}
              className="h-9 px-3 rounded-lg text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-xs"
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Top Up / Request Petty Cash Modal */}
      <TopUpPettyCashModal
        open={isTopUpModalOpen}
        onOpenChange={setIsTopUpModalOpen}
        company={selectedCompany !== 'All Companies' ? selectedCompany : (activeCompany !== 'All Companies' ? activeCompany : (user?.assignedCompany || 'MCT Kitchen'))}
        currentBalance={currentBalance}
        companies={companyList}
        bankAccounts={bankAccounts}
        onSuccess={handleTopUpSuccess}
      />

      {/* Reimbursement Request Modal */}
      <ReimbursementModal
        open={isReimbursementModalOpen}
        onOpenChange={setIsReimbursementModalOpen}
        company={selectedCompany !== 'All Companies' ? selectedCompany : (activeCompany !== 'All Companies' ? activeCompany : (user?.assignedCompany || 'MCT Kitchen'))}
        currentBalance={currentBalance}
        companies={companyList}
        onSuccess={(newRecord) => {
          if (newRecord) {
            setLedger((prev) => [newRecord, ...prev])
          }
          loadData()
          setIsReimbursementModalOpen(false)
        }}
      />

      {/* Audit Action Portal Menu */}
      {openMenuPettyId && menuPosition && activeMenuPetty && typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'absolute',
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
            className="z-50 w-48 rounded-xl bg-white border border-slate-200 shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => handleMarkPettyAudit(activeMenuPetty, 'Verified')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Mark as Audit</span>
            </button>
            <button
              type="button"
              onClick={() => handleMarkPettyAudit(activeMenuPetty, 'Flagged')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors text-left cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>Mark as Discrepancy</span>
            </button>
            <div className="h-px bg-slate-100 my-1" />
            <button
              type="button"
              onClick={() => {
                handleOpenSummary(activeMenuPetty)
                setOpenMenuPettyId(null)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-slate-500" />
              <span>View Details</span>
            </button>
          </div>,
          document.body
        )}
      {/* Proof Preview Modal */}
      <Dialog open={!!previewReceipt} onOpenChange={(open) => !open && setPreviewReceipt(null)}>
        <DialogContent className="sm:max-w-[720px] p-6 max-h-[90vh] flex flex-col">
          {previewReceipt && (
            <div className="flex flex-col h-full space-y-4">
              <DialogHeader>
                <div className="flex items-center justify-between gap-3 pr-6">
                  <div className="min-w-0">
                    <DialogTitle className="text-base font-bold text-focus truncate max-w-[420px]">
                      {previewReceipt.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-fg">
                      Uploaded proof of expense / Official Receipt
                    </DialogDescription>
                  </div>
                  <Button
                    type="button"
                    onClick={() => downloadReceipt(previewReceipt.url, previewReceipt.name)}
                    className="h-8 px-3 rounded-lg text-xs font-semibold text-white bg-[#960C01] hover:bg-[#800a01] flex items-center gap-1.5 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </Button>
                </div>
              </DialogHeader>

              <div className="flex-1 min-h-[320px] max-h-[62vh] overflow-auto rounded-xl bg-slate-900/5 border border-stroke/30 flex items-center justify-center p-2">
                {previewReceipt.url.startsWith('data:application/pdf') || previewReceipt.name.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    src={previewReceipt.url}
                    title={previewReceipt.name}
                    className="w-full h-[58vh] rounded-lg border-0 bg-white"
                  />
                ) : (
                  <img
                    src={previewReceipt.url}
                    alt={previewReceipt.name}
                    className="max-w-full max-h-[58vh] object-contain rounded-lg shadow-xs"
                  />
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
