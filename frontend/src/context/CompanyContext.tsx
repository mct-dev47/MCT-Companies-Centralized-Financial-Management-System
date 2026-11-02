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
  const isCompanyScoped = Boolean(
    user?.assignedCompany &&
      user.assignedCompany !== 'All Companies' &&
      userRole !== 'admin' &&
      userRole !== 'audit' &&
      !userRole.includes('auditor') &&
      userRole !== 'finance'
  )

  const [activeCompany, setActiveCompanyState] = React.useState<string>(() => {
    if (isCompanyScoped && user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      return user.assignedCompany
    }
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(COMPANY_STORAGE_KEY)
      if (saved) return saved
    }
    return (isCompanyScoped ? user?.assignedCompany : 'All Companies') || 'All Companies'
  })

  // Keep in sync when user session changes
  React.useEffect(() => {
    if (isCompanyScoped && user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      setActiveCompanyState(user.assignedCompany)
    } else if (!isCompanyScoped) {
      const saved = typeof window !== 'undefined' ? sessionStorage.getItem(COMPANY_STORAGE_KEY) : null
      setActiveCompanyState(saved || 'All Companies')
    }
  }, [isCompanyScoped, user?.assignedCompany, user?.id])

  const [dynamicCompanies, setDynamicCompanies] = React.useState<string[]>(getCachedCompanies)
  const [dbCompanies, setDbCompanies] = React.useState<CompanyOption[]>([])
  const [isLoadingCompanies, setIsLoadingCompanies] = React.useState<boolean>(false)

  // Dynamically load all registered companies from Supabase via backend endpoint
  const loadCompanies = React.useCallback(async () => {
    setIsLoadingCompanies(true)
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
      const res = await fetch('/api/v1/companies', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
  }, [])

  React.useEffect(() => {
    void loadCompanies()
  }, [loadCompanies, user?.id])

  const allCompanies = React.useMemo(() => {
    if (dynamicCompanies.length > 0) return dynamicCompanies
    if (user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      return ['All Companies', user.assignedCompany]
    }
    return ALL_COMPANIES_LIST
  }, [dynamicCompanies, user?.assignedCompany])

  const setActiveCompany = React.useCallback((company: string) => {
    setActiveCompanyState(company)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(COMPANY_STORAGE_KEY, company)
    }
  }, [])

  const isLendingEnabled = React.useMemo(() => {
    return isLendingEnabledCompany(activeCompany)
  }, [activeCompany])

  const value = React.useMemo<CompanyContextValue>(
    () => ({
      activeCompany,
      setActiveCompany,
      isLendingEnabled,
      isCompanyScoped,
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
