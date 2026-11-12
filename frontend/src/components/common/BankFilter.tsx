import * as React from 'react'
import { Landmark, ChevronDown } from 'lucide-react'
import {
  bankService,
  isAccountOwnedBy,
  preferSoleOwnedBanks,
  type BankAccount,
} from '@/services/bankService'
import { useSession } from '@/hooks/useSession'
import { websocketService } from '@/services/websocketService'
import { cn } from '@/lib/utils'

const norm = (s?: string) => (s || '').trim().toLowerCase()

/** Filter value for the company's petty cash wallet. Petty cash is not a bank account, but expenses
 * paid with it are listed under it so they can be found next to the banks. */
export const PETTY_CASH_BANK_ID = 'petty-cash'

/** True when an expense was paid from petty cash (same rule the petty cash wallet uses). */
export const isPettyCashPayment = (paymentMethod?: string | null): boolean =>
  norm(paymentMethod || '').includes('petty cash')

/**
 * Bank accounts in scope for a company (all companies when "All Companies" or empty) plus the
 * selected bank. An empty selectedId means "All Banks". With `includePettyCash`, "Petty Cash" is
 * also a valid selection (PETTY_CASH_BANK_ID).
 */
export function useBankFilter(company: string, options?: { includePettyCash?: boolean }) {
  const includePettyCash = !!options?.includePettyCash
  const { user } = useSession()
  const userId = user?.id
  const userScopeKey = `${userId || ''}:${user?.role || ''}:${user?.assignedCompany || ''}`
  const [accounts, setAccounts] = React.useState<BankAccount[]>(() =>
    bankService.getCachedAccounts()
  )
  const [selectedId, setSelectedId] = React.useState('')

  React.useEffect(() => {
    if (!userId) return

    let mounted = true
    const loadAccounts = (forceRefresh = false) => {
      bankService
        .getAccounts(undefined, forceRefresh ? { forceRefresh: true } : undefined)
        .then((rows) => {
          if (mounted && Array.isArray(rows)) setAccounts(rows)
        })
        .catch(() => {})
    }

    loadAccounts(false)

    const unsubBank = websocketService.subscribe('BANK_UPDATED', () => {
      loadAccounts(true)
    })

    return () => {
      mounted = false
      unsubBank()
    }
  }, [userId, userScopeKey])

  const scopedAccounts = React.useMemo(() => (userId ? accounts : []), [userId, accounts])

  const available = React.useMemo(() => {
    const target = norm(company)
    if (!target || target === 'all companies') return scopedAccounts
    return preferSoleOwnedBanks(
      scopedAccounts.filter((a) => isAccountOwnedBy(a, company)),
      company
    )
  }, [scopedAccounts, company])

  const activeSelectedId = React.useMemo(() => {
    if (!selectedId) return ''
    if (includePettyCash && selectedId === PETTY_CASH_BANK_ID) return selectedId
    return available.some((a) => String(a.id) === selectedId) ? selectedId : ''
  }, [available, selectedId, includePettyCash])

  const bankLabel = React.useCallback(
    (id?: string) => {
      if (!id) return 'No bank'
      if (id === PETTY_CASH_BANK_ID) return 'Petty Cash'
      const acc = scopedAccounts.find((a) => String(a.id) === String(id))
      return acc ? `${acc.bankName}${acc.accountName ? ` - ${acc.accountName}` : ''}` : 'Unknown bank'
    },
    [scopedAccounts]
  )

  return {
    accounts: scopedAccounts,
    available,
    selectedId: activeSelectedId,
    setSelectedId,
    bankLabel,
  }
}

interface BankFilterSelectProps {
  accounts: BankAccount[]
  value: string
  onChange: (id: string) => void
  className?: string
  /** Also offer "Petty Cash" (value PETTY_CASH_BANK_ID) after the banks. */
  includePettyCash?: boolean
}

/** Compact "All Banks / <bank>" pill, styled like the other toolbar filters. */
export const BankFilterSelect: React.FC<BankFilterSelectProps> = ({ accounts, value, onChange, className, includePettyCash }) => {
  if (accounts.length === 0 && !includePettyCash) return null
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
        className="appearance-none bg-transparent font-semibold text-focus/90 focus:outline-none cursor-pointer max-w-[190px] truncate"
      >
        <option value="">All Banks</option>
        {accounts.map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.bankName}
            {a.accountName ? ` - ${a.accountName}` : ''}
          </option>
        ))}
        {includePettyCash && <option value={PETTY_CASH_BANK_ID}>Petty Cash</option>}
      </select>
      <ChevronDown className="h-3.5 w-3.5 text-muted-fg absolute right-3 pointer-events-none" />
    </label>
  )
}
