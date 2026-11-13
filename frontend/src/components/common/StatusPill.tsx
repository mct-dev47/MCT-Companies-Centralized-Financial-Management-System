import * as React from 'react'
import { CheckCircle2, AlertCircle, Clock, CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatusPillVariant = 'green' | 'amber' | 'red' | 'gray'

export interface StatusPillProps {
  status: string
  label?: string
  variant?: StatusPillVariant
  showIcon?: boolean
  className?: string
}

/**
 * Standard StatusPill Component conforming to Phase 2 Section C & A Standards:
 * - Shows color dot/badge + accessible text label (never color alone)
 * - Meets >= 4.5:1 text-to-background contrast ratio across all variants
 * - Standard status palette:
 *   - Amber: waiting, pending, review, on hold
 *   - Red: problem, rejected, overdue, discrepancy, destructive
 *   - Green: success, paid, audited, approved, verified, completed, active
 *   - Gray: neutral, closed, inactive, draft
 */
export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  variant,
  showIcon = true,
  className,
}) => {
  const norm = (status || '').trim().toLowerCase()
  const displayLabel = label || status || '—'

  // Determine variant from status if not explicitly passed
  const resolvedVariant: StatusPillVariant = React.useMemo(() => {
    if (variant) return variant
    if (['paid', 'verified', 'audited', 'approved', 'active', 'completed', 'done', 'deposited', 'fully paid'].includes(norm)) {
      return 'green'
    }
    if (norm.startsWith('pending') || norm === 'on hold' || norm === 'partially paid' || norm === 'waiting') {
      return 'amber'
    }
    if (['unpaid', 'flagged', 'discrepancy', 'overdue', 'rejected', 'disapproved', 'missed', 'failed', 'problem'].includes(norm)) {
      return 'red'
    }
    return 'gray'
  }, [norm, variant])

  switch (resolvedVariant) {
    case 'green':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/90 select-none whitespace-nowrap shadow-2xs',
            className
          )}
        >
          {showIcon && <CheckCircle2 className="w-3 h-3 text-emerald-700 shrink-0" aria-hidden="true" />}
          <span>{displayLabel === 'Verified' ? 'Audited' : displayLabel}</span>
        </span>
      )

    case 'amber':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 select-none whitespace-nowrap shadow-2xs',
            className
          )}
        >
          {showIcon && <Clock className="w-3 h-3 text-amber-700 shrink-0" aria-hidden="true" />}
          <span>{displayLabel}</span>
        </span>
      )

    case 'red':
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200 select-none whitespace-nowrap shadow-2xs',
            className
          )}
        >
          {showIcon && <AlertCircle className="w-3 h-3 text-rose-700 shrink-0" aria-hidden="true" />}
          <span>{displayLabel === 'Flagged' ? 'Discrepancy' : displayLabel}</span>
        </span>
      )

    case 'gray':
    default:
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200 select-none whitespace-nowrap shadow-2xs',
            className
          )}
        >
          {showIcon && <CircleDot className="w-3 h-3 text-slate-600 shrink-0" aria-hidden="true" />}
          <span>{displayLabel}</span>
        </span>
      )
  }
}

export { StatusBadge } from './StatusBadge'
export default StatusPill
