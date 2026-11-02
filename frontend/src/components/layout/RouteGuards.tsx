import * as React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { Skeleton } from '@/components/ui/skeleton'
import {
  isLendingEnabledCompany,
  isTenantEnabledCompany,
  isFilCapCompany,
  isJKPropertyCompany,
} from '@/config/companyFeatures'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { status } = useSession()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-screen w-full items-center justify-center bg-surface p-8"
        aria-label="Loading application"
        aria-busy="true"
      >
        <div className="w-full max-w-5xl space-y-6">
          <Skeleton className="h-16 w-full rounded-lg" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

export const PublicOnlyRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <Skeleton className="h-96 w-96 rounded-lg" />
      </div>
    )
  }

  if (status === 'authenticated') {
    const role = (user?.role || '').toLowerCase()
    if (role === 'admin') {
      return <Navigate to="/employee" replace />
    }
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

export const AdminOnlyRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-surface p-8">
        <Skeleton className="h-64 w-full max-w-4xl rounded-lg" />
      </div>
    )
  }

  if ((user?.role || '').toLowerCase() !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

/**
 * NonAdminRouteGuard: Ensures Admin cannot access Dashboard or business operations.
 * Admin is redirected to /employee.
 */
export const NonAdminRouteGuard: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-surface p-8">
        <Skeleton className="h-64 w-full max-w-4xl rounded-lg" />
      </div>
    )
  }

  if ((user?.role || '').toLowerCase() === 'admin') {
    return <Navigate to="/employee" replace />
  }

  return <>{children}</>
}

/**
 * CentralizedAuthRouteGuard: Allows Finance and Supervisor (and Audit) to choose company portals.
 * Redirects Admin to /employee.
 */
export const CentralizedAuthRouteGuard: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, status } = useSession()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <Skeleton className="h-96 w-96 rounded-lg" />
      </div>
    )
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />
  }

  const role = (user?.role || '').toLowerCase()
  if (role === 'admin') {
    return <Navigate to="/employee" replace />
  }

  return <>{children}</>
}

export const FinanceOnlyRoute = CentralizedAuthRouteGuard

export const LendingRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useSession()
  const { activeCompany } = useCompany()
  const userRole = (user?.role || '').toLowerCase()

  if (userRole === 'admin') {
    return <Navigate to="/employee" replace />
  }

  const targetCompany = activeCompany || user?.assignedCompany || ''
  if (!isLendingEnabledCompany(targetCompany)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

export const TenantRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useSession()
  const { activeCompany } = useCompany()
  const userRole = (user?.role || '').toLowerCase()

  if (userRole === 'admin') {
    return <Navigate to="/employee" replace />
  }

  const targetCompany = activeCompany || user?.assignedCompany || ''
  if (!isTenantEnabledCompany(targetCompany)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

export const SalesRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()

  if (userRole === 'admin') {
    return <Navigate to="/employee" replace />
  }

  const isCompanyScoped = Boolean(
    user?.assignedCompany &&
      user.assignedCompany !== 'All Companies' &&
      userRole !== 'admin' &&
      userRole !== 'finance' &&
      userRole !== 'audit' &&
      !userRole.includes('auditor')
  )

  // Company-scoped users assigned to Filcap or JK are blocked from Sales
  if (
    isCompanyScoped &&
    (isFilCapCompany(user?.assignedCompany) || isJKPropertyCompany(user?.assignedCompany))
  ) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
