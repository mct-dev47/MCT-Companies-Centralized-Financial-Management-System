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
  UtensilsCrossed,
  Check,
  Calendar,
  AlertCircle,
  User,
  Building,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { cn } from '@/lib/utils'
import type {
  CustomerType,
  PaymentOption,
  PaymentMethod,
  PersonLedgerSummary,
  UtangSale,
} from '@/services/receivablesStore'

export interface NewFoodSaleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingPeople: PersonLedgerSummary[]
  onSuccess?: (sale: UtangSale) => void
  onAddNewSale: (params: {
    customer_name: string
    customer_type: CustomerType
    items_summary: string
    total_amount: number
    payment_option: PaymentOption
    amount_paid?: number
    payment_method?: PaymentMethod
    date?: string
    notes?: string
  }) => UtangSale
}

export const NewFoodSaleModal: React.FC<NewFoodSaleModalProps> = ({
  open,
  onOpenChange,
  existingPeople,
  onSuccess,
  onAddNewSale,
}) => {
  const todayIso = React.useMemo(() => formatToYYYYMMDD(new Date()), [])
  const [customerType, setCustomerType] = React.useState<CustomerType>('External')
  const [selectedPersonName, setSelectedPersonName] = React.useState<string>('')
  const [customName, setCustomName] = React.useState<string>('')
  const [itemsSummary, setItemsSummary] = React.useState<string>('')
  const [totalAmountInput, setTotalAmountInput] = React.useState<string>('')
  const [paymentOption, setPaymentOption] = React.useState<PaymentOption>('Paid in full')
  const [amountPaidInput, setAmountPaidInput] = React.useState<string>('')
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('Cash')
  const [saleDate, setSaleDate] = React.useState<string>(() => formatToYYYYMMDD(new Date()))
  const [notes, setNotes] = React.useState<string>('')
  const [error, setError] = React.useState<string>('')

  const filteredPeople = React.useMemo(() => {
    return existingPeople.filter((p) => p.type === customerType)
  }, [existingPeople, customerType])

  React.useEffect(() => {
    if (open) {
      setCustomerType('External')
      setSelectedPersonName('')
      setCustomName('')
      setItemsSummary('')
      setTotalAmountInput('')
      setPaymentOption('Paid in full')
      setAmountPaidInput('')
      setPaymentMethod('Cash')
      setSaleDate(formatToYYYYMMDD(new Date()))
      setNotes('')
      setError('')
    }
  }, [open])

  const totalAmount = parseFloat(totalAmountInput) || 0
  const amountPaid = parseFloat(amountPaidInput) || 0

  const computedBalance = React.useMemo(() => {
    if (paymentOption === 'Paid in full') return 0
    if (paymentOption === 'Pay Later') return totalAmount
    return Math.max(0, totalAmount - amountPaid)
  }, [paymentOption, totalAmount, amountPaid])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const finalName =
      selectedPersonName === '__NEW__' || !selectedPersonName
        ? customName.trim()
        : selectedPersonName.trim()

    if (!finalName) {
      setError('Please select or enter the customer or staff member name.')
      return
    }

    if (!itemsSummary.trim()) {
      setError('Please enter the food items or meals ordered.')
      return
    }

    if (totalAmount <= 0) {
      setError('Please enter a valid total sale amount greater than zero.')
      return
    }

    if (paymentOption === 'Partial') {
      if (amountPaid <= 0) {
        setError('For partial payments, the amount paid must be greater than zero.')
        return
      }
      if (amountPaid >= totalAmount) {
        setError('Partial payment amount cannot equal or exceed total amount. Select "Paid in full" instead.')
        return
      }
    }

    const newSale = onAddNewSale({
      customer_name: finalName,
      customer_type: customerType,
      items_summary: itemsSummary.trim(),
      total_amount: totalAmount,
      payment_option: paymentOption,
      amount_paid:
        paymentOption === 'Paid in full'
          ? totalAmount
          : paymentOption === 'Partial'
            ? amountPaid
            : 0,
      payment_method: paymentOption !== 'Pay Later' ? paymentMethod : undefined,
      date: saleDate,
      notes: notes.trim() || undefined,
    })

    if (onSuccess) {
      onSuccess(newSale)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] flex flex-col bg-white rounded-[24px] p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-stroke/20 pr-8 text-left">
          <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 text-emerald-600" />
            <span>New Food Sale</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-fg mt-0.5">
            Record a daily food sale with instant payment or credit (utang) options.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 space-y-3.5 mt-2">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700 shrink-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 text-left">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus">Customer Type</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCustomerType('External')
                    setSelectedPersonName('')
                  }}
                  className={cn(
                    'flex-1 h-9 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all cursor-pointer',
                    customerType === 'External'
                      ? 'bg-blue-50 border-blue-300 text-blue-800 shadow-2xs font-bold'
                      : 'bg-white border-stroke/50 text-focus/70 hover:bg-slate-50'
                  )}
                >
                  <Building className="w-3.5 h-3.5 text-blue-600" />
                  <span>External Customer</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerType('Staff')
                    setSelectedPersonName('')
                  }}
                  className={cn(
                    'flex-1 h-9 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition-all cursor-pointer',
                    customerType === 'Staff'
                      ? 'bg-purple-50 border-purple-300 text-purple-800 shadow-2xs font-bold'
                      : 'bg-white border-stroke/50 text-focus/70 hover:bg-slate-50'
                  )}
                >
                  <User className="w-3.5 h-3.5 text-purple-600" />
                  <span>Staff</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">
                  {customerType === 'Staff' ? 'Staff Member' : 'Customer Name'}{' '}
                  <span className="text-red-500">*</span>
                </Label>
                <select
                  value={selectedPersonName}
                  onChange={(e) => setSelectedPersonName(e.target.value)}
                  className="w-full h-9 sm:h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                >
                  <option value="">Select from existing {customerType.toLowerCase()} list...</option>
                  {filteredPeople.map((p) => (
                    <option key={p.key} value={p.name}>
                      {p.name} {p.total_owed > 0 ? `(Owes ₱${p.total_owed.toLocaleString()})` : '(No utang)'}
                    </option>
                  ))}
                  <option value="__NEW__">+ Enter new {customerType.toLowerCase()} name...</option>
                </select>
              </div>

              {(selectedPersonName === '__NEW__' || !selectedPersonName) && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus">
                    Type Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    required
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. Maria Santos or Mang Jose"
                    className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl border-stroke/60"
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus">
                Food Items / Order Summary <span className="text-red-500">*</span>
              </Label>
              <Input
                type="text"
                required
                value={itemsSummary}
                onChange={(e) => setItemsSummary(e.target.value)}
                placeholder="e.g. Pork Sisig Rice Meal (x2), Iced Tea (x2)"
                className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl border-stroke/60"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">
                  Total Sale Amount (PHP) <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-sm text-focus/70">
                    ₱
                  </span>
                  <Input
                    type="number"
                    step="any"
                    min="1"
                    required
                    value={totalAmountInput}
                    onChange={(e) => setTotalAmountInput(e.target.value)}
                    placeholder="0.00"
                    className="pl-8 h-9 sm:h-10 text-sm font-bold tabular-nums rounded-xl border-stroke/60"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">
                  Sale Date <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg pointer-events-none" />
                  <Input
                    type="date"
                    required
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    max={todayIso}
                    className="pl-9 h-9 sm:h-10 text-xs sm:text-sm rounded-xl border-stroke/60"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <Label className="text-xs font-semibold text-focus">
                Payment Option <span className="text-red-500">*</span>
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {(['Paid in full', 'Partial', 'Pay Later'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setPaymentOption(opt)
                      setError('')
                    }}
                    className={cn(
                      'h-10 rounded-xl text-xs font-semibold border flex flex-col items-center justify-center transition-all cursor-pointer p-1 text-center',
                      paymentOption === opt
                        ? opt === 'Paid in full'
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-bold shadow-2xs'
                          : opt === 'Partial'
                            ? 'bg-amber-50 border-amber-400 text-amber-800 font-bold shadow-2xs'
                            : 'bg-rose-50 border-rose-400 text-rose-800 font-bold shadow-2xs'
                        : 'bg-white border-stroke/50 text-focus/70 hover:bg-slate-50'
                    )}
                  >
                    <span>{opt}</span>
                    <span className="text-[10px] font-normal opacity-75">
                      {opt === 'Paid in full' ? 'Paid now' : opt === 'Partial' ? 'Deposit' : 'Utang'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {paymentOption === 'Partial' && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-amber-900">
                      Amount Paid Now (PHP) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      type="number"
                      step="any"
                      min="1"
                      max={totalAmount > 0 ? totalAmount - 1 : undefined}
                      required
                      value={amountPaidInput}
                      onChange={(e) => setAmountPaidInput(e.target.value)}
                      placeholder="0.00"
                      className="h-9 text-xs sm:text-sm font-bold bg-white rounded-xl"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-amber-900">Payment Method</Label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full h-9 px-3 rounded-xl border border-amber-300 bg-white text-xs sm:text-sm text-focus"
                    >
                      <option value="Cash">Cash</option>
                      <option value="GCash">GCash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1 border-t border-amber-200/80">
                  <span className="text-amber-800">Remaining Balance (Utang):</span>
                  <span className="font-bold text-amber-950 text-sm tabular-nums">
                    {formatPHP(computedBalance)}
                  </span>
                </div>
              </div>
            )}

            {paymentOption === 'Paid in full' && (
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">Payment Method</Label>
                <div className="flex gap-1.5">
                  {(['Cash', 'GCash', 'Bank Transfer'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={cn(
                        'flex-1 h-9 rounded-xl text-xs font-semibold border transition-all cursor-pointer',
                        paymentMethod === m
                          ? 'bg-emerald-50 border-emerald-400 text-emerald-800 font-bold shadow-2xs'
                          : 'bg-white border-stroke/50 text-focus/70 hover:bg-slate-50'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {paymentOption === 'Pay Later' && (
              <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl flex items-center justify-between text-xs text-rose-900">
                <span>Total amount will be recorded as Unpaid credit (Utang):</span>
                <span className="font-bold text-sm tabular-nums">{formatPHP(totalAmount)}</span>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus">Sale Notes (Optional)</Label>
              <Input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Dine in table 4 / takeaway for break / promised pay on Friday"
                className="h-9 sm:h-10 text-xs sm:text-sm rounded-xl border-stroke/60"
              />
            </div>
          </div>

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
              className="h-9 sm:h-10 px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Record Food Sale</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
