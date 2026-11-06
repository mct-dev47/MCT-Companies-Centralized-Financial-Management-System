import * as React from 'react'
import { Repeat } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatPHP } from '@/lib/format'
import {
  REPEAT_OPTIONS,
  MAX_PERIODS,
  countPeriods,
  describeRepeat,
  periodUnit,
  round2,
  type LeaseRepeat,
} from '@/services/tenantScheduleService'

const REPEAT_LABELS: Record<LeaseRepeat, string> = {
  None: 'Does not repeat',
  Daily: 'Daily',
  Monthly: 'Monthly',
  Quarterly: 'Quarterly',
  Annually: 'Annually',
}

interface RepeatSelectProps {
  value: LeaseRepeat
  onChange: (value: LeaseRepeat) => void
  disabled?: boolean
  error?: string
  lockedReason?: string
}

/** The Repeat dropdown, styled like Google Calendar's "Does not repeat" selector. */
export const RepeatSelect: React.FC<RepeatSelectProps> = ({ value, onChange, disabled, error, lockedReason }) => (
  <div className="space-y-1">
    <label htmlFor="lease-repeat" className="text-xs font-semibold text-focus flex items-center gap-1.5">
      <Repeat className="h-3.5 w-3.5 text-muted-fg" aria-hidden="true" />
      <span>Payment Schedule</span>
    </label>
    <select
      id="lease-repeat"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as LeaseRepeat)}
      className={cn(
        'w-full h-10 px-3 rounded-xl border bg-white text-xs sm:text-sm text-focus focus:outline-none focus:ring-1 focus:ring-focus disabled:opacity-60 disabled:cursor-not-allowed',
        error ? 'border-red-500' : 'border-stroke/50'
      )}
    >
      {REPEAT_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {REPEAT_LABELS[opt]}
        </option>
      ))}
    </select>
    {error && <p className="text-[10px] text-red-600 font-medium">{error}</p>}
    {!error && disabled && lockedReason && <p className="text-[10px] text-muted-fg">{lockedReason}</p>}
  </div>
)

interface RepeatDetailsProps {
  repeat: LeaseRepeat
  dueDate: string
  leaseEndDate: string
  penaltyRate: string
  rentAmount: string
  onEndDateChange: (value: string) => void
  onPenaltyRateChange: (value: string) => void
  errors: Record<string, string>
}

/** Lease End Date, optional Late Penalty, and the live summary. Renders nothing when not repeating. */
export const RepeatDetails: React.FC<RepeatDetailsProps> = ({
  repeat,
  dueDate,
  leaseEndDate,
  penaltyRate,
  rentAmount,
  onEndDateChange,
  onPenaltyRateChange,
  errors,
}) => {
  if (repeat === 'None') return null

  const count = countPeriods(dueDate, leaseEndDate, repeat)
  const rent = parseFloat(rentAmount)
  const hasRent = !isNaN(rent) && rent > 0
  const showSummary = count > 0
  const tooMany = count > MAX_PERIODS

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="lease-end-date" className="text-xs font-semibold text-focus block">
            Lease End Date <span className="text-red-500">*</span>
          </label>
          <Input
            id="lease-end-date"
            type="date"
            value={leaseEndDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', errors.leaseEndDate && 'border-red-500')}
          />
          {errors.leaseEndDate && <p className="text-[10px] text-red-600 font-medium">{errors.leaseEndDate}</p>}
        </div>

        <div className="space-y-1">
          <label htmlFor="lease-penalty" className="text-xs font-semibold text-focus block">
            Late Penalty (%) <span className="text-muted-fg font-normal">optional</span>
          </label>
          <Input
            id="lease-penalty"
            type="number"
            min="0"
            max="100"
            step="any"
            placeholder="Blank means no penalty"
            value={penaltyRate}
            onWheel={(e) => e.currentTarget.blur()}
            onKeyDown={(e) => {
              if (e.key === '-' || e.key === 'e' || e.key === 'E') {
                e.preventDefault()
              }
            }}
            onChange={(e) => {
              const val = e.target.value
              if (val.startsWith('-')) {
                onPenaltyRateChange('')
                return
              }
              onPenaltyRateChange(val)
            }}
            className={cn('h-10 text-xs sm:text-sm rounded-xl border-stroke/50', errors.penaltyRate && 'border-red-500')}
          />
          {errors.penaltyRate ? (
            <p className="text-[10px] text-red-600 font-medium">{errors.penaltyRate}</p>
          ) : (
            <p className="text-[10px] text-muted-fg">Charged once on a period's rent when it is not paid by its due date.</p>
          )}
        </div>
      </div>

      <div
        className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 text-xs"
        aria-live="polite"
        data-testid="repeat-summary"
      >
        <div className="font-semibold text-focus">
          {showSummary && !tooMany
            ? describeRepeat(repeat, dueDate, count)
            : tooMany
            ? `More than ${MAX_PERIODS} payments`
            : 'Pick a First Due Date and a Lease End Date to see the schedule'}
        </div>
        {showSummary && !tooMany && hasRent && (
          <div className="flex justify-between items-center text-muted-fg">
            <span>
              {count} {periodUnit(repeat).toLowerCase()}
              {count === 1 ? '' : 's'} × {formatPHP(rent)}
            </span>
            <span className="font-bold text-emerald-600 text-sm">{formatPHP(round2(rent * count))}</span>
          </div>
        )}
      </div>
    </div>
  )
}
