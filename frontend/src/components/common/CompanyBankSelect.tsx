import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { bankService, isAccountOwnedBy, preferSoleOwnedBanks, type BankAccount } from '@/services/bankService'
import { formatPHP } from '@/lib/format'

interface CompanyBankSelectProps {
  /** Company whose bank accounts are offered. */
  company: string
  value: string
  onChange: (bankAccountId: string) => void
  label?: string
  hint?: string
  required?: boolean
  error?: string
  disabled?: boolean
  /** Receives the accounts once loaded (e.g. to check the selected bank's balance). */
  onAccountsLoaded?: (accounts: BankAccount[]) => void
}

/** A dropdown of the company's bank accounts with their current balances (spec 0045). */
export const CompanyBankSelect: React.FC<CompanyBankSelectProps> = ({
  company,
  value,
  onChange,
  label = 'Bank Account',
  hint,
  required,
  error,
  disabled,
  onAccountsLoaded,
}) => {
  const [accounts, setAccounts] = React.useState<BankAccount[]>([])
  const [loading, setLoading] = React.useState(false)
  const loadedRef = React.useRef(onAccountsLoaded)
  loadedRef.current = onAccountsLoaded

  React.useEffect(() => {
    if (!company) return
    let cancelled = false
    setLoading(true)
    bankService
      .getAccounts(company, { forceRefresh: true })
      .catch(() => [] as BankAccount[])
      .then((all) => {
        if (cancelled) return
        const own = preferSoleOwnedBanks(all.filter((a) => isAccountOwnedBy(a, company)), company)
        setAccounts(own)
        loadedRef.current?.(own)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [company])

  const hasCurrent = !value || accounts.some((a) => String(a.id) === String(value))

  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-focus flex items-center justify-between">
        <span>
          {label} {required && <span className="text-[#960C01]">*</span>}
        </span>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-fg" />}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <option value="">{loading ? 'Loading bank accounts...' : 'Select bank account...'}</option>
        {!hasCurrent && <option value={value}>Current bank ({value})</option>}
        {accounts.map((acc) => (
          <option key={acc.id} value={String(acc.id)}>
            {acc.bankName}
            {acc.accountNumber ? ` (••${String(acc.accountNumber).slice(-4)})` : ''} — {formatPHP(Number(acc.currentBalance) || 0)}
          </option>
        ))}
      </select>
      {!loading && accounts.length === 0 && (
        <p className="text-[10px] text-amber-700 font-medium">No bank accounts found for {company}. Add one in Bank Management first.</p>
      )}
      {hint && !error && <p className="text-[10px] text-muted-fg">{hint}</p>}
      {error && <p className="text-[10px] text-red-600 font-medium">{error}</p>}
    </div>
  )
}

export default CompanyBankSelect
