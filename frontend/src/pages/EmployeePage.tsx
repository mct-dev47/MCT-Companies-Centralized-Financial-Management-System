import * as React from 'react'
import {
  Search,
  Building2,
  X,
  ArrowUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBanner } from '@/components/common'
import { DropdownFilter, type DropdownFilterOption } from '@/components/common/DropdownFilter'
import { CreateCompanyModal } from '@/components/employee/CreateCompanyModal'
import { ViewCompanyModal } from '@/components/employee/ViewCompanyModal'
import { Skeleton } from '@/components/ui/skeleton'
import {
  employeeService,
  type Company,
} from '@/services/employeeService'
import {
  formatUserFriendlyErrorMessage,
  notifySuccess,
} from '@/utils/errorUtils'
import logo2Url from '@/assets/LOGO2.png'

type SortOption = 'recent' | 'asc' | 'desc'

const SORT_OPTIONS: DropdownFilterOption<SortOption>[] = [
  { value: 'recent', label: 'Recently Added' },
  { value: 'asc', label: 'A-Z' },
  { value: 'desc', label: 'Z-A' },
]

export const EmployeePage: React.FC = () => {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [sortBy, setSortBy] = React.useState<SortOption>('asc')

  // Companies data state
  const [companies, setCompanies] = React.useState<Company[]>([])
  const [loading, setLoading] = React.useState(true)

  // Modals state
  const [isCreateCompanyOpen, setIsCreateCompanyOpen] = React.useState(false)
  const [isViewCompanyOpen, setIsViewCompanyOpen] = React.useState(false)
  const [selectedCompany, setSelectedCompany] = React.useState<Company | null>(null)

  // Success message toast/banner
  const [successBanner, setSuccessBanner] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  // Load companies
  const loadData = React.useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const companyList = await employeeService.getCompanies()
      setCompanies(companyList)
    } catch (err) {
      setLoadError(
        formatUserFriendlyErrorMessage(
          err,
          'Unable to load companies. Please check your connection and try again.'
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
    document.title = 'Company Management - MCT Centralized Financial System'
  }, [])

  // Filtered and sorted companies
  const filteredCompanies = React.useMemo(() => {
    let result = [...companies]

    const q = searchQuery.toLowerCase().trim()
    if (q) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.address && c.address.toLowerCase().includes(q)) ||
          (c.contactNumber && c.contactNumber.toLowerCase().includes(q)) ||
          (c.telephoneNumber && c.telephoneNumber.toLowerCase().includes(q))
      )
    }

    return result.sort((a, b) => {
      if (sortBy === 'asc') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
      }
      if (sortBy === 'desc') {
        return b.name.localeCompare(a.name, undefined, { sensitivity: 'base', numeric: true })
      }
      // 'recent': newest created first
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) {
        return timeB - timeA
      }
      return Number(b.id) - Number(a.id)
    })
  }, [companies, searchQuery, sortBy])

  const handleCardClickCompany = (comp: Company) => {
    setSelectedCompany(comp)
    setIsViewCompanyOpen(true)
  }

  const handleCompanyCreated = async (newCompany: Company) => {
    await loadData()
    const msg = `Company "${newCompany.name}" has been created successfully.`
    setSuccessBanner(msg)
    notifySuccess(msg)
  }

  const handleCompanyUpdated = async (updated: Company) => {
    await loadData()
    setSelectedCompany(updated)
    const msg = `Company "${updated.name}" updated successfully.`
    setSuccessBanner(msg)
    notifySuccess(msg)
  }

  const handleCompanyDeleted = async (companyId: string) => {
    const deletedName = companies.find((c) => c.id === companyId)?.name || 'Company'
    await loadData()
    const msg = `"${deletedName}" has been removed from companies.`
    setSuccessBanner(msg)
    notifySuccess(msg)
  }

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12">
      {/* Top Header Block */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
            Company Management
          </h1>
          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
            {companies.length} companies registered in MCT Group
          </p>
        </div>

        {/* Top Right Action Button: Create Company */}
        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          <Button
            type="button"
            onClick={() => setIsCreateCompanyOpen(true)}
            className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer"
          >
            <Building2 className="h-4 w-4 shrink-0" />
            <span>Create Company</span>
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
            placeholder="Search companies by name, address, or contact number..."
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
            ariaLabel="Sort companies"
          />
        </div>
      </div>

      {/* Company Grid */}
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
        ) : filteredCompanies.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stroke/30 p-12 text-center text-muted-fg text-sm">
            No companies found matching your search.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredCompanies.map((comp) => (
              <div
                key={comp.id}
                onClick={() => handleCardClickCompany(comp)}
                className="bg-white rounded-2xl border border-rose-200/90 hover:border-primary/80 hover:shadow-md p-4 sm:p-5 transition-all duration-200 cursor-pointer flex items-center gap-4 group shadow-xs select-none"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleCardClickCompany(comp)
                  }
                }}
                aria-label={`View details for ${comp.name}`}
              >
                {/* Left circular badge */}
                <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full border-2 border-primary/90 flex items-center justify-center p-2.5 shrink-0 bg-white shadow-xs group-hover:scale-105 transition-transform duration-200">
                  <img
                    src={comp.logoUrl || logo2Url}
                    alt={comp.name}
                    onError={(e) => {
                      const target = e.currentTarget
                      target.onerror = null
                      target.src = logo2Url
                    }}
                    className="h-9 w-9 sm:h-12 sm:w-12 object-contain"
                  />
                </div>

                {/* Right side: Company Name & Address */}
                <div className="min-w-0 flex-1">
                  <h3 className="text-base sm:text-lg font-bold text-focus transition-colors truncate">
                    {comp.name}
                  </h3>
                  <p className="text-xs text-muted-fg leading-relaxed mt-1 line-clamp-2">
                    {comp.address || 'Blk 43, Lot 24 Regalado Highway, Fairview, Quezon City, Metro Manila'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateCompanyModal
        open={isCreateCompanyOpen}
        onOpenChange={setIsCreateCompanyOpen}
        onSuccess={handleCompanyCreated}
      />

      <ViewCompanyModal
        open={isViewCompanyOpen}
        onOpenChange={setIsViewCompanyOpen}
        company={selectedCompany}
        onUpdate={handleCompanyUpdated}
        onDelete={handleCompanyDeleted}
      />
    </div>
  )
}
