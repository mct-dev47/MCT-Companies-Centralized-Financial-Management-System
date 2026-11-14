import * as React from 'react'
import { Landmark, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatDisplayDate } from '@/utils/dateUtils'
import { type BankAccount, preferSoleOwnedBanks, isAccountOwnedBy, isSoleOwner } from '@/services/bankService'
import type { SalesItem } from '@/services/salesService'


const todayIso = () => {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

interface DepositDateDialogProps {
  sale: SalesItem | null
  accounts: BankAccount[]
  onClose: () => void
  onConfirm: (depositDate: string, bankAccountId?: string) => Promise<void> | void
}

/**
 * Asks where and when a sale's money reached the bank. The sale keeps its own date; the deposit
 * date drives the Deposit tab so it matches the bank passbook.
 */
export const DepositDateDialog: React.FC<DepositDateDialogProps> = ({
  sale,
  accounts,
  onClose,
  onConfirm,
}) => {
  const saleDay = sale?.rawDate || ''
  const companyAccounts = React.useMemo(
    // Every bank the company owns, alone or shared; its own (sole-owner) banks listed first
    () => (sale ? preferSoleOwnedBanks(accounts.filter((a) => isAccountOwnedBy(a, sale.company)), sale.company) : []),
    [accounts, sale]
  )

  const [bankId, setBankId] = React.useState('')
  const [depositDate, setDepositDate] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Reset the form each time a different sale is opened
  React.useEffect(() => {
    if (!sale) return
    const today = todayIso()
    // Default to today (never before the sale date) since that is when staff are recording the deposit
    setDepositDate(sale.rawDate && sale.rawDate > today ? sale.rawDate : today)
    // Default: the company's only own bank; else its only bank (even if shared); else let the user choose
    const ownBanks = companyAccounts.filter((a) => isSoleOwner(a, sale.company))
    const fallback = ownBanks.length === 1 ? ownBanks[0] : companyAccounts.length === 1 ? companyAccounts[0] : null
    setBankId(sale.bankAccountId || (fallback ? String(fallback.id) : ''))
    setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id])

  const invalidDate = !depositDate || (saleDay !== '' && depositDate < saleDay) || depositDate > todayIso()

  const handleConfirm = async () => {
    if (invalidDate) return
    setSaving(true)
    try {
      await onConfirm(depositDate, bankId || undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!sale} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-[440px] rounded-[16px] p-6 bg-white border border-stroke/40 shadow-modal">
        <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-focus leading-tight">
                Mark as Deposited
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">
                {sale ? `Record deposit of ₱${Number(sale.deposit ?? sale.netAmount ?? (sale as any).amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} for ${sale.particulars || sale.category || 'sale'} (${formatDisplayDate(saleDay)}).` : ''}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="deposit-bank-select" className="text-xs font-semibold text-focus block">Bank account</Label>
            <Dropdown
              id="deposit-bank-select"
              name="bankAccount"
              value={bankId}
              onChange={(val) => setBankId(String(val))}
              placeholder={companyAccounts.length === 0 ? 'No bank account for this company' : 'Default account'}
              options={companyAccounts.map((a) => ({
                value: String(a.id),
                label: `${a.bankName}${a.accountName ? ` - ${a.accountName}` : ''}`,
              }))}
              aria-label="Bank Account"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deposit-date-input" className="text-xs font-semibold text-focus block">
              Deposit date <span className="text-rose-600">*</span>
            </Label>
            <input
              id="deposit-date-input"
              name="depositDate"
              type="date"
              value={depositDate}
              min={saleDay || undefined}
              max={todayIso()}
              onChange={(e) => setDepositDate(e.target.value)}
              className="w-full h-11 px-3 rounded-[10px] border border-stroke/50 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            {invalidDate && (
              <p className="text-[11px] text-rose-600 leading-tight">
                The deposit date cannot be before the sale date or in the future.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-4 border-t border-stroke/30">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={onClose}
              className="h-11 px-4 text-xs font-semibold rounded-[10px] cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={invalidDate || saving}
              isLoading={saving}
              onClick={handleConfirm}
              className="h-11 px-5 text-xs font-semibold rounded-[10px] cursor-pointer"
            >
              <span>Mark as Deposited</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
