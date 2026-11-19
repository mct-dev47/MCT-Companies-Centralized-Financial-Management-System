import React, { useState, useEffect } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface TenantDiscrepancyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantName?: string
  initialReason?: string
  isSubmitting: boolean
  onConfirm: (reason: string) => void
}

export const TenantDiscrepancyModal: React.FC<TenantDiscrepancyModalProps> = ({
  open,
  onOpenChange,
  tenantName,
  initialReason = '',
  isSubmitting,
  onConfirm,
}) => {
  const [reason, setReason] = useState(initialReason)

  useEffect(() => {
    if (open) {
      setReason(initialReason)
    }
  }, [open, initialReason])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return
    onConfirm(reason.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white rounded-[24px] p-6 sm:p-7 border border-stroke/50 shadow-modal">
        <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-extrabold text-focus">
                Flag Audit Discrepancy
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">
                Please provide the reason or details of the discrepancy found on{' '}
                <strong className="text-focus">{tenantName}</strong>'s lease.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label className="text-xs font-semibold text-focus block mb-1">
              Discrepancy Reason / Remarks <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the discrepancy, variance, or missing documents..."
              className="w-full p-3 rounded-xl border border-rose-300 bg-rose-50/20 text-xs sm:text-sm text-focus focus:outline-none focus:ring-2 focus:ring-rose-500/20 resize-none transition-all placeholder:text-muted-fg/60"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/30">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!reason.trim() || isSubmitting}
              className="h-10 px-5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              <span>{isSubmitting ? 'Submitting...' : 'Confirm Discrepancy'}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
