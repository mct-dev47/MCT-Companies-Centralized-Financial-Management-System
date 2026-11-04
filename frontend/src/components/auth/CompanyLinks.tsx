import * as React from 'react'

export interface CompanyLinkItem {
  id: string
  name: string
  href?: string
}

export const COMPANY_LINKS: readonly CompanyLinkItem[] = [
  { id: 'kitchen', name: 'MCT Kitchen' },
  { id: 'hotel', name: 'MCT Hotel' },
  { id: 'golden-jupiter', name: 'Golden Jupiter Ventures' },
  { id: 'jk-property', name: 'JK Property Ventures' },
  { id: 'medsys', name: 'MedSys' },
  { id: 'speedfire', name: 'SpeedFire' },
  { id: 'terisitos', name: 'Terisitos' },
  { id: 'jk-printing', name: 'JK Printing' },
] as const

export const CompanyLinks: React.FC = () => {
  return (
    <footer className="w-full px-4 sm:px-6 py-2 sm:py-3 md:py-4 text-center shrink-0">
      <nav
        aria-label="MCT Companies"
        className="flex flex-wrap items-center justify-center gap-x-2.5 sm:gap-x-3 gap-y-0.5 sm:gap-y-1 text-center max-w-full text-[10px] sm:text-[11px] 2xl:text-xs text-muted-fg/80 px-2"
      >
        {COMPANY_LINKS.map((company) => (
          <span
            key={company.id}
            className="whitespace-nowrap transition-colors hover:text-focus select-none cursor-default"
          >
            {company.name}
          </span>
        ))}
      </nav>
      {/* On mobile screens, copyright belongs at the very bottom of the document */}
      <p className="mt-1 sm:mt-1.5 text-[10px] sm:text-[11px] text-muted-fg/70 md:hidden">
        © 2026 MCT Group of Companies
      </p>
    </footer>
  )
}