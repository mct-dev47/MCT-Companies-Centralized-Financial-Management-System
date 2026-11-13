import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Dropdown } from '@/components/ui/Dropdown'
import { ModalReviewStep } from '@/components/common/ModalReviewStep'
import { Button } from '@/components/ui/button'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PlusCircle,
  ChevronDown,
  Check,
  AlertCircle,
} from 'lucide-react'
import {
  expenseService,
  type NewExpenseInput,
  type ExpenseItem,
} from '@/services/expenseService'
import {
  particularsService,
  type CompanyParticular,
} from '@/services/particularsService'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { pettyCashService } from '@/services/pettyCashService'
import { bankService } from '@/services/bankService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { useDailyRemarks } from '@/hooks/useDailyRemarks'

import { PREDEFINED_PETTY_CASH_CATEGORIES } from '@/pages/AddTransactionSheetPage'

interface AddExpenseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (newItem: ExpenseItem) => void
  assignedCompany: string
  initialPaymentMethod?: string
}

const PAYMENT_METHOD_OPTIONS = [
  'Cash',
  'Petty Cash',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'Cheque',
  'Bank Transfer',
  'In-house',
]

const DEFAULT_EXPENSE_CATEGORIES = [
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
]

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

export const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  assignedCompany,
  initialPaymentMethod,
}) => {
  const getTodayIso = () => formatToYYYYMMDD(new Date())

  const [date, setDate] = React.useState(getTodayIso())
  const [chequeNo, setChequeNo] = React.useState('')
  const [pettyCashCategory, setPettyCashCategory] = React.useState('')
  const [particulars, setParticulars] = React.useState('')
  const [particularOptions, setParticularOptions] = React.useState<CompanyParticular[]>([])
  const [amount, setAmount] = React.useState('')
  const [dayRemark, setDayRemark] = React.useState('')
  const [dayRemarkTouched, setDayRemarkTouched] = React.useState(false)
  const { getRemark: getDayRemark, saveRemark: saveDayRemark } = useDailyRemarks('expense', [assignedCompany])
  const [paymentMethod, setPaymentMethod] = React.useState(initialPaymentMethod || 'Cash')
  const [category, setCategory] = React.useState(
    (initialPaymentMethod || '').trim().toLowerCase() === 'petty cash'
      ? 'Petty Cash'
      : (DEFAULT_EXPENSE_CATEGORIES[1] || 'Rendered Fee')
  )
  const [categoryOptions, setCategoryOptions] = React.useState<string[]>(DEFAULT_EXPENSE_CATEGORIES)
  const [isCategoryOpen, setIsCategoryOpen] = React.useState(false)
  const [isCategoryTyping, setIsCategoryTyping] = React.useState(false)
  const categoryContainerRef = React.useRef<HTMLDivElement>(null)

  // Petty cash is strictly determined by payment method being Petty Cash
  const isPettyCash = paymentMethod.trim().toLowerCase() === 'petty cash'

  // Petty cash wallet balance for this company (null = unknown / backend unavailable)
  const [pettyBalance, setPettyBalance] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!open || !isPettyCash) return
    let isMounted = true
    pettyCashService
      .getSummary(assignedCompany)
      .then((s) => isMounted && setPettyBalance(s.balance))
      .catch(() => isMounted && setPettyBalance(null))
    return () => {
      isMounted = false
    }
  }, [open, isPettyCash, assignedCompany])
  const parsedAmountValue = parseFloat(amount.replace(/,/g, '')) || 0
  const exceedsPettyCash = isPettyCash && pettyBalance !== null && parsedAmountValue > pettyBalance

  // Check if assigned company has any registered bank accounts
  const [hasBankAccounts, setHasBankAccounts] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    if (!open) return
    let mounted = true
    bankService
      .getAccounts(assignedCompany)
      .then((accs) => {
        if (mounted) {
          setHasBankAccounts(Boolean(accs && accs.length > 0))
        }
      })
      .catch(() => {
        if (mounted) setHasBankAccounts(true)
      })
    return () => {
      mounted = false
    }
  }, [open, assignedCompany])

  // Confirmation dialogue state
  const [isReviewing, setIsReviewing] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    date?: string
    particulars?: string
    amount?: string
    category?: string
  }>({})

  // Fetch categories from the database
  React.useEffect(() => {
    let isMounted = true
    const fetchCategories = async () => {
      try {
        const cats = await expenseService.getCategories()
        if (isMounted && cats && cats.length > 0) {
          const names = Array.from(
            new Set([
              ...DEFAULT_EXPENSE_CATEGORIES,
              ...cats
                .map((c) => c.name?.trim())
                .filter(Boolean)
                .filter((n) => !DEPRECATED_OLD_CATEGORIES.has(n.toLowerCase())),
            ])
          )
          setCategoryOptions(names)
        }
      } catch (err) {
        console.warn('Could not load categories from database:', err)
      }
    }
    fetchCategories()
    return () => {
      isMounted = false
    }
  }, [open])

  // Load previous particulars for suggestions/autocomplete
  React.useEffect(() => {
    let mounted = true
    if (open && assignedCompany) {
      particularsService
        .getParticulars(assignedCompany, 'Expense')
        .then((data) => {
          if (mounted && data) {
            setParticularOptions(data)
          }
        })
        .catch(() => {})
    }
    return () => {
      mounted = false
    }
  }, [open, assignedCompany])

  const filteredCategoryOptions = React.useMemo(() => {
    if (!isCategoryTyping) return categoryOptions
    const q = category.trim().toLowerCase()
    if (!q) return categoryOptions
    return categoryOptions.filter((opt) => opt.toLowerCase().includes(q))
  }, [category, categoryOptions, isCategoryTyping])

  // Close category dropdown on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        categoryContainerRef.current &&
        !categoryContainerRef.current.contains(e.target as Node)
      ) {
        setIsCategoryOpen(false)
        setIsCategoryTyping(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setDate(getTodayIso())
      setChequeNo('')
      setPettyCashCategory('')
      setParticulars('')
      setAmount('')
      setDayRemark('')
      setDayRemarkTouched(false)
      const pm = initialPaymentMethod || 'Cash'
      setPaymentMethod(pm)
      if (pm.trim().toLowerCase() === 'petty cash') {
        setCategory('Petty Cash')
      } else {
        setCategory(DEFAULT_EXPENSE_CATEGORIES[1] || 'Rendered Fee')
      }
      setIsCategoryOpen(false)
      setIsCategoryTyping(false)
      setIsReviewing(false)
      setIsSubmitting(false)
      setError('')
      setFieldErrors({})
    }
  }, [open, initialPaymentMethod])

  // Prefill with the existing day remark for the chosen date (until the user edits it)
  React.useEffect(() => {
    if (open && !dayRemarkTouched) setDayRemark(getDayRemark(assignedCompany, date))
  }, [open, date, assignedCompany, dayRemarkTouched, getDayRemark])

  // Pre-validate and show confirmation dialogue
  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isPettyCash && hasBankAccounts === false) {
      setError(`Ensure that you have a bank account associated with ${assignedCompany || 'this company'} before recording expenses.`)
      return
    }

    const errors: {
      date?: string
      particulars?: string
      amount?: string
      category?: string
    } = {}

    const todayIso = getTodayIso()
    if (!date.trim()) {
      errors.date = 'Date is required.'
    } else if (date.trim() > todayIso) {
      errors.date = 'Expense date cannot be in the future (maximum date is today).'
    }

    if (isPettyCash) {
      if (!pettyCashCategory.trim() && !particulars.trim()) {
        errors.particulars = 'Please select a petty cash category or enter particulars.'
      }
    } else if (!particulars.trim()) {
      errors.particulars = 'Particulars is required.'
    }

    // Amount validation: strictly positive numeric value, no letters, no negative
    const cleanAmount = amount.trim().replace(/,/g, '')
    if (!cleanAmount) {
      errors.amount = 'Withdrawal amount is required.'
    } else if (/[a-zA-Z]/.test(cleanAmount) || !/^\d+(\.\d{1,2})?$/.test(cleanAmount)) {
      errors.amount = 'Withdrawal amount must be a valid positive number without letters.'
    } else {
      const numAmount = parseFloat(cleanAmount)
      if (isNaN(numAmount) || numAmount < 1.0) {
        errors.amount = 'Withdrawal amount must be at least ₱1.00 (cannot be zero or negative).'
      }
    }

    if (!category.trim()) {
      errors.category = 'Please choose or type a specific category.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields.')
      return
    }

    setFieldErrors({})
    setIsReviewing(true)
  }

  // Confirmed submission
  const handleConfirmedSubmit = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      const parsedAmount = parseFloat(amount.replace(/,/g, ''))
      const catTrimmed = isPettyCash
        ? 'Petty Cash'
        : (category.trim() || DEFAULT_EXPENSE_CATEGORIES[1] || 'Rendered Fee')
      if (catTrimmed && !categoryOptions.includes(catTrimmed)) {
        expenseService.createCategory(catTrimmed).catch((e) => console.warn('Could not persist category:', e))
      }

      let finalParticulars = particulars.trim()
      if (isPettyCash && pettyCashCategory.trim()) {
        finalParticulars = finalParticulars
          ? `${pettyCashCategory.trim()} - ${finalParticulars}`
          : pettyCashCategory.trim()
      }

      const payload: NewExpenseInput = {
        date: date.trim() || getTodayIso(),
        chequeNo: chequeNo.trim() || undefined,
        particulars: finalParticulars,
        amount: parsedAmount,
        category: catTrimmed,
        paymentMethod: paymentMethod,
        company: assignedCompany,
        status: 'Paid',
      }
      const created = await expenseService.addExpense(payload)

      // Optional day remark: one note for the whole day, not per transaction
      if (dayRemarkTouched && dayRemark.trim() !== getDayRemark(assignedCompany, payload.date).trim()) {
        try {
          await saveDayRemark(assignedCompany, payload.date, dayRemark)
        } catch (e) {
          console.warn('Could not save day remark:', e)
        }
      }

      if (finalParticulars && assignedCompany) {
        particularsService
          .addParticular(assignedCompany, finalParticulars, 'Expense')
          .catch(() => {})
        particularsService.invalidateCache(assignedCompany, 'Expense')
      }

      setIsReviewing(false)
      onOpenChange(false)
      onSuccess(created)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to record expense entry.'))
      setIsReviewing(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* 1. Main Add Expense Modal */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[540px] w-full max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl">
          <DialogHeader className="text-left pb-4 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                  Record New Expense
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
                  Enter expense outflow record for {assignedCompany}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handlePreSubmit} className="space-y-4 pt-2">
            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {!isPettyCash && hasBankAccounts === false && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Ensure that you have a bank account associated with this company before recording expenses.</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* 1. Date (editable, defaults to today) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="date"
                  max={getTodayIso()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value)
                    if (fieldErrors.date) {
                      setFieldErrors((prev) => ({ ...prev, date: undefined }))
                    }
                  }}
                  className={cn(
                    'h-10 rounded-xl border-stroke/50 text-xs font-medium',
                    fieldErrors.date && 'border-red-500 focus-visible:ring-red-200'
                  )}
                  title="Transaction date (cannot be in the future)"
                />
                {fieldErrors.date ? (
                  <p className="text-[11px] text-red-600 font-medium">{fieldErrors.date}</p>
                ) : (
                  <p className="text-[11px] text-muted-fg font-normal">
                    Defaults to today (Max: today)
                  </p>
                )}
              </div>

              {/* 2. Cheque No (Optional) */}
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs font-semibold text-focus block">
                  Cheque No. (Optional)
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. CHK-99201"
                  value={chequeNo}
                  maxLength={50}
                  onChange={(e) => setChequeNo(e.target.value)}
                  className="h-10 rounded-xl border-stroke/50 text-xs font-mono"
                />
              </div>
            </div>

            {isPettyCash ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 3. Particulars (Manual text input) */}
                <div className="space-y-1.5 min-w-0">
                  <Label className="text-xs font-semibold text-focus block">
                    Particulars <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    list="expense-particular-list"
                    placeholder="e.g. Taxi fare to bank, Bond paper A4..."
                    value={particulars}
                    maxLength={255}
                    onChange={(e) => {
                      setParticulars(e.target.value)
                      if (fieldErrors.particulars) {
                        setFieldErrors((prev) => ({ ...prev, particulars: undefined }))
                      }
                    }}
                    className={cn(
                      'h-10 rounded-xl border-stroke/50 text-xs',
                      fieldErrors.particulars && 'border-red-500 focus-visible:ring-red-200'
                    )}
                  />
                  {fieldErrors.particulars && (
                    <p className="text-[11px] text-red-600 font-medium">
                      {fieldErrors.particulars}
                    </p>
                  )}
                </div>

                {/* Pre-defined Petty Cash Category dropdown: placed next to particulars, not on top */}
                <div className="space-y-1.5 min-w-0">
                  <Label className="text-xs font-semibold text-focus block">
                    Petty Cash Category <span className="text-red-500">*</span>
                  </Label>
                  <Dropdown
                    value={pettyCashCategory}
                    onChange={(val) => {
                      setPettyCashCategory(String(val))
                      if (fieldErrors.particulars) {
                        setFieldErrors((prev) => ({ ...prev, particulars: undefined }))
                      }
                    }}
                    placeholder="-- Select Pre-defined Category --"
                    options={PREDEFINED_PETTY_CASH_CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
                    aria-label="Pre-defined Category"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs font-semibold text-focus block">
                  Particulars <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  list="expense-particular-list"
                  placeholder="e.g. Commercial Kitchen Gas & Utility Bill"
                  value={particulars}
                  maxLength={255}
                  onChange={(e) => {
                    setParticulars(e.target.value)
                    if (fieldErrors.particulars) {
                      setFieldErrors((prev) => ({ ...prev, particulars: undefined }))
                    }
                  }}
                  className={cn(
                    'h-10 rounded-xl border-stroke/50 text-xs',
                    fieldErrors.particulars && 'border-red-500 focus-visible:ring-red-200'
                  )}
                />
                {fieldErrors.particulars && (
                  <p className="text-[11px] text-red-600 font-medium">
                    {fieldErrors.particulars}
                  </p>
                )}
              </div>
            )}

            <datalist id="expense-particular-list">
              {particularOptions.map((opt) => (
                <option key={opt.id} value={opt.name} />
              ))}
            </datalist>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* 4. Withdrawal Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Withdrawal Amount (₱) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="expense-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onKeyDown={(e) => {
                    // Block minus, plus, exponent keys
                    if (['-', '+', 'e', 'E'].includes(e.key)) {
                      e.preventDefault()
                    }
                  }}
                  onChange={(e) => {
                    // Allow only digits and a single decimal point
                    const val = e.target.value
                    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
                      setAmount(val)
                      if (fieldErrors.amount) setFieldErrors((p) => ({ ...p, amount: undefined }))
                    }
                  }}
                  className={cn(
                    'h-10 rounded-xl border-stroke/50 text-xs font-medium',
                    fieldErrors.amount && 'border-red-500 focus-visible:ring-red-200'
                  )}
                />
                {fieldErrors.amount && (
                  <p className="text-[11px] text-red-600 font-medium">{fieldErrors.amount}</p>
                )}
              </div>

              {/* 5. Payment Method */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Payment Method <span className="text-red-500">*</span>
                </Label>
                <Dropdown
                  value={paymentMethod}
                  onChange={(val) => {
                    const newPm = String(val)
                    setPaymentMethod(newPm)
                    if (newPm.trim().toLowerCase() === 'petty cash') {
                      setCategory('Petty Cash')
                    } else if (category.trim().toLowerCase() === 'petty cash') {
                      setCategory(DEFAULT_EXPENSE_CATEGORIES[1] || 'Rendered Fee')
                    }
                  }}
                  options={PAYMENT_METHOD_OPTIONS.map((pm) => ({ value: pm, label: pm }))}
                  aria-label="Payment Method"
                />
                {isPettyCash && pettyBalance !== null && (
                  <p
                    className={cn(
                      'text-[11px] font-medium',
                      exceedsPettyCash ? 'text-amber-600' : 'text-muted-fg'
                    )}
                  >
                    Petty cash available: <span className="font-semibold">{formatPHP(pettyBalance)}</span>
                    {exceedsPettyCash && ' (Wallet will show deficit until topped up)'}
                  </p>
                )}
              </div>
            </div>

            {/* 6. Category (Searchable Dropdown; hidden when Payment Method is Petty Cash since category is auto-set to Petty Cash and specific categories are selected above) */}
            {!isPettyCash && (
              <div className="space-y-1.5" ref={categoryContainerRef}>
                <Label className="text-xs font-semibold text-focus block">
                  Category <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search or enter category..."
                    value={category}
                    onChange={(e) => {
                      const newCat = e.target.value
                      setCategory(newCat)
                      setIsCategoryTyping(true)
                      setIsCategoryOpen(true)
                      if (newCat.trim().toLowerCase() === 'petty cash') {
                        setPaymentMethod('Petty Cash')
                      }
                      if (fieldErrors.category) {
                        setFieldErrors((prev) => ({ ...prev, category: undefined }))
                      }
                    }}
                    onFocus={(e) => {
                      setIsCategoryTyping(false)
                      setIsCategoryOpen(true)
                      e.currentTarget.select()
                    }}
                    onClick={() => {
                      if (!isCategoryOpen) {
                        setIsCategoryTyping(false)
                        setIsCategoryOpen(true)
                      }
                    }}
                    className={cn(
                      'h-10 rounded-xl border-stroke/50 text-xs pr-8 font-medium',
                      fieldErrors.category && 'border-red-500 focus-visible:ring-red-200'
                    )}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setIsCategoryTyping(false)
                      setIsCategoryOpen((prev) => !prev)
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-1 cursor-pointer"
                    aria-label="Toggle category options"
                  >
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isCategoryOpen && "rotate-180")} />
                  </button>

                  {isCategoryOpen && (
                    <div
                      onMouseDown={(e) => e.preventDefault()}
                      className="absolute z-50 left-0 right-0 bottom-full mb-1.5 bg-white border border-stroke/40 rounded-xl shadow-xl max-h-52 overflow-y-auto p-1.5"
                    >
                      <div className="px-2 py-1 text-[10px] font-bold text-muted-fg uppercase tracking-wider flex items-center justify-between">
                        <span>Specific Categories</span>
                        {isCategoryTyping && category.trim() && (
                          <span className="text-[10px] text-slate-400 font-normal">
                            {filteredCategoryOptions.length} match{filteredCategoryOptions.length === 1 ? '' : 'es'}
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {filteredCategoryOptions.length > 0 ? (
                          filteredCategoryOptions.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                setCategory(opt)
                                setIsCategoryTyping(false)
                                setIsCategoryOpen(false)
                                if (opt.trim().toLowerCase() === 'petty cash') {
                                  setPaymentMethod('Petty Cash')
                                }
                                if (fieldErrors.category) {
                                  setFieldErrors((prev) => ({ ...prev, category: undefined }))
                                }
                              }}
                              className={cn(
                                'w-full text-left px-3 py-1.5 text-xs rounded-lg flex items-center justify-between transition-colors cursor-pointer',
                                category.toLowerCase() === opt.toLowerCase()
                                  ? 'bg-primary/10 text-primary font-semibold'
                                  : 'hover:bg-slate-100 text-focus'
                              )}
                            >
                              <span>{opt}</span>
                              {category.toLowerCase() === opt.toLowerCase() && <Check className="w-3.5 h-3.5" />}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-left">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-focus break-all">"{category.trim()}"</span>
                              <span className="text-[10px] uppercase font-bold text-slate-600 bg-slate-200/80 px-1.5 py-0.5 rounded">
                                Custom
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-fg mt-0.5">
                              Will be saved as a new category.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {fieldErrors.category && (
                  <p className="text-[11px] text-red-600 font-medium">
                    {fieldErrors.category}
                  </p>
                )}
              </div>
            )}

            {/* Day remarks */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus flex items-center justify-between">
                <span>Day Remarks (Optional)</span>
                <span className="text-[11px] text-muted-fg font-normal">Applies to all expenses on this date</span>
              </Label>
              <Input
                placeholder="e.g. Approved receipts attached, vouchers #..."
                value={dayRemark}
                onChange={(e) => {
                  setDayRemarkTouched(true)
                  setDayRemark(e.target.value)
                }}
                maxLength={255}
                className="h-10 rounded-xl border-stroke/60 text-xs text-focus placeholder:text-muted-fg/60 focus-visible:ring-1 focus-visible:ring-[#960C01]"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-stroke/15">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-10 px-4 rounded-xl border-stroke/60 text-xs font-medium cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={exceedsPettyCash}
                className="h-10 px-6 rounded-xl bg-[#960C01] hover:bg-[#800a01] text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Add Expense
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Confirmation Dialogue */}
      <ConfirmModal
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Confirm Expense Record"
        description="Please review and confirm this expense transaction entry before saving."
        confirmLabel="Confirm & Add"
        variant="primary"
        actionType="add"
        onConfirm={handleConfirmedSubmit}
        isLoading={isSubmitting}
        loadingLabel="Recording…"
      >
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-fg font-medium">Company</span>
            <span className="font-semibold text-focus">{assignedCompany}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-fg font-medium">Date</span>
            <span className="font-semibold text-focus">{date}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-fg font-medium">Particulars</span>
            <span className="font-semibold text-focus max-w-[220px] truncate text-right">
              {particulars}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-fg font-medium">Payment Method</span>
            <span className="font-semibold text-focus">{paymentMethod}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-fg font-medium">Category</span>
            <span className="font-semibold text-focus">{category}</span>
          </div>
          {chequeNo && (
            <div className="flex items-center justify-between">
              <span className="text-muted-fg font-medium">Cheque No.</span>
              <span className="font-mono font-semibold text-focus">{chequeNo}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-2.5 border-t border-slate-200">
            <span className="font-bold text-focus">Total Withdrawal Amount</span>
            <span className="font-bold text-rose-600 text-base">
              {formatPHP(parseFloat(amount.replace(/,/g, '')) || 0)}
            </span>
          </div>
        </div>
      </ConfirmModal>
    </>
  )
}
