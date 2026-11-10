/**
 * Utility functions for matching and normalizing company names dynamically
 * without hardcoded database entity dictionaries.
 */

export const COMPANY_ALIASES: Record<string, string[]> = {}
export const KNOWN_COMPANY_ALIASES = COMPANY_ALIASES

const COMMON_STOP_WORDS = new Set([
  'corporation',
  'corp',
  'inc',
  'incorporation',
  'company',
  'co',
  'holdings',
  'services',
  'service',
  'ventures',
  'the',
  'and',
  'trading',
  'business',
  'movement',
  'foundation',
])

/**
 * Checks whether two company names refer to the same company,
 * accounting for legal entity suffixes and branch identifiers.
 */
export function isCompanyMatch(
  companyA?: string | null,
  companyB?: string | null
): boolean {
  if (!companyA || !companyB) return false

  const a = companyA.trim().toLowerCase()
  const b = companyB.trim().toLowerCase()

  if (a === b) return true
  if (a === 'all companies' || b === 'all companies') return true

  // 1. Guard against distinct branch suffixes (e.g. "Company | Branch A" vs "Company | Branch B")
  const branchA = a.includes('|') ? a.split('|')[1]?.trim() : null
  const branchB = b.includes('|') ? b.split('|')[1]?.trim() : null
  if (branchA && branchB && branchA !== branchB) {
    return false
  }
  if (branchA && !b.includes(branchA)) {
    return false
  }
  if (branchB && !a.includes(branchB)) {
    return false
  }

  // 2. Direct containment check
  if (a.includes(b) || b.includes(a)) {
    return true
  }

  // 3. Token-based matching on significant distinctive words
  const extractTokens = (str: string) =>
    str
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !COMMON_STOP_WORDS.has(w))

  const tokensA = extractTokens(a)
  const tokensB = extractTokens(b)

  return tokensA.some((ta) => tokensB.some((tb) => ta === tb))
}
