import * as React from 'react'
import {
  Calendar as CalendarIcon,
  Clock,
  ChevronDown,
  Check,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatToMMDDYYYY, formatToYYYYMMDD } from '@/utils/dateUtils'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'

export interface DateRange {
  startDate: string | null // ISO YYYY-MM-DD
  endDate: string | null   // ISO YYYY-MM-DD
  label: string
  preset?: string | null   // e.g. 'Last 7 Days', 'Last 30 Days', 'Custom', etc.
}

export interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
  hidePresets?: boolean
  compact?: boolean
}

export interface DatePresetOption {
  label: string
  startDate: string | null
  endDate: string | null
}

export const getDatePresets = (): DatePresetOption[] => {
  const now = new Date()
  const todayStr = formatToYYYYMMDD(now)

  const d7 = new Date(now)
  d7.setDate(now.getDate() - 6)
  const d7Str = formatToYYYYMMDD(d7)

  const d30 = new Date(now)
  d30.setDate(now.getDate() - 29)
  const d30Str = formatToYYYYMMDD(d30)

  const currYear = now.getFullYear()
  const currMonth = String(now.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(currYear, now.getMonth() + 1, 0).getDate()
  const monthStart = `${currYear}-${currMonth}-01`
  const monthEnd = `${currYear}-${currMonth}-${String(lastDay).padStart(2, '0')}`

  const monthNum = now.getMonth() + 1
  let qStart = '01'
  let qEnd = '03'
  let qEndDay = '31'
  if (monthNum >= 4 && monthNum <= 6) {
    qStart = '04'
    qEnd = '06'
    qEndDay = '30'
  } else if (monthNum >= 7 && monthNum <= 9) {
    qStart = '07'
    qEnd = '09'
    qEndDay = '30'
  } else if (monthNum >= 10) {
    qStart = '10'
    qEnd = '12'
    qEndDay = '31'
  }

  return [
    {
      label: 'All Dates',
      startDate: null,
      endDate: null,
    },
    {
      label: 'Today',
      startDate: todayStr,
      endDate: todayStr,
    },
    {
      label: 'Last 7 Days',
      startDate: d7Str,
      endDate: todayStr,
    },
    {
      label: 'Last 30 Days',
      startDate: d30Str,
      endDate: todayStr,
    },
    {
      label: 'This Month',
      startDate: monthStart,
      endDate: monthEnd,
    },
    {
      label: 'This Quarter',
      startDate: `${currYear}-${qStart}-01`,
      endDate: `${currYear}-${qEnd}-${qEndDay}`,
    },
    {
      label: 'This Year',
      startDate: `${currYear}-01-01`,
      endDate: `${currYear}-12-31`,
    },
  ]
}

export const DATE_PRESETS: DatePresetOption[] = getDatePresets()

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  value,
  onChange,
  className,
  hidePresets = false,
  compact = false,
}) => {
  const presets = React.useMemo(() => getDatePresets(), [])

  // Preset dropdown open state
  const [isPresetOpen, setIsPresetOpen] = React.useState(false)
  const presetDropdownRef = React.useRef<HTMLDivElement>(null)

  // Custom date picker popover open state
  const [isCalendarOpen, setIsCalendarOpen] = React.useState(false)
  const calendarPopoverRef = React.useRef<HTMLDivElement>(null)

  const presetPos = useDropdownPosition(presetDropdownRef, isPresetOpen)
  const calendarPos = useDropdownPosition(calendarPopoverRef, isCalendarOpen)

  // Track if active selection is custom
  const isCustomRange = Boolean(
    value.preset === 'Custom' ||
      (!value.preset &&
        Boolean(value.startDate) &&
        !presets.some(
          (p) =>
            p.startDate === value.startDate &&
            p.endDate === value.endDate &&
            p.label !== 'All Dates'
        ))
  )

  const activePresetLabel = React.useMemo(() => {
    if (value.preset === 'Custom') return 'Custom'
    const matched = presets.find(
      (p) => p.startDate === value.startDate && p.endDate === value.endDate
    )
    if (matched) return matched.label
    if (value.preset) {
      const matchByName = presets.find(
        (p) =>
          p.label.toLowerCase() === value.preset?.toLowerCase() ||
          p.label.toLowerCase().replace(/\s+/g, '_') === value.preset?.toLowerCase()
      )
      if (matchByName) return matchByName.label
      return value.preset
    }
    if (value.startDate || value.endDate) return 'Custom'
    return 'All Dates'
  }, [value.preset, value.startDate, value.endDate, presets])

  // Custom date draft state: Start Date & End Date
  const [draftStart, setDraftStart] = React.useState<string>(value.startDate || '')
  const [draftEnd, setDraftEnd] = React.useState<string>(value.endDate || '')

  // Sync draft whenever popover is opened (defaults to current month if empty)
  React.useEffect(() => {
    if (isCalendarOpen) {
      const now = new Date()
      const currYear = now.getFullYear()
      const currMonth = String(now.getMonth() + 1).padStart(2, '0')
      const lastDay = new Date(currYear, now.getMonth() + 1, 0).getDate()
      const defaultStart = `${currYear}-${currMonth}-01`
      const defaultEnd = `${currYear}-${currMonth}-${String(lastDay).padStart(2, '0')}`

      setDraftStart(value.startDate || defaultStart)
      setDraftEnd(value.endDate || defaultEnd)
    }
  }, [isCalendarOpen, value.startDate, value.endDate])

  // Close menus on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        presetDropdownRef.current &&
        !presetDropdownRef.current.contains(target)
      ) {
        setIsPresetOpen(false)
      }
      if (
        calendarPopoverRef.current &&
        !calendarPopoverRef.current.contains(target)
      ) {
        setIsCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle preset selection
  const handleSelectPreset = (preset: DatePresetOption) => {
    setDraftStart(preset.startDate || '')
    setDraftEnd(preset.endDate || '')
    onChange({
      startDate: preset.startDate,
      endDate: preset.endDate,
      label: preset.label,
      preset: preset.label,
    })
    setIsPresetOpen(false)
  }

  // Apply custom start date & end date
  const handleApplyCustom = () => {
    const s = draftStart.trim()
    const e = draftEnd.trim()
    if (!s && !e) return

    const start = s || e
    const end = e || s
    if (!start || !end) return

    const min = start <= end ? start : end
    const max = start <= end ? end : start

    const label =
      min === max
        ? formatToMMDDYYYY(min)
        : `${formatToMMDDYYYY(min)} - ${formatToMMDDYYYY(max)}`

    onChange({
      startDate: min,
      endDate: max,
      label,
      preset: 'Custom',
    })
    setIsCalendarOpen(false)
  }

  // Clear custom date selection
  const handleClearCustom = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setDraftStart('')
    setDraftEnd('')
    onChange({
      startDate: null,
      endDate: null,
      label: 'All Dates',
      preset: 'All Dates',
    })
    setIsCalendarOpen(false)
  }

  // Label to show on custom date trigger button
  const customPillLabel = React.useMemo(() => {
    if (isCustomRange && value.startDate) {
      if (value.startDate === value.endDate) {
        return formatToMMDDYYYY(value.startDate)
      }
      return `${formatToMMDDYYYY(value.startDate)} - ${formatToMMDDYYYY(value.endDate)}`
    }
    return 'Custom Date'
  }, [isCustomRange, value.startDate, value.endDate])

  return (
    <div className={cn('inline-flex items-center gap-2 sm:gap-2.5 shrink-0 flex-nowrap', className)}>
      {/* 1. Preset Dropdown (Last 7 days, Last 30 days, This Month, etc. or 'Custom') */}
      {!hidePresets && (
        <div className="relative inline-block shrink-0" ref={presetDropdownRef}>
          <button
            type="button"
            onClick={() => {
              setIsPresetOpen((prev) => !prev)
              setIsCalendarOpen(false)
            }}
            className={cn(
              'inline-flex items-center rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus shrink-0 whitespace-nowrap',
              compact
                ? 'h-9 px-2.5 sm:px-3 text-xs gap-1.5'
                : 'h-10 sm:h-11 px-3 sm:px-4 text-xs sm:text-sm gap-2',
              isPresetOpen && 'ring-2 ring-slate-100 border-slate-300'
            )}
            aria-expanded={isPresetOpen}
            aria-haspopup="listbox"
            aria-label="Filter by time period preset"
          >
            <Clock className={cn('shrink-0 text-muted-fg', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            <span className="font-semibold text-focus/90">
              {activePresetLabel}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-fg shrink-0 ml-0.5" />
          </button>

          {isPresetOpen && (
            <div
              style={presetPos.isMobile ? presetPos.style : undefined}
              className={cn(
                'bg-white rounded-2xl border border-stroke/30 shadow-xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                presetPos.isMobile
                  ? 'w-[min(calc(100vw-32px),240px)]'
                  : 'absolute left-0 top-full mt-2 w-52'
              )}
            >
              <div className="pb-2 mb-1 border-b border-stroke/20 px-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                  Preset Periods
                </span>
              </div>
              <div className="space-y-1">
                {presets.map((preset) => {
                  const isSelected = activePresetLabel === preset.label
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                        isSelected
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-surface'
                      )}
                    >
                      <span>{preset.label}</span>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  )
                })}

                {/* Custom indicator option */}
                {isCustomRange && (
                  <div className="pt-1 mt-1 border-t border-stroke/20">
                    <div className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary">
                      <span>Custom Selection</span>
                      <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Custom Date Picker beside the preset dropdown */}
      <div className="relative inline-block shrink-0" ref={calendarPopoverRef}>
        <button
          type="button"
          onClick={() => {
            setIsCalendarOpen((prev) => !prev)
            setIsPresetOpen(false)
          }}
          className={cn(
            'inline-flex items-center rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus shrink-0 whitespace-nowrap',
            compact
              ? 'h-9 px-2.5 sm:px-3 text-xs gap-1.5'
              : 'h-10 sm:h-11 px-3 sm:px-4 text-xs sm:text-sm gap-2',
            (isCalendarOpen || isCustomRange) &&
              'ring-2 ring-primary/20 border-primary text-primary',
            isCustomRange && 'bg-primary/5 font-semibold'
          )}
          aria-expanded={isCalendarOpen}
          aria-haspopup="dialog"
          aria-label="Pick custom start and end date"
        >
          <CalendarIcon
            className={cn(
              compact ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0',
              isCustomRange ? 'text-primary' : 'text-muted-fg'
            )}
          />
          <span className={cn('font-semibold truncate', compact ? 'max-w-[120px] sm:max-w-[160px]' : 'max-w-[170px] sm:max-w-[210px]')}>
            {customPillLabel}
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 ml-0.5',
              isCustomRange ? 'text-primary' : 'text-muted-fg'
            )}
          />
          {isCustomRange && value.startDate && (
            <span
              onClick={handleClearCustom}
              className="p-0.5 rounded-full hover:bg-primary/20 text-primary transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
              title="Clear custom date filter"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>

        {/* Popover: Positioned with right-0 so it never clips off the right screen boundary */}
        {isCalendarOpen && (
          <div
            style={calendarPos.isMobile ? calendarPos.style : undefined}
            className={cn(
              'bg-white rounded-2xl border border-stroke/30 shadow-2xl p-4 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
              calendarPos.isMobile
                ? 'w-[min(calc(100vw-32px),320px)]'
                : 'absolute right-0 top-full mt-2 w-72 sm:w-80'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stroke/20">
              <span className="text-xs font-bold uppercase tracking-wider text-focus">
                Custom Date Range
              </span>
              {(draftStart || draftEnd || (isCustomRange && value.startDate)) && (
                <button
                  type="button"
                  onClick={handleClearCustom}
                  className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                >
                  Clear Custom
                </button>
              )}
            </div>

            {/* Start Date & End Date inputs */}
            <div className="py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-muted-fg block mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={draftStart}
                    onChange={(e) => setDraftStart(e.target.value)}
                    className="w-full text-xs h-9 px-2.5 rounded-xl border border-stroke/60 bg-white text-focus focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs font-medium cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-fg block mb-1.5">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={draftEnd}
                    onChange={(e) => setDraftEnd(e.target.value)}
                    className="w-full text-xs h-9 px-2.5 rounded-xl border border-stroke/60 bg-white text-focus focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs font-medium cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-stroke/20">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCalendarOpen(false)}
                className="flex-1 h-8 text-xs font-medium text-muted-fg rounded-lg cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleApplyCustom}
                disabled={!draftStart.trim() && !draftEnd.trim()}
                className="flex-1 h-8 text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white rounded-lg shadow-xs disabled:opacity-40 cursor-pointer"
              >
                Apply Range
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
