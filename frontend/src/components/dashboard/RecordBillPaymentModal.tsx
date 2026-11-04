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
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Coins,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import {
  billsService,
  getBillPaymentOptions,
  type BillItem,
  type BillPaymentPeriod,
} from '@/services/billsService'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

export interface RecordBillPaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bill: BillItem | null
  onBillPaid?: (updatedBill: BillItem) => void
}

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export const MONTH_FULL_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const RecordBillPaymentModal: React.FC<RecordBillPaymentModalProps> = ({
  open,
  onOpenChange,
  bill,
  onBillPaid,
}) => {
  const getTodayIso = () => formatToYYYYMMDD(new Date())

  // Form states
  const [paymentDate, setPaymentDate] = React.useState<string>(getTodayIso())
  const [selectedPeriod, setSelectedPeriod] = React.useState<BillPaymentPeriod | null>(null)
  const [amountInput, setAmountInput] = React.useState<string>('')
  const [isInstallment, setIsInstallment] = React.useState<boolean>(false)
  const [totalBilledInput, setTotalBilledInput] = React.useState<string>('')
  const [paymentMethod, setPaymentMethod] = React.useState<string>('Cash')
  const [referenceNo, setReferenceNo] = React.useState<string>('')
  const [notes, setNotes] = React.useState<string>('')

  // Period selector navigation states
  const [selectedYear, setSelectedYear] = React.useState<number>(() => new Date().getFullYear())
  const [dailyCalendarMonth, setDailyCalendarMonth] = React.useState<Date>(() => new Date())

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [successBanner, setSuccessBanner] = React.useState<string | null>(null)

  // Initialize modal state on open
  React.useEffect(() => {
    if (open && bill) {
      const options = getBillPaymentOptions(bill)
      const nextP = options.nextPayable

      setSelectedPeriod(nextP)
      setPaymentDate(getTodayIso())

      if (nextP?.partiallyPaid) {
        setIsInstallment(false)
        setTotalBilledInput(String(nextP.billedAmount || ''))
        setAmountInput(String(nextP.remainingAmount || ''))
      } else {
        setIsInstallment(false)
        setTotalBilledInput('')
        const defaultAmt = nextP?.billedAmount
          ? String(nextP.billedAmount)
          : bill.latestAmount
          ? String(bill.latestAmount)
          : bill.amount > 0
          ? String(bill.amount)
          : ''
        setAmountInput(defaultAmt)
      }

      // Sync selector navigation
      const baseDate = new Date(`${nextP?.periodDate || bill.dueDate}T00:00:00`)
      const yr = !isNaN(baseDate.getFullYear()) ? baseDate.getFullYear() : new Date().getFullYear()
      setSelectedYear(yr)
      setDailyCalendarMonth(new Date(yr, !isNaN(baseDate.getMonth()) ? baseDate.getMonth() : new Date().getMonth(), 1))

      setPaymentMethod('Cash')
      setReferenceNo('')
      setNotes('')
      setError('')
      setSuccessBanner(null)
      setIsSubmitting(false)
    }
  }, [open, bill])

  if (!bill) return null

  const options = getBillPaymentOptions(bill)
  const allPeriods = options.periods
  const nextPayable = options.nextPayable
  const todayStr = getTodayIso()

  // Calculate remaining balance for currently selected period
  const isPeriodPaid = Boolean(selectedPeriod?.paid)
  const isPeriodPartiallyPaid = Boolean(selectedPeriod?.partiallyPaid)

  const periodRemainingBalance = isPeriodPartiallyPaid
    ? (selectedPeriod?.remainingAmount ?? 0)
    : isPeriodPaid
    ? 0
    : Infinity

  const parsedAmount = parseFloat(amountInput)
  const parsedTotalBilled = parseFloat(totalBilledInput)

  let amountInputError: string | null = null
  if (amountInput.trim()) {
    if (isNaN(parsedAmount) || parsedAmount < 1) {
      amountInputError = 'Payment amount must be at least ₱1.00.'
    } else if (isPeriodPartiallyPaid && periodRemainingBalance > 0 && parsedAmount > periodRemainingBalance + 0.005) {
      amountInputError = `Payment amount cannot exceed the remaining balance of ${formatPHP(periodRemainingBalance)}.`
    } else if (isInstallment && !isNaN(parsedTotalBilled) && parsedTotalBilled > 0 && parsedAmount > parsedTotalBilled + 0.005) {
      amountInputError = `Payment amount cannot exceed the total amount of ${formatPHP(parsedTotalBilled)}.`
    } else if (!isInstallment && selectedPeriod?.billedAmount && selectedPeriod.billedAmount > 0 && parsedAmount > selectedPeriod.billedAmount + 0.005) {
      amountInputError = `Payment amount cannot exceed the remaining balance of ${formatPHP(selectedPeriod.billedAmount)}.`
    }
  }

  let isAmountValid = false
  let willBePartiallyPaid = false

  if (isPeriodPartiallyPaid) {
    isAmountValid = !isNaN(parsedAmount) && parsedAmount >= 1 && !amountInputError
    willBePartiallyPaid = isAmountValid && parsedAmount < periodRemainingBalance - 0.005
  } else if (isInstallment) {
    isAmountValid =
      !isNaN(parsedTotalBilled) &&
      parsedTotalBilled >= 1 &&
      !isNaN(parsedAmount) &&
      parsedAmount >= 1 &&
      !amountInputError
    willBePartiallyPaid = isAmountValid && parsedAmount < parsedTotalBilled - 0.005
  } else {
    isAmountValid = !isNaN(parsedAmount) && parsedAmount >= 1 && !amountInputError
    willBePartiallyPaid = false
  }

  // Period state resolver helper
  const getPeriodState = (period: BillPaymentPeriod) => {
    if (period.paid) return 'paid'
    if (period.partiallyPaid) return 'partial'
    const pDate = period.periodDate || period.key
    if (pDate < todayStr && !period.isFuture) return 'overdue'
    if (period.isFuture) return 'advance'
    return 'current'
  }

  // Handle clicking a period in the picker
  const handleSelectPeriod = (period: BillPaymentPeriod) => {
    setError('')
    if (period.paid) {
      setError(`The ${period.label} billing period is already fully settled.`)
      return
    }

    const exists = allPeriods.find((p) => p.key === period.key)
    if (!exists) {
      setError(`The ${period.label} period is not an active billing cycle for this bill.`)
      return
    }

    // Check backlog: cannot select a period later than nextPayable if nextPayable is still unpaid
    if (nextPayable && period.key > nextPayable.key && !nextPayable.paid) {
      setError(`Please settle ${nextPayable.label} first before paying ${period.label}.`)
      return
    }

    setSelectedPeriod(period)

    if (period.partiallyPaid) {
      setIsInstallment(false)
      setTotalBilledInput(String(period.billedAmount || ''))
      setAmountInput(String(period.remainingAmount || ''))
    } else {
      setIsInstallment(false)
      setTotalBilledInput('')
      const defaultAmt = period.billedAmount
        ? String(period.billedAmount)
        : bill.latestAmount
        ? String(bill.latestAmount)
        : bill.amount > 0
        ? String(bill.amount)
        : ''
      setAmountInput(defaultAmt)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!paymentDate) {
      setError('Please provide a valid Payment Date (date you paid the bill).')
      return
    }

    if (!selectedPeriod) {
      setError('Please select a Billing Period to settle.')
      return
    }

    if (isPeriodPaid) {
      setError('This billing period is already fully paid.')
      return
    }

    if (amountInputError) {
      setError(amountInputError)
      return
    }

    if (!isAmountValid) {
      if (isPeriodPartiallyPaid && periodRemainingBalance > 0 && parsedAmount > periodRemainingBalance) {
        setError(`Payment amount cannot exceed the remaining balance of ${formatPHP(periodRemainingBalance)}.`)
      } else if (isInstallment && !isNaN(parsedTotalBilled) && parsedAmount > parsedTotalBilled) {
        setError(`Payment amount cannot exceed the total amount of ${formatPHP(parsedTotalBilled)}.`)
      } else {
        setError('Please provide a valid payment amount.')
      }
      return
    }

    const billedAmountToPass = isPeriodPartiallyPaid
      ? selectedPeriod.billedAmount
      : isInstallment
      ? parsedTotalBilled
      : parsedAmount

    try {
      setIsSubmitting(true)
      const updated = await billsService.recordPayment(bill.id, {
        periodKey: selectedPeriod.key,
        paymentDate,
        amount: parsedAmount,
        billedAmount: billedAmountToPass,
        paymentMethod,
        refNo: referenceNo.trim() || undefined,
        referenceNo: referenceNo.trim() || undefined,
        notes: notes.trim() || undefined,
      })

      const isFull = !willBePartiallyPaid
      setSuccessBanner(
        isFull
          ? `Full payment of ${formatPHP(parsedAmount)} recorded for ${selectedPeriod.label}! Period marked as Paid.`
          : `Installment of ${formatPHP(parsedAmount)} recorded for ${selectedPeriod.label}! Period marked as Partially Paid.`
      )

      if (onBillPaid) {
        onBillPaid(updated)
      }

      setTimeout(() => {
        onOpenChange(false)
      }, 700)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Unable to record payment remittance. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const periodCadenceLabel =
    bill.billingCycle === 'Daily'
      ? 'Billing Day'
      : bill.billingCycle === 'Yearly'
      ? 'Billing Year'
      : 'Billing Month'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[880px] md:max-w-[940px] max-h-[88vh] overflow-y-auto bg-white rounded-[24px] p-6 sm:p-7 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-600" />
            <span>Record Bill Payment</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-fg">
            Record payment remittance for <strong className="text-focus">{bill.billerName}</strong> ({bill.company} • {bill.billingCycle} Schedule).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Error Banner */}
          {error && (
            <div className="p-3 bg-[#960C01]/10 border border-[#960C01]/30 rounded-xl flex items-start gap-2 text-xs text-[#960C01]">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#960C01] mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Banner */}
          {successBanner && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successBanner}</span>
            </div>
          )}

          {/* Two-Column Layout: Left = Billing Period Picker, Right = Payment Transaction Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {/* Left Column: Adaptive Period Picker */}
            <div className="space-y-3">
              {/* Selected Billing Period Summary Box (Target Billing Month/Day/Year) */}
              {selectedPeriod && (
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-fg uppercase tracking-wider">
                      Target {periodCadenceLabel}
                    </span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-bold border',
                        isPeriodPaid && 'bg-emerald-50 text-emerald-800 border-emerald-200',
                        isPeriodPartiallyPaid && 'bg-amber-50 text-amber-900 border-amber-300',
                        !isPeriodPaid && !isPeriodPartiallyPaid && 'bg-slate-100 text-slate-700 border-slate-200'
                      )}
                    >
                      {isPeriodPaid ? 'Fully Settled' : isPeriodPartiallyPaid ? 'Partially Paid' : 'Pending Settlement'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between pt-0.5">
                    <span className="text-sm sm:text-base font-bold text-focus">
                      {selectedPeriod.label}
                    </span>
                    {isPeriodPartiallyPaid && (
                      <span className="text-xs font-semibold text-focus tabular-nums">
                        Remaining: <strong className="text-sm font-bold text-focus">{formatPHP(periodRemainingBalance)}</strong>
                      </span>
                    )}
                  </div>
                  {isPeriodPartiallyPaid && selectedPeriod.paidAmount !== undefined && (
                    <p className="text-[11px] text-amber-800 font-medium">
                      Already paid: {formatPHP(selectedPeriod.paidAmount)} of {selectedPeriod.billedAmount ? formatPHP(selectedPeriod.billedAmount) : formatPHP(bill.amount)}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-focus">
                  Select {periodCadenceLabel} <span className="text-[#960C01]">*</span>
                </label>
                <span className="text-[11px] font-semibold text-focus/80">
                  {selectedPeriod ? selectedPeriod.label : 'Select period'}
                </span>
              </div>

              {/* 1. Daily Calendar Picker */}
              {bill.billingCycle === 'Daily' && (
                <div className="border border-stroke/60 rounded-2xl p-3.5 bg-white space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-focus">
                      {dailyCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const prev = new Date(dailyCalendarMonth)
                          prev.setMonth(prev.getMonth() - 1)
                          setDailyCalendarMonth(prev)
                        }}
                        className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Date(dailyCalendarMonth)
                          next.setMonth(next.getMonth() + 1)
                          setDailyCalendarMonth(next)
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
                    const calYear = dailyCalendarMonth.getFullYear()
                    const calMonth = dailyCalendarMonth.getMonth()
                    const firstDay = new Date(calYear, calMonth, 1).getDay()
                    const totalDays = new Date(calYear, calMonth + 1, 0).getDate()

                    return (
                      <div className="grid grid-cols-7 gap-1 text-center">
                        {Array.from({ length: firstDay }).map((_, i) => (
                          <div key={`cal-empty-${i}`} className="h-9" />
                        ))}

                        {Array.from({ length: totalDays }).map((_, i) => {
                          const d = i + 1
                          const dStr = String(d).padStart(2, '0')
                          const mStr = String(calMonth + 1).padStart(2, '0')
                          const dateKey = `${calYear}-${mStr}-${dStr}`

                          const period = allPeriods.find((p) => p.key === dateKey)
                          if (!period) {
                            return (
                              <div
                                key={dateKey}
                                className="h-9 rounded-lg text-xs font-normal flex flex-col items-center justify-center relative border border-slate-100 bg-slate-100/50 text-slate-300 opacity-40 cursor-not-allowed select-none"
                                title="Not an active billing date for this bill"
                              >
                                <span>{d}</span>
                              </div>
                            )
                          }

                          const isSelected = selectedPeriod?.key === dateKey
                          const state = getPeriodState(period)

                          return (
                            <button
                              key={dateKey}
                              type="button"
                              onClick={() => handleSelectPeriod(period)}
                              className={cn(
                                'h-9 rounded-lg text-xs font-medium flex flex-col items-center justify-center relative transition-all cursor-pointer border',
                                isSelected && 'bg-[#960C01] text-white font-bold shadow-xs border-[#960C01]',
                                !isSelected && state === 'paid' && 'bg-emerald-50 text-emerald-800 border-emerald-200',
                                !isSelected && state === 'partial' && 'bg-amber-50 text-amber-900 border-amber-300 font-semibold',
                                !isSelected && state === 'overdue' && 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/25 font-semibold',
                                !isSelected && state !== 'paid' && state !== 'partial' && state !== 'overdue' && 'border-slate-100 hover:bg-slate-50 text-focus'
                              )}
                            >
                              <span>{d}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* Clean Legend (No Icons) */}
                  <div className="flex flex-wrap items-center justify-between text-[10.5px] text-muted-fg pt-2 border-t border-slate-100 gap-1.5">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Partially Paid
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#960C01] inline-block" /> Overdue
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-slate-900 inline-block" /> Selected
                    </span>
                  </div>
                </div>
              )}

              {/* 2. Monthly 12-Month Grid Picker */}
              {bill.billingCycle === 'Monthly' && (
                <div className="border border-stroke/60 rounded-2xl p-3.5 bg-white space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-focus">
                      Year {selectedYear}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedYear((prev) => prev - 1)}
                        className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                        aria-label="Previous year"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedYear((prev) => prev + 1)}
                        className="p-1 rounded-md hover:bg-slate-100 text-muted-fg hover:text-focus cursor-pointer"
                        aria-label="Next year"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* 12 Months Grid (3 x 4) */}
                  <div className="grid grid-cols-3 gap-2">
                    {MONTH_NAMES.map((mName, idx) => {
                      const mNum = idx + 1
                      const monthKey = `${selectedYear}-${String(mNum).padStart(2, '0')}`
                      const period = allPeriods.find((p) => p.key === monthKey)

                      if (!period) {
                        return (
                          <div
                            key={monthKey}
                            className="p-2.5 rounded-xl border border-slate-200/50 bg-slate-100/70 text-slate-400 text-left flex flex-col justify-between opacity-40 cursor-not-allowed select-none min-h-[62px]"
                            title="Not an active billing cycle for this bill"
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="text-xs font-semibold text-slate-400">{mName}</span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-200/60 text-slate-500 border border-slate-300/60">
                                N/A
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 mt-1 font-normal">—</span>
                          </div>
                        )
                      }

                      const isSelected = selectedPeriod?.key === monthKey
                      const state = getPeriodState(period)

                      return (
                        <button
                          key={monthKey}
                          type="button"
                          onClick={() => handleSelectPeriod(period)}
                          className={cn(
                            'p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer min-h-[62px]',
                            isSelected && 'border-[#960C01] bg-[#960C01]/5 ring-2 ring-[#960C01]/20',
                            !isSelected && state === 'paid' && 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
                            !isSelected && state === 'partial' && 'bg-amber-50/80 border-amber-300 text-amber-900',
                            !isSelected && state === 'overdue' && 'bg-[#960C01]/10 border-[#960C01]/25 text-[#960C01]',
                            !isSelected && state === 'advance' && 'bg-purple-50/60 border-purple-200 text-purple-900',
                            !isSelected && state === 'current' && 'bg-white border-slate-200 hover:bg-slate-50 text-focus'
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-xs font-bold">{mName}</span>
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[9.5px] font-semibold border',
                                state === 'paid' && 'bg-emerald-100/80 text-emerald-800 border-emerald-200',
                                state === 'partial' && 'bg-amber-100 text-amber-800 border-amber-300',
                                state === 'overdue' && 'bg-[#960C01]/15 text-[#960C01] border-[#960C01]/30',
                                state === 'advance' && 'bg-purple-100 text-purple-800 border-purple-200',
                                state === 'current' && 'bg-slate-100 text-slate-700 border-slate-200'
                              )}
                            >
                              {state === 'paid'
                                ? 'Paid'
                                : state === 'partial'
                                ? 'Partial'
                                : state === 'overdue'
                                ? 'Overdue'
                                : state === 'advance'
                                ? 'Advance'
                                : 'Due Soon'}
                            </span>
                          </div>

                          <span className="text-[10px] tabular-nums mt-1 text-muted-fg font-medium">
                            {state === 'paid'
                              ? '₱0.00 left'
                              : state === 'partial' && period?.remainingAmount
                              ? `${formatPHP(period.remainingAmount)} left`
                              : period?.billedAmount
                              ? `${formatPHP(period.billedAmount)} due`
                              : bill.latestAmount
                              ? `${formatPHP(bill.latestAmount)} est.`
                              : '—'}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Clean Legend */}
                  <div className="flex flex-wrap items-center justify-between text-[10px] text-muted-fg pt-2 border-t border-slate-100 gap-1.5">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Partial
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-[#960C01] inline-block" /> Overdue
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> Advance
                    </span>
                  </div>
                </div>
              )}

              {/* 3. Yearly Cards Picker */}
              {bill.billingCycle === 'Yearly' && (
                <div className="border border-stroke/60 rounded-2xl p-3.5 bg-white space-y-2.5 shadow-2xs">
                  <div className="text-xs font-bold text-focus px-1">
                    Annual Billing Years
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {allPeriods.map((period) => {
                      const isSelected = selectedPeriod?.key === period.key
                      const state = getPeriodState(period)

                      return (
                        <button
                          key={period.key}
                          type="button"
                          onClick={() => handleSelectPeriod(period)}
                          className={cn(
                            'p-3 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer min-h-[70px]',
                            isSelected && 'border-[#960C01] bg-[#960C01]/5 ring-2 ring-[#960C01]/20',
                            !isSelected && state === 'paid' && 'bg-emerald-50/70 border-emerald-200 text-emerald-900',
                            !isSelected && state === 'partial' && 'bg-amber-50/80 border-amber-300 text-amber-900',
                            !isSelected && state === 'overdue' && 'bg-[#960C01]/10 border-[#960C01]/25 text-[#960C01]',
                            !isSelected && state === 'advance' && 'bg-purple-50/60 border-purple-200 text-purple-900',
                            !isSelected && state === 'current' && 'bg-white border-slate-200 hover:bg-slate-50 text-focus'
                          )}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-sm font-bold">{period.label || period.key}</span>
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded text-[10px] font-semibold border',
                                state === 'paid' && 'bg-emerald-100 text-emerald-800 border-emerald-200',
                                state === 'partial' && 'bg-amber-100 text-amber-800 border-amber-300',
                                state === 'overdue' && 'bg-[#960C01]/15 text-[#960C01] border-[#960C01]/30',
                                state === 'advance' && 'bg-purple-100 text-purple-800 border-purple-200',
                                state === 'current' && 'bg-slate-100 text-slate-700 border-slate-200'
                              )}
                            >
                              {state === 'paid'
                                ? 'Paid'
                                : state === 'partial'
                                ? 'Partial'
                                : state === 'overdue'
                                ? 'Overdue'
                                : state === 'advance'
                                ? 'Advance'
                                : 'Due Soon'}
                            </span>
                          </div>
                          <span className="text-[11px] tabular-nums mt-1 text-muted-fg font-medium">
                            {state === 'paid'
                              ? '₱0.00 left'
                              : state === 'partial' && period.remainingAmount
                              ? `${formatPHP(period.remainingAmount)} left`
                              : period.billedAmount
                              ? `${formatPHP(period.billedAmount)} due`
                              : bill.latestAmount
                              ? `${formatPHP(bill.latestAmount)} est.`
                              : '—'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Transaction Details (Payment Date, Amount, Method, Ref No, Notes) */}
            <div className="space-y-3.5">
              {/* 1. Payment Date (Date transaction was actually settled) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-focus">
                    Payment Date <span className="text-[#960C01]">*</span>
                  </label>
                </div>
                <Input
                  required
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="h-10 text-xs sm:text-sm rounded-xl font-medium"
                />
              </div>

              {/* Installment / Partial Payment Toggle for Fresh Periods */}
              {!isPeriodPartiallyPaid && (
                <div className="p-3 rounded-xl border border-stroke/60 bg-slate-50/70 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="installment-toggle"
                    checked={isInstallment}
                    onChange={(e) => {
                      setIsInstallment(e.target.checked)
                      if (!e.target.checked) {
                        setTotalBilledInput('')
                      }
                    }}
                    className="mt-0.5 h-4 w-4 rounded text-[#960C01] focus:ring-[#960C01] border-stroke/60 cursor-pointer"
                  />
                  <label htmlFor="installment-toggle" className="text-xs font-semibold text-focus cursor-pointer leading-tight">
                    Pay in Installment / Partial Payment
                    <span className="block text-[11px] font-normal text-muted-fg mt-0.5">
                      Check this if paying only a portion of the statement amount.
                    </span>
                  </label>
                </div>
              )}

              {/* Total Statement Amount (Only shown if user chose installment payment) */}
              {isInstallment && !isPeriodPartiallyPaid && (
                <div className="space-y-1.5 animate-in fade-in duration-150">
                  <label className="text-xs font-semibold text-focus flex items-center justify-between">
                    <span>Total Amount (₱) <span className="text-[#960C01]">*</span></span>
                    <span className="text-[11px] text-muted-fg font-normal">Full amount on bill statement</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-fg">
                      ₱
                    </span>
                    <Input
                      required
                      type="number"
                      min="1"
                      step="any"
                      value={totalBilledInput}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) => {
                        setError('')
                        setTotalBilledInput(e.target.value)
                      }}
                      placeholder="e.g. 5420.50"
                      className="h-10 pl-7 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              )}

              {/* Payment Amount Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-focus">
                    Payment Amount (₱) <span className="text-[#960C01]">*</span>
                  </label>
                  {isPeriodPartiallyPaid && (
                    <span className="text-[11px] text-muted-fg font-medium">
                      Max: {formatPHP(periodRemainingBalance)}
                    </span>
                  )}
                  {isInstallment && !isNaN(parsedTotalBilled) && parsedTotalBilled > 0 && (
                    <span className="text-[11px] text-muted-fg font-medium">
                      Max: {formatPHP(parsedTotalBilled)}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-fg">
                    ₱
                  </span>
                  <Input
                    required
                    type="number"
                    min="1"
                    max={isPeriodPartiallyPaid ? periodRemainingBalance : isInstallment ? parsedTotalBilled : undefined}
                    step="any"
                    value={amountInput}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => {
                      setError('')
                      setAmountInput(e.target.value)
                    }}
                    placeholder="0.00"
                    className={cn(
                      'h-10 pl-7 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                      amountInputError && 'border-[#960C01] focus-visible:ring-[#960C01]/20'
                    )}
                  />
                </div>

                {/* Inline Validation Error Message */}
                {amountInputError && (
                  <p className="text-[11px] text-[#960C01] font-semibold flex items-center gap-1.5 pt-0.5 animate-in fade-in duration-150">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#960C01]" />
                    <span>{amountInputError}</span>
                  </p>
                )}

                {/* Installment vs Full Settlement Hint */}
                {isAmountValid && !amountInputError && (
                  <div className="pt-1">
                    {willBePartiallyPaid ? (
                      <p className="text-[11px] text-amber-800 font-medium bg-amber-50/80 border border-amber-200/80 rounded-xl px-2.5 py-1.5">
                        Installment Payment:{' '}
                        {formatPHP(
                          isPeriodPartiallyPaid
                            ? Math.max(0, periodRemainingBalance - parsedAmount)
                            : Math.max(0, parsedTotalBilled - parsedAmount)
                        )}{' '}
                        will remain as <strong>Partially Paid</strong>.
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-800 font-medium bg-emerald-50/80 border border-emerald-200/80 rounded-xl px-2.5 py-1.5">
                        Full Settlement: This period will be fully settled and marked as <strong>Paid</strong>.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Payment Method */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-focus block">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 cursor-pointer"
                >
                  <option value="Cash">Cash</option>
                  <option value="GCash">GCash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>

              {/* 4. Receipt / Ref No. */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-focus block">
                  Receipt / Ref No. (Optional)
                </label>
                <Input
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="e.g. OR-88201, BDO-TRX-1029..."
                  className="h-10 text-xs sm:text-sm rounded-xl font-mono"
                />
              </div>

              {/* 5. Remarks / Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-focus block">
                  Remarks / Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter remarks or payment notes..."
                  className="w-full p-2.5 rounded-xl border border-stroke/60 bg-white text-xs text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none transition-all placeholder:text-muted-fg/60"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !isAmountValid || isPeriodPaid || !paymentDate}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Recording...</span>
                </>
              ) : (
                <span>Confirm Payment</span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
