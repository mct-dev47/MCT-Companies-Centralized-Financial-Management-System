import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
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
  type DashboardSummaryData,
} from '@/services/dashboardService'
import { websocketService } from '@/services/websocketService'
import { formatPHP } from '@/lib/format'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'

export const DashboardPage: React.FC = () => {
  const { user } = useSession()
  const { activeCompany, allCompanies } = useCompany()

  const userRole = (user?.role || '').trim().toLowerCase()
  const isAdmin = userRole === 'admin'

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
  }, [isAdmin, allCompanies?.length])

  const [filters, setFilters] = React.useState<DashboardFilterState>(() => ({
    dateRange: {
      startDate: null,
      endDate: null,
      label: 'All Dates',
    },
    company: activeCompany,
  }))

  // Keep filters in sync if activeCompany changes externally
  React.useEffect(() => {
    if (activeCompany && filters.company !== activeCompany) {
      setFilters((prev) => ({
        ...prev,
        company: activeCompany,
      }))
    }
  }, [activeCompany, filters.company])

  const [loading, setLoading] = React.useState<boolean>(true)
  const [data, setData] = React.useState<DashboardSummaryData | null>(null)
  const [loadError, setLoadError] = React.useState<string>('')

  // Fetch initial dashboard summary data via single optimized aggregate endpoint
  React.useEffect(() => {
    if (isAdmin) {
      setLoading(false)
      return
    }

    let isMounted = true

    const loadData = async () => {
      setLoading(true)
      try {
        const result = await dashboardService.getDashboardSummary({
          company: activeCompany,
          startDate: filters.dateRange.startDate,
          endDate: filters.dateRange.endDate,
        })
        if (isMounted) {
          setData(result)
          setLoadError('')
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
        if (isMounted) {
          setLoadError(formatUserFriendlyErrorMessage(err, 'The dashboard data could not be loaded.'))
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
  }, [isAdmin, activeCompany, filters.dateRange.startDate, filters.dateRange.endDate])

  // Realtime: reload quietly when another user changes data (spec 0018)
  React.useEffect(() => {
    if (isAdmin) return
    let mounted = true
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        dashboardService.invalidateCache()
        try {
          const result = await dashboardService.getDashboardSummary({
            company: activeCompany,
            startDate: filters.dateRange.startDate,
            endDate: filters.dateRange.endDate,
            forceRefresh: true,
          })
          if (mounted) {
            setData(result)
            setLoadError('')
          }
        } catch {
          // keep what is on screen; the next full load shows the error
        }
      }, 400)
    }
    const unsubs = (['AUDIT_UPDATED', 'LOANS_UPDATED', 'PETTY_CASH_UPDATED', 'BANK_UPDATED', 'TENANTS_UPDATED', 'LENDING_UPDATED', 'SALES_UPDATED', 'EXPENSES_UPDATED'] as const).map(
      (event) => websocketService.subscribe(event, reload)
    )
    return () => {
      mounted = false
      if (timer) window.clearTimeout(timer)
      unsubs.forEach((off) => off())
    }
  }, [isAdmin, activeCompany, filters.dateRange.startDate, filters.dateRange.endDate])

  const totalIncome = data?.metrics?.total_cash ?? 0
  const totalExpenses = data?.metrics?.total_expense ?? 0
  const netIncome = data?.metrics?.net_income ?? 0
  const overdueCount = data?.metrics?.overdue_count ?? 0
  const dueSoonCount = data?.metrics?.due_soon_count ?? 0
  const pettyCashBalance = data?.metrics?.petty_cash_balance ?? 0
  const recentTransactions = data?.recent_transactions ?? []

  if (!isAdmin && loading && !data) {
    return <DashboardSkeleton />
  }

  if (isAdmin && adminLoading && adminStats.userCount === 0 && adminStats.companyCount === 0) {
    return <DashboardSkeleton isAdmin={true} />
  }

  return (
    <div className="space-y-5 pb-8 w-full max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {/* Visually hidden h1 for accessibility compliance */}
      <h1 className="sr-only">MCT Centralized Financial Dashboard</h1>

      {/* 1. Sleek Compact Welcome Greeting Banner & Uniform Date Filter Bar */}
      <div className="space-y-3">
        <WelcomeBanner />
        {!isAdmin && (
          <DashboardHeader
            filters={filters}
            onFiltersChange={(newFilters) => {
              setFilters(newFilters)
            }}
            activeCompanyName={activeCompany}
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
            label="Net Income"
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
              value={formatPHP(pettyCashBalance)}
              loading={loading}
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
          <ProfitLossMonthlyChart
            monthlyData={data?.monthly_pnl}
            transactions={recentTransactions}
          />

          {/* 4. Income and Expense Summary Charts:
              Two separate charts side by side (stacked on mobile):
              1. Income Summary
              2. Expense Summary
          */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <IncomeSummaryChart
              categories={data?.income_categories ?? []}
              transactions={recentTransactions}
            />
            <ExpenseSummaryChart
              categories={data?.expense_categories ?? []}
              transactions={recentTransactions}
            />
          </div>

          {/* 5. Recent Transactions Table:
              Columns in order: Date, Cheque No., Particulars, Withdrawal, Deposit, Category
              Updates when date range changes. Max 10 rows per page with working pagination.
          */}
          <RecentTransactionsCard
            companyName={activeCompany || 'Company Records'}
            transactions={recentTransactions}
          />
        </>
      )}
    </div>
  )
}
