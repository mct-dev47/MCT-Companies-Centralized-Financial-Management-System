import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Landmark,
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
  Pencil,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  CheckCircle2,
  HandCoins,
  Clock,
  MoreVertical,
  Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
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
import { AddLoanModal } from '@/components/dashboard/AddLoanModal'
import { EditLoanModal } from '@/components/dashboard/EditLoanModal'
import { ApproveLoanModal } from '@/components/dashboard/ApproveLoanModal'
import { AuditReviewLoanModal } from '@/components/dashboard/AuditReviewLoanModal'
import { RecordPaymentModal } from '@/components/dashboard/RecordPaymentModal'
import { LoanHorizontalBarChart } from '@/components/dashboard/LoanHorizontalBarChart'
import { AdminCompanyLoansView } from '@/components/dashboard/AdminCompanyLoansView'
import { useSession } from '@/hooks/useSession'
import { formatPHP } from '@/lib/format'
import {
  loanService,
  type LoanItem,
  type CompanyOption,
} from '@/services/loanService'
import { websocketService } from '@/services/websocketService'
import { useLocation } from 'react-router-dom'
import { isDateInRange, normalizeDateToYYYYMMDD, formatToYYYYMMDD, formatCreatedAt } from '@/utils/dateUtils'
import { cn } from '@/lib/utils'
import { useCompany } from '@/context/CompanyContext'
import { isCompanyMatch } from '@/utils/companyUtils'


const PERIOD_OPTIONS = ['All Periods', 'Daily', 'Monthly', 'Quarterly', 'Annually'] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

const ITEMS_PER_PAGE = 10

interface LoanPageProps {
  initialType?: 'Borrower' | 'Lender'
}

