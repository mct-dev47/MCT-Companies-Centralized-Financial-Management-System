import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'

export interface DropdownFilterOption<T extends string = string> {
  value: T
  label: string
  /** Optional status dot color class (e.g. 'bg-emerald-500') */
  dotClassName?: string
  dotColor?: string
  activeVariant?: string
  /** Optional active pill style when this option is selected */
  activePillClassName?: string
  /** Optional active item style in the menu when this option is selected */
  activeItemClassName?: string
}

export interface DropdownFilterProps<T extends string = string> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<DropdownFilterOption<T> | T>
  /** Default/reset value (e.g. 'All' or 'All Companies' or ''). When `value === defaultValue`, placeholder is shown if provided. */
  defaultValue?: T
  /** Placeholder text when `value === defaultValue` (e.g. 'Status', 'All Categories'). */
  placeholder?: string
  allLabel?: string
  /** Optional leading icon on the pill button. */
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode
  /** Optional header title inside the popover (e.g. 'Filter By Company'). */
  menuTitle?: string
  title?: string
  /** Show a search input inside the popover (useful for long company lists). */
  searchable?: boolean
  searchPlaceholder?: string
  /** Show inline clear (X) button on the pill and 'Clear Filter' in header when active. */
  clearable?: boolean
  /** Alignment of popover menu. Defaults to 'right'. */
  align?: 'left' | 'right'
  className?: string
  menuClassName?: string
  menuWidthClassName?: string
  ariaLabel?: string
  /** Hide colored status dots inside dropdown menu options. */
  hideOptionDots?: boolean
  /** Stretch container and trigger button to fill parent width cleanly. */
  fullWidth?: boolean
}

const STATUS_PRESETS: Record<
  string,
  { pill?: string; item?: string }
