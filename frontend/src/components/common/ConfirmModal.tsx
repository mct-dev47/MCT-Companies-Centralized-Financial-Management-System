import * as React from 'react'
import {
  CheckCircle2,
  Trash2,
  Pencil,
  PlusCircle,
  AlertTriangle,
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

export interface ConfirmModalProps {
  open?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  title: string
  description?: string | React.ReactNode
  message?: string | React.ReactNode
  /** Optional summary card or extra content rendered between description and buttons */
  children?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'primary' | 'destructive' | 'default'
  actionType?: 'add' | 'edit' | 'delete' | 'warning' | 'submit' | 'default'
  onConfirm: () => void | Promise<void>
  isLoading?: boolean
  loadingLabel?: string
  confirmDisabled?: boolean
}

/**
 * Canonical Confirmation Modal used across the entire system for delete,
 * discard, submit, endorse, approve, and other confirmation actions.
 *
 * Button order: Cancel (outline/secondary) on the left, Confirm (primary/destructive) on the right.
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  isOpen,
  onOpenChange,
  onClose,
  title,
  description,
  message,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  actionType = 'default',
  onConfirm,
  isLoading = false,
  loadingLabel = 'Processing…',
  confirmDisabled = false,
}) => {
  const isModalOpen = open ?? isOpen ?? false
  const handleOpenChange = (val: boolean) => {
    if (onOpenChange) onOpenChange(val)
    if (!val && onClose) onClose()
  }
  const effectiveDescription = description ?? message ?? ''

  const effectiveAction =
    actionType === 'default' && variant === 'destructive' ? 'delete' : actionType

  const getIcon = () => {
    switch (effectiveAction) {
      case 'delete':
        return (
          <div className="h-14 w-14 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-primary shadow-xs">
            <Trash2 className="h-7 w-7 text-primary" />
          </div>
        )
      case 'warning':
        return (
          <div className="h-14 w-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shadow-xs">
            <AlertTriangle className="h-7 w-7 text-amber-700" />
          </div>
        )
      case 'edit':
        return (
          <div className="h-14 w-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shadow-xs">
            <Pencil className="h-7 w-7 text-amber-700" />
          </div>
        )
      case 'add':
        return (
          <div className="h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-xs">
            <PlusCircle className="h-7 w-7 text-emerald-700" />
          </div>
        )
      default:
        return (
          <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
        )
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        size="sm"
        overlayClassName="z-[60]"
        className="sm:max-w-[500px] rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl text-center z-[70]"
      >
        <div className="flex flex-col items-center space-y-4 pt-1">
          {getIcon()}

          <DialogHeader className="text-center sm:text-center space-y-1.5 border-b-0 pb-0 pr-0">
            <DialogTitle className="text-xl sm:text-2xl font-bold text-focus text-center">
              {title}
            </DialogTitle>
            {effectiveDescription && (
              <DialogDescription className="text-sm text-muted-fg leading-relaxed text-center max-w-md mx-auto">
                {effectiveDescription}
              </DialogDescription>
            )}
          </DialogHeader>

          {children && <div className="w-full text-left">{children}</div>}

          <div className="flex flex-col-reverse sm:flex-row items-center justify-center gap-2.5 sm:gap-3 pt-3 w-full">
            {Boolean(cancelLabel) && (
              <Button
                type="button"
                variant="outline"
                disabled={isLoading}
                onClick={() => handleOpenChange(false)}
                className="w-full sm:flex-1 h-11 rounded-xl border border-stroke/50 text-focus hover:bg-surface text-sm font-medium transition-colors"
              >
                {cancelLabel}
              </Button>
            )}
            <Button
              type="button"
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              disabled={isLoading || confirmDisabled}
              onClick={onConfirm}
              className="w-full sm:flex-1 h-11 rounded-xl text-sm font-semibold shadow-xs flex items-center justify-center gap-2 transition-all bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#960C01]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{loadingLabel}</span>
                </>
              ) : (
                <span>{confirmLabel}</span>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
