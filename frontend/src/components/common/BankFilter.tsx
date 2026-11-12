import * as React from 'react'
import { Landmark, ChevronDown } from 'lucide-react'
import { bankService, type BankAccount } from '@/services/bankService'
import { cn } from '@/lib/utils'

const norm = (s?: string) => (s || '').trim().toLowerCase()

/**
 * Bank accounts in scope for a company (all companies when "All Companies" or empty) plus the
 * selected bank. An empty selectedId means "All Banks".
 */
export function useBankFilter(company: string) {
  const [accounts, setAccounts] = React.useState<BankAccount[]>(() => bankService.getCachedAccounts())
  const [selectedId, setSelectedId] = React.useState('')

  React.useEffect(() => {
    let mounted = true
    bankService
      .getAccounts()
      .then((rows) => {
        if (mounted && Array.isArray(rows)) setAccounts(rows)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  const available = React.useMemo(() => {
    const target = norm(company)
    if (!target || target === 'all companies') return accounts
    return accounts.filter((a) => norm(a.companyName) === target)
  }, [accounts, company])

  // Drop the selection when the chosen bank is no longer in scope (e.g. the company changed)
  React.useEffect(() => {
    if (selectedId && !available.some((a) => String(a.id) === selectedId)) setSelectedId('')
  }, [available, selectedId])

  const bankLabel = React.useCallback(
    (id?: string) => {
      if (!id) return 'No bank'
      const acc = accounts.find((a) => String(a.id) === String(id))
      return acc ? `${acc.bankName}${acc.accountName ? ` - ${acc.accountName}` : ''}` : 'Unknown bank'
    },
    [accounts]
  )

  return { accounts, available, selectedId, setSelectedId, bankLabel }
}

interface BankFilterSelectProps {
  accounts: BankAccount[]
  value: string
  onChange: (id: string) => void
  className?: string
}

/** Compact "All Banks / <bank>" pill, styled like the other toolbar filters. */
export const BankFilterSelect: React.FC<BankFilterSelectProps> = ({ accounts, value, onChange, className }) => {
  if (accounts.length === 0) return null
  return (
    <label
      className={cn(
        'relative inline-flex items-center gap-2 h-10 pl-3.5 pr-8 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs cursor-pointer select-none box-border',
        className
      )}
    >
      <Landmark className="h-3.5 w-3.5 text-muted-fg shrink-0" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter by bank"
        className="appearance-none bg-transparent font-semibold text-focus/90 focus:outline-none cursor-pointer flex-1 min-w-0 truncate pr-2"
      >
        <option value="">All Banks</option>
        {accounts.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.bankName}
            {a.accountName ? ` - ${a.accountName}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3.5 w-3.5 text-muted-fg absolute right-3 pointer-events-none" />
    </label>
  )
}
