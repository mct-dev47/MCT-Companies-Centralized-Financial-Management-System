import * as React from 'react'
import {
  Search,
  UserPlus,
  X,
  Building2,
  Shield,
  User as UserIcon,
  ArrowUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmModal, ErrorBanner } from '@/components/common'
import { DropdownFilter, type DropdownFilterOption } from '@/components/common/DropdownFilter'
import { CreateUserModal } from '@/components/employee/CreateUserModal'
import { ViewUserModal } from '@/components/employee/ViewUserModal'
import {
  employeeService,
  type EmployeeUser,
  type Company,
} from '@/services/employeeService'
import {
  formatUserFriendlyErrorMessage,
  notifySuccess,
} from '@/utils/errorUtils'

type SortOption = 'recent' | 'asc' | 'desc'

const SORT_OPTIONS: DropdownFilterOption<SortOption>[] = [
  { value: 'recent', label: 'Recently Added' },
  { value: 'asc', label: 'A-Z' },
  { value: 'desc', label: 'Z-A' },
]

export const UserManagementPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sortBy, setSortBy] = React.useState<SortOption>('recent')

  // Users & Companies data state
  const [users, setUsers] = React.useState<EmployeeUser[]>([])
  const [companies, setCompanies] = React.useState<Company[]>([])
  const [loading, setLoading] = React.useState(true)

  // Modals state
  const [isCreateUserOpen, setIsCreateUserOpen] = React.useState(false)
  const [isViewUserOpen, setIsViewUserOpen] = React.useState(false)
  const [selectedUser, setSelectedUser] = React.useState<EmployeeUser | null>(null)

  // Success message toast/banner & confirmation modal
  const [successBanner, setSuccessBanner] = React.useState<string | null>(null)
  const [successModal, setSuccessModal] = React.useState<{ title: string; message: React.ReactNode } | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  // Load users and companies
  const loadData = React.useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const [userList, companyList] = await Promise.all([
        employeeService.getUsers(),
        employeeService.getCompanies(),
      ])
      setUsers(userList)
      setCompanies(companyList)
    } catch (err) {
      setLoadError(
        formatUserFriendlyErrorMessage(
          err,
          'Unable to load user management data. Please try again.'
        )
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  // Clear banner after 4 seconds
  React.useEffect(() => {
    if (successBanner) {
      const timer = setTimeout(() => setSuccessBanner(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [successBanner])

  // Dynamic document title
  React.useEffect(() => {
    document.title = 'User Management - MCT Centralized Financial System'
  }, [])

  // Filtered and sorted users
  const filteredUsers = React.useMemo(() => {
    let result = [...users]
    const q = searchQuery.toLowerCase().trim()
    if (q) {
      result = result.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.companyName && u.companyName.toLowerCase().includes(q)) ||
          (u.companyNames && u.companyNames.some((c) => c.toLowerCase().includes(q))) ||
          (u.role && u.role.toLowerCase().includes(q))
      )
    }
    return result.sort((a, b) => {
      if (sortBy === 'asc') {
        return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base', numeric: true })
      }
      if (sortBy === 'desc') {
        return b.fullName.localeCompare(a.fullName, undefined, { sensitivity: 'base', numeric: true })
      }
      // 'recent': newest created first
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
        return timeB - timeA
      }
      return Number(b.id) - Number(a.id)
    })
  }, [users, searchQuery, sortBy])

  const handleCardClickUser = (usr: EmployeeUser) => {
    setSelectedUser(usr)
    setIsViewUserOpen(true)
  }

  const handleUserCreated = async (newUser: EmployeeUser) => {
    setUsers((prev) => [newUser, ...prev])
    const msg = `User "${newUser.fullName}" has been created successfully.`
    setSuccessBanner(msg)
    notifySuccess(msg)

    const assigned = (newUser.companyNames && newUser.companyNames.length > 0)
      ? newUser.companyNames
      : (newUser.companyName ? [newUser.companyName] : [])

    setSuccessModal({
      title: 'User Created Successfully',
      message: (
        <span className="block space-y-2.5">
          <span>
            User <strong className="text-focus">{newUser.fullName}</strong> has been created successfully appointed as{' '}
            <strong className="text-focus">{newUser.role || 'Supervisor'}</strong>.
          </span>
          {assigned.length > 0 && (
            <span className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              {assigned.map((cName) => (
                <span
                  key={cName}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-focus border border-slate-200/80 shadow-2xs"
                >
                  <Building2 className="h-3 w-3 text-muted-fg shrink-0" />
                  <span>{cName}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      ),
    })
    try {
      const [userList, companyList] = await Promise.all([
        employeeService.getUsers(),
        employeeService.getCompanies(),
      ])
      setUsers(userList)
      setCompanies(companyList)
    } catch (e) {
      console.warn('Background reload failed:', e)
    }
  }

  const handleUserUpdated = async (updated: EmployeeUser) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === updated.id ? updated : u))
    )
    setSelectedUser(updated)
    const msg = `User "${updated.fullName}" updated successfully.`
    setSuccessBanner(msg)
    notifySuccess(msg)

    const assigned = (updated.companyNames && updated.companyNames.length > 0)
      ? updated.companyNames
      : (updated.companyName ? [updated.companyName] : [])

    setSuccessModal({
      title: 'User Updated Successfully',
      message: (
        <span className="block space-y-2.5">
          <span>
            The user profile for <strong className="text-focus">{updated.fullName}</strong> has been updated successfully.
          </span>
          {assigned.length > 0 && (
            <span className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              {assigned.map((cName) => (
                <span
                  key={cName}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-100 text-focus border border-slate-200/80 shadow-2xs"
                >
                  <Building2 className="h-3 w-3 text-muted-fg shrink-0" />
                  <span>{cName}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      ),
    })
    try {
      const [userList, companyList] = await Promise.all([
        employeeService.getUsers(),
        employeeService.getCompanies(),
      ])
      setUsers(userList)
      setCompanies(companyList)
    } catch (e) {
      console.warn('Background reload failed:', e)
    }
  }

  const handleUserDeleted = async (userId: string) => {
    const deletedName = users.find((u) => u.id === userId)?.fullName || 'User'
    setUsers((prev) => prev.filter((u) => u.id !== userId))
    const msg = `"${deletedName}" has been removed from users.`
    setSuccessBanner(msg)
    notifySuccess(msg)
    setSuccessModal({
      title: 'User Deleted',
      message: `"${deletedName}" has been removed from users successfully.`,
    })
    try {
      const [userList, companyList] = await Promise.all([
        employeeService.getUsers(),
        employeeService.getCompanies(),
      ])
      setUsers(userList)
      setCompanies(companyList)
    } catch (e) {
      console.warn('Background reload failed:', e)
    }
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300">
      {/* Top Header Block */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
            User Management
          </h1>
          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
            {users.length} users registered in MCT Group
          </p>
        </div>

        {/* Top Right Action Button: Create User */}
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <Button
            type="button"
            onClick={() => setIsCreateUserOpen(true)}
            className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer"
          >
            <UserPlus className="h-4 w-4 shrink-0" />
            <span>Create User</span>
          </Button>
        </div>
      </div>

      {/* Success Notification Alert */}
      <ErrorBanner
        variant="success"
        message={successBanner}
        onDismiss={() => setSuccessBanner(null)}
      />

      {/* Error Notification Alert */}
      <ErrorBanner
        message={loadError}
        onRetry={() => void loadData()}
        isRetrying={loading}
      />

      {/* Filters Toolbar - Search bar and Sort Filter */}
      <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
          <Input
            type="text"
            placeholder="Search users by name, email, company, or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 sm:h-12 pl-11 pr-10 rounded-2xl border border-stroke/50 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-2 focus-visible:ring-focus w-full transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-1 rounded-full cursor-pointer transition-colors"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <DropdownFilter
            value={sortBy}
            options={SORT_OPTIONS}
            onChange={(val) => setSortBy(val as SortOption)}
            icon={ArrowUpDown}
            menuTitle="Sort By"
            className="h-11 sm:h-12 rounded-2xl bg-white border border-stroke/50 shadow-xs"
            ariaLabel="Sort users"
          />
        </div>
      </div>

      {/* User Grid */}
      <div className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-2xl border border-rose-200/60 p-4 sm:p-5 flex items-center gap-4 shadow-xs"
              >
                <Skeleton className="h-16 w-16 sm:h-20 sm:w-20 rounded-full shrink-0" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <Skeleton className="h-5 w-3/4 rounded-md" />
                  <Skeleton className="h-3.5 w-full rounded-md" />
                  <Skeleton className="h-3.5 w-2/3 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stroke/30 p-12 text-center text-muted-fg text-sm">
            No users found matching your search.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredUsers.map((usr) => {
              const initials = usr.fullName
                .split(' ')
                .map((n) => n[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()

              const roleDisplay = usr.role || (usr.isAdmin ? 'Admin' : 'Supervisor')

              return (
                <div
                  key={usr.id}
                  onClick={() => handleCardClickUser(usr)}
                  className="bg-white rounded-2xl border border-rose-200/90 hover:border-primary/80 hover:shadow-md p-4 sm:p-5 transition-all duration-200 cursor-pointer flex items-center gap-4 group shadow-xs select-none"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleCardClickUser(usr)
                    }
                  }}
                  aria-label={`View details for ${usr.fullName}`}
                >
                  {/* Left circular badge */}
                  <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full border-2 border-primary/90 flex items-center justify-center shrink-0 bg-red-50 text-primary font-bold text-lg sm:text-xl shadow-xs group-hover:scale-105 transition-transform duration-200 overflow-hidden">
                    {usr.avatarUrl ? (
                      <img
                        src={usr.avatarUrl}
                        alt={usr.fullName}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                          if (e.currentTarget.parentElement) {
                            e.currentTarget.parentElement.innerText = initials || 'U'
                          }
                        }}
                      />
                    ) : (
                      initials || <UserIcon className="h-7 w-7 text-primary" />
                    )}
                  </div>

                  {/* Right side: User Name, Email, Badges */}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base sm:text-lg font-bold text-focus transition-colors truncate">
                      {usr.fullName}
                    </h3>
                    <p className="text-xs text-muted-fg truncate mt-0.5">
                      {usr.email}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-focus/90 border border-slate-200/60 max-w-[150px] truncate"
                        title={usr.companyNames && usr.companyNames.length > 0 ? usr.companyNames.join(', ') : (usr.companyName || 'MCT Group')}
                      >
                        <Building2 className="h-3 w-3 text-muted-fg shrink-0" />
                        <span className="truncate">
                          {usr.companyNames && usr.companyNames.length > 1
                            ? `${usr.companyNames.length} Companies`
                            : (usr.companyNames?.[0] || usr.companyName || 'MCT Group')}
                        </span>
                      </span>

                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                        <Shield className="h-3 w-3 text-primary shrink-0" />
                        <span>{roleDisplay}</span>
                      </span>

                      {(usr.isProtected || usr.isAdmin || usr.id === '1' || usr.role?.toLowerCase() === 'admin') && (
                        <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          Protected
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateUserModal
        open={isCreateUserOpen}
        onOpenChange={setIsCreateUserOpen}
        companies={companies}
        onSuccess={handleUserCreated}
      />

      <ViewUserModal
        open={isViewUserOpen}
        onOpenChange={setIsViewUserOpen}
        user={selectedUser}
        companies={companies}
        onUpdate={handleUserUpdated}
        onDelete={handleUserDeleted}
      />

      <ConfirmModal
        open={!!successModal}
        onOpenChange={(open) => !open && setSuccessModal(null)}
        title={successModal?.title || 'Success'}
        description={successModal?.message || ''}
        confirmLabel="OK"
        cancelLabel=""
        actionType="default"
        variant="primary"
        onConfirm={() => setSuccessModal(null)}
      />
    </div>
  )
}
