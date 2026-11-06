/**
 * Formats a person's full name into first initial and last name format.
 * Examples:
 * - "Virgie Masiglat" -> "V. Masiglat"
 * - "Victoria Masiglat" -> "V. Masiglat"
 * - "Princess Tayam" -> "P. Tayam"
 * - "Mary Jane Watson" -> "M. Watson"
 * - "Audit Officer" -> "A. Officer"
 * - "audit@mct.com" -> "Audit"
 * - Single name "Manuel" -> "Manuel"
 * - Empty / null / undefined -> "—"
 */
export function formatPersonInitialAndLastName(fullName?: string | null): string {
  if (!fullName || !fullName.trim()) return '—'
  const trimmed = fullName.trim()

  // Handle email addresses by checking known roles without fabricating fake names
  if (trimmed.includes('@')) {
    const username = trimmed.split('@')[0]
    const knownRoles = new Set(['audit', 'auditor', 'admin', 'administrator', 'finance', 'supervisor', 'system', 'user', 'info', 'support'])
    const lowerUser = username.toLowerCase()
    if (knownRoles.has(lowerUser)) {
      return lowerUser.charAt(0).toUpperCase() + lowerUser.slice(1)
    }
    return trimmed
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0]
  const firstInitial = parts[0][0].toUpperCase()
  const lastName = parts[parts.length - 1]
  return `${firstInitial}. ${lastName}`
}

