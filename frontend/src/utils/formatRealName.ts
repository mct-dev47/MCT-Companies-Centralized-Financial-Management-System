/**
 * formatRealName.ts
 * -----------------
 * Formats a user identifier, email, or Google account string into a clean,
 * human-readable real name across all modals and activity timelines.
 */

const KNOWN_EMAIL_NAMES: Record<string, string> = {
  'admin@mct.com': 'Administrator',
  'audit@mct.com': 'Audit Officer',
  'finance@mct.com': 'Finance Officer',
  'temporaryemployee@gmail.com': 'Temporary Employee',
  'jkproperty@mct.com': 'Jessica Kho',
  'filcap@mct.com': 'Carlos Tan',
}

export function formatRealName(nameOrEmail?: string | null): string {
  if (!nameOrEmail || !nameOrEmail.trim()) {
    return 'System User'
  }

  const raw = nameOrEmail.trim()
  const lower = raw.toLowerCase()

  // 1. Direct match for known emails
  if (KNOWN_EMAIL_NAMES[lower]) {
    return KNOWN_EMAIL_NAMES[lower]
  }

  // 2. If it's an email address or Google account (contains @)
  if (raw.includes('@')) {
    const [localPart] = raw.split('@')

    // Handle known local parts
    if (KNOWN_EMAIL_NAMES[`${localPart.toLowerCase()}@mct.com`]) {
      return KNOWN_EMAIL_NAMES[`${localPart.toLowerCase()}@mct.com`]
    }

    // Split on delimiters (dots, underscores, hyphens, pluses, digits) and camelCase
    const words = localPart
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[._\-+0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)

    if (words.length > 0) {
      return words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    }
    return localPart
  }

  // 3. If it's already a real name, return it cleanly
  return raw
}

