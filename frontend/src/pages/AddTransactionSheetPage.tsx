import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Plus,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MoreVertical,
  RotateCcw,
  Landmark,
  X,
} from 'lucide-react'
import { receivablesStore, type CustomerType } from '@/services/receivablesStore'
import { receivablesService } from '@/services/receivablesService'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { BackButton, ErrorBanner } from '@/components/common'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { salesService } from '@/services/salesService'
import { expenseService } from '@/services/expenseService'
import { pettyCashService } from '@/services/pettyCashService'
import { loanService, type CompanyOption } from '@/services/loanService'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { formatRealName } from '@/utils/formatRealName'
import {
  formatParticularsString,
  parseParticulars,
  normalizeParticularStatus,
  type ParticularItem,
} from '@/utils/particularsUtils'
import { cn } from '@/lib/utils'
import { SALES_CATEGORY_LIST } from '@/utils/categoryConstants'
import { bankService, type BankAccount } from '@/services/bankService'
import { isCompanyMatch } from '@/utils/companyUtils'
import {
  particularsService,
  type CompanyParticular,
} from '@/services/particularsService'
import {
  paymentMethodService,
  type CompanyPaymentMethod,
} from '@/services/paymentMethodService'

export interface UnpaidAssignmentRow {
  rowId: string
  saleLineIndex: number
  particulars: string
  quantity: number
  unitPrice: number
  total: number
  customerType: CustomerType
  customerName: string
}

export interface SpreadsheetRow {
  id: string
  date: string
  particulars: string
  category: string
  paymentMethod: string
  serviceFee?: number | ''
  chequeNo: string
  unitPrice: number | ''
  quantity: number | ''
  status: 'Paid' | 'Unpaid' | 'Pending'
  depositStatus: 'Deposited' | 'Not Deposited'
}

export interface RowValidationError {
  rowIndex: number
  rowId: string
  missingParticulars: boolean
  missingCategory: boolean
  missingPrice: boolean
}

export const DEFAULT_SALES_PAYMENT_METHODS = [
  'Cash',
  'Cheque',
  'GCash',
] as const

export const DEFAULT_EXPENSE_PAYMENT_METHODS = [
  'Cash',
  'Cheque',
  'GCash',
  'Petty Cash',
] as const

const SALES_PAYMENT_METHODS = DEFAULT_SALES_PAYMENT_METHODS

const EXPENSE_PAYMENT_METHODS = DEFAULT_EXPENSE_PAYMENT_METHODS

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rendered Fee',
  'Petty Cash',
  'BBMP Foundation',
  'HDMF',
  'Philhealth',
  'Electricity',
  'BIR',
  'Payroll',
  'SSS',
  'Hotel Supplies',
  'Revolving Funds',
] as const

export const PREDEFINED_PETTY_CASH_CATEGORIES = [
  'Office Supplies',
  'Courier',
  'Transportation',
  'Fuel',
  'Toll & Parking',
  'Meals & Snacks',
  'Pantry',
  'Cleaning',
  'Kitchen Supplies',
  'Repairs',
  'Electrical',
  'First Aid',
  'Notarial Fees',
  'Representation',
  'Errands',
  'Rent',
] as const

export const PREDEFINED_PETTY_CASH_PARTICULARS = PREDEFINED_PETTY_CASH_CATEGORIES

const DEPRECATED_OLD_CATEGORIES = new Set([
  'gcash',
  'maya',
  'panda',
  'package 1',
  'in-house',
  'cheque',
  'cash',
  'bank transfer',
  'paymongo',
  'office supplies',
  'kitchen & food supplies',
  'utilities',
  'salaries & wages',
  'rent & lease',
  'maintenance & repairs',
  'transportation & logistics',
  'marketing & advertising',
  'equipment',
  'petty cash replenishment',
])

interface AddTransactionSheetPageProps {
  initialType?: 'Sales' | 'Expense'
}

interface PortalDropdownPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  openUpward: boolean
}

function useComboboxPortalPosition(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dropdownRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  onClose: () => void,
  minWidth: number
): PortalDropdownPosition | null {
  const [pos, setPos] = React.useState<PortalDropdownPosition | null>(null)

  const updatePosition = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()

    // Close if input scrolled completely out of visible area
    if (rect.bottom < 48 || rect.top > window.innerHeight - 24) {
      onClose()
      return
    }

    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow
    const availableSpace = openUpward ? spaceAbove : spaceBelow
    const maxHeight = Math.min(240, Math.max(120, availableSpace - 44))
    const width = Math.min(
      Math.max(rect.width, minWidth),
      window.innerWidth - 16
    )
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8)
    )

    setPos({
      top: openUpward ? rect.top - 4 : rect.bottom + 4,
      left,
      width,
      maxHeight,
      openUpward,
    })
  }, [containerRef, minWidth, onClose])

  React.useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null)
      return
    }

    updatePosition()

    const handleScroll = (e: Event) => {
      if (
        dropdownRef.current &&
        e.target instanceof Node &&
        dropdownRef.current.contains(e.target)
      ) {
        return
      }
      updatePosition()
    }

    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, updatePosition, dropdownRef])

  return pos
}

interface ParticularsComboboxProps {
  value: string
  onChange: (val: string) => void
  onSelect: (val: string) => void
  savedParticulars: CompanyParticular[]
  suggestions: CompanyParticular[]
  onSaveToList: (text: string) => Promise<void>
  onDeleteFromList: (id: number) => Promise<void>
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste?: (e: React.ClipboardEvent) => void
  inputRef?: (el: HTMLInputElement | null) => void
  placeholder?: string
  isPartial?: boolean
  hasError?: boolean
}

