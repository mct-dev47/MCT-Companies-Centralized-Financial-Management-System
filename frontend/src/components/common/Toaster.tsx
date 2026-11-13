import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type ToastItem,
  type ToastVariant,
} from '@/lib/toastStore'

/** Shared visual tokens for every notification surface (toasts and banners).
 * All variants ensure >= 4.5:1 text-to-background contrast.
 */
export const NOTIFICATION_STYLES: Record<
  ToastVariant,
  { container: string; icon: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  error: {
    container: 'border-rose-200 bg-rose-50 text-rose-900',
    icon: 'text-rose-600',
    Icon: AlertCircle,
  },
  warning: {
    container: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: 'text-amber-700',
    Icon: AlertTriangle,
  },
  success: {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    icon: 'text-emerald-700',
    Icon: CheckCircle2,
  },
  info: {
    container: 'border-stroke/30 bg-white text-focus',
    icon: 'text-muted-fg',
    Icon: Info,
  },
}

const ToastCard: React.FC<{ toast: ToastItem }> = ({ toast }) => {
  const style = NOTIFICATION_STYLES[toast.variant]
  const Icon = style.Icon

  const handleUndo = () => {
    if (toast.onUndo) {
      toast.onUndo()
      dismissToast(toast.id)
    }
  }

  return (
    <div
      role={toast.variant === 'error' || toast.variant === 'warning' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-[16px] border p-4 shadow-soft animate-in fade-in-0 slide-in-from-top-4 sm:slide-in-from-bottom-4 duration-200',
        style.container
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', style.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-xs sm:text-sm leading-snug">
        {toast.title && <p className="font-semibold text-focus mb-0.5">{toast.title}</p>}
        <p className="font-normal break-words">{toast.message}</p>
        {toast.onUndo && (
          <button
            type="button"
            onClick={handleUndo}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline hover:no-underline text-focus cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{toast.undoLabel || 'Undo'}</span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="-m-1 rounded-[8px] p-1.5 opacity-70 transition-opacity hover:opacity-100 hover:bg-black/5 cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Global toast outlet. Mounted once in `App.tsx`; triggered through
 * `notifyError` / `notifyWarning` / `notifySuccess` / `notifyInfo` in `@/utils/errorUtils`.
 */
export const Toaster: React.FC = () => {
  const toasts = React.useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-4 right-4 sm:top-auto sm:bottom-6 sm:right-6 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

export default Toaster
