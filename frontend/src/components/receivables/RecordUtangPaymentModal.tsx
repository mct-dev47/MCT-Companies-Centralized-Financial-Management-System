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
  AlertCircle,
  User,
  Building,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import { cn } from '@/lib/utils'
import type {
  PersonLedgerSummary,
  UtangSale,
  PaymentMethod,
} from '@/services/receivablesStore'
import { bankService, isAccountOwnedBy, type BankAccount } from '@/services/bankService'

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
    company?: string
    company_id?: number
    bank_account_id?: string
    notes?: string
  }) => { success: boolean; message: string }
}

const METHODS: PaymentMethod[] = ['Cash', 'GCash', 'Bank Transfer', 'Payroll Deduction']

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
  const targetCompany = sale?.company || person?.company || ''
  const targetCompanyId = sale?.company_id || person?.company_id

  const [paymentMode, setPaymentMode] = React.useState<'partial' | 'full'>('partial')
  const [amountInput, setAmountInput] = React.useState<string>('')
  const [paymentDate, setPaymentDate] = React.useState<string>(() => formatToYYYYMMDD(new Date()))
  const [paymentCalendarMonth, setPaymentCalendarMonth] = React.useState<Date>(() => new Date())
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('Cash')
  const [selectedSaleId, setSelectedSaleId] = React.useState<string>(sale?.id || '')
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>([])
  const [selectedBankAccountId, setSelectedBankAccountId] = React.useState<string>('')
  const [notes, setNotes] = React.useState<string>('')
  const [error, setError] = React.useState<string>('')

  const unlockedPersonSales = React.useMemo(
    () => (person ? person.sales.filter((s) => s.balance > 0 && !s.is_locked) : []),
    [person]
  )

  const activeSelectedSale = React.useMemo(() => {
    if (sale) return sale
    if (selectedSaleId && person) {
      return person.sales.find((s) => s.id === selectedSaleId) || null
    }
    return null
  }, [sale, selectedSaleId, person])

  const totalAmount = React.useMemo(() => {
    if (activeSelectedSale) return activeSelectedSale.total_amount
    return person?.total_sales_amount || 0
  }, [activeSelectedSale, person])

  const totalPaidSoFar = React.useMemo(() => {
    if (activeSelectedSale) return activeSelectedSale.amount_paid
    return person?.total_amount_paid || 0
  }, [activeSelectedSale, person])

  const maxBalance = React.useMemo(() => {
    if (activeSelectedSale) {
      return activeSelectedSale.is_locked ? 0 : activeSelectedSale.balance
    }
    return unlockedPersonSales.reduce((acc, s) => acc + s.balance, 0)
  }, [activeSelectedSale, unlockedPersonSales])

  const paidDateSet = React.useMemo(() => {
    const set = new Set<string>()
    if (person?.payments) {
      person.payments.forEach((p) => {
        if (p.date) set.add(p.date.slice(0, 10))
      })
    }
    return set
  }, [person])

  React.useEffect(() => {
    if (!open) return
    let mounted = true
    const today = new Date()
    setPaymentMode('partial')
    setAmountInput('')
    setPaymentDate(formatToYYYYMMDD(today))
    setPaymentCalendarMonth(today)
    setPaymentMethod('Cash')
    setSelectedSaleId(sale?.id || '')
    setNotes('')
    setError('')

    const filterForCompany = (list: BankAccount[]) => {
      if (!targetCompany || targetCompany === 'All Companies') return list
      const matched = list.filter((a) => isAccountOwnedBy(a, targetCompany))
      if (matched.length > 0) return matched
      return list.filter(
        (a) =>
          !a.companyName ||
          a.companyName.toLowerCase().includes('general') ||
          a.companyName.toLowerCase().includes('unassigned')
      )
    }

    const cached = filterForCompany(bankService.getCachedAccounts(targetCompany))
    setBankAccounts(cached)
    setSelectedBankAccountId(cached.length > 0 ? cached[0].id : '')

    bankService
      .getAccounts(targetCompany)
      .then((accounts) => {
        if (!mounted) return
        const filtered = filterForCompany(accounts || [])
        setBankAccounts(filtered)
        setSelectedBankAccountId((prev) =>
          prev && filtered.some((b) => b.id === prev)
            ? prev
            : filtered.length > 0
              ? filtered[0].id
              : ''
        )
      })
      .catch(() => {})

    return () => {
      mounted = false
    }
  }, [open, person, sale, targetCompany])

  const numericAmount = parseFloat(amountInput) || 0
  const isAmountValid = numericAmount > 0 && numericAmount <= maxBalance + 0.005
  const remainingAfterPayment = Math.max(0, maxBalance - numericAmount)
  const willBeFullyPaid = isAmountValid && remainingAfterPayment <= 0.005

  const handleModeChange = (mode: 'partial' | 'full') => {
    setPaymentMode(mode)
    if (mode === 'full') {
      setAmountInput(String(maxBalance))
    } else {
      setAmountInput('')
    }
    setError('')
  }

  const handlePreset = (val: number) => {
    const capped = Math.min(val, maxBalance)
    setAmountInput(String(capped))
    setPaymentMode(Math.abs(capped - maxBalance) <= 0.005 ? 'full' : 'partial')
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
        `Payment amount (${formatPHP(numericAmount)}) cannot exceed unlocked balance (${formatPHP(maxBalance)}).`
      )
      return
    }

    const res = onRecordPayment({
      customer_name: customerName,
      amount: numericAmount,
      date: paymentDate,
      method: paymentMethod,
      sale_id: selectedSaleId || undefined,
      company: targetCompany || undefined,
      company_id: targetCompanyId,
      bank_account_id:
        paymentMethod !== 'Payroll Deduction' && selectedBankAccountId
          ? selectedBankAccountId
          : undefined,
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
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto bg-white rounded-[24px] p-5 sm:p-6 border border-stroke/30 shadow-2xl">
        <DialogHeader className="pb-3 border-b border-stroke/30 pr-8 text-left">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus">
                  Record Payment
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Record payment remittance for{' '}
                  <strong className="text-focus">{customerName}</strong> ({targetCompany || 'Receivables'}).
                </DialogDescription>
              </div>
            </div>

            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shadow-2xs',
                customerType === 'Staff'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              )}
            >
              {customerType === 'Staff' ? (
                <>
                  <User className="w-3.5 h-3.5 text-purple-600" />
                  <span>Staff Credit</span>
                </>
              ) : (
                <>
                  <Building className="w-3.5 h-3.5 text-blue-600" />
                  <span>External Customer</span>
                </>
              )}
            </span>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Left Column: Interactive Calendar Date Picker & Financial Summary */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-focus">
                    Payment Date <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[11px] font-mono font-bold text-focus">
                    {paymentDate ? `Selected: ${paymentDate}` : 'Please select date'}
                  </span>
                </div>

                <div className="border border-stroke/60 rounded-xl p-3.5 bg-white space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-focus">
                      {paymentCalendarMonth.toLocaleDateString('en-US', {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const prev = new Date(paymentCalendarMonth)
                          prev.setMonth(prev.getMonth() - 1)
                          setPaymentCalendarMonth(prev)
                        }}
                        className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Date(paymentCalendarMonth)
                          next.setMonth(next.getMonth() + 1)
                          setPaymentCalendarMonth(next)
                        }}
                        className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                        aria-label="Next month"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-muted-fg uppercase py-1 border-b border-slate-100">
                    <span>Su</span>
                    <span>Mo</span>
                    <span>Tu</span>
                    <span>We</span>
                    <span>Th</span>
                    <span>Fr</span>
                    <span>Sa</span>
                  </div>

                  {(() => {
                    const calYear = paymentCalendarMonth.getFullYear()
                    const calMonth = paymentCalendarMonth.getMonth()
                    const firstDay = new Date(calYear, calMonth, 1).getDay()
                    const totalDays = new Date(calYear, calMonth + 1, 0).getDate()

                    return (
                      <div className="grid grid-cols-7 gap-1 text-center">
                        {Array.from({ length: firstDay }).map((_, i) => (
                          <div key={`cal-empty-${i}`} className="h-8 sm:h-9" />
                        ))}

                        {Array.from({ length: totalDays }).map((_, i) => {
                          const d = i + 1
                          const dStr = String(d).padStart(2, '0')
                          const mStr = String(calMonth + 1).padStart(2, '0')
                          const dateStr = `${calYear}-${mStr}-${dStr}`
                          const isSelected = paymentDate === dateStr
                          const hasPriorPayment = paidDateSet.has(dateStr)

                          return (
                            <button
                              key={dateStr}
                              type="button"
                              onClick={() => {
                                setError('')
                                setPaymentDate(dateStr)
                              }}
                              className={cn(
                                'h-8 sm:h-9 rounded-lg text-xs font-medium flex flex-col items-center justify-center relative transition-all cursor-pointer',
                                isSelected &&
                                  'bg-[#960C01] text-white font-bold shadow-xs ring-2 ring-[#960C01]/30 z-10',
                                !isSelected &&
                                  hasPriorPayment &&
                                  'bg-emerald-50 text-emerald-800 border border-emerald-200/80 font-semibold',
                                !isSelected &&
                                  !hasPriorPayment &&
                                  'hover:bg-slate-100 text-focus hover:font-bold border border-transparent'
                              )}
                              title={
                                hasPriorPayment
                                  ? `${dateStr}: Prior payment recorded`
                                  : `Select ${dateStr}`
                              }
                            >
                              <span>{d}</span>
                              {hasPriorPayment && !isSelected && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute bottom-1" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-muted-fg px-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded bg-[#960C01]" />
                      <span>Selected</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded bg-emerald-500" />
                      <span>Prior Payment</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded bg-slate-200" />
                      <span>Available</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Financial Summary Cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-left">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-fg block">
                    Obligation
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-focus mt-0.5 block tabular-nums">
                    {formatPHP(totalAmount)}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/70 text-left">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 block">
                    Total Paid
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-emerald-900 mt-0.5 block tabular-nums">
                    {formatPHP(totalPaidSoFar)}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-left">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800 block">
                    Balance
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-amber-950 mt-0.5 block tabular-nums">
                    {formatPHP(maxBalance)}
                  </span>
                </div>
              </div>

              {/* Key Particulars Card */}
              <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/60 text-xs space-y-1.5 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-muted-fg uppercase font-medium">Account Holder</span>
                  <span className="font-semibold text-focus truncate max-w-[180px]">
                    {customerName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-muted-fg uppercase font-medium">Target Scope</span>
                  <span className="font-mono font-bold text-focus">
                    {activeSelectedSale ? `Order #${activeSelectedSale.id}` : 'All Unpaid Orders (FIFO)'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-muted-fg uppercase font-medium">Company</span>
                  <span className="font-medium text-focus truncate max-w-[180px]">
                    {targetCompany || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Payment Input Fields & Action Buttons */}
            <div className="space-y-4 text-left">
              {person && unlockedPersonSales.length > 1 && !sale && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus">Apply Payment To</Label>
                  <select
                    value={selectedSaleId}
                    onChange={(e) => {
                      setSelectedSaleId(e.target.value)
                      setAmountInput('')
                      setPaymentMode('partial')
                    }}
                    className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs text-focus font-medium focus:outline-none focus:ring-2 focus:ring-focus/20"
                  >
                    <option value="">Apply to oldest unpaid orders first (FIFO)</option>
                    {unlockedPersonSales.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.id} ({s.date}) — {formatPHP(s.balance)} due ({s.items_summary.slice(0, 30)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Payment Amount & Partial/Full Toggle */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-focus">
                    Payment Amount (PHP) <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => handleModeChange('partial')}
                      className={cn(
                        'px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer',
                        paymentMode === 'partial'
                          ? 'bg-white text-focus shadow-2xs font-bold'
                          : 'text-muted-fg hover:text-focus'
                      )}
                    >
                      Partial
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModeChange('full')}
                      className={cn(
                        'px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer',
                        paymentMode === 'full'
                          ? 'bg-[#960C01] text-white shadow-2xs font-bold'
                          : 'text-muted-fg hover:text-focus'
                      )}
                    >
                      Full
                    </button>
                  </div>
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
                    onWheel={(e) => e.currentTarget.blur()}
                    placeholder="0.00"
                    className="pl-8 h-11 text-base font-bold tabular-nums rounded-xl border-stroke/60 focus-visible:ring-2 focus-visible:ring-focus"
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {[200, 500, 1000, 5000].map((preset) => {
                    if (preset >= maxBalance) return null
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handlePreset(preset)}
                        className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-focus transition-colors cursor-pointer"
                      >
                        + ₱{preset.toLocaleString('en-US')}
                      </button>
                    )
                  })}
                  {maxBalance > 100 && (
                    <button
                      type="button"
                      onClick={() => handlePreset(Math.round(maxBalance / 2))}
                      className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-focus transition-colors cursor-pointer"
                    >
                      50%
                    </button>
                  )}
                  {maxBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => handlePreset(maxBalance)}
                      className="px-2.5 py-0.5 text-[10.5px] font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer"
                    >
                      Full Balance
                    </button>
                  )}
                </div>

                {numericAmount > 0 && isAmountValid && (
                  <div
                    className={cn(
                      'p-2.5 rounded-xl border flex items-center justify-between text-xs',
                      willBeFullyPaid
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50/70 border-amber-200 text-amber-900'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-fg" />
                      <span className="text-[11px]">
                        New balance:{' '}
                        <strong className="text-xs font-bold tabular-nums">
                          {formatPHP(remainingAfterPayment)}
                        </strong>
                      </span>
                    </div>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                        willBeFullyPaid
                          ? 'bg-emerald-200/80 text-emerald-800'
                          : 'bg-amber-200/80 text-amber-800'
                      )}
                    >
                      {willBeFullyPaid ? 'Fully Paid' : 'Partially Paid'}
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus">Payment Method</Label>
                <div className="flex flex-wrap gap-1.5">
                  {METHODS.filter((m) => customerType === 'Staff' || m !== 'Payroll Deduction').map(
                    (method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={cn(
                          'px-2.5 py-1 rounded-xl text-xs font-medium border transition-colors cursor-pointer',
                          paymentMethod === method
                            ? 'bg-[#960C01]/10 border-[#960C01] text-[#960C01] font-bold'
                            : 'bg-slate-50 border-stroke/50 text-focus/80 hover:bg-slate-100'
                        )}
                      >
                        {method}
                      </button>
                    )
                  )}
                </div>
              </div>

              {paymentMethod !== 'Payroll Deduction' && bankAccounts.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus">
                    Deposit Bank (Optional)
                  </Label>
                  <select
                    value={selectedBankAccountId}
                    onChange={(e) => setSelectedBankAccountId(e.target.value)}
                    className="w-full h-10 px-3 text-xs rounded-xl border border-stroke/60 bg-white focus:outline-none focus:ring-1 focus:ring-focus font-medium"
                  >
                    <option value="">Do not post bank deposit</option>
                    {bankAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} ({b.accountNumber})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-focus">Payment Notes (Optional)</Label>
                <Input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Cash received at cashier / GCash ref #8291"
                  className="h-10 text-xs rounded-xl border-stroke/60"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!isAmountValid}
                  className="h-10 px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm & Record Payment</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
