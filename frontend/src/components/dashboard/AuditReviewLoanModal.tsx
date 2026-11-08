import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Building2,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react'
import {
  loanService,
  type LoanItem,
} from '@/services/loanService'
import { formatPHP } from '@/lib/format'
import { formatCreatedAt } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { formatRealName } from '@/utils/formatRealName'
import { Clock } from 'lucide-react'

interface AuditReviewLoanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loan: LoanItem | null
  onSuccess: (reviewedLoan: LoanItem) => void
}

export const AuditReviewLoanModal: React.FC<AuditReviewLoanModalProps> = ({
  open,
  onOpenChange,
  loan,
  onSuccess,
}) => {
  const [remark, setRemark] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (open && loan) {
      setError('')
      setRemark('')
      setIsSubmitting(false)
    }
  }, [open, loan])

  if (!loan) return null

  const handleDecision = async (action: 'approve' | 'disapprove') => {
    setError('')
    if (!remark.trim()) {
      setError(`An audit review remark is required to ${action} this loan.`)
      return
    }

    setIsSubmitting(true)
    try {
      const reviewed = await loanService.auditReviewLoan(loan.id, {
        action,
        remark: remark.trim(),
      })
      onSuccess(reviewed)
      onOpenChange(false)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, `Failed to ${action} loan.`))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg sm:text-xl font-bold text-focus leading-tight">
                Audit Review & Compliance Check
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg font-normal">
                Final compliance authorization for loan agreement between{' '}
                <span className="font-semibold text-focus">{loan.borrower}</span> and{' '}
                <span className="font-semibold text-focus">{loan.lender}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Loan Agreement Particulars */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Borrower Company:</span>
              <span className="font-bold text-focus flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-primary" />
                {loan.borrower}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Designated Lender:</span>
              <span className="font-bold text-focus flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                {loan.lender || 'Pending Lender'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Principal Amount:</span>
              <span className="font-bold text-emerald-600 text-sm tabular-nums">
                {formatPHP(loan.amount)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Interest Rate & Due Date:</span>
              <span className="font-semibold text-focus">
                {loan.interestRate || 0}% • {loan.dueDate || 'No due date'}
              </span>
            </div>
            {loan.createdAt && (
              <div className="flex justify-between items-center">
                <span className="text-muted-fg font-medium">Created At:</span>
                <span className="text-[11px] text-slate-600 font-normal flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                  <span>{formatCreatedAt(loan.createdAt)}</span>
                </span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-200/60">
              <span className="text-muted-fg block mb-0.5">Loan Particulars:</span>
              <p className="font-medium text-focus italic">{loan.particulars}</p>
            </div>
          </div>

          {/* Finance Endorsement Card */}
          {loan.financeRemark && (
            <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 text-xs space-y-1">
              <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-blue-700" />
                Finance Endorsement Notes
              </span>
              <p className="text-xs text-blue-950 font-medium italic leading-relaxed">
                "{loan.financeRemark}"
              </p>
              {loan.endorsedBy && (
                <div className="text-[11px] text-blue-800 pt-0.5">
                  Endorsed by: <strong>{formatRealName(loan.endorsedBy, 'Finance Officer')}</strong>
                  {loan.endorsedAt && (
                    <span> on {new Date(loan.endorsedAt).toLocaleString()}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Audit Remark Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-focus block">
                Audit Review Remark <span className="text-red-500">* (Required)</span>
              </Label>
              <span className="text-[11px] text-muted-fg">Mandatory</span>
            </div>
            <textarea
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value)
                if (error) setError('')
              }}
              rows={3}
              placeholder="Enter audit compliance check notes, validation reference, or disapproval reason..."
              className="w-full p-2.5 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none focus:ring-2 focus:ring-focus placeholder:text-muted-fg resize-none"
              required
            />
            <p className="text-[11px] text-muted-fg">
              Approving confirms the terms meet company governance rules and activates repayment tracking.
            </p>
          </div>

          <div className="pt-3 flex items-center justify-between gap-2.5 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => handleDecision('disapprove')}
                disabled={isSubmitting || !remark.trim()}
                className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <XCircle className="w-4 h-4" />
                <span>{isSubmitting ? 'Submitting…' : 'Disapprove'}</span>
              </Button>
              <Button
                type="button"
                onClick={() => handleDecision('approve')}
                disabled={isSubmitting || !remark.trim()}
                className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSubmitting ? 'Submitting…' : 'Approve Loan'}</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
