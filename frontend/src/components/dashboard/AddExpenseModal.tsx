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
import { FormFieldError } from '@/components/common/FormFieldError'
import { Button } from '@/components/ui/button'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PlusCircle,
  Plus,
  Trash2,
  Pencil,
  RotateCw,
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
import { categoryService, type CompanyCategory } from '@/services/categoryService'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { pettyCashService } from '@/services/pettyCashService'
import { bankService } from '@/services/bankService'
import { CompanyBankSelect } from '@/components/common/CompanyBankSelect'
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
  const [bankAccountId, setBankAccountId] = React.useState('')

  // Company Category states (ReimbursementModal pattern)
  const [category, setCategory] = React.useState(
    (initialPaymentMethod || '').trim().toLowerCase() === 'petty cash'
      ? 'Petty Cash'
      : ''
  )
  const [companyCategories, setCompanyCategories] = React.useState<CompanyCategory[]>([])
  const [isLoadingCategories, setIsLoadingCategories] = React.useState(false)
  const [isAddingCategory, setIsAddingCategory] = React.useState(false)
  const [isCategoryManaging, setIsCategoryManaging] = React.useState(false)
  const [newCategoryName, setNewCategoryName] = React.useState('')
  const [editingCategoryId, setEditingCategoryId] = React.useState<number | null>(null)
  const [editingCategoryName, setEditingCategoryName] = React.useState('')
  const [isSubmittingCategory, setIsSubmittingCategory] = React.useState(false)
  const [categoryError, setCategoryError] = React.useState('')

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

  // Fetch company-specific categories from database
  React.useEffect(() => {
    let isMounted = true
    if (open && assignedCompany && !isPettyCash) {
      setIsLoadingCategories(true)
      categoryService
        .getCompanyCategories(assignedCompany, 'expense', { forceRefresh: true })
        .then((cats) => {
          if (isMounted) {
            setCompanyCategories(cats)
            if (cats.length > 0) {
              setCategory((prev) => {
                if (prev && cats.some((c) => c.name.toLowerCase() === prev.toLowerCase())) {
                  return prev
                }
                return cats[0].name
              })
            } else {
              setCategory('')
            }
          }
        })
        .catch(() => {
          if (isMounted) setCompanyCategories([])
        })
        .finally(() => {
          if (isMounted) setIsLoadingCategories(false)
        })
    } else if (isPettyCash) {
      setCategory('Petty Cash')
      setCompanyCategories([])
    }
    return () => {
      isMounted = false
    }
  }, [open, assignedCompany, isPettyCash])

  const handleCreateCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      setCategoryError('Category name cannot be empty.')
      return
    }
    setIsSubmittingCategory(true)
    setCategoryError('')
    try {
      const created = await categoryService.createCompanyCategory(assignedCompany, 'expense', trimmed)
      const updated = [...companyCategories, created]
      setCompanyCategories(updated)
      setCategory(created.name)
      setNewCategoryName('')
      setIsAddingCategory(false)
      if (fieldErrors.category) {
        setFieldErrors((prev) => ({ ...prev, category: undefined }))
      }
    } catch (err: any) {
      setCategoryError(err.message || 'Failed to create category.')
    } finally {
      setIsSubmittingCategory(false)
    }
  }

  const handleUpdateCategory = async (catId: number) => {
    const trimmed = editingCategoryName.trim()
    if (!trimmed) return
    try {
      const updatedCat = await categoryService.updateCompanyCategory(catId, trimmed, assignedCompany, 'expense')
      setCompanyCategories((prev) =>
        prev.map((c) => (c.category_id === catId ? updatedCat : c))
      )
      if (category.toLowerCase() === companyCategories.find((c) => c.category_id === catId)?.name.toLowerCase()) {
        setCategory(updatedCat.name)
      }
      setEditingCategoryId(null)
      setEditingCategoryName('')
    } catch (err: any) {
      alert(err.message || 'Failed to update category.')
    }
  }

  const handleDeleteCategory = async (catId: number, catName: string) => {
    if (!window.confirm(`Are you sure you want to delete category "${catName}"?`)) return
    try {
      await categoryService.deleteCompanyCategory(catId, assignedCompany, 'expense')
      const updated = companyCategories.filter((c) => c.category_id !== catId)
      setCompanyCategories(updated)
      if (category.toLowerCase() === catName.toLowerCase()) {
        setCategory(updated.length > 0 ? updated[0].name : '')
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete category.')
    }
  }

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
      setBankAccountId('')
      setIsAddingCategory(false)
      setIsCategoryManaging(false)
      setNewCategoryName('')
      setEditingCategoryId(null)
      setCategoryError('')
      const pm = initialPaymentMethod || 'Cash'
      setPaymentMethod(pm)
      if (pm.trim().toLowerCase() === 'petty cash') {
        setCategory('Petty Cash')
      } else {
        setCategory('')
      }
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

    if (!isPettyCash && (!category.trim() || companyCategories.length === 0)) {
      errors.category = 'Please add and select an expense category for this company.'
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
      const catTrimmed = isPettyCash ? 'Petty Cash' : category.trim()

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
        bankAccountId: !isPettyCash ? (bankAccountId || undefined) : undefined,
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

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (isReviewing) {
                handleConfirmedSubmit()
              } else {
                handlePreSubmit(e)
              }
            }}
            className="space-y-4 pt-2"
          >
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

            {isReviewing ? (
              <ModalReviewStep
                title="Review Expense Record"
                subtitle="Please verify this expense transaction entry before saving."
                errorMessage={error}
                items={[
                  { label: 'Company', value: assignedCompany, highlight: true },
                  { label: 'Date', value: date },
                  { label: 'Particulars', value: (isPettyCash && pettyCashCategory ? `${pettyCashCategory} - ${particulars}` : particulars) || 'None' },
                  { label: 'Payment Method', value: paymentMethod },
                  { label: 'Category', value: isPettyCash ? 'Petty Cash' : category },
                  ...(chequeNo ? [{ label: 'Cheque No.', value: chequeNo }] : []),
                  { label: 'Total Withdrawal Amount', value: formatPHP(parseFloat(amount.replace(/,/g, '')) || 0), isCurrency: true },
                ]}
              />
            ) : (
              <>
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
                <FormFieldError error={fieldErrors.date} />
                {!fieldErrors.date && (
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
                  <FormFieldError error={fieldErrors.particulars} />
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
                <FormFieldError error={fieldErrors.particulars} />
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
                <FormFieldError error={fieldErrors.amount} />
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
                      setCategory(companyCategories[0]?.name || '')
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

            {/* Bank account selection (hidden for petty cash) */}
            {!isPettyCash && (
              <CompanyBankSelect
                company={assignedCompany}
                value={bankAccountId}
                onChange={setBankAccountId}
                label="Disbursement Bank"
                required
                onAccountsLoaded={(accounts) => {
                  if (accounts.length > 0 && !bankAccountId) {
                    setBankAccountId(String(accounts[0].id))
                  }
                }}
              />
            )}

            {/* 6. Category (Configurable per company - ReimbursementModal pattern; hidden when Payment Method is Petty Cash) */}
            {!isPettyCash && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-focus">
                    Category <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    {companyCategories.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCategoryManaging((prev) => !prev)
                          setIsAddingCategory(false)
                        }}
                        className="text-[11px] font-semibold text-muted-fg hover:text-focus transition-colors cursor-pointer"
                      >
                        {isCategoryManaging ? 'Done' : 'Manage'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingCategory((prev) => !prev)
                        setIsCategoryManaging(false)
                        setCategoryError('')
                        setNewCategoryName('')
                      }}
                      className="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{isAddingCategory ? 'Cancel' : 'Add Category'}</span>
                    </button>
                  </div>
                </div>

                {/* Inline Add Category Input */}
                {isAddingCategory && (
                  <div className="p-2.5 rounded-xl border border-primary/30 bg-primary/5 space-y-2 animate-in fade-in-50 duration-150">
                    <div className="text-[11px] font-bold text-focus">
                      New Category for <span className="text-primary">{assignedCompany}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        placeholder="e.g. Office Supplies, Travel..."
                        value={newCategoryName}
                        onChange={(e) => {
                          setNewCategoryName(e.target.value)
                          if (categoryError) setCategoryError('')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleCreateCategory()
                          }
                        }}
                        className="h-8 rounded-lg text-xs bg-white border-stroke/50 flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={isSubmittingCategory || !newCategoryName.trim()}
                        onClick={handleCreateCategory}
                        className="h-8 px-3 rounded-lg text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer"
                      >
                        {isSubmittingCategory ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                    {categoryError && (
                      <p className="text-[11px] text-red-600 font-medium">{categoryError}</p>
                    )}
                  </div>
                )}

                {/* Category Management List (Edit / Delete) */}
                {isCategoryManaging && (
                  <div className="p-2.5 rounded-xl border border-stroke/40 bg-slate-50 space-y-2 max-h-48 overflow-y-auto">
                    <div className="text-[11px] font-bold text-focus uppercase tracking-wider">
                      Manage {assignedCompany} Expense Categories
                    </div>
                    <div className="space-y-1">
                      {companyCategories.map((cat) => (
                        <div
                          key={cat.category_id}
                          className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-white border border-stroke/30 text-xs"
                        >
                          {editingCategoryId === cat.category_id ? (
                            <div className="flex items-center gap-1.5 flex-1">
                              <Input
                                type="text"
                                value={editingCategoryName}
                                onChange={(e) => setEditingCategoryName(e.target.value)}
                                className="h-7 text-xs flex-1"
                              />
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleUpdateCategory(cat.category_id)}
                                className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingCategoryId(null)}
                                className="h-7 px-2 text-[11px] cursor-pointer"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <>
                              <span className="font-medium text-focus truncate">{cat.name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCategoryId(cat.category_id)
                                    setEditingCategoryName(cat.name)
                                  }}
                                  className="p-1 text-slate-500 hover:text-focus transition-colors cursor-pointer"
                                  title="Edit category"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCategory(cat.category_id, cat.name)}
                                  className="p-1 text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                                  title="Delete category"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Category Dropdown */}
                {companyCategories.length > 0 ? (
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value)
                      if (fieldErrors.category) {
                        setFieldErrors((prev) => ({ ...prev, category: undefined }))
                      }
                    }}
                    className={cn(
                      'w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer',
                      fieldErrors.category && 'border-red-500 focus:ring-red-200'
                    )}
                  >
                    <option value="" disabled>
                      Select an expense category
                    </option>
                    {companyCategories.map((cat) => (
                      <option key={cat.category_id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-800 text-xs">
                    <p className="font-semibold">No expense categories configured for {assignedCompany}.</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Click "+ Add Category" above to create the first category for this company.
                    </p>
                  </div>
                )}

                <FormFieldError error={fieldErrors.category} />
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

            </>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-stroke/20">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (isReviewing) {
                  setIsReviewing(false)
                } else {
                  onOpenChange(false)
                }
              }}
              disabled={isSubmitting}
              className="h-11 px-5 rounded-[10px] text-xs sm:text-sm font-semibold cursor-pointer"
            >
              {isReviewing ? 'Back to Edit' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || exceedsPettyCash}
              isLoading={isSubmitting}
              className="h-11 px-6 rounded-[10px] text-xs sm:text-sm font-semibold cursor-pointer"
            >
              <span>{isReviewing ? 'Add Expense' : 'Review Expense'}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
