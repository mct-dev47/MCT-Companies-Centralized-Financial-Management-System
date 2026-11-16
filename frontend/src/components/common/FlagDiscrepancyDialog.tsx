import * as React from 'react'
import { AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface FlagDiscrepancyDialogProps {
  /** Open while a flag is being entered */
  open: boolean
  /** How many records the flag applies to (a whole day can be flagged at once) */
  count?: number
  /** Remarks to start with, e.g. the record's existing audit notes */
  initialReason?: string
  onCancel: () => void
  /** Called with the trimmed reason; a reason is required */
  onConfirm: (reason: string) => void
}

/** Asks the auditor why a record is flagged, so the remark is saved with the Flagged status. */
export const FlagDiscrepancyDialog: React.FC<FlagDiscrepancyDialogProps> = ({
  open,
  count = 1,
  initialReason = '',
  onCancel,
  onConfirm,
}) => {
  const [reason, setReason] = React.useState(initialReason)

  React.useEffect(() => {
    if (open) setReason(initialReason)
  }, [open, initialReason])

  const trimmed = reason.trim()

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-[440px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal">
        <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                Flag Audit Discrepancy
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">
                {count > 1
                  ? `Describe the discrepancy for these ${count} transactions.`
                  : 'Describe the discrepancy or required correction for this transaction.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 pt-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-focus block">
              Discrepancy Reason / Remarks <span className="text-rose-600">*</span>
            </Label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Voucher amount does not match the attached receipt..."
              className="w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-normal leading-relaxed resize-none"
            />
            {!trimmed && (
              <p className="text-[10px] text-muted-fg leading-tight">
                A reason is required so Finance and Operations can address the discrepancy.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/30">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="h-10 px-4 text-xs font-semibold rounded-xl border-stroke/50 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!trimmed}
              onClick={() => onConfirm(trimmed)}
              className="h-10 px-4 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <AlertCircle className="w-3.5 h-3.5 text-white" />
              <span>Flag Discrepancy</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
