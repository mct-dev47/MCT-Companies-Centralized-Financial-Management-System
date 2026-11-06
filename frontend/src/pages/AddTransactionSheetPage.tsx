import * as React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Plus,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
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
  'Petty Cash',
  'Rendered Fee',
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

interface ParticularsComboboxProps {
  value: string
  onChange: (val: string) => void
  onSelect: (val: string) => void
  savedParticulars: CompanyParticular[]
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
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const trimmedValue = value.trim()

  const filtered = React.useMemo(() => {
    if (!trimmedValue) return savedParticulars
    return savedParticulars.filter((p) =>
      p.name.toLowerCase().includes(trimmedValue.toLowerCase())
    )
  }, [savedParticulars, trimmedValue])

  const hasExactMatch = React.useMemo(() => {
    if (!trimmedValue) return false
    return savedParticulars.some(
      (p) => p.name.trim().toLowerCase() === trimmedValue.toLowerCase()
    )
  }, [savedParticulars, trimmedValue])

  const canSaveToList = trimmedValue.length > 0 && !hasExactMatch
  const totalOptions = (canSaveToList ? 1 : 0) + filtered.length

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleKeyDownInternal = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setIsOpen(true)
        setHighlightedIndex(0)
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
      if (isOpen && highlightedIndex >= 0) {
        e.preventDefault()
        e.stopPropagation()
        if (canSaveToList && highlightedIndex === 0) {
          onSaveToList(trimmedValue)
          onSelect(trimmedValue)
        } else {
          const itemIdx = canSaveToList ? highlightedIndex - 1 : highlightedIndex
          if (itemIdx >= 0 && itemIdx < filtered.length) {
            onSelect(filtered[itemIdx].name)
          }
        }
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      } else if (canSaveToList) {
        // Quick Enter when typing saves to list immediately
        e.preventDefault()
        e.stopPropagation()
        onSaveToList(trimmedValue)
        onSelect(trimmedValue)
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false)
      setHighlightedIndex(-1)
    }

    onKeyDown(e)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative w-full flex items-center">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder || 'Type or select a particular...'}
          value={value}
          onFocus={() => {
            setHighlightedIndex(-1)
          }}
          onClick={() => {
            setIsOpen(true)
            setHighlightedIndex(-1)
          }}
          onChange={(e) => {
            onChange(e.target.value)
            if (!isOpen) setIsOpen(true)
            setHighlightedIndex(-1)
          }}
          onKeyDown={handleKeyDownInternal}
          onPaste={onPaste}
          className={cn(
            'w-full h-9 pl-2 text-xs sm:text-sm text-focus rounded-lg border bg-white focus:outline-none focus:ring-1 transition-all box-border',
            canSaveToList ? 'pr-16' : 'pr-2',
            hasError
              ? 'border-rose-500 bg-rose-50/20 focus:border-rose-600 focus:ring-rose-600'
              : isPartial
              ? 'border-amber-400 bg-amber-50/20 focus:border-amber-500 focus:ring-amber-500'
              : 'border-slate-200/80 hover:border-slate-300 focus:border-focus focus:ring-focus'
          )}
        />
        {canSaveToList && (
          <button
            type="button"
            title={`Save "${trimmedValue}" to company list`}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSaveToList(trimmedValue)
              onSelect(trimmedValue)
              setIsOpen(false)
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 px-2 rounded-md bg-[#960C01] hover:bg-[#800a01] text-white text-[10px] font-bold shadow-2xs flex items-center gap-0.5 z-10 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3 h-3" />
            <span>Save</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full min-w-[250px] max-w-sm bg-white rounded-xl border border-stroke/40 shadow-xl z-50 overflow-hidden py-1 animate-in fade-in-50 duration-150">
          {/* Option 0: Save to my list (pinned at top so user immediately has the option) */}
          {canSaveToList && (
            <div
              className={cn(
                'px-3 py-2 text-xs font-semibold text-[#960C01] bg-red-50/60 hover:bg-red-100/80 border-b border-red-100 flex items-center justify-between cursor-pointer transition-colors',
                highlightedIndex === 0 && 'bg-red-200/80 font-bold'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                onSaveToList(trimmedValue)
                onSelect(trimmedValue)
                setIsOpen(false)
                setHighlightedIndex(-1)
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
            <div className="max-h-56 overflow-y-auto">
              {filtered.map((item, idx) => {
                const actualIndex = canSaveToList ? idx + 1 : idx
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'px-3 py-2 text-xs text-focus flex items-center justify-between cursor-pointer group hover:bg-slate-100 transition-colors',
                      highlightedIndex === actualIndex && 'bg-slate-100 font-medium'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onSelect(item.name)
                      setIsOpen(false)
                      setHighlightedIndex(-1)
                    }}
                  >
                    <span className="truncate flex-1">{item.name}</span>
                    {typeof item.id === 'number' && item.id > 0 && (
                      <button
                        type="button"
                        aria-label={`Remove ${item.name} from saved list`}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0 cursor-pointer"
                        title="Remove from saved list"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onDeleteFromList(item.id as number)
                        }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CategoryComboboxProps {
  value: string
  onChange: (val: string) => void
  onSelect: (val: string) => void
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
  onChange,
  onSelect,
  categories,
  onSaveCategory,
  onKeyDown,
  onPaste,
  inputRef,
  placeholder,
  hasError,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const trimmedValue = value.trim()

  const filtered = React.useMemo(() => {
    if (!trimmedValue) return categories
    return categories.filter((c) =>
      c.toLowerCase().includes(trimmedValue.toLowerCase())
    )
  }, [categories, trimmedValue])

  const hasExactMatch = React.useMemo(() => {
    if (!trimmedValue) return false
    return categories.some(
      (c) => c.trim().toLowerCase() === trimmedValue.toLowerCase()
    )
  }, [categories, trimmedValue])

  const canSaveToList = trimmedValue.length > 0 && !hasExactMatch
  const totalOptions = (canSaveToList ? 1 : 0) + filtered.length

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setHighlightedIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleKeyDownInternal = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setIsOpen(true)
        setHighlightedIndex(0)
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
      if (isOpen && highlightedIndex >= 0) {
        e.preventDefault()
        e.stopPropagation()
        if (canSaveToList && highlightedIndex === 0) {
          onSaveCategory(trimmedValue)
          onSelect(trimmedValue)
        } else {
          const itemIdx = canSaveToList ? highlightedIndex - 1 : highlightedIndex
          if (itemIdx >= 0 && itemIdx < filtered.length) {
            onSelect(filtered[itemIdx])
          }
        }
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      } else if (canSaveToList) {
        e.preventDefault()
        e.stopPropagation()
        onSaveCategory(trimmedValue)
        onSelect(trimmedValue)
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen(false)
        setHighlightedIndex(-1)
        return
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false)
      setHighlightedIndex(-1)
    }

    onKeyDown(e)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative w-full flex items-center">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder || 'Select or type category...'}
          value={value}
          onFocus={() => {
            setIsOpen(true)
            setHighlightedIndex(-1)
          }}
          onChange={(e) => {
            onChange(e.target.value)
            if (!isOpen) setIsOpen(true)
            setHighlightedIndex(-1)
          }}
          onKeyDown={handleKeyDownInternal}
          onPaste={onPaste}
          className={cn(
            'w-full h-9 pl-2 text-xs sm:text-sm text-focus rounded-lg border bg-white focus:outline-none focus:ring-1 transition-all box-border truncate',
            canSaveToList ? 'pr-14' : 'pr-2',
            hasError
              ? 'border-rose-500 bg-rose-50/20 focus:border-rose-600 focus:ring-rose-600'
              : 'border-slate-200/80 hover:border-slate-300 focus:border-focus focus:ring-focus'
          )}
        />
        {canSaveToList && (
          <button
            type="button"
            title={`Add "${trimmedValue}" to categories`}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSaveCategory(trimmedValue)
              onSelect(trimmedValue)
              setIsOpen(false)
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 px-1.5 rounded-md bg-[#960C01] hover:bg-[#800a01] text-white text-[10px] font-bold shadow-2xs flex items-center gap-0.5 z-10 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full min-w-[200px] max-w-xs bg-white rounded-xl border border-stroke/40 shadow-xl z-50 overflow-hidden py-1 animate-in fade-in-50 duration-150">
          {/* Option 0: Add to categories pinned at top */}
          {canSaveToList && (
            <div
              className={cn(
                'px-3 py-2 text-xs font-semibold text-[#960C01] bg-red-50/60 hover:bg-red-100/80 border-b border-red-100 flex items-center justify-between cursor-pointer transition-colors',
                highlightedIndex === 0 && 'bg-red-200/80 font-bold'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                onSaveCategory(trimmedValue)
                onSelect(trimmedValue)
                setIsOpen(false)
                setHighlightedIndex(-1)
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

          <div className="max-h-56 overflow-y-auto">
            {filtered.map((cat, idx) => {
              const actualIndex = canSaveToList ? idx + 1 : idx
              return (
                <div
                  key={cat}
                  className={cn(
                    'px-3 py-2 text-xs text-focus flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors',
                    highlightedIndex === actualIndex && 'bg-slate-100 font-medium'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect(cat)
                    setIsOpen(false)
                    setHighlightedIndex(-1)
                  }}
                >
                  <span className="truncate flex-1">{cat}</span>
                </div>
              )
            })}
          </div>
        </div>
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

  React.useEffect(() => {
    let isMounted = true
    const comp = isAuditor ? assignedCompany : selectedCompany
    if (!comp) return

    particularsService.getParticulars(comp).then((data) => {
      if (isMounted) {
        setSavedParticulars(data)
      }
    })
    return () => {
      isMounted = false
    }
  }, [isAuditor, assignedCompany, selectedCompany])

  const handleSaveParticularToList = async (name: string) => {
    const comp = isAuditor ? assignedCompany : selectedCompany
    const trimmed = name.trim()
    if (!comp || !trimmed) return

    const tempId = Date.now()
    const optimistic: CompanyParticular = {
      id: tempId,
      name: trimmed,
      company_name: comp,
    }

    setSavedParticulars((prev) => {
      if (prev.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
        return prev
      }
      return [...prev, optimistic].sort((a, b) => a.name.localeCompare(b.name))
    })

    try {
      const created = await particularsService.addParticular(comp, trimmed)
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
    const comp = isAuditor ? assignedCompany : selectedCompany
    setSavedParticulars((prev) => prev.filter((p) => p.id !== id))
    await particularsService.deleteParticular(id, comp)
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

  // Categories list
  const [categories, setCategories] = React.useState<string[]>([])

  React.useEffect(() => {
    if (isSales) {
      setCategories(SALES_CATEGORY_LIST)
      return
    }

    let mounted = true
    expenseService.getCategories().then((cats) => {
      if (mounted) {
        const fetchedNames = (cats || [])
          .map((c) => c.name?.trim())
          .filter(Boolean)
          .filter((name) => !DEPRECATED_OLD_CATEGORIES.has(name.toLowerCase()))

        const combined = Array.from(
          new Set([...DEFAULT_EXPENSE_CATEGORIES, ...fetchedNames])
        )
        setCategories(combined)
      }
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

    try {
      await expenseService.createCategory(trimmed)
    } catch (err) {
      console.warn('Failed to save category to backend:', err)
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

  // Dynamically merge saved particulars from database + any particulars currently typed in any row
  const allAvailableParticulars = React.useMemo(() => {
    const list: CompanyParticular[] = [...savedParticulars]
    const seen = new Set(savedParticulars.map((p) => p.name.trim().toLowerCase()))

    rows.forEach((r, idx) => {
      const trimmed = r.particulars.trim()
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase())
        list.push({
          id: -1 * (idx + 1),
          name: trimmed,
          company_name: isAuditor ? assignedCompany : selectedCompany,
        })
      }
    })

    return list
  }, [savedParticulars, rows, isAuditor, assignedCompany, selectedCompany])

  // Dynamically merge categories with any category currently typed in any row
  const allAvailableCategories = React.useMemo(() => {
    const list = [...categories]
    const seen = new Set(categories.map((c) => c.trim().toLowerCase()))

    rows.forEach((r) => {
      const trimmed = r.category?.trim()
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase())
        list.push(trimmed)
      }
    })

    return list
  }, [categories, rows])

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
          },
        ])
      }
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

  const focusCell = (rowIdx: number, colIdx: number) => {
    const el = cellRefs.current[`${rowIdx}-${colIdx}`]
    if (el) {
      el.focus()
      if (el instanceof HTMLInputElement && el.type !== 'date') {
        try {
          el.select()
        } catch {
          // ignore
        }
      }
    }
  }

  // Row operations
  const handleAddRow = () => {
    const prevRow = rows[rows.length - 1]
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
      },
    ])
    setTimeout(() => {
      focusCell(rows.length, 1)
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
        return {
          ...r,
          [field]: value,
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
      if (rowIdx === rows.length - 1) {
        const prevRow = rows[rows.length - 1]
        const newId = `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
        setRows((prev) => [
          ...prev,
          {
            id: newId,
            date: prevRow?.date || todayIso,
            particulars: '',
            category: prevRow?.category || defaultCategory,
            paymentMethod: prevRow?.paymentMethod || 'Cash',
            chequeNo: '',
            unitPrice: '',
            quantity: 1,
            status: 'Paid',
          },
        ])
        setTimeout(() => {
          focusCell(rowIdx + 1, colIdx)
        }, 40)
      } else {
        focusCell(rowIdx + 1, colIdx)
      }
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
      const isGCashOrCustom =
        pmLower === 'gcash' ||
        !['cash', 'cheque', 'petty cash'].includes(pmLower)
      const serviceFee = isGCashOrCustom
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
        serviceFee: isGCashOrCustom ? serviceFee : 0,
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
      setUnpaidAssignments(
        unpaidRows.map((it, lineIdx) => ({
          rowId: it.id,
          saleLineIndex: lineIdx,
          particulars: it.particulars.trim(),
          quantity: it.numericQty,
          unitPrice: it.numericPrice,
          total: it.rowTotal,
          customerType: 'External',
          customerName: '',
        }))
      )
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
            items: itemized,
            bankAccountId: effectiveBankId,
            updatedBy: authorName,
            updatedAt: nowIso,
          })
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
                Assign Unpaid Entries (Receivables)
              </h1>
              <p className="text-xs sm:text-sm text-muted-fg font-normal mt-1">
                The following items were marked as <strong>Unpaid</strong>.
                Specify who owes each item to automatically register them in
                the Receivables ledger.
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
                    <span>Saving and Registering Receivables…</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Confirm & Complete Sales Record</span>
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
                    {rowValidationErrors.map((err) => {
                      const missing: string[] = []
                      if (err.missingParticulars) missing.push('Particulars')
                      if (err.missingCategory) missing.push('Category')
                      if (err.missingPrice) missing.push('Price (> 0)')
                      return (
                        <li key={err.rowId}>
                          <span className="font-semibold">Row {err.rowIndex}:</span> Missing {missing.join(', ')}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            )}

            {/* Table with fixed layout, balanced min-height, and colgroup to permanently lock column positions */}
            <Table
              containerClassName="relative min-h-[340px] max-h-[70vh] overflow-auto"
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
                  <col style={{ width: '125px', minWidth: '125px', maxWidth: '125px' }} />
                  <col style={{ width: '85px', minWidth: '85px', maxWidth: '85px' }} />
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
                    <TableHead className="w-[160px] max-w-[160px] text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
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
                    <TableHead className="w-[125px] max-w-[125px] text-right text-[11px] font-bold uppercase tracking-wider text-muted-fg border-r border-slate-200/60 py-3 px-3">
                      TOTAL (₱)
                    </TableHead>
                    <TableHead className="w-[85px] max-w-[85px] text-center text-[11px] font-bold uppercase tracking-wider text-muted-fg py-3">
                      ACTIONS
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {calculatedRows.map((row, index) => {
                    const rowErrors = rowValidationErrors.find(
                      (err) => err.rowId === row.id
                    )
                    const isGCashOrCustom =
                      (row.paymentMethod || '').toLowerCase() === 'gcash' ||
                      !['cash', 'cheque', 'petty cash'].includes(
                        (row.paymentMethod || '').toLowerCase()
                      )

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
                              setTimeout(() => {
                                focusCell(index, 2)
                              }, 30)
                            }}
                            savedParticulars={allAvailableParticulars}
                            onSaveToList={handleSaveParticularToList}
                            onDeleteFromList={handleDeleteParticularFromList}
                            onKeyDown={(e) => handleCellKeyDown(e, index, 1)}
                            onPaste={(e) => handlePaste(e, index, 1)}
                            isPartial={row.isPartial && !row.particulars.trim()}
                            hasError={Boolean(rowErrors?.missingParticulars)}
                          />
                        </TableCell>

                        {/* Category Combobox */}
                        <TableCell className="w-[160px] max-w-[160px] border-r border-slate-200/60 p-1 px-2 relative box-border">
                          <CategoryCombobox
                            inputRef={(el) => {
                              cellRefs.current[`${index}-2`] = el
                            }}
                            value={row.category}
                            onChange={(val) =>
                              handleRowChange(row.id, 'category', val)
                            }
                            onSelect={(val) => {
                              handleRowChange(row.id, 'category', val)
                              setTimeout(() => {
                                focusCell(index, 3)
                              }, 30)
                            }}
                            categories={allAvailableCategories}
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
                          {isGCashOrCustom && (
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
                                  row.serviceFee !== undefined
                                    ? row.serviceFee
                                    : 0
                                }
                                onChange={(e) => {
                                  const val =
                                    e.target.value === ''
                                      ? ''
                                      : parseFloat(e.target.value)
                                  handleRowChange(
                                    row.id,
                                    'serviceFee',
                                    isNaN(val as number) ? '' : val
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
                        </TableCell>

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

                        {/* Actions */}
                        <TableCell className="w-[85px] max-w-[85px] text-center p-1 box-border">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDuplicateRow(index)}
                              className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-focus hover:bg-slate-100 cursor-pointer"
                              title="Duplicate row"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveRow(row.id)}
                              disabled={rows.length <= 1 && row.isEmpty}
                              className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
                              title="Delete row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

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
                      {isEditMode
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
