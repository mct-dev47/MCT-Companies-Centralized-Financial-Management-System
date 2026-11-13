import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type ModalSize,
} from '@/components/ui/dialog'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { cn } from '@/lib/utils'

export interface BaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  size?: ModalSize
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  overlayClassName?: string
  hideCloseButton?: boolean
  /** When true, prompt before closing if user has edited form fields */
  hasUnsavedChanges?: boolean
  /** Optional custom discard message */
  unsavedMessage?: string
  onCancel?: () => void
}

/**
 * Canonical BaseModal structure conforming to Phase 2 Design Standards:
 * - Surface radius: 16px (rounded-[16px])
 * - Consistent header with title, subtitle, optional icon badge, X close button with aria-label
 * - Scrollable body with internal overflow scrolling
 * - Sticky footer with standard button order (Cancel on left, Primary on right)
 * - Modal sizes: sm (400px), md (560px), lg (760px)
 * - Mobile (<640px): Full-width bottom-sheet layout, never exceeding viewport height
 * - Unsaved changes protection: prompts confirmation before discarding edits
 */
export const BaseModal: React.FC<BaseModalProps> = ({
  open,
  onOpenChange,
  title,
  description,
  icon,
  size = 'lg',
  footer,
  children,
  className,
  bodyClassName,
  overlayClassName,
  hideCloseButton = false,
  hasUnsavedChanges = false,
  unsavedMessage = 'You have unsaved changes. Are you sure you want to discard them and close?',
  onCancel,
}) => {
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false)

  const handleRequestClose = (nextOpen: boolean) => {
    if (!nextOpen && hasUnsavedChanges) {
      setShowDiscardConfirm(true)
      return
    }
    onOpenChange(nextOpen)
    if (!nextOpen) {
      onCancel?.()
    }
  }

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false)
    onOpenChange(false)
    onCancel?.()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleRequestClose}>
        <DialogContent
          size={size}
          overlayClassName={overlayClassName}
          hideCloseButton={hideCloseButton}
          preventBackdropClose={hasUnsavedChanges}
          className={cn('flex flex-col', className)}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              {icon && (
                <div className="w-10 h-10 rounded-[10px] bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <DialogTitle>{title}</DialogTitle>
                {description && (
                  <DialogDescription className="mt-0.5">{description}</DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Scrollable Body Container */}
          <div
            className={cn(
              'flex-1 overflow-y-auto overscroll-contain space-y-4 py-2 pr-1 -mr-1',
              bodyClassName
            )}
          >
            {children}
          </div>

          {/* Sticky Footer */}
          {footer && <DialogFooter>{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>

      {/* Discard Changes Prompt */}
      {showDiscardConfirm && (
        <ConfirmModal
          open={showDiscardConfirm}
          onOpenChange={setShowDiscardConfirm}
          title="Discard Unsaved Changes?"
          description={unsavedMessage}
          confirmLabel="Discard & Close"
          cancelLabel="Keep Editing"
          variant="destructive"
          action="warning"
          onConfirm={handleConfirmDiscard}
        />
      )}
    </>
  )
}

export default BaseModal
