/**
 * Utility functions for matching and normalizing company names across
 * user-facing display names, shorthand aliases, and database registered entity names.
 */

export const COMPANY_ALIASES: Record<string, string[]> = {
  'mct kitchen': ['mycity kitchen', 'mycity.kitchen', 'mycity.kitchen corporation', 'kitchen'],
  'mycity.kitchen corporation': ['mct kitchen', 'mycity kitchen', 'mycity.kitchen', 'kitchen'],
  'kitchen': ['mycity.kitchen', 'mycity kitchen', 'kitchen'],
  'mct hotel': [
    'mctolentino hospitality',
    'mctolentino hospitality business corporation',
    'hotel',
    'hospitality',
  ],
  'mctolentino hospitality business corporation': [
    'mct hotel',
    'mctolentino hospitality',
    'hotel',
    'hospitality',
  ],
  'hotel': ['mctolentino hospitality', 'mct hotel', 'hospitality'],
  'speedbox': ['speedfire construction', 'speedfire', 'speedfire construction & trading corporation'],
  'speedfire': ['speedfire construction', 'speedfire', 'speedbox', 'speedfire construction & trading corporation'],
  'speedfire construction': ['speedbox', 'speedfire', 'speedfire construction & trading corporation'],
  'speedfire construction & trading corporation': ['speedbox', 'speedfire', 'speedfire construction'],
  'jk printing': ['jk global printing', 'jk global headways', 'printing', 'jk global printing service'],
  'jk global printing service': ['jk printing', 'printing', 'jk global headways'],
  'jk global headways': ['jk printing', 'printing'],
  'jk property': ['jk property and ventures', 'property ventures', 'jk property & ventures', 'jk property and ventures corporation'],
  'jk property and ventures': [
    'jk property and ventures corporation',
    'jk property',
    'property ventures',
    'jk property & ventures',
  ],
  'jk property and ventures corporation': ['jk property', 'jk property and ventures', 'property ventures'],
  'golden sunburst': ['golden jupiter property ventures', 'golden jupiter', 'golden sunburst', 'golden jupiter property ventures corporation'],
  'golden sunburst ventures': ['golden jupiter property ventures', 'golden jupiter', 'golden sunburst', 'golden jupiter property ventures corporation'],
  'golden jupiter property ventures': ['golden sunburst ventures', 'golden jupiter', 'golden sunburst', 'golden jupiter property ventures corporation'],
  'golden jupiter property ventures corporation': ['golden sunburst', 'golden jupiter', 'golden sunburst ventures'],
  'filcap': ['filcap prime', 'filcap prime holdings', 'filcap prime holdings corp.', 'filcam'],
  'filcap prime holdings corp.': ['filcap', 'filcap prime', 'filcam'],
  'far east asia': ['far east asia trading corporation', 'far east asia'],
  'far east asia trading corporation': ['far east asia'],
  'mc tolentino': ['m.c tolentino', 'tolentino college', 'college foundation', 'm.c tolentino college foundation, incorporation', 'm.c tolentino college foundation'],
  'm.c tolentino college foundation, incorporation': ['mc tolentino', 'tolentino college', 'college foundation', 'm.c tolentino', 'm.c tolentino college foundation'],
  'm.c tolentino college foundation': ['mc tolentino', 'tolentino college', 'college foundation', 'm.c tolentino', 'm.c tolentino college foundation, incorporation'],
  'bagong bansa': ['bagong bansa may pag asa', 'bagong bansa', 'bagong bansa may pag asa movement, incorporation'],
  'bagong bansa may pag asa movement, incorporation': ['bagong bansa', 'bagong bansa may pag asa'],
  'bookworld': ['bookworld systems solutions', 'bookworld', 'bookworld systems solutions & technologies corporation'],
  'bookworld systems solutions & technologies corporation': ['bookworld', 'bookworld systems solutions'],
  'medsys arcade': ['medsys uni horizon pharma corporation | arcade'],
  'medsys uni horizon pharma corporation | arcade': ['medsys arcade'],
  'medsys sapamanai': ['medsys uni horizon pharma corporation | sapamanai'],
  'medsys uni horizon pharma corporation | sapamanai': ['medsys sapamanai'],
  'medsys regalado': ['medsys uni horizon pharma corporation | regalado'],
  'medsys uni horizon pharma corporation | regalado': ['medsys regalado'],
}

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
])

/**
 * Checks whether two company names refer to the same company,
 * accounting for legal entity suffixes and known aliases.
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

  // 1. Guard against branch collisions (e.g. Medsys Arcade vs Sapamanai vs Regalado)
  const branches = ['arcade', 'sapamanai', 'regalado']
  const branchA = branches.find((br) => a.includes(br))
  const branchB = branches.find((br) => b.includes(br))
  if (branchA && branchB && branchA !== branchB) {
    return false
  }
  // If one explicitly has a known branch and the other is a different company or doesn't mention Medsys
  if ((branchA || branchB) && !(a.includes('medsys') && b.includes('medsys'))) {
    return false
  }

  // 2. Guard against domain collisions (e.g. Hospitality/Hotel vs College/Foundation)
  const isEduA = a.includes('college') || a.includes('foundation')
  const isEduB = b.includes('college') || b.includes('foundation')
  const isHospA = a.includes('hospitality') || a.includes('hotel')
  const isHospB = b.includes('hospitality') || b.includes('hotel')
  if ((isEduA && isHospB) || (isHospA && isEduB)) {
    return false
  }

  // 3. Direct contains check (only if neither specifies conflicting branches)
  if (branchA === branchB && (a.includes(b) || b.includes(a))) {
    return true
  }

  // 4. Direct alias lookup
  const aliasesA = COMPANY_ALIASES[a] || []
  if (aliasesA.some((item) => item === b || b.includes(item) || item.includes(b))) {
    return true
  }

  const aliasesB = COMPANY_ALIASES[b] || []
  if (aliasesB.some((item) => item === a || a.includes(item) || item.includes(a))) {
    return true
  }

  // 5. Cross-family alias match
  for (const [key, list] of Object.entries(COMPANY_ALIASES)) {
    const family = [key, ...list]
    const aInFamily = family.some((member) => member === a || a.includes(member) || member.includes(a))
    const bInFamily = family.some((member) => member === b || b.includes(member) || member.includes(b))
    if (aInFamily && bInFamily) return true
  }

  // 6. Token-based matching on significant distinctive words
  const extractTokens = (str: string) =>
    str
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !COMMON_STOP_WORDS.has(w))

  const tokensA = extractTokens(a)
  const tokensB = extractTokens(b)

  // Tokens must be strictly equal (ta === tb), NOT substring (ta.includes(tb))
  return tokensA.some((ta) => tokensB.some((tb) => ta === tb))
}
