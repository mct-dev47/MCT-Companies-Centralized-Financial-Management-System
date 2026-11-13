import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

/** Standard Modal Size Classes matching Phase 2 specifications:
 *  sm (400px), md (560px), lg (760px)
 */
export const MODAL_SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[560px]',
  lg: 'sm:max-w-[760px]',
  xl: 'sm:max-w-[880px]',
  full: 'sm:max-w-[1040px]',
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] overscroll-contain data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    overlayClassName?: string
    size?: ModalSize
    hideCloseButton?: boolean
    /** When true, backdrop click prevents closing (useful when unsaved changes exist) */
    preventBackdropClose?: boolean
  }
>(({ className, overlayClassName, size = 'lg', hideCloseButton = false, preventBackdropClose = false, children, onPointerDownOutside, onInteractOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      onPointerDownOutside={(e) => {
        if (preventBackdropClose) {
          e.preventDefault()
        }
        onPointerDownOutside?.(e)
      }}
      onInteractOutside={(e) => {
        if (preventBackdropClose) {
          e.preventDefault()
        }
        onInteractOutside?.(e)
      }}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 flex flex-col w-[94vw] max-w-[calc(100vw-24px)] translate-x-[-50%] translate-y-[-50%] bg-white shadow-soft border border-stroke/30 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 max-h-[90dvh] overflow-hidden duration-200',
        'rounded-[16px] p-4 sm:p-6 md:p-8',
        // Mobile bottom-sheet layout below 640px
        'max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-full max-sm:rounded-t-[16px] max-sm:rounded-b-none max-sm:max-h-[92dvh] max-sm:p-4',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
        MODAL_SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close
          aria-label="Close modal"
          className="absolute right-4 top-4 h-9 w-9 rounded-full bg-surface hover:bg-stroke/20 text-muted-fg hover:text-focus flex items-center justify-center transition-colors outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 disabled:pointer-events-none cursor-pointer z-20 shadow-2xs"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const isCentered = className?.includes('text-center')
  return (
    <div
      className={cn(
        'flex flex-col space-y-1.5 pb-3 border-b border-stroke/20 shrink-0',
        isCentered ? 'text-center pr-0' : 'text-left pr-8',
        className
      )}
      {...props}
    />
  )
}
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-4 mt-auto border-t border-stroke/20 shrink-0 bg-white',
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-base sm:text-lg font-bold text-focus leading-tight tracking-tight',
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs sm:text-sm text-muted-fg font-normal leading-normal', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
