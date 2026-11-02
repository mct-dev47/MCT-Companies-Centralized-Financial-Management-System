import * as React from 'react'
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
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  CheckCircle2,
  CreditCard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  CompanyLoanDetailsModal,
  type RepaymentTimelineItem,
} from '@/components/dashboard/CompanyLoanDetailsModal'
import {
  loanService,
  type CompanyLoanGroup,
  type CompanyOption,
} from '@/services/loanService'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD, isDateInRange } from '@/utils/dateUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'

const LOAN_CATEGORIES = [
  'All',
  'Rent',
  'Electricity',
  'Water Bill',
  'Internet',
  'Operating Supplies',
] as const

const LOAN_CATEGORY_COLORS: Record<string, string> = {
  Rent: '#3B82F6', // Blue
  Electricity: '#F59E0B', // Amber
  'Water Bill': '#06B6D4', // Cyan
  Internet: '#8B5CF6', // Purple
  'Operating Supplies': '#10B981', // Emerald
}

const LOAN_STATUS_OPTIONS = [
  'All',
  'Unpaid',
  'Partially Paid',
  'Fully Paid',
  'Overdue',
] as const

const PERIOD_OPTIONS = ['All Periods', 'Daily', 'Monthly', 'Quarterly', 'Annually'] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

const ITEMS_PER_PAGE = 10


interface AdminCompanyLoansViewProps {
  assignedCompany: string
  companyNamesList: string[]
  dbCompanies: CompanyOption[]
  onRequestLoan: () => void
}

