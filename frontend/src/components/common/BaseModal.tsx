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
}

/**
 * Canonical base modal structure:
 * - Uniform overlay, rounded-[24px] container, border, and shadow
 * - Consistent header with optional icon badge, title, subtitle, and single top-right close button
 * - Scrollable body
 * - Consistent footer layout
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
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={size}
        overlayClassName={overlayClassName}
        hideCloseButton={hideCloseButton}
        className={className}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            {icon && (
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription className="mt-0.5">{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>

        <div className={cn('space-y-4 pt-1', bodyClassName)}>{children}</div>

        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

