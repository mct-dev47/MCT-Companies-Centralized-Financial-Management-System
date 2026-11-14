import * as React from 'react'
import { createBrowserRouter, Navigate, useRouteError } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/components/layout/AppShell'
import {
  ProtectedRoute,
  PublicOnlyRoute,
  AdminOnlyRoute,
  FinanceOnlyRoute,
  NonAdminRouteGuard,
  LendingRouteGuard,
  TenantRouteGuard,
  SalesRouteGuard,
} from '@/components/layout/RouteGuards'

function PageFallback() {
  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-200">
      {/* Header skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-9 w-56 rounded-xl bg-slate-200/80 animate-pulse" />
          <div className="h-4 w-72 rounded-md bg-slate-200/60 animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-28 rounded-xl bg-slate-200/70 animate-pulse" />
          <div className="h-10 w-32 rounded-xl bg-slate-200/70 animate-pulse" />
        </div>
      </div>

      {/* KPI Cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-full bg-white rounded-[15px] border border-stroke/20 p-5 shadow-xs flex items-center justify-between animate-pulse"
          >
            <div className="space-y-2">
              <div className="h-3 w-20 rounded bg-slate-200/80" />
              <div className="h-7 w-32 rounded bg-slate-200/80" />
              <div className="h-3 w-40 rounded bg-slate-200/60" />
            </div>
            <div className="h-11 w-11 rounded-xl bg-slate-200/70 shrink-0" />
          </div>
        ))}
      </div>

      {/* Table container skeleton */}
      <div className="bg-white rounded-[24px] border border-stroke/30 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-5 w-44 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-9 w-48 rounded-xl bg-slate-200/60 animate-pulse" />
        </div>
        <div className="space-y-3 pt-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-11 w-full rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}

function RootErrorBoundary() {
  const error: any = useRouteError()
  const errorMessage =
    error?.message ||
    (typeof error === 'string' ? error : 'The page encountered an unexpected error.')

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 rounded-full bg-red-50 text-brand flex items-center justify-center mb-4 ring-8 ring-red-50/50">
        <AlertTriangle className="w-7 h-7 text-brand" />
      </div>
      <h1 className="text-xl font-bold text-slate-800 mb-2">Something went wrong</h1>
      <p className="text-sm text-slate-500 max-w-md mb-6 leading-relaxed">
        {errorMessage}
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          onClick={() => window.location.reload()}
          className="rounded-[10px] inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Reload Page
        </Button>
      </div>
    </div>
  )
}

function lazyPage<P = any>(
  importer: () => Promise<{ [key: string]: any }>,
  name: string
) {
  const LazyComponent = React.lazy(async () => {
    try {
      const m = await importer()
      return { default: m[name] }
    } catch (error: any) {
      const isChunkLoadFailed =
        error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('dynamically imported module') ||
        error?.name === 'ChunkLoadError'

      if (isChunkLoadFailed) {
        const key = `chunk_reload_${name}`
        const alreadyReloaded = sessionStorage.getItem(key)
        if (!alreadyReloaded) {
          sessionStorage.setItem(key, 'true')
          window.location.reload()
          return new Promise<{ default: React.ComponentType<any> }>(() => {})
        }
        sessionStorage.removeItem(key)
      }
      throw error
    }
  })
  return function Wrapped(props: P & React.JSX.IntrinsicAttributes) {
    return (
      <React.Suspense fallback={<PageFallback />}>
        <LazyComponent {...(props as any)} />
      </React.Suspense>
    )
  }
}

