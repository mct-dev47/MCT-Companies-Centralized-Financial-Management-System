import * as React from 'react'
import { RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { NOTIFICATION_STYLES } from '@/components/common/Toaster'
import type { ToastVariant } from '@/lib/toastStore'

export interface ErrorBannerProps {
  /** Already user-facing message (produce it with `formatUserFriendlyErrorMessage`). Renders nothing when empty. */
  message?: React.ReactNode
  variant?: ToastVariant
  /** Shows a "Try again" button. */
  onRetry?: () => void
  retryLabel?: string
  isRetrying?: boolean
  /** Shows a dismiss (X) button. */
  onDismiss?: () => void
  className?: string
  children?: React.ReactNode
}

/**
 * Canonical inline notification banner.
 * Use for persistent page-load failures (with `onRetry`) and for inline form errors inside modals.
 * Transient action feedback should use the toast helpers in `@/utils/errorUtils` instead.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  variant = 'error',
  onRetry,
  retryLabel = 'Try again',
  isRetrying = false,
  onDismiss,
  className,
  children,
}) => {
  if (!message && !children) return null
  const style = NOTIFICATION_STYLES[variant]
  const Icon = style.Icon
  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex items-start justify-between gap-3 rounded-xl border p-3.5 text-xs sm:text-sm animate-in fade-in-0 duration-200',
        style.container,
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.icon)} />
        <div className="min-w-0 font-medium leading-snug">
          {message}
          {children}
        </div>
      </div>
      {(onRetry || onDismiss) && (
        <div className="flex shrink-0 items-center gap-1.5">
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying}
              className="h-8 gap-1.5 rounded-lg bg-white px-3 text-xs"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} />
              {retryLabel}
            </Button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg p-1 opacity-70 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

