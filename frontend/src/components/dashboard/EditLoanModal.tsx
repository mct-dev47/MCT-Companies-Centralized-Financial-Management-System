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
  Building2,
} from 'lucide-react'
import {
  loanService,
  type LoanItem,
  type CompanyOption,
} from '@/services/loanService'
import { useSession } from '@/hooks/useSession'
import { cn } from '@/lib/utils'

interface EditLoanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loan: LoanItem | null
  onSuccess: (updatedItem: LoanItem) => void
  companies?: string[]
}

export const EditLoanModal: React.FC<EditLoanModalProps> = ({
  open,
  onOpenChange,
  loan,
  onSuccess,
  companies: initialCompanies,
}) => {
  const { user } = useSession()
  const isFinanceUser = (user?.role || '').toLowerCase() === 'finance'
  const [dbCompanies, setDbCompanies] = React.useState<CompanyOption[]>([])
  const [date, setDate] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [interestRate, setInterestRate] = React.useState('0')
  const [particulars, setParticulars] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [lenderCompany, setLenderCompany] = React.useState('')
  const [isLenderDropdownOpen, setIsLenderDropdownOpen] = React.useState(false)
  const lenderContainerRef = React.useRef<HTMLDivElement>(null)

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    date?: string
    dueDate?: string
    amount?: string
    particulars?: string
    lender?: string
  }>({})

  // Fetch companies from backend DB
  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((res) => {
      if (mounted && res.length > 0) {
        setDbCompanies(res)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  const availableLenders = React.useMemo(() => {
    const list = dbCompanies.length > 0
      ? dbCompanies.map((c) => c.company_name)
      : (initialCompanies || []).filter((c) => c !== 'All Companies')

    // Lender cannot be the borrower
    const borrowerName = loan?.borrower || ''
    return list.filter((c) => c.toLowerCase() !== borrowerName.toLowerCase())
  }, [dbCompanies, initialCompanies, loan?.borrower])

  React.useEffect(() => {
    if (open && loan) {
      setDate(loan.rawDate || loan.date || '')
      setDueDate(loan.dueDate || '')
      setInterestRate(String(loan.interestRate ?? 0))
      setParticulars(loan.particulars || '')
      setAmount(String(loan.amount || ''))
      setLenderCompany(loan.lender || '')
      setIsLenderDropdownOpen(false)
      setIsSubmitting(false)
      setError('')
      setFieldErrors({})
    }
  }, [open, loan])

  // Click outside listener for dropdown
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        lenderContainerRef.current &&
        !lenderContainerRef.current.contains(e.target as Node)
      ) {
        setIsLenderDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loan) return
    setError('')
    const errors: typeof fieldErrors = {}

    if (!date.trim()) {
      errors.date = 'Date is required.'
    }

    if (!particulars.trim()) {
      errors.particulars = 'Particulars description is required.'
    }

    if (!lenderCompany.trim()) {
      errors.lender = 'Please select a lender company.'
    }

    const cleanedAmount = amount.replace(/,/g, '').trim()
    const parsedAmount = parseFloat(cleanedAmount)
    if (!cleanedAmount || isNaN(parsedAmount) || parsedAmount < 1.0) {
      errors.amount = 'Amount must be a valid positive number at least ₱1.00.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please resolve all validation errors before saving.')
      return
    }

    setIsSubmitting(true)
    try {
      const updated = await loanService.updateLoan(loan.id, {
        date: date.trim(),
        rawDate: date.trim(),
        dueDate: dueDate.trim() || undefined,
        interestRate: parseFloat(interestRate) || 0,
        amount: parsedAmount,
        particulars: particulars.trim(),
        lenderCompany: lenderCompany.trim(),
        lender: lenderCompany.trim(),
      })

      if (updated) {
        onSuccess(updated)
        onOpenChange(false)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update loan entry.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[660px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-4 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                Edit Loan Request
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
                Modifying pending loan for <span className="font-semibold text-focus">{loan?.borrower}</span>
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
            {/* 1. Loan Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Loan Date <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  if (fieldErrors.date) setFieldErrors((prev) => ({ ...prev, date: undefined }))
                }}
                className={cn('h-10 text-xs sm:text-sm rounded-xl', fieldErrors.date && 'border-red-500')}
                required
              />
              {fieldErrors.date && <p className="text-2xs text-red-500">{fieldErrors.date}</p>}
            </div>

            {/* 2. Due Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Due Date (Optional)
              </Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-10 text-xs sm:text-sm rounded-xl"
              />
            </div>

            {/* 3. Lender Company */}
            <div className="space-y-1.5 sm:col-span-2 relative" ref={lenderContainerRef}>
              <Label className="text-xs font-semibold text-focus block">
                Lender Company <span className="text-red-500">*</span>
              </Label>
              <button
                type="button"
                onClick={() => setIsLenderDropdownOpen((p) => !p)}
                className={cn(
                  'w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium flex items-center justify-between shadow-xs transition-colors cursor-pointer',
                  isLenderDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <Building2 className="w-4 h-4 text-muted-fg shrink-0" />
                  <span className="truncate">{lenderCompany || 'Select Lender Company'}</span>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-fg shrink-0" />
              </button>

              {isLenderDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-full bg-white rounded-xl border border-stroke/30 shadow-xl p-1.5 z-50 max-h-48 overflow-y-auto">
                  {availableLenders.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setLenderCompany(name)
                        setIsLenderDropdownOpen(false)
                        if (fieldErrors.lender) setFieldErrors((p) => ({ ...p, lender: undefined }))
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                        lenderCompany === name ? 'bg-primary/10 text-primary font-semibold' : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span className="truncate">{name}</span>
                      {lenderCompany === name && <Check className="w-3.5 h-3.5 text-primary ml-2 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
              {fieldErrors.lender && <p className="text-2xs text-red-500">{fieldErrors.lender}</p>}
            </div>

            {/* 4. Amount */}
            <div className={cn('space-y-1.5', !isFinanceUser && 'sm:col-span-2')}>
              <Label className="text-xs font-semibold text-focus block">
                Principal Amount (₱) <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg text-xs font-bold pointer-events-none">
                  ₱
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-'].includes(e.key)) {
                      e.preventDefault()
                    }
                  }}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '')
                    setAmount(val)
                    if (fieldErrors.amount) setFieldErrors((p) => ({ ...p, amount: undefined }))
                  }}
                  className={cn('pl-7 h-10 text-xs sm:text-sm rounded-xl tabular-nums', fieldErrors.amount && 'border-red-500')}
                  required
                />
              </div>
              {fieldErrors.amount && <p className="text-2xs text-red-500">{fieldErrors.amount}</p>}
            </div>

            {/* 5. Interest Rate (Finance only) */}
            {isFinanceUser && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Interest Rate (%)
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="0.0"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    className="pr-7 h-10 text-xs sm:text-sm rounded-xl tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg text-xs font-bold pointer-events-none">
                    %
                  </span>
                </div>
              </div>
            )}

            {/* 6. Particulars */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold text-focus block">
                Particulars / Purpose <span className="text-red-500">*</span>
              </Label>
              <Input
                type="text"
                placeholder="e.g. Commercial Kitchen Equipment Financing facility"
                value={particulars}
                onChange={(e) => {
                  setParticulars(e.target.value)
                  if (fieldErrors.particulars) setFieldErrors((p) => ({ ...p, particulars: undefined }))
                }}
                className={cn('h-10 text-xs sm:text-sm rounded-xl', fieldErrors.particulars && 'border-red-500')}
                required
              />
              {fieldErrors.particulars && <p className="text-2xs text-red-500">{fieldErrors.particulars}</p>}
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-10 px-5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs sm:text-sm font-semibold shadow-xs cursor-pointer"
            >
              {isSubmitting ? 'Saving Changes…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
