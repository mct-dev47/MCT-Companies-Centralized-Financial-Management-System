import * as React from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DropdownOption<T = string | number> {
  value: T
  label: React.ReactNode
  disabled?: boolean
  disabledReason?: string
  icon?: React.ReactNode
  dotColor?: string
}

export interface DropdownProps<T = string | number> {
  value?: T
  onChange?: (value: T) => void
  options: ReadonlyArray<DropdownOption<T> | T>
  placeholder?: string
  disabled?: boolean
  error?: boolean | string
  variant?: 'default' | 'cell' | 'filter'
  size?: 'default' | 'sm'
  searchable?: boolean
  searchPlaceholder?: string
  clearable?: boolean
  align?: 'left' | 'right'
  className?: string
  triggerClassName?: string
  menuClassName?: string
  name?: string
  id?: string
  'aria-label'?: string
  ariaLabel?: string
}

/**
 * Canonical Dropdown conforming to Phase 2 Design Standards:
 * - Trigger: Flat white bg, 1px border, control radius (10px), 44px min height (or 36px sm), chevron, visible focus ring.
 * - Menu Panel: Surface radius (16px), 1px border, ONE soft shadow, white bg.
 * - Items: Item radius (8px), 44px min height, light hover tint, maroon/primary check on selected, muted + reason on disabled.
 * - Cell Variant: Flat borderless cell trigger for tables and spreadsheets.
 * - Mobile: Adapts to bottom sheet overlay on viewports < 640px.
 * - Full keyboard navigation (Arrows, Enter, Escape, Tab) & accessible ARIA combobox/listbox roles.
 */
