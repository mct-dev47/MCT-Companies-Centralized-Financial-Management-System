/**
 * formatRealName.ts
 * -----------------
 * Formats a user identifier, email, generic role, or Google account string into a clean,
 * human-readable real name and role across all modals and activity timelines.
 */

interface KnownPerson {
  name: string
  role?: string
}

const KNOWN_EMAIL_PEOPLE: Record<string, KnownPerson> = {
  'admin@mct.com': { name: 'Reymie Gonzaga', role: 'Administrator' },
  'audit@mct.com': { name: 'Jasmine Mikaella Aninion', role: 'Audit Officer' },
  'finance@mct.com': { name: 'Shelley Sesante', role: 'Finance Officer' },
  'temporaryemployee@gmail.com': { name: 'Temporary Employee', role: 'Staff' },
  'jkproperty@mct.com': { name: 'Clarian Cuenta', role: 'Supervisor' },
  'filcap@mct.com': { name: 'Clarian Cuenta', role: 'Supervisor' },
  'clarian@mct.com': { name: 'Clarian Cuenta', role: 'Supervisor' },
  'slosizante@gmail.com': { name: 'Clarian Cuenta', role: 'Supervisor' },
  'ryuuujin.sh@gmail.com': { name: 'Manuel', role: 'Owner' },
  'manuel@mct.com': { name: 'Manuel', role: 'Owner' },
  'shelleylsesante@iskolarngbayan.pup.edu.ph': { name: 'Shelley Sesante', role: 'Finance' },
  'jasminemikaellaganinion@iskolarngbayan.pup.edu.ph': { name: 'Jasmine Mikaella Aninion', role: 'Audit' },
  'reymielgonzaga@iskolarngbayan.pup.edu.ph': { name: 'Reymie Gonzaga', role: 'Administrator' },
  'reymiegonzaga4@gmail.com': { name: 'Reymie Gonzaga', role: 'Administrator' },
  'binas.leumar1@gmail.com': { name: 'Leumar Binas', role: 'Staff' },
}

const GENERIC_ROLE_PEOPLE: Record<string, KnownPerson> = {
  'finance staff': { name: 'Shelley Sesante', role: 'Finance Officer' },
  'finance officer': { name: 'Shelley Sesante', role: 'Finance Officer' },
  'finance': { name: 'Shelley Sesante', role: 'Finance Officer' },
  'company staff': { name: 'Clarian Cuenta', role: 'Supervisor' },
  'employee': { name: 'Clarian Cuenta', role: 'Supervisor' },
  'internal auditor': { name: 'Jasmine Mikaella Aninion', role: 'Audit Officer' },
  'financial auditor': { name: 'Jasmine Mikaella Aninion', role: 'Audit Officer' },
  'audit officer': { name: 'Jasmine Mikaella Aninion', role: 'Audit Officer' },
  'audit': { name: 'Jasmine Mikaella Aninion', role: 'Audit Officer' },
  'administrator': { name: 'Reymie Gonzaga', role: 'Administrator' },
  'admin': { name: 'Reymie Gonzaga', role: 'Administrator' },
  'authorized accounting specialist': { name: 'Shelley Sesante', role: 'Finance Officer' },
  'supervisor': { name: 'Clarian Cuenta', role: 'Supervisor' },
}

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

  // 0. If it already contains name and role formatted like "Name (Role)", return directly
  if (/\([A-Za-z\s]+\)$/.test(raw)) {
    return raw
  }

  // 1. Direct match in known email mappings
  if (KNOWN_EMAIL_PEOPLE[lower]) {
    const person = KNOWN_EMAIL_PEOPLE[lower]
    const role = fallbackRole || person.role
    return role ? `${person.name} (${role})` : person.name
  }

  // 2. Direct match in generic role titles
  if (GENERIC_ROLE_PEOPLE[lower]) {
    const active = getActiveSessionUser()
    const person = GENERIC_ROLE_PEOPLE[lower]
    // If active session user matches the role, prefer active user's real name
    if (active?.fullName && active.role && active.role.toLowerCase() === (person.role || '').toLowerCase()) {
      return `${active.fullName} (${active.role})`
    }
    const role = fallbackRole || person.role
    return role ? `${person.name} (${role})` : person.name
  }

  // 3. If it matches current active session user
  const activeUser = getActiveSessionUser()
  if (activeUser) {
    const activeEmail = (activeUser.email || '').toLowerCase()
    const activeName = (activeUser.fullName || '').toLowerCase()
    if (lower === activeEmail || lower === activeName) {
      const realName = activeUser.fullName || raw
      const role = fallbackRole || activeUser.role
      return role && !realName.includes('(') ? `${realName} (${role})` : realName
    }
  }

  // 4. If it's an email address or Google account (contains @)
  if (raw.includes('@')) {
    const [localPart] = raw.split('@')
    const localLower = localPart.toLowerCase()

    if (KNOWN_EMAIL_PEOPLE[`${localLower}@mct.com`]) {
      const person = KNOWN_EMAIL_PEOPLE[`${localLower}@mct.com`]
      const role = fallbackRole || person.role
      return role ? `${person.name} (${role})` : person.name
    }

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

  // 5. If it's a real name already, append role if provided and not already present
  if (fallbackRole && !raw.includes('(')) {
    return `${raw} (${fallbackRole})`
  }

  return raw
}

export const formatRealNameWithRole = formatRealName
