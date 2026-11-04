import * as React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import logo2Url from '@/assets/LOGO2.png'
import mct2Url from '@/assets/MCT2.png'
import {
  getSidebarNavSections,
  type NavItem,
} from '@/components/layout/navItems'
import { Separator } from '@/components/ui/separator'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { cn } from '@/lib/utils'

interface AppSidebarProps {
  onItemClick?: () => void
  className?: string
  forceExpanded?: boolean
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  onItemClick,
  className,
  forceExpanded = false,
}) => {
  const { user } = useSession()
  const { activeCompany } = useCompany()
  const location = useLocation()
  const [isHovered, setIsHovered] = React.useState(false)
  const isExpanded = forceExpanded || isHovered

  // Collapsible groups open state
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => ({
    sales: location.pathname.startsWith('/sales'),
    loan: location.pathname.startsWith('/loan') || true,
  }))

  // Auto-expand group if current path is within it
  React.useEffect(() => {
    const currentPath = location.pathname.toLowerCase()
    if (currentPath.startsWith('/sales')) {
      setOpenGroups((prev) => ({ ...prev, sales: true }))
    } else if (currentPath.startsWith('/loan')) {
      setOpenGroups((prev) => ({ ...prev, loan: true }))
    }
  }, [location.pathname])

  const userRole =
    user?.role === 'Finance'
      ? 'Finance'
      : user?.role === 'Supervisor'
      ? 'Supervisor'
      : user?.role === 'Audit'
      ? 'Audit'
      : 'Admin'

  // Dynamic role-based & company-specific sections: Main, Operations, Administration
  const { mainItems, operationsItems, adminItems } = React.useMemo(
    () => getSidebarNavSections(user?.role, activeCompany, user?.assignedCompany),
    [user?.role, activeCompany, user?.assignedCompany]
  )

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon

    const roleSubItems = item.subItems?.filter(
      (subItem) =>
        !subItem.roles ||
        subItem.roles.includes(userRole) ||
        subItem.roles.includes(user?.role || '')
    )

    // Collapsible navigation group with sub-items (e.g. Loan -> Borrower, Lender)
    if (roleSubItems && roleSubItems.length > 0) {
      const isGroupActive = location.pathname.startsWith(item.href)
      const isGroupOpen = openGroups[item.id] ?? true

      if (!isExpanded) {
        const targetHref = roleSubItems[0]?.href || item.href
        return (
          <NavLink
            key={item.id}
            to={targetHref}
            onClick={onItemClick}
            title={item.title}
            className={cn(
              'flex items-center justify-center rounded-xl w-11 h-10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus mx-auto',
              isGroupActive
                ? 'text-primary bg-primary/10'
                : 'text-focus hover:bg-surface'
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
          </NavLink>
        )
      }

      return (
        <Collapsible
          key={item.id}
          open={isGroupOpen}
          onOpenChange={(isOpen) =>
            setOpenGroups((prev) => ({ ...prev, [item.id]: isOpen }))
          }
          className="w-full space-y-0.5"
        >
          <CollapsibleTrigger
            className={cn(
              'flex w-full items-center rounded-xl px-3 h-10 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus cursor-pointer',
              isGroupActive
                ? 'text-primary bg-primary/10'
                : 'text-focus hover:bg-surface'
            )}
            aria-expanded={isGroupOpen}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="ml-3 truncate">{item.title}</span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-transform duration-200 text-muted-fg ml-auto',
                isGroupOpen && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-0.5 pl-9 pt-0.5 pb-0.5">
            {roleSubItems.map((subItem) => (
              <NavLink
                key={subItem.id}
                to={subItem.href}
                onClick={onItemClick}
                className={({ isActive }) =>
                  cn(
                    'block rounded-lg px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus truncate',
                    isActive
                      ? 'text-primary font-semibold bg-primary/5'
                      : 'text-muted-fg hover:text-focus hover:bg-surface/60'
                  )
                }
              >
                {subItem.title}
              </NavLink>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )
    }

    // Standard NavLink Item
    return (
      <NavLink
        key={item.id}
        to={item.href}
        onClick={onItemClick}
        title={!isExpanded ? item.title : undefined}
        className={({ isActive }) =>
          cn(
            'flex items-center rounded-xl h-10 px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            isActive
              ? 'text-primary bg-primary/10'
              : 'text-focus hover:bg-surface'
          )
        }
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span
          className={cn(
            'text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out',
            isExpanded
              ? 'opacity-100 max-w-[180px] ml-3'
              : 'opacity-0 max-w-0 ml-0 pointer-events-none'
          )}
        >
          {item.title}
        </span>
      </NavLink>
    )
  }

  return (
    <aside
      onMouseEnter={() => !forceExpanded && setIsHovered(true)}
      onMouseLeave={() => !forceExpanded && setIsHovered(false)}
      className={cn(
        'flex flex-col justify-between h-full bg-background border-r border-stroke/20 select-none overflow-y-auto overflow-x-hidden no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden transition-[width,box-shadow] duration-300 ease-in-out',
        forceExpanded
          ? 'w-full relative shadow-none'
          : cn(
              'absolute left-0 top-0 z-50 bg-white dark:bg-slate-900',
              isExpanded ? 'w-64 lg:w-72 shadow-2xl' : 'w-[72px] shadow-none'
            ),
        className
      )}
    >
      <div className="flex flex-col py-4 lg:py-6">
        {/* Logo Lockup */}
        <div className="px-4 pb-2">
          <div className="flex items-center h-11">
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              <img
                src={logo2Url}
                alt="MCT Logo"
                className="h-9 w-9 object-contain"
              />
            </div>
            <div
              className={cn(
                'flex flex-col justify-center items-start overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out',
                isExpanded ? 'max-w-[200px] opacity-100 ml-2.5' : 'max-w-0 opacity-0 ml-0 pointer-events-none'
              )}
            >
              <img
                src={mct2Url}
                alt="MCT"
                className="h-3.5 sm:h-4.5 lg:h-5 w-auto object-contain object-left block"
              />
              <span className="text-[9px] sm:text-[10px] font-medium text-muted-fg tracking-tight leading-tight mt-0.5">
                Group of Companies
              </span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label="Main Navigation" className="flex flex-col mt-3 lg:mt-5">
          {/* MAIN Section Header (Non-admin only; admin shows clean items without section headers) */}
          {userRole !== 'Admin' && mainItems.length > 0 && (
            <div className="px-4 pb-2">
              <div
                className={cn(
                  'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out',
                  isExpanded ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0'
                )}
              >
                <span className="text-[10px] font-bold tracking-wider text-muted-fg/80 uppercase">
                  MAIN
                </span>
              </div>
              {!isExpanded && <div className="w-8 h-px bg-stroke/30 mx-auto" />}
            </div>
          )}

          {/* Main items */}
          <div className="px-3 space-y-1">
            {mainItems.map(renderNavItem)}
          </div>

          {/* OPERATIONS Section Header */}
          {operationsItems.length > 0 && (
            <>
              <div className="px-4 my-3">
                <Separator className="bg-stroke/30" />
              </div>

              <div className="px-4 pb-2">
                <div
                  className={cn(
                    'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out',
                    isExpanded ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0'
                  )}
                >
                  <span className="text-[10px] font-bold tracking-wider text-muted-fg/80 uppercase">
                    OPERATIONS
                  </span>
                </div>
                {!isExpanded && <div className="w-8 h-px bg-stroke/30 mx-auto" />}
              </div>

              {/* Operations items */}
              <div className="px-3 space-y-1">
                {operationsItems.map(renderNavItem)}
              </div>
            </>
          )}

          {/* ADMINISTRATION Section Header (Admin only) */}
          {adminItems && adminItems.length > 0 && (
            <>
              <div className="px-4 my-3">
                <Separator className="bg-stroke/30" />
              </div>

              <div className="px-4 pb-2">
                <div
                  className={cn(
                    'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out',
                    isExpanded ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0'
                  )}
                >
                  <span className="text-[10px] font-bold tracking-wider text-muted-fg/80 uppercase">
                    ADMINISTRATION
                  </span>
                </div>
                {!isExpanded && <div className="w-8 h-px bg-stroke/30 mx-auto" />}
              </div>

              <div className="px-3 space-y-1">
                {adminItems.map(renderNavItem)}
              </div>
            </>
          )}
        </nav>
      </div>
    </aside>
  )
}
