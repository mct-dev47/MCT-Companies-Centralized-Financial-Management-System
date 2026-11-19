import * as React from 'react'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ReviewItem {
  label: string
  value: React.ReactNode
  isCurrency?: boolean
  highlight?: boolean
}

export interface ModalReviewStepProps {
  title?: string
  subtitle?: string
  items: ReviewItem[]
  warningNotice?: string
  errorMessage?: string | null
  className?: string
  variant?: 'warning' | 'neutral' | 'info'
  icon?: React.ReactNode
}

export const ModalReviewStep: React.FC<ModalReviewStepProps> = ({
  title = 'Review & Confirm',
  subtitle = 'Please verify the details below before submitting.',
  items,
  warningNotice,
  errorMessage,
  className,
  variant = 'warning',
  icon,
}) => {
  const renderBannerIcon = () => {
    if (icon !== undefined) return icon
    if (variant === 'neutral') {
      return <Info className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
    }
    if (variant === 'info') {
      return <Info className="h-4 w-4 text-sky-600 mt-0.5 shrink-0" aria-hidden="true" />
    }
    return <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
  }

  const getBannerStyles = () => {
    if (variant === 'neutral') {
      return {
        wrapper: 'rounded-[12px] bg-slate-100/90 border border-slate-200 p-3.5 flex items-start gap-2.5',
        title: 'font-semibold text-slate-800',
        subtitle: 'text-slate-600 mt-0.5',
      }
    }
    if (variant === 'info') {
      return {
        wrapper: 'rounded-[12px] bg-sky-500/10 border border-sky-500/20 p-3.5 flex items-start gap-2.5',
        title: 'font-semibold text-sky-950',
        subtitle: 'text-sky-800/90 mt-0.5',
      }
    }
    return {
      wrapper: 'rounded-[12px] bg-amber-500/10 border border-amber-500/20 p-3.5 flex items-start gap-2.5',
      title: 'font-semibold text-amber-900',
      subtitle: 'text-amber-800/90 mt-0.5',
    }
  }

  const bannerStyles = getBannerStyles()

  return (
    <div className={cn('space-y-4 py-2', className)}>
      <div className={bannerStyles.wrapper}>
        {renderBannerIcon()}
        <div className="text-xs leading-relaxed">
          <p className={bannerStyles.title}>{title}</p>
          <p className={bannerStyles.subtitle}>{subtitle}</p>
        </div>
      </div>

      {warningNotice && (
        <div className="rounded-[10px] bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 leading-relaxed">
          {warningNotice}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-[10px] bg-rose-50 border border-rose-300 p-3.5 text-xs text-rose-900 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Action Failed</p>
            <p className="mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      <div className="rounded-[12px] border border-stroke/40 bg-surface/30 divide-y divide-stroke/30 overflow-hidden text-sm">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between px-4 py-2.5 gap-4">
            <span className="text-xs font-medium text-muted-fg uppercase tracking-wider">{item.label}</span>
            <span
              className={cn(
                'text-sm font-medium text-focus text-right break-words max-w-[65%]',
                item.isCurrency && 'tabular-nums font-semibold text-primary',
                item.highlight && 'font-bold'
              )}
            >
              {item.value || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ModalReviewStep
