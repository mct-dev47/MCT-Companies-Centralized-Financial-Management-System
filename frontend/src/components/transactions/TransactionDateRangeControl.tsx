import * as React from 'react'
import { Calendar as CalendarIcon, Check, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DateRange } from '@/components/ui/DateRangePicker'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'
import { cn } from '@/lib/utils'
import { formatToMMDDYYYY, formatToYYYYMMDD } from '@/utils/dateUtils'

export interface TransactionDateRangeControlProps {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
  /** Stretch container and trigger button to fill parent width cleanly. */
  fullWidth?: boolean
}

interface PresetItem {
  key: 'All Dates' | 'Today' | 'Yesterday' | 'This week'
  label: string
  startDate: string | null
  endDate: string | null
}

function buildPresets(): PresetItem[] {
  const now = new Date()
  const todayStr = formatToYYYYMMDD(now)

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayStr = formatToYYYYMMDD(yesterday)

  // Monday-based current week through today (or Sunday)
  const dayOfWeek = now.getDay() // 0 = Sun, 1 = Mon, ...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - diffToMonday)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  return [
    {
      key: 'All Dates',
      label: 'All Dates',
      startDate: null,
      endDate: null,
    },
    {
      key: 'Today',
      label: 'Today',
      startDate: todayStr,
      endDate: todayStr,
    },
    {
      key: 'Yesterday',
      label: 'Yesterday',
      startDate: yesterdayStr,
      endDate: yesterdayStr,
    },
    {
      key: 'This week',
      label: 'This week',
      startDate: formatToYYYYMMDD(weekStart),
      endDate: formatToYYYYMMDD(weekEnd),
    },
  ]
}

function formatShortDisplayRange(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return 'All Dates'
  const s = startDate ? formatToMMDDYYYY(startDate) : ''
  const e = endDate ? formatToMMDDYYYY(endDate) : ''
  if (s && e && s === e) return s
  if (s && e) return `${s} – ${e}`
  return s || e || 'Custom'
}

/**
 * Single merged Date Range control for the Transactions page with presets
 * (All Dates, Today, Yesterday, This week) and inline Custom date inputs.
 */