> = {
  Paid: {
    pill: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  },
  Completed: {
    pill: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  },
  Approved: {
    pill: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  },
  'Fully Paid': {
    pill: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  },
  Pending: {
    pill: 'border-yellow-400 bg-yellow-50 text-yellow-800',
    item: 'bg-yellow-100 text-yellow-800 font-semibold',
  },
  'Partially Paid': {
    pill: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  Unpaid: {
    pill: 'border-rose-300 bg-rose-50 text-rose-700',
  },
  Overdue: {
    pill: 'border-rose-300 bg-rose-50 text-rose-700',
  },
  Disapproved: {
    pill: 'border-rose-300 bg-rose-50 text-rose-700',
  },
  Active: {
    pill: 'border-blue-300 bg-blue-50 text-blue-700',
  },
}

/**
 * Canonical DropdownFilter component used across all pages:
 * - Same pill trigger (`h-11 px-4 rounded-full border`)
 * - Same placeholder, selected-state styling, status dot indicators, and clear/reset behavior
 * - Built-in outside-click and Escape handling
 */
export function DropdownFilter<T extends string = string>({
  value,
  onChange,
  options,
  defaultValue,
  placeholder,
  allLabel,
  icon: Icon,
  menuTitle,
  title,
  searchable = false,
  searchPlaceholder = 'Search…',
  clearable = false,
  align = 'right',
  className,
  menuClassName,
  menuWidthClassName,
  ariaLabel,
  hideOptionDots = false,
  fullWidth = false,
}: DropdownFilterProps<T>) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const pos = useDropdownPosition(containerRef, open)

  const effectivePlaceholder = placeholder || allLabel
  const effectiveMenuTitle = menuTitle || title

  const normalizedOptions: DropdownFilterOption<T>[] = React.useMemo(
    () =>
      options.map((opt) => {
        if (typeof opt === 'string') {
          const preset = STATUS_PRESETS[opt]
          return {
            value: opt,
            label: opt,
            activePillClassName: preset?.pill,
            activeItemClassName: preset?.item,
          }
        }
        const preset = STATUS_PRESETS[opt.value]
        return {
          ...opt,
          activePillClassName: opt.activePillClassName ?? preset?.pill,
          activeItemClassName: opt.activeItemClassName ?? preset?.item,
        }
      }),
    [options, hideOptionDots]
  )

  const resolvedDefault =
    defaultValue !== undefined
      ? defaultValue
      : (normalizedOptions[0]?.value as T)

  const selectedOption = normalizedOptions.find((o) => o.value === value)
  const isDefault =
    defaultValue !== undefined ? value === defaultValue : !selectedOption

  const filteredOptions = React.useMemo(() => {
    if (!searchable || !search.trim()) return normalizedOptions
    const q = search.trim().toLowerCase()
    return normalizedOptions.filter((o) => o.label.toLowerCase().includes(q))
  }, [normalizedOptions, search, searchable])

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleReset = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    onChange(resolvedDefault)
    setOpen(false)
    setSearch('')
  }

  // Display label on pill
  const displayLabel =
    isDefault && effectivePlaceholder
      ? effectivePlaceholder
      : selectedOption?.label ?? String(value)

  const renderIcon = () => {
    if (!Icon) return null
    if (React.isValidElement(Icon)) return Icon
    const IconComp = Icon as React.ComponentType<{ className?: string }>
    return <IconComp className="h-4 w-4 text-muted-fg shrink-0" />
  }

  return (
    <div ref={containerRef} className={cn('relative', fullWidth ? 'block w-full' : 'inline-block')}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel || effectivePlaceholder || effectiveMenuTitle}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 min-h-[44px] h-11 px-4 rounded-full border bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40',
          fullWidth && 'w-full justify-between',
          !isDefault && selectedOption?.activePillClassName
            ? selectedOption.activePillClassName
            : 'border-stroke/60 hover:border-stroke/80',
          open && 'ring-2 ring-focus/20 border-focus',
          className
        )}
      >
        <span className={cn('inline-flex items-center gap-2 min-w-0', fullWidth && 'flex-1 text-left')}>
          {renderIcon()}
          <span className={cn('font-medium truncate', fullWidth ? 'w-full' : 'max-w-[160px]')}>
            {displayLabel}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 shrink-0">
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
          {clearable && !isDefault && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleReset}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleReset()
              }}
              className="p-0.5 rounded-full hover:bg-stroke/20 text-muted-fg hover:text-focus transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
              title="Clear filter"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </span>
      </button>

      {open && (
        <div
          style={pos.isMobile ? pos.style : undefined}
          className={cn(
            'bg-white rounded-[16px] border border-stroke/30 shadow-soft p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
            pos.isMobile
              ? 'w-[min(calc(100vw-32px),320px)] overflow-y-auto'
              : cn(
                  'absolute top-full mt-2 min-w-[12rem]',
                  searchable ? 'w-68 p-2.5 shadow-soft' : 'w-48',
                  menuWidthClassName,
                  align === 'left' ? 'left-0' : 'right-0'
                ),
            menuClassName
          )}
        >
          {(effectiveMenuTitle || (clearable && !isDefault)) && (
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-stroke/20 px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                {effectiveMenuTitle || effectivePlaceholder || 'Filter'}
              </span>
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => handleReset()}
                  className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                >
                  Clear Filter
                </button>
              )}
            </div>
          )}

          {searchable && (
            <div className="px-1 pb-2">
              <Input
                type="text"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 text-xs rounded-[8px]"
                autoFocus
              />
            </div>
          )}

          <div className="space-y-0.5 max-h-56 overflow-y-auto pr-0.5">
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-fg">
                No matching options
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <button
                    key={opt.value || '__empty__'}
                    type="button"
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                      setSearch('')
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2.5 rounded-[8px] text-xs sm:text-sm font-medium transition-colors text-left cursor-pointer min-h-[44px]',
                      isSelected
                        ? opt.activeItemClassName ||
                            'bg-primary/10 text-primary font-semibold'
                        : 'text-focus hover:bg-surface'
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="truncate">{opt.label}</span>
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
