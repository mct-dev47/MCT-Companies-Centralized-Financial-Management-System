import * as React from 'react'
import { cn } from '@/lib/utils'
import type { LifecycleStep, LifecycleStepState, TransactionLifecycleInfo } from '@/utils/transactionLifecycle'

interface TransactionProgressProps {
  lifecycle: TransactionLifecycleInfo
  className?: string
}

function getDotClasses(state: LifecycleStepState): string {
  switch (state) {
    case 'done':
      // Gray = done
      return 'bg-slate-600 border-slate-600'
    case 'waiting':
      // Amber = waiting
      return 'bg-amber-50 border-2 border-amber-600'
    case 'problem':
      // Red = problem
      return 'bg-rose-50 border-2 border-rose-600'
    case 'upcoming':
    default:
      // Future stage not yet reached
      return 'bg-white border border-slate-300'
  }
}

function getConnectorClasses(leftState: LifecycleStepState): string {
  return leftState === 'done' ? 'bg-slate-500' : 'bg-slate-200'
}

function getLabelClasses(tone: TransactionLifecycleInfo['tone']): string {
  switch (tone) {
    case 'problem':
      return 'text-rose-700'
    case 'waiting':
      return 'text-amber-800'
    case 'done':
    default:
      return 'text-slate-700'
  }
}

function describeStepForAria(step: LifecycleStep): string {
  const stateWord =
    step.state === 'done'
      ? 'done'
      : step.state === 'waiting'
        ? 'waiting'
        : step.state === 'problem'
          ? 'problem'
          : 'not started'
  return `${step.title} ${stateWord}`
}

/**
 * Semantic text-first status badge for the unified Status column
 * (e.g. "Audit pending", "Audited", "Awaiting transfer", "Awaiting deposit", "Unpaid").
 */
export const TransactionStatusBadge: React.FC<{
  lifecycle: TransactionLifecycleInfo
  className?: string
}> = ({ lifecycle, className }) => {
  const { shortStatusLabel, label, tone, steps } = lifecycle
  const badgeToneClasses =
    tone === 'problem'
      ? 'bg-rose-50 text-rose-800 border-rose-200'
      : tone === 'done'
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : 'bg-amber-50 text-amber-800 border-amber-200'

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap leading-none',
        badgeToneClasses,
        className
      )}
      aria-label={`Status: ${label}`}
      title={steps.map((s) => `${s.title}: ${s.state}`).join(' · ')}
    >
      {shortStatusLabel}
    </span>
  )
}

/**
 * Single lifecycle progress indicator replacing the separate Status, Deposit Status, and Audit Status pills.
 * Displays dynamic connected nodes (4 for Sales: Sold -> Paid -> Deposited -> Audited; 2 for Expenses: Payment status -> Audited) paired with an explicit text label.
 */
export const TransactionProgress: React.FC<TransactionProgressProps> = ({
  lifecycle,
  className,
}) => {
  const { steps, label, tone } = lifecycle
  const ariaSummary = `Progress: ${steps.map(describeStepForAria).join(', ')}. Status: ${label}`

  return (
    <div
      className={cn('inline-flex flex-col items-start gap-1 min-w-0 max-w-full', className)}
      aria-label={ariaSummary}
      title={steps.map((s) => `${s.title}: ${s.state}`).join(' · ')}
    >
      <div className="flex items-center" aria-hidden="true">
        {steps.map((step, idx) => (
          <React.Fragment key={step.key}>
            <span
              className={cn(
                'inline-block h-2.5 w-2.5 rounded-full shrink-0 transition-colors',
                getDotClasses(step.state)
              )}
            />
            {idx < steps.length - 1 && (
              <span
                className={cn(
                  'inline-block h-[1.5px] w-4 shrink-0',
                  getConnectorClasses(step.state)
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>
      <span className={cn('text-xs font-semibold leading-tight', getLabelClasses(tone))}>
        {label}
      </span>
    </div>
  )
}

