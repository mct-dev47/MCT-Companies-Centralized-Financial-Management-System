import * as React from 'react'
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
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
import { Label } from '@/components/ui/label'
import { formatPHP } from '@/lib/format'
import { loanService, type LoanItem } from '@/services/loanService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

interface UpdateLoanStatusModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loan: LoanItem | null
  onSuccess: (updatedLoan: LoanItem) => void
}

export const UpdateLoanStatusModal: React.FC<UpdateLoanStatusModalProps> = ({
  open,
  onOpenChange,
  loan,
  onSuccess,
}) => {
  const [selectedStatus, setSelectedStatus] = React.useState<'Paid' | 'Pending' | 'Overdue'>('Paid')
  const [remarks, setRemarks] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (loan) {
      const fallback = loan.status === 'Overdue' ? 'Overdue' : loan.status === 'Pending' ? 'Pending' : 'Paid'
      setSelectedStatus(fallback)
      setRemarks(loan.auditNotes || '')
      setError('')
    }
  }, [loan, open])

  if (!loan) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const updated = await loanService.updateLoan(loan.id, {
        status: selectedStatus,
        auditStatus: loan.auditStatus,
        auditNotes: remarks.trim() || loan.auditNotes,
      })

      if (!updated) {
        throw new Error('Failed to update loan record.')
      }

      onSuccess(updated)
      onOpenChange(false)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to update loan status.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const STATUS_OPTIONS: Array<{
    value: 'Paid' | 'Pending' | 'Overdue'
    label: string
    desc: string
    icon: React.ElementType
    activeClasses: string
    iconColor: string
  }> = [
    {
      value: 'Paid',
      label: 'Paid (Settled)',
      desc: 'The borrowed money has been completely paid and settled.',
      icon: CheckCircle2,
      activeClasses: 'border-emerald-500 bg-emerald-50/70 text-emerald-900 ring-2 ring-emerald-500/20',
      iconColor: 'text-emerald-600',
    },
    {
      value: 'Pending',
      label: 'Pending Repayment',
      desc: 'The loan is ongoing and waiting for repayment installment.',
      icon: Clock,
      activeClasses: 'border-amber-500 bg-amber-50/70 text-amber-900 ring-2 ring-amber-500/20',
      iconColor: 'text-amber-600',
    },
    {
      value: 'Overdue',
      label: 'Overdue',
      desc: 'The loan payment is overdue and requires immediate follow-up.',
      icon: AlertCircle,
      activeClasses: 'border-rose-500 bg-rose-50/70 text-rose-900 ring-2 ring-rose-500/20',
      iconColor: 'text-rose-600',
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto rounded-[24px] p-5 sm:p-6 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-3 border-b border-stroke/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold text-focus leading-tight">
                Update Loan Status
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-fg font-normal mt-0.5">
                Update repayment status for this borrowed money record
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-3">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Record summary card */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-fg">Particulars:</span>
              <span className="font-semibold text-focus max-w-[240px] truncate text-right">
                {loan.particulars}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-fg">Loan Amount:</span>
              <span className="font-bold text-focus tabular-nums text-sm text-right">
                {formatPHP(loan.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-fg">Company & Cheque:</span>
              <span className="font-medium text-focus/90 text-right">
                {loan.company} {loan.chequeNo ? `· ${loan.chequeNo}` : ''}
              </span>
            </div>
          </div>

          {/* Status selector options */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-focus block">
              Select Status <span className="text-red-500">*</span>
            </Label>
            <div className="grid grid-cols-1 gap-2">
              {STATUS_OPTIONS.map((opt) => {
                const isSelected = selectedStatus === opt.value
                const OptionIcon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedStatus(opt.value)}
                    className={cn(
                      'w-full p-3 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer',
                      isSelected
                        ? opt.activeClasses
                        : 'border-slate-200 bg-white hover:bg-slate-50/70 text-focus'
                    )}
                  >
                    <OptionIcon className={cn('w-4 h-4 mt-0.5 shrink-0', opt.iconColor)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold leading-tight">{opt.label}</span>
                        {isSelected && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-fg/90 mt-0.5 leading-snug">
                        {opt.desc}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Optional remarks / notes */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-focus block">
              Settlement Notes / Remarks (Optional)
            </Label>
            <Input
              type="text"
              placeholder="e.g. Fully paid via cheque deposit on Oct 8, 2026"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="h-9 rounded-xl border-stroke/50 text-xs"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-9 px-4 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-9 px-5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Updating…
                </>
              ) : (
                'Save Status'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
