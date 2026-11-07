import * as React from 'react'
import { Repeat } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  REPEAT_OPTIONS,
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

/** The Repeat dropdown, providing Daily and Monthly payment schedule options. */
export const RepeatSelect: React.FC<RepeatSelectProps> = ({ value, onChange, disabled, error, lockedReason }) => (
  <div className="space-y-1">
    <label htmlFor="lease-repeat" className="text-xs font-semibold text-focus flex items-center gap-1.5">
      <Repeat className="h-3.5 w-3.5 text-muted-fg" aria-hidden="true" />
      <span>Payment Schedule <span className="text-red-500">*</span></span>
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
  dueDate?: string
  leaseEndDate: string
  penaltyRate?: string
  rentAmount?: string
  onEndDateChange: (value: string) => void
  onPenaltyRateChange?: (value: string) => void
  disabled?: boolean
  errors: Record<string, string>
}

/** Lease End Date input. Late penalty and summary card removed per spec 0035. */
export const RepeatDetails: React.FC<RepeatDetailsProps> = ({
  repeat,
  leaseEndDate,
  onEndDateChange,
  disabled,
  errors,
}) => {
  if (repeat === 'None') return null

  return (
    <div className="space-y-1">
      <label htmlFor="lease-end-date" className="text-xs font-semibold text-focus block">
        Lease End Date <span className="text-red-500">*</span>
      </label>
      <Input
        id="lease-end-date"
        type="date"
        disabled={disabled}
        value={leaseEndDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        className={cn(
          'h-10 text-xs sm:text-sm rounded-xl border-stroke/50 disabled:opacity-60 disabled:cursor-not-allowed',
          errors.leaseEndDate && 'border-red-500'
        )}
      />
      {errors.leaseEndDate && <p className="text-[10px] text-red-600 font-medium">{errors.leaseEndDate}</p>}
    </div>
  )
}
