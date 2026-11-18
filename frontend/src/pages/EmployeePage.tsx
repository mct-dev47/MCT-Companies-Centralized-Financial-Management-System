import * as React from 'react'
import {
  Search,
  Building2,
  X,
  ArrowUpDown,
  MapPin,
  Phone,
  PhoneCall,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBanner, TablePagination } from '@/components/common'
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
  const [currentPage, setCurrentPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [totalCompanies, setTotalCompanies] = React.useState(0)

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const { items, total } = await employeeService.getCompaniesPaginated({
        page: currentPage,
        limit: pageSize,
        search: searchQuery || undefined,
        sortBy,
      })
      setCompanies(items)
      setTotalCompanies(total)
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
  }, [currentPage, pageSize, searchQuery, sortBy])

  React.useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, sortBy])

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

  const filteredCompanies = companies

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
            className="h-10 sm:h-11 px-4 sm:px-5 rounded-[10px] bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer"
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
            className="h-11 sm:h-12 pl-11 pr-10 rounded-[10px] border border-stroke/50 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-2 focus-visible:ring-focus w-full transition-all"
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
            className="h-11 sm:h-12 rounded-[10px] bg-white border border-stroke/50 shadow-xs"
            ariaLabel="Sort companies"
          />
        </div>
      </div>

      {/* Company List (Single Column Per Row) */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col gap-3.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-rose-200/60 p-3.5 sm:p-5 flex items-center gap-3 sm:gap-4 shadow-xs"
              >
                <Skeleton className="h-14 w-14 sm:h-18 sm:w-18 md:h-20 md:w-20 rounded-full shrink-0" />
                <div className="min-w-0 flex-1 space-y-2 sm:space-y-2.5">
                  <Skeleton className="h-4 sm:h-5 w-1/3 rounded-md" />
                  <Skeleton className="h-3 sm:h-3.5 w-2/3 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="bg-white rounded-xl border border-stroke/30 p-8 sm:p-12 text-center text-muted-fg text-sm">
            No companies found matching your search.
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {filteredCompanies.map((comp) => (
              <div
                key={comp.id}
                onClick={() => handleCardClickCompany(comp)}
                className="bg-white rounded-xl border border-rose-200/90 hover:border-primary/80 hover:shadow-md p-3.5 sm:p-5 transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 sm:gap-4 group shadow-xs select-none"
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
                {/* Left side: Logo + Information */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                  {/* Left circular badge - fully maximized */}
                  <div className="h-14 w-14 sm:h-18 sm:w-18 md:h-20 md:w-20 rounded-full border-2 border-primary/80 flex items-center justify-center shrink-0 bg-white shadow-xs group-hover:scale-105 transition-transform duration-200 overflow-hidden">
                    <img
                      src={comp.logoUrl || logo2Url}
                      alt={comp.name}
                      onError={(e) => {
                        const target = e.currentTarget
                        target.onerror = null
                        target.src = logo2Url
                      }}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Middle: Company Name & Address */}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base md:text-lg font-bold text-focus group-hover:text-primary transition-colors leading-snug break-words">
                      {comp.name}
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-fg flex items-start gap-1.5 mt-1 leading-relaxed break-words">
                      <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary shrink-0 mt-0.5" />
                      <span>{comp.address || 'Blk 43, Lot 24 Regalado Highway, Fairview, Quezon City, Metro Manila'}</span>
                    </p>
                    {(comp.contactNumber || comp.telephoneNumber) && (
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2">
                        {comp.contactNumber && (
                          <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-muted-fg font-medium bg-slate-50 border border-slate-200/80 px-2 sm:px-2.5 py-0.5 rounded-full">
                            <Phone className="h-3 w-3 text-muted-fg/80 shrink-0" />
                            <span>{comp.contactNumber}</span>
                          </span>
                        )}
                        {comp.telephoneNumber && (
                          <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-muted-fg font-medium bg-slate-50 border border-slate-200/80 px-2 sm:px-2.5 py-0.5 rounded-full">
                            <PhoneCall className="h-3 w-3 text-muted-fg/80 shrink-0" />
                            <span>{comp.telephoneNumber}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: View Details Pill */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-primary bg-rose-50/80 border border-rose-200/70 px-3.5 py-2 rounded-xl group-hover:bg-primary group-hover:text-white transition-all">
                    <span>View Company</span>
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-fg/50 group-hover:text-primary sm:hidden shrink-0" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && totalCompanies > 0 && (
          <TablePagination
            currentPage={currentPage}
            totalPages={Math.max(1, Math.ceil(totalCompanies / pageSize))}
            totalItems={totalCompanies}
            pageSize={pageSize}
            onPageSizeChange={(sz) => {
              setPageSize(sz)
              setCurrentPage(1)
            }}
            itemLabel="companies"
            onPageChange={setCurrentPage}
          />
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