export const LoanPage: React.FC<LoanPageProps> = ({ initialType = 'Borrower' }) => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isFinance = userRole === 'finance'
  const isAdmin = userRole === 'admin'
  const isAuditor = isAudit
  const isCompanyScoped = !isAdmin && !isFinance
  const canApprove = (isFinance || isAdmin) && !isAudit
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'

  const location = useLocation()
  const [loanType, setLoanType] = React.useState<'Borrower' | 'Lender'>(() => {
    const path = location.pathname.toLowerCase()
    if (path.includes('lender')) return 'Lender'
    if (path.includes('borrower')) return 'Borrower'
    return initialType
  })

  // Sync loanType with URL changes
  React.useEffect(() => {
    const path = location.pathname.toLowerCase()
    if (path.includes('lender')) {
      setLoanType('Lender')
    } else if (path.includes('borrower')) {
      setLoanType('Borrower')
    }
  }, [location.pathname])

  // Dynamic document title
  React.useEffect(() => {
    if (isAdmin) {
      document.title = 'Company Loans - MCT Centralized Financial System'
    } else {
      document.title = `${loanType} Loans - MCT Centralized Financial System`
    }
  }, [isAdmin, loanType])

  const [dbCompanies, setDbCompanies] = React.useState<CompanyOption[]>([])
  const [loans, setLoans] = React.useState<LoanItem[]>([])
  const [loading, setLoading] = React.useState(true)

  const { activeCompany, setActiveCompany } = useCompany()

  // Filter state
  const [selectedCompany, setSelectedCompany] = React.useState<string>(
    isCompanyScoped ? assignedCompany : (activeCompany || 'All Companies')
  )

  // Keep selectedCompany in sync if user profile loads after initial render
  React.useEffect(() => {
    if (isCompanyScoped && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    }
  }, [isCompanyScoped, user?.assignedCompany])

  // Keep selectedCompany in sync with global activeCompany from context
  React.useEffect(() => {
    if (!isCompanyScoped && activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany, isCompanyScoped])
  const [statusFilter, setStatusFilter] = React.useState<string>('All')
  const [approvalTab, setApprovalTab] = React.useState<'Approve' | 'Pending'>('Approve')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodOption>('All Periods')
  const [dateRange, setDateRange] = React.useState<DateRange>({
    preset: 'All Dates',
    label: 'All Dates',
    startDate: null,
    endDate: null,
  })
  const [searchQuery, setSearchQuery] = React.useState('')
  const [currentPage, setCurrentPage] = React.useState(1)

  // Dropdown menus
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [companySearch, setCompanySearch] = React.useState('')

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  // Modals & Action state
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
  const [viewLoanItem, setViewLoanItem] = React.useState<LoanItem | null>(null)
  const [editLoan, setEditLoan] = React.useState<LoanItem | null>(null)
  const [approveLoanItem, setApproveLoanItem] = React.useState<LoanItem | null>(null)
  const [auditReviewLoanItem, setAuditReviewLoanItem] = React.useState<LoanItem | null>(null)
  const [deleteConfirmLoan, setDeleteConfirmLoan] = React.useState<LoanItem | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  // Payment modal state for borrower loans (supervisor)
  const [paymentLoan, setPaymentLoan] = React.useState<LoanItem | null>(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = React.useState(false)

  const [highlightedLoanId, setHighlightedLoanId] = React.useState<string | null>(null)

  // 3-Dots Action Menu State
  const [openMenuLoanId, setOpenMenuLoanId] = React.useState<string | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward?: boolean
  } | null>(null)
  const [activeMenuLoan, setActiveMenuLoan] = React.useState<LoanItem | null>(null)

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        !target.closest('.loan-portal-menu') &&
        !target.closest('.loan-action-btn')
      ) {
        setOpenMenuLoanId(null)
        setMenuPosition(null)
        setActiveMenuLoan(null)
      }
    }
    const handleScrollOrResize = () => {
      setOpenMenuLoanId(null)
      setMenuPosition(null)
      setActiveMenuLoan(null)
    }
    if (openMenuLoanId) {
      document.addEventListener('mousedown', handleOutsideClick)
      window.addEventListener('scroll', handleScrollOrResize, true)
      window.addEventListener('resize', handleScrollOrResize)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [openMenuLoanId])

  const handleMarkLoanAudit = async (loan: LoanItem, status: 'Verified' | 'Flagged') => {
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const updatedLoan: LoanItem = {
      ...loan,
      auditStatus: status,
      auditDate: timestamp,
      auditedBy: user?.fullName || 'Audit',
      status: status === 'Verified' ? (loan.status === 'Pending Audit' ? 'Approved' : loan.status) : loan.status,
    }
    setLoans((prev) => prev.map((l) => (l.id === loan.id ? updatedLoan : l)))
    try {
      await loanService.auditReviewLoan(loan.id, {
        action: status === 'Verified' ? 'approve' : 'disapprove',
        remark: status === 'Verified' ? 'Audited & Verified' : 'Discrepancy flagged by audit',
      })
    } catch {
      // Fallback if endpoint is unavailable
    }
    setOpenMenuLoanId(null)
  }

  // Fetch Companies from Database
  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((res) => {
      if (mounted && res.length > 0) {
        setDbCompanies(res)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  const companyNamesList = React.useMemo(() => {
    const list = dbCompanies.map((c) => c.company_name).filter(Boolean)
    return ['All Companies', ...list]
  }, [dbCompanies])

  const handlePeriodChange = (period: PeriodOption) => {
    setSelectedPeriod(period)
    setIsPeriodDropdownOpen(false)
    const currentToday = formatToYYYYMMDD(new Date())
    const [currYear, currMonth] = currentToday.split('-')

    switch (period) {
      case 'All Periods':
        setDateRange({
          preset: 'all',
          label: 'All Periods',
          startDate: null,
          endDate: null,
        })
        break
      case 'Daily':
        setDateRange({
          preset: 'today',
          label: 'Today',
          startDate: currentToday,
          endDate: currentToday,
        })
        break
      case 'Monthly': {
        const lastDay = new Date(parseInt(currYear, 10), parseInt(currMonth, 10), 0).getDate()
        setDateRange({
          preset: 'This Month',
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

  const loadLoans = React.useCallback(async () => {
    try {
      setLoading(true)
      const data = await loanService.getLoans({
        company: isCompanyScoped ? assignedCompany : (selectedCompany === 'All Companies' ? undefined : selectedCompany),
        scope: loanType.toLowerCase() as 'borrower' | 'lender',
      })
      setLoans(data)
    } catch (err) {
      console.error('Failed to load loans:', err)
    } finally {
      setLoading(false)
    }
  }, [isCompanyScoped, assignedCompany, selectedCompany, loanType])

  React.useEffect(() => {
    loadLoans()
  }, [loadLoans])

  // Real-time synchronization across all tabs and clients
  React.useEffect(() => {
    const unsubscribe = websocketService.subscribe('LOANS_UPDATED', () => {
      // Another user (for example Audit) changed a loan: drop the 30 second cache so the reload is real
      loanService.invalidateCache()
      loadLoans()
    })
    return () => unsubscribe()
  }, [loadLoans])



  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node

      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(target)) {
        setIsCompanyDropdownOpen(false)
      }
      if (periodDropdownRef.current && !periodDropdownRef.current.contains(target)) {
        setIsPeriodDropdownOpen(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Status options tailored by user role
  const statusOptions = React.useMemo(() => {
    if (isAuditor) {
      return ['All', 'Pending Audit Approval', 'Approved', 'Paid', 'Partially Paid', 'Disapproved by Audit']
    }
    if (canApprove) {
      return ['All', 'Pending Finance Endorsement', 'Pending Audit Approval', 'Approved', 'Paid', 'Partially Paid', 'Rejected by Finance']
    }
    return ['All', 'Pending Finance Endorsement', 'Pending Audit Approval', 'Approved', 'Paid', 'Partially Paid']
  }, [isAuditor, canApprove])

  // Client-side filtering and sorting
  const filteredLoans = React.useMemo(() => {
    return loans
      .filter((item) => {
        // Exclude test seed items
        if (item.refNo?.startsWith('SEED-')) return false

        // Tab separation: Borrower vs Lender
        const currentTargetCompany = isCompanyScoped
          ? (assignedCompany || '').trim()
          : (selectedCompany || '').trim()

        if (currentTargetCompany && currentTargetCompany.toLowerCase() !== 'all companies') {
          if (loanType === 'Borrower') {
            if (!isCompanyMatch(item.borrower, currentTargetCompany)) return false
          } else {
            if (!isCompanyMatch(item.lender, currentTargetCompany)) return false
          }
        }

        // Auditors cannot view loan requests that are still pending finance endorsement
        if (
          isAuditor &&
          (item.status === 'Pending Finance Endorsement' ||
            item.status === 'Pending Approval' ||
            item.status === 'Rejected by Finance')
        ) {
          return false
        }

        if (!isDateInRange(item.rawDate || item.date, dateRange.startDate, dateRange.endDate)) {
          return false
        }

        // Approve / Pending segmented tab filter
        const statusLower = (item.status || '').trim().toLowerCase()
        const isPendingLoan =
          item.status === 'Pending Finance Endorsement' ||
          item.status === 'Pending Approval' ||
          item.status === 'Pending Audit Approval' ||
          statusLower.includes('pending')
        const isRejectedLoan =
          item.status === 'Rejected by Finance' ||
          item.status === 'Disapproved by Audit' ||
          statusLower.includes('rejected') ||
          statusLower.includes('disapproved')

        if (approvalTab === 'Pending') {
          if (!isPendingLoan) return false
        } else if (approvalTab === 'Approve') {
          if (isPendingLoan || isRejectedLoan) return false
        }

        if (statusFilter !== 'All') {
          const itemStatus = (item.status || '').trim().toLowerCase()
          const filterStatus = statusFilter.trim().toLowerCase()
          if (filterStatus === 'pending') {
            if (!itemStatus.includes('pending')) return false
          } else if (itemStatus !== filterStatus) {
            return false
          }
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim()
          const matchRef = (item.refNo || '').toLowerCase().includes(q)
          const matchCheque = (item.chequeNo || '').toLowerCase().includes(q)
          const matchParticulars = (item.particulars || '').toLowerCase().includes(q)
          const matchBorrower = (item.borrower || '').toLowerCase().includes(q)
          const matchLender = (item.lender || '').toLowerCase().includes(q)
          const matchStatus = (item.status || '').toLowerCase().includes(q)
          const matchAmount = String(item.amount || '').includes(q)

          if (
            !matchRef &&
            !matchCheque &&
            !matchParticulars &&
            !matchBorrower &&
            !matchLender &&
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
  }, [loans, isAuditor, assignedCompany, selectedCompany, loanType, dateRange, statusFilter, searchQuery, approvalTab])

  React.useEffect(() => {
    setCurrentPage(1)
  }, [dateRange, searchQuery, selectedCompany, selectedPeriod, loanType, statusFilter, approvalTab])

  // Total Loans KPI
  const kpis = React.useMemo(() => {
    const total = filteredLoans.reduce((sum, l) => sum + (l.amount || 0), 0)
    const pending = filteredLoans.filter(
      (l) =>
        l.status === 'Pending Approval' ||
        l.status === 'Pending Finance Endorsement' ||
        l.status === 'Pending Audit Approval'
    ).length
    const approved = filteredLoans.filter(
      (l) => l.status === 'Approved' || l.status === 'Paid' || l.status === 'Partially Paid'
    ).length
    return { totalLoans: total, pendingCount: pending, approvedCount: approved }
  }, [filteredLoans])

  // Pagination
  const totalPages = Math.ceil(filteredLoans.length / ITEMS_PER_PAGE) || 1
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredLoans.length)
  const paginatedLoans = filteredLoans.slice(startIndex, endIndex)

  // Export handlers
  const companyForExport = isAuditor ? assignedCompany : selectedCompany

  const handleExportCsv = () => {
    loanService.exportCsv(
      filteredLoans,
      loanType,
      `loan_${loanType.toLowerCase()}_${companyForExport.replace(/\s+/g, '_')}_${Date.now()}.csv`
    )
    setIsExportDropdownOpen(false)
  }

  const handleExportPdf = () => {
    loanService.exportPdf(filteredLoans, companyForExport, loanType)
    setIsExportDropdownOpen(false)
  }

  const handleLoanAdded = (newItem: LoanItem) => {
    setLoans((prev) => [newItem, ...prev])
    setSearchQuery('')
    const isNewPending =
      newItem.status === 'Pending Finance Endorsement' ||
      newItem.status === 'Pending Approval' ||
      newItem.status === 'Pending Audit Approval' ||
      (newItem.status || '').toLowerCase().includes('pending')
    setApprovalTab(isNewPending ? 'Pending' : 'Approve')

    const newDateIso = newItem.rawDate || normalizeDateToYYYYMMDD(newItem.date)
    if (!isDateInRange(newDateIso, dateRange.startDate, dateRange.endDate)) {
      setDateRange((prev: DateRange) => ({
        ...prev,
        startDate: prev.startDate && prev.startDate < newDateIso ? prev.startDate : newDateIso,
        endDate: prev.endDate && prev.endDate > newDateIso ? prev.endDate : newDateIso,
      }))
    }

    setCurrentPage(1)
    setHighlightedLoanId(newItem.id)

    setTimeout(() => {
      tableCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)

    setTimeout(() => {
      setHighlightedLoanId(null)
    }, 3500)
  }

  const handleLoanUpdated = (updatedItem: LoanItem) => {
    setLoans((prev) => prev.map((l) => (l.id === updatedItem.id ? updatedItem : l)))
    setHighlightedLoanId(updatedItem.id)
    setTimeout(() => {
      setHighlightedLoanId(null)
    }, 3000)
  }

  const handleLoanApproved = (approvedItem: LoanItem) => {
    setLoans((prev) => prev.map((l) => (l.id === approvedItem.id ? approvedItem : l)))
    setHighlightedLoanId(approvedItem.id)
    setTimeout(() => {
      setHighlightedLoanId(null)
    }, 3000)
  }

  const handleLoanPaid = (updatedLoan: LoanItem) => {
    setLoans((prev) => prev.map((l) => (l.id === updatedLoan.id ? updatedLoan : l)))
    setPaymentLoan(updatedLoan)
    setHighlightedLoanId(updatedLoan.id)
    setTimeout(() => {
      setHighlightedLoanId(null)
    }, 3000)
  }

  const handleRowClick = (loan: LoanItem) => {
    setViewLoanItem(loan)
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmLoan) return
    try {
      setIsDeleting(true)
      await loanService.deleteLoan(deleteConfirmLoan.id)
      setLoans((prev) => prev.filter((l) => l.id !== deleteConfirmLoan.id))
      setDeleteConfirmLoan(null)
    } catch (err: any) {
      alert(formatUserFriendlyErrorMessage(err, 'Failed to delete loan. Please try again.'))
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredCompanyList = React.useMemo(() => {
    if (!companySearch.trim()) return companyNamesList
    return companyNamesList.filter((c) =>
      c.toLowerCase().includes(companySearch.toLowerCase().trim())
    )
  }, [companySearch, companyNamesList])

  const displayedCompanyTitle = isCompanyScoped
    ? assignedCompany
    : selectedCompany === 'All Companies'
    ? 'All Subsidiaries'
    : selectedCompany

  if (isAdmin) {
    return (
      <>
        <AdminCompanyLoansView
          assignedCompany={assignedCompany}
          companyNamesList={companyNamesList}
          dbCompanies={dbCompanies}
          onRequestLoan={() => setIsAddModalOpen(true)}
        />

        {/* Add Loan Modal */}
        <AddLoanModal
          open={isAddModalOpen}
          onOpenChange={setIsAddModalOpen}
          onSuccess={handleLoanAdded}
          assignedCompany={assignedCompany}
          companies={companyNamesList}
        />
      </>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8 max-w-[1600px] mx-auto pb-12">
      {/* 1. Header & Controls */}
      <div className="space-y-4">
        {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
              {loanType} Loans
            </h1>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              {loanType === 'Borrower'
                ? 'Loans and facilities borrowed from partner companies.'
                : 'Loans and financing extended to partner companies.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start shrink-0">
            {/* Export Dropdown Button */}
            <div ref={exportDropdownRef} className="relative inline-block">
              <Button
                type="button"
                variant={isAudit ? 'default' : 'outline'}
                onClick={() => {
                  setIsExportDropdownOpen((prev) => !prev)
                  setIsPeriodDropdownOpen(false)
                  setIsStatusDropdownOpen(false)
                  setIsCompanyDropdownOpen(false)
                }}
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

            {/* Add Loan Button (Available for Borrower requests - hidden for Audit) */}
            {!isAudit && (
              <Button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>Request Loan</span>
              </Button>
            )}
          </div>
        </div>

        {/* Second Row: Search Bar & Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
            <Input
              type="search"
              placeholder="Search ref no, company, purpose…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {/* Period Dropdown */}
            <div ref={periodDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsPeriodDropdownOpen((prev) => !prev)
                  setIsStatusDropdownOpen(false)
                  setIsCompanyDropdownOpen(false)
                  setIsExportDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
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
                <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
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
            <div ref={statusDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsStatusDropdownOpen((prev) => !prev)
                  setIsPeriodDropdownOpen(false)
                  setIsCompanyDropdownOpen(false)
                  setIsExportDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus whitespace-nowrap shrink-0',
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
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  {statusOptions.map((st) => (
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

            {/* Unified Date Range Picker (presets hidden) */}
            <DateRangePicker
              value={dateRange}
              onChange={(newRange: DateRange) => setDateRange(newRange)}
              hidePresets
            />

            {/* Company Scope: Dropdown for Admin/Finance only */}
            {!isCompanyScoped && (
              <div ref={companyDropdownRef} className="relative inline-block shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsCompanyDropdownOpen((prev) => !prev)
                    setIsPeriodDropdownOpen(false)
                    setIsStatusDropdownOpen(false)
                    setIsExportDropdownOpen(false)
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                    isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                  )}
                >
                  <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
                  <span className="font-medium text-focus/90 truncate max-w-[140px] sm:max-w-[180px]">
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
                  <div className="absolute right-0 top-full mt-2 w-68 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
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

                    <div className="px-1 mb-2">
                      <Input
                        type="text"
                        placeholder="Search company…"
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                        className="h-8 text-xs rounded-lg"
                        autoFocus
                      />
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

            {/* Tab Switcher: Approve / Pending (Right Side, matching Deposit / Expense Record style) */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setApprovalTab('Approve')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  approvalTab === 'Approve'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Approve
              </button>
              <button
                type="button"
                onClick={() => setApprovalTab('Pending')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  approvalTab === 'Pending'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <Clock className="h-4 w-4 shrink-0" />
                Pending
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Total Loans KPI Card */}
      <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
        <div className="w-full max-w-[calc(100%-60px)]">
          <span className="text-xs font-medium text-muted-fg block">
            {loanType === 'Borrower' ? 'Total Borrowed Amount' : 'Total Lent Capital'}
          </span>
          <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 py-1 text-muted-fg" aria-label="Loading">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
              </span>
            ) : (
              formatPHP(kpis.totalLoans)
            )}
          </h3>
          <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
            {loanType === 'Borrower'
              ? `Active borrowed principal across partners for ${displayedCompanyTitle}`
              : `Financing capital provided to subsidiary partners by ${displayedCompanyTitle}`}
          </p>
        </div>

        <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
          <Landmark className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </Card>

      {/* 3. Diagram Section */}
      <div className="w-full">
        {loading ? (
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs">
            <div className="space-y-1.5 mb-4">
              <div className="h-5 w-44 bg-slate-200/80 animate-pulse rounded-md" />
              <div className="h-3.5 w-64 bg-slate-200/60 animate-pulse rounded-md" />
            </div>
            <div className="h-56 sm:h-64 w-full bg-slate-50/70 rounded-2xl flex flex-col items-center justify-center gap-3">
              <div className="w-20 h-20 rounded-full border-4 border-slate-200 border-t-primary animate-spin opacity-60" />
              <div className="h-3.5 w-40 bg-slate-200/70 animate-pulse rounded" />
            </div>
          </Card>
        ) : (
          <LoanHorizontalBarChart
            loans={filteredLoans}
            companyScope={selectedCompany}
            className="w-full"
          />
        )}
      </div>

      {/* 4. Summary Transactions Table Card */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Loan Table: table-fixed with explicit column percentages to eliminate horizontal scrolling */}
        <div className="w-full rounded-xl border border-slate-100 overflow-hidden">
          <Table className="w-full table-fixed">
            <colgroup>
              {loanType === 'Borrower' ? (
                <>
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '8%' }} />
                </>
              ) : (
                <>
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '8%' }} />
                </>
              )}
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  DATE
                </TableHead>
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  REF NO.
                </TableHead>
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  {loanType === 'Borrower' ? 'LENDER COMPANY' : 'BORROWER COMPANY'}
                </TableHead>
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  PARTICULARS
                </TableHead>
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  AMOUNT
                </TableHead>
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap">
                  DUE DATE
                </TableHead>
                {/* Interest Rate ONLY in Borrower Tab per user instructions */}
                {loanType === 'Borrower' && (
                  <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left whitespace-nowrap" title="Interest Rate">
                    INT. RATE
                  </TableHead>
                )}
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                  STATUS
                </TableHead>
                <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center whitespace-nowrap">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={idx} className="border-b border-slate-100">
                    <TableCell className="px-2 py-3.5">
                      <div className="h-4 w-14 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-2 py-3.5">
                      <div className="h-4 w-18 bg-slate-200/60 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-2 py-3.5">
                      <div className="h-4 w-22 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-2 py-3.5">
                      <div className="h-4 w-24 bg-slate-200/70 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-2 py-3.5">
                      <div className="h-4 w-16 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-2 py-3.5">
                      <div className="h-4 w-16 bg-slate-200/60 animate-pulse rounded" />
                    </TableCell>
                    {loanType === 'Borrower' && (
                      <TableCell className="px-2 py-3.5">
                        <div className="h-4 w-10 bg-slate-200/60 animate-pulse rounded" />
                      </TableCell>
                    )}
                    <TableCell className="px-2 py-3.5 text-center">
                      <div className="h-6 w-16 bg-slate-200/60 animate-pulse rounded-full mx-auto" />
                    </TableCell>
                    <TableCell className="px-2 py-3.5 text-center">
                      <div className="h-7 w-7 bg-slate-200/60 animate-pulse rounded-lg mx-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paginatedLoans.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={loanType === 'Borrower' ? 9 : 8}
                    className="py-14 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                        <AlertCircle className="w-6 h-6 stroke-[1.5]" />
                      </div>
                      <p className="font-semibold text-focus text-sm sm:text-base">
                        No loan transaction yet
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        There are no {loanType.toLowerCase()} loan records found for {displayedCompanyTitle} matching your current filters.
                        {loanType === 'Borrower' && ' Click "Request Loan" above to initiate a new borrowing request.'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedLoans.map((loan) => {
                  const isPendingFinance =
                    loan.status === 'Pending Finance Endorsement' || loan.status === 'Pending Approval'
                  const isPendingAudit = loan.status === 'Pending Audit Approval'
                  const isRejectedFinance = loan.status === 'Rejected by Finance'
                  const isDisapprovedAudit = loan.status === 'Disapproved by Audit'

                  return (
                    <TableRow
                      key={loan.id}
                      id={`loan-row-${loan.id}`}
                      onClick={() => handleRowClick(loan)}
                      className={cn(
                        'border-b transition-colors cursor-pointer',
                        isPendingFinance && 'bg-amber-50/70 hover:bg-amber-100/60 border-amber-200/50',
                        isPendingAudit && 'bg-indigo-50/60 hover:bg-indigo-100/50 border-indigo-200/50',
                        (isRejectedFinance || isDisapprovedAudit) &&
                          'bg-rose-50/50 hover:bg-rose-100/50 border-rose-200/50',
                        !isPendingFinance &&
                          !isPendingAudit &&
                          !isRejectedFinance &&
                          !isDisapprovedAudit &&
                          'border-slate-100 hover:bg-slate-50/80',
                        highlightedLoanId === loan.id &&
                          'bg-amber-100/90 ring-2 ring-amber-400 font-semibold'
                      )}
                      title="Click row to view loan details"
                    >
                      {/* 1. Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium text-focus whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <span>{loan.date}</span>
                            {highlightedLoanId === loan.id && (
                              <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-[#960C01] text-white animate-bounce">
                                NEW
                              </span>
                            )}
                          </div>
                          {loan.createdAt && (
                            <span className="text-[10px] text-muted-fg font-normal flex items-center gap-1" title={`Created at: ${formatCreatedAt(loan.createdAt)}`}>
                              <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="tabular-nums">{formatCreatedAt(loan.createdAt, { timeOnly: true })}</span>
                            </span>
                          )}
                          {loan.auditDate && (
                            <span className="text-[10px] text-muted-fg font-normal flex items-center gap-1" title={`Audited at: ${loan.auditDate}`}>
                              <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="truncate max-w-[120px]">{loan.auditDate}</span>
                            </span>
                          )}
                          {loan.auditStatus && loan.auditStatus !== 'Pending Audit' && (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold w-fit",
                              loan.auditStatus === 'Verified' ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80" : "bg-amber-50 text-amber-700 border border-amber-200/80"
                            )}>
                              {loan.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* 2. Ref No */}
                      <TableCell className="px-2 py-3 text-xs text-focus/90 font-mono truncate">
                        {loan.refNo}
                      </TableCell>

                      {/* 3. Partner Company (Lender if borrower view, Borrower if lender view) */}
                      <TableCell className="px-2 py-3 text-xs text-focus font-semibold">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Building2 className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                          <span className="truncate" title={loanType === 'Borrower' ? loan.lender : loan.borrower}>
                            {loanType === 'Borrower' ? loan.lender : loan.borrower}
                          </span>
                        </div>
                      </TableCell>

                      {/* 4. Particulars */}
                      <TableCell className="px-2 py-3 text-xs text-focus/90 font-normal">
                        <span className="truncate block" title={loan.particulars}>
                          {loan.particulars}
                        </span>
                      </TableCell>

                      {/* 5. Amount */}
                      <TableCell className="px-2 py-3 text-xs font-bold tabular-nums whitespace-nowrap text-focus">
                        <div>{formatPHP(loan.amount)}</div>
                        {loan.totalPaid !== undefined && loan.totalPaid > 0 && (
                          <div
                            className="text-[10px] font-semibold text-blue-600 mt-0.5 truncate"
                            title={`Paid: ${formatPHP(loan.totalPaid)} | Remaining: ${formatPHP(
                              loan.outstandingBalance ?? Math.max(0, loan.amount - loan.totalPaid)
                            )}`}
                          >
                            Bal: {formatPHP(loan.outstandingBalance ?? Math.max(0, loan.amount - loan.totalPaid))}
                          </div>
                        )}
                      </TableCell>

                      {/* 6. Due Date */}
                      <TableCell className="px-2 py-3 text-xs text-focus/80 whitespace-nowrap">
                        {loan.dueDate || '—'}
                      </TableCell>

                      {/* 7. Interest Rate (Borrower tab only) */}
                      {loanType === 'Borrower' && (
                        <TableCell className="px-2 py-3 text-xs text-focus/90 whitespace-nowrap font-medium">
                          {loan.interestRate !== undefined ? `${loan.interestRate}%` : '0%'}
                        </TableCell>
                      )}

                      {/* 8. Status */}
                      <TableCell className="px-2 py-3 text-center whitespace-nowrap">
                        {isPendingFinance ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 text-[11px] font-semibold shadow-2xs">
                            <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Pending Finance</span>
                          </span>
                        ) : isPendingAudit ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 text-[11px] font-semibold shadow-2xs">
                            <Clock className="w-3 h-3 text-indigo-600 shrink-0" />
                            <span>Pending Audit</span>
                          </span>
                        ) : isRejectedFinance ? (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200/80 text-[11px] font-semibold shadow-2xs"
                            title={loan.financeRemark || 'Rejected by finance'}
                          >
                            <X className="w-3 h-3 text-rose-600 shrink-0" />
                            <span>Rejected</span>
                          </span>
                        ) : isDisapprovedAudit ? (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200/80 text-[11px] font-semibold shadow-2xs"
                            title={loan.auditRemark || 'Disapproved by audit'}
                          >
                            <X className="w-3 h-3 text-rose-600 shrink-0" />
                            <span>Disapproved</span>
                          </span>
                        ) : loan.status === 'Paid' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-semibold shadow-2xs">
                            <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>Paid</span>
                          </span>
                        ) : loan.status === 'Partially Paid' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80 text-[11px] font-semibold shadow-2xs">
                            <Clock className="w-3 h-3 text-blue-600 shrink-0" />
                            <span>Partially Paid</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-semibold shadow-2xs">
                            <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>Approved</span>
                          </span>
                        )}
                      </TableCell>

                      {/* 9. Actions (3 Dots Menu) */}
                      <TableCell className="px-2 py-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (openMenuLoanId === loan.id) {
                                setOpenMenuLoanId(null)
                                setMenuPosition(null)
                                setActiveMenuLoan(null)
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 140 > window.innerHeight
                                setMenuPosition({
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                                setActiveMenuLoan(loan)
                                setOpenMenuLoanId(loan.id)
                              }
                            }}
                            className="loan-action-btn h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center"
                            title="Actions"
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

        {/* Pagination Footer */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          <span className="font-medium text-focus/80">
            {filteredLoans.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredLoans.length} records`}
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
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              className="h-8 px-2.5 rounded-lg cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              className="h-8 px-2.5 rounded-lg cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Add Loan Modal */}
      <AddLoanModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onSuccess={handleLoanAdded}
        assignedCompany={assignedCompany}
        companies={companyNamesList}
      />

      {/* Edit Loan Modal */}
      <EditLoanModal
        open={Boolean(editLoan)}
        onOpenChange={(open) => !open && setEditLoan(null)}
        loan={editLoan}
        onSuccess={handleLoanUpdated}
        companies={companyNamesList}
      />

      {/* Approve Loan Modal */}
      <ApproveLoanModal
        open={Boolean(approveLoanItem)}
        onOpenChange={(open) => !open && setApproveLoanItem(null)}
        loan={approveLoanItem}
        onSuccess={handleLoanApproved}
        companies={companyNamesList}
      />

      {/* Audit Review Loan Modal */}
      <AuditReviewLoanModal
        open={Boolean(auditReviewLoanItem)}
        onOpenChange={(open) => !open && setAuditReviewLoanItem(null)}
        loan={auditReviewLoanItem}
        onSuccess={handleLoanApproved}
      />

      {/* Delete Confirmation Modal */}
      <Dialog
        open={Boolean(deleteConfirmLoan)}
        onOpenChange={(open) => !open && setDeleteConfirmLoan(null)}
      >
        <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left pb-2 pr-6">
            <DialogTitle className="text-lg font-bold text-focus leading-tight">
              Delete Loan Request
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg font-normal">
              Are you sure you want to delete this pending loan request? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteConfirmLoan && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 my-2">
              <div className="flex justify-between">
                <span className="text-muted-fg">Ref No:</span>
                <span className="font-mono font-medium text-focus">{deleteConfirmLoan.refNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Borrower:</span>
                <span className="font-medium text-focus">{deleteConfirmLoan.borrower}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Lender:</span>
                <span className="font-medium text-focus">{deleteConfirmLoan.lender}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-fg">Amount:</span>
                <span className="font-bold text-red-600">{formatPHP(deleteConfirmLoan.amount)}</span>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmLoan(null)}
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

      {/* Record / Update Payment Modal */}
      <RecordPaymentModal
        open={isPaymentModalOpen}
        onOpenChange={(open) => {
          setIsPaymentModalOpen(open)
          if (!open) setPaymentLoan(null)
        }}
        loan={paymentLoan}
        onLoanPaid={handleLoanPaid}
      />

      {/* View Loan Details Modal (Read-only until clicking Edit) */}
      <Dialog
        open={Boolean(viewLoanItem)}
        onOpenChange={(open) => !open && setViewLoanItem(null)}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
                <FileText className="w-4 h-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-focus leading-tight">
                  Loan Details
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg font-normal mt-0.5">
                  Complete read-only loan record for {viewLoanItem?.refNo || 'this facility'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {viewLoanItem && (
            <div className="space-y-4 pt-2">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-medium text-muted-fg block">
                    Principal Amount
                  </span>
                  <span className="text-lg font-bold text-focus tabular-nums">
                    {formatPHP(viewLoanItem.amount)}
                  </span>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white border border-stroke/40 text-focus shadow-2xs">
                  {viewLoanItem.status}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg">Reference No:</span>
                  <span className="font-mono font-semibold text-focus">{viewLoanItem.refNo}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg">Date:</span>
                  <span className="font-semibold text-focus">{viewLoanItem.date}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg">Borrower Company:</span>
                  <span className="font-semibold text-focus">{viewLoanItem.borrower}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg">Lender Company:</span>
                  <span className="font-semibold text-focus">{viewLoanItem.lender}</span>
                </div>
                <div className="flex items-start justify-between gap-4 py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg shrink-0">Particulars / Purpose:</span>
                  <span className="font-medium text-focus text-right">{viewLoanItem.particulars}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg">Due Date:</span>
                  <span className="font-semibold text-focus">{viewLoanItem.dueDate || '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                  <span className="text-muted-fg">Interest Rate:</span>
                  <span className="font-semibold text-focus">
                    {viewLoanItem.interestRate !== undefined ? `${viewLoanItem.interestRate}%` : '0%'}
                  </span>
                </div>
                {viewLoanItem.totalPaid !== undefined && viewLoanItem.totalPaid > 0 && (
                  <>
                    <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                      <span className="text-muted-fg">Total Paid:</span>
                      <span className="font-bold text-emerald-600 tabular-nums">
                        {formatPHP(viewLoanItem.totalPaid)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 border-b border-stroke/10">
                      <span className="text-muted-fg">Remaining Balance:</span>
                      <span className="font-bold text-blue-600 tabular-nums">
                        {formatPHP(
                          viewLoanItem.outstandingBalance ??
                            Math.max(0, viewLoanItem.amount - viewLoanItem.totalPaid)
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-stroke/20 flex items-center justify-end gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setViewLoanItem(null)}
                  className="h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Close
                </Button>

                {!isAuditor &&
                  canApprove &&
                  (viewLoanItem.status === 'Pending Finance Endorsement' ||
                    viewLoanItem.status === 'Pending Approval') && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const target = viewLoanItem
                        setViewLoanItem(null)
                        setApproveLoanItem(target)
                      }}
                      className="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Endorse</span>
                    </Button>
                  )}

                {!isAuditor &&
                  loanType === 'Borrower' &&
                  (viewLoanItem.status === 'Approved' || viewLoanItem.status === 'Partially Paid') && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const target = viewLoanItem
                        setViewLoanItem(null)
                        setPaymentLoan(target)
                        setIsPaymentModalOpen(true)
                      }}
                      className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <HandCoins className="w-3.5 h-3.5" />
                      <span>Pay / Update</span>
                    </Button>
                  )}

                {!isAuditor && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const target = viewLoanItem
                      setViewLoanItem(null)
                      setEditLoan(target)
                    }}
                    className="h-9 px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Floating 3-Dots Action Portal Menu */}
      {openMenuLoanId && menuPosition && activeMenuLoan && typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            className="loan-portal-menu fixed z-[99999] w-48 rounded-xl bg-white border border-slate-200 shadow-2xl p-1.5 animate-in fade-in-50 zoom-in-95 duration-150"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {isAuditor ? (
              <>
                <button
                  type="button"
                  onClick={() => handleMarkLoanAudit(activeMenuLoan, 'Verified')}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Mark as Audit</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMarkLoanAudit(activeMenuLoan, 'Flagged')}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors text-left cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Mark as Discrepancy</span>
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    const target = activeMenuLoan
                    setOpenMenuLoanId(null)
                    setMenuPosition(null)
                    setActiveMenuLoan(null)
                    if (target.status === 'Pending Audit Approval') {
                      setAuditReviewLoanItem(target)
                    } else {
                      setViewLoanItem(target)
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  <span>View</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const target = activeMenuLoan
                    setOpenMenuLoanId(null)
                    setMenuPosition(null)
                    setActiveMenuLoan(null)
                    setEditLoan(target)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-fg" />
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const target = activeMenuLoan
                    setOpenMenuLoanId(null)
                    setMenuPosition(null)
                    setActiveMenuLoan(null)
                    setDeleteConfirmLoan(target)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Delete</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const target = activeMenuLoan
                    setOpenMenuLoanId(null)
                    setMenuPosition(null)
                    setActiveMenuLoan(null)
                    setViewLoanItem(target)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-muted-fg" />
                  <span>View</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
