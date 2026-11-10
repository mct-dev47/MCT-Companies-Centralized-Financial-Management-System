/**
 * formatRealName.ts
 * -----------------
 * Formats a user identifier, email, or name string into a clean,
 * human-readable display name and role without hardcoded user records.
 */

function getActiveSessionUser(): { fullName?: string; email?: string; role?: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem('mct_session_user') || sessionStorage.getItem('mct_user')
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return null
}

export function formatRealName(nameOrEmail?: string | null, fallbackRole?: string | null): string {
  if (!nameOrEmail || !nameOrEmail.trim()) {
    return 'System User'
  }

  const raw = nameOrEmail.trim()
  const lower = raw.toLowerCase()

  // 1. If it already contains name and role formatted like "Name (Role)", return directly
  if (/\([A-Za-z\s]+\)$/.test(raw)) {
    return raw
  }

  // 2. If it matches the current active session user, use their live session name/role
  const activeUser = getActiveSessionUser()
  if (activeUser) {
    const activeEmail = (activeUser.email || '').toLowerCase()
    const activeName = (activeUser.fullName || '').toLowerCase()
    const activeRole = (activeUser.role || '').toLowerCase()
    if (lower === activeEmail || lower === activeName || (activeRole && lower === activeRole)) {
      const realName = activeUser.fullName || raw
      const role = fallbackRole || activeUser.role
      return role && !realName.includes('(') ? `${realName} (${role})` : realName
    }
  }

  // 3. If it's an email address (contains @)
  if (raw.includes('@')) {
    const [localPart] = raw.split('@')

    // Split on delimiters (dots, underscores, hyphens, pluses, digits) and camelCase
    const words = localPart
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[._\-+0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    if (words.length > 0) {
      const name = words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
      return fallbackRole ? `${name} (${fallbackRole})` : name
    }
    return fallbackRole ? `${localPart} (${fallbackRole})` : localPart
  }

  // 4. If it's a name already, append role if provided and not already present
  if (fallbackRole && !raw.includes('(')) {
    return `${raw} (${fallbackRole})`
  }

  return raw
}

export const formatRealNameWithRole = formatRealName