export function Dropdown<T extends string | number = string>({
  value,
  onChange,
  options = [],
  placeholder = 'Select option...',
  disabled = false,
  error,
  variant = 'default',
  size = 'default',
  searchable = false,
  searchPlaceholder = 'Search...',
  clearable = false,
  align = 'left',
  className,
  triggerClassName,
  menuClassName,
  name,
  id,
  'aria-label': ariaLabelProp,
  ariaLabel,
}: DropdownProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [focusedIndex, setFocusedIndex] = React.useState(-1)
  const [isMobile, setIsMobile] = React.useState(false)

  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // Track mobile viewport (< 640px)
  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Normalize options
  const normalizedOptions: DropdownOption<T>[] = React.useMemo(() => {
    return options.map((opt) => {
      if (opt !== null && typeof opt === 'object' && 'value' in opt) {
        return opt as DropdownOption<T>
      }
      return {
        value: opt as T,
        label: String(opt),
      }
    })
  }, [options])

  // Filter options if searchable
  const filteredOptions = React.useMemo(() => {
    if (!searchable || !searchQuery.trim()) return normalizedOptions
    const q = searchQuery.toLowerCase().trim()
    return normalizedOptions.filter((opt) => {
      const labelText = typeof opt.label === 'string' ? opt.label : String(opt.value)
      return labelText.toLowerCase().includes(q)
    })
  }, [normalizedOptions, searchable, searchQuery])

  // Active option
  const selectedOption = normalizedOptions.find((opt) => opt.value === value)

  // Close on outside click
  React.useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        menuRef.current?.contains(e.target as Node)
      ) {
        return
      }
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Focus search input on open if searchable
  React.useEffect(() => {
    if (isOpen && searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
    if (!isOpen) {
      setSearchQuery('')
      setFocusedIndex(-1)
    }
  }, [isOpen, searchable])

  const handleSelect = (opt: DropdownOption<T>) => {
    if (opt.disabled) return
    onChange?.(opt.value)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (e.key === 'Tab') {
      setIsOpen(false)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        const next = prev + 1 >= filteredOptions.length ? 0 : prev + 1
        return next
      })
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        const next = prev - 1 < 0 ? filteredOptions.length - 1 : prev - 1
        return next
      })
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
        const opt = filteredOptions[focusedIndex]
        if (!opt.disabled) handleSelect(opt)
      }
    }
  }

  const effectiveAriaLabel = ariaLabelProp || ariaLabel || (name ? `Select ${name}` : 'Dropdown selection')
  const hasError = Boolean(error)

  const isCell = variant === 'cell'

  return (
    <div
      className={cn(
        'relative text-left',
        isCell ? 'inline-block w-full h-full' : 'block w-full',
        className
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={effectiveAriaLabel}
        aria-invalid={hasError}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left transition-all outline-none select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
          // Cell variant vs Standard variant
          isCell
            ? 'h-full px-2 py-1 bg-transparent border-0 rounded-none text-xs hover:bg-black/5 focus:bg-white focus:ring-1 focus:ring-primary'
            : cn(
                'bg-white border text-focus text-xs sm:text-sm font-normal shadow-2xs',
                'rounded-full',
                size === 'sm' ? 'h-9 min-h-[36px] px-3.5' : 'h-11 min-h-[44px] px-4',
                hasError
                  ? 'border-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/30'
                  : 'border-stroke/40 hover:border-stroke/70 focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:border-focus'
              ),
          triggerClassName
        )}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
          {selectedOption?.icon && (
            <span className="shrink-0 text-muted-fg">{selectedOption.icon}</span>
          )}
          <span
            className={cn(
              'truncate',
              selectedOption ? 'text-focus font-medium' : 'text-muted-fg'
            )}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {clearable && selectedOption && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear selection"
              onClick={(e) => {
                e.stopPropagation()
                onChange?.('' as unknown as T)
              }}
              className="p-1 rounded-full text-muted-fg hover:text-focus hover:bg-surface transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={cn(
              'w-4 h-4 text-muted-fg transition-transform duration-200',
              isOpen && 'rotate-180 text-focus'
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* Dropdown Menu Panel */}
      {isOpen && (
        <>
          {/* Mobile Bottom-sheet backdrop */}
          {isMobile && (
            <div
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] animate-in fade-in"
              onClick={() => setIsOpen(false)}
            />
          )}

          <div
            ref={menuRef}
            role="listbox"
            aria-label={effectiveAriaLabel}
            className={cn(
              'bg-white border border-stroke/30 shadow-soft z-50 overflow-hidden flex flex-col',
              isMobile
                ? 'fixed inset-x-0 bottom-0 max-h-[80dvh] rounded-t-[16px] rounded-b-none p-4 pb-8 animate-in slide-in-from-bottom duration-200'
                : cn(
                    'absolute mt-1.5 min-w-[220px] max-h-[320px] rounded-[16px] p-1.5',
                    align === 'right' ? 'right-0' : 'left-0',
                    variant === 'cell' ? 'w-[260px]' : 'w-full'
                  ),
              menuClassName
            )}
          >
            {/* Mobile Sheet Handle */}
            {isMobile && (
              <div className="flex items-center justify-between pb-3 mb-2 border-b border-stroke/20">
                <span className="font-semibold text-focus text-sm">{placeholder}</span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-full text-muted-fg hover:text-focus"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Search Input if searchable */}
            {searchable && (
              <div className="p-1.5 border-b border-stroke/20 mb-1">
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-muted-fg absolute left-3 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-surface rounded-[8px] border border-stroke/30 outline-none focus:border-focus focus:ring-1 focus:ring-focus/30"
                  />
                </div>
              </div>
            )}

            {/* Options List */}
            <div className="overflow-y-auto overscroll-contain space-y-0.5 max-h-[260px] sm:max-h-[280px]">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-4 text-xs sm:text-sm text-center text-muted-fg">
                  No matching options found
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isSelected = opt.value === value
                  const isFocused = idx === focusedIndex

                  return (
                    <div
                      key={String(opt.value)}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={opt.disabled}
                      onClick={() => handleSelect(opt)}
                      onMouseEnter={() => setFocusedIndex(idx)}
                      className={cn(
                        'flex items-center justify-between gap-2 px-3 py-2.5 rounded-[8px] text-xs sm:text-sm transition-colors cursor-pointer select-none min-h-[44px]',
                        opt.disabled
                          ? 'opacity-40 cursor-not-allowed bg-transparent text-muted-fg'
                          : isSelected
                            ? 'bg-primary/5 text-primary font-semibold'
                            : isFocused
                              ? 'bg-surface text-focus'
                              : 'text-focus hover:bg-surface'
                      )}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <span className="truncate">{opt.label}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {opt.disabled && opt.disabledReason && (
                          <span className="text-[11px] text-muted-fg italic">
                            {opt.disabledReason}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Dropdown
