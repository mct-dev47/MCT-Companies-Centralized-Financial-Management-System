import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Pencil,
  ChevronDown,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import {
  salesService,
  type NewSalesInput,
  type SalesItem,
} from '@/services/salesService'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'

interface EditSalesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sale: SalesItem | null
  onSuccess: (updatedItem: SalesItem) => void
}

const CATEGORY_OPTIONS = [
  'None',
  'GCash',
  'Maya',
  'PayMongo',
  'Panda',
  'In-house',
  'Cheque',
  'Bank Transfer',
  'Cash',
]

export const EditSalesModal: React.FC<EditSalesModalProps> = ({
  open,
  onOpenChange,
  sale,
  onSuccess,
}) => {
  const [date, setDate] = React.useState('')
  const [chequeNo, setChequeNo] = React.useState('')
  const [particulars, setParticulars] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [category, setCategory] = React.useState('None')
  const [isCategoryOpen, setIsCategoryOpen] = React.useState(false)
  const categoryContainerRef = React.useRef<HTMLDivElement>(null)

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    date?: string
    particulars?: string
    amount?: string
    category?: string
  }>({})

  React.useEffect(() => {
    if (open && sale) {
      setDate(sale.rawDate || formatToYYYYMMDD(new Date()))
      setChequeNo(sale.chequeNo || '')
      setParticulars(sale.particulars || '')
      setAmount(String(sale.deposit || sale.netAmount || ''))
      setCategory(sale.category || 'None')
      setError('')
      setFieldErrors({})
    }
  }, [open, sale])

  const filteredCategoryOptions = React.useMemo(() => {
    const q = category.trim().toLowerCase()
    if (!q) return CATEGORY_OPTIONS
    return CATEGORY_OPTIONS.filter((opt) => opt.toLowerCase().includes(q))
  }, [category])

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        categoryContainerRef.current &&
        !categoryContainerRef.current.contains(e.target as Node)
      ) {
        setIsCategoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sale) return
    setError('')
    const errors: { date?: string; particulars?: string; amount?: string; category?: string } = {}

    const todayIso = new Date().toISOString().split('T')[0]
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

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields.')
      return
    }

    setFieldErrors({})
    setIsSubmitting(true)

    try {
      const payload: Partial<NewSalesInput> = {
        date: date.trim(),
        chequeNo: chequeNo.trim(),
        particulars: particulars.trim(),
        amount: parsedAmount,
        category: category.trim() || 'None',
      }
      const updated = await salesService.updateSale(sale.id, payload)
      onOpenChange(false)
      onSuccess(updated)
    } catch (err: any) {
      setError(err?.message || 'Failed to update sale.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!sale) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[660px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-4 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                Edit Sale Entry
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
                Update transaction details for {sale.refNo} ({sale.company})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Date <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                max={new Date().toISOString().split('T')[0]}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  if (fieldErrors.date) setFieldErrors((prev) => ({ ...prev, date: undefined }))
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
                  Max: today
                </p>
              )}
            </div>

            {/* Cheque No */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Cheque No. (Optional)
              </Label>
              <Input
                type="text"
                placeholder="e.g. CHQ-8899"
                value={chequeNo}
                onChange={(e) => setChequeNo(e.target.value)}
                className="h-10 rounded-xl border-stroke/50 text-xs font-mono"
              />
            </div>
          </div>

          {/* Particulars */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-focus block">
              Particulars <span className="text-red-500">*</span>
            </Label>
            <Input
              type="text"
              placeholder="e.g. Catering Deposit"
              value={particulars}
              onChange={(e) => {
                setParticulars(e.target.value)
                if (fieldErrors.particulars) setFieldErrors((prev) => ({ ...prev, particulars: undefined }))
              }}
              className={cn(
                'h-10 rounded-xl border-stroke/50 text-xs',
                fieldErrors.particulars && 'border-red-500 focus-visible:ring-red-200'
              )}
            />
            {fieldErrors.particulars && (
              <p className="text-[11px] text-red-600 font-medium">{fieldErrors.particulars}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Amount */}
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
                  if (fieldErrors.amount) setFieldErrors((prev) => ({ ...prev, amount: undefined }))
                }}
                className={cn(
                  'h-10 rounded-xl border-stroke/50 text-xs font-semibold tabular-nums',
                  fieldErrors.amount && 'border-red-500 focus-visible:ring-red-200'
                )}
              />
              {fieldErrors.amount && (
                <p className="text-[11px] text-red-600 font-medium">{fieldErrors.amount}</p>
              )}
            </div>

            {/* Category */}
            <div className="space-y-1.5" ref={categoryContainerRef}>
              <Label className="text-xs font-semibold text-focus block">
                Category
              </Label>
              <div className="relative">
                <Input
                  type="text"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setIsCategoryOpen(true)
                  }}
                  onFocus={() => setIsCategoryOpen(true)}
                  placeholder="Select category…"
                  className="h-10 rounded-xl border-stroke/50 text-xs pr-8 font-medium bg-white"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIsCategoryOpen((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5 rounded cursor-pointer transition-colors"
                >
                  <ChevronDown className={cn('w-4 h-4 transition-transform duration-200', isCategoryOpen && 'rotate-180')} />
                </button>

                {isCategoryOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 max-h-52 overflow-y-auto">
                    <div className="space-y-0.5">
                      {filteredCategoryOptions.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setCategory(opt)
                            setIsCategoryOpen(false)
                          }}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-medium text-left transition-colors cursor-pointer',
                            category.toLowerCase() === opt.toLowerCase()
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'text-focus/80 hover:bg-slate-50'
                          )}
                        >
                          <span>{opt}</span>
                          {category.toLowerCase() === opt.toLowerCase() && (
                            <Check className="w-3.5 h-3.5 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-5 text-xs font-medium rounded-xl border-stroke/50"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-10 px-6 text-xs font-semibold rounded-xl bg-primary hover:bg-primary/90 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
