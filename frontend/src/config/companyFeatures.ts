/**
 * Configuration and feature detection for company-specific modules.
 * Ensures that only specified companies have access to unique modules such as Lending and Tenants.
 */

export const LENDING_ENABLED_COMPANY_NAMES = [
  'FilCap Prime Holdings Corp.',
] as const

export const TENANT_ENABLED_COMPANY_NAMES = [
  'JK Property and Ventures',
] as const

/**
 * Checks whether the given company is FilCap Prime Holdings Corp.
 */
export function isFilCapCompany(companyName?: string | null): boolean {
  if (!companyName) return false
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.includes('filcap') || normalized.includes('filcam')
}

/**
 * Checks whether the given company is JK Property and Ventures.
 */
export function isJKPropertyCompany(companyName?: string | null): boolean {
  if (!companyName) return false
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return (
    normalized.includes('jkproperty') ||
    normalized.includes('jkpropertyandventures') ||
    normalized.includes('jkpropertyventures') ||
    normalized.includes('jkventures') ||
    (normalized.includes('jk') && normalized.includes('property'))
  )
}

/**
 * Checks whether the given company is authorized to have the Lending module/tab (FilCap).
 */
export function isLendingEnabledCompany(companyName?: string | null): boolean {
  if (!companyName) return false
  return isFilCapCompany(companyName)
}

/**
 * Checks whether the given company is authorized to have the Tenant module/tab (JK Property).
 */
export function isTenantEnabledCompany(companyName?: string | null): boolean {
  if (!companyName) return false
  return isJKPropertyCompany(companyName)
}
