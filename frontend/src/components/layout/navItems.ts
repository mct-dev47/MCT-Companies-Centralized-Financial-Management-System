import {
  LayoutDashboard,
  BarChart3,
  CircleDollarSign,
  HandCoins,
  ArrowLeftRight,
  Building2,
  Users,
  History,
  ReceiptText,
  Wallet,
  Landmark,
  Store,
  Banknote,
  Receipt,
} from 'lucide-react'
import type * as React from 'react'
import { isFilCapCompany, isJKPropertyCompany } from '@/config/companyFeatures'

export interface NavSubItem {
  id: string
  title: string
  href: string
  roles?: string[]
}

export interface NavItem {
  id: string
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  subItems?: NavSubItem[]
  roles?: string[]
  companyCheck?: (company: string) => boolean
}

// Discrete Navigation Item Definitions
export const NAV_ITEM_DASHBOARD: NavItem = {
  id: 'dashboard',
  title: 'Dashboard',
  href: '/dashboard',
  icon: LayoutDashboard,
}

export const NAV_ITEM_PETTY_CASH: NavItem = {
  id: 'petty-cash',
  title: 'Petty Cash',
  href: '/petty-cash',
  icon: Wallet,
}

export const NAV_ITEM_BILLS: NavItem = {
  id: 'bills',
  title: 'Bills',
  href: '/bills',
  icon: ReceiptText,
}

export const NAV_ITEM_TRANSACTIONS: NavItem = {
  id: 'transaction',
  title: 'Transactions',
  href: '/transaction',
  icon: ArrowLeftRight,
}

export const NAV_ITEM_SALES: NavItem = {
  id: 'sales',
  title: 'Sales',
  href: '/sales',
  icon: BarChart3,
}

export const NAV_ITEM_RECEIVABLES: NavItem = {
  id: 'receivables',
  title: 'Receivables',
  href: '/receivables',
  icon: Receipt,
}

export const NAV_ITEM_EXPENSE: NavItem = {
  id: 'expense',
  title: 'Expense',
  href: '/expense',
  icon: CircleDollarSign,
}

export const NAV_ITEM_LOAN: NavItem = {
  id: 'loan',
  title: 'Loan',
  href: '/loan',
  icon: HandCoins,
  subItems: [
    {
      id: 'borrower',
      title: 'Borrower',
      href: '/loan/borrower',
    },
    {
      id: 'lender',
      title: 'Lender',
      href: '/loan/lender',
    },
  ],
}

export const NAV_ITEM_LENDING: NavItem = {
  id: 'lending',
  title: 'Lending',
  href: '/lending',
  icon: Banknote,
}

export const NAV_ITEM_TENANTS: NavItem = {
  id: 'tenant',
  title: 'Tenants',
  href: '/tenant',
  icon: Store,
}

export const NAV_ITEM_BANK_MANAGEMENT: NavItem = {
  id: 'bank-management',
  title: 'Bank',
  href: '/bank-management',
  icon: Landmark,
}

export const NAV_ITEM_COMPANY_MANAGEMENT: NavItem = {
  id: 'employee',
  title: 'Company Management',
  href: '/employee',
  icon: Building2,
}

export const NAV_ITEM_USER_MANAGEMENT: NavItem = {
  id: 'users',
  title: 'User Management',
  href: '/users',
  icon: Users,
}

export const NAV_ITEM_ACTIVITY_LOG: NavItem = {
  id: 'activity-log',
  title: 'Activity Log',
  href: '/activity-log',
  icon: History,
}

export interface SidebarNavSections {
  mainItems: NavItem[]
  operationsItems: NavItem[]
  adminItems?: NavItem[]
}

/**
 * Returns the exact role-based and company-based navigation sections according to system specifications:
 *
 * Supervisor & Finance:
 *   Main: Dashboard, Petty Cash, Bills, Transactions
 *   Operations: Sales, Expense, Loan (plus Lending if FilCap, Tenants if JK)
 *
 * FilCap Company / JK Company:
 *   Main: Dashboard, Petty Cash, Bills, Transactions
 *   Operations: Sales, Expense, Loan, Lending (FilCap) / Tenants (JK)
 *
 * Audit / Company Auditor:
 *   Main: Dashboard, Transactions, Petty Cash, Bills
 *   Operations: Sales, Expense, Loan (plus Lending if FilCap, Tenants if JK)
 *
 * Admin:
 *   Main: Dashboard, Petty Cash, Bills, Transactions
 *   Operations: Sales, Expense, Loan, Bank Management (plus Lending if FilCap, Tenants if JK)
 *   Administration: Company Management, User Management, Activity Log
 */
