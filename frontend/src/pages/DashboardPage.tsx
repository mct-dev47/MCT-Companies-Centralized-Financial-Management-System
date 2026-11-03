import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingDown,
  TrendingUp,
  Landmark,
  AlertCircle,
  Wallet,
  Building2,
  Users,
} from 'lucide-react'
import { WelcomeBanner } from '@/components/dashboard/WelcomeBanner'
import {
  DashboardHeader,
  type DashboardFilterState,
} from '@/components/dashboard/DashboardHeader'
import { DashboardKpiCard } from '@/components/dashboard/DashboardKpiCard'
import {
  IncomeSummaryChart,
  ExpenseSummaryChart,
} from '@/components/dashboard/CategorySummaryChart'
import { ProfitLossMonthlyChart } from '@/components/dashboard/ProfitLossMonthlyChart'
import { RecentTransactionsCard } from '@/components/dashboard/RecentTransactionsCard'
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton'
import { employeeService } from '@/services/employeeService'
import {
  dashboardService,
  type DashboardData,
} from '@/services/dashboardService'
import { pettyCashService } from '@/services/pettyCashService'
import { salesService } from '@/services/salesService'
import { expenseService } from '@/services/expenseService'
import { websocketService } from '@/services/websocketService'
import { formatPHP } from '@/lib/format'
import { isDateInRange, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'

export const DashboardPage: React.FC = () => {
  const { user } = useSession()
  const { activeCompany, setActiveCompany, allCompanies } = useCompany()

  const userRole = (user?.role || '').trim().toLowerCase()
  const isAdmin = userRole === 'admin'
  const isFinance = userRole === 'finance'
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isMultiCompanyRole = isAdmin || isFinance || isAudit
  const userAssignedCompanies = React.useMemo(() => {
    if (user?.companyNames && user.companyNames.length > 0) {
      return user.companyNames
    }
    if (user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      return [user.assignedCompany]
    }
    return []
  }, [user?.companyNames, user?.assignedCompany])

  const hasMultipleAssigned = userAssignedCompanies.length >= 2
  const isCompanyScoped = Boolean(
    !hasMultipleAssigned &&
      userAssignedCompanies.length === 1 &&
      !isMultiCompanyRole
  )

  // Dynamic companies list strictly from authorized assigned companies in CompanyContext
  const companyList = allCompanies

  // Admin stats for Company & User KPI cards
  const [adminStats, setAdminStats] = React.useState<{
    companyCount: number
    userCount: number
  }>({
    companyCount: allCompanies?.length || 0,
    userCount: 0,
  })
  const [adminLoading, setAdminLoading] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (!isAdmin) return
    let mounted = true
    setAdminLoading(true)
    Promise.all([
      employeeService.getCompanies().catch(() => []),
      employeeService.getUsers().catch(() => []),
    ])
      .then(([comps, usrs]) => {
        if (!mounted) return
        setAdminStats({
          companyCount: comps && comps.length > 0 ? comps.length : (allCompanies?.length || 0),
          userCount: usrs && usrs.length > 0 ? usrs.length : 0,
        })
      })
      .finally(() => {
        if (mounted) setAdminLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [isAdmin])

  const initialCompany = activeCompany || (userAssignedCompanies[0] || 'All Companies')
  const [filters, setFilters] = React.useState<DashboardFilterState>(() => ({
    dateRange: {
      startDate: null,
      endDate: null,
      label: 'All Dates',
    },
    companies: [initialCompany],
    company: initialCompany,
  }))

  // Selected companies helper
  const selectedCompanies = React.useMemo<string[]>(() => {
    if (Array.isArray(filters.companies) && filters.companies.length > 0) {
      return filters.companies
    }
    if (filters.company) {
      return [filters.company]
    }
    return ['All Companies']
  }, [filters.companies, filters.company])

  const isAllCompanies =
    selectedCompanies.length === 0 ||
    selectedCompanies.includes('All Companies')

  // Keep filters in sync if activeCompany changes externally
  React.useEffect(() => {
    if (activeCompany) {
      setFilters((prev) => {
        const currentPrimary = prev.companies?.length === 1 ? prev.companies[0] : prev.company
        if (currentPrimary !== activeCompany) {
          return {
            ...prev,
            companies: [activeCompany],
            company: activeCompany,
          }
        }
        return prev
      })
    }
  }, [activeCompany])

  const [loading, setLoading] = React.useState<boolean>(true)
  const [data, setData] = React.useState<DashboardData | null>(null)
  const [loadError, setLoadError] = React.useState<string>('')

  // Stable key for caching and reloading
  const companiesFilterKey = React.useMemo(() => {
    if (isAllCompanies) return 'All Companies'
    return [...selectedCompanies].sort().join('|')
  }, [isAllCompanies, selectedCompanies])

  // Fetch initial dashboard data
  React.useEffect(() => {
    let isMounted = true

    const loadData = async () => {
      setLoading(true)
      try {
        const singleCompany = !isAllCompanies && selectedCompanies.length === 1 ? selectedCompanies[0] : undefined
        const result = await dashboardService.getDashboardData({
          company: singleCompany,
        })
        if (isMounted) {
          setData(result)
          setLoadError('')
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
        if (isMounted) {
          setLoadError(err instanceof Error ? err.message : 'The dashboard data could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [companiesFilterKey])

  // Realtime: reload quietly when another user changes data (spec 0018)
  React.useEffect(() => {
    let mounted = true
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        dashboardService.invalidateCache()
        salesService.invalidateCache()
        expenseService.invalidateCache()
        try {
          const singleCompany = !isAllCompanies && selectedCompanies.length === 1 ? selectedCompanies[0] : undefined
          const result = await dashboardService.getDashboardData({ company: singleCompany })
          if (mounted) {
            setData(result)
            setLoadError('')
          }
        } catch {
          // keep what is on screen; the next full load shows the error
        }
      }, 400)
    }
    const unsubs = (['AUDIT_UPDATED', 'LOANS_UPDATED', 'PETTY_CASH_UPDATED', 'BANK_UPDATED', 'TENANTS_UPDATED'] as const).map(
      (event) => websocketService.subscribe(event, reload)
    )
    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
      unsubs.forEach((off) => off())
    }
  }, [companiesFilterKey])

  // Petty cash wallet(s) for the selected companies; null when backend is unavailable
  const [pettyCash, setPettyCash] = React.useState<{
    balance: number
    lowCount: number
    walletCount: number
  } | null>(null)
  const [pettyCashLoading, setPettyCashLoading] = React.useState<boolean>(true)

  React.useEffect(() => {
    let isMounted = true
    setPettyCashLoading(true)

    if (isAllCompanies) {
      pettyCashService.getAllSummaries()
        .then((summaries) => {
          if (!isMounted) return
          setPettyCash({
            balance: summaries.reduce((sum, s) => sum + s.balance, 0),
            lowCount: summaries.filter((s) => s.isLow).length,
            walletCount: summaries.length,
          })
        })
        .catch(() => isMounted && setPettyCash(null))
        .finally(() => {
          if (isMounted) setPettyCashLoading(false)
        })
    } else {
      pettyCashService.getAllSummaries()
        .then((summaries) => {
          if (!isMounted) return
          const matched = summaries.filter((s) =>
            selectedCompanies.some((c) => isCompanyMatch(s.companyName, c))
          )
          setPettyCash({
            balance: matched.reduce((sum, s) => sum + s.balance, 0),
            lowCount: matched.filter((s) => s.isLow).length,
            walletCount: matched.length,
          })
        })
        .catch(() => isMounted && setPettyCash(null))
        .finally(() => {
          if (isMounted) setPettyCashLoading(false)
        })
    }
    return () => {
      isMounted = false
    }
  }, [companiesFilterKey])

  // Filter transactions strictly on client side by company and date range, sorted latest first
  const filteredTransactions = React.useMemo(() => {
    if (!data?.recentTransactions) return []

    return data.recentTransactions
      .filter((tx) => {
        // 1. Company filter (one or more selected companies)
        if (!isAllCompanies) {
          const match = selectedCompanies.some((targetComp) =>
            isCompanyMatch(tx.company, targetComp)
          )
          if (!match) return false
        }

        // 2. Date range filter
        return isDateInRange(
          tx.date,
          filters.dateRange.startDate,
          filters.dateRange.endDate
        )
      })
      .sort((a, b) => {
        const dateA = normalizeDateToYYYYMMDD(a.date)
        const dateB = normalizeDateToYYYYMMDD(b.date)
        const cmp = dateB.localeCompare(dateA)
        if (cmp !== 0) return cmp
        return (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      })
  }, [data?.recentTransactions, isAllCompanies, selectedCompanies, filters.dateRange])

  // Dynamic KPI calculations responding to filtered transactions:
  // Total Cash: actual cash inflow/deposits collected from sales
  // Total Cash Expense: actual cash outflow/withdrawals disbursed from expenses
  // Net Income: Total Cash - Total Cash Expense
  const { totalExpenses, totalIncome, netIncome, overdueCount, dueSoonCount } =
    React.useMemo(() => {
      const expenses = filteredTransactions.reduce((sum, tx) => {
        if (tx.type === 'Expense') {
          return sum + (tx.withdrawal || tx.amount || 0)
        }
        return sum
      }, 0)

      const income = filteredTransactions.reduce((sum, tx) => {
        if (tx.type === 'Sales' || tx.type === 'Income') {
          return sum + (tx.deposit || tx.amount || 0)
        }
        return sum
      }, 0)

      const net = income - expenses

      const overdue = filteredTransactions.filter(
        (tx) => tx.status === 'Overdue' || tx.auditStatus === 'Flagged'
      ).length
      const dueSoon = filteredTransactions.filter(
        (tx) => tx.status === 'Pending'
      ).length

      return {
        totalExpenses: expenses,
        totalIncome: income,
        netIncome: net,
        overdueCount: overdue,
        dueSoonCount: dueSoon,
      }
    }, [filteredTransactions])

  if (!isAdmin && loading && !data) {
    return <DashboardSkeleton />
  }

  if (isAdmin && adminLoading && adminStats.userCount === 0 && adminStats.companyCount === 0) {
    return <DashboardSkeleton isAdmin={true} />
  }

  return (
    <div className="space-y-5 pb-8 max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {/* Visually hidden h1 for accessibility compliance */}
      <h1 className="sr-only">MCT Centralized Financial Dashboard</h1>

      {/* 1. Sleek Compact Welcome Greeting Banner & Company/Date Filter Bar */}
      <div className="space-y-3">
        <WelcomeBanner />
        {!isAdmin && (
          <DashboardHeader
            filters={filters}
            companies={companyList}
            onFiltersChange={(newFilters) => {
              setFilters(newFilters)
              if (!isCompanyScoped) {
                const newSelected = newFilters.companies || []
                if (newSelected.length === 1 && newSelected[0] !== 'All Companies') {
                  setActiveCompany(newSelected[0])
                } else if (newSelected.includes('All Companies')) {
                  setActiveCompany('All Companies')
                }
              }
            }}
            isCompanyScoped={isCompanyScoped}
          />
        )}
      </div>

      {loadError && (
        <div
          className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
          <span>
            The dashboard data could not be loaded. {loadError} The figures below may be incomplete.
          </span>
        </div>
      )}

      {/* 3. KPI Cards:
          Admin: Only Company and User KPI cards
          Other roles: Income, Expenses, Net Income, Overdue / Due Soon, and Petty Cash
      */}
      {isAdmin ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            to="/employee"
            className="block rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Open company management"
          >
            <DashboardKpiCard
              label="Companies"
              value={adminLoading ? '...' : String(adminStats.companyCount)}
              loading={adminLoading}
              icon={Building2}
              subtext="Registered Companies"
              valueClassName="text-focus font-bold"
              iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
              className="h-full cursor-pointer hover:border-primary/40"
            />
          </Link>
          <Link
            to="/users"
            className="block rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Open user management"
          >
            <DashboardKpiCard
              label="Users"
              value={adminLoading ? '...' : String(adminStats.userCount)}
              loading={adminLoading}
              icon={Users}
              subtext="Active System Accounts"
              valueClassName="text-focus font-bold"
              iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
              className="h-full cursor-pointer hover:border-blue-400/40"
            />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <DashboardKpiCard
            label="Total Cash"
            value={formatPHP(totalIncome)}
            loading={loading}
            icon={TrendingUp}
            valueClassName="text-focus font-bold"
            iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
          />
          <DashboardKpiCard
            label="Total Cash Expense"
            value={formatPHP(totalExpenses)}
            loading={loading}
            icon={TrendingDown}
            valueClassName="text-focus font-bold"
            iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
          />
          <DashboardKpiCard
            label="Net Income (Total Cash - Cash Expense)"
            value={formatPHP(netIncome)}
            loading={loading}
            icon={Landmark}
            valueClassName="text-focus font-bold"
            iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
          />
          <DashboardKpiCard
            label="Overdue / Due Soon"
            value={`${overdueCount} / ${dueSoonCount}`}
            loading={loading}
            icon={AlertCircle}
            valueClassName="text-focus font-bold"
            iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
          />
          <Link
            to="/petty-cash"
            className="block rounded-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Open petty cash"
          >
            <DashboardKpiCard
              label="Petty Cash Balance"
              value={pettyCash ? formatPHP(pettyCash.balance) : '—'}
              loading={loading || pettyCashLoading}
              icon={Wallet}
              className="h-full"
              valueClassName="text-focus font-bold"
              iconContainerClassName="bg-slate-100 text-focus border border-slate-200/80"
            />
          </Link>
        </div>
      )}

      {/* Financial charts and tables: Hidden for Admin as requested */}
      {!isAdmin && (
        <>
          {/* Monthly profit / loss (income - expenses), above the category summaries */}
          <ProfitLossMonthlyChart transactions={filteredTransactions} />

          {/* 4. Income and Expense Summary Charts:
              Two separate charts side by side (stacked on mobile):
              1. Income Summary
              2. Expense Summary
              Each chart has its independent Bar/Pie toggle, defaults to Bar,
              and breaks down by GCash, Maya, PayMongo, Panda, In-house with consistent colors.
          */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <IncomeSummaryChart transactions={filteredTransactions} />
            <ExpenseSummaryChart transactions={filteredTransactions} />
          </div>

          {/* 5. Recent Transactions Table:
              Columns in order: Date, Cheque No., Particulars, Withdrawal, Deposit, Category
              Updates when date range changes. Max 10 rows per page with working pagination.
          */}
          <RecentTransactionsCard
            companyName={
              isAllCompanies
                ? 'All Companies'
                : selectedCompanies.length === 1
                ? selectedCompanies[0]
                : `${selectedCompanies.length} Companies`
            }
            transactions={filteredTransactions}
          />
        </>
      )}
    </div>
  )
}
