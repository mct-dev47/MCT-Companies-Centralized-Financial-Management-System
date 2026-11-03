import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PlusCircle,
  ChevronDown,
  Check,
  AlertCircle,
  Building2,
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import {
  loanService,
  type NewLoanInput,
  type LoanItem,
  type CompanyOption,
} from '@/services/loanService'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'

interface AddLoanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (newItem: LoanItem) => void
  assignedCompany: string
  companies?: string[]
}


export const AddLoanModal: React.FC<AddLoanModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  assignedCompany,
  companies: propsCompanies,
}) => {
  const { user } = useSession()
  const { activeCompany, dbCompanies: contextDbCompanies } = useCompany()
  const userRole = (user?.role || '').toLowerCase()
  const isFinanceUser = userRole === 'finance' || userRole === 'admin'
  const isCompanyUser = !isFinanceUser

  const [dbCompanies, setDbCompanies] = React.useState<CompanyOption[]>(() => {
    if (contextDbCompanies && contextDbCompanies.length > 0) {
      return contextDbCompanies.map((c) => ({
        company_id: c.company_id ?? c.id,
        company_name: c.company_name ?? c.name,
      }))
    }
    return []
  })

  // Fetch companies from DB or context cache
  React.useEffect(() => {
    let mounted = true
    if (contextDbCompanies && contextDbCompanies.length > 0) {
      setDbCompanies(
        contextDbCompanies.map((c) => ({
          company_id: c.company_id ?? c.id,
          company_name: c.company_name ?? c.name,
        }))
      )
    } else {
      loanService.getCompanies().then((res) => {
        if (mounted && res.length > 0) {
          setDbCompanies(res)
        }
      })
    }
    return () => {
      mounted = false
    }
  }, [contextDbCompanies])

  const allCompanyNames = React.useMemo(() => {
    if (dbCompanies.length > 0) {
      return dbCompanies.map((c) => c.company_name)
    }
    if (propsCompanies && propsCompanies.length > 0) {
      return propsCompanies.filter((c) => c !== 'All Companies')
    }
    return []
  }, [dbCompanies, propsCompanies])

  const defaultBorrower = React.useMemo(() => {
    if (activeCompany && activeCompany !== 'All Companies') {
      return activeCompany
    }
    if (assignedCompany && assignedCompany !== 'All Companies') {
      return assignedCompany
    }
    return allCompanyNames[0] || ''
  }, [activeCompany, assignedCompany, allCompanyNames])

  const handleBorrowerChange = (newBorrower: string) => {
    setBorrowerCompany(newBorrower)
    if (fieldErrors.borrower) {
      setFieldErrors((p) => ({ ...p, borrower: undefined }))
    }
    if (lenderCompany.toLowerCase() === newBorrower.toLowerCase()) {
      const remaining = allCompanyNames.filter(
        (co) => co.toLowerCase() !== newBorrower.toLowerCase()
      )
      setLenderCompany(remaining[0] || '')
    }
  }

  const [date, setDate] = React.useState(formatToYYYYMMDD(new Date()))
  const [interestRate, setInterestRate] = React.useState('0')
  const [particulars, setParticulars] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [borrowerCompany, setBorrowerCompany] = React.useState(defaultBorrower)
  const [lenderCompany, setLenderCompany] = React.useState('')

  const [isLenderOpen, setIsLenderOpen] = React.useState(false)
  const lenderRef = React.useRef<HTMLDivElement>(null)

  // Confirmation dialogue state
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    date?: string
    particulars?: string
    amount?: string
    borrower?: string
    lender?: string
  }>({})

  // Lender options cannot include the chosen borrower
  const availableLenders = React.useMemo(() => {
    return allCompanyNames.filter(
      (c) => c.toLowerCase() !== borrowerCompany.toLowerCase()
    )
  }, [allCompanyNames, borrowerCompany])

  // Close dropdowns on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (lenderRef.current && !lenderRef.current.contains(target)) {
        setIsLenderOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      const todayStr = formatToYYYYMMDD(new Date())
      setDate(todayStr)
      setInterestRate('0')
      setParticulars('')
      setAmount('')
      setBorrowerCompany(defaultBorrower)
      // Pick first eligible lender
      const eligible = allCompanyNames.filter(
        (c) => c.toLowerCase() !== defaultBorrower.toLowerCase()
      )
      setLenderCompany(eligible[0] || '')
      setIsLenderOpen(false)
      setIsConfirmOpen(false)
      setIsSubmitting(false)
      setError('')
      setFieldErrors({})
    }
  }, [open, defaultBorrower, allCompanyNames])

  // Pre-validate and show confirmation dialogue
  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const errors: typeof fieldErrors = {}

    const todayIso = formatToYYYYMMDD(new Date())
    if (!date.trim()) {
      errors.date = 'Date is required.'
    } else if (date.trim() > todayIso) {
      errors.date = 'Date cannot be in the future (maximum date is today).'
    }

    if (!particulars.trim()) {
      errors.particulars = 'Particulars description is required.'
    }

    if (!borrowerCompany.trim()) {
      errors.borrower = 'Borrower company is required.'
    }

    const cleanedAmount = amount.replace(/,/g, '').trim()
    const parsedAmount = parseFloat(cleanedAmount)
    if (!cleanedAmount || isNaN(parsedAmount) || parsedAmount < 1.0) {
      errors.amount = 'Amount must be at least 1.00 (cannot be 0 or letters).'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields.')
      return
    }

    setFieldErrors({})
    setIsConfirmOpen(true)
  }

  // Confirmed submission
  const handleConfirmedSubmit = async () => {
    setIsSubmitting(true)
    setError('')
    try {
      const parsedAmount = parseFloat(amount.replace(/,/g, ''))
      const chosenLender = isCompanyUser
        ? undefined
        : lenderCompany && lenderCompany.toLowerCase() !== borrowerCompany.toLowerCase()
        ? lenderCompany
        : undefined

      const payload: NewLoanInput = {
        date: date.trim() || formatToYYYYMMDD(new Date()),
        interestRate: isCompanyUser ? 0.0 : parseFloat(interestRate) || 0.0,
        particulars: particulars.trim(),
        amount: parsedAmount,
        borrowerCompany: borrowerCompany.trim(),
        lenderCompany: chosenLender,
        status: 'Pending Approval',
      }
      const created = await loanService.addLoan(payload)

      setIsConfirmOpen(false)
      onOpenChange(false)
      onSuccess(created)
    } catch (err: any) {
      setError(err?.message || 'Failed to record loan entry.')
      setIsConfirmOpen(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* 1. Main Add Loan Modal */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px] rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl [&>button]:top-4 [&>button]:right-4">
          <DialogHeader className="text-left pb-4 border-b border-stroke/20 pr-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#960C01] text-white flex items-center justify-center shrink-0 shadow-xs">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                  {isCompanyUser ? 'Request Inter-Company Loan' : 'Record Inter-Company Loan'}
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
                  {isCompanyUser
                    ? `Submit loan request for ${borrowerCompany}. Finance will review and fund.`
                    : `Borrowing facility for ${borrowerCompany}`}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* 1. Loan Date (extended to full width) */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label className="text-xs font-semibold text-focus block">
                  Loan Date <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    type="date"
                    value={date}
                    max={formatToYYYYMMDD(new Date())}
                    onChange={(e) => {
                      setDate(e.target.value)
                      if (fieldErrors.date) setFieldErrors((p) => ({ ...p, date: undefined }))
                    }}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    className={cn(
                      'h-10 px-3.5 py-0 text-xs sm:text-sm rounded-xl cursor-pointer w-full',
                      'flex items-center',
                      '[&::-webkit-calendar-picker-indicator]:cursor-pointer',
                      '[&::-webkit-calendar-picker-indicator]:opacity-70 hover:[&::-webkit-calendar-picker-indicator]:opacity-100',
                      '[&::-webkit-calendar-picker-indicator]:my-auto',
                      '[&::-webkit-calendar-picker-indicator]:h-4 [&::-webkit-calendar-picker-indicator]:w-4',
                      '[&::-webkit-calendar-picker-indicator]:transition-opacity',
                      fieldErrors.date && 'border-red-500'
                    )}
                    required
                  />
                </div>
                {fieldErrors.date && <p className="text-2xs text-red-500">{fieldErrors.date}</p>}
              </div>

              {/* 2. Borrower Company */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label className="text-xs font-semibold text-focus block">
                  Borrower Company <span className="text-red-500">*</span>
                </Label>
                {isFinanceUser ? (
                  <div className="relative">
                    <select
                      value={borrowerCompany}
                      onChange={(e) => handleBorrowerChange(e.target.value)}
                      className={cn(
                        'w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white text-xs sm:text-sm font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer',
                        fieldErrors.borrower && 'border-red-500'
                      )}
                    >
                      {allCompanyNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-focus/90 text-xs sm:text-sm font-medium flex items-center justify-between shadow-2xs select-none">
                    <div className="flex items-center gap-2 truncate">
                      <Building2 className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate font-semibold">{borrowerCompany}</span>
                    </div>
                    <span className="text-[11px] text-muted-fg font-normal px-2 py-0.5 rounded-md bg-white border border-stroke/30 shrink-0">
                      Automatic (Account)
                    </span>
                  </div>
                )}
                {fieldErrors.borrower && (
                  <p className="text-2xs text-red-500">{fieldErrors.borrower}</p>
                )}
              </div>

              {/* 4. Lender Company */}
              {isCompanyUser ? (
                <div className="space-y-1.5 col-span-1 sm:col-span-2">
                  <Label className="text-xs font-semibold text-focus block">
                    Lender Company
                  </Label>
                  <div className="h-10 px-3 rounded-xl border border-dashed border-stroke/70 bg-amber-50/50 text-focus text-xs sm:text-sm font-medium flex items-center justify-between shadow-2xs select-none">
                    <span className="italic text-muted-fg text-xs">
                      To be reviewed and chosen by Finance upon loan approval
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      Assigned by Finance
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 col-span-1 sm:col-span-2" ref={lenderRef}>
                  <Label className="text-xs font-semibold text-focus block">
                    Lender Company
                  </Label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsLenderOpen((prev) => !prev)}
                      className="w-full h-10 px-3 rounded-xl border border-stroke/60 bg-white hover:bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-2xs flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="truncate">{lenderCompany || 'Select Lender Company…'}</span>
                      </div>
                      <ChevronDown className="w-4 h-4 text-muted-fg shrink-0" />
                    </button>
                    {isLenderOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 max-h-52 overflow-y-auto">
                        {availableLenders.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setLenderCompany(c)
                              setIsLenderOpen(false)
                            }}
                            className={cn(
                              'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-left cursor-pointer',
                              lenderCompany === c ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-focus hover:bg-slate-50'
                            )}
                          >
                            <span>{c}</span>
                            {lenderCompany === c && <Check className="w-3.5 h-3.5 text-emerald-600 ml-2" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 5. Principal Amount */}
              <div className={cn("space-y-1.5", isCompanyUser ? "col-span-1 sm:col-span-2" : "col-span-1")}>
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

              {/* 6. Interest Rate (Admin/Finance only) */}
              {!isCompanyUser && (
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

              {/* 7. Particulars / Purpose */}
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold text-focus block">
                  Particulars / Purpose <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="text"
                  placeholder="e.g. Commercial Kitchen Heavy Equipment Financing"
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
                className="h-10 px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs sm:text-sm font-semibold shadow-xs cursor-pointer"
              >
                {isCompanyUser ? 'Submit Loan Request' : 'Record Loan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Confirmation Dialog */}
      <ConfirmModal
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Confirm Loan Submission"
        description="Please verify the inter-company loan details before submitting."
        confirmLabel="Confirm & Submit"
        cancelLabel="Back"
        variant="primary"
        actionType="submit"
        onConfirm={handleConfirmedSubmit}
        isLoading={isSubmitting}
        loadingLabel="Recording…"
      >
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2 my-2">
          <div className="flex justify-between">
            <span className="text-muted-fg font-medium">Borrower:</span>
            <span className="font-bold text-focus">{borrowerCompany}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-fg font-medium">Principal Amount:</span>
            <span className="font-bold text-emerald-600 tabular-nums">
              {formatPHP(parseFloat(amount.replace(/,/g, '')) || 0)}
            </span>
          </div>
          {isFinanceUser && (
            <div className="flex justify-between">
              <span className="text-muted-fg font-medium">Interest Rate:</span>
              <span className="font-bold text-primary">{parseFloat(interestRate) || 0}%</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-fg font-medium">Date:</span>
            <span className="font-medium text-focus">{date}</span>
          </div>
          <div className="pt-2 border-t border-slate-200">
            <span className="text-muted-fg block">Purpose:</span>
            <span className="font-medium text-focus italic">{particulars}</span>
          </div>
        </div>
        <p className="text-2xs text-muted-fg mt-2">
          * Note: This loan request will be placed in <strong>Pending Approval</strong> until confirmed by management.
        </p>
      </ConfirmModal>
    </>
  )
}
