import * as React from 'react'
import {
  Coins,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Lock,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD } from '@/utils/dateUtils'

export interface PaymentRecordItem {
  id?: string | number
  date: string
  amount: number
  cycle_due_date?: string
  cycleDueDate?: string
  status?: string
}

export interface MonthlyProgressItem {
  monthIndex: number
  dueDate: string
  target: number
  paid: number
  remaining: number
  status: string
  isOverdue?: boolean
}

export interface PaymentSubmissionData {
  paymentDate: string // Cash received date
  targetInstallmentDate: string
  cycleIndex?: number
  periodIndex?: number
  amount: number
  penaltyAmount: number
  method: string
  referenceNo: string
  notes: string
  status: 'Paid' | 'Partially Paid'
}

export interface CompletedPaymentReceiptData {
  entityName: string
  referenceNumber?: string
  paymentDate: string
  targetInstallmentDate?: string
  periodLabel?: string
  isLate: boolean
  daysLate: number
  penaltyPortion: number
  amount: number
  method: string
  referenceNo: string
  notes: string
  paymentStatus: 'Paid' | 'Partially Paid'
  remainingBalanceAfter: number
  periodRemainingAfter: number
}

export interface SharedPaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isAudit?: boolean
  entityName: string
  entitySubtitle?: string
  accountTypeLabel?: string // e.g. "Loan" or "Lease"
  referenceNumber?: string
  paymentFrequency?: 'Daily' | 'Monthly' | string
  dailyTarget: number
  remainingBalance: number
  contractDate?: string
  firstDueDate?: string
  leaseEndDate?: string
  dueDate?: string
  existingPayments: PaymentRecordItem[]
  monthlyProgress?: MonthlyProgressItem[]
  onSubmitPayment: (data: PaymentSubmissionData) => Promise<void>
}

