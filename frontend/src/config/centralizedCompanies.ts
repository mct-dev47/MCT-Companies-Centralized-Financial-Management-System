export interface AuthorizedCompany {
  id: number
  name: string
  location: string
  contact_number?: string | null
  phone?: string | null
  starting_balance: number
  petty_cash?: number
  logo_url?: string | null
  role: string
  created_at?: string | null
  updated_at?: string | null
}

// Backward compatibility alias while views transition
export type CentralizedCompany = AuthorizedCompany

/**
 * Generate 2-letter uppercase initials from a company name for UI avatar fallback.
 */
export function getCompanyInitials(name: string): string {
  if (!name) return 'MC'
  const cleaned = name.replace(/[^a-zA-Z\s]/g, '').trim()
  const stopWords = new Set([
    'and', 'or', 'of', 'the', 'inc', 'corp', 'corporation', 'incorporation', 'foundation', 'service', 'services'
  ])
  const words = cleaned.split(/\s+/).filter((w) => !stopWords.has(w.toLowerCase()))
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  if (words.length === 1 && words[0].length >= 2) {
    return words[0].slice(0, 2).toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase() || 'MC'
}
