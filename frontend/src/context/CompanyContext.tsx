import * as React from 'react'
import { useSession } from '@/hooks/useSession'
import { isLendingEnabledCompany } from '@/config/companyFeatures'

export interface CompanyContextValue {
  activeCompany: string
  setActiveCompany: (company: string) => void
  isLendingEnabled: boolean
  isCompanyScoped: boolean
  allCompanies: string[]
}

export const ALL_COMPANIES_LIST = [
  'All Companies',
  'MCTolentino Hospitality Business Corporation',
  'JK Global Printing Service',
  'Speedfire Construction & Trading Corporation',
  'JK Property and Ventures Corporation',
  'Golden Jupiter Property Ventures Corporation',
  'FILCAP Prime Holdings Corp.',
  'MEDSYS Uni Horizon Pharma Corporation | Arcade',
  'Far East Asia Trading Corporation',
  'M.C Tolentino College Foundation, Incorporation',
  'Bagong Bansa May Pag Asa Movement, Incorporation',
  'Bookworld Systems Solutions & Technologies Corporation',
  'MEDSYS Uni Horizon Pharma Corporation | Sapamanai',
  'MEDSYS Uni Horizon Pharma Corporation | Regalado',
  'MyCity.Kitchen Corporation',
]

const COMPANY_STORAGE_KEY = 'mct_active_company_session'

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

  const [dynamicCompanies, setDynamicCompanies] = React.useState<string[]>([])

  // Dynamically load all registered companies from backend database
  React.useEffect(() => {
    let mounted = true
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
    fetch('/api/v1/companies', {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (mounted && Array.isArray(data) && data.length > 0) {
          const names = data
            .map((c: any) => c.company_name || c.name)
            .filter(Boolean)
          setDynamicCompanies(Array.from(new Set(['All Companies', ...names])))
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch dynamic companies in CompanyContext:', err)
      })
    return () => {
      mounted = false
    }
  }, [user])

  const allCompanies = React.useMemo(() => {
    if (dynamicCompanies.length > 0) return dynamicCompanies
    return ALL_COMPANIES_LIST
  }, [dynamicCompanies])

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
    }),
    [activeCompany, setActiveCompany, isLendingEnabled, isCompanyScoped, allCompanies]
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
