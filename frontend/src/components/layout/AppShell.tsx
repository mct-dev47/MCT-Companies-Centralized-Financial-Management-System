import * as React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { MobileTopBar } from '@/components/layout/MobileTopBar'
import { TopHeader } from '@/components/layout/TopHeader'

interface AppShellProps {
  children?: React.ReactNode
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const location = useLocation()

  React.useEffect(() => {
    const path = location.pathname.toLowerCase()
    if (path.startsWith('/dashboard')) {
      document.title = 'Dashboard - MCT Centralized Financial System'
    } else if (path.startsWith('/sales')) {
      document.title = 'Sales - MCT Centralized Financial System'
    } else if (path.startsWith('/expense')) {
      document.title = 'Expense - MCT Centralized Financial System'
    } else if (path === '/loan/borrower') {
      document.title = 'Borrower Loans - MCT Centralized Financial System'
    } else if (path === '/loan/lender') {
      document.title = 'Lender Loans - MCT Centralized Financial System'
    } else if (path.startsWith('/loan')) {
      document.title = 'Loan - MCT Centralized Financial System'
    } else if (path.startsWith('/lending')) {
      document.title = 'Lending - MCT Centralized Financial System'
    } else if (path.startsWith('/bills')) {
      document.title = 'Bills - MCT Centralized Financial System'
    } else if (path.startsWith('/transaction')) {
      document.title = 'Transactions - MCT Centralized Financial System'
    } else if (path.startsWith('/activity-log')) {
      document.title = 'Activity Log - MCT Centralized Financial System'
    } else if (path.startsWith('/settings')) {
      document.title = 'Settings - MCT Centralized Financial System'
    }
  }, [location.pathname])

  return (
    <div className="flex flex-col lg:flex-row min-h-screen w-full bg-surface">
      {/* Mobile Top Bar with Sheet Drawer (< lg) */}
      <MobileTopBar />

      {/* Desktop Persistent Sidebar Rail (>= lg) */}
      <div className="hidden lg:block shrink-0 w-[72px] min-h-screen self-stretch relative z-50">
        <AppSidebar />
      </div>

      {/* Right Column: Top Notification Header + Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="hidden lg:block">
          <TopHeader />
        </div>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-surface overflow-x-hidden">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  )
}
