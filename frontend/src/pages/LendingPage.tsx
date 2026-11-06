import { formatRealName } from '@/utils/formatRealName'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  ShieldCheck,
  CheckCircle2,
  Download,
  Plus,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  FileSpreadsheet,
  FileText,
  Calendar,
  CreditCard,
  AlertCircle,
  Pencil,
  Trash2,
  Coins,
  Receipt,
  MoreVertical,
  Eye,
  Lock,
  Building2,
  Loader2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { SharedPaymentModal } from '@/components/common/SharedPaymentModal'
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
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'
import {
  type DailyPaymentRecord,
  type LendingFacility,
  lendingService,
  LENDING_STORAGE_KEY as STORAGE_KEY,
  getMonthlyProgress,
  getNextInstallmentInfo,
  getCycleDueDate,
} from '@/services/lendingService'

// Period options matching Sales Page
const PERIOD_OPTIONS = ['Daily', 'Quarterly', 'Monthly', 'Annually'] as const
type PeriodType = (typeof PERIOD_OPTIONS)[number]

const COMPANY_NAME = 'FilCap Prime Holdings Corp.'

const ITEMS_PER_PAGE = 10 // Total no. of borrowers in table view
const HISTORY_ITEMS_PER_PAGE = 9 // Total no. of payment records in payment history table

interface PendingPaymentData {
  facilityId: string
  borrowerName: string
  loanId: string
  paymentDate: string
  targetInstallmentDate?: string
  cycleDueDate?: string
  cycleIndex?: number
  isLate?: boolean
  daysLate?: number
  penaltyPortion?: number
  amount: number
  method: string
  referenceNo: string
  notes: string
  paymentStatus: 'Paid' | 'Partially Paid'
  monthIndex?: number
  periodLabel?: string
  targetDue: number
  alreadyPaidForPeriod: number
  periodRemainingAfter: number
  remainingBalanceBefore: number
  remainingBalanceAfter: number
}

interface CompletedPaymentReceipt extends PendingPaymentData {
  transactionId: string
  timestamp: string
}