// Lazy-loaded routes for code-splitting
const LandingPage = lazyPage(() => import('@/pages/LandingPage'), 'LandingPage')
const LoginPage = lazyPage(() => import('@/pages/LoginPage'), 'LoginPage')
const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'), 'DashboardPage')
const SalesPage = lazyPage(() => import('@/pages/SalesPage'), 'SalesPage')
const ExpensePage = lazyPage(() => import('@/pages/ExpensePage'), 'ExpensePage')
const LoanPage = lazyPage(() => import('@/pages/LoanPage'), 'LoanPage')
const LendingPage = lazyPage(() => import('@/pages/LendingPage'), 'LendingPage')
const TenantPage = lazyPage(() => import('@/pages/TenantPage'), 'TenantPage')
const BankManagementPage = lazyPage(() => import('@/pages/BankManagementPage'), 'BankManagementPage')
const BillsPage = lazyPage(() => import('@/pages/BillsPage'), 'BillsPage')
const PettyCashPage = lazyPage(() => import('@/pages/PettyCashPage'), 'PettyCashPage')
const TransactionPage = lazyPage(() => import('@/pages/TransactionPage'), 'TransactionPage')
const EmployeePage = lazyPage(() => import('@/pages/EmployeePage'), 'EmployeePage')
const UserManagementPage = lazyPage(() => import('@/pages/UserManagementPage'), 'UserManagementPage')
const ActivityLogPage = lazyPage(() => import('@/pages/ActivityLogPage'), 'ActivityLogPage')
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage')
const AddTransactionSheetPage = lazyPage(
  () => import('@/pages/AddTransactionSheetPage'),
  'AddTransactionSheetPage'
)
const ReceivablesPage = lazyPage(() => import('@/pages/ReceivablesPage'), 'ReceivablesPage')
const CentralizedAuthPage = lazyPage(
  () => import('@/pages/CentralizedAuthPage'),
  'CentralizedAuthPage'
)
const SetupPasswordPage = lazyPage(
  () => import('@/pages/SetupPasswordPage'),
  'SetupPasswordPage'
)

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
    errorElement: <RootErrorBoundary />,
  },
  // Finance Centralized Company Selector & Hub (Strictly Finance only)
  {
    path: '/centralized-auth',
    element: (
      <FinanceOnlyRoute>
        <CentralizedAuthPage />
      </FinanceOnlyRoute>
    ),
    errorElement: <RootErrorBoundary />,
  },
  {
    path: '/finance/centralized-auth',
    element: <Navigate to="/centralized-auth" replace />,
  },
  {
    path: '/choose-company',
    element: <Navigate to="/centralized-auth" replace />,
  },
  // Public Only routes (authenticated users redirected to /dashboard)
  {
    path: '/login',
    element: (
      <PublicOnlyRoute>
        <LoginPage />
      </PublicOnlyRoute>
    ),
    errorElement: <RootErrorBoundary />,
  },
  {
    path: '/forgot-password',
    element: (
      <PublicOnlyRoute>
        <LoginPage />
      </PublicOnlyRoute>
    ),
    errorElement: <RootErrorBoundary />,
  },
  {
    path: '/verify-2fa',
    element: (
      <PublicOnlyRoute>
        <LoginPage />
      </PublicOnlyRoute>
    ),
    errorElement: <RootErrorBoundary />,
  },
  {
    path: '/auth/setup-password',
    element: <SetupPasswordPage />,
    errorElement: <RootErrorBoundary />,
  },
  {
    path: '/setup-password',
    element: <SetupPasswordPage />,
    errorElement: <RootErrorBoundary />,
  },
  // Authenticated Persistent App Shell layout route
  // Using AppShell as a layout route keeps the sidebar and header mounted,
  // preventing layout destruction and enabling instantaneous page navigation.
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    errorElement: <RootErrorBoundary />,
    children: [
      {
        path: '/dashboard',
        element: (
          <NonAdminRouteGuard>
            <DashboardPage />
          </NonAdminRouteGuard>
        ),
      },
      // Sales routes
      {
        path: '/sales',
        element: (
          <SalesRouteGuard>
            <SalesPage />
          </SalesRouteGuard>
        ),
      },
      {
        path: '/sales/daily',
        element: <Navigate to="/sales" replace />,
      },
      {
        path: '/sales/quarterly',
        element: <Navigate to="/sales" replace />,
      },
      {
        path: '/sales/monthly',
        element: <Navigate to="/sales" replace />,
      },
      {
        path: '/sales/annual',
        element: <Navigate to="/sales" replace />,
      },
      {
        path: '/sales/add',
        element: (
          <NonAdminRouteGuard>
            <AddTransactionSheetPage initialType="Sales" />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/add',
        element: <Navigate to="/sales/add" replace />,
      },
      // Receivables routes (Food Utang Management)
      {
        path: '/receivables',
        element: (
          <NonAdminRouteGuard>
            <ReceivablesPage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/utang',
        element: <Navigate to="/receivables" replace />,
      },
      // Expense routes
      {
        path: '/expense',
        element: (
          <NonAdminRouteGuard>
            <ExpensePage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/expense/add',
        element: (
          <NonAdminRouteGuard>
            <AddTransactionSheetPage initialType="Expense" />
          </NonAdminRouteGuard>
        ),
      },
      // Loan routes
      {
        path: '/loan',
        element: (
          <NonAdminRouteGuard>
            <LoanPage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/loan/company',
        element: <Navigate to="/loan" replace />,
      },
      {
        path: '/loan/borrower',
        element: (
          <NonAdminRouteGuard>
            <LoanPage initialType="Borrower" />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/loan/lender',
        element: (
          <NonAdminRouteGuard>
            <LoanPage initialType="Lender" />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/lending',
        element: (
          <LendingRouteGuard>
            <LendingPage />
          </LendingRouteGuard>
        ),
      },
      {
        path: '/tenant',
        element: (
          <TenantRouteGuard>
            <TenantPage />
          </TenantRouteGuard>
        ),
      },
      {
        path: '/tenants',
        element: <Navigate to="/tenant" replace />,
      },
      {
        path: '/bank-management',
        element: (
          <NonAdminRouteGuard>
            <BankManagementPage />
          </NonAdminRouteGuard>
        ),
      },
      // Operations & Management
      {
        path: '/petty-cash',
        element: (
          <NonAdminRouteGuard>
            <PettyCashPage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/bills',
        element: (
          <NonAdminRouteGuard>
            <BillsPage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/bills/:billId',
        element: (
          <NonAdminRouteGuard>
            <BillsPage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/loan/bills',
        element: <Navigate to="/bills" replace />,
      },
      {
        path: '/transaction',
        element: (
          <NonAdminRouteGuard>
            <TransactionPage />
          </NonAdminRouteGuard>
        ),
      },
      {
        path: '/transactions',
        element: <Navigate to="/transaction" replace />,
      },
      {
        path: '/employee',
        element: (
          <AdminOnlyRoute>
            <EmployeePage />
          </AdminOnlyRoute>
        ),
      },
      {
        path: '/users',
        element: (
          <AdminOnlyRoute>
            <UserManagementPage />
          </AdminOnlyRoute>
        ),
      },
      {
        path: '/user-management',
        element: <Navigate to="/users" replace />,
      },
      {
        path: '/activity-log',
        element: (
          <AdminOnlyRoute>
            <ActivityLogPage />
          </AdminOnlyRoute>
        ),
      },
      {
        path: '/activity',
        element: <Navigate to="/activity-log" replace />,
      },
      {
        path: '/settings',
        element: <SettingsPage />,
      },
    ],
  },
  // Fallback
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
])