export const TransactionDateRangeControl: React.FC<TransactionDateRangeControlProps> = ({
  value,
  onChange,
  className,
  fullWidth = false,
}) => {
  const presets = React.useMemo(() => buildPresets(), [])
  const [isOpen, setIsOpen] = React.useState(false)
  const [showCustomInputs, setShowCustomInputs] = React.useState(value.preset === 'Custom')
  const [draftStart, setDraftStart] = React.useState(value.startDate || '')
  const [draftEnd, setDraftEnd] = React.useState(value.endDate || '')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const pos = useDropdownPosition(containerRef, isOpen)

  React.useEffect(() => {
    if (!isOpen) return
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen])

  const openPopover = () => {
    const nextOpen = !isOpen
    if (nextOpen) {
      setDraftStart(value.startDate || '')
      setDraftEnd(value.endDate || '')
      setShowCustomInputs(value.preset === 'Custom' || Boolean(value.startDate && !presets.some((p) => p.startDate === value.startDate && p.endDate === value.endDate)))
    }
    setIsOpen(nextOpen)
  }

  const matchedPreset = presets.find(
    (p) => p.startDate === value.startDate && p.endDate === value.endDate
  )

  const triggerLabel =
    value.preset === 'Custom'
      ? formatShortDisplayRange(value.startDate, value.endDate)
      : matchedPreset?.label ||
        (value.startDate || value.endDate
          ? formatShortDisplayRange(value.startDate, value.endDate)
          : 'All Dates')

  const isActive = Boolean(value.startDate || value.endDate)

  const handleSelectPreset = (preset: PresetItem) => {
    setDraftStart(preset.startDate || '')
    setDraftEnd(preset.endDate || '')
    setShowCustomInputs(false)
    onChange({
      startDate: preset.startDate,
      endDate: preset.endDate,
      label: preset.label,
      preset: preset.key,
    })
    setIsOpen(false)
  }

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault()
    const s = draftStart.trim()
    const endVal = draftEnd.trim()
    if (!s && !endVal) return
    const start = s || endVal
    const end = endVal || s
    const min = start <= end ? start : end
    const max = start <= end ? end : start

    onChange({
      startDate: min,
      endDate: max,
      label: formatShortDisplayRange(min, max),
      preset: 'Custom',
    })
    setIsOpen(false)
  }

  const handleClear = () => {
    setDraftStart('')
    setDraftEnd('')
    setShowCustomInputs(false)
    onChange({
      startDate: null,
      endDate: null,
      label: 'All Dates',
      preset: 'All Dates',
    })
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', fullWidth ? 'block w-full' : 'inline-block', className)}>
      <button
        type="button"
        onClick={openPopover}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Filter by date range: ${triggerLabel}`}
        className={cn(
          'inline-flex items-center gap-2 min-h-[44px] h-11 px-4 rounded-full border bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          fullWidth && 'w-full justify-between',
          isActive ? 'border-primary/50 bg-primary/5 text-focus' : 'border-stroke/60',
          isOpen && 'ring-2 ring-focus/20 border-focus/50'
        )}
      >
        <span className={cn('inline-flex items-center gap-2 min-w-0', fullWidth && 'flex-1 text-left')}>
          <CalendarIcon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-fg')} />
          <span className={cn('font-semibold text-focus truncate', fullWidth ? 'w-full' : 'max-w-[190px]')}>{triggerLabel}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-150',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Date range options"
          style={pos.isMobile ? pos.style : undefined}
          className={cn(
            'bg-white rounded-2xl border border-stroke/30 shadow-2xl p-3 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
            pos.isMobile
              ? 'w-[min(calc(100vw-32px),320px)]'
              : 'absolute right-0 top-full mt-2 w-72 sm:w-80'
          )}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-stroke/20 px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
              Date Range
            </span>
            {isActive && (
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline px-2 py-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <X className="h-3 w-3" />
                <span>Clear</span>
              </button>
            )}
          </div>

          <div className="space-y-1">
            {presets.map((preset) => {
              const isSelected = !showCustomInputs && matchedPreset?.key === preset.key
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={cn(
                    'w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    isSelected
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-focus/85 hover:bg-surface'
                  )}
                >
                  <span>{preset.label}</span>
                  {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
              )
            })}

            <button
              type="button"
              onClick={() => setShowCustomInputs((prev) => !prev)}
              className={cn(
                'w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                showCustomInputs || value.preset === 'Custom'
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-focus/85 hover:bg-surface'
              )}
            >
              <span>Custom</span>
              {(showCustomInputs || value.preset === 'Custom') && (
                <Check className="h-4 w-4 text-primary shrink-0" />
              )}
            </button>
          </div>

          {showCustomInputs && (
            <form onSubmit={handleApplyCustom} className="mt-3 pt-3 border-t border-stroke/20 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="tx-custom-date-start"
                    className="text-[11px] font-semibold text-muted-fg block mb-1"
                  >
                    Start date
                  </label>
                  <input
                    id="tx-custom-date-start"
                    type="date"
                    value={draftStart}
                    onChange={(e) => setDraftStart(e.target.value)}
                    className="w-full min-h-[44px] text-xs px-2.5 rounded-xl border border-stroke/60 bg-white text-focus focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tx-custom-date-end"
                    className="text-[11px] font-semibold text-muted-fg block mb-1"
                  >
                    End date
                  </label>
                  <input
                    id="tx-custom-date-end"
                    type="date"
                    value={draftEnd}
                    onChange={(e) => setDraftEnd(e.target.value)}
                    className="w-full min-h-[44px] text-xs px-2.5 rounded-xl border border-stroke/60 bg-white text-focus focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="min-h-[44px] px-4 text-xs rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!draftStart.trim() && !draftEnd.trim()}
                  className="min-h-[44px] px-4 text-xs rounded-xl"
                >
                  Apply
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

