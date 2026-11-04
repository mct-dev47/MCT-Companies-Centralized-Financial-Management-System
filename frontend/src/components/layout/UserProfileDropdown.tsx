import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Settings, LogOut, ChevronDown, Loader2, Building2 } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { employeeService } from '@/services/employeeService'
import { isCompanyMatch } from '@/utils/companyUtils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export const UserProfileDropdown: React.FC = () => {
  const { user, signOut } = useSession()
  const { activeCompany } = useCompany()
  const userRole = (user?.role || '').trim().toLowerCase()
  const isAuditOrFinance =
    userRole === 'finance' ||
    userRole === 'audit' ||
    userRole.includes('audit') ||
    userRole === 'owner'

  const assignedCompanyCount = React.useMemo(() => {
    if (!user) return 0
    const names = Array.isArray(user.companyNames) ? user.companyNames.filter(Boolean) : []
    const ids = Array.isArray(user.companyIds) ? user.companyIds.filter(Boolean) : []
    const assignedList = Array.isArray(user.assignedCompanies)
      ? user.assignedCompanies.filter(Boolean)
      : []
    let commaList: string[] = []
    if (user.assignedCompany && user.assignedCompany !== 'All Companies') {
      commaList = user.assignedCompany
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    }
    return Math.max(names.length, ids.length, assignedList.length, commaList.length)
  }, [user])

  const isMultiCompanySupervisor = userRole === 'supervisor' && assignedCompanyCount >= 2
  const canAccessCentralized = isAuditOrFinance || isMultiCompanySupervisor
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoggingOut, setIsLoggingOut] = React.useState(false)
  const [dbCompanyLogoUrl, setDbCompanyLogoUrl] = React.useState<string | null>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  // Fetch company profile image from the database
  React.useEffect(() => {
    let isMounted = true
    const fetchCompanyProfileImage = async () => {
      if (!user) {
        if (isMounted) setDbCompanyLogoUrl(null)
        return
      }
      try {
        const companies = await employeeService.getCompanies()
        if (!isMounted || !Array.isArray(companies)) return

        const targetCompanyName =
          activeCompany && activeCompany !== 'All Companies'
            ? activeCompany
            : user.assignedCompany || null

        const matchedCompany = companies.find((comp) => {
          if (targetCompanyName && isCompanyMatch(comp.name, targetCompanyName)) {
            return true
          }
          if (user.assignedCompany && isCompanyMatch(comp.name, user.assignedCompany)) {
            return true
          }
          return false
        })

        if (isMounted) {
          setDbCompanyLogoUrl(matchedCompany?.logoUrl || null)
        }
      } catch {
        if (isMounted) setDbCompanyLogoUrl(null)
      }
    }

    fetchCompanyProfileImage()
    return () => {
      isMounted = false
    }
  }, [user, activeCompany])

  // Close on outside click or Escape
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleLogout = async () => {
    if (isLoggingOut) return
    try {
      setIsLoggingOut(true)
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  const initials = (() => {
    if (!user?.fullName) return 'U'
    const parts = user.fullName.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  })()

  const avatarSrc =
    dbCompanyLogoUrl ||
    user?.avatarUrl ||
    (typeof window !== 'undefined' ? localStorage.getItem('mct_user_avatar') : null)

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2.5 p-1 sm:px-2.5 sm:py-1 rounded-full sm:rounded-xl hover:bg-surface border border-transparent sm:hover:border-stroke/30 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="User Account Menu"
      >
        <Avatar className="h-8 w-8 sm:h-9 sm:w-9 border border-primary/30 bg-white shrink-0 shadow-2xs overflow-hidden">
          {avatarSrc && (
            <AvatarImage
              src={avatarSrc}
              alt={user?.fullName || 'User'}
              className={cn(
                dbCompanyLogoUrl ? 'object-cover w-full h-full' : 'p-0.5 object-contain'
              )}
            />
          )}
          <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="hidden sm:flex flex-col items-start text-left shrink-0">
          <span className="text-xs sm:text-sm font-semibold text-focus whitespace-nowrap leading-tight">
            {user?.fullName || 'User'}
          </span>
          <span className="text-[10px] text-muted-fg font-medium whitespace-nowrap leading-tight">
            {user?.role || 'Member'}
          </span>
        </div>

        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-fg transition-transform duration-200 hidden sm:block',
            isOpen && 'rotate-180 text-focus'
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 sm:w-72 bg-white rounded-2xl border border-stroke/30 shadow-xl py-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Header row */}
          <div className="px-4 py-2.5 border-b border-stroke/20">
            <p className="text-xs font-bold text-focus break-words leading-tight">
              {user?.fullName || 'User'}
            </p>
            <p className="text-[11px] text-muted-fg truncate mt-0.5 font-normal">
              {user?.email || 'user@mctgroup.com'}
            </p>
            <span className="inline-block mt-1.5 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {user?.role || 'Member'}
            </span>
          </div>

          {/* Options */}
          <div className="p-1.5 space-y-0.5">
            {canAccessCentralized && (
              <Link
                to="/centralized-auth"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-[#960C01] bg-[#960C01]/5 hover:bg-[#960C01]/10 transition-colors cursor-pointer"
              >
                <Building2 className="h-4 w-4 text-[#960C01] shrink-0" />
                <span>Choose Company</span>
              </Link>
            )}

            <Link
              to="/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-focus hover:bg-surface transition-colors cursor-pointer"
            >
              <Settings className="h-4 w-4 text-muted-fg shrink-0" />
              <span>Settings</span>
            </Link>

            <div className="h-px bg-stroke/20 my-1" />

            <button
              type="button"
              disabled={isLoggingOut}
              onClick={handleLogout}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50 text-left"
            >
              {isLoggingOut ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0 text-rose-600" />
              ) : (
                <LogOut className="h-4 w-4 shrink-0 text-rose-600" />
              )}
              <span>Log Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