export const AdminCompanyLoansView: React.FC<AdminCompanyLoansViewProps> = ({
  companyNamesList,
  dbCompanies,
  onRequestLoan,
}) => {
  const { user } = useSession()
  const isAudit = (user?.role || '').toLowerCase().includes('audit')
  const [groups, setGroups] = React.useState<CompanyLoanGroup[]>([])
  const [loading, setLoading] = React.useState(true)

  // Filters
  const [selectedCompany, setSelectedCompany] = React.useState<string>('All Companies')
  const [selectedCategory, setSelectedCategory] = React.useState<string>('All')
  const [selectedPaymentStatus, setSelectedPaymentStatus] = React.useState<string>('All')
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodOption>('All Periods')
  const [dateRange, setDateRange] = React.useState<{
    startDate: string | null
    endDate: string | null
    label: string
  }>({
    startDate: null,
    endDate: null,
    label: 'All Periods',
  })
  const [searchQuery, setSearchQuery] = React.useState('')
  const [currentPage, setCurrentPage] = React.useState(1)

  // Dropdown states
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false)
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = React.useState(false)
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [companySearch, setCompanySearch] = React.useState('')

  // Refs
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)
  const periodDropdownRef = React.useRef<HTMLDivElement>(null)
  const categoryDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  // Details Modal
  const [selectedGroup, setSelectedGroup] = React.useState<CompanyLoanGroup | null>(null)
  const [timeline, setTimeline] = React.useState<RepaymentTimelineItem[]>([])
  const [loadingTimeline, setLoadingTimeline] = React.useState(false)

  // Load Company Loans from API or fallback to dummy
  const loadCompanyLoans = React.useCallback(async () => {
    setLoading(true)
    try {
      const matchedCompany = dbCompanies.find((c) =>
        isCompanyMatch(c.company_name, selectedCompany)
      )
      const res = await loanService.getCompanyLoans({
        borrowerId: matchedCompany ? matchedCompany.company_id : undefined,
        category: selectedCategory === 'All' ? undefined : selectedCategory,
        paymentStatus: selectedPaymentStatus === 'All' ? undefined : selectedPaymentStatus,
        startDate: dateRange.startDate || undefined,
        endDate: dateRange.endDate || undefined,
      })
      if (res.items && res.items.length > 0) {
        setGroups(res.items)
      } else {
        setGroups([])
      }
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [dbCompanies, selectedCompany, selectedCategory, selectedPaymentStatus, dateRange])

  React.useEffect(() => {
    void loadCompanyLoans()
  }, [loadCompanyLoans])

  // Close dropdowns on outside click
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
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(target)) {
        setIsCategoryDropdownOpen(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Period change handler
  const handlePeriodChange = (period: PeriodOption) => {
    setSelectedPeriod(period)
    setIsPeriodDropdownOpen(false)
    setCurrentPage(1)
    const currentToday = formatToYYYYMMDD(new Date())
    const [currYear, currMonth] = currentToday.split('-')

    switch (period) {
      case 'All Periods':
        setDateRange({ startDate: null, endDate: null, label: 'All Periods' })
        break
      case 'Daily':
        setDateRange({ startDate: currentToday, endDate: currentToday, label: 'Today' })
        break
      case 'Monthly': {
        const lastDay = new Date(parseInt(currYear, 10), parseInt(currMonth, 10), 0).getDate()
        setDateRange({
          startDate: `${currYear}-${currMonth}-01`,
          endDate: `${currYear}-${currMonth}-${String(lastDay).padStart(2, '0')}`,
          label: 'This Month',
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
          startDate: `${currYear}-${qStartMonth}-01`,
          endDate: `${currYear}-${qEndMonth}-${qEndDay}`,
          label: `This Quarter (${qLabel})`,
        })
        break
      }
      case 'Annually':
        setDateRange({
          startDate: `${currYear}-01-01`,
          endDate: `${currYear}-12-31`,
          label: 'This Year',
        })
        break
    }
  }

  // Open Details Modal & fetch repayment timeline
  const openGroupDetails = async (group: CompanyLoanGroup) => {
    setSelectedGroup(group)
    setTimeline([])
    setLoadingTimeline(true)

    const demoTimelines: Record<string, RepaymentTimelineItem[]> = {
      'mct-hotel-mct-kitchen-rent': [
        {
          refNo: 'LN-2026-001',
          paymentDate: '2026-08-15',
          amount: 5000,
          remainingBalance: 25000,
          reference: 'Bank Transfer - BDO #8841',
        },
        {
          refNo: 'LN-2026-001',
          paymentDate: '2026-09-15',
          amount: 5000,
          remainingBalance: 20000,
          reference: 'Bank Transfer - BDO #9102',
        },
        {
          refNo: 'LN-2026-002',
          paymentDate: '2026-09-28',
          amount: 3000,
          remainingBalance: 12000,
          reference: 'Check #10042',
        },
      ],
      'jk-cafe-mct-kitchen-electricity': [
        {
          refNo: 'LN-2026-003',
          paymentDate: '2026-08-15',
          amount: 14250,
          remainingBalance: 14250,
          reference: 'Direct Deposit #5512',
        },
        {
          refNo: 'LN-2026-003',
          paymentDate: '2026-09-15',
          amount: 14250,
          remainingBalance: 0,
          reference: 'Direct Deposit #6629 (Final Settlement)',
        },
      ],
      'annex-nine-jk-printing-supplies': [
        {
          refNo: 'LN-2026-004',
          paymentDate: '2026-09-01',
          amount: 10000,
          remainingBalance: 30000,
          reference: 'Check #8831',
        },
        {
          refNo: 'LN-2026-005',
          paymentDate: '2026-09-20',
          amount: 5000,
          remainingBalance: 17000,
          reference: 'Online Banking Reference #TRX-994',
        },
      ],
      'speedbox-merillon-internet': [],
      'southern-brew-mct-kitchen-water': [],
    }

    try {
      if (group.loans && group.loans.length > 0) {
        const statements = await Promise.all(
          group.loans.map(async (loan) => {
            if (loan.loanId && loan.loanId > 0) {
              try {
                const stmt = await loanService.getCompanyLoanStatement(loan.loanId)
                return { loan, statement: stmt }
              } catch {
                return { loan, statement: { repayments: [] } }
              }
            }
            return { loan, statement: { repayments: [] } }
          })
        )

        const flatTimeline: RepaymentTimelineItem[] = statements
          .flatMap(({ loan, statement }) =>
            (statement.repayments || []).map((repayment: any) => ({
              refNo: loan.refNo,
              paymentDate: repayment.payment_date,
              amount: Number(repayment.amount || 0),
              remainingBalance: Number(repayment.remaining_balance || 0),
              reference: repayment.reference_no || repayment.notes || '—',
            }))
          )
          .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))

        if (flatTimeline.length > 0) {
          setTimeline(flatTimeline)
        } else if (demoTimelines[group.key]) {
          setTimeline(demoTimelines[group.key])
        } else {
          setTimeline([])
        }
      } else if (demoTimelines[group.key]) {
        setTimeline(demoTimelines[group.key])
      } else {
        setTimeline([])
      }
    } catch {
      if (demoTimelines[group.key]) {
        setTimeline(demoTimelines[group.key])
      } else {
        setTimeline([])
      }
    } finally {
      setLoadingTimeline(false)
    }
  }

  // Exports
  const handleExportCsv = async () => {
    setIsExportDropdownOpen(false)
    try {
      const matchedCompany = dbCompanies.find((c) =>
        isCompanyMatch(c.company_name, selectedCompany)
      )
      await loanService.exportCompanyLoans({
        borrowerId: matchedCompany ? matchedCompany.company_id : undefined,
        category: selectedCategory === 'All' ? undefined : selectedCategory,
        paymentStatus: selectedPaymentStatus === 'All' ? undefined : selectedPaymentStatus,
        startDate: dateRange.startDate || undefined,
        endDate: dateRange.endDate || undefined,
      })
    } catch {
      // Fallback CSV export using current groups
      const headers = [
        'Borrower Company',
        'Lender Company',
        'Category',
        'Total Loan Amount',
        'Total Paid',
        'Outstanding Balance',
        'Interest Rate',
        'Status',
      ]
      const rows = filteredGroups.map((g) => [
        `"${g.borrower}"`,
        `"${g.lender}"`,
        `"${g.category}"`,
        g.totalLoanAmount,
        g.totalPaid,
        g.outstandingBalance,
        `"${g.interestDisplay}"`,
        `"${g.paymentStatus}"`,
      ])
      const csvContent =
        'data:text/csv;charset=utf-8,' +
        [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
      const encodedUri = encodeURI(csvContent)
      const link = document.createElement('a')
      link.setAttribute('href', encodedUri)
      link.setAttribute('download', `company_loans_${formatToYYYYMMDD(new Date())}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const handleExportPdf = () => {
    setIsExportDropdownOpen(false)
    window.print()
  }


  // Filter company list for dropdown search
  const filteredCompanyList = React.useMemo(() => {
    if (!companySearch.trim()) return companyNamesList
    return companyNamesList.filter((c) =>
      c.toLowerCase().includes(companySearch.toLowerCase().trim())
    )
  }, [companySearch, companyNamesList])

  // Filtered Groups
  const filteredGroups = React.useMemo(() => {
    return groups.filter((group) => {
      // Company filter
      if (selectedCompany !== 'All Companies') {
        const target = selectedCompany.toLowerCase().trim()
        const matchBorrower = group.borrower.toLowerCase().includes(target)
        const matchLender = group.lender.toLowerCase().includes(target)
        if (!matchBorrower && !matchLender) return false
      }

      // Category filter
      if (selectedCategory !== 'All') {
        if (group.category.toLowerCase() !== selectedCategory.toLowerCase()) {
          return false
        }
      }

      // Payment Status filter
      if (selectedPaymentStatus !== 'All') {
        if (group.paymentStatus.toLowerCase() !== selectedPaymentStatus.toLowerCase()) {
          return false
        }
      }

      // Date range filter
      if (dateRange.startDate && dateRange.endDate && group.loans && group.loans.length > 0) {
        const hasLoanInRange = group.loans.some((l) =>
          isDateInRange(l.rawDate || l.date, dateRange.startDate, dateRange.endDate)
        )
        if (!hasLoanInRange) return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchBorrower = group.borrower.toLowerCase().includes(q)
        const matchLender = group.lender.toLowerCase().includes(q)
        const matchCat = group.category.toLowerCase().includes(q)
        const matchStatus = group.paymentStatus.toLowerCase().includes(q)
        const matchLoans = group.loans?.some(
          (l) =>
            (l.refNo || '').toLowerCase().includes(q) ||
            (l.particulars || '').toLowerCase().includes(q)
        )
        if (!matchBorrower && !matchLender && !matchCat && !matchStatus && !matchLoans) {
          return false
        }
      }

      return true
    })
  }, [
    groups,
    selectedCompany,
    selectedCategory,
    selectedPaymentStatus,
    dateRange,
    searchQuery,
  ])

  // KPI Calculations
  const kpis = React.useMemo(() => {
    const totalLoans = filteredGroups.reduce((acc, g) => acc + (g.totalLoanAmount || 0), 0)
    const totalPaid = filteredGroups.reduce((acc, g) => acc + (g.totalPaid || 0), 0)
    const totalOutstanding = filteredGroups.reduce(
      (acc, g) => acc + (g.outstandingBalance || 0),
      0
    )
    return { totalLoans, totalPaid, totalOutstanding }
  }, [filteredGroups])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / ITEMS_PER_PAGE))
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredGroups.length)
  const paginatedGroups = React.useMemo(() => {
    return filteredGroups.slice(startIndex, endIndex)
  }, [filteredGroups, startIndex, endIndex])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Fully Paid':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
          label: 'Fully Paid',
        }
      case 'Partially Paid':
        return {
          bg: 'bg-blue-50 text-blue-700 border-blue-200/80',
          label: 'Partially Paid',
        }
      case 'Overdue':
        return {
          bg: 'bg-red-50 text-red-700 border-red-200/80',
          label: 'Overdue',
        }
      case 'Unpaid':
      default:
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200/80',
          label: status || 'Unpaid',
        }
    }
  }

  return (
    <div className="space-y-6 sm:space-y-8 max-w-[1600px] mx-auto pb-12">
      {/* 1. Header & Controls */}
      <div className="space-y-3">
        {/* Top Row: Action Buttons (Preview Dummy, Export & Add Loan) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 ml-auto">
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

            {/* Request Loan Button */}
            <Button
              type="button"
              onClick={onRequestLoan}
              className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>Record Loan</span>
            </Button>
          </div>
        </div>

        {/* Second Row: Page Title on Left, Filter Toolbar on Right */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
              Company Loans
            </h1>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Approved inter-company loans and facilities across subsidiaries.
            </p>
          </div>

          {/* Filter Toolbar - Compact single line matching system style */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap shrink-0 self-start lg:self-auto">
            {/* 1. Period Dropdown */}
            <div ref={periodDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsPeriodDropdownOpen((prev) => !prev)
                  setIsCompanyDropdownOpen(false)
                  setIsCategoryDropdownOpen(false)
                  setIsStatusDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                  isPeriodDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <Calendar className="h-3.5 w-3.5 text-muted-fg shrink-0" />
                <span className="font-medium text-focus/90">{selectedPeriod}</span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 text-muted-fg shrink-0 transition-transform duration-200',
                    isPeriodDropdownOpen && 'transform rotate-180'
                  )}
                />
              </button>

              {isPeriodDropdownOpen && (
                <div className="absolute left-0 top-full mt-2 w-40 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
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

            {/* 2. Company Scope Dropdown */}
            <div ref={companyDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsCompanyDropdownOpen((prev) => !prev)
                  setIsPeriodDropdownOpen(false)
                  setIsCategoryDropdownOpen(false)
                  setIsStatusDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                  isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <Building2 className="h-3.5 w-3.5 text-muted-fg shrink-0" />
                <span className="font-medium text-focus/90 truncate max-w-[120px] sm:max-w-[140px]">
                  {selectedCompany}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-fg shrink-0" />
                {selectedCompany !== 'All Companies' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedCompany('All Companies')
                      setCurrentPage(1)
                    }}
                    className="p-0.5 rounded-full hover:bg-slate-200 text-muted-fg hover:text-focus transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
                    title="Reset to All Companies"
                  >
                    <X className="h-2.5 w-2.5" />
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
                          setIsCompanyDropdownOpen(false)
                          setCurrentPage(1)
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
                      autoFocus
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
                            setIsCompanyDropdownOpen(false)
                            setCompanySearch('')
                            setCurrentPage(1)
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

            {/* 3. Category Dropdown */}
            <div ref={categoryDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsCategoryDropdownOpen((prev) => !prev)
                  setIsPeriodDropdownOpen(false)
                  setIsCompanyDropdownOpen(false)
                  setIsStatusDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                  isCategoryDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <CreditCard className="h-3.5 w-3.5 text-muted-fg shrink-0" />
                <span className="font-medium text-focus/90">
                  {selectedCategory === 'All' ? 'Category' : selectedCategory}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 text-muted-fg shrink-0 transition-transform duration-200',
                    isCategoryDropdownOpen && 'transform rotate-180'
                  )}
                />
                {selectedCategory !== 'All' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedCategory('All')
                      setCurrentPage(1)
                    }}
                    className="p-0.5 rounded-full hover:bg-slate-200 text-muted-fg hover:text-focus transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
                    title="Reset Category"
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>

              {isCategoryDropdownOpen && (
                <div className="absolute left-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stroke/20 px-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                      Category
                    </span>
                    {selectedCategory !== 'All' && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategory('All')
                          setIsCategoryDropdownOpen(false)
                          setCurrentPage(1)
                        }}
                        className="text-2xs text-primary hover:underline font-semibold cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {LOAN_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(cat)
                        setIsCategoryDropdownOpen(false)
                        setCurrentPage(1)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        selectedCategory === cat
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {cat !== 'All' && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: LOAN_CATEGORY_COLORS[cat] || '#64748B',
                            }}
                          />
                        )}
                        <span>{cat === 'All' ? 'All Categories' : cat}</span>
                      </div>
                      {selectedCategory === cat && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Payment Status Dropdown */}
            <div ref={statusDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsStatusDropdownOpen((prev) => !prev)
                  setIsPeriodDropdownOpen(false)
                  setIsCompanyDropdownOpen(false)
                  setIsCategoryDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                  isStatusDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium text-focus/90">
                  {selectedPaymentStatus === 'All' ? 'Status' : selectedPaymentStatus}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 text-muted-fg shrink-0 transition-transform duration-200',
                    isStatusDropdownOpen && 'transform rotate-180'
                  )}
                />
                {selectedPaymentStatus !== 'All' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedPaymentStatus('All')
                      setCurrentPage(1)
                    }}
                    className="p-0.5 rounded-full hover:bg-slate-200 text-muted-fg hover:text-focus transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
                    title="Reset Status"
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>

              {isStatusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-stroke/20 px-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                      Payment Status
                    </span>
                    {selectedPaymentStatus !== 'All' && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPaymentStatus('All')
                          setIsStatusDropdownOpen(false)
                          setCurrentPage(1)
                        }}
                        className="text-2xs text-primary hover:underline font-semibold cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {LOAN_STATUS_OPTIONS.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setSelectedPaymentStatus(st)
                        setIsStatusDropdownOpen(false)
                        setCurrentPage(1)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        selectedPaymentStatus === st
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{st === 'All' ? 'All Status' : st}</span>
                      {selectedPaymentStatus === st && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>



      {/* 2. KPI Cards: Total Loan Capital, Total Paid, Outstanding Balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
        {/* Total Loan Amount */}
        <Card className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total Loan Capital
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
              {formatPHP(kpis.totalLoans)}
            </h3>
            <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
              Total inter-company financing across facilities
            </p>
          </div>
          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
            <Landmark className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* Total Paid */}
        <Card className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total Principal Settled
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-emerald-600 mt-1 tabular-nums tracking-tight">
              {formatPHP(kpis.totalPaid)}
            </h3>
            <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
              Total loan repayment installments received
            </p>
          </div>
          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-600 shrink-0 shadow-2xs">
            <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* Outstanding Balance */}
        <Card className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Outstanding Balance
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-amber-600 mt-1 tabular-nums tracking-tight">
              {formatPHP(kpis.totalOutstanding)}
            </h3>
            <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
              Pending repayment balance across borrower companies
            </p>
          </div>
          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-600 shrink-0 shadow-2xs">
            <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>
      </div>

      {/* 3. Company Loans Summary Table Card (Matching Monthly Sales table design) */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Table Search Bar Toolbar */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-100/80 border border-slate-200/60 mb-5 flex items-center justify-between gap-4">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-muted-fg absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search by company, category, status…"
              className="w-full h-10 pl-9 pr-8 rounded-full border border-stroke/60 bg-white text-xs sm:text-sm text-focus placeholder:text-muted-fg/70 shadow-xs box-border focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5 rounded-full cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Table matching the Sales table design with equal spacing & fixed columns */}
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[1000px]">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                <TableHead className="w-[16%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  BORROWER COMPANY
                </TableHead>
                <TableHead className="w-[16%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  LENDER COMPANY
                </TableHead>
                <TableHead className="w-[13%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CATEGORY
                </TableHead>
                <TableHead className="w-[14%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TOTAL LOAN AMOUNT
                </TableHead>
                <TableHead className="w-[12%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TOTAL PAID
                </TableHead>
                <TableHead className="w-[13%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  OUTSTANDING BALANCE
                </TableHead>
                <TableHead className="w-[7%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  INT. RATE
                </TableHead>
                <TableHead className="w-[9%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  STATUS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={idx} className="border-b border-slate-100">
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-28 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-28 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-20 bg-slate-200/60 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-24 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-20 bg-slate-200/70 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-24 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4">
                      <div className="h-4 w-12 bg-slate-200/60 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3.5 py-4 text-center">
                      <div className="h-5 w-16 bg-slate-200/60 animate-pulse rounded-full mx-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paginatedGroups.length === 0 ? (
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
                        No company loans found
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        There are no inter-company loans matching your active filters. Try adjusting your search or clearing the filters above.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedGroups.map((group) => {
                  const statusBadge = getStatusBadge(group.paymentStatus)

                  return (
                    <TableRow
                      key={group.key}
                      onClick={() => openGroupDetails(group)}
                      className="border-b border-slate-100 hover:bg-slate-50/70 transition-all duration-200 cursor-pointer"
                      title="Click to view company loan details and repayment timeline"
                    >
                      {/* Borrower */}
                      <TableCell className="w-[16%] px-3.5 py-3.5 text-xs font-semibold text-focus truncate text-left">
                        <div className="flex items-center gap-2 truncate">
                          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate" title={group.borrower}>
                            {group.borrower}
                          </span>
                        </div>
                      </TableCell>

                      {/* Lender */}
                      <TableCell className="w-[16%] px-3.5 py-3.5 text-xs font-medium text-focus/90 truncate text-left">
                        <div className="flex items-center gap-2 truncate">
                          <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="truncate" title={group.lender}>
                            {group.lender}
                          </span>
                        </div>
                      </TableCell>

                      {/* Category */}
                      <TableCell className="w-[13%] px-3.5 py-3.5 text-xs text-focus/90 font-medium truncate text-left">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/60">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                LOAN_CATEGORY_COLORS[group.category] || '#64748B',
                            }}
                          />
                          <span className="truncate">{group.category}</span>
                        </div>
                      </TableCell>

                      {/* Total Loan Amount */}
                      <TableCell className="w-[14%] px-3.5 py-3.5 text-xs font-bold text-left tabular-nums whitespace-nowrap text-focus">
                        {formatPHP(group.totalLoanAmount)}
                      </TableCell>

                      {/* Total Paid */}
                      <TableCell className="w-[12%] px-3.5 py-3.5 text-xs font-semibold text-left tabular-nums whitespace-nowrap text-emerald-600">
                        {formatPHP(group.totalPaid)}
                      </TableCell>

                      {/* Outstanding Balance */}
                      <TableCell className="w-[13%] px-3.5 py-3.5 text-xs font-semibold text-left tabular-nums whitespace-nowrap text-amber-700">
                        {formatPHP(group.outstandingBalance)}
                      </TableCell>

                      {/* Interest Rate */}
                      <TableCell className="w-[7%] px-3.5 py-3.5 text-xs text-focus/90 font-medium text-left whitespace-nowrap">
                        {group.interestDisplay || '0.00%'}
                      </TableCell>

                      {/* Status */}
                      <TableCell className="w-[9%] px-3.5 py-3.5 text-center whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border shadow-2xs',
                            statusBadge.bg
                          )}
                        >
                          {group.paymentStatus}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer (Matching Monthly Sales Table design) */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          {/* Left: Record summary */}
          <span className="font-medium text-focus/80">
            {filteredGroups.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredGroups.length} records`}
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

      {/* Company Loan Details Modal */}
      <CompanyLoanDetailsModal
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => !open && setSelectedGroup(null)}
        group={selectedGroup}
        timeline={timeline}
        loadingTimeline={loadingTimeline}
      />
    </div>
  )
}