export function getSidebarNavSections(
  role?: string | null,
  activeCompany?: string | null,
  assignedCompany?: string | null
): SidebarNavSections {
  const normalizedRole = (role || '').trim().toLowerCase()
  const isAudit = normalizedRole === 'audit' || normalizedRole.includes('auditor')
  const isAdmin = normalizedRole === 'admin'
  const isFinance = normalizedRole === 'finance'

  // Company detection (checks current active dropdown company or user's assigned company)
  const targetCompany = activeCompany || assignedCompany || ''
  const isFilCap = isFilCapCompany(targetCompany)
  const isJK = isJKPropertyCompany(targetCompany)

  // Admin has NO operation section and NO administration section header in the sidebar.
  // Its core management links (Company Management, User Management, Activity Log) reside directly in main items.
  if (isAdmin) {
    return {
      mainItems: [
        NAV_ITEM_COMPANY_MANAGEMENT,
        NAV_ITEM_USER_MANAGEMENT,
        NAV_ITEM_ACTIVITY_LOG,
      ],
      operationsItems: [],
      adminItems: [],
    }
  }

  // 1. MAIN ITEMS
  // Audit Main: Dashboard -> Transactions -> Petty Cash -> Bills
  // Supervisor / Finance / Company Main: Dashboard -> Petty Cash -> Bills -> Transactions
  const mainItems: NavItem[] = isAudit
    ? [NAV_ITEM_DASHBOARD, NAV_ITEM_TRANSACTIONS, NAV_ITEM_PETTY_CASH, NAV_ITEM_BILLS]
    : [NAV_ITEM_DASHBOARD, NAV_ITEM_PETTY_CASH, NAV_ITEM_BILLS, NAV_ITEM_TRANSACTIONS]

  // 2. OPERATIONS ITEMS
  const operationsItems: NavItem[] = []

  if (isAudit) {
    // Audit has view-only oversight over all core operations
    operationsItems.push(
      NAV_ITEM_SALES,
      NAV_ITEM_RECEIVABLES,
      NAV_ITEM_EXPENSE,
      NAV_ITEM_LOAN,
      NAV_ITEM_BANK_MANAGEMENT
    )
    if (isFilCap) {
      operationsItems.push(NAV_ITEM_LENDING)
    } else if (isJK) {
      operationsItems.push(NAV_ITEM_TENANTS)
    } else {
      // General view (All Companies or unselected overview)
      operationsItems.push(NAV_ITEM_TENANTS, NAV_ITEM_LENDING)
    }
  } else {
    // Filcap (Lending) and JK do not have the Sales page per business specifications
    if (!isFilCap && !isJK) {
      // Sales and Food Receivables under Operations for Finance, Supervisors
      operationsItems.push(NAV_ITEM_SALES, NAV_ITEM_RECEIVABLES)
    }
    operationsItems.push(NAV_ITEM_EXPENSE, NAV_ITEM_LOAN)

    // Bank Management in Operations for Finance and Company accounts
    operationsItems.push(NAV_ITEM_BANK_MANAGEMENT)

    // FilCap gets Lending in Operations exclusively (strictly excluded for JK)
    if (isFilCap && !isJK) {
      operationsItems.push(NAV_ITEM_LENDING)
    }

    // JK Property gets Tenants in Operations exclusively (strictly excluded for FilCap)
    if (isJK && !isFilCap) {
      operationsItems.push(NAV_ITEM_TENANTS)
    }
  }

  // 3. ADMINISTRATION ITEMS (None for non-admin)
  const adminItems: NavItem[] = []

  return {
    mainItems,
    operationsItems,
    adminItems,
  }
}

// Fallback compatibility exports
export const MAIN_NAV_ITEMS: readonly NavItem[] = [
  NAV_ITEM_DASHBOARD,
  NAV_ITEM_PETTY_CASH,
  NAV_ITEM_BILLS,
  NAV_ITEM_TRANSACTIONS,
  NAV_ITEM_SALES,
  NAV_ITEM_RECEIVABLES,
  NAV_ITEM_EXPENSE,
  NAV_ITEM_LOAN,
  NAV_ITEM_LENDING,
  NAV_ITEM_TENANTS,
  NAV_ITEM_BANK_MANAGEMENT,
]

export const SECONDARY_NAV_ITEMS: readonly NavItem[] = [
  NAV_ITEM_COMPANY_MANAGEMENT,
  NAV_ITEM_USER_MANAGEMENT,
  NAV_ITEM_ACTIVITY_LOG,
]
