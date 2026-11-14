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
  salesService,
  type NewSalesInput,
  type SalesItem,
} from '@/services/salesService'
import {
  particularsService,
  type CompanyParticular,
} from '@/services/particularsService'
import { categoryService, type CompanyCategory } from '@/services/categoryService'
import { bankService } from '@/services/bankService'
import { CompanyBankSelect } from '@/components/common/CompanyBankSelect'
import { receivablesStore, type PaymentOption, type CustomerType } from '@/services/receivablesStore'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { useDailyRemarks } from '@/hooks/useDailyRemarks'

interface AddSalesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (newItem: SalesItem) => void
  assignedCompany: string
}

const PAYMENT_METHOD_OPTIONS = [
  'Cash',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'Cheque',
  'Bank Transfer',
  'In-house',
]

export const AddSalesModal: React.FC<AddSalesModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  assignedCompany,
}) => {
  // Date default is today (editable)
  const getTodayIso = () => formatToYYYYMMDD(new Date())

  const [date, setDate] = React.useState(getTodayIso())
  const [chequeNo, setChequeNo] = React.useState('')
  const [particulars, setParticulars] = React.useState('')
  const [particularOptions, setParticularOptions] = React.useState<CompanyParticular[]>([])
  const [amount, setAmount] = React.useState('')
  const [dayRemark, setDayRemark] = React.useState('')
  const [dayRemarkTouched, setDayRemarkTouched] = React.useState(false)
  const { getRemark: getDayRemark, saveRemark: saveDayRemark } = useDailyRemarks('sales', [assignedCompany])
  const [paymentMethod, setPaymentMethod] = React.useState('Cash')
  const [bankAccountId, setBankAccountId] = React.useState('')

  // Company Category states (ReimbursementModal pattern)
  const [category, setCategory] = React.useState('')
  const [companyCategories, setCompanyCategories] = React.useState<CompanyCategory[]>([])
  const [isLoadingCategories, setIsLoadingCategories] = React.useState(false)
  const [isAddingCategory, setIsAddingCategory] = React.useState(false)
  const [isCategoryManaging, setIsCategoryManaging] = React.useState(false)
  const [newCategoryName, setNewCategoryName] = React.useState('')
  const [editingCategoryId, setEditingCategoryId] = React.useState<number | null>(null)
  const [editingCategoryName, setEditingCategoryName] = React.useState('')
  const [isSubmittingCategory, setIsSubmittingCategory] = React.useState(false)
  const [categoryError, setCategoryError] = React.useState('')

  // Food Utang / Payment Option states
  const [paymentOption, setPaymentOption] = React.useState<PaymentOption>('Paid in full')
  const [customerType, setCustomerType] = React.useState<CustomerType>('External')
  const [customerName, setCustomerName] = React.useState('')
  const [amountPaid, setAmountPaid] = React.useState('')

  // Confirmation dialogue state
  const [isReviewing, setIsReviewing] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    date?: string
    particulars?: string
    amount?: string
    category?: string
    customerName?: string
    amountPaid?: string
  }>({})

  // Load company-specific categories from database
  React.useEffect(() => {
    let mounted = true
    if (open && assignedCompany) {
      setIsLoadingCategories(true)
      categoryService
        .getCompanyCategories(assignedCompany, 'sales', { forceRefresh: true })
        .then((cats) => {
          if (mounted) {
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
          if (mounted) setCompanyCategories([])
        })
        .finally(() => {
          if (mounted) setIsLoadingCategories(false)
        })
    } else {
      setCompanyCategories([])
      setCategory('')
    }
    return () => {
      mounted = false
    }
  }, [open, assignedCompany])

  const handleCreateCategory = async () => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) {
      setCategoryError('Category name cannot be empty.')
      return
    }
    setIsSubmittingCategory(true)
    setCategoryError('')
    try {
      const created = await categoryService.createCompanyCategory(assignedCompany, 'sales', trimmed)
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
      const updatedCat = await categoryService.updateCompanyCategory(catId, trimmed, assignedCompany, 'sales')
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
      await categoryService.deleteCompanyCategory(catId, assignedCompany, 'sales')
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
        .getParticulars(assignedCompany, 'Sales')
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


  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setDate(getTodayIso())
      setChequeNo('')
      setParticulars('')
      setAmount('')
      setDayRemark('')
      setDayRemarkTouched(false)
      setPaymentMethod('Cash')
      setBankAccountId('')
      setIsAddingCategory(false)
      setIsCategoryManaging(false)
      setNewCategoryName('')
      setEditingCategoryId(null)
      setEditingCategoryName('')
      setCategoryError('')
      setPaymentOption('Paid in full')
      setCustomerType('External')
      setCustomerName('')
      setAmountPaid('')
      setError('')
      setFieldErrors({})
      setIsReviewing(false)
    }
  }, [open])

  // Prefill with the existing day remark for the chosen date (until the user edits it)
  React.useEffect(() => {
    if (open && !dayRemarkTouched) setDayRemark(getDayRemark(assignedCompany, date))
  }, [open, date, assignedCompany, dayRemarkTouched, getDayRemark])

  // Step 1: Pre-validate and show confirmation dialogue
  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (hasBankAccounts === false) {
      setError(`Ensure that you have a bank account associated with ${assignedCompany || 'this company'} before recording sales.`)
      return
    }

    const errors: { date?: string; particulars?: string; amount?: string; category?: string; customerName?: string; amountPaid?: string } = {}

    if (paymentOption !== 'Paid in full') {
      if (!customerName.trim()) {
        errors.customerName = 'Customer or staff name is required for credit / utang sales.'
      }
      if (paymentOption === 'Partial') {
        const parsedPaid = parseFloat(amountPaid)
        const parsedTot = parseFloat(amount)
        if (!amountPaid.trim() || isNaN(parsedPaid) || parsedPaid <= 0) {
          errors.amountPaid = 'Amount paid must be greater than 0.'
        } else if (parsedPaid >= parsedTot) {
          errors.amountPaid = 'For partial payment, amount paid must be less than total amount.'
        }
      }
    }

    const todayIso = getTodayIso()
    if (!date.trim()) {
      errors.date = 'Date is required.'
    } else if (date.trim() > todayIso) {
      errors.date = 'Date cannot be in the future (maximum date is today).'
    }

    if (!particulars.trim()) {
      errors.particulars = 'Particulars is required.'
    }

    const parsedAmount = parseFloat(amount)
    if (!amount.trim()) {
      errors.amount = 'Amount is required.'
    } else if (isNaN(parsedAmount) || parsedAmount < 1.0) {
      errors.amount = 'Amount must be at least 1.00 (cannot be 0 or less than 1).'
    }

    if (!category.trim() || companyCategories.length === 0) {
      errors.category = 'Please add and select a category for this company.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields.')
      return
    }

    setFieldErrors({})
    setIsReviewing(true)
  }

  // Step 2: Confirmed submission
  const handleConfirmedSubmit = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      const parsedAmount = parseFloat(amount.replace(/,/g, ''))
      const catTrimmed = category.trim()
      const effectiveStatus = paymentOption === 'Paid in full' ? 'Paid' : paymentOption === 'Partial' ? 'Pending' : 'Unpaid'

      const payload: NewSalesInput = {
        date: date.trim() || getTodayIso(),
        chequeNo: chequeNo.trim(),
        particulars: particulars.trim(),
        amount: parsedAmount,
        category: catTrimmed,
        paymentMethod: paymentMethod,
        company: assignedCompany,
        bankAccountId: bankAccountId || undefined,
        status: effectiveStatus as any,
        depositStatus: effectiveStatus === 'Paid' && (paymentMethod === 'Cash' || paymentMethod !== 'GCash') ? 'Deposited' : 'Not Deposited',
        deposit_status: effectiveStatus === 'Paid' && (paymentMethod === 'Cash' || paymentMethod !== 'GCash') ? 'Deposited' : 'Not Deposited',
      }
      const created = await salesService.addSale(payload)

      // Optional day remark: one note for the whole day, not per transaction
      if (dayRemarkTouched && dayRemark.trim() !== getDayRemark(assignedCompany, payload.date).trim()) {
        try {
          await saveDayRemark(assignedCompany, payload.date, dayRemark)
        } catch (e) {
          console.warn('Could not save day remark:', e)
        }
      }

      if (particulars.trim() && assignedCompany) {
        particularsService
          .addParticular(assignedCompany, particulars.trim(), 'Sales')
          .catch(() => {})
        particularsService.invalidateCache(assignedCompany, 'Sales')
      }

      // Only record in receivables if there is an unpaid balance (Utang / Partial)
      if (paymentOption !== 'Paid in full') {
        const parsedSaleId = created?.id ? Number(created.id) : undefined
        receivablesStore.addNewSale({
          customer_name: customerName.trim() || 'Walk-in Customer',
          customer_type: customerType,
          items_summary: particulars.trim(),
          total_amount: parsedAmount,
          payment_option: paymentOption,
          amount_paid: paymentOption === 'Partial' ? (parseFloat(amountPaid) || 0) : 0,
          payment_method: (paymentMethod === 'GCash' ? 'GCash' : paymentMethod === 'Bank Transfer' ? 'Bank' : 'Cash') as any,
          date: date.trim() || getTodayIso(),
          notes: chequeNo.trim() ? `Cheque: ${chequeNo.trim()}` : undefined,
          company: assignedCompany,
          sale_id: Number.isFinite(parsedSaleId) ? parsedSaleId : undefined,
        })
      }

      // Close confirmation and modal
      setIsReviewing(false)
      onOpenChange(false)

      // Trigger callback to redirect & highlight newly added row in table
      onSuccess(created)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to record sales entry.'))
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
                  Record New Sale
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
                  Enter sales inflow record for {assignedCompany}
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

            {hasBankAccounts === false && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Ensure that you have a bank account associated with this company before recording sales.</span>
              </div>
            )}

            {isReviewing ? (
              <ModalReviewStep
                title="Review Sales Record"
                subtitle="Please verify this sales transaction entry before saving."
                errorMessage={error}
                items={[
                  { label: 'Company', value: assignedCompany, highlight: true },
                  { label: 'Date', value: date },
                  { label: 'Particulars', value: particulars || 'None' },
                  { label: 'Payment Method', value: paymentMethod },
                  { label: 'Category', value: category },
                  ...(chequeNo ? [{ label: 'Cheque No.', value: chequeNo }] : []),
                  ...(paymentOption !== 'Paid in full' ? [
                    { label: 'Customer / Staff', value: customerName || 'Walk-in Customer' },
                    { label: 'Customer Type', value: customerType },
                    { label: 'Payment Option', value: paymentOption },
                    ...(paymentOption === 'Partial' ? [{ label: 'Amount Paid Now', value: formatPHP(parseFloat(amountPaid) || 0), isCurrency: true }] : []),
                  ] : []),
                  { label: 'Total Deposit Amount', value: formatPHP(parseFloat(amount) || 0), isCurrency: true },
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

              {/* 2. Cheque No (no icon in label) */}
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs font-semibold text-focus block">
                  Cheque No. (Optional)
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. CHQ-8899"
                  value={chequeNo}
                  maxLength={50}
                  onChange={(e) => setChequeNo(e.target.value)}
                  className="h-10 rounded-xl border-stroke/50 text-xs font-mono"
                />
              </div>
            </div>

            {/* 3. Particulars (no 'Notes', no icon in label, required asterisk) */}
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs font-semibold text-focus block">
                Particulars <span className="text-red-500">*</span>
              </Label>
              <Input
                type="text"
                list="sales-particular-list"
                placeholder="e.g. Corporate Banquet Catering Deposit"
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
              <datalist id="sales-particular-list">
                {particularOptions.map((opt) => (
                  <option key={opt.id} value={opt.name} />
                ))}
              </datalist>
              <FormFieldError error={fieldErrors.particulars} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* 4. Amount (no icon in label, required asterisk) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Amount (PHP) <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="1.00"
                  placeholder="1.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    if (fieldErrors.amount) {
                      setFieldErrors((prev) => ({ ...prev, amount: undefined }))
                    }
                  }}
                  className={cn(
                    'h-10 rounded-xl border-stroke/50 text-xs font-semibold tabular-nums',
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
                  onChange={(val) => setPaymentMethod(String(val))}
                  options={PAYMENT_METHOD_OPTIONS.map((pm) => ({ value: pm, label: pm }))}
                  aria-label="Payment Method"
                />
              </div>
            </div>

            {/* Payment Option: Paid in full | Partial | Pay Later (Utang) */}
            <div className="space-y-2.5 p-3.5 bg-slate-50/90 rounded-2xl border border-slate-200/80">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-focus block">
                  Payment Option <span className="text-red-500">*</span>
                </Label>
                <span className="text-[11px] text-muted-fg font-medium">
                  {paymentOption === 'Paid in full' ? 'Cash collected in full' : paymentOption === 'Partial' ? 'Partial down payment' : 'Utang (Pay later)'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['Paid in full', 'Partial', 'Pay Later'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setPaymentOption(opt)
                      if (opt === 'Paid in full') {
                        setAmountPaid(amount)
                      } else if (opt === 'Pay Later') {
                        setAmountPaid('0')
                      }
                    }}
                    className={cn(
                      'py-2 px-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer',
                      paymentOption === opt
                        ? opt === 'Paid in full'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : opt === 'Partial'
                            ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                            : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              {/* If Partial or Pay Later, require Customer / Staff Member */}
              {paymentOption !== 'Paid in full' && (
                <div className="mt-3 space-y-3 pt-3 border-t border-slate-200/80">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700 block">
                        Customer Type <span className="text-red-500">*</span>
                      </Label>
                      <Dropdown
                        value={customerType}
                        size="sm"
                        onChange={(val) => setCustomerType(val as 'External' | 'Staff')}
                        options={[
                          { value: 'External', label: 'External Customer' },
                          { value: 'Staff', label: 'Internal Staff' },
                        ]}
                        aria-label="Customer Type"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-700 block">
                        {customerType === 'Staff' ? 'Staff Member Name' : 'Customer Name'} <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="text"
                        placeholder={customerType === 'Staff' ? 'e.g. Maria Santos (Kitchen)' : 'e.g. Mang Jose Mercado'}
                        value={customerName}
                        maxLength={100}
                        onChange={(e) => {
                          setCustomerName(e.target.value)
                          if (fieldErrors.customerName) {
                            setFieldErrors((prev) => ({ ...prev, customerName: undefined }))
                          }
                        }}
                        className={cn('h-9 rounded-lg border-stroke/50 text-xs', fieldErrors.customerName && 'border-red-500')}
                      />
                      <FormFieldError error={fieldErrors.customerName} />
                    </div>
                  </div>

                  {paymentOption === 'Partial' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-700 block">
                          Amount Paid Now (PHP) <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max={amount || undefined}
                          placeholder="0.00"
                          value={amountPaid}
                          onChange={(e) => {
                            setAmountPaid(e.target.value)
                            if (fieldErrors.amountPaid) {
                              setFieldErrors((prev) => ({ ...prev, amountPaid: undefined }))
                            }
                          }}
                          className={cn('h-9 rounded-lg border-stroke/50 text-xs font-semibold tabular-nums', fieldErrors.amountPaid && 'border-red-500')}
                        />
                        <FormFieldError error={fieldErrors.amountPaid} />
                      </div>

                      <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
                        <span className="text-muted-fg block text-[10px]">Remaining Utang:</span>
                        <span className="text-sm font-bold text-rose-600">
                          {formatPHP(Math.max(0, (parseFloat(amount) || 0) - (parseFloat(amountPaid) || 0)))}
                        </span>
                      </div>
                    </div>
                  )}

                  {paymentOption === 'Pay Later' && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                      Entire amount of {formatPHP(parseFloat(amount) || 0)} will be added as outstanding utang for {customerName || 'customer'}.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 6. Deposit Bank */}
            <CompanyBankSelect
              company={assignedCompany}
              value={bankAccountId}
              onChange={setBankAccountId}
              label="Deposit Bank"
              required
              onAccountsLoaded={(accounts) => {
                if (accounts.length > 0 && !bankAccountId) {
                  setBankAccountId(String(accounts[0].id))
                }
              }}
            />

            {/* 7. Category (Configurable per company - ReimbursementModal pattern) */}
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
                      placeholder="e.g. Food Sales, Catering..."
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

              {/* Manage / Delete / Edit Existing Categories List */}
              {isCategoryManaging && companyCategories.length > 0 && (
                <div className="p-2 rounded-xl border border-stroke/40 bg-slate-50 space-y-1.5 max-h-48 overflow-y-auto">
                  <div className="text-[11px] font-semibold text-muted-fg px-1 pb-1 border-b border-stroke/20">
                    Manage {assignedCompany} Categories
                  </div>
                  {companyCategories.map((cat) => (
                    <div
                      key={cat.category_id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs bg-white border border-stroke/20 gap-2"
                    >
                      {editingCategoryId === cat.category_id ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <Input
                            type="text"
                            value={editingCategoryName}
                            onChange={(e) => setEditingCategoryName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleUpdateCategory(cat.category_id)
                              }
                            }}
                            className="h-7 text-xs flex-1 bg-white"
                            autoFocus
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2 text-[10px] bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer"
                            onClick={() => handleUpdateCategory(cat.category_id)}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[10px] cursor-pointer"
                            onClick={() => setEditingCategoryId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="font-medium text-focus truncate flex-1">{cat.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategoryId(cat.category_id)
                                setEditingCategoryName(cat.name)
                              }}
                              className="p-1 text-slate-400 hover:text-focus rounded cursor-pointer transition-colors"
                              title={`Edit ${cat.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat.category_id, cat.name)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
                              title={`Delete ${cat.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Category Dropdown or Empty Warning */}
              {isLoadingCategories ? (
                <div className="h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 flex items-center text-xs text-muted-fg">
                  <RotateCw className="w-3.5 h-3.5 animate-spin mr-2" />
                  <span>Loading categories for {assignedCompany}…</span>
                </div>
              ) : companyCategories.length === 0 ? (
                <div className="p-3 rounded-xl border border-amber-300 bg-amber-50/70 text-amber-900 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Please add categories</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    No sales categories configured for {assignedCompany}. Click "Add Category" above to create one.
                  </p>
                </div>
              ) : (
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    if (fieldErrors.category) {
                      setFieldErrors((prev) => ({ ...prev, category: undefined }))
                    }
                  }}
                  className={cn(
                    'w-full h-10 px-3 rounded-xl border bg-white text-xs font-medium text-focus shadow-2xs focus-visible:ring-1 focus-visible:ring-focus outline-none cursor-pointer',
                    fieldErrors.category ? 'border-red-500 ring-1 ring-red-500' : 'border-stroke/50'
                  )}
                >
                  <option value="" disabled>Select a category…</option>
                  {companyCategories.map((cat) => (
                    <option key={cat.category_id} value={cat.name}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              )}

              <FormFieldError error={fieldErrors.category} />
            </div>

            {/* Day remarks */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus flex items-center justify-between">
                <span>Day Remarks (Optional)</span>
                <span className="text-[11px] text-muted-fg font-normal">Applies to all sales on this date</span>
              </Label>
              <Input
                placeholder="e.g. Verified deposit slip, walk-in collection..."
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
              disabled={isSubmitting}
              isLoading={isSubmitting}
              className="h-11 px-6 rounded-[10px] text-xs sm:text-sm font-semibold cursor-pointer"
            >
              <span>{isReviewing ? 'Add Sales' : 'Review Sales'}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