const ParticularsCombobox: React.FC<ParticularsComboboxProps> = ({
  value,
  onChange,
  onSelect,
  savedParticulars,
  suggestions,
  onSaveToList,
  onDeleteFromList,
  onKeyDown,
  onPaste,
  inputRef,
  placeholder,
  isPartial,
  hasError,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isTypingFilter, setIsTypingFilter] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const internalInputRef = React.useRef<HTMLInputElement | null>(null)

  const setMergedInputRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      internalInputRef.current = el
      inputRef?.(el)
    },
    [inputRef]
  )

  const closeMenu = React.useCallback(() => {
    setIsOpen(false)
    setIsTypingFilter(false)
    setHighlightedIndex(-1)
  }, [])

  const pos = useComboboxPortalPosition(
    containerRef,
    dropdownRef,
    isOpen,
    closeMenu,
    260
  )

  const trimmedValue = value.trim()

  const filtered = React.useMemo(() => {
    if (!isTypingFilter || !trimmedValue) return suggestions
    return suggestions.filter((p) =>
      p.name.toLowerCase().includes(trimmedValue.toLowerCase())
    )
  }, [suggestions, trimmedValue, isTypingFilter])

  const hasPersistedMatch = React.useMemo(() => {
    if (!trimmedValue) return false
    return savedParticulars.some(
      (p) => p.name.trim().toLowerCase() === trimmedValue.toLowerCase()
    )
  }, [savedParticulars, trimmedValue])

  const canSaveToList = trimmedValue.length > 0 && !hasPersistedMatch
  const totalOptions = (canSaveToList ? 1 : 0) + filtered.length

  React.useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, closeMenu])

  const handleKeyDownInternal = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setIsTypingFilter(false)
        setIsOpen(true)
        setHighlightedIndex(totalOptions > 0 ? 0 : -1)
        e.preventDefault()
        return
      }
      if (totalOptions > 0) {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev + 1) % totalOptions)
        return
      }
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) {
        setIsTypingFilter(false)
        setIsOpen(true)
        setHighlightedIndex(Math.max(0, totalOptions - 1))
        e.preventDefault()
        return
      }
      if (totalOptions > 0) {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev - 1 + totalOptions) % totalOptions)
        return
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (isOpen && highlightedIndex >= 0) {
        if (canSaveToList && highlightedIndex === 0) {
          onSaveToList(trimmedValue)
          onSelect(trimmedValue)
        } else {
          const itemIdx = canSaveToList ? highlightedIndex - 1 : highlightedIndex
          if (itemIdx >= 0 && itemIdx < filtered.length) {
            onSelect(filtered[itemIdx].name)
          } else {
            onSelect(trimmedValue || value)
          }
        }
        closeMenu()
        return
      } else if (isOpen && filtered.length > 0) {
        onSelect(filtered[0].name)
        closeMenu()
        return
      } else if (canSaveToList) {
        onSaveToList(trimmedValue)
        onSelect(trimmedValue)
        closeMenu()
        return
      } else {
        onSelect(trimmedValue || value)
        closeMenu()
        return
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        closeMenu()
        return
      }
    } else if (e.key === 'Tab') {
      closeMenu()
    }

    onKeyDown(e)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative w-full flex items-center">
        <input
          ref={setMergedInputRef}
          type="text"
          placeholder={placeholder || 'Type or select a particular...'}
          value={value}
          onFocus={() => {
            setHighlightedIndex(-1)
          }}
          onClick={() => {
            if (!isOpen) {
              setIsTypingFilter(false)
              setIsOpen(true)
              setHighlightedIndex(-1)
            }
          }}
          onChange={(e) => {
            onChange(e.target.value)
            setIsTypingFilter(true)
            if (!isOpen) setIsOpen(true)
            setHighlightedIndex(-1)
          }}
          onKeyDown={handleKeyDownInternal}
          onPaste={onPaste}
          className={cn(
            'w-full h-9 pl-2.5 pr-7 text-xs sm:text-sm text-focus rounded-lg border bg-white focus:outline-none focus:ring-1 transition-all box-border',
            hasError
              ? 'border-rose-500 bg-rose-50/20 focus:border-rose-600 focus:ring-rose-600'
              : isPartial
              ? 'border-amber-400 bg-amber-50/20 focus:border-amber-500 focus:ring-amber-500'
              : 'border-slate-200/80 hover:border-slate-300 focus:border-focus focus:ring-focus'
          )}
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle particulars list"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              if (isOpen) {
                closeMenu()
              } else {
                setIsTypingFilter(false)
                setIsOpen(true)
                setHighlightedIndex(-1)
                internalInputRef.current?.focus({ preventScroll: true })
              }
            }}
            className="h-6 w-6 rounded-md text-slate-400 hover:text-focus hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 transition-transform duration-150',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        </div>
      </div>

      {isOpen &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              width: `${pos.width}px`,
              transform: pos.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="fixed bg-white rounded-xl border border-stroke/40 shadow-2xl z-[99999] overflow-hidden py-1 animate-in fade-in-50 duration-150"
          >
            {canSaveToList && (
              <div
                className={cn(
                  'px-3 py-2 text-xs font-semibold text-[#960C01] bg-red-50/60 hover:bg-red-100/80 border-b border-red-100 flex items-center justify-between cursor-pointer transition-colors',
                  highlightedIndex === 0 && 'bg-red-200/80 font-bold'
                )}
                onClick={() => {
                  onSaveToList(trimmedValue)
                  onSelect(trimmedValue)
                  closeMenu()
                }}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    + Save &ldquo;{trimmedValue}&rdquo; to my list
                  </span>
                </div>
                <span className="text-[10px] bg-[#960C01] text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ml-2 shrink-0">
                  New
                </span>
              </div>
            )}

            {filtered.length === 0 && !canSaveToList ? (
              <div className="px-3 py-3 text-xs text-muted-fg italic text-center">
                No saved particulars yet. Type one, then choose &ldquo;Save to my
                list&rdquo;.
              </div>
            ) : (
              <div
                style={{ maxHeight: `${pos.maxHeight}px` }}
                className="overflow-y-auto"
              >
                {filtered.map((item, idx) => {
                  const actualIndex = canSaveToList ? idx + 1 : idx
                  const isSelected =
                    trimmedValue.length > 0 &&
                    item.name.trim().toLowerCase() === trimmedValue.toLowerCase()
                  return (
                    <div
                      key={`${item.id}-${item.name}`}
                      className={cn(
                        'px-3 py-2 text-xs text-focus flex items-center justify-between cursor-pointer group hover:bg-slate-100 transition-colors gap-2',
                        (highlightedIndex === actualIndex || isSelected) &&
                          'bg-slate-50 font-medium',
                        highlightedIndex === actualIndex && 'bg-slate-100'
                      )}
                      onClick={() => {
                        onSelect(item.name)
                        closeMenu()
                      }}
                    >
                      <span className="truncate flex-1">{item.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-[#960C01] shrink-0" />
                        )}
                        {typeof item.id === 'number' && item.id > 0 && (
                          <button
                            type="button"
                            aria-label={`Remove ${item.name} from saved list`}
                            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Remove from saved list"
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteFromList(item.id as number)
                            }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

interface CategoryComboboxProps {
  value: string
  defaultCategory: string
  onChange: (val: string) => void
  onSelect: (val: string) => void
  persistedCategories: string[]
  categories: string[]
  onSaveCategory: (name: string) => Promise<void>
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste?: (e: React.ClipboardEvent) => void
  inputRef?: (el: HTMLInputElement | null) => void
  placeholder?: string
  hasError?: boolean
}

const CategoryCombobox: React.FC<CategoryComboboxProps> = ({
  value,
  defaultCategory,
  onChange,
  onSelect,
  persistedCategories,
  categories,
  onSaveCategory,
  onKeyDown,
  onPaste,
  inputRef,
  placeholder,
  hasError,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isTypingFilter, setIsTypingFilter] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const internalInputRef = React.useRef<HTMLInputElement | null>(null)

  const setMergedInputRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      internalInputRef.current = el
      inputRef?.(el)
    },
    [inputRef]
  )

  const closeMenu = React.useCallback(() => {
    setIsOpen(false)
    setIsTypingFilter(false)
    setHighlightedIndex(-1)
  }, [])

  const pos = useComboboxPortalPosition(
    containerRef,
    dropdownRef,
    isOpen,
    closeMenu,
    210
  )

  const trimmedValue = value.trim()

  const filtered = React.useMemo(() => {
    if (!isTypingFilter || !trimmedValue) return categories
    return categories.filter((c) =>
      c.toLowerCase().includes(trimmedValue.toLowerCase())
    )
  }, [categories, trimmedValue, isTypingFilter])

  const hasPersistedMatch = React.useMemo(() => {
    if (!trimmedValue) return false
    return persistedCategories.some(
      (c) => c.trim().toLowerCase() === trimmedValue.toLowerCase()
    )
  }, [persistedCategories, trimmedValue])

  const canSaveToList = trimmedValue.length > 0 && !hasPersistedMatch
  const totalOptions = (canSaveToList ? 1 : 0) + filtered.length

  React.useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, closeMenu])

  const handleKeyDownInternal = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setIsTypingFilter(false)
        setIsOpen(true)
        setHighlightedIndex(totalOptions > 0 ? 0 : -1)
        e.preventDefault()
        return
      }
      if (totalOptions > 0) {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev + 1) % totalOptions)
        return
      }
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) {
        setIsTypingFilter(false)
        setIsOpen(true)
        setHighlightedIndex(Math.max(0, totalOptions - 1))
        e.preventDefault()
        return
      }
      if (totalOptions > 0) {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev - 1 + totalOptions) % totalOptions)
        return
      }
    } else if (e.key === 'Enter') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        if (highlightedIndex >= 0) {
          if (canSaveToList && highlightedIndex === 0) {
            onSaveCategory(trimmedValue)
            onSelect(trimmedValue)
          } else {
            const itemIdx = canSaveToList ? highlightedIndex - 1 : highlightedIndex
            if (itemIdx >= 0 && itemIdx < filtered.length) {
              onSelect(filtered[itemIdx])
            } else {
              onSelect(trimmedValue || value)
            }
          }
        } else if (filtered.length > 0) {
          onSelect(filtered[0])
        } else if (canSaveToList) {
          onSaveCategory(trimmedValue)
          onSelect(trimmedValue)
        } else {
          onSelect(trimmedValue || value)
        }
        closeMenu()
        return
      }
      closeMenu()
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        closeMenu()
        return
      }
    } else if (e.key === 'Tab') {
      closeMenu()
    }

    onKeyDown(e)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative w-full flex items-center">
        <input
          ref={setMergedInputRef}
          type="text"
          placeholder={placeholder || 'Select or type category...'}
          value={value}
          onFocus={(e) => {
            setIsTypingFilter(false)
            setIsOpen(true)
            setHighlightedIndex(-1)
            const target = e.currentTarget
            requestAnimationFrame(() => {
              try {
                target.select()
              } catch {
                // ignore
              }
            })
          }}
          onClick={() => {
            if (!isOpen) {
              setIsTypingFilter(false)
              setIsOpen(true)
              setHighlightedIndex(-1)
            }
          }}
          onBlur={() => {
            if (!value.trim() && defaultCategory) {
              onChange(defaultCategory)
            }
          }}
          onChange={(e) => {
            onChange(e.target.value)
            setIsTypingFilter(true)
            if (!isOpen) setIsOpen(true)
            setHighlightedIndex(-1)
          }}
          onKeyDown={handleKeyDownInternal}
          onPaste={onPaste}
          className={cn(
            'w-full h-9 pl-2.5 text-xs sm:text-sm text-focus rounded-lg border bg-white focus:outline-none focus:ring-1 transition-all box-border truncate',
            canSaveToList ? 'pr-18' : 'pr-7',
            hasError
              ? 'border-rose-500 bg-rose-50/20 focus:border-rose-600 focus:ring-rose-600'
              : 'border-slate-200/80 hover:border-slate-300 focus:border-focus focus:ring-focus'
          )}
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
          {canSaveToList && (
            <button
              type="button"
              title={`Add "${trimmedValue}" to categories`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                onSaveCategory(trimmedValue)
                onSelect(trimmedValue)
                closeMenu()
              }}
              className="h-6 px-1.5 rounded-md bg-[#960C01] hover:bg-[#800a01] text-white text-[10px] font-bold shadow-2xs flex items-center gap-0.5 transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3 h-3" />
              <span>Add</span>
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle category list"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              if (isOpen) {
                closeMenu()
              } else {
                setIsTypingFilter(false)
                setIsOpen(true)
                setHighlightedIndex(-1)
                internalInputRef.current?.focus({ preventScroll: true })
              }
            }}
            className="h-6 w-6 rounded-md text-slate-400 hover:text-focus hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <ChevronDown
              className={cn(
                'w-3.5 h-3.5 transition-transform duration-150',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        </div>
      </div>

      {isOpen &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              top: `${pos.top}px`,
              left: `${pos.left}px`,
              width: `${pos.width}px`,
              transform: pos.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="fixed bg-white rounded-xl border border-stroke/40 shadow-2xl z-[99999] overflow-hidden py-1 animate-in fade-in-50 duration-150"
          >
            {canSaveToList && (
              <div
                className={cn(
                  'px-3 py-2 text-xs font-semibold text-[#960C01] bg-red-50/60 hover:bg-red-100/80 border-b border-red-100 flex items-center justify-between cursor-pointer transition-colors',
                  highlightedIndex === 0 && 'bg-red-200/80 font-bold'
                )}
                onClick={() => {
                  onSaveCategory(trimmedValue)
                  onSelect(trimmedValue)
                  closeMenu()
                }}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    + Add &ldquo;{trimmedValue}&rdquo;
                  </span>
                </div>
                <span className="text-[10px] bg-[#960C01] text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ml-2 shrink-0">
                  New
                </span>
              </div>
            )}

            <div
              style={{ maxHeight: `${pos.maxHeight}px` }}
              className="overflow-y-auto"
            >
              {filtered.map((cat, idx) => {
                const actualIndex = canSaveToList ? idx + 1 : idx
                const isSelected =
                  trimmedValue.length > 0 &&
                  cat.trim().toLowerCase() === trimmedValue.toLowerCase()
                return (
                  <div
                    key={cat}
                    className={cn(
                      'px-3 py-2 text-xs text-focus flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors gap-2',
                      (highlightedIndex === actualIndex || isSelected) &&
                        'bg-slate-50 font-medium',
                      highlightedIndex === actualIndex && 'bg-slate-100'
                    )}
                    onClick={() => {
                      onSelect(cat)
                      closeMenu()
                    }}
                  >
                    <span className="truncate flex-1">{cat}</span>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#960C01] shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

export const AddTransactionSheetPage: React.FC<AddTransactionSheetPageProps> = ({
  initialType,
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useSession()
  const { activeCompany } = useCompany()
  const isAuditor = user?.role === 'Supervisor'
  const assignedCompany = user?.assignedCompany || 'MCT Kitchen'
  const isCompanyLocked =
    isAuditor || Boolean(activeCompany && activeCompany !== 'All Companies')

  const editItem =
    (location.state as any)?.editSale ||
    (location.state as any)?.editExpense ||
    (location.state as any)?.editTransaction ||
    null

  const isEditMode = Boolean(editItem)

  const transactionType: 'Sales' | 'Expense' = React.useMemo(() => {
    if (initialType) return initialType
    if (editItem?.type) return editItem.type === 'Expense' ? 'Expense' : 'Sales'
    const path = location.pathname.toLowerCase()
    if (path.includes('expense')) return 'Expense'
    return 'Sales'
  }, [initialType, location.pathname, editItem])

  const isSales = transactionType === 'Sales'

  // Dynamic document title
  React.useEffect(() => {
    document.title = isEditMode
      ? `Edit ${transactionType} (Spreadsheet) - MCT Centralized Financial System`
      : `Add ${transactionType} (Spreadsheet) - MCT Centralized Financial System`
  }, [transactionType, isEditMode])

  // Top Batch Setup: Company and Deposit Bank
  const initialCompany = React.useMemo(() => {
    if (isAuditor) return assignedCompany
    if (editItem?.company) return editItem.company
    if (activeCompany && activeCompany !== 'All Companies') return activeCompany
    return 'MCT Kitchen'
  }, [isAuditor, assignedCompany, editItem?.company, activeCompany])

  const [selectedCompany, setSelectedCompany] =
    React.useState<string>(initialCompany)

  React.useEffect(() => {
    if (isAuditor && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    } else if (activeCompany && activeCompany !== 'All Companies') {
      setSelectedCompany(activeCompany)
    }
  }, [isAuditor, user?.assignedCompany, activeCompany])

  // Companies loaded dynamically
  const [dbCompanies, setDbCompanies] = React.useState<string[]>([])
  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((companies: CompanyOption[]) => {
      if (mounted && companies.length > 0) {
        const names = companies.map((c) => c.company_name).filter(Boolean)
        setDbCompanies(names)
        if (!selectedCompany && names.length > 0) {
          if (activeCompany && activeCompany !== 'All Companies') {
            setSelectedCompany(activeCompany)
          } else {
            setSelectedCompany(names[0])
          }
        }
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  // Bank Accounts state for Deposit Bank
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>(() =>
    bankService.getCachedAccounts(initialCompany)
  )
  const [isLoadingBanks, setIsLoadingBanks] = React.useState<boolean>(
    () => bankService.getCachedAccounts(initialCompany).length === 0
  )
  const [selectedBankAccountId, setSelectedBankAccountId] =
    React.useState<string>(() => {
      const cached = bankService.getCachedAccounts(initialCompany)
      return cached.length > 0 ? cached[0].id : ''
    })

  React.useEffect(() => {
    let mounted = true
    const targetComp = isAuditor ? assignedCompany : selectedCompany
    const cached = bankService.getCachedAccounts(targetComp)
    if (cached.length > 0) {
      setBankAccounts(cached)
      setIsLoadingBanks(false)
    } else {
      setIsLoadingBanks(true)
    }

    bankService
      .getAccounts(targetComp)
      .then((accounts) => {
        if (mounted) {
          setBankAccounts(accounts || [])
          setIsLoadingBanks(false)
        }
      })
      .catch(() => {
        if (mounted) {
          setIsLoadingBanks(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [isAuditor, assignedCompany, selectedCompany])

  const availableBankAccounts = React.useMemo(() => {
    const targetComp = isAuditor ? assignedCompany : selectedCompany
    if (!targetComp || targetComp === 'All Companies') return bankAccounts
    const matching = bankAccounts.filter((a) =>
      isCompanyMatch(a.companyName, targetComp)
    )
    if (matching.length > 0) return matching
    const general = bankAccounts.filter(
      (a) =>
        !a.companyName ||
        a.companyName.toLowerCase().includes('general') ||
        a.companyName.toLowerCase().includes('unassigned')
    )
    return general
  }, [bankAccounts, selectedCompany, isAuditor, assignedCompany])

  React.useEffect(() => {
    if (availableBankAccounts.length > 0) {
      const exists = availableBankAccounts.some(
        (a) => a.id === selectedBankAccountId
      )
      if (!exists) {
        setSelectedBankAccountId(availableBankAccounts[0].id)
      }
    } else if (!isLoadingBanks) {
      setSelectedBankAccountId('')
    }
  }, [availableBankAccounts, selectedBankAccountId, isLoadingBanks])

  // Company Particulars List (per company)
  const [savedParticulars, setSavedParticulars] = React.useState<
    CompanyParticular[]
  >([])

  const effectiveParticularsCompany = React.useMemo(() => {
    if (isAuditor) return assignedCompany
    if (selectedCompany && selectedCompany !== 'All Companies') return selectedCompany
    return assignedCompany || user?.assignedCompany || 'MCT Kitchen'
  }, [isAuditor, selectedCompany, assignedCompany, user?.assignedCompany])

  React.useEffect(() => {
    let isMounted = true
    const comp = effectiveParticularsCompany
    if (!comp) return

    const txType = isSales ? 'Sales' : 'Expense'
    particularsService.getParticulars(comp, txType).then((data) => {
      if (isMounted) {
        setSavedParticulars(data)
      }
    })
    return () => {
      isMounted = false
    }
  }, [effectiveParticularsCompany, isSales])

  const handleSaveParticularToList = async (name: string) => {
    const comp = effectiveParticularsCompany
    const trimmed = name.trim()
    if (!comp || !trimmed) return

    const txType = isSales ? 'Sales' : 'Expense'
    const tempId = Date.now()
    const optimistic: CompanyParticular = {
      id: tempId,
      name: trimmed,
      company_name: comp,
      transaction_type: txType,
    }

    setSavedParticulars((prev) => {
      if (prev.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
        return prev
      }
      return [...prev, optimistic].sort((a, b) => a.name.localeCompare(b.name))
    })

    try {
      const created = await particularsService.addParticular(comp, trimmed, txType)
      setSavedParticulars((prev) =>
        prev
          .map((p) => (p.id === tempId ? created : p))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    } catch (err) {
      console.warn('Failed to persist particular:', err)
    }
  }

  const handleDeleteParticularFromList = async (id: number) => {
    const comp = effectiveParticularsCompany
    const txType = isSales ? 'Sales' : 'Expense'
    setSavedParticulars((prev) => prev.filter((p) => p.id !== id))
    await particularsService.deleteParticular(id, comp, txType)
  }

  // Company Custom Payment Methods (per company)
  const [companyCustomPaymentMethods, setCompanyCustomPaymentMethods] =
    React.useState<CompanyPaymentMethod[]>([])
  const [isAddPaymentMethodModalOpen, setIsAddPaymentMethodModalOpen] =
    React.useState(false)
  const [newPaymentMethodName, setNewPaymentMethodName] = React.useState('')
  const [targetRowForNewPaymentMethod, setTargetRowForNewPaymentMethod] =
    React.useState<string | null>(null)
  const [rowValidationErrors, setRowValidationErrors] = React.useState<
    RowValidationError[]
  >([])

  React.useEffect(() => {
    let isMounted = true
    const comp = isAuditor ? assignedCompany : selectedCompany
    if (!comp) return

    paymentMethodService.getPaymentMethods(comp).then((data) => {
      if (isMounted) {
        setCompanyCustomPaymentMethods(data)
      }
    })
    return () => {
      isMounted = false
    }
  }, [isAuditor, assignedCompany, selectedCompany])

  const handleCreateCustomPaymentMethod = async () => {
    const comp = isAuditor ? assignedCompany : selectedCompany
    const trimmed = newPaymentMethodName.trim()
    if (!comp || !trimmed) return

    try {
      const created = await paymentMethodService.addPaymentMethod(comp, trimmed)
      setCompanyCustomPaymentMethods((prev) => {
        if (
          prev.some(
            (m) => m.name.toLowerCase() === created.name.toLowerCase()
          )
        ) {
          return prev
        }
        return [...prev, created].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      })
      if (targetRowForNewPaymentMethod) {
        handleRowChange(
          targetRowForNewPaymentMethod,
          'paymentMethod',
          created.name
        )
        handleRowChange(targetRowForNewPaymentMethod, 'serviceFee', 0)
      }
    } catch (err) {
      console.warn('Failed to add custom payment method:', err)
    } finally {
      setIsAddPaymentMethodModalOpen(false)
      setNewPaymentMethodName('')
      setTargetRowForNewPaymentMethod(null)
    }
  }

  // Categories list (initialized immediately with defaults, then merged with custom DB categories)
  const [categories, setCategories] = React.useState<string[]>(() =>
    isSales ? [...SALES_CATEGORY_LIST] : [...DEFAULT_EXPENSE_CATEGORIES]
  )

  React.useEffect(() => {
    const baseCategories = isSales
      ? [...SALES_CATEGORY_LIST]
      : [...DEFAULT_EXPENSE_CATEGORIES]
    setCategories(baseCategories)

    let mounted = true
    expenseService
      .getCategories()
      .then((cats) => {
        if (!mounted) return
        const fetchedNames = (cats || [])
          .map((c) => c.name?.trim())
          .filter(Boolean)
          .filter((name) => !DEPRECATED_OLD_CATEGORIES.has(name.toLowerCase()))

        const combined = Array.from(new Set([...baseCategories, ...fetchedNames]))
        setCategories(combined)
      })
      .catch(() => {
        // Keep base categories on fetch error
      })
    return () => {
      mounted = false
    }
  }, [isSales])

  const handleSaveCategory = async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return

    setCategories((prev) => {
      if (prev.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
        return prev
      }
      return [...prev, trimmed]
    })

    if (!isSales) {
      try {
        await expenseService.createCategory(trimmed)
      } catch (err) {
        console.warn('Failed to save category to backend:', err)
      }
    }
  }

  const todayIso = formatToYYYYMMDD(new Date())
  const defaultCategory = isSales
    ? SALES_CATEGORY_LIST[0]
    : DEFAULT_EXPENSE_CATEGORIES[0]

  const [rows, setRows] = React.useState<SpreadsheetRow[]>([
    {
      id: 'row-1',
      date: todayIso,
      particulars: '',
      category: defaultCategory,
      paymentMethod: 'Cash',
      serviceFee: 0,
      chequeNo: '',
      unitPrice: '',
      quantity: 1,
      status: 'Paid',
      depositStatus: 'Deposited',
    },
  ])

  const paymentOptions = React.useMemo(() => {
    const base = isSales
      ? ['Cash', 'Cheque', 'GCash']
      : ['Cash', 'Cheque', 'GCash', 'Petty Cash']
    const customNames = companyCustomPaymentMethods
      .map((m) => m.name)
      .filter((name) => !base.includes(name))
    return [...base, ...customNames]
  }, [isSales, companyCustomPaymentMethods])

  // Build per-row particular suggestions without echoing the current row's live typing
  const getRowParticularSuggestions = React.useCallback(
    (currentRowIdx: number, currentRow: SpreadsheetRow): CompanyParticular[] => {
      const compName = isAuditor ? assignedCompany : selectedCompany
      const list: CompanyParticular[] = [...savedParticulars]
      const seen = new Set(
        savedParticulars.map((p) => p.name.trim().toLowerCase())
      )

      // Include Petty Cash preset particulars when Expense uses Petty Cash
      if (
        !isSales &&
        (currentRow.category === 'Petty Cash' ||
          currentRow.paymentMethod === 'Petty Cash')
      ) {
        PREDEFINED_PETTY_CASH_PARTICULARS.forEach((preset, pIdx) => {
          const lower = preset.toLowerCase()
          if (!seen.has(lower)) {
            seen.add(lower)
            list.push({
              id: -1000 - pIdx,
              name: preset,
              company_name: compName,
            })
          }
        })
      }

      // Include particulars already entered in OTHER rows as quick suggestions
      rows.forEach((r, idx) => {
        if (idx === currentRowIdx) return
        const trimmed = r.particulars.trim()
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          seen.add(trimmed.toLowerCase())
          list.push({
            id: -1 * (idx + 1),
            name: trimmed,
            company_name: compName,
          })
        }
      })

      return list
    },
    [savedParticulars, isSales, rows, isAuditor, assignedCompany, selectedCompany]
  )

  // Build per-row categories without echoing the current row's live typing
  const getRowCategories = React.useCallback(
    (currentRowIdx: number): string[] => {
      const list = [...categories]
      const seen = new Set(categories.map((c) => c.trim().toLowerCase()))

      rows.forEach((r, idx) => {
        if (idx === currentRowIdx) return
        const trimmed = r.category?.trim()
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          seen.add(trimmed.toLowerCase())
          list.push(trimmed)
        }
      })

      return list
    },
    [categories, rows]
  )

  // Pre-fill when editing
  React.useEffect(() => {
    if (!editItem) return

    const itemDate = editItem.rawDate
      ? editItem.rawDate
      : editItem.date
        ? normalizeDateToYYYYMMDD(editItem.date)
        : todayIso

    if (editItem.company) {
      setSelectedCompany(editItem.company)
    }

    const fallbackTotal =
      editItem.amount ||
      editItem.deposit ||
      editItem.withdrawal ||
      editItem.netAmount ||
      0

    if (
      editItem.items &&
      Array.isArray(editItem.items) &&
      editItem.items.length > 0
    ) {
      setRows(
        editItem.items.map((it: any, idx: number) => ({
          id: it.id || `row-${idx + 1}`,
          date: itemDate,
          particulars: it.particulars || '',
          category: editItem.category || defaultCategory,
          paymentMethod: editItem.paymentMethod || 'Cash',
          chequeNo: editItem.chequeNo || '',
          unitPrice:
            typeof it.unitPrice === 'number' && it.unitPrice > 0
              ? it.unitPrice
              : it.total || fallbackTotal || '',
          quantity:
            typeof it.quantity === 'number' && it.quantity > 0
              ? it.quantity
              : 1,
          status: normalizeParticularStatus(
            it.status || editItem.status,
            'Paid'
          ) as 'Paid' | 'Unpaid' | 'Pending',
          depositStatus: (editItem.depositStatus || editItem.deposit_status || ((it.status || editItem.status) === 'Paid' ? 'Deposited' : 'Not Deposited')) as 'Deposited' | 'Not Deposited',
        }))
      )
    } else if (editItem.particulars) {
      const parsed = parseParticulars(
        editItem.particulars,
        null,
        fallbackTotal
      )
      if (parsed.length > 0) {
        setRows(
          parsed.map((p, idx) => ({
            id: p.id || `row-${idx + 1}`,
            date: itemDate,
            particulars: p.particulars,
            category: editItem.category || defaultCategory,
            paymentMethod: editItem.paymentMethod || 'Cash',
            chequeNo: editItem.chequeNo || '',
            unitPrice:
              typeof p.unitPrice === 'number' && p.unitPrice > 0
                ? p.unitPrice
                : p.total || fallbackTotal || '',
            quantity:
              typeof p.quantity === 'number' && p.quantity > 0
                ? p.quantity
                : 1,
            status: normalizeParticularStatus(
              p.status || editItem.status,
              'Paid'
            ) as 'Paid' | 'Unpaid' | 'Pending',
            depositStatus: (editItem.depositStatus || editItem.deposit_status || ((p.status || editItem.status) === 'Paid' ? 'Deposited' : 'Not Deposited')) as 'Deposited' | 'Not Deposited',
          }))
        )
      } else {
        setRows([
          {
            id: 'row-1',
            date: itemDate,
            particulars: editItem.particulars,
            category: editItem.category || defaultCategory,
            paymentMethod: editItem.paymentMethod || 'Cash',
            chequeNo: editItem.chequeNo || '',
            unitPrice: fallbackTotal || '',
            quantity: 1,
            status: normalizeParticularStatus(
              editItem.status,
              'Paid'
            ) as 'Paid' | 'Unpaid' | 'Pending',
            depositStatus: (editItem.depositStatus || editItem.deposit_status || (editItem.status === 'Paid' ? 'Deposited' : 'Not Deposited')) as 'Deposited' | 'Not Deposited',
          },
        ])
      }
    }

    // Pre-fill debtor name and customer type if editing an unpaid sale
    const saleIdNum = Number(editItem.id)
    const recIdFromUtang =
      typeof editItem.id === 'string' && editItem.id.startsWith('utang-')
        ? Number(editItem.id.replace('utang-', ''))
        : !Number.isNaN(saleIdNum)
          ? saleIdNum
          : undefined

    const linkedRec = !Number.isNaN(saleIdNum)
      ? receivablesStore.getSales().find((u) => Number(u.sale_id) === saleIdNum)
      : recIdFromUtang
        ? receivablesStore.getSales().find((u) => Number(u.id) === recIdFromUtang)
        : undefined

    const debtorName =
      editItem.customer_name ||
      linkedRec?.customer_name ||
      ''
    const rawType = editItem.customer_type || linkedRec?.customer_type
    const debtorType: CustomerType =
      rawType === 'Staff' || rawType === 'Internal' ? 'Staff' : 'External'

    if (debtorName) {
      const initialRowId =
        editItem.items && editItem.items.length > 0 && editItem.items[0].id
          ? editItem.items[0].id
          : 'row-1'
      setUnpaidAssignments([
        {
          rowId: initialRowId,
          saleLineIndex: 0,
          particulars: editItem.particulars || '',
          quantity: 1,
          unitPrice: fallbackTotal,
          total: fallbackTotal,
          customerType: debtorType,
          customerName: debtorName,
        },
      ])
    }
  }, [editItem])

  // Multi-step workflow state for Unpaid items in Sales
  const [currentStep, setCurrentStep] = React.useState<
    'encode' | 'assign_unpaid'
  >('encode')
  const [unpaidAssignments, setUnpaidAssignments] = React.useState<
    UnpaidAssignmentRow[]
  >([])
  const [knownDebtors, setKnownDebtors] = React.useState(() =>
    receivablesStore.getPeopleSummaries()
  )

  React.useEffect(() => {
    setKnownDebtors(receivablesStore.getPeopleSummaries())
  }, [])

  // Cell elements ref map for spreadsheet keyboard navigation: key is `${rowIdx}-${colIdx}`
  // 0: Date, 1: Particulars, 2: Category, 3: Payment, 4: Cheque, 5: Price, 6: Qty, 7: Status
  const cellRefs = React.useRef<{
    [key: string]: HTMLInputElement | HTMLSelectElement | null
  }>({})

  const sheetTableContainerRef = React.useRef<HTMLDivElement | null>(null)

  const focusCell = (rowIdx: number, colIdx: number) => {
    const el = cellRefs.current[`${rowIdx}-${colIdx}`]
    if (el) {
      el.focus({ preventScroll: true })
      const container = sheetTableContainerRef.current
      if (container) {
        const elRect = el.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        if (elRect.bottom > containerRect.bottom - 8) {
          container.scrollTop += elRect.bottom - containerRect.bottom + 12
        } else if (elRect.top < containerRect.top + 48) {
          container.scrollTop -= containerRect.top + 48 - elRect.top
        }
      }
      if (el instanceof HTMLInputElement && el.type !== 'date') {
        try {
          el.select()
        } catch {
          // ignore
        }
      }
    }
  }

  // 3-dots Row Action Menu state
  const [openActionRowId, setOpenActionRowId] = React.useState<string | null>(
    null
  )
  const [actionMenuPos, setActionMenuPos] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)

  const closeActionMenu = React.useCallback(() => {
    setOpenActionRowId(null)
    setActionMenuPos(null)
  }, [])

  React.useEffect(() => {
    if (!openActionRowId) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeActionMenu()
    }
    window.addEventListener('click', closeActionMenu)
    window.addEventListener('scroll', closeActionMenu, true)
    window.addEventListener('resize', closeActionMenu)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', closeActionMenu)
      window.removeEventListener('scroll', closeActionMenu, true)
      window.removeEventListener('resize', closeActionMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openActionRowId, closeActionMenu])

  // Row operations
  const handleAddRow = () => {
    const prevRow = rows[rows.length - 1]
    const nextIdx = rows.length
    const newId = `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    setRows((prev) => [
      ...prev,
      {
        id: newId,
        date: prevRow?.date || todayIso,
        particulars: '',
        category: prevRow?.category || defaultCategory,
        paymentMethod: prevRow?.paymentMethod || 'Cash',
        serviceFee: 0,
        chequeNo: '',
        unitPrice: '',
        quantity: 1,
        status: 'Paid',
        depositStatus: 'Deposited',
      },
    ])
    setTimeout(() => {
      focusCell(nextIdx, 1)
    }, 40)
  }

  const handleInsertRowBelow = (index: number) => {
    const baseRow = rows[index]
    const newId = `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    const inserted: SpreadsheetRow = {
      id: newId,
      date: baseRow?.date || todayIso,
      particulars: '',
      category: baseRow?.category || defaultCategory,
      paymentMethod: baseRow?.paymentMethod || 'Cash',
      serviceFee: 0,
      chequeNo: '',
      unitPrice: '',
      quantity: 1,
      status: 'Paid',
      depositStatus: 'Deposited',
    }
    setRows((prev) => {
      const copy = [...prev]
      copy.splice(index + 1, 0, inserted)
      return copy
    })
    setTimeout(() => {
      focusCell(index + 1, 1)
    }, 40)
  }

  const handleDuplicateRow = (index: number) => {
    const target = rows[index]
    const newId = `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    const duplicated: SpreadsheetRow = {
      ...target,
      id: newId,
      serviceFee: target.serviceFee !== undefined ? target.serviceFee : 0,
    }
    setRows((prev) => {
      const copy = [...prev]
      copy.splice(index + 1, 0, duplicated)
      return copy
    })
    setTimeout(() => {
      focusCell(index + 1, 1)
    }, 40)
  }

  const handleRemoveRow = (id: string) => {
    if (rows.length <= 1) {
      setRows([
        {
          id: 'row-1',
          date: todayIso,
          particulars: '',
          category: defaultCategory,
          paymentMethod: 'Cash',
          serviceFee: 0,
          chequeNo: '',
          unitPrice: '',
          quantity: 1,
          status: 'Paid',
          depositStatus: 'Deposited',
        },
      ])
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== id))
    setRowValidationErrors((prev) => prev.filter((err) => err.rowId !== id))
  }

  const handleReset = () => {
    setRows([
      {
        id: 'row-1',
        date: todayIso,
        particulars: '',
        category: defaultCategory,
        paymentMethod: 'Cash',
        serviceFee: 0,
        chequeNo: '',
        unitPrice: '',
        quantity: 1,
        status: 'Paid',
        depositStatus: 'Deposited',
      },
    ])
    setErrorMessage(null)
    setRowValidationErrors([])
  }

  const handleRowChange = (
    id: string,
    field: keyof Omit<SpreadsheetRow, 'id'>,
    value: any
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r

        let nextDepositStatus = r.depositStatus || 'Deposited'

        if (field === 'status') {
          if (value === 'Unpaid') {
            nextDepositStatus = 'Not Deposited'
          } else if (value === 'Pending') {
            const pm = (r.paymentMethod || '').trim().toLowerCase()
            const hasChq = Boolean(r.chequeNo && r.chequeNo.trim())
            if (pm !== 'cheque' || !hasChq) {
              nextDepositStatus = 'Not Deposited'
            }
          } else if (value === 'Paid') {
            const pm = (r.paymentMethod || '').trim().toLowerCase()
            nextDepositStatus = pm === 'cash' ? 'Deposited' : (pm === 'gcash' ? 'Not Deposited' : 'Deposited')
          }
        } else if (field === 'paymentMethod' || field === 'chequeNo') {
          const pm = (field === 'paymentMethod' ? value : r.paymentMethod || '').trim().toLowerCase()
          const chq = (field === 'chequeNo' ? value : r.chequeNo || '').trim()
          if (r.status === 'Pending' && (pm !== 'cheque' || !chq)) {
            nextDepositStatus = 'Not Deposited'
          } else if (field === 'paymentMethod' && pm === 'cash') {
            nextDepositStatus = 'Deposited'
          } else if (field === 'paymentMethod' && pm === 'gcash') {
            nextDepositStatus = 'Not Deposited'
          }
        }

        return {
          ...r,
          [field]: value,
          depositStatus: field === 'depositStatus' ? value : nextDepositStatus,
        }
      })
    )

    if (rowValidationErrors.length > 0) {
      setRowValidationErrors((prev) =>
        prev
          .map((err) => {
            if (err.rowId !== id) return err
            return {
              ...err,
              missingParticulars:
                field === 'particulars'
                  ? !String(value).trim()
                  : err.missingParticulars,
              missingCategory:
                field === 'category'
                  ? !String(value).trim()
                  : err.missingCategory,
              missingPrice:
                field === 'unitPrice'
                  ? value === '' ||
                    Number(value) <= 0 ||
                    isNaN(Number(value))
                  : err.missingPrice,
            }
          })
          .filter(
            (err) =>
              err.missingParticulars ||
              err.missingCategory ||
              err.missingPrice
          )
      )
    }
  }

  // Keyboard navigation across the spreadsheet grid
  const handleCellKeyDown = (
    e: React.KeyboardEvent,
    rowIdx: number,
    colIdx: number
  ) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      if (rowIdx > 0) {
        const prev = rows[rowIdx - 1]
        setRows((prevRows) =>
          prevRows.map((r, i) => {
            if (i !== rowIdx) return r
            switch (colIdx) {
              case 0:
                return { ...r, date: prev.date }
              case 1:
                return { ...r, particulars: prev.particulars }
              case 2:
                return { ...r, category: prev.category }
              case 3:
                return { ...r, paymentMethod: prev.paymentMethod }
              case 4:
                return { ...r, chequeNo: prev.chequeNo }
              case 5:
                return { ...r, unitPrice: prev.unitPrice }
              case 6:
                return { ...r, quantity: prev.quantity }
              case 7:
                return { ...r, status: prev.status }
              default:
                return r
            }
          })
        )
      }
      return
    }

    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (colIdx === 0 && rowIdx > 0) {
          e.preventDefault()
          focusCell(rowIdx - 1, 7)
        } else if (colIdx > 0) {
          e.preventDefault()
          focusCell(rowIdx, colIdx - 1)
        }
      } else {
        if (colIdx === 7) {
          e.preventDefault()
          if (rowIdx === rows.length - 1) {
            handleAddRow()
          } else {
            focusCell(rowIdx + 1, 0)
          }
        } else {
          e.preventDefault()
          focusCell(rowIdx, colIdx + 1)
        }
      }
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (colIdx === 1) {
        focusCell(rowIdx, 2)
        return
      }
      handleAddRow()
      return
    }

    if (e.key === 'ArrowUp') {
      if (rowIdx > 0) {
        e.preventDefault()
        focusCell(rowIdx - 1, colIdx)
      }
    } else if (e.key === 'ArrowDown') {
      if (rowIdx < rows.length - 1) {
        e.preventDefault()
        focusCell(rowIdx + 1, colIdx)
      }
    }
  }

  // Paste handler for tab-separated data from Excel or Google Sheets
  const handlePaste = (
    e: React.ClipboardEvent,
    startRowIdx: number,
    startColIdx: number
  ) => {
    const text = e.clipboardData.getData('text')
    if (!text) return

    const hasTabs = text.includes('\t')
    const hasNewlines = text.includes('\n') || text.includes('\r')

    if (!hasTabs && !hasNewlines) {
      return
    }

    e.preventDefault()

    const rawLines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0)
    const grid = rawLines.map((line) => line.split('\t'))

    setRows((prevRows) => {
      const newRows = [...prevRows]

      grid.forEach((rowValues, rOffset) => {
        const targetRowIdx = startRowIdx + rOffset

        while (newRows.length <= targetRowIdx) {
          const lastRow = newRows[newRows.length - 1]
          newRows.push({
            id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            date: lastRow?.date || todayIso,
            particulars: '',
            category: lastRow?.category || defaultCategory,
            paymentMethod: lastRow?.paymentMethod || 'Cash',
            chequeNo: '',
            unitPrice: '',
            quantity: 1,
            status: 'Paid',
          })
        }

        const currentRow = { ...newRows[targetRowIdx] }

        rowValues.forEach((cellVal, cOffset) => {
          const targetColIdx = startColIdx + cOffset
          const val = cellVal.trim()

          switch (targetColIdx) {
            case 0: {
              const normalized = normalizeDateToYYYYMMDD(val)
              if (normalized) currentRow.date = normalized
              break
            }
            case 1: {
              currentRow.particulars = val
              break
            }
            case 2: {
              if (val) currentRow.category = val
              break
            }
            case 3: {
              if (val) currentRow.paymentMethod = val
              break
            }
            case 4: {
              currentRow.chequeNo = val
              break
            }
            case 5: {
              const num = parseFloat(val.replace(/[^0-9.-]+/g, ''))
              if (!isNaN(num)) currentRow.unitPrice = num
              break
            }
            case 6: {
              const qty = parseInt(val.replace(/[^0-9]+/g, ''), 10)
              if (!isNaN(qty) && qty > 0) currentRow.quantity = qty
              break
            }
            case 7: {
              const lower = val.toLowerCase()
              if (lower.includes('unpaid')) currentRow.status = 'Unpaid'
              else if (lower.includes('pend')) currentRow.status = 'Pending'
              else currentRow.status = 'Paid'
              break
            }
          }
        })

        newRows[targetRowIdx] = currentRow
      })

      return newRows
    })
  }

  // Calculations & Validation
  const calculatedRows = React.useMemo(() => {
    return rows.map((r) => {
      const price = typeof r.unitPrice === 'number' ? r.unitPrice : parseFloat(String(r.unitPrice || '')) || 0
      const qty = typeof r.quantity === 'number' ? r.quantity : parseInt(String(r.quantity || '1'), 10) || 1
      const pmLower = (r.paymentMethod || '').trim().toLowerCase()
      const isFeeApplicable = isSales
        ? pmLower !== 'gcash' && !['cash', 'cheque'].includes(pmLower)
        : !['cash', 'cheque', 'petty cash'].includes(pmLower)
      const serviceFee = isFeeApplicable
        ? typeof r.serviceFee === 'number'
          ? r.serviceFee
          : parseFloat(String(r.serviceFee || '0')) || 0
        : 0
      const total = Math.round((price * qty + serviceFee) * 100) / 100
      const hasParticulars = r.particulars.trim().length > 0
      const hasCategory = (r.category || '').trim().length > 0
      const isEmpty =
        !hasParticulars && (!r.unitPrice || r.unitPrice === 0) && !r.chequeNo.trim()
      const isValid = hasParticulars && hasCategory && price > 0 && qty > 0 && total >= 1
      const isPartial = !isEmpty && !isValid

      return {
        ...r,
        numericPrice: price,
        numericQty: qty,
        serviceFee: isFeeApplicable ? serviceFee : 0,
        rowTotal: total,
        isEmpty,
        isValid,
        isPartial,
      }
    })
  }, [rows])

  const validRows = React.useMemo(
    () => calculatedRows.filter((r) => r.isValid),
    [calculatedRows]
  )
  const validRowsCount = validRows.length

  const totalQuantity = React.useMemo(() => {
    return validRows.reduce((sum, r) => sum + r.numericQty, 0)
  }, [validRows])

  const grandTotal = React.useMemo(() => {
    return validRows.reduce((sum, r) => sum + r.rowTotal, 0)
  }, [validRows])

  const paymentBreakdown = React.useMemo(() => {
    const map: Record<string, number> = {}
    validRows.forEach((r) => {
      const pm = r.paymentMethod || 'Cash'
      map[pm] = (map[pm] || 0) + r.rowTotal
    })
    return Object.entries(map).filter(([, amt]) => amt > 0)
  }, [validRows])

  const unpaidTotal = React.useMemo(() => {
    return validRows
      .filter((r) => r.status === 'Unpaid')
      .reduce((sum, r) => sum + r.rowTotal, 0)
  }, [validRows])

  const pendingTotal = React.useMemo(() => {
    return validRows
      .filter((r) => r.status === 'Pending')
      .reduce((sum, r) => sum + r.rowTotal, 0)
  }, [validRows])

  // Petty cash balance checking
  const pettyCashCompany = isAuditor ? assignedCompany : selectedCompany
  const [pettyBalance, setPettyBalance] = React.useState<number | null>(null)
  const hasPettyCashRow = React.useMemo(
    () =>
      transactionType === 'Expense' &&
      rows.some((r) => (r.paymentMethod || '').toLowerCase() === 'petty cash'),
    [transactionType, rows]
  )

  React.useEffect(() => {
    if (!hasPettyCashRow) return
    let isMounted = true
    pettyCashService
      .getSummary(pettyCashCompany)
      .then((s) => isMounted && setPettyBalance(s.balance))
      .catch(() => isMounted && setPettyBalance(null))
    return () => {
      isMounted = false
    }
  }, [hasPettyCashRow, pettyCashCompany])

  const pettyCashTotal = React.useMemo(() => {
    if (transactionType !== 'Expense') return 0
    return validRows
      .filter((r) => (r.paymentMethod || '').toLowerCase() === 'petty cash')
      .reduce((sum, r) => sum + r.rowTotal, 0)
  }, [transactionType, validRows])

  const exceedsPettyCash =
    hasPettyCashRow &&
    pettyBalance !== null &&
    pettyCashTotal > pettyBalance

  // Submission state
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successBanner, setSuccessBanner] = React.useState<{
    count: number
    total: number
    type: string
  } | null>(null)

  // Save handler
  const handleSave = async () => {
    setErrorMessage(null)
    setRowValidationErrors([])

    // Validate rows for missing particulars, missing category, or non-positive price
    const nonBlankRows = rows.filter(
      (r) =>
        r.particulars.trim().length > 0 ||
        (r.category || '').trim().length > 0 ||
        (r.unitPrice !== '' && Number(r.unitPrice) > 0) ||
        r.chequeNo.trim().length > 0
    )

    const rowsToValidate = nonBlankRows.length > 0 ? nonBlankRows : [rows[0]]

    const errors: RowValidationError[] = []
    rowsToValidate.forEach((r) => {
      const rowIndex = rows.findIndex((item) => item.id === r.id) + 1
      const missingParticulars = !r.particulars || !r.particulars.trim()
      const missingCategory = !r.category || !r.category.trim()
      const missingPrice =
        r.unitPrice === '' ||
        Number(r.unitPrice) <= 0 ||
        isNaN(Number(r.unitPrice))

      if (missingParticulars || missingCategory || missingPrice) {
        errors.push({
          rowIndex,
          rowId: r.id,
          missingParticulars,
          missingCategory,
          missingPrice,
        })
      }
    })

    if (errors.length > 0) {
      setRowValidationErrors(errors)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    if (validRowsCount === 0) {
      setErrorMessage(
        'Please enter at least one valid row with Particulars, Price/Amount (> 0), and Quantity (> 0).'
      )
      return
    }

    const companyToUse = isAuditor ? assignedCompany : selectedCompany
    if (!companyToUse) {
      setErrorMessage('Please select a company.')
      return
    }

    if (exceedsPettyCash) {
      setErrorMessage(
        `Insufficient petty cash (${formatPHP(pettyBalance ?? 0)} available, requested ${formatPHP(pettyCashTotal)}). Top up petty cash first.`
      )
      return
    }

    // Step 1: Check if there are unpaid items in Sales
    const unpaidRows = validRows.filter((r) => r.status === 'Unpaid')
    if (
      isSales &&
      unpaidRows.length > 0 &&
      currentStep === 'encode'
    ) {
      const saleIdNum = editItem ? Number(editItem.id) : NaN
      const recIdFromUtang =
        editItem && typeof editItem.id === 'string' && editItem.id.startsWith('utang-')
          ? Number(editItem.id.replace('utang-', ''))
          : !Number.isNaN(saleIdNum)
            ? saleIdNum
            : undefined

      const linkedRec = !Number.isNaN(saleIdNum)
        ? receivablesStore.getSales().find((u) => Number(u.sale_id) === saleIdNum)
        : recIdFromUtang
          ? receivablesStore.getSales().find((u) => Number(u.id) === recIdFromUtang)
          : undefined

      const defaultDebtorName =
        editItem?.customer_name || linkedRec?.customer_name || ''
      const rawType = editItem?.customer_type || linkedRec?.customer_type
      const defaultDebtorType: CustomerType =
        rawType === 'Staff' || rawType === 'Internal' ? 'Staff' : 'External'

      const mappedAssignments: UnpaidAssignmentRow[] = unpaidRows.map((it, lineIdx) => {
        const existing = unpaidAssignments.find(
          (u) => u.rowId === it.id || (lineIdx === 0 && u.customerName)
        )
        return {
          rowId: it.id,
          saleLineIndex: lineIdx,
          particulars: it.particulars.trim(),
          quantity: it.numericQty,
          unitPrice: it.numericPrice,
          total: it.rowTotal,
          customerType: existing?.customerType || defaultDebtorType,
          customerName: existing?.customerName || (lineIdx === 0 ? defaultDebtorName : ''),
        }
      })

      setUnpaidAssignments(mappedAssignments)
      setCurrentStep('assign_unpaid')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // Step 2 validation for assign_unpaid
    if (currentStep === 'assign_unpaid') {
      const missingIdx = unpaidAssignments.findIndex(
        (u) => !u.customerName.trim()
      )
      if (missingIdx !== -1) {
        setErrorMessage(
          `Please provide a Customer or Staff Name for unpaid item #${missingIdx + 1}: "${unpaidAssignments[missingIdx].particulars}".`
        )
        return
      }
    }

    setIsSubmitting(true)
    const effectiveBankId = selectedBankAccountId || undefined
    const authorName = formatRealName(user?.fullName || user?.name || user?.email || 'Staff', user?.role || 'Staff')
    const nowIso = new Date().toISOString()

    try {
      if (isEditMode) {
        const first = validRows[0]
        const firstDate = normalizeDateToYYYYMMDD(first.date) || todayIso
        const firstAmount = Math.round(first.rowTotal * 100) / 100
        const itemized: ParticularItem[] = [
          {
            id: `item-1`,
            particulars: first.particulars.trim(),
            quantity: first.numericQty,
            unitPrice: first.numericPrice,
            serviceFee: first.serviceFee ? Number(first.serviceFee) : 0,
            total: firstAmount,
            status: first.status,
          },
        ]
        const formatted = formatParticularsString(itemized)

        if (isSales) {
          await salesService.updateSale(editItem.id, {
            company: companyToUse,
            date: firstDate,
            particulars: formatted,
            amount: firstAmount,
            paymentMethod: first.paymentMethod,
            chequeNo: first.chequeNo.trim() || undefined,
            category: first.category || SALES_CATEGORY_LIST[0],
            status: first.status,
            depositStatus: first.depositStatus || (first.status === 'Paid' ? 'Deposited' : 'Not Deposited'),
            deposit_status: first.depositStatus || (first.status === 'Paid' ? 'Deposited' : 'Not Deposited'),
            items: itemized,
            bankAccountId: effectiveBankId,
            updatedBy: authorName,
            updatedAt: nowIso,
          })

          // Synchronize receivables for unpaid / paid edit
          const saleIdNum = Number(editItem.id)
          const recIdFromUtang =
            typeof editItem.id === 'string' && editItem.id.startsWith('utang-')
              ? Number(editItem.id.replace('utang-', ''))
              : !Number.isNaN(saleIdNum)
                ? saleIdNum
                : undefined

          const existingRec = !Number.isNaN(saleIdNum)
            ? receivablesStore.getSales().find((u) => Number(u.sale_id) === saleIdNum)
            : recIdFromUtang
              ? receivablesStore.getSales().find((u) => Number(u.id) === recIdFromUtang)
              : undefined

          const targetRecId = existingRec ? Number(existingRec.id) : recIdFromUtang

          const firstAssignment =
            unpaidAssignments.find((u) => u.rowId === first.id) ||
            unpaidAssignments[0]

          if (first.status === 'Unpaid' && firstAssignment && firstAssignment.customerName.trim()) {
            const resolvedType: CustomerType =
              firstAssignment.customerType === 'Staff' ? 'Staff' : 'External'
            const apiCustomerType = resolvedType === 'Staff' ? 'Internal' : 'External'

            if (targetRecId) {
              await receivablesService.updateReceivable(targetRecId, {
                customer_name: firstAssignment.customerName.trim(),
                customer_type: apiCustomerType,
                items_summary: first.particulars.trim(),
                total_amount: firstAmount,
                transaction_date: firstDate,
                payment_status: 'Unpaid',
              })
            } else {
              await receivablesService.createReceivable({
                customer_name: firstAssignment.customerName.trim(),
                customer_type: apiCustomerType,
                items_summary: first.particulars.trim(),
                total_amount: firstAmount,
                amount_paid: 0,
                payment_option: 'Pay Later',
                payment_method:
                  first.paymentMethod === 'GCash'
                    ? 'GCash'
                    : first.paymentMethod === 'Bank Transfer'
                      ? 'Bank Transfer'
                      : 'Cash',
                notes: first.chequeNo.trim()
                  ? `Ref: ${first.chequeNo.trim()}`
                  : undefined,
                company_name: companyToUse,
                sale_id: !Number.isNaN(saleIdNum) ? saleIdNum : undefined,
                date: firstDate,
              })
            }
          } else if (first.status === 'Paid' && targetRecId) {
            await receivablesService.updateReceivable(targetRecId, {
              payment_status: 'Paid',
            })
          }
        } else {
          await expenseService.updateExpense(editItem.id, {
            company: companyToUse,
            date: firstDate,
            particulars: formatted,
            withdrawal: firstAmount,
            netAmount: firstAmount,
            category: first.category || 'Rendered Fee',
            paymentMethod: first.paymentMethod,
            chequeNo: first.chequeNo.trim() || undefined,
            status: first.status,
            items: itemized,
            bankAccountId: effectiveBankId,
            updatedBy: authorName,
            updatedAt: nowIso,
          })
        }

        for (let i = 1; i < validRows.length; i++) {
          const row = validRows[i]
          const rowDate = normalizeDateToYYYYMMDD(row.date) || todayIso
          const rowAmount = Math.round(row.rowTotal * 100) / 100
          const extraItemized: ParticularItem[] = [
            {
              id: `item-${i + 1}`,
              particulars: row.particulars.trim(),
              quantity: row.numericQty,
              unitPrice: row.numericPrice,
              serviceFee: row.serviceFee ? Number(row.serviceFee) : 0,
              total: rowAmount,
              status: row.status,
            },
          ]
          const extraFormatted = formatParticularsString(extraItemized)

          if (isSales) {
            await salesService.addSale({
              company: companyToUse,
              date: rowDate,
              particulars: extraFormatted,
              amount: rowAmount,
              category: row.category,
              paymentMethod: row.paymentMethod,
              chequeNo: row.chequeNo.trim() || undefined,
              status: row.status,
              depositStatus: row.depositStatus || (row.status === 'Paid' ? 'Deposited' : 'Not Deposited'),
              deposit_status: row.depositStatus || (row.status === 'Paid' ? 'Deposited' : 'Not Deposited'),
              items: extraItemized,
              bankAccountId: effectiveBankId,
              createdBy: authorName,
            })
          } else {
            await expenseService.addExpense({
              company: companyToUse,
              date: rowDate,
              particulars: extraFormatted,
              amount: rowAmount,
              category: row.category,
              paymentMethod: row.paymentMethod,
              chequeNo: row.chequeNo.trim() || undefined,
              status: row.status,
              items: extraItemized,
              bankAccountId: effectiveBankId,
              createdBy: authorName,
            })
          }
        }
      } else {
        for (const row of validRows) {
          const rowDate = normalizeDateToYYYYMMDD(row.date) || todayIso
          const rowAmount = Math.round(row.rowTotal * 100) / 100
          const itemized: ParticularItem[] = [
            {
              id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              particulars: row.particulars.trim(),
              quantity: row.numericQty,
              unitPrice: row.numericPrice,
              serviceFee: row.serviceFee ? Number(row.serviceFee) : 0,
              total: rowAmount,
              status: row.status,
            },
          ]
          const formatted = formatParticularsString(itemized)

          if (isSales) {
            const createdSale = await salesService.addSale({
              company: companyToUse,
              date: rowDate,
              particulars: formatted,
              amount: rowAmount,
              category: row.category || SALES_CATEGORY_LIST[0],
              paymentMethod: row.paymentMethod,
              chequeNo: row.chequeNo.trim() || undefined,
              status: row.status,
              depositStatus: row.depositStatus || (row.status === 'Paid' ? 'Deposited' : 'Not Deposited'),
              deposit_status: row.depositStatus || (row.status === 'Paid' ? 'Deposited' : 'Not Deposited'),
              items: itemized,
              bankAccountId: effectiveBankId,
              createdBy: authorName,
            })

            if (row.status === 'Unpaid' && unpaidAssignments.length > 0) {
              const assignment = unpaidAssignments.find(
                (u) => u.rowId === row.id
              )
              if (assignment && assignment.customerName.trim()) {
                const parsedSaleId = createdSale?.id
                  ? Number(createdSale.id)
                  : NaN
                const resolvedType: CustomerType =
                  assignment.customerType === 'Staff' ? 'Staff' : 'External'
                const apiCustomerType =
                  resolvedType === 'Staff' ? 'Internal' : 'External'

                await receivablesService.createReceivable({
                  customer_name: assignment.customerName.trim(),
                  customer_type: apiCustomerType,
                  items_summary: row.particulars.trim(),
                  total_amount: rowAmount,
                  amount_paid: 0,
                  payment_option: 'Pay Later',
                  payment_method:
                    row.paymentMethod === 'GCash'
                      ? 'GCash'
                      : row.paymentMethod === 'Bank Transfer'
                        ? 'Bank Transfer'
                        : 'Cash',
                  notes: row.chequeNo.trim()
                    ? `Ref: ${row.chequeNo.trim()}`
                    : undefined,
                  company_name: companyToUse,
                  sale_id: !Number.isNaN(parsedSaleId)
                    ? parsedSaleId
                    : undefined,
                  date: rowDate,
                })
              }
            }
          } else {
            await expenseService.addExpense({
              company: companyToUse,
              date: rowDate,
              particulars: formatted,
              amount: rowAmount,
              category: row.category || 'Rendered Fee',
              paymentMethod: row.paymentMethod,
              chequeNo: row.chequeNo.trim() || undefined,
              status: row.status,
              items: itemized,
              bankAccountId: effectiveBankId,
              createdBy: authorName,
            })
          }
        }
      }

      if (unpaidAssignments.length > 0) {
        await receivablesStore.refreshFromBackend()
      }

      bankService.invalidateCache()
      bankService.prefetchAccounts(companyToUse)

      // Invalidate particulars cache and persist row particulars for future autocomplete
      const txType = isSales ? 'Sales' : 'Expense'
      for (const row of validRows) {
        const pName = row.particulars?.trim()
        if (pName) {
          particularsService.addParticular(companyToUse, pName, txType).catch(() => {})
        }
      }
      particularsService.invalidateCache(companyToUse, txType)
      if (effectiveParticularsCompany && effectiveParticularsCompany !== companyToUse) {
        particularsService.invalidateCache(effectiveParticularsCompany, txType)
      }

      setSuccessBanner({
        count: validRowsCount,
        total: grandTotal,
        type: isEditMode
          ? `${transactionType} (Updated)`
          : `${transactionType} ${validRowsCount > 1 ? 'Records' : 'Record'}`,
      })

      setTimeout(() => {
        navigate(isSales ? '/sales' : '/expense')
      }, 900)
    } catch (err: any) {
      console.error('Failed to save spreadsheet entries:', err)
      const userMessage = formatUserFriendlyErrorMessage(
        err,
        'Failed to save transactions. Please check your entries and try again.'
      )
      setErrorMessage(userMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 pb-16 w-full max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 animate-in fade-in duration-300">
      {/* STEP 2: DEDICATED UNPAID RECEIVABLES ASSIGNMENT VIEW */}
      {currentStep === 'assign_unpaid' ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="space-y-2">
            <BackButton
              onClick={() => {
                setErrorMessage(null)
                setCurrentStep('encode')
              }}
              label="Back to Spreadsheet"
            />
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-focus tracking-tight">
                {isEditMode
                  ? 'Edit Unpaid Debtor (Receivables)'
                  : 'Assign Unpaid Entries (Receivables)'}
              </h1>
              <p className="text-xs sm:text-sm text-muted-fg font-normal mt-1">
                {isEditMode
                  ? 'The following items are marked as Unpaid. You can update who owes each item or keep the existing debtor.'
                  : 'The following items were marked as Unpaid. Specify who owes each item to automatically register them in the Receivables ledger.'}
              </p>
            </div>
          </div>

          {errorMessage && (
            <ErrorBanner
              message={errorMessage}
              onDismiss={() => setErrorMessage(null)}
            />
          )}

          <Card className="rounded-[24px] bg-white border border-stroke/30 shadow-xs overflow-hidden">
            <div className="p-4 sm:p-5 bg-rose-50/60 border-b border-rose-200/80 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-600 text-white font-bold text-xs flex items-center justify-center font-mono shadow-xs">
                  UTG
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-focus leading-tight">
                    Unpaid Entries Spreadsheet
                  </h2>
                  <p className="text-xs text-muted-fg">
                    Specify the customer or staff member for each unpaid line.
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table className="w-full border-collapse min-w-[840px]">
                <TableHeader className="bg-slate-50/90 border-b border-slate-200/80">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3">
                      #
                    </TableHead>
                    <TableHead className="text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                      UNPAID ITEM / PARTICULARS
                    </TableHead>
                    <TableHead className="w-20 text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-2">
                      QTY
                    </TableHead>
                    <TableHead className="w-32 text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-4">
                      PRICE (₱)
                    </TableHead>
                    <TableHead className="w-36 text-right text-[11px] font-bold uppercase tracking-wider text-rose-700 border-r border-slate-200/60 py-3 px-4">
                      TOTAL OWED (₱)
                    </TableHead>
                    <TableHead className="w-44 text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      CUSTOMER TYPE <span className="text-red-500">*</span>
                    </TableHead>
                    <TableHead className="text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg py-3 px-4">
                      CUSTOMER / STAFF NAME <span className="text-red-500">*</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {unpaidAssignments.map((row, idx) => (
                    <TableRow
                      key={row.rowId}
                      className="border-b border-slate-200/60 hover:bg-slate-50/70 transition-colors"
                    >
                      <TableCell className="w-12 text-center text-xs font-mono font-bold text-muted-fg/70 bg-slate-50/50 border-r border-slate-200/60 select-none py-2 px-1">
                        {idx + 1}
                      </TableCell>

                      <TableCell className="border-r border-slate-200/60 p-2.5 px-4 font-semibold text-xs sm:text-sm text-focus">
                        <span
                          className="block truncate max-w-xs sm:max-w-md"
                          title={row.particulars}
                        >
                          {row.particulars}
                        </span>
                      </TableCell>

                      <TableCell className="w-20 text-center border-r border-slate-200/60 p-2 font-mono text-xs sm:text-sm text-focus">
                        {row.quantity}
                      </TableCell>

                      <TableCell className="w-32 text-right border-r border-slate-200/60 p-2 px-4 font-mono text-xs sm:text-sm text-focus">
                        {formatPHP(row.unitPrice)}
                      </TableCell>

                      <TableCell className="w-36 text-right border-r border-slate-200/60 p-2 px-4 font-mono text-xs sm:text-sm font-bold text-rose-600 bg-rose-50/30">
                        {formatPHP(row.total)}
                      </TableCell>

                      <TableCell className="w-44 border-r border-slate-200/60 p-1.5 px-3">
                        <select
                          aria-label={`Customer type for row ${idx + 1}`}
                          value={
                            row.customerType === 'Staff' ? 'Staff' : 'External'
                          }
                          onChange={(e) => {
                            const val: CustomerType =
                              e.target.value === 'Staff' ? 'Staff' : 'External'
                            setUnpaidAssignments((prev) =>
                              prev.map((u, i) =>
                                i === idx ? { ...u, customerType: val } : u
                              )
                            )
                          }}
                          className="w-full h-9 px-3 rounded-lg border border-stroke/60 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-1 focus:ring-focus cursor-pointer"
                        >
                          <option value="External">External</option>
                          <option value="Staff">Staff</option>
                        </select>
                      </TableCell>

                      <TableCell className="p-1.5 px-3">
                        <input
                          type="text"
                          list={`debtors-list-${idx}`}
                          aria-label={`Customer or staff name for row ${idx + 1}`}
                          value={row.customerName}
                          onChange={(e) => {
                            const val = e.target.value
                            const match = knownDebtors.find(
                              (p) =>
                                p.name.toLowerCase() === val.trim().toLowerCase()
                            )
                            setUnpaidAssignments((prev) =>
                              prev.map((u, i) =>
                                i === idx
                                  ? {
                                      ...u,
                                      customerName: val,
                                      ...(match
                                        ? { customerType: match.type }
                                        : {}),
                                    }
                                  : u
                              )
                            )
                          }}
                          placeholder={
                            row.customerType === 'Staff'
                              ? 'e.g. Maria Santos'
                              : 'e.g. Mang Jose Mercado'
                          }
                          className={cn(
                            'w-full h-9 px-3 rounded-lg border text-xs text-focus shadow-2xs focus:outline-none focus:ring-1 focus:ring-focus',
                            !row.customerName.trim()
                              ? 'border-rose-300 bg-rose-50/20'
                              : 'border-stroke/60 bg-white'
                          )}
                        />
                        <datalist id={`debtors-list-${idx}`}>
                          {knownDebtors
                            .filter((p) => p.type === row.customerType)
                            .map((p) => (
                              <option key={p.name} value={p.name} />
                            ))}
                        </datalist>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="rounded-[24px] bg-white border border-stroke/30 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="text-xs font-medium text-muted-fg block">
                  Total Sales
                </span>
                <span className="text-lg sm:text-xl font-bold text-focus tabular-nums">
                  {formatPHP(grandTotal)}
                </span>
              </div>
              <div className="border-l border-slate-200 pl-6">
                <span className="text-xs font-medium text-rose-600 block">
                  Total Utang (Owed)
                </span>
                <span className="text-lg sm:text-xl font-bold text-rose-600 tabular-nums">
                  {formatPHP(unpaidTotal)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end md:self-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setErrorMessage(null)
                  setCurrentStep('encode')
                }}
                disabled={isSubmitting}
                className="h-11 px-5 rounded-xl border-slate-200 text-xs sm:text-sm font-semibold text-focus hover:bg-slate-50 cursor-pointer"
              >
                Back to Spreadsheet
              </Button>

              <Button
                type="button"
                onClick={handleSave}
                disabled={isSubmitting}
                className="h-11 px-6 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {isEditMode
                        ? 'Updating Sales & Receivables…'
                        : 'Saving and Registering Receivables…'}
                    </span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>
                      {isEditMode
                        ? 'Update & Complete Sales Record'
                        : 'Confirm & Complete Sales Record'}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        /* STEP 1: SPREADSHEET ENTRY VIEW */
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <BackButton
                onClick={() => navigate(isSales ? '/sales' : '/expense')}
                label={`Back to ${isSales ? 'Sales' : 'Expense'}`}
              />

              <div className="mt-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-focus tracking-tight">
                  {isEditMode
                    ? `Edit ${transactionType}`
                    : `Add ${transactionType}`}
                </h1>
                <p className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
                  Spreadsheet-style entry. Each row carries its own date,
                  category and payment method.
                </p>
              </div>
            </div>
          </div>

          {/* Success Banner */}
          {successBanner && (
            <div className="flex items-center gap-3 p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm font-medium shadow-xs animate-in fade-in-50 duration-200">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <strong>
                  Successfully recorded {successBanner.type} ({successBanner.count} items)!
                </strong>{' '}
                Total: <span className="font-bold">{formatPHP(successBanner.total)}</span>
                . Redirecting...
              </div>
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <ErrorBanner
              message={errorMessage}
              onDismiss={() => setErrorMessage(null)}
            />
          )}

          {/* BATCH SETUP CARD */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-stroke/20">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-fg">
                Batch Setup
              </span>
              <span className="text-xs text-muted-fg font-medium">
                Applies to every row below
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {/* Company */}
              <div className="space-y-1.5 flex flex-col justify-start">
                <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
                  <Building2 className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>Company</span>
                </label>
                {isCompanyLocked ? (
                  <div className="w-full h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-xs sm:text-sm text-focus font-medium flex items-center truncate shadow-2xs select-none">
                    {isAuditor
                      ? assignedCompany
                      : activeCompany && activeCompany !== 'All Companies'
                        ? activeCompany
                        : selectedCompany}
                  </div>
                ) : (
                  <select
                    value={selectedCompany}
                    onChange={(e) => setSelectedCompany(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
                  >
                    {dbCompanies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Deposit Bank */}
              <div className="space-y-1.5 flex flex-col justify-start">
                <label className="h-5 flex items-center gap-1.5 text-xs font-semibold text-focus">
                  <Landmark className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>
                    {isSales ? 'Deposit Bank' : 'Deposit Bank / Withdraw Bank'}
                  </span>
                </label>
                <select
                  value={selectedBankAccountId}
                  onChange={(e) => setSelectedBankAccountId(e.target.value)}
                  disabled={isLoadingBanks && availableBankAccounts.length === 0}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer disabled:opacity-70"
                >
                  {availableBankAccounts.length === 0 ? (
                    <option value="">
                      {isLoadingBanks
                        ? 'Loading bank accounts...'
                        : 'No Bank Registered'}
                    </option>
                  ) : (
                    <>
                      <option value="">None / Skip Bank Sync</option>
                      {availableBankAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.bankName} - {acc.accountName || acc.accountNumber}{' '}
                          ({formatPHP(acc.currentBalance)})
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {!isLoadingBanks && availableBankAccounts.length === 0 && (
                  <p className="text-[11px] font-medium text-amber-700 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                    <span>
                      No bank accounts registered for this company. You can still
                      record transactions.
                    </span>
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* SPREADSHEET CARD */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 shadow-xs overflow-hidden">
            {/* Header */}
            <div className="p-4 sm:p-5 bg-slate-100/90 border-b border-slate-200/80 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center font-mono shadow-xs shrink-0">
                    XLS
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-focus leading-tight">
                      {isSales ? 'Sales Sheet' : 'Expense Sheet'}
                    </h2>
                    <p className="text-xs text-muted-fg">
                      Type, paste, or fill down — totals calculate automatically.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    className="h-8 px-3 rounded-xl border-slate-200 text-xs font-semibold text-muted-fg hover:text-focus cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    <span>Reset</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddRow}
                    className="h-8 px-3.5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Row</span>
                  </Button>
                </div>
              </div>

              {/* Keyboard shortcuts helper bar */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-fg">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700 font-mono text-[10px] font-semibold">
                  Tab
                </span>
                <span>next cell</span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700 font-mono text-[10px] font-semibold">
                  Enter
                </span>
                <span>cell below (new row at end)</span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700 font-mono text-[10px] font-semibold">
                  ↑ ↓
                </span>
                <span>move rows</span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-700 font-mono text-[10px] font-semibold">
                  Ctrl + D
                </span>
                <span>fill down</span>
                <span className="text-slate-300">•</span>
                <span className="text-muted-fg">
                  Paste from Excel / Sheets supported
                </span>
              </div>
            </div>

            {/* Row validation error alert banner */}
            {rowValidationErrors.length > 0 && (
              <div className="mb-4 p-4 rounded-xl border border-rose-200 bg-rose-50/90 text-rose-900 text-xs sm:text-sm shadow-xs flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="font-bold text-rose-950">
                    Please correct the following row errors before submitting:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 text-rose-800">
                    {rowValidationErrors.flatMap((err) => {
                      const items: string[] = []
                      if (err.missingParticulars) {
                        items.push(`Row ${err.rowIndex}: The particulars couldn't be empty`)
                      }
                      if (err.missingCategory) {
                        items.push(`Row ${err.rowIndex}: The category couldn't be empty`)
                      }
                      if (err.missingPrice) {
                        items.push(`Row ${err.rowIndex}: The price couldn't be empty`)
                      }
                      return items.map((msg, i) => (
                        <li key={`${err.rowId}-${i}`}>{msg}</li>
                      ))
                    })}
                  </ul>
                </div>
              </div>
            )}

            {/* Table with fixed height & colgroup so adding rows never shifts layout */}
            <div
              ref={sheetTableContainerRef}
              className="h-[480px] sm:h-[540px] overflow-auto relative bg-white"
            >
              <Table
                containerClassName="overflow-visible"
                className="w-full border-collapse table-fixed min-w-[1388px]"
              >
                <colgroup>
                  <col style={{ width: '48px', minWidth: '48px', maxWidth: '48px' }} />
                  <col style={{ width: '145px', minWidth: '145px', maxWidth: '145px' }} />
                  <col style={{ width: '250px', minWidth: '250px', maxWidth: '250px' }} />
                  <col style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }} />
                  <col style={{ width: '155px', minWidth: '155px', maxWidth: '155px' }} />
                  <col style={{ width: '130px', minWidth: '130px', maxWidth: '130px' }} />
                  <col style={{ width: '125px', minWidth: '125px', maxWidth: '125px' }} />
                  <col style={{ width: '70px', minWidth: '70px', maxWidth: '70px' }} />
                  <col style={{ width: '110px', minWidth: '110px', maxWidth: '110px' }} />
                  {isSales && <col style={{ width: '125px', minWidth: '125px', maxWidth: '125px' }} />}
                  <col style={{ width: '125px', minWidth: '125px', maxWidth: '125px' }} />
                  <col style={{ width: '70px', minWidth: '70px', maxWidth: '70px' }} />
                </colgroup>
                <TableHeader className="bg-slate-50/95 border-b border-slate-200/80 sticky top-0 z-20">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[48px] max-w-[48px] text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3">
                      #
                    </TableHead>
                    <TableHead className="w-[145px] max-w-[145px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      DATE
                    </TableHead>
                    <TableHead className="w-[250px] max-w-[250px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      PARTICULARS <span className="text-red-500">*</span>
                    </TableHead>
                    <TableHead className="w-[175px] max-w-[175px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      CATEGORY
                    </TableHead>
                    <TableHead className="w-[155px] max-w-[155px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      PAYMENT
                    </TableHead>
                    <TableHead className="w-[130px] max-w-[130px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      CHEQUE / REF
                    </TableHead>
                    <TableHead className="w-[125px] max-w-[125px] text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      {isSales ? 'PRICE (₱) *' : 'AMOUNT (₱) *'}
                    </TableHead>
                    <TableHead className="w-[70px] max-w-[70px] text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-2">
                      QTY
                    </TableHead>
                    <TableHead className="w-[110px] max-w-[110px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-2.5">
                      STATUS
                    </TableHead>
                    {isSales && (
                      <TableHead className="w-[125px] max-w-[125px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-2.5">
                        DEPOSIT STATUS
                      </TableHead>
                    )}
                    <TableHead className="w-[125px] max-w-[125px] text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      TOTAL (₱)
                    </TableHead>
                    <TableHead className="w-[70px] max-w-[70px] text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg py-3">
                      ACTIONS
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {calculatedRows.map((row, index) => {
                    const rowErrors = rowValidationErrors.find(
                      (err) => err.rowId === row.id
                    )
                    const pmLower = (row.paymentMethod || '').trim().toLowerCase()
                    const isFeeApplicable = isSales
                      ? pmLower !== 'gcash' && !['cash', 'cheque'].includes(pmLower)
                      : !['cash', 'cheque', 'petty cash'].includes(pmLower)

                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          'border-b border-slate-200/60 transition-colors',
                          rowErrors ? 'bg-rose-50/30' : row.isPartial ? 'bg-amber-50/40' : (!row.isEmpty ? 'hover:bg-slate-50/60' : '')
                        )}
                      >
                        {/* Row Index */}
                        <TableCell className="w-[48px] max-w-[48px] text-center text-xs font-mono font-bold text-muted-fg/70 bg-slate-50/50 border-r border-slate-200/60 select-none py-2 px-1 relative box-border">
                          {index + 1}
                          {rowErrors ? (
                            <span
                              className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-rose-500 animate-pulse"
                              title="Row has missing or invalid fields"
                            />
                          ) : row.isPartial ? (
                            <span
                              className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-500"
                              title="Incomplete row data"
                            />
                          ) : null}
                        </TableCell>

                        {/* Date */}
                        <TableCell className="w-[145px] max-w-[145px] border-r border-slate-200/60 p-1 px-2 box-border">
                          <input
                            ref={(el) => {
                              cellRefs.current[`${index}-0`] = el
                            }}
                            type="date"
                            max={todayIso}
                            value={row.date}
                            onChange={(e) =>
                              handleRowChange(row.id, 'date', e.target.value)
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, index, 0)}
                            onPaste={(e) => handlePaste(e, index, 0)}
                            className="w-full h-9 px-2 text-xs sm:text-sm text-focus rounded-lg border border-slate-200/80 bg-white hover:border-slate-300 focus:border-focus focus:bg-white focus:outline-none focus:ring-1 focus:ring-focus transition-all cursor-pointer box-border"
                          />
                        </TableCell>

                        {/* Particulars Combobox */}
                        <TableCell className="w-[250px] max-w-[250px] border-r border-slate-200/60 p-1 px-2 relative box-border">
                          <ParticularsCombobox
                            inputRef={(el) => {
                              cellRefs.current[`${index}-1`] = el
                            }}
                            value={row.particulars}
                            onChange={(val) =>
                              handleRowChange(row.id, 'particulars', val)
                            }
                            onSelect={(val) => {
                              handleRowChange(row.id, 'particulars', val)
                            }}
                            savedParticulars={savedParticulars}
                            suggestions={getRowParticularSuggestions(index, row)}
                            onSaveToList={handleSaveParticularToList}
                            onDeleteFromList={handleDeleteParticularFromList}
                            onKeyDown={(e) => handleCellKeyDown(e, index, 1)}
                            onPaste={(e) => handlePaste(e, index, 1)}
                            isPartial={row.isPartial && !row.particulars.trim()}
                            hasError={Boolean(rowErrors?.missingParticulars)}
                          />
                        </TableCell>

                        {/* Category Combobox */}
                        <TableCell className="w-[175px] max-w-[175px] border-r border-slate-200/60 p-1 px-2 relative box-border">
                          <CategoryCombobox
                            inputRef={(el) => {
                              cellRefs.current[`${index}-2`] = el
                            }}
                            value={row.category}
                            defaultCategory={defaultCategory}
                            onChange={(val) =>
                              handleRowChange(row.id, 'category', val)
                            }
                            onSelect={(val) => {
                              handleRowChange(row.id, 'category', val)
                              setTimeout(() => {
                                focusCell(index, 5)
                              }, 30)
                            }}
                            persistedCategories={categories}
                            categories={getRowCategories(index)}
                            onSaveCategory={handleSaveCategory}
                            onKeyDown={(e) => handleCellKeyDown(e, index, 2)}
                            onPaste={(e) => handlePaste(e, index, 2)}
                            hasError={Boolean(rowErrors?.missingCategory)}
                          />
                        </TableCell>

                        {/* Payment Method */}
                        <TableCell className="w-[155px] max-w-[155px] border-r border-slate-200/60 p-1 px-2 box-border">
                          <select
                            ref={(el) => {
                              cellRefs.current[`${index}-3`] = el
                            }}
                            value={row.paymentMethod}
                            onChange={(e) => {
                              const val = e.target.value
                              if (val === '__add_custom__') {
                                setTargetRowForNewPaymentMethod(row.id)
                                setNewPaymentMethodName('')
                                setIsAddPaymentMethodModalOpen(true)
                                return
                              }
                              handleRowChange(
                                row.id,
                                'paymentMethod',
                                val
                              )
                              const valLower = val.toLowerCase()
                              if (
                                valLower === 'cash' ||
                                valLower === 'cheque' ||
                                valLower === 'petty cash'
                              ) {
                                handleRowChange(row.id, 'serviceFee', 0)
                              } else if (
                                row.serviceFee === undefined ||
                                row.serviceFee === ''
                              ) {
                                handleRowChange(row.id, 'serviceFee', 0)
                              }
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, index, 3)}
                            className="w-full h-9 px-2 text-xs sm:text-sm text-focus rounded-lg border border-slate-200/80 bg-white hover:border-slate-300 focus:border-focus focus:outline-none focus:ring-1 focus:ring-focus transition-all cursor-pointer truncate box-border"
                          >
                            {paymentOptions.map((pm) => (
                              <option key={pm} value={pm}>
                                {pm}
                              </option>
                            ))}
                            <option
                              value="__add_custom__"
                              className="font-semibold text-[#960C01]"
                            >
                              + Add custom method...
                            </option>
                          </select>
                          {isFeeApplicable && (
                            <div className="mt-1 flex items-center gap-1 bg-amber-50/80 border border-amber-200/90 rounded-md px-1.5 py-0.5">
                              <span className="text-[10px] font-semibold text-amber-800 shrink-0">
                                Fee: ₱
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0"
                                value={
                                  row.serviceFee === 0 ||
                                  row.serviceFee === '' ||
                                  row.serviceFee === undefined
                                    ? ''
                                    : row.serviceFee
                                }
                                onFocus={(e) => {
                                  e.target.select()
                                }}
                                onChange={(e) => {
                                  const raw = e.target.value
                                  if (raw === '') {
                                    handleRowChange(row.id, 'serviceFee', '')
                                    return
                                  }
                                  // Strip leading zeros followed by another digit (e.g. "05" -> "5")
                                  const stripped = raw.replace(/^0+(?=\d)/, '')
                                  const val = parseFloat(stripped)
                                  handleRowChange(
                                    row.id,
                                    'serviceFee',
                                    isNaN(val) ? '' : val
                                  )
                                }}
                                className="w-full text-xs font-mono font-medium text-focus bg-transparent focus:outline-none"
                              />
                            </div>
                          )}
                        </TableCell>

                        {/* Cheque / Ref No. */}
                        <TableCell className="w-[130px] max-w-[130px] border-r border-slate-200/60 p-1 px-2 box-border">
                          <input
                            ref={(el) => {
                              cellRefs.current[`${index}-4`] = el
                            }}
                            type="text"
                            placeholder="optional"
                            value={row.chequeNo}
                            onChange={(e) =>
                              handleRowChange(row.id, 'chequeNo', e.target.value)
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, index, 4)}
                            onPaste={(e) => handlePaste(e, index, 4)}
                            className="w-full h-9 px-2 text-xs sm:text-sm text-focus rounded-lg border border-slate-200/80 bg-white hover:border-slate-300 focus:border-focus focus:bg-white focus:outline-none focus:ring-1 focus:ring-focus transition-all truncate box-border"
                          />
                        </TableCell>

                        {/* Price / Amount */}
                        <TableCell className="w-[125px] max-w-[125px] border-r border-slate-200/60 p-1 px-2 box-border">
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-fg/70 pointer-events-none">
                              ₱
                            </span>
                            <input
                              ref={(el) => {
                                cellRefs.current[`${index}-5`] = el
                              }}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={row.unitPrice}
                              onChange={(e) => {
                                const val =
                                  e.target.value === ''
                                    ? ''
                                    : parseFloat(e.target.value)
                                handleRowChange(
                                  row.id,
                                  'unitPrice',
                                  isNaN(val as number) ? '' : val
                                )
                              }}
                              onKeyDown={(e) => handleCellKeyDown(e, index, 5)}
                              onPaste={(e) => handlePaste(e, index, 5)}
                              className={cn(
                                'w-full h-9 pl-6 pr-2 text-right text-xs sm:text-sm font-mono text-focus rounded-lg border focus:bg-white focus:outline-none focus:ring-1 transition-all box-border',
                                rowErrors?.missingPrice
                                  ? 'border-rose-500 bg-rose-50/20 focus:border-rose-600 focus:ring-rose-600'
                                  : row.isPartial && (!row.unitPrice || row.unitPrice === 0)
                                    ? 'border-amber-400 bg-amber-50/20 focus:border-amber-500 focus:ring-amber-500'
                                    : 'border-slate-200/80 hover:border-slate-300 focus:border-focus focus:ring-focus'
                              )}
                            />
                          </div>
                        </TableCell>

                        {/* Quantity */}
                        <TableCell className="w-[70px] max-w-[70px] border-r border-slate-200/60 p-1 px-1.5 box-border">
                          <input
                            ref={(el) => {
                              cellRefs.current[`${index}-6`] = el
                            }}
                            type="number"
                            min="1"
                            step="1"
                            placeholder="1"
                            value={row.quantity}
                            onChange={(e) => {
                              const val =
                                e.target.value === ''
                                  ? ''
                                  : parseInt(e.target.value, 10)
                              handleRowChange(
                                row.id,
                                'quantity',
                                isNaN(val as number) ? '' : val
                              )
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, index, 6)}
                            onPaste={(e) => handlePaste(e, index, 6)}
                            className="w-full h-9 px-1 text-center text-xs sm:text-sm font-mono text-focus rounded-lg border border-slate-200/80 bg-white hover:border-slate-300 focus:border-focus focus:bg-white focus:outline-none focus:ring-1 focus:ring-focus transition-all box-border"
                          />
                        </TableCell>

                        {/* Status */}
                        <TableCell className="w-[110px] max-w-[110px] border-r border-slate-200/60 p-1 px-1.5 box-border">
                          <select
                            ref={(el) => {
                              cellRefs.current[`${index}-7`] = el
                            }}
                            value={row.status}
                            onChange={(e) =>
                              handleRowChange(
                                row.id,
                                'status',
                                e.target.value as 'Paid' | 'Unpaid' | 'Pending'
                              )
                            }
                            onKeyDown={(e) => handleCellKeyDown(e, index, 7)}
                            className={cn(
                              'w-full h-9 px-1.5 text-xs font-semibold rounded-lg border focus:outline-none focus:ring-1 transition-all cursor-pointer truncate box-border',
                              row.status === 'Paid'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500'
                                : row.status === 'Unpaid'
                                  ? 'bg-rose-50 text-rose-700 border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                                  : 'bg-yellow-100 text-yellow-800 border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500'
                            )}
                          >
                            <option value="Paid">Paid</option>
                            <option value="Unpaid">Unpaid</option>
                            <option value="Pending">Pending</option>
                          </select>
                          {row.status === 'Unpaid' && isSales && (() => {
                            const assign =
                              unpaidAssignments.find((u) => u.rowId === row.id) ||
                              (index === 0 ? unpaidAssignments[0] : undefined)
                            const debtorName = assign?.customerName?.trim()
                            if (!debtorName) return null
                            return (
                              <div
                                className="mt-1 flex items-center justify-between text-[10px] text-rose-700 bg-rose-50/90 border border-rose-200 rounded px-1.5 py-0.5 truncate"
                                title={`Assigned to: ${debtorName} (${assign?.customerType || 'External'})`}
                              >
                                <span className="truncate font-semibold">
                                  {`${debtorName} (${assign?.customerType === 'Staff' ? 'Staff' : 'Ext'})`}
                                </span>
                              </div>
                            )
                          })()}
                        </TableCell>

                        {/* Deposit Status (Sales only) */}
                        {isSales && (
                          <TableCell className="w-[125px] max-w-[125px] border-r border-slate-200/60 p-1 px-1.5 box-border">
                            {row.status === 'Unpaid' || row.status === 'Pending' ? (
                              <div
                                title="Deposit status is read only for Unpaid or Pending transactions"
                                className="w-full h-9 px-1.5 text-xs font-semibold rounded-lg border bg-slate-100 text-slate-500 border-slate-200 flex items-center justify-center select-none truncate cursor-not-allowed"
                              >
                                Not Deposited
                              </div>
                            ) : (
                              <select
                                value={row.depositStatus || (row.status === 'Paid' ? 'Deposited' : 'Not Deposited')}
                                onChange={(e) => {
                                  const newDs = e.target.value as 'Deposited' | 'Not Deposited'
                                  setErrorMessage(null)
                                  handleRowChange(row.id, 'depositStatus', newDs)
                                }}
                                className={cn(
                                  'w-full h-9 px-1.5 text-xs font-semibold rounded-lg border focus:outline-none focus:ring-1 transition-all cursor-pointer truncate box-border',
                                  (row.depositStatus || (row.status === 'Paid' ? 'Deposited' : 'Not Deposited')) === 'Deposited'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500'
                                    : 'bg-slate-100 text-slate-700 border-slate-300 focus:border-slate-400 focus:ring-slate-400'
                                )}
                              >
                                <option value="Deposited">Deposited</option>
                                <option value="Not Deposited">Not Deposited</option>
                              </select>
                            )}
                          </TableCell>
                        )}

                        {/* Total Price */}
                        <TableCell className="w-[125px] max-w-[125px] border-r border-slate-200/60 p-1 px-3 text-right box-border">
                          <span
                            className={cn(
                              'font-mono text-xs sm:text-sm font-bold block py-1.5 truncate',
                              row.rowTotal > 0
                                ? isSales
                                  ? 'text-emerald-600'
                                  : 'text-rose-600'
                                : 'text-muted-fg/40'
                            )}
                          >
                            {formatPHP(row.rowTotal)}
                          </span>
                        </TableCell>

                        {/* Actions (3-dots menu) */}
                        <TableCell className="w-[70px] max-w-[70px] text-center p-1 box-border">
                          <div className="flex items-center justify-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (openActionRowId === row.id) {
                                  closeActionMenu()
                                  return
                                }
                                const rect =
                                  e.currentTarget.getBoundingClientRect()
                                const openUpward =
                                  rect.bottom + 150 > window.innerHeight
                                setActionMenuPos({
                                  top: openUpward
                                    ? rect.top - 6
                                    : rect.bottom + 6,
                                  right: Math.max(
                                    12,
                                    window.innerWidth - rect.right
                                  ),
                                  openUpward,
                                })
                                setOpenActionRowId(row.id)
                              }}
                              className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                              title="Row actions"
                              aria-label={`Actions for row ${index + 1}`}
                              aria-haspopup="true"
                              aria-expanded={openActionRowId === row.id}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* 3-Dots Row Action Portal Menu */}
            {openActionRowId &&
              actionMenuPos &&
              typeof document !== 'undefined' &&
              (() => {
                const activeIdx = calculatedRows.findIndex(
                  (r) => r.id === openActionRowId
                )
                const activeRow =
                  activeIdx >= 0 ? calculatedRows[activeIdx] : null
                if (!activeRow) return null
                const isDeleteDisabled = rows.length <= 1 && activeRow.isEmpty

                return createPortal(
                  <div
                    className="fixed w-44 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
                    style={{
                      top: `${actionMenuPos.top}px`,
                      right: `${actionMenuPos.right}px`,
                      transform: actionMenuPos.openUpward
                        ? 'translateY(-100%)'
                        : 'none',
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        closeActionMenu()
                        handleDuplicateRow(activeIdx)
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                      <span>Duplicate Row</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        closeActionMenu()
                        handleInsertRowBelow(activeIdx)
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                      <span>Insert Row Below</span>
                    </button>

                    <button
                      type="button"
                      disabled={isDeleteDisabled}
                      onClick={() => {
                        if (isDeleteDisabled) return
                        closeActionMenu()
                        handleRemoveRow(activeRow.id)
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:pointer-events-none transition-colors text-left cursor-pointer border-t border-slate-100 mt-1 pt-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Delete Row</span>
                    </button>
                  </div>,
                  document.body
                )
              })()}

            {/* Bottom Add Row Bar */}
            <div className="p-3 bg-slate-50/70 border-t border-slate-200/60 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddRow}
                className="h-9 px-4 rounded-xl border-dashed border-slate-300 hover:border-focus text-xs font-semibold text-focus gap-2 cursor-pointer transition-all"
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                <span>+ Add row to sheet</span>
              </Button>

              <span className="text-xs text-muted-fg">
                {rows.length} total rows • {validRowsCount} valid items
              </span>
            </div>
          </Card>

          {/* BOTTOM SUMMARY BAR */}
          <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex flex-wrap items-center gap-4 sm:gap-8">
              <div>
                <span className="text-xs font-medium text-muted-fg block">
                  Valid particulars
                </span>
                <span className="text-lg sm:text-xl font-bold text-focus mt-0.5 block">
                  {validRowsCount} item{validRowsCount !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="border-l border-slate-200 pl-4 sm:pl-8">
                <span className="text-xs font-medium text-muted-fg block">
                  Total units
                </span>
                <span className="text-lg sm:text-xl font-bold text-focus mt-0.5 block">
                  {totalQuantity}
                </span>
              </div>

              <div className="border-l border-slate-200 pl-4 sm:pl-8">
                <span className="text-xs font-medium text-muted-fg block">
                  Grand total {isSales ? 'sales' : 'expense'}
                </span>
                <span
                  className={cn(
                    'text-lg sm:text-xl font-bold mt-0.5 block tabular-nums',
                    isSales ? 'text-emerald-600' : 'text-rose-600'
                  )}
                >
                  {formatPHP(grandTotal)}
                </span>
              </div>

              {paymentBreakdown.length > 0 ? (
                paymentBreakdown.map(([method, amount]) => (
                  <div
                    key={method}
                    className="border-l border-slate-200 pl-4 sm:pl-6"
                  >
                    <span className="text-xs font-medium text-muted-fg block">
                      {method}
                    </span>
                    <span className="text-lg sm:text-xl font-bold text-focus mt-0.5 block tabular-nums">
                      {formatPHP(amount)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="border-l border-slate-200 pl-4 sm:pl-6">
                  <span className="text-xs font-medium text-muted-fg block">
                    Cash
                  </span>
                  <span className="text-lg sm:text-xl font-bold text-focus mt-0.5 block tabular-nums">
                    ₱0.00
                  </span>
                </div>
              )}

              {unpaidTotal > 0 && (
                <div className="border-l border-slate-200 pl-4 sm:pl-6">
                  <span className="text-xs font-medium text-rose-600 block">
                    Unpaid (Utang)
                  </span>
                  <span className="text-lg sm:text-xl font-bold text-rose-600 mt-0.5 block tabular-nums">
                    {formatPHP(unpaidTotal)}
                  </span>
                </div>
              )}

              {pendingTotal > 0 && (
                <div className="border-l border-slate-200 pl-4 sm:pl-6">
                  <span className="text-xs font-medium text-yellow-700 block">
                    Pending
                  </span>
                  <span className="text-lg sm:text-xl font-bold text-yellow-700 mt-0.5 block tabular-nums">
                    {formatPHP(pendingTotal)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(isSales ? '/sales' : '/expense')}
                disabled={isSubmitting}
                className="h-11 px-5 rounded-xl border-slate-200 text-xs sm:text-sm font-semibold text-focus hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </Button>

              <Button
                type="button"
                onClick={handleSave}
                disabled={isSubmitting || exceedsPettyCash}
                className={cn(
                  'h-11 px-6 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all',
                  'bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-40'
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      {isEditMode ? 'Updating…' : `Saving ${validRowsCount} items…`}
                    </span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>
                      {isSales && unpaidTotal > 0
                        ? isEditMode
                          ? 'Next: Review / Edit Debtor'
                          : 'Next: Assign Unpaid'
                        : isEditMode
                          ? `Update ${transactionType}`
                          : `Save ${transactionType} ${validRowsCount > 1 ? 'Records' : 'Record'}`}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal: Add Custom Payment Method */}
      {isAddPaymentMethodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in-50 duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-focus">
                Add Custom Payment Method
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsAddPaymentMethodModalOpen(false)
                  setNewPaymentMethodName('')
                  setTargetRowForNewPaymentMethod(null)
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-fg leading-relaxed">
              Register a custom payment method for{' '}
              <span className="font-semibold text-focus">
                {isAuditor ? assignedCompany : selectedCompany}
              </span>{' '}
              (e.g. Maya, Panda, GrabPay). This option will be scoped exclusively to your company.
            </p>
            <div>
              <label className="block text-xs font-semibold text-focus mb-1">
                Payment Method Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Maya, GrabPay"
                value={newPaymentMethodName}
                onChange={(e) => setNewPaymentMethodName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreateCustomPaymentMethod()
                  }
                }}
                className="w-full h-10 px-3 text-xs sm:text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-focus"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddPaymentMethodModalOpen(false)
                  setNewPaymentMethodName('')
                  setTargetRowForNewPaymentMethod(null)
                }}
                className="h-9 px-4 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCreateCustomPaymentMethod}
                disabled={!newPaymentMethodName.trim()}
                className="h-9 px-4 text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer"
              >
                Add Method
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