export const LendingPage: React.FC = () => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const isFinance = userRole === 'finance'
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isOwner = userRole === 'owner'
  const canAuditActions = (isAudit || userRole === 'admin') && !isOwner
  // Audit Review modal and submission state
  const [isAuditConfirmModalOpen, setIsAuditConfirmModalOpen] = React.useState(false)
  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = React.useState(false)
  const [discrepancyReason, setDiscrepancyReason] = React.useState('')
  const [isSubmittingAudit, setIsSubmittingAudit] = React.useState(false)

  const handleConfirmAudit = async () => {
    if (!activeFacility) return
    setIsSubmittingAudit(true)
    try {
      const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      const auditorName = formatRealName(user?.fullName || user?.email || 'Audit')
      const updatedFacility: LendingFacility = {
        ...activeFacility,
        auditStatus: 'Verified',
        auditDate: timestamp,
        auditedBy: auditorName,
      }
      const updatedList = facilities.map((f) => (f.id === activeFacility.id ? updatedFacility : f))
      saveFacilities(updatedList)
      setActiveFacility(updatedFacility)
      setIsAuditConfirmModalOpen(false)
    } finally {
      setIsSubmittingAudit(false)
    }
  }

  const handleConfirmDiscrepancy = async () => {
    if (!activeFacility || !discrepancyReason.trim()) return
    setIsSubmittingAudit(true)
    try {
      const timestamp = new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      const auditorName = formatRealName(user?.fullName || user?.email || 'Audit')
      const updatedFacility: LendingFacility = {
        ...activeFacility,
        auditStatus: 'Flagged',
        auditDate: timestamp,
        auditedBy: auditorName,
        auditRemarks: discrepancyReason.trim(),
      }
      const updatedList = facilities.map((f) => (f.id === activeFacility.id ? updatedFacility : f))
      saveFacilities(updatedList)
      setActiveFacility(updatedFacility)
      setIsDiscrepancyModalOpen(false)
      setDiscrepancyReason('')
    } finally {
      setIsSubmittingAudit(false)
    }
  }


  // Set document title
  React.useEffect(() => {
    document.title = 'Lending - MCT Centralized Financial Management'
  }, [])

  const [isLoading, setIsLoading] = React.useState(true)

  // Load facilities from backend or empty cache
  const [facilities, setFacilities] = React.useState<LendingFacility[]>(() => {
    return lendingService.loadFromStorage()
  })

  // Sync with backend lending service on mount
  React.useEffect(() => {
    setIsLoading(true)
    lendingService
      .getFacilities()
      .then((data) => {
        if (Array.isArray(data)) {
          setFacilities(data)
        }
      })
      .catch((err) => {
        console.warn('Lending backend sync notice:', err)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  // Save to sessionStorage whenever facilities update
  const saveFacilities = React.useCallback((newFacilities: LendingFacility[]) => {
    setFacilities(newFacilities)
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newFacilities))
      } catch (err) {
        console.error('Error saving lending facilities:', err)
      }
    }
  }, [])

  // Filter toolbar state matching SalesPage
  const [dateRange, setDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
    preset: 'All Dates',
  })
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'All' | 'Active' | 'Completed' | 'Overdue' | 'Pending'>('All')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodType>('Monthly')

  // Dropdowns state matching SalesPage & TenantPage
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  // View mode and modals state
  const [viewMode, setViewMode] = React.useState<'list' | 'details'>('list')
  const [paymentCalendarMonth, setPaymentCalendarMonth] = React.useState<Date>(() => new Date())
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false)
  const [isDailyPaymentModalOpen, setIsDailyPaymentModalOpen] = React.useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false)
  const [isPaymentConfirmModalOpen, setIsPaymentConfirmModalOpen] = React.useState(false)
  const [isPaymentSuccessModalOpen, setIsPaymentSuccessModalOpen] = React.useState(false)
  const [pendingPayment, setPendingPayment] = React.useState<PendingPaymentData | null>(null)
  const [completedReceipt, setCompletedReceipt] = React.useState<CompletedPaymentReceipt | null>(null)
  const [paymentError, setPaymentError] = React.useState<string | null>(null)
  const [addModalError, setAddModalError] = React.useState<string | null>(null)
  const [editModalError, setEditModalError] = React.useState<string | null>(null)
  const [deleteModalError, setDeleteModalError] = React.useState<string | null>(null)
  const [isSubmittingPayment, setIsSubmittingPayment] = React.useState(false)
  const [isCreatingBorrower, setIsCreatingBorrower] = React.useState(false)
  const [isUpdatingBorrower, setIsUpdatingBorrower] = React.useState(false)
  const [isDeletingBorrower, setIsDeletingBorrower] = React.useState(false)

  // 3-dots actions menu state
  const [openMenuFacilityId, setOpenMenuFacilityId] = React.useState<string | null>(null)
  const [activeMenuFacility, setActiveMenuFacility] = React.useState<LendingFacility | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)

  // Facility focus targets
  const [activeFacility, setActiveFacility] = React.useState<LendingFacility | null>(null)
  const [highlightedFacilityId, setHighlightedFacilityId] = React.useState<string | null>(null)
  const highlightTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  // Helper to project due date from start date, term count, and payment frequency
  const calculateProjectedDueDate = React.useCallback(
    (startDateStr: string, termStr: string, freq: 'Daily' | 'Monthly' = 'Daily'): string => {
      if (!startDateStr) return ''
      const termNum = parseInt(termStr, 10)
      if (isNaN(termNum) || termNum <= 0) return ''

      if (freq === 'Daily') {
        const d = new Date(startDateStr)
        if (isNaN(d.getTime())) return ''
        d.setDate(d.getDate() + termNum)
        return formatToYYYYMMDD(d)
      }

      return getCycleDueDate(startDateStr, '', freq, termNum, termNum)
    },
    []
  )

  // Form state for New Lending Facility Modal
  // Default 40 term days for Daily and 20.0% interest rate
  const [formData, setFormData] = React.useState<{
    borrowerName: string
    loanAmount: string
    interestRate: string
    termDays: string
    dateBorrowed: string
    dueDate: string
    paymentFrequency: 'Daily' | 'Monthly'
    notes: string
  }>(() => {
    const today = formatToYYYYMMDD(new Date())
    const initialDue = new Date()
    initialDue.setDate(initialDue.getDate() + 40)
    return {
      borrowerName: '',
      loanAmount: '',
      interestRate: '20.0',
      termDays: '40',
      dateBorrowed: today,
      dueDate: formatToYYYYMMDD(initialDue),
      paymentFrequency: 'Daily',
      notes: '',
    }
  })

  // Form state for Edit Lending Facility Modal
  const [editFormData, setEditFormData] = React.useState<{
    borrowerName: string
    loanAmount: string
    interestRate: string
    termDays: string
    dateBorrowed: string
    dueDate: string
    status: LendingFacility['status']
    paymentFrequency: 'Daily' | 'Monthly'
    notes: string
  }>({
    borrowerName: '',
    loanAmount: '',
    interestRate: '',
    termDays: '40',
    dateBorrowed: '',
    dueDate: '',
    status: 'Active',
    paymentFrequency: 'Daily',
    notes: '',
  })

  // Search query and pagination for Payment History in Lending Information View
  const [historySearchQuery, setHistorySearchQuery] = React.useState('')
  const [historyCurrentPage, setHistoryCurrentPage] = React.useState(1)

  // Form state for Update Payment Modal
  const [paymentForm, setPaymentForm] = React.useState<{
    paymentAmount: string
    paymentDate: string
    targetInstallmentDate: string
    method: string
    referenceNo: string
    notes: string
    cycleIndex?: number
    penaltyAmount: string
  }>({
    paymentAmount: '',
    paymentDate: formatToYYYYMMDD(new Date()),
    targetInstallmentDate: formatToYYYYMMDD(new Date()),
    method: 'Cash',
    referenceNo: '',
    notes: '',
    penaltyAmount: '0',
  })

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)

  // Period change handler
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

  // Click outside listener for dropdowns and 3-dots actions menu
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (periodDropdownRef.current && !periodDropdownRef.current.contains(target)) {
        setIsPeriodDropdownOpen(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false)
      }
      if (!target.closest('.lending-portal-menu') && !target.closest('.lending-action-btn')) {
        setOpenMenuFacilityId(null)
        setMenuPosition(null)
        setActiveMenuFacility(null)
      }
    }

    const handleWindowScroll = () => {
      if (openMenuFacilityId) {
        setOpenMenuFacilityId(null)
        setMenuPosition(null)
        setActiveMenuFacility(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleWindowScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleWindowScroll, true)
    }
  }, [openMenuFacilityId])

  // Clean highlight timer on unmount
  React.useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // Filter facilities based on status, date range, and search query (locked to FilCap Prime Holdings Corp.)
  const filteredFacilities = React.useMemo(() => {
    return facilities.filter((item) => {
      // 1. Status filter
      if (statusFilter !== 'All' && item.status !== statusFilter) {
        return false
      }

      // 3. Search query filter (Loan ID, Reference No, Borrower Name, Notes)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesLoanId = String(item.loanId ?? '').toLowerCase().includes(q)
        const matchesLoanRefNo = String(item.loanRefNo ?? '').toLowerCase().includes(q)
        const matchesBorrowerRef = String(item.borrower_ref_no ?? item.borrowerRefNo ?? '').toLowerCase().includes(q)
        const matchesBorrower = String(item.borrowerName ?? '').toLowerCase().includes(q)
        const matchesNotes = String(item.notes ?? '').toLowerCase().includes(q)
        if (!matchesLoanId && !matchesLoanRefNo && !matchesBorrowerRef && !matchesBorrower && !matchesNotes) return false
      }

      // 4. Date Range filter (matches dateBorrowed, dueDate, active loan span overlap, or recorded payment dates)
      if (dateRange.startDate || dateRange.endDate) {
        const borrowedDate = normalizeDateToYYYYMMDD(item.dateBorrowed)
        const dueDate = normalizeDateToYYYYMMDD(item.dueDate)
        const borrowedInRange = isDateInRange(item.dateBorrowed, dateRange.startDate, dateRange.endDate)
        const dueInRange = isDateInRange(item.dueDate, dateRange.startDate, dateRange.endDate)
        const spanOverlapsRange =
          Boolean(borrowedDate && dueDate) &&
          (!dateRange.endDate || borrowedDate <= dateRange.endDate) &&
          (!dateRange.startDate || dueDate >= dateRange.startDate)
        const paymentInRange = Object.keys(item.dailyPayments || {}).some((payDate) =>
          isDateInRange(payDate, dateRange.startDate, dateRange.endDate)
        )
        if (!borrowedInRange && !dueInRange && !spanOverlapsRange && !paymentInRange) return false
      }

      return true
    })
  }, [facilities, statusFilter, searchQuery, dateRange])

  // Summary Metrics for KPI cards
  const metrics = React.useMemo(() => {
    const totalLoanAmount = filteredFacilities.reduce((sum, f) => sum + f.loanAmount, 0)
    const totalPayable = filteredFacilities.reduce((sum, f) => sum + f.totalAmountPayable, 0)
    const totalAmountPaid = filteredFacilities.reduce((sum, f) => sum + f.amountPaid, 0)
    const totalRemainingBalance = filteredFacilities.reduce((sum, f) => sum + f.remainingBalance, 0)
    const activeCount = filteredFacilities.filter((f) => f.status === 'Active' || f.status === 'Overdue').length
    const repaidRate = totalPayable > 0 ? (totalAmountPaid / totalPayable) * 100 : 0

    return {
      totalLoanAmount,
      totalPayable,
      totalAmountPaid,
      totalRemainingBalance,
      activeCount,
      repaidRate,
    }
  }, [filteredFacilities])

  // Pagination calculations
  const totalPages = Math.ceil(filteredFacilities.length / ITEMS_PER_PAGE) || 1
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredFacilities.length)
  const paginatedFacilities = React.useMemo(() => {
    return filteredFacilities.slice(startIndex, endIndex)
  }, [filteredFacilities, startIndex, endIndex])

  // Export CSV handler
  const handleExportCsv = () => {
    const headers = [
      'Loan ID',
      "Borrower's Name",
      'Loan Amount',
      'Interest Rate (%)',
      'Date Borrowed',
      'Due Date',
      'Total Amount Payable',
      'Amount Paid',
      'Remaining Balance',
      'Status',
      ...(isAudit ? ['Audit Status', 'Audit Date'] : []),
    ]

    const rows = filteredFacilities.map((f) => [
      f.loanId,
      `"${f.borrowerName.replace(/"/g, '""')}"`,
      f.loanAmount,
      `${f.interestRate}%`,
      f.dateBorrowed,
      f.dueDate,
      f.totalAmountPayable,
      f.amountPaid,
      f.remainingBalance,
      f.status,
      ...(isAudit ? [f.auditStatus || 'Unreviewed', f.auditDate || ''] : []),
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `lending_portfolio_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setIsExportDropdownOpen(false)
  }

  // Export PDF handler
  const handleExportPdf = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const rowsHtml = filteredFacilities
      .map(
        (f) => `
        <tr>
          <td style="font-family: monospace; font-weight: bold;">${f.loanId}</td>
          <td>${f.borrowerName}</td>
          <td style="text-align: right;">${formatPHP(f.loanAmount)}</td>
          <td style="text-align: center;">${f.dateBorrowed}</td>
          <td style="text-align: center;">${f.dueDate}</td>
          <td style="text-align: right; font-weight: bold;">${formatPHP(f.totalAmountPayable)}</td>
          <td style="text-align: right; color: #059669; font-weight: 600;">${formatPHP(f.amountPaid)}</td>
          <td style="text-align: right; color: #d97706; font-weight: bold;">${formatPHP(f.remainingBalance)}</td>
          <td style="text-align: center;">${f.status}</td>
          ${isAudit ? `<td style="text-align: center; font-weight: 600;">${f.auditStatus || '-'}</td><td style="text-align: center; font-size: 10px; font-family: monospace;">${f.auditDate || '-'}</td>` : ''}
        </tr>
      `
      )
      .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Lending Portfolio Summary</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-size: 20px; margin: 0 0 4px; font-weight: 700; color: #0f172a; }
            p { font-size: 12px; color: #64748b; margin: 0 0 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 6px 8px; }
            th { background: #f8fafc; font-weight: 600; text-transform: uppercase; font-size: 10px; color: #475569; }
            .summary { margin-top: 20px; display: flex; gap: 24px; font-size: 12px; background: #f1f5f9; padding: 12px 16px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h1>MCT Financial Management - Lending Module</h1>
          <p>Portfolio Summary for Lending Accounts · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Loan ID</th>
                <th>Borrower's Name</th>
                <th style="text-align: right;">Loan Amount</th>
                <th>Date Borrowed</th>
                <th>Due Date</th>
                <th style="text-align: right;">Total Payable</th>
                <th style="text-align: right;">Amount Paid</th>
                <th style="text-align: right;">Remaining Balance</th>
                <th>Status</th>
                ${isAudit ? '<th>Audit Status</th><th>Audit Date</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Facilities:</strong> ${filteredFacilities.length}</div>
            <div><strong>Total Disbursed:</strong> ${formatPHP(metrics.totalLoanAmount)}</div>
            <div><strong>Total Payable:</strong> ${formatPHP(metrics.totalPayable)}</div>
            <div><strong>Total Collected:</strong> ${formatPHP(metrics.totalAmountPaid)}</div>
            <div><strong>Remaining Balance:</strong> ${formatPHP(metrics.totalRemainingBalance)}</div>
          </div>
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
    setIsExportDropdownOpen(false)
  }

  // Create new Lending Facility handler (Requirement 2)
  const handleCreateFacility = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isAudit) return
    setAddModalError(null)

    const principalNum = parseFloat(formData.loanAmount)
    const rateNum = parseFloat(formData.interestRate)

    if (!formData.borrowerName.trim()) {
      setAddModalError("Please provide the Borrower's Name.")
      return
    }
    if (isNaN(principalNum) || principalNum <= 0) {
      setAddModalError('Please enter a valid loan amount greater than zero.')
      return
    }
    if (isNaN(rateNum) || rateNum < 0) {
      setAddModalError('Please enter a valid interest rate.')
      return
    }
    if (!formData.dateBorrowed || !formData.dueDate) {
      setAddModalError('Please specify both Date Borrowed and Due Date.')
      return
    }

    const termDaysNum = parseInt(formData.termDays || (formData.paymentFrequency === 'Daily' ? '40' : '2'), 10)

    setIsCreatingBorrower(true)
    try {
      const newFacility = await lendingService.createFacility({
        borrowerName: formData.borrowerName.trim(),
        loanAmount: principalNum,
        interestRate: rateNum,
        paymentFrequency: formData.paymentFrequency,
        termDays: termDaysNum,
        dateBorrowed: formData.dateBorrowed,
        dueDate: formData.dueDate,
        notes: formData.notes.trim(),
      })

      const updatedList = [newFacility, ...facilities.filter((f) => f.id !== newFacility.id)]
      saveFacilities(updatedList)
      setIsAddModalOpen(false)
      setAddModalError(null)

      // Reset form
      const currentToday = formatToYYYYMMDD(new Date())
      setFormData({
        borrowerName: '',
        loanAmount: '',
        interestRate: '20.0',
        termDays: '40',
        dateBorrowed: currentToday,
        dueDate: calculateProjectedDueDate(currentToday, '40'),
        paymentFrequency: 'Daily',
        notes: '',
      })

      // Reset filters and highlight newly created item
      setSearchQuery('')
      setStatusFilter('All')
      setCurrentPage(1)
      setHighlightedFacilityId(newFacility.id)

      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedFacilityId(null)
      }, 3000)

      setTimeout(() => {
        tableCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (err: any) {
      console.error('Failed to create borrower in database:', err)
      setAddModalError(
        formatUserFriendlyErrorMessage(err, 'Unable to create borrower record. Please try again.')
      )
    } finally {
      setIsCreatingBorrower(false)
    }
  }

  // Open Edit Modal for a specific facility
  const handleOpenEditModal = (facility: LendingFacility, e: React.MouseEvent) => {
    e.stopPropagation()
    if (isAudit) return
    setActiveFacility(facility)
    setEditModalError(null)
    setEditFormData({
      borrowerName: facility.borrowerName,
      loanAmount: String(facility.loanAmount),
      interestRate: String(facility.interestRate),
      termDays: String(facility.termDays || (facility.paymentFrequency === 'Daily' ? 40 : 2)),
      dateBorrowed: facility.dateBorrowed,
      dueDate: facility.dueDate,
      status: facility.status,
      paymentFrequency: facility.paymentFrequency || 'Daily',
      notes: facility.notes || '',
    })
    setIsEditModalOpen(true)
  }

  // Save changes from Edit Modal
  const handleSaveEditFacility = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isAudit || !activeFacility) return
    setEditModalError(null)

    const principalNum = parseFloat(editFormData.loanAmount)
    const rateNum = parseFloat(editFormData.interestRate)
    const termDaysNum = parseInt(editFormData.termDays || (editFormData.paymentFrequency === 'Daily' ? '40' : '2'), 10) || (editFormData.paymentFrequency === 'Daily' ? 40 : 2)

    if (!editFormData.borrowerName.trim() || isNaN(principalNum) || principalNum <= 0) {
      setEditModalError('Please fill out all required fields with valid values.')
      return
    }

    const borrowerDbId = activeFacility.borrower_id || activeFacility.borrowerId || activeFacility.id

    setIsUpdatingBorrower(true)
    try {
      const updated = await lendingService.updateBorrower(borrowerDbId, {
        borrowerName: editFormData.borrowerName.trim(),
        loanAmount: principalNum,
        interestRate: rateNum,
        termDays: termDaysNum,
        dateBorrowed: editFormData.dateBorrowed,
        dueDate: editFormData.dueDate,
        status: editFormData.status,
        paymentFrequency: editFormData.paymentFrequency,
        notes: editFormData.notes.trim(),
      })

      const updatedList = facilities.map((f) => (f.id === activeFacility.id || String(f.borrower_id) === String(borrowerDbId) ? updated : f))
      saveFacilities(updatedList)
      setIsEditModalOpen(false)
      setEditModalError(null)
      setActiveFacility(updated)
    } catch (err: any) {
      console.error('Failed to update borrower in database:', err)
      setEditModalError(
        formatUserFriendlyErrorMessage(err, 'Unable to update borrower details. Please try again.')
      )
    } finally {
      setIsUpdatingBorrower(false)
    }
  }

  // Helper to get daily or periodic installment target for a facility
  const getFacilityDailyTarget = React.useCallback((facility: LendingFacility): number => {
    if (facility.installmentTarget) return facility.installmentTarget
    const isDaily = !facility.paymentFrequency || facility.paymentFrequency === 'Daily'
    const termVal = facility.termDays || (isDaily ? 40 : 2)
    const cycles = isDaily ? termVal : (termVal <= 36 ? termVal : Math.max(1, Math.round(termVal / 30)))
    return Math.round((facility.totalAmountPayable / Math.max(1, cycles)) * 100) / 100
  }, [])

  // Open Update Payment Modal ("Update" action button)
  const handleOpenPaymentModal = (facility: LendingFacility, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (isAudit) return
    setActiveFacility(facility)
    setPaymentError(null)

    // Compute smart initial date: for Daily, pick the first date not yet fully paid (or today if not fully paid)
    let initialDate = formatToYYYYMMDD(new Date())
    if ((!facility.paymentFrequency || facility.paymentFrequency === 'Daily') && facility.dailyPayments) {
      const dailyTarget = getFacilityDailyTarget(facility)
      const paidByDate = new Map<string, number>()
      const lockedDates = new Set<string>()
      facility.dailyPayments.forEach((p) => {
        if (!p.date) return
        paidByDate.set(p.date, (paidByDate.get(p.date) || 0) + (p.amount || 0))
      })
      paidByDate.forEach((amt, dt) => {
        if (amt >= dailyTarget - 0.005) {
          lockedDates.add(dt)
        }
      })

      if (lockedDates.has(initialDate)) {
        const start = new Date(facility.dateBorrowed)
        const today = new Date(initialDate)
        let foundUnpaid: string | null = null
        if (!isNaN(start.getTime())) {
          const cur = new Date(start)
          while (cur <= today) {
            const d = formatToYYYYMMDD(cur)
            if (!lockedDates.has(d)) {
              foundUnpaid = d
              break
            }
            cur.setDate(cur.getDate() + 1)
          }
        }
        if (foundUnpaid) {
          initialDate = foundUnpaid
        } else {
          const tomorrow = new Date(today)
          tomorrow.setDate(tomorrow.getDate() + 1)
          initialDate = formatToYYYYMMDD(tomorrow)
        }
      }
    }

    let initialCycleIndex: number | undefined = undefined
    if (facility.paymentFrequency === 'Monthly') {
      const progress = getMonthlyProgress(facility)
      if (progress.activeMonth) {
        initialDate = progress.activeMonth.dueDate
        initialCycleIndex = progress.activeMonth.monthIndex
      }
    }

    const todayFormatted = formatToYYYYMMDD(new Date())
    setPaymentForm({
      paymentAmount: '',
      paymentDate: todayFormatted,
      targetInstallmentDate: initialDate,
      cycleIndex: initialCycleIndex,
      method: 'Cash',
      referenceNo: '',
      notes: '',
      penaltyAmount: '0',
    })
    setPaymentCalendarMonth(new Date())
    setIsDailyPaymentModalOpen(true)
  }
  const handleOpenDailyPaymentModal = handleOpenPaymentModal

  // Validate payment form and open Confirmation Modal
  const handleRecordDailyPayment = (e: React.FormEvent) => {
    e.preventDefault()
    if (isAudit || !activeFacility) return
    setPaymentError(null)

    const freq = activeFacility.paymentFrequency || 'Daily'
    const isDaily = freq === 'Daily'
    const isMonthly = freq === 'Monthly'
    const dailyTarget = getFacilityDailyTarget(activeFacility)
    const targetInstallmentDate = paymentForm.targetInstallmentDate || paymentForm.paymentDate
    const cashReceivedDate = paymentForm.paymentDate

    const alreadyPaidOnDate = (activeFacility.dailyPayments || [])
      .filter((p) => (p.cycle_due_date || p.cycleDueDate || p.date) === targetInstallmentDate)
      .reduce((sum, p) => sum + (p.amount || 0), 0)

    if (isDaily && alreadyPaidOnDate >= dailyTarget - 0.005) {
      setPaymentError(
        `Installment date ${targetInstallmentDate} is already fully paid and locked. You cannot add or duplicate payments for a settled date.`
      )
      return
    }

    const paymentNum = parseFloat(paymentForm.paymentAmount)
    if (isNaN(paymentNum) || paymentNum < 1) {
      setPaymentError('Payment Amount cannot be lower than  ₱1.00.')
      return
    }

    const rawPenalty = parseFloat(paymentForm.penaltyAmount)
    if (!isNaN(rawPenalty) && rawPenalty < 0) {
      setPaymentError('Late payment charges can be ₱0.00 but can never be a negative value.')
      return
    }

    if (paymentNum > activeFacility.remainingBalance) {
      setPaymentError(
        `Payment amount (${formatPHP(paymentNum)}) cannot exceed the remaining balance of ${formatPHP(activeFacility.remainingBalance)}.`
      )
      return
    }

    let resolvedMonthIndex: number | undefined = undefined
    let resolvedPeriodLabel: string | undefined = undefined
    let targetDue = dailyTarget
    let alreadyPaidForPeriod = alreadyPaidOnDate
    let periodRemainingBefore = Math.min(
      activeFacility.remainingBalance,
      Math.max(0, Math.round((dailyTarget - alreadyPaidOnDate) * 100) / 100)
    )

    if (isMonthly) {
      const progress = getMonthlyProgress(activeFacility)
      const targetMonth = progress.months.find(
        (m) =>
          (paymentForm.cycleIndex && m.monthIndex === paymentForm.cycleIndex) ||
          m.dueDate === targetInstallmentDate
      ) || progress.activeMonth
      resolvedMonthIndex = targetMonth.monthIndex
      resolvedPeriodLabel = `Month ${targetMonth.monthIndex}`
      targetDue = targetMonth.target
      alreadyPaidForPeriod = targetMonth.paid
      periodRemainingBefore = Math.min(activeFacility.remainingBalance, targetMonth.remaining)

      if (paymentNum > targetMonth.remaining + 0.005) {
        setPaymentError(
          `For Month ${targetMonth.monthIndex}, the maximum due is ${formatPHP(targetMonth.remaining)}.`
        )
        return
      }
    } else if (!isDaily) {
      const nextInst = getNextInstallmentInfo(activeFacility)
      if (nextInst) {
        resolvedPeriodLabel = nextInst.periodLabel
        targetDue = nextInst.target
        periodRemainingBefore = Math.min(activeFacility.remainingBalance, nextInst.remaining)
      }
    }

    // Determine late status and user-specified penalty charges
    const isLate = Boolean(targetInstallmentDate && cashReceivedDate > targetInstallmentDate)
    let daysLate = 0
    if (isLate && targetInstallmentDate && cashReceivedDate) {
      const d1 = new Date(cashReceivedDate)
      const d2 = new Date(targetInstallmentDate)
      daysLate = Math.max(1, Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24)))
    }
    // User directly inputs penalty charge (or 0 if waived)
    const enteredPenalty = Math.max(0, parseFloat(paymentForm.penaltyAmount) || 0)
    const penaltyPortion = isLate ? enteredPenalty : enteredPenalty

    // Penalty is not included in the deduction of total payable.
    // Only the loan repayment amount (paymentNum) deducts from remaining loan balance.
    const remainingBalanceAfter = Math.max(
      0,
      Math.round((activeFacility.remainingBalance - paymentNum) * 100) / 100
    )
    const periodRemainingAfter = Math.max(
      0,
      Math.round((periodRemainingBefore - paymentNum) * 100) / 100
    )

    // Determine whether this payment settles the installment period or is Partially Paid
    const isPartiallyPaid = periodRemainingAfter > 0.005 && remainingBalanceAfter > 0.005
    const paymentStatus: 'Paid' | 'Partially Paid' = isPartiallyPaid ? 'Partially Paid' : 'Paid'

    setPendingPayment({
      facilityId: activeFacility.id,
      borrowerName: activeFacility.borrowerName,
      loanId: activeFacility.loanId,
      paymentDate: cashReceivedDate,
      targetInstallmentDate,
      cycleDueDate: targetInstallmentDate,
      cycleIndex: paymentForm.cycleIndex,
      isLate,
      daysLate,
      penaltyPortion,
      amount: paymentNum,
      method: paymentForm.method,
      referenceNo: paymentForm.referenceNo.trim(),
      notes: paymentForm.notes.trim(),
      paymentStatus,
      monthIndex: resolvedMonthIndex,
      periodLabel: resolvedPeriodLabel,
      targetDue,
      alreadyPaidForPeriod,
      periodRemainingAfter,
      remainingBalanceBefore: activeFacility.remainingBalance,
      remainingBalanceAfter,
    })
    setIsPaymentConfirmModalOpen(true)
  }

  // Execute confirmed payment transaction and open Success Modal
  const handleConfirmRecordPayment = async () => {
    if (isAudit || !activeFacility || !pendingPayment) return
    setIsSubmittingPayment(true)
    setPaymentError(null)

    try {
      const backendRes = await lendingService.recordPayment({
        borrower_id: activeFacility.borrower_id || activeFacility.borrowerId,
        facilityId: activeFacility.id,
        paymentDate: pendingPayment.paymentDate,
        cycleDueDate: pendingPayment.cycleDueDate,
        cycleIndex: pendingPayment.cycleIndex,
        amount: pendingPayment.amount,
        penaltyAmount: pendingPayment.penaltyPortion,
        method: pendingPayment.method,
        referenceNo: pendingPayment.referenceNo,
        notes: pendingPayment.notes,
      })
      if (!backendRes.success) {
        setPaymentError(
          formatUserFriendlyErrorMessage(backendRes.message, 'Unable to record payment remittance. Please try again.')
        )
        setIsPaymentConfirmModalOpen(false)
        setIsSubmittingPayment(false)
        return
      }

      const assessedPenalty = pendingPayment.penaltyPortion || 0
      // Penalty is NOT deducted from total payable; contractual total payable stays unchanged.
      const updatedAmountPaid = Math.round((activeFacility.amountPaid + pendingPayment.amount) * 100) / 100
      const updatedTotalPenalties = Math.round(((activeFacility.totalPenalties || 0) + assessedPenalty) * 100) / 100
      const updatedRemainingBalance = Math.max(
        0,
        Math.round((activeFacility.remainingBalance - pendingPayment.amount) * 100) / 100
      )
      const updatedStatus: LendingFacility['status'] =
        updatedRemainingBalance <= 0
          ? 'Completed'
          : activeFacility.status === 'Completed'
          ? 'Active'
          : activeFacility.status

      const timestampIso = new Date().toISOString()
      const backendTx = backendRes?.transaction
      const txRef = backendTx?.transaction_ref_no || backendTx?.transactionRefNo || `TX-${Date.now()}`
      const txId = backendTx?.transaction_id ? String(backendTx.transaction_id) : `dp-${Date.now()}`
      const isDaily = !activeFacility.paymentFrequency || activeFacility.paymentFrequency === 'Daily'

      const newPaymentRecord: DailyPaymentRecord = {
        id: txId,
        transactionRefNo: txRef,
        transaction_ref_no: txRef,
        date: pendingPayment.paymentDate,
        payment_date: pendingPayment.paymentDate,
        cycle_due_date: pendingPayment.cycleDueDate,
        cycleDueDate: pendingPayment.cycleDueDate,
        cycle_index: pendingPayment.cycleIndex,
        cycleIndex: pendingPayment.cycleIndex,
        is_late: pendingPayment.isLate,
        isLate: pendingPayment.isLate,
        days_late: pendingPayment.daysLate,
        daysLate: pendingPayment.daysLate,
        penalty_portion: pendingPayment.penaltyPortion,
        penalty: pendingPayment.penaltyPortion,
        amount: pendingPayment.amount,
        target: pendingPayment.targetDue,
        method: pendingPayment.method,
        referenceNo: pendingPayment.referenceNo,
        notes: pendingPayment.notes,
        status: pendingPayment.paymentStatus,
        monthIndex: pendingPayment.monthIndex,
        periodLabel: pendingPayment.periodLabel,
        timestamp: timestampIso,
        isLocked: pendingPayment.paymentStatus === 'Paid',
      }

      // If this payment completes a previously partially-paid date/period, update prior partial records on that date/period to Paid & locked
      const existingUpdated = (activeFacility.dailyPayments || []).map((prev) => {
        if (pendingPayment.paymentStatus === 'Paid') {
          const prevCycleDue = prev.cycle_due_date || prev.cycleDueDate
          const isSameTargetDue = Boolean(prevCycleDue && pendingPayment.cycleDueDate && prevCycleDue === pendingPayment.cycleDueDate)
          const isSameMonthIdx = Boolean(pendingPayment.monthIndex && prev.monthIndex === pendingPayment.monthIndex)
          const isSameDailyDate = isDaily && prev.date === pendingPayment.paymentDate

          if ((isSameTargetDue || isSameMonthIdx || isSameDailyDate) && (prev.status === 'Partial' || prev.status === 'Partially Paid')) {
            return { ...prev, status: 'Paid' as const, isLocked: true }
          }
        }
        return prev
      })

      const updatedFacility: LendingFacility = {
        ...activeFacility,
        amountPaid: updatedAmountPaid,
        totalPenalties: updatedTotalPenalties,
        remainingBalance: updatedRemainingBalance,
        status: updatedStatus,
        dailyPayments: [newPaymentRecord, ...existingUpdated],
      }

      const updatedList = facilities.map((f) => (f.id === activeFacility.id ? updatedFacility : f))
      saveFacilities(updatedList)
      setActiveFacility(updatedFacility)

      // Re-fetch latest borrower from backend to guarantee complete consistency
      const borrowerDbId = activeFacility.borrower_id || activeFacility.borrowerId || activeFacility.id
      lendingService.getBorrower(borrowerDbId).then((fresh) => {
        if (fresh) {
          setActiveFacility(fresh)
          setFacilities((prev) => prev.map((f) => (f.id === fresh.id ? fresh : f)))
        }
      }).catch(() => {})

      setCompletedReceipt({
        ...pendingPayment,
        transactionId: txRef,
        timestamp: timestampIso,
      })
      setIsPaymentConfirmModalOpen(false)
      setIsDailyPaymentModalOpen(false)
      setPendingPayment(null)
      setIsPaymentSuccessModalOpen(true)
    } catch (err: any) {
      console.error('handleConfirmRecordPayment failed:', err)
      setPaymentError(
        formatUserFriendlyErrorMessage(err, 'Unable to complete payment transaction. Please try again.')
      )
      setIsPaymentConfirmModalOpen(false)
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  // Open Delete Confirmation
  const handleOpenDeleteModal = (facility: LendingFacility, e: React.MouseEvent) => {
    e.stopPropagation()
    if (isAudit) return
    setActiveFacility(facility)
    setDeleteModalError(null)
    setIsDeleteConfirmOpen(true)
  }

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (isAudit || !activeFacility) return
    setDeleteModalError(null)
    const borrowerDbId = activeFacility.borrower_id || activeFacility.borrowerId || activeFacility.id
    setIsDeletingBorrower(true)
    try {
      await lendingService.deleteBorrower(borrowerDbId)
      const updatedList = facilities.filter((f) => f.id !== activeFacility.id && String(f.borrower_id) !== String(borrowerDbId))
      saveFacilities(updatedList)
      setIsDeleteConfirmOpen(false)
      setDeleteModalError(null)
      setActiveFacility(null)
      if (viewMode === 'details') {
        setViewMode('list')
      }
    } catch (err: any) {
      console.error('Failed to delete borrower from database:', err)
      setDeleteModalError(
        formatUserFriendlyErrorMessage(err, 'Unable to delete borrower record. Please try again.')
      )
    } finally {
      setIsDeletingBorrower(false)
    }
  }

  // Open Complete Information page on row click
  const handleRowClick = async (facility: LendingFacility) => {
    setActiveFacility(facility)
    setHistorySearchQuery('')
    setHistoryCurrentPage(1)
    setViewMode('details')
    try {
      const borrowerDbId = facility.borrower_id || facility.borrowerId || facility.id
      const fresh = await lendingService.getBorrower(borrowerDbId)
      if (fresh) {
        setActiveFacility(fresh)
        setFacilities((prev) => prev.map((f) => (f.id === fresh.id ? fresh : f)))
      }
    } catch {
      // Keep existing facility if backend fetch fails
    }
  }

  // Filtered payment records for Lending Details View (Payment Log of the borrower)
  // Shows actual paid/partially-paid transactions made by the user
  const filteredHistoryPayments = React.useMemo(() => {
    if (!activeFacility) return []
    const baseList = activeFacility.dailyPayments || []
    const paidList = baseList.filter(
      (p) => p.status !== 'Pending' && p.status !== 'Scheduled' && p.status !== 'Missed'
    )
    const query = historySearchQuery.trim().toLowerCase()
    if (!query) return paidList
    return paidList.filter((p) => {
      const dateMatch = (p.date || '').toLowerCase().includes(query)
      const installmentDateMatch = (p.cycle_due_date || p.cycleDueDate || '').toLowerCase().includes(query)
      const notesMatch = (p.notes || '').toLowerCase().includes(query)
      const refMatch = (p.referenceNo || '').toLowerCase().includes(query)
      const txRefMatch = (p.transactionRefNo || p.transaction_ref_no || p.id || '').toLowerCase().includes(query)
      const methodMatch = (p.method || '').toLowerCase().includes(query)
      const statusMatch = (p.status || '').toLowerCase().includes(query)
      return dateMatch || installmentDateMatch || notesMatch || refMatch || txRefMatch || methodMatch || statusMatch
    })
  }, [activeFacility, historySearchQuery])

  // Reset history page when search query or active facility changes
  React.useEffect(() => {
    setHistoryCurrentPage(1)
  }, [historySearchQuery, activeFacility?.id])

  // Dedicated Full Screen Details Page View
  const renderDetailsPage = () => {
    if (!activeFacility) return null

    const historyTotalPages = Math.ceil(filteredHistoryPayments.length / HISTORY_ITEMS_PER_PAGE) || 1
    const safeHistoryPage = Math.min(historyCurrentPage, historyTotalPages)
    const historyStartIndex = (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE
    const historyEndIndex = Math.min(historyStartIndex + HISTORY_ITEMS_PER_PAGE, filteredHistoryPayments.length)
    const paginatedHistoryPayments = filteredHistoryPayments.slice(historyStartIndex, historyEndIndex)

    // Build cycle settlement map to know whether an installment cycle has reached its full target
    const isDaily = !activeFacility.paymentFrequency || activeFacility.paymentFrequency === 'Daily'
    const dailyTarget = getFacilityDailyTarget(activeFacility)
    const cycleSettledMap = new Map<string, boolean>()

    if (isDaily) {
      const paidByDate = new Map<string, number>()
      ;(activeFacility.dailyPayments || []).forEach((p) => {
        const d = p.cycle_due_date || p.cycleDueDate || p.date || p.payment_date
        if (d) paidByDate.set(d, (paidByDate.get(d) || 0) + (p.amount || 0))
      })
      paidByDate.forEach((total, d) => {
        if (total >= dailyTarget - 0.005 || activeFacility.remainingBalance <= 0.005) {
          cycleSettledMap.set(d, true)
        }
      })
    } else {
      const progress = getMonthlyProgress(activeFacility)
      progress.months.forEach((m) => {
        if (m.status === 'Paid' || m.remaining <= 0.005 || activeFacility.remainingBalance <= 0.005) {
          cycleSettledMap.set(m.dueDate, true)
        }
      })
    }

    const calculatedInterest =
      (activeFacility as any).interestAmount ??
      Math.round(((activeFacility.loanAmount || 0) * ((activeFacility.interestRate || 0) / 100)) * 100) / 100
    const contractualTotalPayable =
      (activeFacility.loanAmount || 0) + calculatedInterest
    const totalPaidPenalties = (activeFacility.dailyPayments || []).reduce(
      (sum, p) => sum + (Number(p.penalty) || Number(p.penalty_portion) || 0),
      0
    )
    const facilityPenalties = Math.max(activeFacility.totalPenalties || 0, totalPaidPenalties)
    const isDailyFacility = !activeFacility.paymentFrequency || activeFacility.paymentFrequency === 'Daily'
    const termCount =
      activeFacility.termDays || (isDailyFacility ? 40 : 2)
    const cycleCount = isDailyFacility
      ? termCount
      : (termCount <= 36 ? termCount : Math.max(1, Math.round(termCount / 30)))
    const installmentTargetAmount =
      activeFacility.installmentTarget ||
      Math.round((contractualTotalPayable / Math.max(1, cycleCount)) * 100) / 100
    const termUnitLabel = isDailyFacility
      ? 'Days'
      : termCount === 1
      ? 'Month'
      : 'Months'

    return (
      <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-200">
        {/* Top navigation row */}
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setViewMode('list')}
            className="h-10 px-4 rounded-xl font-semibold text-xs sm:text-sm border border-stroke/60 bg-white text-focus hover:bg-surface flex items-center gap-2 cursor-pointer shadow-2xs self-start"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back to Borrowers</span>
          </Button>
        </div>

        {/* Borrower & Facility Header (Without Background Container or Active Badge or Collection Progress) */}
        <div className="pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-focus tracking-tight">
                  {activeFacility.borrowerName}
                </h1>
                {activeFacility.auditStatus && (
                  <span
                    className={cn(
                      'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider',
                      activeFacility.auditStatus === 'Verified'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20'
                    )}
                  >
                    {activeFacility.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Ref No: <strong className="text-focus font-mono">{activeFacility.borrower_ref_no || activeFacility.borrowerRefNo || activeFacility.loanRefNo || `BOR-${activeFacility.id}`}</strong>
                </span>
                <span className="text-muted-fg/40">•</span>
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Schedule: <strong className="text-focus">{activeFacility.paymentFrequency || 'Daily'}</strong>
                </span>
                <span className="text-muted-fg/40">•</span>
                <span className="text-xs sm:text-sm text-muted-fg font-medium">
                  Term: <strong className="text-focus">{termCount} {termUnitLabel}</strong>
                </span>
                {activeFacility.borrowerContact && (
                  <>
                    <span className="text-muted-fg/40">•</span>
                    <span className="text-xs sm:text-sm text-muted-fg font-medium">
                      Contact: <strong className="text-focus">{activeFacility.borrowerContact}</strong>
                    </span>
                  </>
                )}
                {activeFacility.borrowerAddress && (
                  <>
                    <span className="text-muted-fg/40">•</span>
                    <span className="text-xs sm:text-sm text-muted-fg font-medium">
                      Address: <strong className="text-focus">{activeFacility.borrowerAddress}</strong>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Record Payment, Edit Terms & Audit Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
              {!isAudit && activeFacility.remainingBalance > 0 && (
                <Button
                  type="button"
                  onClick={(e) => handleOpenPaymentModal(activeFacility, e)}
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
                  onClick={(e) => handleOpenEditModal(activeFacility, e)}
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
                    <span>{activeFacility.auditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDiscrepancyReason(activeFacility.auditRemarks || '')
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
          {/* Left Column: Loan Agreement & Terms Styled Like a Financial Receipt */}
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
                      Loan Agreement & Terms
                    </h3>
                    <span className="text-[10px] text-muted-fg font-medium">Official Agreement Receipt</span>
                  </div>
                </div>
                <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold border border-slate-200">
                  {activeFacility.loanRefNo || activeFacility.borrower_ref_no || activeFacility.borrowerRefNo || `LN-${activeFacility.loanId || activeFacility.id}`}
                </span>
              </div>

              {/* Terms & Schedule Parameters */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                  <span className="text-muted-fg">Date Borrowed:</span>
                  <span className="font-mono text-focus">{activeFacility.dateBorrowed}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-fg">Maturity Due Date:</span>
                  <span className="font-mono text-focus">{activeFacility.dueDate}</span>
                </div>
              </div>

              {/* Dashed Perforation */}
              <div className="border-t border-dashed border-slate-200" />

              {/* Financial Breakdown (Contractual Loan Terms: Principal + Interest) */}
              <div className="space-y-1.5 text-xs">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                  Financial Breakdown
                </div>

                {/* Principal Amount */}
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-fg">Principal Amount:</span>
                  <span className="font-mono font-bold text-focus">{formatPHP(activeFacility.loanAmount)}</span>
                </div>

                {/* Interest Rate & Contractual Interest Amount */}
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-fg">Interest Rate ({activeFacility.interestRate}%):</span>
                  <span className="font-mono font-bold text-focus">+{formatPHP(calculatedInterest)}</span>
                </div>

                {/* Total Payable (strictly Principal + Interest, never including penalties) */}
                <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-sm">
                  <span className="text-focus">Total Payable:</span>
                  <span className="font-mono text-focus">{formatPHP(contractualTotalPayable)}</span>
                </div>
              </div>

              {/* Dashed Perforation */}
              <div className="border-t border-dashed border-slate-200" />

              {/* Collections & Balances */}
              <div className="space-y-2 text-xs">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                  Collections & Balances
                </div>

                {/* Amount Paid */}
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-fg">Amount Paid:</span>
                  <span className="font-mono font-bold text-emerald-600">{formatPHP(activeFacility.amountPaid)}</span>
                </div>

                {/* Penalty Fees (Separate from contractual loan payable) */}
                {facilityPenalties > 0 && (
                  <div className="flex justify-between items-center py-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-fg">Penalty Fees:</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-[#960C01]/10 text-[#960C01] font-bold border border-[#960C01]/20">
                        Late Overdue
                      </span>
                    </div>
                    <span className="font-mono font-bold text-[#960C01]">
                      {formatPHP(facilityPenalties)}
                    </span>
                  </div>
                )}

                {/* Remaining Balance Receipt Box */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-focus block">Remaining Balance</span>
                    <span className="text-[10px] text-muted-fg">Balance to complete</span>
                  </div>
                  <span className={cn(
                    'text-base font-mono font-extrabold',
                    activeFacility.remainingBalance <= 0 ? 'text-emerald-600' : 'text-amber-600'
                  )}>
                    {formatPHP(activeFacility.remainingBalance)}
                  </span>
                </div>

                {/* Installment Target Receipt Box */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-focus block">Installment Target</span>
                    <span className="text-[10px] text-muted-fg">
                      Per {activeFacility.paymentFrequency === 'Daily' ? 'day' : 'month'}
                    </span>
                  </div>
                  <span className="text-sm font-mono font-bold text-focus">
                    {formatPHP(installmentTargetAmount)}
                  </span>
                </div>
              </div>

              {/* Agreement Notes (if any) */}
              {activeFacility.notes && (
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-muted-fg">
                  <strong className="text-focus font-semibold block mb-0.5 text-[11px]">Agreement Notes:</strong>
                  {activeFacility.notes}
                </div>
              )}


            </div>  
          </div>

          {/* Right Column: Full Width Payment History & Schedule Table */}
          <div className="lg:col-span-7 xl:col-span-8 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
            <div className="flex-1 flex flex-col space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                    Payment Schedule & History ({filteredHistoryPayments.length})
                  </h3>
                </div>

                {/* Payment Search Bar (filter dates or remarks) */}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg pointer-events-none" />
                  <Input
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    placeholder="Search dates or remarks..."
                    className="pl-9 pr-8 h-9 text-xs rounded-xl bg-slate-50 border-stroke/60 focus:bg-white"
                  />
                  {historySearchQuery && (
                    <button
                      type="button"
                      onClick={() => setHistorySearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus text-xs p-0.5 cursor-pointer"
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Payment Schedule & History Table or Empty State */}
              <div className="flex-1 flex flex-col">
                {(activeFacility.dailyPayments || []).length === 0 ? (
                  <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                      <Coins className="w-7 h-7" />
                    </div>
                    <h4 className="text-sm font-bold text-focus">No Payments Recorded Yet</h4>
                    <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                      This borrower has not started paying yet. All recorded payment transactions, dates, amounts, and receipt references will appear here as a payment log.
                    </p>
                    {!isAudit && activeFacility.remainingBalance > 0 && (
                      <Button
                        type="button"
                        onClick={(e) => handleOpenPaymentModal(activeFacility, e)}
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
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedHistoryPayments.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-12 text-center text-muted-fg text-xs">
                              <div className="flex flex-col items-center justify-center">
                                <Coins className="w-6 h-6 text-muted-fg/40 mb-2" />
                                <p className="font-semibold text-focus">
                                  No payment records matching &quot;{historySearchQuery}&quot;
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          paginatedHistoryPayments.map((p) => {
                            const installmentDate = p.cycle_due_date || p.cycleDueDate || p.date || '-'
                            const paymentDate = p.date || p.payment_date || '-'
                            const isCycleSettled = cycleSettledMap.has(installmentDate)
                            const isPartial = !isCycleSettled && (p.status === 'Partial' || p.status === 'Partially Paid')
                            return (
                              <tr
                                key={p.id}
                                className={cn(
                                  'hover:bg-slate-50/70 transition-colors',
                                  isPartial && 'bg-amber-50/20'
                                )}
                              >
                                <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                  {installmentDate}
                                </td>
                                <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap font-medium">
                                  {paymentDate}
                                </td>
                                <td className="py-2.5 px-3.5 whitespace-nowrap">
                                  {isPartial ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                      <span>Partially Paid</span>
                                    </span>
                                  ) : (p.is_late || p.isLate || (p.status && p.status.includes('Late'))) ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                      <AlertCircle className="w-2.5 h-2.5 text-[#960C01]" />
                                      <span>Paid</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                      <span>Paid</span>
                                    </span>
                                  )}
                                </td>
                                <td className={cn(
                                  'py-2.5 px-3.5 font-bold whitespace-nowrap',
                                  isPartial ? 'text-amber-700' : 'text-emerald-600'
                                )}>
                                  <div>{formatPHP(p.amount)}</div>
                                  {Boolean(p.penalty || p.penalty_portion) && (
                                    <div className="text-[10px] text-[#960C01] font-medium">
                                      +{formatPHP(p.penalty || p.penalty_portion || 0)} penalty
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3.5 text-focus whitespace-nowrap">
                                  {p.method || 'Cash'}
                                </td>
                                <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap">
                                  {p.referenceNo || '-'}
                                </td>
                                <td className="py-2.5 px-3.5 text-muted-fg truncate max-w-[240px]" title={p.notes || '-'}>
                                  {p.notes || '-'}
                                </td>
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

            {/* Payment Schedule & History Pagination Footer (Always Anchored at Bottom) */}
            <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
              <span className="font-medium text-focus/80">
                {filteredHistoryPayments.length === 0
                  ? 'Showing 0-0 of 0 records'
                  : `Showing ${historyStartIndex + 1}-${historyEndIndex} of ${filteredHistoryPayments.length} records`}
              </span>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className="text-xs text-muted-fg font-medium">
                  Page {safeHistoryPage} out of {historyTotalPages}
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeHistoryPage <= 1}
                  onClick={() => setHistoryCurrentPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  aria-label="Previous history page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeHistoryPage >= historyTotalPages}
                  onClick={() => setHistoryCurrentPage((p) => Math.min(historyTotalPages, p + 1))}
                  className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                  aria-label="Next history page"
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

  const displayedCompanyTitle = COMPANY_NAME

  return (
    <div className="space-y-6 pb-12 max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {viewMode === 'details' && activeFacility ? (
        renderDetailsPage()
      ) : (
        <>
          {/* 1. Header & Controls matching Sales Page */}
          <div className="space-y-4">
            {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
                  Lending
                </h1>
                <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
                  Here's the summary of lending facilities in {displayedCompanyTitle}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start shrink-0">
                {/* Export Dropdown Button matching SalesPage */}
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
                    <FileText className="w-4 h-4 text-[#960C01] shrink-0" />
                    <span>Download as PDF</span>
                  </button>
                </div>
              )}
            </div>

            {/* New Lending Facility Button (Red primary button per Sales Page aesthetic - hidden for Audit) */}
            {!isAudit && !isOwner && (
              <Button
                type="button"
                onClick={() => {
                  const today = formatToYYYYMMDD(new Date())
                  const term = formData.termDays || '40'
                  const projected = calculateProjectedDueDate(today, term)
                  setFormData((prev) => ({
                    ...prev,
                    dateBorrowed: today,
                    dueDate: projected || prev.dueDate,
                  }))
                  setAddModalError(null)
                  setIsAddModalOpen(true)
                }}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>New Borrower</span>
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
              placeholder="Search by Borrower's Name or Notes…"
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
                  {(['All', 'Active', 'Completed', 'Overdue'] as const).map((st) => (
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
                      <span>
                        {st === 'All'
                          ? 'All Status'
                          : st === 'Active'
                          ? 'Active Loans'
                          : st === 'Completed'
                          ? 'Completed'
                          : 'Overdue'}
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
              onChange={(newRange) => setDateRange(newRange)}
              hidePresets
            />
          </div>
        </div>
      </div>

      {/* Main Table Card matching Sales Page */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Table with Requirement 3 columns and Action Buttons */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className={cn('w-full table-fixed', isAudit ? 'min-w-[1240px]' : 'min-w-[1160px]')}>
            <colgroup>
              {isAudit ? (
                <>
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '8.5%' }} />
                  <col style={{ width: '5.5%' }} />
                </>
              ) : (
                <>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '6%' }} />
                </>
              )}
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className={cn(isAudit ? "w-[16%]" : "w-[18%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  BORROWER'S NAME
                </TableHead>
                <TableHead className={cn(isAudit ? "w-[10%]" : "w-[11%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  LOAN AMOUNT
                </TableHead>
                <TableHead className={cn(isAudit ? "w-[9%]" : "w-[10%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  DATE BORROWED
                </TableHead>
                <TableHead className={cn(isAudit ? "w-[9%]" : "w-[10%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  DUE DATE
                </TableHead>
                <TableHead className={cn(isAudit ? "w-[14%]" : "w-[15%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  TOTAL PAYABLE
                </TableHead>
                <TableHead className={cn(isAudit ? "w-[10%]" : "w-[11%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  AMOUNT PAID
                </TableHead>
                <TableHead className={cn(isAudit ? "w-[11%]" : "w-[12%]", "px-3.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap")}>
                  REMAINING BALANCE
                </TableHead>
                <TableHead className="w-[7%] px-2.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                  STATUS
                </TableHead>
                {isAudit && (
                  <TableHead className="w-[8.5%] px-2.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                    AUDIT TAG
                  </TableHead>
                )}
                <TableHead className={cn(isAudit ? "w-[5.5%]" : "w-[6%]", "px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap")}>
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={5} columns={isAudit ? 10 : 9} />
              ) : paginatedFacilities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAudit ? 10 : 9} className="h-44 text-center py-8">
                    <div className="flex flex-col items-center justify-center text-muted-fg">
                      <CreditCard className="h-8 w-8 text-muted-fg/40 mb-2" />
                      <p className="text-sm font-semibold">No borrowers found</p>
                      <p className="text-xs text-muted-fg/70 mt-0.5">
                        Try adjusting your search, status, or date range filter, or click &quot;New Borrower&quot;.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedFacilities.map((facility) => {
                  const statusColors = {
                    Active: 'bg-blue-50 text-blue-700 border-blue-200',
                    Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
                    Overdue: 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20',
                  }[facility.status]

                  const isHighlighted = highlightedFacilityId === facility.id

                  return (
                    <TableRow
                      key={facility.id}
                      onClick={() => handleRowClick(facility)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer group',
                        isHighlighted && 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-300'
                      )}
                      title="Click row to view complete lending and borrower details"
                    >
                      {/* Borrower's Name & Borrower Ref No */}
                      <TableCell className={cn(isAudit ? "w-[16%]" : "w-[18%]", "px-3.5 py-3 text-left")}>
                        <div className="font-semibold text-xs text-focus truncate max-w-[190px]" title={facility.borrowerName}>
                          {facility.borrowerName}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {facility.borrowerContact && (
                            <span className="text-[10px] text-muted-fg truncate max-w-[120px]">
                              {facility.borrowerContact}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* 2. Loan Amount */}
                      <TableCell className={cn(isAudit ? "w-[10%]" : "w-[11%]", "px-3.5 py-3 text-left font-semibold text-xs text-focus tabular-nums whitespace-nowrap")}>
                        {formatPHP(facility.loanAmount)}
                      </TableCell>

                      {/* 3. Date Borrowed */}
                      <TableCell className={cn(isAudit ? "w-[9%]" : "w-[10%]", "px-3.5 py-3 text-left font-mono text-xs text-muted-fg whitespace-nowrap")}>
                        {facility.dateBorrowed}
                      </TableCell>

                      {/* 4. Due Date */}
                      <TableCell className={cn(isAudit ? "w-[9%]" : "w-[10%]", "px-3.5 py-3 text-left text-xs whitespace-nowrap")}>
                        <div className="font-mono text-muted-fg font-medium">{facility.dueDate}</div>
                        <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                          {(() => {
                            const isDaily = !facility.paymentFrequency || facility.paymentFrequency === 'Daily'
                            const t = facility.termDays || (isDaily ? 40 : 2)
                            const unit = isDaily ? 'days' : t === 1 ? 'month' : 'months'
                            return `${t} ${unit} term`
                          })()}
                        </div>
                      </TableCell>

                      {/* 5. Total Amount Payable */}
                      <TableCell className={cn(isAudit ? "w-[14%]" : "w-[15%]", "px-3.5 py-3 text-left font-bold text-xs text-focus tabular-nums whitespace-nowrap")}>
                        {formatPHP(facility.totalAmountPayable)}
                      </TableCell>

                      {/* 6. Amount Paid */}
                      <TableCell className={cn(isAudit ? "w-[10%]" : "w-[11%]", "px-3.5 py-3 text-left font-semibold text-xs text-emerald-600 tabular-nums whitespace-nowrap")}>
                        {formatPHP(facility.amountPaid)}
                      </TableCell>

                      {/* 7. Remaining Balance */}
                      <TableCell className={cn(isAudit ? "w-[11%]" : "w-[12%]", "px-3.5 py-3 text-left font-bold text-xs text-amber-600 tabular-nums whitespace-nowrap")}>
                        <div>{formatPHP(facility.remainingBalance)}</div>
                      </TableCell>

                      {/* 8. Status */}
                      <TableCell className="w-[7%] px-2.5 py-3 text-center whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border uppercase tracking-wider',
                            statusColors
                          )}
                        >
                          {facility.status}
                        </span>
                      </TableCell>

                      {/* 9. Audit Tag (Dedicated column for Auditor account) */}
                      {isAudit && (
                        <TableCell className="w-[8.5%] px-2.5 py-3 text-center whitespace-nowrap">
                          {facility.auditStatus ? (
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              <span
                                className={cn(
                                  'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                                  facility.auditStatus === 'Verified'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20'
                                )}
                              >
                                {facility.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                              </span>
                              {facility.auditDate && (
                                <span
                                  className="block text-[9.5px] text-muted-fg font-mono whitespace-nowrap mt-0.5"
                                  title={facility.auditedBy ? `Audited by ${facility.auditedBy}` : undefined}
                                >
                                  {facility.auditDate}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-fg/40 font-mono">-</span>
                          )}
                        </TableCell>
                      )}

                      {/* 10. Actions: 3 dots dropdown (Edit, Delete, Update for staff; Mark Audit / Flag Discrepancy for Auditor) */}
                      <TableCell className={cn(isAudit ? "w-[5.5%]" : "w-[6%]", "px-2 py-3 text-center whitespace-nowrap")} onClick={(e) => e.stopPropagation()}>
                        {isOwner ? (
                          <span className="text-muted-fg text-xs">—</span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (openMenuFacilityId === facility.id) {
                                setOpenMenuFacilityId(null)
                                setMenuPosition(null)
                                setActiveMenuFacility(null)
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 140 > window.innerHeight
                                setMenuPosition({
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                                setActiveMenuFacility(facility)
                                setOpenMenuFacilityId(facility.id)
                              }
                            }}
                            className="lending-action-btn h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer mx-auto flex items-center justify-center transition-colors"
                            title="Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
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

        {/* 6. Pagination Footer (Matching Sales table reference: Showing X of Y and Page 1 out of 10) */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          {/* Left: Record summary */}
          <span className="font-medium text-focus/80">
            {filteredFacilities.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredFacilities.length} records`}
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
      </>
      )}

      {/* Floating 3-dots Action Menu Portal (rendered directly to body to prevent table overflow clipping) */}
      {openMenuFacilityId && activeMenuFacility && menuPosition && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="lending-portal-menu fixed w-36 bg-white rounded-xl border border-slate-200 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {canAuditActions ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const fac = activeMenuFacility
                    if (fac) {
                      const timestamp = new Date().toLocaleString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })
                      const updated = facilities.map((item) =>
                        item.id === fac.id
                          ? { ...item, auditStatus: 'Verified' as const, auditDate: timestamp, auditedBy: user?.fullName || 'Audit' }
                          : item
                      )
                      setFacilities(updated)
                      if (typeof window !== 'undefined') {
                        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated)) } catch (err) {}
                      }
                      setOpenMenuFacilityId(null)
                      setMenuPosition(null)
                      setActiveMenuFacility(null)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Mark as Audit</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const fac = activeMenuFacility
                    if (fac) {
                      const timestamp = new Date().toLocaleString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })
                      const updated = facilities.map((item) =>
                        item.id === fac.id
                          ? { ...item, auditStatus: 'Flagged' as const, auditDate: timestamp, auditedBy: user?.fullName || 'Audit' }
                          : item
                      )
                      setFacilities(updated)
                      if (typeof window !== 'undefined') {
                        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated)) } catch (err) {}
                      }
                      setOpenMenuFacilityId(null)
                      setMenuPosition(null)
                      setActiveMenuFacility(null)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-[#960C01] hover:bg-[#960C01]/10 transition-colors text-left cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-[#960C01] shrink-0" />
                  <span>Mark as Discrepancy</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const fac = activeMenuFacility
                    setOpenMenuFacilityId(null)
                    setMenuPosition(null)
                    setActiveMenuFacility(null)
                    if (fac) {
                      handleRowClick(fac)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>View Details</span>
                </button>
              </>
            ) : (
              <>
                {/* Update: Everyday payment */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const fac = activeMenuFacility
                    setOpenMenuFacilityId(null)
                    setMenuPosition(null)
                    setActiveMenuFacility(null)
                    if (fac) {
                      handleOpenDailyPaymentModal(fac, e)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <Coins className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Update</span>
                </button>

                {/* Edit: Facility details */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const fac = activeMenuFacility
                    setOpenMenuFacilityId(null)
                    setMenuPosition(null)
                    setActiveMenuFacility(null)
                    if (fac) {
                      handleOpenEditModal(fac, e)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Edit</span>
                </button>

                {/* Delete: Remove facility */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const fac = activeMenuFacility
                    setOpenMenuFacilityId(null)
                    setMenuPosition(null)
                    setActiveMenuFacility(null)
                    if (fac) {
                      handleOpenDeleteModal(fac, e)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-[#960C01] hover:bg-[#960C01]/10 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-[#960C01] shrink-0" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )}

      {/* 4. Modal: New Lending Facility (Requirement 2) */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-focus">
              New Borrower
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg">
              Enter the borrower and loan details to disburse a new credit agreement.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateFacility} className="space-y-4 mt-3">
            {/* Inline Error Banner */}
            {addModalError && (
              <div className="p-3 bg-[#960C01]/10 border border-[#960C01]/20 rounded-xl flex items-start justify-between gap-2 text-xs text-[#960C01]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#960C01] mt-0.5" />
                  <span>{addModalError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAddModalError(null)}
                  className="text-[#960C01] hover:text-[#800a01] font-bold ml-1 text-sm leading-none"
                >
                  &times;
                </button>
              </div>
            )}

            {/* Field 1: Name */}
            <div>
              <label className="text-xs font-semibold text-focus block mb-1">
                Name (Borrower's Name) <span className="text-[#960C01]">*</span>
              </label>
              <Input
                required
                value={formData.borrowerName}
                onChange={(e) => setFormData({ ...formData, borrowerName: e.target.value })}
                placeholder="e.g. Elena Morales (Morales Grocery Store)"
                className="h-10 text-xs sm:text-sm rounded-xl"
              />
            </div>

            {/* Field 2 & 3: Loan Amount & Interest Rate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Loan Amount (₱) <span className="text-[#960C01]">*</span>
                </label>
                <Input
                  required
                  type="number"
                  min="1000"
                  step="500"
                  value={formData.loanAmount}
                  onChange={(e) => setFormData({ ...formData, loanAmount: e.target.value })}
                  placeholder="30000"
                  className="h-10 text-xs sm:text-sm rounded-xl font-semibold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Interest Rate (%) <span className="text-[#960C01]">*</span>
                </label>
                <Input
                  required
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.interestRate}
                  onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })}
                  placeholder="20.0"
                  className="h-10 text-xs sm:text-sm rounded-xl font-semibold"
                />
              </div>
            </div>

            {/* Field 4 & 5: Payment Schedule & Term */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Payment Schedule <span className="text-[#960C01]">*</span>
                </label>
                <select
                  value={formData.paymentFrequency}
                  onChange={(e) => {
                    const freq = e.target.value as 'Daily' | 'Monthly'
                    let newTerm = formData.termDays
                    if (freq === 'Daily' && formData.paymentFrequency !== 'Daily') {
                      newTerm = '40'
                    } else if (freq === 'Monthly' && (formData.paymentFrequency === 'Daily' || parseInt(formData.termDays, 10) > 36)) {
                      newTerm = '1'
                    }
                    const newDue = calculateProjectedDueDate(formData.dateBorrowed, newTerm, freq)
                    setFormData({
                      ...formData,
                      paymentFrequency: freq,
                      termDays: newTerm,
                      dueDate: newDue || formData.dueDate,
                    })
                  }}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 font-semibold"
                >
                  <option value="Daily">Daily</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Term ({formData.paymentFrequency === 'Daily' ? 'Days' : 'Months'}) <span className="text-[#960C01]">*</span>
                </label>
                <Input
                  required
                  type="number"
                  min="1"
                  value={formData.termDays}
                  onChange={(e) => {
                    const val = e.target.value
                    const newDue = calculateProjectedDueDate(formData.dateBorrowed, val, formData.paymentFrequency)
                    setFormData({
                      ...formData,
                      termDays: val,
                      dueDate: newDue || formData.dueDate,
                    })
                  }}
                  placeholder={formData.paymentFrequency === 'Daily' ? '40' : '1'}
                  className="h-10 text-xs sm:text-sm rounded-xl font-semibold"
                />
              </div>
            </div>

            {/* Field 6 & 7: Date Borrowed & Due Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Date Borrowed <span className="text-[#960C01]">*</span>
                </label>
                <Input
                  required
                  type="date"
                  value={formData.dateBorrowed}
                  onChange={(e) => {
                    const val = e.target.value
                    const newDue = calculateProjectedDueDate(val, formData.termDays, formData.paymentFrequency)
                    setFormData({
                      ...formData,
                      dateBorrowed: val,
                      dueDate: newDue || formData.dueDate,
                    })
                  }}
                  className="h-10 text-xs sm:text-sm rounded-xl"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-focus flex items-center justify-between mb-1">
                  <span>Due Date</span>
                </label>
                <Input
                  required
                  type="date"
                  readOnly
                  tabIndex={-1}
                  value={formData.dueDate}
                  title="Due Date is automatically calculated from Date Borrowed and Term"
                  className="h-10 text-xs sm:text-sm rounded-xl font-mono bg-slate-100 text-muted-fg cursor-not-allowed select-none pointer-events-none border-slate-200"
                />
              </div>
            </div>

            {/* Dynamic Calculation Summary Box */}
            {formData.loanAmount && !isNaN(parseFloat(formData.loanAmount)) && (() => {
              const p = parseFloat(formData.loanAmount) || 0
              const r = parseFloat(formData.interestRate || '20.0') || 0
              const interest = p * (r / 100)
              const totalPayable = p + interest
              const isDaily = formData.paymentFrequency === 'Daily'
              const termNum = parseInt(formData.termDays || (isDaily ? '40' : '1'), 10) || 1
              const cycleCount = isDaily ? termNum : (termNum <= 36 ? termNum : Math.max(1, Math.round(termNum / 30)))
              const installmentTarget = cycleCount > 0 ? totalPayable / cycleCount : totalPayable

              const unitLabel = isDaily ? 'day' : 'month'

              const termLabel = isDaily
                ? `${termNum} days`
                : `${termNum} month${termNum > 1 ? 's' : ''}`

              return (
                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-fg">Total Interest ({formData.interestRate}%):</span>
                    <span className="font-semibold text-focus">
                      {formatPHP(interest)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-200/60 pt-1">
                    <span className="font-bold text-focus">Total Amount Payable:</span>
                    <span className="font-bold text-emerald-600 text-sm">
                      {formatPHP(totalPayable)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-muted-fg text-[11px] pt-0.5">
                    <span>
                      {formData.paymentFrequency} Installment Target ({termLabel}):
                    </span>
                    <span className="font-bold text-focus">
                      {formatPHP(installmentTarget)}{' '}
                      / {unitLabel}
                    </span>
                  </div>
                </div>
              )
            })()}

            {/* Optional Loan Purpose / Notes */}
            <div>
              <label className="text-xs font-semibold text-focus block mb-1">
                Loan Purpose / Notes (Optional)
              </label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="e.g. Everyday grocery inventory replenishment"
                className="h-10 text-xs sm:text-sm rounded-xl"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                disabled={isCreatingBorrower}
                onClick={() => setIsAddModalOpen(false)}
                className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreatingBorrower}
                className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
              >
                {isCreatingBorrower ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <span>Create Borrower</span>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 5. Modal: Shared Record Payment Modal */}
      {activeFacility && (
        <SharedPaymentModal
          open={isDailyPaymentModalOpen}
          onOpenChange={setIsDailyPaymentModalOpen}
          isAudit={isAudit}
          entityName={activeFacility.borrowerName}
          entitySubtitle={`${activeFacility.paymentFrequency || 'Daily'} Schedule`}
          accountTypeLabel="Loan"
          referenceNumber={activeFacility.borrower_ref_no || activeFacility.borrowerRefNo || activeFacility.loanRefNo || `BOR-${activeFacility.id}`}
          paymentFrequency={activeFacility.paymentFrequency || 'Daily'}
          dailyTarget={getFacilityDailyTarget(activeFacility)}
          remainingBalance={activeFacility.remainingBalance}
          contractDate={activeFacility.dateBorrowed}
          dueDate={activeFacility.dueDate}
          existingPayments={activeFacility.dailyPayments || []}
          monthlyProgress={
            activeFacility.paymentFrequency === 'Monthly'
              ? getMonthlyProgress(activeFacility).months
              : undefined
          }
          onSubmitPayment={async (subData) => {
            const backendRes = await lendingService.recordPayment({
              borrower_id: activeFacility.borrower_id || activeFacility.borrowerId,
              facilityId: activeFacility.id,
              paymentDate: subData.paymentDate,
              cycleDueDate: subData.targetInstallmentDate,
              cycleIndex: subData.cycleIndex,
              amount: subData.amount,
              penaltyAmount: subData.penaltyAmount,
              method: subData.method,
              referenceNo: subData.referenceNo,
              notes: subData.notes,
              status: subData.status,
            })

            if (!backendRes.success) {
              throw new Error(
                formatUserFriendlyErrorMessage(
                  backendRes.message,
                  'Unable to record payment remittance. Please try again.'
                )
              )
            }

            await loadFacilities()
          }}
        />
      )}

      {/* 6. Modal: Edit Borrower Details */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-focus">
              Edit Borrower
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg">
              Update terms and loan records for{' '}
              <strong className="text-focus">{activeFacility?.borrowerName}</strong>.
            </DialogDescription>
          </DialogHeader>

          {activeFacility && (() => {
            const isTermsLocked = Boolean(
              (activeFacility.amountPaid && activeFacility.amountPaid > 0) ||
              (activeFacility.dailyPayments && activeFacility.dailyPayments.length > 0) ||
              (activeFacility.dateBorrowed && activeFacility.dateBorrowed < formatToYYYYMMDD(new Date()))
            )

            return (
            <form onSubmit={handleSaveEditFacility} className="space-y-4 mt-2">
              {/* Inline Error Banner */}
              {editModalError && (
                <div className="p-3 bg-[#960C01]/10 border border-[#960C01]/20 rounded-xl flex items-start justify-between gap-2 text-xs text-[#960C01]">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#960C01] mt-0.5" />
                    <span>{editModalError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditModalError(null)}
                    className="text-[#960C01] hover:text-[#800a01] font-bold ml-1 text-sm leading-none"
                  >
                    &times;
                  </button>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Borrower's Name <span className="text-[#960C01]">*</span>
                </label>
                <Input
                  required
                  value={editFormData.borrowerName}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, borrowerName: e.target.value })
                  }
                  className="h-10 text-xs sm:text-sm rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Loan Amount (₱) <span className="text-[#960C01]">*</span>
                  </label>
                  <Input
                    required
                    type="number"
                    min="1000"
                    step="500"
                    readOnly={isTermsLocked}
                    disabled={isTermsLocked}
                    value={editFormData.loanAmount}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, loanAmount: e.target.value })
                    }
                    className={cn(
                      'h-10 text-xs sm:text-sm rounded-xl',
                      isTermsLocked && 'bg-slate-100 text-muted-fg cursor-not-allowed select-none'
                    )}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Interest Rate (%) <span className="text-[#960C01]">*</span>
                  </label>
                  <Input
                    required
                    type="number"
                    step="0.1"
                    min="0"
                    readOnly={isTermsLocked}
                    disabled={isTermsLocked}
                    value={editFormData.interestRate}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, interestRate: e.target.value })
                    }
                    className={cn(
                      'h-10 text-xs sm:text-sm rounded-xl',
                      isTermsLocked && 'bg-slate-100 text-muted-fg cursor-not-allowed select-none'
                    )}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Payment Schedule
                  </label>
                  <select
                    value={editFormData.paymentFrequency}
                    disabled={isTermsLocked}
                    onChange={(e) => {
                      const freq = e.target.value as 'Daily' | 'Monthly'
                      let newTerm = editFormData.termDays
                      if (freq === 'Daily' && editFormData.paymentFrequency !== 'Daily') {
                        newTerm = '40'
                      } else if (freq === 'Monthly' && (editFormData.paymentFrequency === 'Daily' || parseInt(editFormData.termDays, 10) > 36)) {
                        newTerm = '1'
                      }
                      const newDue = calculateProjectedDueDate(editFormData.dateBorrowed, newTerm, freq)
                      setEditFormData({
                        ...editFormData,
                        paymentFrequency: freq,
                        termDays: newTerm,
                        dueDate: newDue || editFormData.dueDate,
                      })
                    }}
                    className={cn(
                      'w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20',
                      isTermsLocked && 'bg-slate-100 text-muted-fg cursor-not-allowed select-none'
                    )}
                  >
                    <option value="Daily">Daily</option>
                    <option value="Monthly">Monthly</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Term ({editFormData.paymentFrequency === 'Daily' ? 'Days' : 'Months'}) <span className="text-[#960C01]">*</span>
                  </label>
                  <Input
                    required
                    type="number"
                    min="1"
                    readOnly={isTermsLocked}
                    disabled={isTermsLocked}
                    value={editFormData.termDays}
                    onChange={(e) => {
                      const val = e.target.value
                      const newDue = calculateProjectedDueDate(editFormData.dateBorrowed, val, editFormData.paymentFrequency)
                      setEditFormData({
                        ...editFormData,
                        termDays: val,
                        dueDate: newDue || editFormData.dueDate,
                      })
                    }}
                    placeholder={editFormData.paymentFrequency === 'Daily' ? '40' : '1'}
                    className={cn(
                      'h-10 text-xs sm:text-sm rounded-xl font-semibold',
                      isTermsLocked && 'bg-slate-100 text-muted-fg cursor-not-allowed select-none'
                    )}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Date Borrowed <span className="text-[#960C01]">*</span>
                  </label>
                  <Input
                    required
                    type="date"
                    readOnly={isTermsLocked}
                    disabled={isTermsLocked}
                    value={editFormData.dateBorrowed}
                    onChange={(e) => {
                      const val = e.target.value
                      const newDue = calculateProjectedDueDate(val, editFormData.termDays, editFormData.paymentFrequency)
                      setEditFormData({
                        ...editFormData,
                        dateBorrowed: val,
                        dueDate: newDue || editFormData.dueDate,
                      })
                    }}
                    className={cn(
                      'h-10 text-xs sm:text-sm rounded-xl',
                      isTermsLocked && 'bg-slate-100 text-muted-fg cursor-not-allowed select-none'
                    )}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-focus flex items-center justify-between mb-1">
                    <span>Due Date (Read-only)</span>
                  </label>
                  <Input
                    required
                    type="date"
                    readOnly
                    tabIndex={-1}
                    value={editFormData.dueDate}
                    className="h-10 text-xs sm:text-sm rounded-xl font-mono bg-slate-100 text-muted-fg cursor-not-allowed select-none pointer-events-none border-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Status
                </label>
                <select
                  value={editFormData.status}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      status: e.target.value as LendingFacility['status'],
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                >
                  <option value="Active">Active</option>
                  <option value="Completed">Completed</option>
                  <option value="Overdue">Overdue</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-focus block mb-1">
                  Notes
                </label>
                <Input
                  value={editFormData.notes}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, notes: e.target.value })
                  }
                  className="h-10 text-xs sm:text-sm rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isUpdatingBorrower}
                  onClick={() => setIsEditModalOpen(false)}
                  className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isUpdatingBorrower}
                  className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isUpdatingBorrower ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </Button>
              </div>
            </form>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 7. Modal: Delete Borrower Confirmation */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto bg-white rounded-[24px] p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#960C01] flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-[#960C01]" />
              <span>Delete Borrower</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-1">
              Are you sure you want to delete the record for{' '}
              <strong className="text-focus">{activeFacility?.borrowerName}</strong>? This action will remove all recorded payment history and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {/* Inline Error Banner */}
          {deleteModalError && (
            <div className="p-3 bg-[#960C01]/10 border border-[#960C01]/20 rounded-xl flex items-start justify-between gap-2 text-xs text-[#960C01] mt-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#960C01] mt-0.5" />
                <span>{deleteModalError}</span>
              </div>
              <button
                type="button"
                onClick={() => setDeleteModalError(null)}
                className="text-[#960C01] hover:text-[#800a01] font-bold ml-1 text-sm leading-none"
              >
                &times;
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={isDeletingBorrower}
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isDeletingBorrower}
              onClick={handleConfirmDelete}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer shadow-xs disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isDeletingBorrower ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <span>Delete Borrower</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Modal: Mark as Audited Confirmation */}
      <Dialog open={isAuditConfirmModalOpen} onOpenChange={setIsAuditConfirmModalOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>Confirm Audit Verification</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-1.5 leading-relaxed">
              Are you sure you want to mark the loan facility for{' '}
              <strong className="text-focus">{activeFacility?.borrowerName}</strong> as audited? This will record
              your verification and timestamp.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-2">
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
              onClick={handleConfirmAudit}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmittingAudit ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirm & Mark Audited</span>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Flag Discrepancy Reason */}
      <Dialog open={isDiscrepancyModalOpen} onOpenChange={setIsDiscrepancyModalOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-[#960C01] flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-[#960C01]" />
              <span>Flag Audit Discrepancy</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-1.5 leading-relaxed">
              Please specify the audit findings, discrepancies, or notes for{' '}
              <strong className="text-focus">{activeFacility?.borrowerName}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label className="text-xs font-semibold text-focus block">
              Discrepancy Reason / Findings <span className="text-[#960C01]">*</span>
            </label>
            <textarea
              value={discrepancyReason}
              onChange={(e) => setDiscrepancyReason(e.target.value)}
              placeholder="Detail any payment discrepancies, unrecorded ledger items, or issues..."
              className="min-h-[100px] text-xs rounded-xl"
              autoFocus
            ></textarea>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmittingAudit}
              onClick={() => {
                setIsDiscrepancyModalOpen(false)
                setDiscrepancyReason('')
              }}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSubmittingAudit || !discrepancyReason.trim()}
              onClick={handleConfirmDiscrepancy}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmittingAudit ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Flagging...</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>Flag Discrepancy</span>
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default LendingPage
