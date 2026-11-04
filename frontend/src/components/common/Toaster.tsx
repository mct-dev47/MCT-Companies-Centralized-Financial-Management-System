import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type ToastItem,
  type ToastVariant,
} from '@/lib/toastStore'

/** Shared visual tokens for every notification surface (toasts and banners). */
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
    icon: 'text-amber-600',
    Icon: AlertTriangle,
  },
  success: {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    icon: 'text-emerald-600',
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
  return (
    <div
      role={toast.variant === 'error' || toast.variant === 'warning' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-2xl border p-4 shadow-xl animate-in fade-in-0 slide-in-from-bottom-4 duration-200',
        style.container
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', style.icon)} />
      <div className="min-w-0 flex-1 text-sm leading-snug">
        {toast.title && <p className="font-semibold">{toast.title}</p>}
        <p className="font-medium break-words">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        className="-m-1 rounded-lg p-1 opacity-70 transition-opacity hover:opacity-100"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
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
      className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-[calc(100vw-3rem)] max-w-sm flex-col gap-2.5"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

