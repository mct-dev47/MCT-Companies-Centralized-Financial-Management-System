import * as React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Search,
  Star,
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
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import {
  CENTRALIZED_COMPANIES,
  type CentralizedCompany,
  getStoredPinnedIds,
  saveStoredPinnedIds,
  getLastOpenedCompany,
  saveLastOpenedCompany,
} from '@/config/centralizedCompanies'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import logo2Url from '@/assets/LOGO2.png'
import mct2Url from '@/assets/MCT2.png'

type FilterTab = 'all' | 'needs_attention' | 'open' | 'closed'
type ViewMode = 'grid' | 'list'

export const CentralizedAuthPage: React.FC = () => {
  const navigate = useNavigate()
  const { user, signOut } = useSession()
  const { setActiveCompany } = useCompany()

  // State management
  const [searchQuery, setSearchQuery] = React.useState('')
  const [activeTab, setActiveTab] = React.useState<FilterTab>('all')
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid')
  const [pinnedIds, setPinnedIds] = React.useState<string[]>(getStoredPinnedIds)
  const [lastOpened, setLastOpened] = React.useState(getLastOpenedCompany)
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

  // Keyboard shortcut: '/' or 'Ctrl+K' focuses search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && document.activeElement !== searchInputRef.current) {
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

  // Toggle pin
  const handleTogglePin = (companyId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setPinnedIds((prev) => {
      const next = prev.includes(companyId)
        ? prev.filter((id) => id !== companyId)
        : [...prev, companyId]
      saveStoredPinnedIds(next)
      return next
    })
  }

  // Handle select company & open account
  const handleSelectCompany = (company: CentralizedCompany) => {
    const targetSystemName = company.systemCompanyName || company.name
    setActiveCompany(targetSystemName)

    const now = new Date()
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const updatedLastOpened = {
      companyId: company.id,
      companyName: company.name,
      systemName: targetSystemName,
      timestamp: `last opened today, ${timeStr}`,
    }
    setLastOpened(updatedLastOpened)
    saveLastOpenedCompany(updatedLastOpened)

    // Navigate to the company's financial dashboard
    navigate('/dashboard')
  }

  // Handle continue where left off
  const handleContinueLastOpened = () => {
    const matched = CENTRALIZED_COMPANIES.find((c) => c.id === lastOpened.companyId)
    if (matched) {
      handleSelectCompany(matched)
    } else {
      setActiveCompany(lastOpened.systemName || 'MCT Hotel')
      navigate('/dashboard')
    }
  }

  // Handle open consolidated "All Companies" account
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

  // Companies authorized for the current user
  const userAllowedCompanies = React.useMemo(() => {
    const role = (user?.role || '').toLowerCase()
    if (role === 'finance' || role === 'audit' || role === 'auditor') {
      return CENTRALIZED_COMPANIES
    }
    if (role === 'supervisor') {
      const assignedNames = new Set([
        ...(user?.companyNames || []).map((n) => n.trim().toLowerCase()),
        ...(user?.assignedCompany && user.assignedCompany.toLowerCase() !== 'all companies' ? [user.assignedCompany.trim().toLowerCase()] : []),
      ])
      if (assignedNames.size === 0) return []
      return CENTRALIZED_COMPANIES.filter((c) => {
        const sys = c.systemCompanyName.toLowerCase()
        const name = c.name.toLowerCase()
        for (const assigned of assignedNames) {
          if (sys.includes(assigned) || assigned.includes(sys) || name.includes(assigned) || assigned.includes(name)) {
            return true
          }
        }
        return false
      })
    }
    return CENTRALIZED_COMPANIES
  }, [user])

  // Pinned companies list
  const pinnedCompanies = React.useMemo(() => {
    const pinned = userAllowedCompanies.filter((c) => pinnedIds.includes(c.id))
    if (!searchQuery.trim()) return pinned
    const q = searchQuery.toLowerCase().trim()
    return pinned.filter(
      (company) =>
        company.name.toLowerCase().includes(q) ||
        company.systemCompanyName.toLowerCase().includes(q) ||
        company.code.toLowerCase().includes(q) ||
        company.initials.toLowerCase().includes(q) ||
        company.role.toLowerCase().includes(q)
    )
  }, [pinnedIds, searchQuery])

  // Filter & Search logic for All Companies
  const filteredCompanies = React.useMemo(() => {
    return userAllowedCompanies.filter((company) => {
      // Tab filter
      if (activeTab === 'needs_attention') {
        if (!company.needsAttention && company.status.type !== 'overdue' && company.status.type !== 'pending') {
          return false
        }
      } else if (activeTab === 'open') {
        if (company.status.type !== 'open') return false
      } else if (activeTab === 'closed') {
        if (company.status.type !== 'closed' && company.status.type !== 'suspended') return false
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = company.name.toLowerCase().includes(q)
        const matchesSystemName = company.systemCompanyName.toLowerCase().includes(q)
        const matchesCode = company.code.toLowerCase().includes(q)
        const matchesInitials = company.initials.toLowerCase().includes(q)
        const matchesRole = company.role.toLowerCase().includes(q)
        const matchesStatus = company.status.label.toLowerCase().includes(q)
        return matchesName || matchesSystemName || matchesCode || matchesInitials || matchesRole || matchesStatus
      }

      return true
    })
  }, [activeTab, searchQuery])

  // Total count of attention items
  const attentionCount = React.useMemo(() => {
    return userAllowedCompanies.filter((c) => c.needsAttention || c.status.type === 'overdue' || c.status.type === 'pending').length
  }, [])

  // User initials
  const userInitials = (() => {
    if (!user?.fullName) return 'FO'
    const parts = user.fullName.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  })()

  // Status Badge Helper
  const renderStatusBadge = (status: CentralizedCompany['status']) => {
    switch (status.variant) {
      case 'amber':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200/60">
            {status.label}
          </span>
        )
      case 'emerald':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/60">
            {status.label}
          </span>
        )
      case 'rose':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200/60">
            {status.label}
          </span>
        )
      case 'slate':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/70">
            {status.label}
          </span>
        )
      case 'muted':
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 border border-stone-200/70">
            {status.label}
          </span>
        )
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#FAFAFA] text-focus flex flex-col font-sans select-none">
      {/* Top Header: Company logo on left, Finance profile dropdown on right */}
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
                className="h-4 sm:h-4.5 w-auto object-contain object-left block"
              />
              <span className="text-[10px] font-semibold text-muted-fg leading-none mt-0.5 tracking-tight">
                Group of Companies
              </span>
            </div>
          </div>

          {/* Right: Finance User with Dropdown */}
          <div ref={userMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 sm:gap-2.5 p-1 sm:px-2.5 sm:py-1.5 rounded-full sm:rounded-xl hover:bg-surface border border-transparent sm:hover:border-stroke/30 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-expanded={isUserMenuOpen}
              aria-haspopup="true"
              aria-label="Finance User Menu"
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
                  {user?.fullName || 'Finance Officer'}
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

            {/* User Dropdown with Settings & Logout */}
            {isUserMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl border border-stroke/30 shadow-xl py-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                {/* Account Header */}
                <div className="px-4 py-2.5 border-b border-stroke/20">
                  <p className="text-xs font-bold text-focus truncate leading-tight">
                    {user?.fullName || 'Finance Officer'}
                  </p>
                  <p className="text-[11px] text-muted-fg truncate mt-0.5 font-normal">
                    {user?.email || 'finance@mct.com'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      <ShieldCheck className="h-3 w-3" />
                      {user?.role || 'Finance'}
                    </span>
                    <span className="text-[10px] text-muted-fg">Centralized Access</span>
                  </div>
                </div>

                {/* Options */}
                <div className="p-1.5 space-y-0.5">
                  {/* Go to own account / consolidated overview (Finance/Audit only) */}
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-8">
        {/* Page Title Row */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111827] tracking-tight">
            Choose company
          </h1>
          <p className="text-xs sm:text-sm text-muted-fg font-medium mt-0.5">
            You have access to {userAllowedCompanies.length} companies
          </p>
        </div>
        {/* Banner: Continue where you left off */}
        {userAllowedCompanies.some((c) => c.id === lastOpened.companyId) && (
        <section
          aria-label="Continue where you left off"
          className="bg-white rounded-2xl border border-gray-200/80 shadow-xs p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-all hover:shadow-sm"
        >
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
              Continue where you left off
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 font-medium">
              <span className="font-semibold text-gray-700">{lastOpened.companyName}</span>
              {' · '}
              <span>{lastOpened.timestamp}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={handleContinueLastOpened}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-sm hover:shadow-md transition-all cursor-pointer shrink-0 group"
          >
            <span>
              Continue to {lastOpened.companyName.replace(/Business Corp\.?|Corp\.?|Inc\.?|Foundation, Inc\./gi, '').trim()}
            </span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </section>
        )}

        {/* Section: PINNED AND RECENT */}
        {pinnedCompanies.length > 0 && (
          <section aria-label="Pinned and recent companies" className="space-y-3.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              PINNED AND RECENT
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pinnedCompanies.map((company) => {
                const isPinned = pinnedIds.includes(company.id)
                return (
                  <div
                    key={company.id}
                    onClick={() => handleSelectCompany(company)}
                    className="bg-white rounded-2xl border border-gray-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md hover:border-[#960C01]/40 transition-all cursor-pointer flex items-center justify-between gap-3 group relative"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Initials Avatar */}
                      <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full border-2 border-[#960C01] bg-white text-[#960C01] font-bold text-sm sm:text-base flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                        {company.initials}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-sm sm:text-base text-gray-900 group-hover:text-[#960C01] transition-colors line-clamp-2 leading-tight">
                          {company.name}
                        </h3>
                        <p className="text-xs text-gray-400 font-medium mt-0.5">
                          {company.role}
                        </p>
                        <div className="mt-1.5">
                          {renderStatusBadge(company.status)}
                        </div>
                      </div>
                    </div>

                    {/* Star Pin Button */}
                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(company.id, e)}
                      title={isPinned ? 'Unpin company' : 'Pin company'}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-gray-50 transition-colors shrink-0"
                    >
                      <Star
                        className={cn(
                          'h-4 w-4',
                          isPinned ? 'fill-amber-400 text-amber-500' : 'text-gray-300'
                        )}
                      />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Filter Pills Bar */}
        <section aria-label="Company filter options" className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs',
              activeTab === 'all'
                ? 'bg-[#960C01] text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200/80 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            All {userAllowedCompanies.length}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('needs_attention')}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs',
              activeTab === 'needs_attention'
                ? 'bg-[#960C01] text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200/80 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            Needs attention {attentionCount}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('open')}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs',
              activeTab === 'open'
                ? 'bg-[#960C01] text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200/80 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            Open period
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('closed')}
            className={cn(
              'px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shadow-xs',
              activeTab === 'closed'
                ? 'bg-[#960C01] text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200/80 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            Closed
          </button>
        </section>

        {/* Section: ALL COMPANIES */}
        <section aria-label="All companies directory" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              ALL COMPANIES
            </h2>

            {/* Right Controls: Search Bar + Grid / List View Toggle */}
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Search Input */}
              <div className="relative flex-1 sm:flex-none sm:w-72 md:w-80">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search company or code..."
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

          {/* Companies Cards Container */}
          {filteredCompanies.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200/80 p-12 text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                <Search className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-base">No companies found</h3>
              <p className="text-xs sm:text-sm text-gray-500 max-w-sm mx-auto">
                No companies match your search "{searchQuery}" or selected filter. Try clearing filters or using another keyword.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setActiveTab('all')
                }}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold text-[#960C01] bg-[#960C01]/10 hover:bg-[#960C01]/20 transition-colors"
              >
                Reset filters
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCompanies.map((company) => {
                return (
                  <div
                    key={company.id}
                    onClick={() => handleSelectCompany(company)}
                    className="bg-white rounded-2xl border border-gray-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md hover:border-[#960C01]/40 transition-all cursor-pointer flex items-center justify-between gap-3 group relative"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Initials Avatar */}
                      <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full border-2 border-[#960C01] bg-white text-[#960C01] font-bold text-sm sm:text-base flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                        {company.initials}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-sm sm:text-base text-gray-900 group-hover:text-[#960C01] transition-colors line-clamp-2 leading-tight">
                          {company.name}
                        </h3>
                        <p className="text-xs text-gray-400 font-medium mt-0.5">
                          {company.role}
                        </p>
                        <div className="mt-1.5">
                          {renderStatusBadge(company.status)}
                        </div>
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
                const isPinned = pinnedIds.includes(company.id)
                return (
                  <div
                    key={company.id}
                    onClick={() => handleSelectCompany(company)}
                    className="p-4 sm:px-6 hover:bg-gray-50/80 transition-colors cursor-pointer flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      {/* Initials Avatar */}
                      <div className="h-10 w-10 rounded-full border-2 border-[#960C01] bg-white text-[#960C01] font-bold text-sm flex items-center justify-center shrink-0 shadow-2xs">
                        {company.initials}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm sm:text-base text-gray-900 group-hover:text-[#960C01] transition-colors truncate">
                            {company.name}
                          </h3>
                          <span className="text-[11px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                            {company.code}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {company.role}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      {renderStatusBadge(company.status)}

                      <button
                        type="button"
                        onClick={(e) => handleTogglePin(company.id, e)}
                        title={isPinned ? 'Unpin company' : 'Pin company'}
                        className="p-1 text-gray-300 hover:text-amber-500 transition-colors"
                      >
                        <Star
                          className={cn(
                            'h-4 w-4',
                            isPinned ? 'fill-amber-400 text-amber-500' : 'text-gray-300'
                          )}
                        />
                      </button>

                      <div className="p-1 text-[#960C01] opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
export default CentralizedAuthPage
