import * as React from 'react'
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatusType =
  | 'Paid'
  | 'Verified'
  | 'Audited'
  | 'Approved'
  | 'Active'
  | 'Pending'
  | 'Pending Audit'
  | 'Pending Approval'
  | 'Pending Finance Assignment'
  | 'Unpaid'
  | 'Flagged'
  | 'Discrepancy'
  | 'Overdue'
  | 'Rejected'
  | 'Disapproved'
  | 'On hold'
  | 'On Hold'
  | 'Partially Paid'
  | 'Inactive'
  | 'Closed'
  | 'Missed'
  | string

export interface StatusBadgeProps {
  status: StatusType
  className?: string
  showIcon?: boolean
  label?: string
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className,
  showIcon = true,
  label,
}) => {
  const norm = (status || '').trim().toLowerCase()
  const displayLabel = label || status || '—'

  // Emerald (Success: Paid, Verified, Audited, Approved, Active)
  if (['paid', 'verified', 'audited', 'approved', 'active'].includes(norm)) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs select-none whitespace-nowrap',
          className
        )}
      >
        {showIcon && <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />}
        <span>{displayLabel === 'Verified' ? 'Audited' : displayLabel}</span>
      </span>
    )
  }

  // Amber (Pending / Warning: Pending, Pending Audit, Pending Approval, On hold, Partially Paid)
  if (norm.startsWith('pending') || norm === 'on hold' || norm === 'partially paid') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shadow-2xs select-none whitespace-nowrap',
          className
        )}
      >
        {showIcon && <Clock className="w-3 h-3 text-amber-600 shrink-0" />}
        <span>{displayLabel}</span>
      </span>
    )
  }

  // Rose (Danger / Discrepancy / Overdue / Unpaid / Rejected)
  if (['unpaid', 'flagged', 'discrepancy', 'overdue', 'rejected', 'disapproved', 'missed'].includes(norm)) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs select-none whitespace-nowrap',
          className
        )}
      >
        {showIcon && <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />}
        <span>{displayLabel === 'Flagged' ? 'Discrepancy' : displayLabel}</span>
      </span>
    )
  }

  // Neutral / Stone / Slate (Closed, Inactive, Default)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200 shadow-2xs select-none whitespace-nowrap',
        className
      )}
    >
      <span>{displayLabel}</span>
    </span>
  )
}

