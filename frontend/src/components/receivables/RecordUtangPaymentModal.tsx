import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Coins,
  Check,
  Calendar,
  CreditCard,
  FileText,
  AlertCircle,
  ArrowRight,
  User,
  Building,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
  PersonLedgerSummary,
  UtangSale,
  PaymentMethod,
} from '@/services/receivablesStore'

export interface RecordUtangPaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: PersonLedgerSummary | null
  sale?: UtangSale | null
  onSuccess?: (message: string) => void
  onRecordPayment: (params: {
    customer_name: string
    amount: number
    date: string
    method: PaymentMethod
    sale_id?: string
    notes?: string
  }) => { success: boolean; message: string }
}

const METHODS: PaymentMethod[] = ['Cash', 'GCash', 'Bank']

export const RecordUtangPaymentModal: React.FC<RecordUtangPaymentModalProps> = ({
  open,
  onOpenChange,
  person,
  sale,
  onSuccess,
  onRecordPayment,
}) => {
  const customerName = person?.name || sale?.customer_name || ''
  const customerType = person?.type || sale?.customer_type || 'External'
  const maxBalance = sale ? sale.balance : person?.total_owed || 0

  const [amountInput, setAmountInput] = React.useState<string>('')
  const [paymentDate, setPaymentDate] = React.useState<string>('2026-11-02')
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('Cash')
  const [selectedSaleId, setSelectedSaleId] = React.useState<string>(sale?.id || '')
  const [notes, setNotes] = React.useState<string>('')
  const [error, setError] = React.useState<string>('')

  // Reset when modal opens
  React.useEffect(() => {
    if (open) {
      setAmountInput('')
      setPaymentDate('2026-11-02')
      setPaymentMethod('Cash')
      setSelectedSaleId(sale?.id || '')
      setNotes('')
      setError('')
    }
  }, [open, person, sale])

  const numericAmount = parseFloat(amountInput) || 0
  const isAmountValid = numericAmount > 0 && numericAmount <= maxBalance + 0.005
  const remainingAfterPayment = Math.max(0, maxBalance - numericAmount)

  const handlePreset = (val: number) => {
    const capped = Math.min(val, maxBalance)
    setAmountInput(String(capped))
    setError('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (numericAmount <= 0) {
      setError('Please enter a valid payment amount greater than zero.')
      return
    }

    if (numericAmount > maxBalance + 0.005) {
      setError(
        `Payment amount (${formatPHP(numericAmount)}) cannot exceed total balance (${formatPHP(maxBalance)}).`
      )
      return
    }

    const res = onRecordPayment({
      customer_name: customerName,
      amount: numericAmount,
      date: paymentDate,
      method: paymentMethod,
      sale_id: selectedSaleId || undefined,
      notes: notes.trim() || undefined,
    })

    if (!res.success) {
      setError(res.message)
      return
    }

    if (onSuccess) {
      onSuccess(res.message)
    }
    onOpenChange(false)
  }

  if (!person && !sale) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col bg-white rounded-[24px] p-5 sm:p-6 shadow-2xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="shrink-0 pb-3 border-b border-stroke/20 pr-8">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-600" />
                <span>Record Payment</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">
                Record remittance against food utang for{' '}
                <strong className="text-focus">{customerName}</strong>.
              </DialogDescription>
            </div>

            <span
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border',
                customerType === 'Staff'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              )}
            >
              {customerType === 'Staff' ? (
                <>
                  <User className="w-3 h-3 text-purple-600" />
                  <span>Staff Credit</span>
                </>
              ) : (
                <>
                  <Building className="w-3 h-3 text-blue-600" />
                  <span>External Customer</span>
                </>
              )}
            </span>
          </div>
        </DialogHeader>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 space-y-3.5 mt-2">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700 shrink-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0">
            {/* Balance Overview Card */}
            <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-center justify-between text-xs">
              <div>
                <span className="text-amber-800 font-medium block">
                  {sale ? `Balance for Sale ${sale.id}` : 'Total Outstanding Balance'}
                </span>
                <span className="text-lg font-bold text-amber-950 tabular-nums">
                  {formatPHP(maxBalance)}
                </span>
              </div>
              {numericAmount > 0 && isAmountValid && (
                <div className="text-right">
                  <span className="text-muted-fg text-[11px] block">New Balance</span>
                  <span className="text-sm font-bold text-focus tabular-nums">
                    {formatPHP(remainingAfterPayment)}
                  </span>
                </div>
              )}
            </div>

            {/* Specific Sale Selector (if person has multiple unpaid sales) */}
            {person && person.sales.filter((s) => s.balance > 0).length > 1 && !sale && (
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">Apply Payment To</Label>
                <select
                  value={selectedSaleId}
                  onChange={(e) => setSelectedSaleId(e.target.value)}
                  className="w-full h-9 sm:h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                >
                  <option value="">Apply to oldest unpaid sales first (FIFO)</option>
                  {person.sales
                    .filter((s) => s.balance > 0)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id} ({s.date}) — {formatPHP(s.balance)} due ({s.items_summary.slice(0, 30)}...)
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Amount Field + Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-focus">
                  Payment Amount (PHP) <span className="text-red-500">*</span>
                </Label>
                <span className="text-[11px] text-muted-fg">
                  Max: <strong className="text-focus">{formatPHP(maxBalance)}</strong>
                </span>
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-sm text-focus/70">
                  ₱
                </span>
                <Input
                  type="number"
                  step="any"
                  min="1"
                  max={maxBalance}
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value)
                    setError('')
                  }}
                  placeholder="0.00"
                  className="pl-8 h-10 text-base font-bold tabular-nums rounded-xl border-stroke/60 focus-visible:ring-2 focus-visible:ring-focus"
                  autoFocus
                />
              </div>

              {/* Presets */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                {[200, 500, 1000].map((preset) => {
                  if (preset >= maxBalance) return null
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handlePreset(preset)}
                      className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-focus transition-colors cursor-pointer"
                    >
                      + ₱{preset.toLocaleString()}
                    </button>
                  )
                })}
                {maxBalance > 100 && (
                  <button
                    type="button"
                    onClick={() => handlePreset(Math.round(maxBalance / 2))}
                    className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-focus transition-colors cursor-pointer"
                  >
                    50% ({formatPHP(Math.round(maxBalance / 2))})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handlePreset(maxBalance)}
                  className="px-2.5 py-0.5 text-[10.5px] font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer font-bold"
                >
                  Pay Full ({formatPHP(maxBalance)})
                </button>
              </div>
            </div>

            {/* Date & Payment Method */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0.5">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">
                  Payment Date <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg pointer-events-none" />
                  <Input
                    type="date"
                    required
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    max="2026-11-02"
                    className="pl-9 h-10 text-xs sm:text-sm rounded-xl border-stroke/60"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">Payment Method</Label>
                <div className="flex gap-1.5 pt-0.5">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={cn(
                        'flex-1 h-9 rounded-xl text-xs font-semibold border transition-all cursor-pointer',
                        paymentMethod === m
                          ? 'bg-[#960C01]/10 border-[#960C01] text-[#960C01] font-bold shadow-2xs'
                          : 'bg-white border-stroke/50 text-focus/70 hover:bg-slate-50'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Payment Notes */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus">Payment Notes (Optional)</Label>
              <Input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Cash received at cashier / GCash ref #8291"
                className="h-10 text-xs sm:text-sm rounded-xl border-stroke/60"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2.5 border-t border-slate-100 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 sm:h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isAmountValid}
              className="h-9 sm:h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Confirm & Record Payment</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

