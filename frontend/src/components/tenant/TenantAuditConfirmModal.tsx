import React from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface TenantAuditConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantName?: string
  unitName?: string
  isSubmitting: boolean
  onConfirm: () => void
}

export const TenantAuditConfirmModal: React.FC<TenantAuditConfirmModalProps> = ({
  open,
  onOpenChange,
  tenantName,
  unitName,
  isSubmitting,
  onConfirm,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white rounded-[24px] p-6 sm:p-7 border border-stroke/50 shadow-modal">
        <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-extrabold text-focus">
                Mark Lease as Audited
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">
                Confirm that you have reviewed the lease terms, payments, and agreement for{' '}
                <strong className="text-focus">{tenantName}</strong> ({unitName}).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 space-y-1">
          <p className="font-semibold text-emerald-800">
            Audit Verification
          </p>
          <p className="text-[11px] text-emerald-700 leading-relaxed">
            This record will be officially stamped with your name and today's date. Once marked as audited, further modifications will reset the status to pending audit.
          </p>
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
            type="button"
            disabled={isSubmitting}
            onClick={onConfirm}
            className="h-10 px-5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-xs flex items-center gap-1.5"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span>{isSubmitting ? 'Saving...' : 'Confirm & Mark as Audited'}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
