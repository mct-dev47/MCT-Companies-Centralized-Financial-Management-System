import * as React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Search,
  ArrowRight,
  LayoutGrid,
  List as ListIcon,
  X,
  Settings,
  LogOut,
  ChevronDown,
  Loader2,
  ShieldCheck,
  UserCheck,
  Building2,
  MapPin,
  RefreshCw,
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { type AuthorizedCompany, getCompanyInitials } from '@/config/centralizedCompanies'
import { employeeService } from '@/services/employeeService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import logo2Url from '@/assets/LOGO2.png'
import mct2Url from '@/assets/MCT2.png'

type ViewMode = 'grid' | 'list'

export const CentralizedAuthPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, signOut } = useSession()
  const { setActiveCompany } = useCompany()

  // State management
  const [companies, setCompanies] = React.useState<AuthorizedCompany[]>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(true)
  const [error, setError] = React.useState<string | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid')
  const [isUserMenuOpen, setIsUserMenuOpen] = React.useState(false)
  const [isLoggingOut, setIsLoggingOut] = React.useState(false)

  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const userMenuRef = React.useRef<HTMLDivElement>(null)

  // Admin is strictly restricted to Employee / User / Activity Log
  React.useEffect(() => {
    if (user) {
      const role = (user.role || '').toLowerCase()
      if (role === 'admin') {
        navigate('/employee', { replace: true })
      }
    }
  }, [user, navigate])

  // Document Title
  React.useEffect(() => {
    document.title = 'Choose Company - Centralized Finance Hub - MCT'
  }, [])

  // Fetch authorized companies from the database
  const loadAuthorizedCompanies = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await employeeService.getAuthorizedCompanies()
      // Filter to assigned companies if the user has specific assigned companies
      const userAssignedNames = user?.companyNames || []
      const userAssignedIds = user?.companyIds || []
      if (userAssignedNames.length > 0 || userAssignedIds.length > 0) {
        const filtered = data.filter((comp) => {
          const idMatch = userAssignedIds.some((cid) => String(cid) === String(comp.id))
          const nameMatch = userAssignedNames.some((cname) => cname.toLowerCase() === comp.name.toLowerCase())
          return idMatch || nameMatch
        })
        setCompanies(filtered)
      } else {
        setCompanies(data)
      }
    } catch (err: any) {
      console.error('Failed to load authorized companies:', err)
      setError(formatUserFriendlyErrorMessage(err, 'Failed to retrieve companies from database.'))
    } finally {
      setIsLoading(false)
    }
  }, [user?.companyNames, user?.companyIds])

  React.useEffect(() => {
    void loadAuthorizedCompanies()
  }, [loadAuthorizedCompanies])

  // Keyboard shortcut: '/' or 'Ctrl+K' focuses search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) &&
        document.activeElement !== searchInputRef.current
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close user menu on outside click or Escape
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsUserMenuOpen(false)
    }
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isUserMenuOpen])

  // Handle select company & open account
  const handleSelectCompany = (company: AuthorizedCompany) => {
    setActiveCompany(company.name)
    navigate('/dashboard')
  }

  // Handle open consolidated "All Companies" account (Finance / Auditor only)
  const handleSelectAllCompanies = () => {
    setActiveCompany('All Companies')
    navigate('/dashboard')
  }

  // Handle logout
  const handleLogout = async () => {
    if (isLoggingOut) return
    try {
      setIsLoggingOut(true)
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  // Filter & Search logic for Database Companies
  const filteredCompanies = React.useMemo(() => {
    if (!searchQuery.trim()) return companies
    const q = searchQuery.toLowerCase().trim()
    return companies.filter((company) => {
      const matchesName = company.name.toLowerCase().includes(q)
      const matchesLocation = company.location ? company.location.toLowerCase().includes(q) : false
      const matchesContact = company.contact_number ? company.contact_number.includes(q) : false
      const matchesRole = company.role.toLowerCase().includes(q)
      return matchesName || matchesLocation || matchesContact || matchesRole
    })
  }, [companies, searchQuery])

  // User initials
  const userInitials = React.useMemo(() => {
    if (!user?.fullName) return 'FO'
    const parts = user.fullName.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }, [user?.fullName])

  return (
    <div className="min-h-screen w-full bg-[#FAFAFA] text-focus flex flex-col font-sans select-none">
      {/* Top Header: Company logo on left, User profile dropdown on right */}
      <header className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-md border-b border-stroke/20 px-4 sm:px-8 py-3 transition-all select-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Company Logo on Left Side */}
          <div className="flex items-center gap-2.5">
            <img
              src={logo2Url}
              alt="MCT Logo"
              className="h-8 sm:h-9 w-auto object-contain shrink-0"
            />
            <div className="flex flex-col justify-center items-start">
              <img
                src={mct2Url}
                alt="MCT"
                className="h-3.5 sm:h-4 w-auto object-contain object-left block"
              />
              <span className="text-[10px] font-semibold text-muted-fg leading-none mt-0.5 tracking-tight">
                Group of Companies
              </span>
            </div>
          </div>

          {/* Right: User Profile Dropdown */}
          <div ref={userMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 sm:gap-2.5 p-1 sm:px-2.5 sm:py-1.5 rounded-full sm:rounded-xl hover:bg-surface border border-transparent sm:hover:border-stroke/30 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-expanded={isUserMenuOpen}
              aria-haspopup="true"
              aria-label="User Menu"
            >
              <Avatar className="h-8 w-8 sm:h-9 sm:w-9 border-2 border-primary/30 bg-white shrink-0 shadow-2xs">
                {user?.avatarUrl && (
                  <AvatarImage
                    src={user.avatarUrl}
                    alt={user.fullName}
                    className="p-0.5 object-contain"
                  />
                )}
                <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                  {userInitials}
                </AvatarFallback>
              </Avatar>

              <div className="hidden sm:flex flex-col items-start min-w-0 text-left">
                <span className="text-xs sm:text-sm font-bold text-focus truncate max-w-[140px] leading-tight">
                  {user?.fullName || 'Financial User'}
                </span>
                <span className="text-[10px] text-muted-fg font-semibold uppercase tracking-wider truncate leading-tight mt-0.5">
                  {user?.role || 'Finance'}
                </span>
              </div>

              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-fg transition-transform duration-200 hidden sm:block',
                  isUserMenuOpen && 'rotate-180 text-focus'
                )}
              />
            </button>

            {/* User Dropdown */}
            {isUserMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-stroke/30 shadow-xl py-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                {/* Account Header */}
                <div className="px-4 py-2.5 border-b border-stroke/20">
                  <p className="text-xs font-bold text-focus truncate leading-tight">
                    {user?.fullName || 'Financial User'}
                  </p>
                  <p className="text-[11px] text-muted-fg truncate mt-0.5 font-normal">
                    {user?.email || ''}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      <ShieldCheck className="h-3 w-3" />
                      {user?.role || 'Finance'}
                    </span>
                    <span className="text-[10px] text-muted-fg">Database Authorized</span>
                  </div>
                </div>

                {/* Options */}
                <div className="p-1.5 space-y-0.5">
                  {/* Consolidated overview (Finance / Audit only) */}
                  {(user?.role || '').toLowerCase() !== 'supervisor' && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false)
                        handleSelectAllCompanies()
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-focus hover:bg-surface transition-colors cursor-pointer text-left"
                    >
                      <UserCheck className="h-4 w-4 text-muted-fg shrink-0" />
                      <span>My Account (All Companies)</span>
                    </button>
                  )}

                  <Link
                    to="/settings"
                    onClick={() => setIsUserMenuOpen(false)}
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
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-6">
        {/* Page Title Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111827] tracking-tight">
              Choose company
            </h1>
            <p className="text-xs sm:text-sm text-muted-fg font-medium mt-0.5">
              {isLoading
                ? 'Loading authorized companies...'
                : `You have access to ${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`}
            </p>
          </div>

          {/* Search Bar + Grid / List View Toggle */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 sm:flex-none sm:w-72 md:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search company or location..."
                className="w-full h-10 pl-10 pr-10 text-xs sm:text-sm rounded-xl bg-white border border-stroke/30 focus:border-primary/80 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-focus placeholder:text-muted-fg shadow-2xs"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-fg hover:text-focus rounded-md transition-colors cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex items-center gap-0.5 absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-muted-fg/80 bg-gray-50 border border-stroke/30 rounded shadow-2xs pointer-events-none">
                  /
                </kbd>
              )}
            </div>

            {/* Grid / List View Toggle */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-xl border border-gray-200/70 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                  viewMode === 'grid'
                    ? 'bg-gray-900 text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                )}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Grid</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                  viewMode === 'list'
                    ? 'bg-gray-900 text-white shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                )}
                aria-label="List view"
              >
                <ListIcon className="h-3.5 w-3.5" />
                <span>List</span>
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white rounded-2xl border border-gray-200/80 p-12 text-center space-y-3 shadow-xs">
            <Loader2 className="h-8 w-8 animate-spin text-[#960C01] mx-auto" />
            <p className="text-sm font-semibold text-gray-700">Loading authorized companies from database...</p>
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center space-y-3">
            <p className="text-sm font-semibold text-rose-800">{error}</p>
            <button
              type="button"
              onClick={loadAuthorizedCompanies}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Content Directory */}
        {!isLoading && !error && (
          <>
            {filteredCompanies.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200/80 p-12 text-center space-y-3 shadow-xs">
                <div className="h-12 w-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                  <Building2 className="h-6 w-6" />
                </div>
                <h3 className="font-bold text-gray-900 text-base">
                  {searchQuery ? 'No companies found' : 'No companies assigned'}
                </h3>
                <p className="text-xs sm:text-sm text-gray-500 max-w-sm mx-auto">
                  {searchQuery
                    ? `No companies match your search "${searchQuery}". Try another keyword.`
                    : 'There are no companies assigned to your account. Please contact an administrator.'}
                </p>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold text-[#960C01] bg-[#960C01]/10 hover:bg-[#960C01]/20 transition-colors cursor-pointer"
                  >
                    Reset search
                  </button>
                )}
              </div>
            ) : viewMode === 'grid' ? (
              /* Grid View */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCompanies.map((company) => {
                  const initials = getCompanyInitials(company.name)
                  return (
                    <div
                      key={company.id}
                      onClick={() => handleSelectCompany(company)}
                      className="bg-white rounded-2xl border border-gray-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md hover:border-[#960C01]/40 transition-all cursor-pointer flex items-center justify-between gap-3 group relative"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Initials or Logo Avatar */}
                        <Avatar className="h-11 w-11 sm:h-12 sm:w-12 rounded-full border-2 border-[#960C01] bg-white shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                          {company.logo_url && (
                            <AvatarImage
                              src={company.logo_url}
                              alt={company.name}
                              className="p-1 object-contain"
                            />
                          )}
                          <AvatarFallback className="bg-white text-[#960C01] font-bold text-sm sm:text-base">
                            {initials}
                          </AvatarFallback>
                        </Avatar>

                        {/* Info from Database */}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-sm sm:text-base text-gray-900 group-hover:text-[#960C01] transition-colors leading-snug break-words">
                            {company.name}
                          </h3>
                          <p className="text-xs text-gray-400 font-medium mt-0.5">
                            {company.role}
                          </p>
                          {company.location && (
                            <p className="text-[11px] text-gray-500 truncate mt-1 flex items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0 text-gray-400" />
                              <span>{company.location}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Arrow Action indicator */}
                      <div className="p-2 rounded-lg text-[#960C01] opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all shrink-0">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* List View */
              <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs divide-y divide-gray-100 overflow-hidden">
                {filteredCompanies.map((company) => {
                  const initials = getCompanyInitials(company.name)
                  return (
                    <div
                      key={company.id}
                      onClick={() => handleSelectCompany(company)}
                      className="p-4 sm:px-6 hover:bg-gray-50/80 transition-colors cursor-pointer flex items-center justify-between gap-4 group"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        {/* Initials or Logo Avatar */}
                        <Avatar className="h-10 w-10 rounded-full border-2 border-[#960C01] bg-white shrink-0 shadow-2xs">
                          {company.logo_url && (
                            <AvatarImage
                              src={company.logo_url}
                              alt={company.name}
                              className="p-1 object-contain"
                            />
                          )}
                          <AvatarFallback className="bg-white text-[#960C01] font-bold text-sm">
                            {initials}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-sm sm:text-base text-gray-900 group-hover:text-[#960C01] transition-colors leading-snug break-words">
                            {company.name}
                          </h3>
                          <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                            <span>{company.role}</span>
                            {company.location && (
                              <>
                                <span>·</span>
                                <span className="truncate">{company.location}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="p-1 text-[#960C01] opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                          <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default CentralizedAuthPage
