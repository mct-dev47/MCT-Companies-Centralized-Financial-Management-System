import * as React from 'react'
import { useSession } from '@/hooks/useSession'
import { isLendingEnabledCompany } from '@/config/companyFeatures'

export interface CompanyOption {
  id: number
  name: string
  company_id?: number
  company_name?: string
}

export interface CompanyContextValue {
  activeCompany: string
  setActiveCompany: (company: string) => void
  isLendingEnabled: boolean
  isCompanyScoped: boolean
  isSpecificCompanySelected: boolean
  allCompanies: string[]
  dbCompanies: CompanyOption[]
  isLoadingCompanies: boolean
  refreshCompanies: () => Promise<void>
}

// Default placeholder containing only the aggregate 'All Companies' option.
// All specific companies are dynamically queried and retrieved from Supabase.
export const ALL_COMPANIES_LIST: string[] = ['All Companies']

const COMPANY_STORAGE_KEY = 'mct_active_company_session'
const DYNAMIC_COMPANIES_CACHE_KEY = 'mct_dynamic_companies_cache'

const getCachedCompanies = (): string[] => {
  if (typeof window === 'undefined') return ['All Companies']
  try {
    const raw = sessionStorage.getItem(DYNAMIC_COMPANIES_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    }
  } catch {
    // Ignore cache parse error
  }
  return ['All Companies']
}

export const CompanyContext = React.createContext<CompanyContextValue | undefined>(undefined)

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useSession()

  const userRole = (user?.role || '').trim().toLowerCase()
  const isMultiCompanyRole =
    userRole === 'admin' ||
    userRole === 'finance' ||
    userRole === 'audit' ||
    userRole.includes('auditor')
  const userAssignedCompanies = React.useMemo(() => {
    if (user?.companyNames && user.companyNames.length > 0) {
      return user.companyNames
    }
    if (user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      return [user.assignedCompany]
    }
    return []
  }, [user?.companyNames, user?.assignedCompany])

  const hasMultipleAssigned = userAssignedCompanies.length >= 2

  // A user is strictly scoped to one single company ONLY if they have exactly 1 assigned company and are not admin or finance
  const isCompanyScoped = Boolean(
    !isMultiCompanyRole &&
      !hasMultipleAssigned &&
      userAssignedCompanies.length === 1
  )

  const [activeCompany, setActiveCompanyState] = React.useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(COMPANY_STORAGE_KEY)
      if (saved) {
        if (
          isMultiCompanyRole ||
          userAssignedCompanies.length === 0 ||
          userAssignedCompanies.includes(saved) ||
          (hasMultipleAssigned && saved === 'All Companies')
        ) {
          return saved
        }
      }
    }
    if (!isMultiCompanyRole && userAssignedCompanies.length > 0) {
      return userAssignedCompanies[0]
    }
    return 'All Companies'
  })

  // Keep in sync when user session changes
  React.useEffect(() => {
    if (isCompanyScoped && userAssignedCompanies.length === 1) {
      setActiveCompanyState(userAssignedCompanies[0])
    } else if (!isCompanyScoped) {
      const saved = typeof window !== 'undefined' ? sessionStorage.getItem(COMPANY_STORAGE_KEY) : null
      if (
        saved &&
        (isMultiCompanyRole ||
          userAssignedCompanies.length === 0 ||
          userAssignedCompanies.includes(saved) ||
          (hasMultipleAssigned && saved === 'All Companies'))
      ) {
        setActiveCompanyState(saved)
      } else if (!isMultiCompanyRole && userAssignedCompanies.length > 0) {
        setActiveCompanyState(userAssignedCompanies[0])
      } else {
        setActiveCompanyState('All Companies')
      }
    }
  }, [isCompanyScoped, isMultiCompanyRole, userAssignedCompanies, hasMultipleAssigned, user?.id])

  const [dynamicCompanies, setDynamicCompanies] = React.useState<string[]>(getCachedCompanies)
  const [dbCompanies, setDbCompanies] = React.useState<CompanyOption[]>([])
  const [isLoadingCompanies, setIsLoadingCompanies] = React.useState<boolean>(false)

  // Dynamically load all registered companies from Supabase via backend endpoint
  const loadCompanies = React.useCallback(async () => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
    if (!token || !user?.id) {
      return
    }
    // Prevent 401: verify token format and expiry before fetching
    try {
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return
        }
      } else {
        return
      }
    } catch {
      return
    }
    setIsLoadingCompanies(true)
    try {
      const res = await fetch('/api/v1/companies/lookup', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        if (res.status === 401) return
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const mappedOptions: CompanyOption[] = data.map((c: any) => ({
          id: c.id ?? c.company_id ?? 0,
          name: c.name ?? c.company_name ?? '',
          company_id: c.id ?? c.company_id ?? 0,
          company_name: c.name ?? c.company_name ?? '',
        }))
        setDbCompanies(mappedOptions)
        const names = mappedOptions.map((c) => c.name).filter(Boolean)
        const combined = Array.from(new Set(['All Companies', ...names]))
        setDynamicCompanies(combined)
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(DYNAMIC_COMPANIES_CACHE_KEY, JSON.stringify(combined))
          } catch {
            // Ignore storage quota errors
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch dynamic companies in CompanyContext:', err)
    } finally {
      setIsLoadingCompanies(false)
    }
  }, [user?.id])

  React.useEffect(() => {
    if (user?.id) {
      void loadCompanies()
    }
  }, [loadCompanies, user?.id])

  const allCompanies = React.useMemo(() => {
    if (!isMultiCompanyRole && userAssignedCompanies.length > 0) {
      if (userAssignedCompanies.length > 1) {
        return ['All Companies', ...userAssignedCompanies]
      }
      return [userAssignedCompanies[0]]
    }
    if (dynamicCompanies.length > 0) return dynamicCompanies
    return ALL_COMPANIES_LIST
  }, [dynamicCompanies, userAssignedCompanies, isMultiCompanyRole])

  const setActiveCompany = React.useCallback((company: string) => {
    setActiveCompanyState(company)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(COMPANY_STORAGE_KEY, company)
    }
  }, [])

  const isSpecificCompanySelected = Boolean(activeCompany && activeCompany !== 'All Companies')

  const isLendingEnabled = React.useMemo(() => {
    return isLendingEnabledCompany(activeCompany)
  }, [activeCompany])

  const value = React.useMemo<CompanyContextValue>(
    () => ({
      activeCompany,
      setActiveCompany,
      isLendingEnabled,
      isCompanyScoped,
      isSpecificCompanySelected,
      allCompanies,
      dbCompanies,
      isLoadingCompanies,
      refreshCompanies: loadCompanies,
    }),
    [
      activeCompany,
      setActiveCompany,
      isLendingEnabled,
      isCompanyScoped,
      isSpecificCompanySelected,
      allCompanies,
      dbCompanies,
      isLoadingCompanies,
      loadCompanies,
    ]
  )

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}

export function useCompany(): CompanyContextValue {
  const context = React.useContext(CompanyContext)
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider')
  }
  return context
}
