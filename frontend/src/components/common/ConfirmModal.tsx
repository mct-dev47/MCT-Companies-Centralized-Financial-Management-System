import * as React from 'react'
import {
  CheckCircle2,
  Trash2,
  Pencil,
  PlusCircle,
  AlertTriangle,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  action?: 'add' | 'edit' | 'delete' | 'warning' | 'submit' | 'default'
  onConfirm: () => void | Promise<void>
  isLoading?: boolean
  loadingLabel?: string
  confirmDisabled?: boolean
  /** Inline error message if the action failed. Modal stays open so user can retry. */
  errorMessage?: string | null
  /** Callback for Retry button when errorMessage is displayed */
  onRetry?: () => void
}

/**
 * Canonical Confirmation Modal conforming to Phase 2 Section F Standards:
 * - Surface radius: 16px (rounded-[16px])
 * - Explicit plain statement: what will happen, count of items, and amount where relevant
 * - Primary button repeats explicit action verb (e.g. "Mark as Deposited"), not generic "OK"
 * - Destructive actions use Destructive button variant
 * - Loading state with spinner; modal stays open until request completes
 * - Failure handling: modal stays open and renders an error banner with a Retry button
 * - Button order: Cancel on the left, Primary/Destructive on the right
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
  action,
  onConfirm,
  isLoading = false,
  loadingLabel = 'Processing…',
  confirmDisabled = false,
  errorMessage,
  onRetry,
}) => {
  const isModalOpen = open ?? isOpen ?? false
  const handleOpenChange = (val: boolean) => {
    if (isLoading) return // Prevent closing while processing
    if (onOpenChange) onOpenChange(val)
    if (!val && onClose) onClose()
  }
  const effectiveDescription = description ?? message ?? ''

  const resolvedAction = action ?? actionType
  const isDestructive = variant === 'destructive' || resolvedAction === 'delete'

  const getIcon = () => {
    if (isDestructive) {
      return (
        <div className="h-12 w-12 rounded-[10px] bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shadow-xs">
          <Trash2 className="h-6 w-6 text-rose-600" aria-hidden="true" />
        </div>
      )
    }

    switch (resolvedAction) {
      case 'warning':
      case 'edit':
        return (
          <div className="h-12 w-12 rounded-[10px] bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shadow-xs">
            {resolvedAction === 'warning' ? (
              <AlertTriangle className="h-6 w-6 text-amber-700" aria-hidden="true" />
            ) : (
              <Pencil className="h-6 w-6 text-amber-700" aria-hidden="true" />
            )}
          </div>
        )
      case 'add':
        return (
          <div className="h-12 w-12 rounded-[10px] bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-xs">
            <PlusCircle className="h-6 w-6 text-emerald-700" aria-hidden="true" />
          </div>
        )
      default:
        return (
          <div className="h-12 w-12 rounded-[10px] bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
        )
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        size="sm"
        overlayClassName="z-[60]"
        hideCloseButton={isLoading}
        preventBackdropClose={isLoading}
        className="sm:max-w-[440px] rounded-[16px] p-5 sm:p-6 bg-white border border-stroke/30 shadow-soft text-center z-[70]"
      >
        <div className="flex flex-col items-center space-y-3.5 pt-1">
          {getIcon()}

          <DialogHeader className="text-center sm:text-center space-y-1.5 border-b-0 pb-0 pr-0">
            <DialogTitle className="text-lg sm:text-xl font-bold text-focus text-center">
              {title}
            </DialogTitle>
            {effectiveDescription && (
              <DialogDescription className="text-xs sm:text-sm text-muted-fg leading-relaxed text-center max-w-sm mx-auto">
                {effectiveDescription}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* Children Summary or Content */}
          {children && <div className="w-full text-left">{children}</div>}

          {/* Error Banner inside Modal on failure */}
          {errorMessage && (
            <div
              role="alert"
              className="w-full rounded-[10px] bg-rose-50 border border-rose-200 p-3 text-left flex items-start gap-2.5 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-rose-800">Action failed</p>
                <p className="text-xs text-rose-700 mt-0.5 leading-normal">{errorMessage}</p>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-rose-800 hover:text-rose-950 underline"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry action</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons: Cancel on left, Action on right */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-center gap-2.5 sm:gap-3 pt-3 w-full">
            {Boolean(cancelLabel) && (
              <Button
                type="button"
                variant="outline"
                disabled={isLoading}
                onClick={() => handleOpenChange(false)}
                className="w-full sm:flex-1 h-11 rounded-[10px] border border-stroke/40 text-focus hover:bg-surface text-xs sm:text-sm font-semibold transition-colors"
              >
                {cancelLabel}
              </Button>
            )}
            <Button
              type="button"
              variant={isDestructive ? 'destructive' : 'default'}
              disabled={isLoading || confirmDisabled}
              onClick={onConfirm}
              isLoading={isLoading}
              loadingText={loadingLabel}
              className="w-full sm:flex-1 h-11 rounded-[10px] text-xs sm:text-sm font-semibold shadow-xs flex items-center justify-center gap-2 transition-all"
            >
              <span>{confirmLabel}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ConfirmModal
