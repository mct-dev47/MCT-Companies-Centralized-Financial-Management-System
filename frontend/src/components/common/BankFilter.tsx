import * as React from 'react'
import { Landmark } from 'lucide-react'
import {
  bankService,
  isAccountOwnedBy,
  preferSoleOwnedBanks,
  type BankAccount,
} from '@/services/bankService'
import { useSession } from '@/hooks/useSession'
import { websocketService } from '@/services/websocketService'
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown'

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

/**
 * Standard BankFilterSelect conforming to Phase 2 Dropdown Standards:
 * - 10px control radius
 * - 44px min height
 * - 16px surface radius menu with soft shadow
 * - Full keyboard navigation and accessible combobox role
 */
export const BankFilterSelect: React.FC<BankFilterSelectProps> = ({
  accounts,
  value,
  onChange,
  className,
  includePettyCash,
}) => {
  if (accounts.length === 0 && !includePettyCash) return null

  const options: DropdownOption<string>[] = [
    {
      value: '',
      label: 'All Banks',
      icon: <Landmark className="h-3.5 w-3.5 text-muted-fg" />,
    },
    ...accounts.map((a) => ({
      value: String(a.id),
      label: `${a.bankName}${a.accountName ? ` - ${a.accountName}` : ''}`,
      icon: <Landmark className="h-3.5 w-3.5 text-muted-fg" />,
    })),
    ...(includePettyCash
      ? [
          {
            value: PETTY_CASH_BANK_ID,
            label: 'Petty Cash',
            icon: <Landmark className="h-3.5 w-3.5 text-muted-fg" />,
          },
        ]
      : []),
  ]

  return (
    <div className={className}>
      <Dropdown<string>
        value={value}
        onChange={(val) => onChange(val || '')}
        options={options}
        placeholder="All Banks"
        aria-label="Filter by bank"
        searchable={accounts.length > 5}
        searchPlaceholder="Search banks..."
        triggerClassName="min-w-[180px] max-w-[260px] rounded-[10px]"
      />
    </div>
  )
}

export default BankFilterSelect