export const SharedPaymentModal: React.FC<SharedPaymentModalProps> = ({
  open,
  onOpenChange,
  isAudit = false,
  entityName,
  entitySubtitle,
  accountTypeLabel = 'Loan',
  referenceNumber,
  paymentFrequency = 'Daily',
  dailyTarget,
  remainingBalance,
  contractDate,
  firstDueDate,
  leaseEndDate,
  dueDate,
  existingPayments,
  monthlyProgress,
  onSubmitPayment,
}) => {
  const isDaily = paymentFrequency === 'Daily' || !paymentFrequency
  const isMonthly = paymentFrequency === 'Monthly'

  const [paymentCalendarMonth, setPaymentCalendarMonth] = React.useState<Date>(new Date())
  const [paymentForm, setPaymentForm] = React.useState({
    paymentAmount: '',
    paymentDate: formatToYYYYMMDD(new Date()),
    targetInstallmentDate: '',
    cycleIndex: undefined as number | undefined,
    method: 'Cash',
    referenceNo: '',
    notes: '',
    penaltyAmount: '0',
  })
  const [paymentError, setPaymentError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = React.useState(false)
  const [pendingConfirm, setPendingConfirm] = React.useState<CompletedPaymentReceiptData | null>(null)
  const [completedReceipt, setCompletedReceipt] = React.useState<CompletedPaymentReceiptData | null>(null)
  const [isSuccessModalOpen, setIsSuccessModalOpen] = React.useState(false)

  // Initialize or reset target date on modal open
  React.useEffect(() => {
    if (!open) {
      setPaymentError(null)
      return
    }

    const todayStr = formatToYYYYMMDD(new Date())
    let initialDate = todayStr
    let initialCycleIndex: number | undefined = undefined

    if (isMonthly && monthlyProgress && monthlyProgress.length > 0) {
      const activeM = monthlyProgress.find((m) => m.remaining > 0.005) || monthlyProgress[0]
      if (activeM) {
        initialDate = activeM.dueDate
        initialCycleIndex = activeM.monthIndex
      }
    } else if (isDaily) {
      const lockedDates = new Set<string>()
      existingPayments.forEach((p) => {
        const dt = p.cycle_due_date || p.cycleDueDate || p.date
        if (!dt) return
        const sum = existingPayments
          .filter((x) => (x.cycle_due_date || x.cycleDueDate || x.date) === dt)
          .reduce((acc, curr) => acc + (curr.amount || 0), 0)
        if (sum >= dailyTarget - 0.005 && dailyTarget > 0) {
          lockedDates.add(dt)
        }
      })

      const startDateStr = firstDueDate || contractDate || todayStr
      const endDateStr = leaseEndDate || dueDate || ''
      const curDate = new Date(startDateStr)
      const maxDate = endDateStr ? new Date(endDateStr) : new Date(todayStr)
      let foundUnpaid: string | null = null

      if (!isNaN(curDate.getTime())) {
        while (curDate <= maxDate) {
          const d = formatToYYYYMMDD(curDate)
          if (!lockedDates.has(d)) {
            foundUnpaid = d
            break
          }
          curDate.setDate(curDate.getDate() + 1)
        }
      }

      if (foundUnpaid) {
        initialDate = foundUnpaid
      } else if (endDateStr && todayStr > endDateStr) {
        initialDate = endDateStr
      } else if (startDateStr && todayStr < startDateStr) {
        initialDate = startDateStr
      } else {
        initialDate = todayStr
      }
    }

    let initialRemainingDue = 0
    if (isMonthly && monthlyProgress && monthlyProgress.length > 0) {
      const activeM = monthlyProgress.find((m) => m.remaining > 0.005) || monthlyProgress[0]
      if (activeM) {
        initialRemainingDue = Math.min(remainingBalance, activeM.remaining)
      }
    } else if (isDaily) {
      const paidOnInitial = existingPayments
        .filter((p) => (p.cycle_due_date || p.cycleDueDate || p.date) === initialDate)
        .reduce((sum, p) => sum + (p.amount || 0), 0)
      initialRemainingDue = Math.min(
        remainingBalance,
        Math.max(0, Math.round((dailyTarget - paidOnInitial) * 100) / 100)
      )
    }

    setPaymentForm({
      paymentAmount: initialRemainingDue > 0 ? String(initialRemainingDue) : '',
      paymentDate: todayStr,
      targetInstallmentDate: initialDate,
      cycleIndex: initialCycleIndex,
      method: 'Cash',
      referenceNo: '',
      notes: '',
      penaltyAmount: '0',
    })
    const initialCalDate = new Date(initialDate)
    setPaymentCalendarMonth(!isNaN(initialCalDate.getTime()) ? initialCalDate : new Date())
    setPaymentError(null)
  }, [open, isDaily, isMonthly, contractDate, firstDueDate, leaseEndDate, dueDate, dailyTarget, existingPayments, monthlyProgress])

  // Calculations
  const targetInstallmentDate = paymentForm.targetInstallmentDate || paymentForm.paymentDate
  const cashReceivedDate = paymentForm.paymentDate
  const isLatePayment = Boolean(targetInstallmentDate && cashReceivedDate > targetInstallmentDate)

  let calculatedDaysLate = 0
  if (isLatePayment && targetInstallmentDate && cashReceivedDate) {
    const d1 = new Date(cashReceivedDate)
    const d2 = new Date(targetInstallmentDate)
    calculatedDaysLate = Math.max(1, Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24)))
  }

  const rawPenaltyNum = parseFloat(paymentForm.penaltyAmount)
  const isPenaltyNegative = !isNaN(rawPenaltyNum) && rawPenaltyNum < 0
  const userPenaltyNum = Math.max(0, rawPenaltyNum || 0)
  const maxAllowed = remainingBalance
  const currentPaymentNum = parseFloat(paymentForm.paymentAmount)
  const isAmountValid =
    !isNaN(currentPaymentNum) &&
    currentPaymentNum > 0 &&
    currentPaymentNum <= maxAllowed &&
    !isPenaltyNegative

  const alreadyPaidOnSelectedDate = existingPayments
    .filter((p) => (p.cycle_due_date || p.cycleDueDate || p.date) === targetInstallmentDate)
    .reduce((sum, p) => sum + (p.amount || 0), 0)

  let periodRemainingDue = Math.min(
    remainingBalance,
    Math.max(0, Math.round((dailyTarget - alreadyPaidOnSelectedDate) * 100) / 100)
  )

  if (isMonthly && monthlyProgress) {
    const selectedMonth =
      monthlyProgress.find(
        (m) =>
          (paymentForm.cycleIndex && m.monthIndex === paymentForm.cycleIndex) ||
          m.dueDate === targetInstallmentDate
      ) || monthlyProgress[0]
    if (selectedMonth) {
      periodRemainingDue = Math.min(remainingBalance, selectedMonth.remaining)
    }
  }

  const willBePartiallyPaid =
    isAmountValid &&
    currentPaymentNum < periodRemainingDue - 0.005 &&
    maxAllowed - currentPaymentNum > 0.005

  // Open review confirmation modal
  const handleReviewPayment = (e: React.FormEvent) => {
    e.preventDefault()
    if (isAudit) return
    setPaymentError(null)

    const todayStr = formatToYYYYMMDD(new Date())
    if (!cashReceivedDate) {
      setPaymentError('Date Cash Received is required.')
      return
    }
    if (cashReceivedDate > todayStr) {
      setPaymentError('Date Cash Received cannot be a future date.')
      return
    }

    if (!targetInstallmentDate) {
      setPaymentError('Please select an installment date or period.')
      return
    }

    if (!paymentForm.method || !paymentForm.method.trim()) {
      setPaymentError('Payment Method is required.')
      return
    }

    if (paymentForm.referenceNo && paymentForm.referenceNo.trim().length > 100) {
      setPaymentError('Receipt / Reference Number cannot exceed 100 characters.')
      return
    }

    if (paymentForm.notes && paymentForm.notes.length > 255) {
      setPaymentError('Remarks / Notes cannot exceed 255 characters.')
      return
    }

    if (isDaily && alreadyPaidOnSelectedDate >= dailyTarget - 0.005 && dailyTarget > 0) {
      setPaymentError(
        `Installment date ${targetInstallmentDate} is already fully paid and locked. You cannot duplicate payments for a settled date.`
      )
      return
    }

    if (isMonthly && monthlyProgress) {
      const selectedMonth =
        monthlyProgress.find(
          (m) =>
            (paymentForm.cycleIndex && m.monthIndex === paymentForm.cycleIndex) ||
            m.dueDate === targetInstallmentDate
        )
      if (selectedMonth && selectedMonth.remaining <= 0.005) {
        setPaymentError(
          `Installment month ${selectedMonth.monthIndex} (${selectedMonth.dueDate}) is already fully paid and locked. You cannot duplicate payments for a settled month.`
        )
        return
      }
    }

    if (isNaN(currentPaymentNum) || currentPaymentNum <= 0) {
      setPaymentError('Payment Amount is required and must be greater than ₱0.00.')
      return
    }

    if (isPenaltyNegative) {
      setPaymentError('Late payment charges can be ₱0.00 but can never be a negative value.')
      return
    }

    if (currentPaymentNum > maxAllowed) {
      setPaymentError(
        `Payment amount (${formatPHP(currentPaymentNum)}) cannot exceed the remaining balance of ${formatPHP(maxAllowed)}.`
      )
      return
    }

    const remainingBalanceAfter = Math.max(
      0,
      Math.round((remainingBalance - currentPaymentNum) * 100) / 100
    )
    const periodRemainingAfter = Math.max(
      0,
      Math.round((periodRemainingDue - currentPaymentNum) * 100) / 100
    )
    const paymentStatus: 'Paid' | 'Partially Paid' = willBePartiallyPaid ? 'Partially Paid' : 'Paid'

    const confirmData: CompletedPaymentReceiptData = {
      entityName,
      referenceNumber,
      paymentDate: cashReceivedDate,
      targetInstallmentDate,
      periodLabel: paymentForm.cycleIndex ? `Month ${paymentForm.cycleIndex}` : undefined,
      isLate: isLatePayment,
      daysLate: calculatedDaysLate,
      penaltyPortion: isLatePayment ? userPenaltyNum : 0,
      amount: currentPaymentNum,
      method: paymentForm.method,
      referenceNo: paymentForm.referenceNo.trim(),
      notes: paymentForm.notes.trim(),
      paymentStatus,
      remainingBalanceAfter,
      periodRemainingAfter,
    }

    setPendingConfirm(confirmData)
    setIsConfirmModalOpen(true)
  }

  // Execute confirmed payment
  const handleConfirmPayment = async () => {
    if (!pendingConfirm || isAudit) return
    setIsSubmitting(true)
    setPaymentError(null)

    try {
      await onSubmitPayment({
        paymentDate: pendingConfirm.paymentDate,
        targetInstallmentDate: pendingConfirm.targetInstallmentDate || pendingConfirm.paymentDate,
        cycleIndex: paymentForm.cycleIndex,
        amount: pendingConfirm.amount,
        penaltyAmount: pendingConfirm.penaltyPortion,
        method: pendingConfirm.method,
        referenceNo: pendingConfirm.referenceNo,
        notes: pendingConfirm.notes,
        status: pendingConfirm.paymentStatus,
      })

      setCompletedReceipt(pendingConfirm)
      setIsConfirmModalOpen(false)
      onOpenChange(false)
      setIsSuccessModalOpen(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to complete payment transaction. Please try again.'
      setPaymentError(msg)
      setIsConfirmModalOpen(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* 1. Main Payment Input Modal */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[860px] md:max-w-[920px] max-h-[88vh] overflow-y-auto bg-white rounded-[24px] p-6 sm:p-7 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <Coins className="h-5 w-5 text-emerald-600" />
              <span>Record Payment</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg">
              Record payment remittance for <strong className="text-focus">{entityName}</strong>
              {entitySubtitle ? ` (${entitySubtitle})` : ` (${paymentFrequency} Schedule)`}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReviewPayment} className="space-y-5 mt-2">
            {/* Inline Error Banner */}
            {paymentError && (
              <div className="p-3 bg-[#960C01]/10 border border-[#960C01]/20 rounded-xl flex items-start justify-between gap-2 text-xs text-[#960C01]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#960C01] mt-0.5" />
                  <span>{paymentError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentError(null)}
                  className="text-[#960C01] hover:text-[#800a01] font-bold ml-1 text-sm leading-none"
                >
                  &times;
                </button>
              </div>
            )}

            {/* Two-Column Layout: Left = Calendar, Right = Payment Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: Interactive Calendar Date Picker for Daily, or Month Selector for Monthly */}
              <div className="space-y-1.5">
                {isMonthly && monthlyProgress ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-focus">
                        Installment Month <span className="text-[#960C01]">*</span>
                      </label>
                      <span className="text-[11px] font-mono font-bold text-focus">
                        {targetInstallmentDate ? `Target: ${targetInstallmentDate}` : 'Please select month'}
                      </span>
                    </div>

                    <div className="border border-stroke/60 rounded-xl p-3 bg-white space-y-2 max-h-[300px] overflow-y-auto">
                      {monthlyProgress.map((m) => {
                        const isSelected =
                          paymentForm.cycleIndex === m.monthIndex ||
                          (!paymentForm.cycleIndex && targetInstallmentDate === m.dueDate)
                        const isFullyPaid = m.status === 'Paid' || m.remaining <= 0.005

                        return (
                          <button
                            key={`month-select-${m.monthIndex}`}
                            type="button"
                            disabled={isFullyPaid}
                            onClick={() => {
                              if (!isFullyPaid) {
                                setPaymentError(null)
                                const remMonth = Math.min(remainingBalance, m.remaining)
                                setPaymentForm({
                                  ...paymentForm,
                                  targetInstallmentDate: m.dueDate,
                                  cycleIndex: m.monthIndex,
                                  paymentAmount: remMonth > 0 ? String(remMonth) : '',
                                })
                              }
                            }}
                            className={cn(
                              'w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between',
                              isSelected && 'border-[#960C01] bg-[#960C01]/5 ring-1 ring-[#960C01]',
                              !isSelected && isFullyPaid && 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed',
                              !isSelected && !isFullyPaid && 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 cursor-pointer'
                            )}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-focus">
                                  Month {m.monthIndex}
                                </span>
                                <span className="text-[10px] font-mono text-muted-fg">
                                  Due: {m.dueDate}
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-fg">
                                Target: <span className="font-semibold text-focus">{formatPHP(m.target)}</span>
                                {m.paid > 0 && (
                                  <> • Paid: <span className="font-semibold text-emerald-600">{formatPHP(m.paid)}</span></>
                                )}
                              </div>
                            </div>

                            <div>
                              {isFullyPaid ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  Paid
                                </span>
                              ) : m.status === 'Partially Paid' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                  Partial ({formatPHP(m.remaining)} due)
                                </span>
                              ) : m.isOverdue ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                  <AlertCircle className="w-2.5 h-2.5 text-[#960C01]" />
                                  Overdue
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                  Due {formatPHP(m.remaining)}
                                </span>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  /* Daily Interactive Calendar Date Picker */
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-focus">
                        Installment Date <span className="text-[#960C01]">*</span>
                      </label>
                      <span className="text-[11px] font-mono font-bold text-focus">
                        {targetInstallmentDate ? `Target: ${targetInstallmentDate}` : 'Please select date'}
                      </span>
                    </div>

                    <div className="border border-stroke/60 rounded-xl p-3.5 bg-white space-y-2.5">
                      {/* Month Header & Controls */}
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

                        const paidByDateMap = new Map<string, number>()
                        existingPayments.forEach((p) => {
                          const dt = p.cycle_due_date || p.cycleDueDate || p.date
                          if (!dt) return
                          paidByDateMap.set(dt, (paidByDateMap.get(dt) || 0) + (p.amount || 0))
                        })

                        const startBorrowed = firstDueDate || contractDate || ''
                        const endBorrowed = leaseEndDate || dueDate || ''
                        const todayStr = formatToYYYYMMDD(new Date())

                        return (
                          <div className="grid grid-cols-7 gap-1 text-center">
                            {Array.from({ length: firstDay }).map((_, i) => (
                              <div key={`cal-empty-${i}`} className="h-9" />
                            ))}

                            {Array.from({ length: totalDays }).map((_, i) => {
                              const d = i + 1
                              const dStr = String(d).padStart(2, '0')
                              const mStr = String(calMonth + 1).padStart(2, '0')
                              const dateStr = `${calYear}-${mStr}-${dStr}`

                              const isBefore = startBorrowed ? dateStr < startBorrowed : false
                              const isAfter = endBorrowed ? dateStr > endBorrowed : false
                              const paidOnDate = paidByDateMap.get(dateStr) || 0
                              const isPaid = paidOnDate >= dailyTarget - 0.005 && dailyTarget > 0
                              const isPartial = !isPaid && paidOnDate > 0
                              const isMissed = !isBefore && !isAfter && !isPaid && dateStr < todayStr
                              const isSelected = targetInstallmentDate === dateStr
                              const isDisabled = isBefore || isAfter || isPaid

                              return (
                                <button
                                  key={dateStr}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => {
                                    if (!isDisabled) {
                                      setPaymentError(null)
                                      const remDate = Math.min(
                                        remainingBalance,
                                        Math.max(0, Math.round((dailyTarget - paidOnDate) * 100) / 100)
                                      )
                                      setPaymentForm({
                                        ...paymentForm,
                                        targetInstallmentDate: dateStr,
                                        paymentAmount: remDate > 0 ? String(remDate) : '',
                                      })
                                    }
                                  }}
                                  className={cn(
                                    'h-9 rounded-lg text-xs font-medium flex flex-col items-center justify-center relative transition-all',
                                    isSelected &&
                                      'bg-[#960C01] text-white font-bold shadow-xs ring-2 ring-[#960C01]/30 z-10',
                                    !isSelected &&
                                      isPaid &&
                                      'bg-emerald-50 text-emerald-700 border border-emerald-200/80 cursor-not-allowed opacity-90',
                                    !isSelected &&
                                      isPartial &&
                                      'bg-amber-50 text-amber-800 border border-amber-300 cursor-pointer font-semibold',
                                    !isSelected &&
                                      isMissed &&
                                      'bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/30 cursor-pointer font-bold hover:bg-[#960C01]/20',
                                    !isSelected &&
                                      (isBefore || isAfter) &&
                                      'text-slate-300 cursor-not-allowed bg-slate-50/50',
                                    !isSelected &&
                                      !isPaid &&
                                      !isPartial &&
                                      !isMissed &&
                                      !isBefore &&
                                      !isAfter &&
                                      'hover:bg-slate-100 text-focus cursor-pointer hover:font-bold border border-transparent'
                                  )}
                                  title={
                                    isPaid
                                      ? `${dateStr}: Fully Paid & Locked (Cannot select)`
                                      : isBefore
                                      ? `${dateStr}: Prior to start date`
                                      : isAfter
                                      ? `${dateStr}: After lease end date`
                                      : isMissed
                                      ? `${dateStr}: Missed installment (Due ${dateStr}) — Click to settle`
                                      : isPartial
                                      ? `${dateStr}: Partially Paid (${formatPHP(paidOnDate)} of ${formatPHP(dailyTarget)}) — Select to pay remaining ${formatPHP(Math.max(0, dailyTarget - paidOnDate))}`
                                      : `Select ${dateStr}`
                                  }
                                >
                                  <span>{d}</span>
                                  {isPaid && <Check className="h-2.5 w-2.5 text-emerald-600 -mt-0.5" />}
                                  {isPartial && !isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 absolute bottom-1" />
                                  )}
                                  {isMissed && !isSelected && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#960C01] absolute bottom-1" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}

                      {/* Calendar Legend */}
                      <div className="flex flex-wrap items-center justify-between text-[10px] text-muted-fg pt-2 border-t border-slate-100 gap-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-[#960C01] inline-block" /> Selected
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Partial
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-[#960C01] inline-block" /> Missed
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Late Status Information / Breakdown */}
                {isLatePayment ? (
                  <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl space-y-1.5 text-xs text-amber-900">
                    <div className="flex items-center justify-between font-bold text-amber-800">
                      <span className="flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        Overdue Installment
                      </span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                        {calculatedDaysLate} Day{calculatedDaysLate > 1 ? 's' : ''} Late
                      </span>
                    </div>
                    <div className="text-[11px] text-amber-700">
                      Scheduled due date was <strong>{targetInstallmentDate}</strong>. Input any late penalty charges in the field on the right.
                    </div>
                    <div className="pt-1.5 border-t border-amber-200/80 flex items-center justify-between font-bold text-xs text-focus">
                      <span>Installment Due:</span>
                      <span className="text-emerald-700 text-sm font-mono">{formatPHP(periodRemainingDue)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-50/80 border border-emerald-200/80 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-[11px]">Installment is on-time. No late penalty required.</span>
                  </div>
                )}
              </div>

              {/* Right Column: Payment Amount, Payment Method, Receipt No., Remarks */}
              <div className="space-y-3.5">
                {/* Date Cash Received Input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-focus">
                      Date Cash Received <span className="text-[#960C01]">*</span>
                    </label>
                    <span className="text-[11px] font-medium">
                      {isLatePayment ? (
                        <span className="text-[#960C01] font-bold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-[#960C01]" />
                          {calculatedDaysLate} Day{calculatedDaysLate > 1 ? 's' : ''} Late
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          On Time (0 penalty)
                        </span>
                      )}
                    </span>
                  </div>
                  <Input
                    type="date"
                    required
                    max={formatToYYYYMMDD(new Date())}
                    value={paymentForm.paymentDate}
                    onChange={(e) => {
                      setPaymentError(null)
                      setPaymentForm({ ...paymentForm, paymentDate: e.target.value })
                    }}
                    className="h-10 text-xs sm:text-sm rounded-xl font-medium"
                  />
                  <p className="text-[10px] text-muted-fg mt-1">
                    Enter actual cash collection date. If collected on time in the field, this removes late penalties.
                  </p>
                </div>

                {/* Payment Amount Input */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-focus">
                      Payment Amount (₱) <span className="text-[#960C01]">*</span>
                    </label>
                    <span className="text-[11px] text-muted-fg font-medium">
                      Target: {formatPHP(periodRemainingDue)}
                    </span>
                  </div>
                  <Input
                    required
                    type="number"
                    min="0.01"
                    max={maxAllowed}
                    step="any"
                    value={paymentForm.paymentAmount}
                    onWheel={(e) => e.currentTarget.blur()}
                    onKeyDown={(e) => {
                      if (e.key === '-' || e.key === 'Subtract') {
                        e.preventDefault()
                      }
                    }}
                    onChange={(e) => {
                      setPaymentError(null)
                      const val = e.target.value
                      if (val.includes('-')) return
                      setPaymentForm({ ...paymentForm, paymentAmount: val })
                    }}
                    placeholder="Enter repayment amount"
                    className="h-10 text-xs sm:text-sm rounded-xl font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {paymentForm.paymentAmount && !isAmountValid && (
                    <p className="text-[11px] text-[#960C01] mt-1">
                      {currentPaymentNum <= 0
                        ? 'Payment amount must be greater than ₱0.00.'
                        : currentPaymentNum > maxAllowed
                        ? `Payment amount cannot exceed ${formatPHP(maxAllowed)}.`
                        : isPenaltyNegative
                        ? 'Late payment charges cannot be a negative value.'
                        : 'Please enter a valid amount.'}
                    </p>
                  )}
                </div>

                {/* Late Payment Charges Input */}
                {isLatePayment && (
                  <div className="p-3 bg-[#960C01]/5 border border-[#960C01]/20 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-[#960C01] flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 text-[#960C01]" />
                        Late Payment Charges (₱)
                      </label>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={paymentForm.penaltyAmount}
                      onWheel={(e) => e.currentTarget.blur()}
                      onKeyDown={(e) => {
                        if (e.key === '-' || e.key === 'Subtract') {
                          e.preventDefault()
                        }
                      }}
                      onChange={(e) => {
                        setPaymentError(null)
                        const val = e.target.value
                        if (val.includes('-')) return
                        const num = parseFloat(val)
                        if (!isNaN(num) && num < 0) return
                        setPaymentForm({ ...paymentForm, penaltyAmount: val })
                      }}
                      placeholder="0.00"
                      className="h-9 text-xs sm:text-sm rounded-lg font-semibold bg-white border-[#960C01]/30 focus:border-[#960C01] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {isPenaltyNegative && (
                      <p className="text-[11px] text-[#960C01] font-medium mt-1">
                        Late payment charges can be ₱0.00 but can never be a negative value.
                      </p>
                    )}
                  </div>
                )}

                {/* Summary calculation card */}
                {isAmountValid && (
                  <div className="mt-2 space-y-1.5">
                    {userPenaltyNum > 0 && (
                      <div className="p-2.5 rounded-xl border border-slate-200/90 bg-slate-50 text-xs space-y-1">
                        <div className="flex justify-between items-center text-muted-fg text-[11px]">
                          <span>Repayment (reduces {accountTypeLabel.toLowerCase()}):</span>
                          <span className="font-mono font-semibold text-focus">{formatPHP(currentPaymentNum)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[#960C01] text-[11px]">
                          <span>Late Payment Charge (fee):</span>
                          <span className="font-mono font-semibold">+{formatPHP(userPenaltyNum)}</span>
                        </div>
                        <div className="pt-1 border-t border-slate-200 flex justify-between items-center font-bold text-focus">
                          <span>Total Cash to Collect:</span>
                          <span className="font-mono text-emerald-700 text-sm">
                            {formatPHP(currentPaymentNum + userPenaltyNum)}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border text-xs bg-slate-50/80 border-slate-200/80">
                      <span className="text-muted-fg font-medium">Transaction Status Tag:</span>
                      {willBePartiallyPaid ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          Partially Paid ({formatPHP(Math.max(0, periodRemainingDue - currentPaymentNum))} short of target)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Paid</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Payment Method */}
                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Payment Method <span className="text-[#960C01]">*</span>
                  </label>
                  <select
                    value={paymentForm.method}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, method: e.target.value })
                    }
                    className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20"
                  >
                    <option value="Cash">Cash</option>
                    <option value="GCash">GCash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>

                {/* Receipt / Ref No. */}
                <div>
                  <label className="text-xs font-semibold text-focus block mb-1">
                    Receipt / Ref No. <span className="text-muted-fg font-normal">(Optional)</span>
                  </label>
                  <Input
                    value={paymentForm.referenceNo}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, referenceNo: e.target.value })
                    }
                    placeholder="e.g. OR-88201"
                    className="h-10 text-xs sm:text-sm rounded-xl font-mono"
                  />
                </div>

                {/* Remarks / Notes */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-focus">
                      Remarks / Notes <span className="text-muted-fg font-normal">(Optional)</span>
                    </label>
                    <span
                      className={cn(
                        'text-[10.5px] font-mono',
                        paymentForm.notes.length > 255 ? 'text-[#960C01] font-bold' : 'text-muted-fg'
                      )}
                    >
                      {paymentForm.notes.length}/255
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={255}
                    value={paymentForm.notes}
                    onChange={(e) => {
                      setPaymentError(null)
                      setPaymentForm({ ...paymentForm, notes: e.target.value.slice(0, 255) })
                    }}
                    placeholder="Enter payment remarks or notes (maximum 255 characters)..."
                    className="w-full p-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-focus/20 resize-none transition-all placeholder:text-muted-fg/60"
                  />
                  {paymentForm.notes.length >= 255 && (
                    <p className="text-[10px] text-amber-600 font-medium mt-1">
                      Maximum 255 character limit reached.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
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
                disabled={!isAmountValid || isAudit}
                className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Coins className="h-4 w-4" />
                <span>Review & Confirm Payment</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Modal: Payment Confirmation Modal */}
      <Dialog open={isConfirmModalOpen} onOpenChange={setIsConfirmModalOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-focus flex items-center gap-2">
              <Coins className="h-5 w-5 text-[#960C01]" />
              <span>Confirm Payment Transaction</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-fg mt-1">
              Please review the payment details below before recording this transaction.
            </DialogDescription>
          </DialogHeader>

          {pendingConfirm && (
            <div className="space-y-4 mt-2">
              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Name:</span>
                  <span className="font-bold text-focus text-right">{pendingConfirm.entityName}</span>
                </div>
                {pendingConfirm.referenceNumber && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-fg">Reference:</span>
                    <span className="font-mono font-semibold text-focus">{pendingConfirm.referenceNumber}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Installment Due Date:</span>
                  <span className="font-mono font-semibold text-focus">
                    {pendingConfirm.targetInstallmentDate || pendingConfirm.paymentDate}
                    {pendingConfirm.periodLabel ? ` (${pendingConfirm.periodLabel})` : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Date Cash Received:</span>
                  <span className="font-mono font-semibold text-focus">
                    {pendingConfirm.paymentDate}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Timeliness:</span>
                  {pendingConfirm.isLate ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                      <AlertCircle className="w-3 h-3 text-[#960C01]" />
                      <span>{pendingConfirm.daysLate} Days Late</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>On Time (0 penalty)</span>
                    </span>
                  )}
                </div>
                {Boolean(pendingConfirm.penaltyPortion) ? (
                  <div className="flex justify-between items-center text-[#960C01]">
                    <span className="font-medium">Late Payment Charges (Fee):</span>
                    <span className="font-bold">+{formatPHP(pendingConfirm.penaltyPortion || 0)}</span>
                  </div>
                ) : pendingConfirm.isLate ? (
                  <div className="flex justify-between items-center text-muted-fg">
                    <span>Late Payment Charges:</span>
                    <span className="font-semibold text-emerald-600">Waived (₱0.00)</span>
                  </div>
                ) : null}
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-focus">Installment Payment:</span>
                  <span className="font-semibold text-emerald-600 text-xs">
                    {formatPHP(pendingConfirm.amount)}
                  </span>
                </div>
                {Boolean(pendingConfirm.penaltyPortion) && (
                  <div className="flex justify-between items-center bg-amber-50/80 p-2 rounded-lg border border-amber-200/80 font-bold">
                    <span className="text-focus text-[11px]">Total Cash to Collect:</span>
                    <span className="text-amber-800 text-sm font-mono">
                      {formatPHP(pendingConfirm.amount + (pendingConfirm.penaltyPortion || 0))}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Payment Status Tag:</span>
                  {pendingConfirm.paymentStatus === 'Partially Paid' ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Partially Paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>Paid</span>
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Payment Method:</span>
                  <span className="font-semibold text-focus">{pendingConfirm.method}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Receipt / Ref No.:</span>
                  <span className="font-mono text-focus">{pendingConfirm.referenceNo || '—'}</span>
                </div>
                {pendingConfirm.notes && (
                  <div className="flex justify-between items-start gap-3">
                    <span className="text-muted-fg shrink-0">Remarks:</span>
                    <span className="text-focus text-right">{pendingConfirm.notes}</span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-slate-200/70 pt-2">
                  <span className="text-muted-fg">Remaining {accountTypeLabel} Balance After:</span>
                  <span className="font-bold text-amber-600">
                    {formatPHP(pendingConfirm.remainingBalanceAfter)}
                  </span>
                </div>
              </div>

              {pendingConfirm.paymentStatus === 'Partially Paid' && (
                <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-1">
                  <div className="font-bold text-amber-800 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Partial Payment Notice</span>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    This payment is less than the installment due. It will be tagged as{' '}
                    <strong>Partially Paid</strong> (not Paid), and the remaining{' '}
                    <strong>{formatPHP(pendingConfirm.periodRemainingAfter)}</strong> for this period will remain open for settlement.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => setIsConfirmModalOpen(false)}
                  className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Back to Edit
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleConfirmPayment}
                  className="h-10 px-5 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer"
                >
                  {isSubmitting ? 'Recording...' : 'Confirm & Record Payment'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 3. Modal: Payment Success Modal / Receipt */}
      <Dialog open={isSuccessModalOpen} onOpenChange={setIsSuccessModalOpen}>
        <DialogContent className="sm:max-w-md bg-white rounded-2xl p-6">
          {completedReceipt && (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center pt-1">
                <div
                  className={cn(
                    'w-12 h-12 rounded-full flex items-center justify-center mb-3 border',
                    completedReceipt.paymentStatus === 'Partially Paid'
                      ? 'bg-amber-50 border-amber-200 text-amber-600'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  )}
                >
                  <Check className="w-6 h-6" />
                </div>
                <DialogTitle className="text-lg font-bold text-focus">
                  Payment Recorded Successfully
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-1">
                  Payment transaction for <strong className="text-focus">{completedReceipt.entityName}</strong> has been saved.
                </DialogDescription>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Transaction Status:</span>
                  {completedReceipt.paymentStatus === 'Partially Paid' ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Partially Paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Lock className="w-2.5 h-2.5 text-emerald-600" />
                      <span>Paid</span>
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Amount Paid:</span>
                  <span className="font-extrabold text-emerald-600 text-sm">
                    {formatPHP(completedReceipt.amount)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Installment Due Date:</span>
                  <span className="font-mono font-semibold text-focus">
                    {completedReceipt.targetInstallmentDate || completedReceipt.paymentDate}
                    {completedReceipt.periodLabel ? ` (${completedReceipt.periodLabel})` : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Date Cash Received:</span>
                  <span className="font-mono font-semibold text-focus">
                    {completedReceipt.paymentDate}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Timeliness:</span>
                  {completedReceipt.isLate ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                      <AlertCircle className="w-3 h-3 text-[#960C01]" />
                      <span>{completedReceipt.daysLate} Days Late</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-3 h-3 text-emerald-600" />
                      <span>On Time</span>
                    </span>
                  )}
                </div>
                {Boolean(completedReceipt.penaltyPortion) ? (
                  <div className="flex justify-between items-center text-[#960C01]">
                    <span className="font-medium">Late Payment Charges (Fee):</span>
                    <span className="font-bold">+{formatPHP(completedReceipt.penaltyPortion || 0)}</span>
                  </div>
                ) : completedReceipt.isLate ? (
                  <div className="flex justify-between items-center text-muted-fg">
                    <span>Late Payment Charges:</span>
                    <span className="font-semibold text-emerald-600">Waived (₱0.00)</span>
                  </div>
                ) : null}
                <div className="flex justify-between items-center border-t border-slate-200/70 pt-2">
                  <span className="font-semibold text-focus">Repayment Amount:</span>
                  <span className="font-extrabold text-emerald-600 font-mono">
                    {formatPHP(completedReceipt.amount)}
                  </span>
                </div>
                {Boolean(completedReceipt.penaltyPortion) && (
                  <div className="flex justify-between items-center bg-amber-50/80 p-2 rounded-lg border border-amber-200/80 font-bold">
                    <span className="text-focus text-[11px]">Total Cash Collected:</span>
                    <span className="text-amber-800 text-sm font-mono">
                      {formatPHP(completedReceipt.amount + (completedReceipt.penaltyPortion || 0))}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Payment Method:</span>
                  <span className="font-semibold text-focus">{completedReceipt.method}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-fg">Receipt / Ref No.:</span>
                  <span className="font-mono text-focus">{completedReceipt.referenceNo || '—'}</span>
                </div>
                {completedReceipt.paymentStatus === 'Partially Paid' && (
                  <div className="flex justify-between items-center text-amber-700 border-t border-slate-200/70 pt-2">
                    <span className="font-medium">Remaining Installment Due:</span>
                    <span className="font-bold">{formatPHP(completedReceipt.periodRemainingAfter)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-slate-200/70 pt-2">
                  <span className="text-muted-fg">Updated {accountTypeLabel} Balance:</span>
                  <span className="font-bold text-amber-600">
                    {formatPHP(completedReceipt.remainingBalanceAfter)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2">
                <Button
                  type="button"
                  onClick={() => {
                    setIsSuccessModalOpen(false)
                    setCompletedReceipt(null)
                  }}
                  className="w-full h-10 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

