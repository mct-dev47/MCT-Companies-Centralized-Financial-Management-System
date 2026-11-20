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
    (normalized.includes('jk') && (normalized.includes('property') || normalized.includes('vertures') || normalized.includes('ventures')))
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

/**
 * Sales and Receivables are available to every company, including JK Property (Tenants)
 * and FilCap (Lending). Those two companies already post rent / loan collections to
 * Transactions and Bank from their own modules, so recording the same money as a Sale
 * would count it twice. Returns a warning to show on Sales screens, or null.
 */
export function getSalesDoubleEntryWarning(companyName?: string | null): string | null {
  if (isJKPropertyCompany(companyName)) {
    return 'Tenant rent and lease payments are already recorded from the Tenants page. Do not enter them here as Sales, or they will be counted twice in Transactions and Bank.'
  }
  if (isFilCapCompany(companyName)) {
    return 'Loan collections and lending income are already recorded from the Lending page. Do not enter them here as Sales, or they will be counted twice in Transactions and Bank.'
  }
  return null
}
