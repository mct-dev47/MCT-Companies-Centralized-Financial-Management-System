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
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Check,
  FileText,
  AlertCircle,
  Building2,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { loanService, type LoanItem } from '@/services/loanService'
import { expenseService, type ExpenseItem } from '@/services/expenseService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

export interface RecordPaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loan?: LoanItem | null
  expense?: ExpenseItem | null
  onLoanPaid?: (updatedLoan: LoanItem) => void
  onExpensePaid?: (updatedExpense: ExpenseItem) => void
  onViewAuditDetails?: () => void
}

const PAYMENT_METHODS = [
  'Cash',
  'Bank Transfer',
  'Cheque',
  'GCash',
  'Maya',
  'In-house',
] as const

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  open,
  onOpenChange,
  loan,
  expense,
  onLoanPaid,
  onExpensePaid,
  onViewAuditDetails,
}) => {
  const isLoan = Boolean(loan)
  const isExpense = Boolean(!loan && expense)

  // Derived financials
  const totalAmount = isLoan
    ? loan?.amount || 0
    : expense?.withdrawal || expense?.netAmount || 0

  const totalPaidSoFar = isLoan
    ? loan?.totalPaid || 0
    : expense?.totalPaid || 0

  const outstandingBalance = isLoan
    ? (loan?.outstandingBalance !== undefined ? loan.outstandingBalance : Math.max(0, totalAmount - totalPaidSoFar))
    : (expense?.outstandingBalance !== undefined ? expense.outstandingBalance : Math.max(0, totalAmount - totalPaidSoFar))

  // Form states
  const [paymentMode, setPaymentMode] = React.useState<'partial' | 'full'>('partial')
  const [amountInput, setAmountInput] = React.useState<string>('')
  const [paymentDate, setPaymentDate] = React.useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [paymentCalendarMonth, setPaymentCalendarMonth] = React.useState<Date>(() => new Date())
  const [paymentMethod, setPaymentMethod] = React.useState<string>('Cash')
  const [referenceNo, setReferenceNo] = React.useState<string>('')
  const [notes, setNotes] = React.useState<string>('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [successBanner, setSuccessBanner] = React.useState<string | null>(null)

  // Reset or initialize on open
  React.useEffect(() => {
    if (open) {
      const today = new Date()
      setPaymentMode('partial')
      setAmountInput('')
      setPaymentDate(today.toISOString().slice(0, 10))
      setPaymentCalendarMonth(today)
      setPaymentMethod('Cash')
      setReferenceNo('')
      setNotes('')
      setError('')
      setSuccessBanner(null)
    }
  }, [open, loan, expense])

  // Handle Full payment mode switch
  const handleModeChange = (mode: 'partial' | 'full') => {
    setPaymentMode(mode)
    if (mode === 'full') {
      setAmountInput(String(outstandingBalance))
    } else {
      setAmountInput('')
    }
    setError('')
  }

  // Quick preset button handler
  const handlePresetAmount = (val: number) => {
    const capped = Math.min(val, outstandingBalance)
    setAmountInput(String(capped))
    if (capped === outstandingBalance) {
      setPaymentMode('full')
    } else {
      setPaymentMode('partial')
    }
    setError('')
  }

  const numericAmount = parseFloat(amountInput) || 0
  const projectedRemaining = Math.max(0, outstandingBalance - numericAmount)
  const willBeFullyPaid = numericAmount >= outstandingBalance && outstandingBalance > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (numericAmount <= 0) {
      setError('Please enter a valid payment amount greater than zero.')
      return
    }

    if (numericAmount > outstandingBalance) {
      setError(
        `Payment amount (${formatPHP(numericAmount)}) cannot exceed remaining balance (${formatPHP(outstandingBalance)}).`
      )
      return
    }

    setIsSubmitting(true)
    try {
      if (isLoan && loan) {
        const updated = await loanService.recordRepayment(loan.id, {
          amount: numericAmount,
          paymentDate,
          referenceNo: referenceNo.trim() || undefined,
          paymentMethod,
          notes: notes.trim() || undefined,
        })
        setSuccessBanner(`Payment of ${formatPHP(numericAmount)} successfully recorded!`)
        if (onLoanPaid) onLoanPaid(updated)
        setTimeout(() => {
          onOpenChange(false)
        }, 800)
      } else if (isExpense && expense) {
        const updated = await expenseService.recordExpensePayment(expense.id, {
          amount: numericAmount,
          paymentDate,
          referenceNo: referenceNo.trim() || undefined,
          paymentMethod,
          notes: notes.trim() || undefined,
        })
        setSuccessBanner(`Payment of ${formatPHP(numericAmount)} successfully recorded!`)
        if (onExpensePaid) onExpensePaid(updated)
        setTimeout(() => {
          onOpenChange(false)
        }, 800)
      }
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to record payment. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!loan && !expense) return null

  // Badging helper
  const getStatusBadge = () => {
    const st = isLoan ? loan?.status : expense?.status
    if (st === 'Paid' || outstandingBalance <= 0) {
      return {
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
        icon: CheckCircle2,
        label: 'Fully Paid / Settled',
      }
    }
    if (st === 'Partially Paid' || totalPaidSoFar > 0) {
      return {
        bg: 'bg-amber-50 text-amber-700 border-amber-200/80',
        icon: Clock,
        label: 'Partially Paid',
      }
    }
    if (st === 'Overdue') {
      return {
        bg: 'bg-red-50 text-red-700 border-red-200/80',
        icon: AlertTriangle,
        label: 'Overdue',
      }
    }
    return {
      bg: 'bg-amber-50 text-amber-700 border-amber-200/80',
      icon: Clock,
      label: st || 'Pending Repayment',
    }
  }

  const statusBadge = getStatusBadge()
  const StatusIcon = statusBadge.icon

  // Previous repayments list
  const repaymentsHistory = isLoan
    ? loan?.repayments || []
    : expense?.repayments || []

  const targetName = isLoan
    ? (loan?.borrower || loan?.lender || loan?.particulars || loan?.refNo)
    : (expense?.particulars || expense?.vendor || expense?.refNo)

  const targetDetail = isLoan
    ? (loan?.refNo ? `Ref: ${loan.refNo}` : 'Loan Facility')
    : (expense?.refNo ? `Ref: ${expense.refNo}` : 'Expense')

  // Set of dates that have recorded payments
  const paidDateSet = new Set<string>()
  repaymentsHistory.forEach((r) => {
    if (r.paymentDate) {
      paidDateSet.add(r.paymentDate.slice(0, 10))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[840px] md:max-w-[890px] max-h-[85vh] sm:max-h-[82vh] overflow-y-auto bg-white rounded-[24px] p-5 sm:p-6 shadow-2xl">
        {/* Header (Matching JK Account) */}
        <DialogHeader className="text-left pb-3 border-b border-stroke/20">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-600" />
                <span>Record Payment</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">
                Record payment remittance for{' '}
                <strong className="text-focus">{targetName}</strong> ({targetDetail}).
              </DialogDescription>
            </div>

            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shadow-2xs',
                statusBadge.bg
              )}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              <span>{statusBadge.label}</span>
            </div>
          </div>
        </DialogHeader>

        {/* Success Banner */}
        {successBanner && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}

        {/* Two-Column Form Layout: Left = Calendar & Metrics, Right = Payment Details */}
        {outstandingBalance > 0 ? (
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
                {/* Calendar Date Picker */}
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
                    {/* Month Header & Navigation */}
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-bold text-focus">
                        {paymentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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

                    {/* Weekday labels */}
                    <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-muted-fg uppercase py-1 border-b border-slate-100">
                      <span>Su</span>
                      <span>Mo</span>
                      <span>Tu</span>
                      <span>We</span>
                      <span>Th</span>
                      <span>Fr</span>
                      <span>Sa</span>
                    </div>

                    {/* Days Grid */}
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

                    {/* Calendar Legend */}
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
                      {formatPHP(outstandingBalance)}
                    </span>
                  </div>
                </div>

                {/* Key Particulars Card */}
                <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/60 text-xs space-y-1.5 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-muted-fg uppercase font-medium">Ref No.</span>
                    <span className="font-mono font-bold text-focus">
                      {isLoan ? loan?.refNo : expense?.refNo}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-muted-fg uppercase font-medium">
                      {isLoan ? 'Lender / Counterparty' : 'Particulars'}
                    </span>
                    <span className="font-semibold text-focus truncate max-w-[180px]">
                      {isLoan ? loan?.lender || '—' : expense?.particulars || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-muted-fg uppercase font-medium">
                      {isLoan ? 'Due Date' : 'Category'}
                    </span>
                    <span className="font-medium text-focus">
                      {isLoan ? loan?.dueDate || '—' : expense?.category || '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Payment Input Fields & Action Buttons */}
              <div className="space-y-4 text-left">
                {/* Repayment Amount & Mode Toggle */}
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
                      max={outstandingBalance}
                      value={amountInput}
                      onChange={(e) => {
                        setAmountInput(e.target.value)
                        setError('')
                      }}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0.00"
                      className="pl-8 h-11 text-base font-bold tabular-nums rounded-xl border-stroke/60 focus-visible:ring-2 focus-visible:ring-focus [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      autoFocus
                    />
                  </div>

                  {/* Preset Buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {[5000, 10000, 25000, 50000].map((preset) => {
                      if (preset >= outstandingBalance) return null
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handlePresetAmount(preset)}
                          className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-focus transition-colors cursor-pointer"
                        >
                          + ₱{preset.toLocaleString('en-US')}
                        </button>
                      )
                    })}
                    {outstandingBalance > 1000 && (
                      <button
                        type="button"
                        onClick={() => handlePresetAmount(Math.round(outstandingBalance / 2))}
                        className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-focus transition-colors cursor-pointer"
                      >
                        50%
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePresetAmount(outstandingBalance)}
                      className="px-2 py-0.5 text-[10.5px] font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer"
                    >
                      Full Balance
                    </button>
                  </div>

                  {/* Projected Balance Preview Banner */}
                  {numericAmount > 0 && numericAmount <= outstandingBalance && (
                    <div
                      className={cn(
                        'p-2.5 rounded-xl border flex items-center justify-between text-xs',
                        willBeFullyPaid
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                          : 'bg-blue-50/70 border-blue-200 text-blue-900'
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-fg" />
                        <span className="text-[11px]">
                          New balance:{' '}
                          <strong className="text-xs font-bold tabular-nums">
                            {formatPHP(projectedRemaining)}
                          </strong>
                        </span>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                          willBeFullyPaid
                            ? 'bg-emerald-200/80 text-emerald-800'
                            : 'bg-blue-200/80 text-blue-800'
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
                    {PAYMENT_METHODS.map((method) => (
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
                    ))}
                  </div>
                </div>

                {/* Reference No / Cheque No */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus">
                    Reference / Cheque No. (Optional)
                  </Label>
                  <Input
                    type="text"
                    placeholder="e.g. OR-84920 or CHQ-1092"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className="h-10 text-xs rounded-xl border-stroke/60 font-mono"
                  />
                </div>

                {/* Remarks / Notes */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus">Payment Notes (Optional)</Label>
                  <Input
                    type="text"
                    placeholder="e.g. Regular payment installment"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="h-10 text-xs rounded-xl border-stroke/60"
                  />
                </div>

                {/* Form Action Buttons (Matching JK / FilCap emerald button layout) */}
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-stroke/20">
                  <div>
                    {onViewAuditDetails && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onViewAuditDetails}
                        className="h-10 px-3 rounded-xl text-xs font-semibold text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center gap-1.5"
                        title="Open full audit record & transaction log"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Audit Details</span>
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      className="h-10 px-4 rounded-xl border-stroke/60 text-xs font-medium cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting || numericAmount <= 0 || numericAmount > outstandingBalance}
                      className="h-10 px-5 rounded-xl bg-primary hover:bg-primary-hover active:bg-primary-active text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Recording...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm & Record Payment</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </form>
        ) : (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-bold">This obligation is completely settled!</p>
                <p className="text-emerald-700/90 text-[11px] mt-0.5">
                  The remaining balance is ₱0.00. No further payments are required.
                </p>
              </div>
            </div>
            {onViewAuditDetails && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onViewAuditDetails}
                className="h-8 px-3 rounded-lg text-xs font-semibold bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-100 cursor-pointer shrink-0"
              >
                Audit Details
              </Button>
            )}
          </div>
        )}

        {/* Repayment History Timeline */}
        <div className="pt-4 border-t border-stroke/20 mt-4 text-left">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-fg">
              Repayment History ({repaymentsHistory.length})
            </h4>
            {repaymentsHistory.length > 0 && (
              <span className="text-[11px] text-muted-fg font-medium">
                Latest transactions on record
              </span>
            )}
          </div>

          {repaymentsHistory.length === 0 ? (
            <div className="py-4 px-4 rounded-xl bg-slate-50 border border-slate-100 text-center text-xs text-muted-fg">
              No previous repayments recorded yet for this item.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200/80">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold text-muted-fg border-b border-slate-200/80">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Ref No.</th>
                    <th className="py-2.5 px-3 text-right">Amount Paid</th>
                    <th className="py-2.5 px-3 text-right">Balance</th>
                    <th className="py-2.5 px-3">Method / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {repaymentsHistory.map((rep, idx) => (
                    <tr key={rep.id || idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-medium text-focus whitespace-nowrap">
                        {rep.paymentDate}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-muted-fg whitespace-nowrap">
                        {rep.referenceNo || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-600 tabular-nums whitespace-nowrap">
                        {formatPHP(rep.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-focus tabular-nums whitespace-nowrap">
                        {formatPHP(rep.remainingBalance)}
                      </td>
                      <td className="py-2.5 px-3 text-muted-fg max-w-[150px] truncate">
                        {rep.notes || rep.paymentMethod || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
