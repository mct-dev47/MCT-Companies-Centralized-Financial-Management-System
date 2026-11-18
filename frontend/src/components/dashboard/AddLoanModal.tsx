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
  ChevronDown,
  Check,
  AlertCircle,
  Building2,
  Landmark,
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import {
  loanService,
  type NewLoanInput,
  type LoanItem,
  type CompanyOption,
} from '@/services/loanService'
import { bankService, isAccountOwnedBy, preferSoleOwnedBanks, type BankAccount } from '@/services/bankService'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

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
  const [borrowerBankId, setBorrowerBankId] = React.useState('')
  const [isBorrowerBankOpen, setIsBorrowerBankOpen] = React.useState(false)
  const borrowerBankRef = React.useRef<HTMLDivElement>(null)
  const [lenderCompany, setLenderCompany] = React.useState('')

  const [isLenderOpen, setIsLenderOpen] = React.useState(false)
  const lenderRef = React.useRef<HTMLDivElement>(null)
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>([])

  // Confirmation dialogue state
  const [isReviewing, setIsReviewing] = React.useState(false)
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
      if (borrowerBankRef.current && !borrowerBankRef.current.contains(target)) {
        setIsBorrowerBankOpen(false)
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
      setBorrowerBankId('')
      setIsBorrowerBankOpen(false)
      // Pick first eligible lender
      const eligible = allCompanyNames.filter(
        (c) => c.toLowerCase() !== defaultBorrower.toLowerCase()
      )
      setLenderCompany(eligible[0] || '')
      setIsLenderOpen(false)
      setIsReviewing(false)
      setIsSubmitting(false)
      setError('')
      setFieldErrors({})

      let mounted = true
      setBankAccounts(bankService.getCachedAccounts() || [])
      bankService
        .getAccounts()
        .then((accounts) => {
          if (mounted) setBankAccounts(accounts || [])
        })
        .catch(() => {})
      return () => {
        mounted = false
      }
    }
  }, [open, defaultBorrower, allCompanyNames])

  const borrowerBankAccounts = React.useMemo(() => {
    if (!borrowerCompany) return []
    const owned = bankAccounts.filter((acc) => isAccountOwnedBy(acc, borrowerCompany))
    return preferSoleOwnedBanks(owned, borrowerCompany)
  }, [bankAccounts, borrowerCompany])

  React.useEffect(() => {
    if (borrowerBankAccounts.length === 0) {
      if (borrowerBankId) setBorrowerBankId('')
      return
    }
    const stillValid = borrowerBankAccounts.some((acc) => acc.id === borrowerBankId)
    if (!stillValid) {
      setBorrowerBankId(borrowerBankAccounts[0].id)
    }
  }, [borrowerBankAccounts, borrowerBankId])

  const selectedBorrowerBank = React.useMemo(
    () => borrowerBankAccounts.find((acc) => acc.id === borrowerBankId) || null,
    [borrowerBankAccounts, borrowerBankId]
  )

  const getCompanyBankSummary = React.useCallback(
    (companyName: string) => {
      const accounts = bankAccounts.filter((acc) => isAccountOwnedBy(acc, companyName))
      const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.currentBalance || 0), 0)
      return { accounts, totalBalance }
    },
    [bankAccounts]
  )

  // Pre-validate and show confirmation dialogue
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    if (!isReviewing) {
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
      setIsReviewing(true)
      return
    }

    await handleConfirmedSubmit()
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
        borrowerBankAccountId: borrowerBankId || undefined,
        status: 'Pending Approval',
      }
      const created = await loanService.addLoan(payload)

      setIsReviewing(false)
      onOpenChange(false)
      onSuccess(created)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to record loan entry.'))
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

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {isReviewing ? (
              <ModalReviewStep
                variant="neutral"
                title={isCompanyUser ? 'Review Loan Request Details' : 'Review Loan Issuance Details'}
                subtitle="Please verify inter-company loan terms before issuing."
                errorMessage={error}
                items={[
                  { label: 'Borrower', value: borrowerCompany, highlight: true },
                  ...(selectedBorrowerBank
                    ? [{ label: 'Receiving Bank', value: `${selectedBorrowerBank.bankName} • ${selectedBorrowerBank.accountName}` }]
                    : []),
                  { label: 'Principal Amount', value: formatPHP(parseFloat(amount.replace(/,/g, '')) || 0), isCurrency: true },
                  ...(isFinanceUser ? [{ label: 'Interest Rate', value: `${parseFloat(interestRate) || 0}%` }] : []),
                  { label: 'Start Date', value: date },
                  { label: 'Particulars / Purpose', value: particulars || 'None' },
                ]}
              />
            ) : (
              <>
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
                <FormFieldError error={fieldErrors.date} />
              </div>

              {/* 2. Borrower Company */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2">
                <Label className="text-xs font-semibold text-focus block">
                  Borrower Company <span className="text-red-500">*</span>
                </Label>
                {isFinanceUser ? (
                  <div className="relative">
                    <Dropdown
                      value={borrowerCompany}
                      onChange={(val) => handleBorrowerChange(String(val))}
                      options={allCompanyNames.map((name) => ({ value: name, label: name }))}
                      error={fieldErrors.borrower}
                      aria-label="Borrower Company"
                    />
                  </div>
                ) : (
                  <div className="h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-focus/90 text-xs sm:text-sm font-medium flex items-center justify-between shadow-2xs select-none">
                    <div className="flex items-center gap-2 truncate">
                      <Building2 className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate font-semibold">{borrowerCompany}</span>
                    </div>  
                  </div>
                )}
                <FormFieldError error={fieldErrors.borrower} />
              </div>

              {/* 3. Receiving Bank Account (Borrower's Destination Bank) */}
              <div className="space-y-1.5 col-span-1 sm:col-span-2" ref={borrowerBankRef}>
                <Label className="text-xs font-semibold text-focus block">
                  Receiving Bank Account
                </Label>
                {borrowerBankAccounts.length === 0 ? (
                  <div className="h-10 px-3 rounded-xl border border-dashed border-stroke/60 bg-slate-50 text-muted-fg text-xs flex items-center gap-2 select-none">
                    <Landmark className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>No registered bank accounts for {borrowerCompany || 'this company'}</span>
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsBorrowerBankOpen((prev) => !prev)}
                      className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-stroke/60 bg-white hover:bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-2xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Landmark className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate">
                          {selectedBorrowerBank
                            ? `${selectedBorrowerBank.bankName} • ${selectedBorrowerBank.accountName}`
                            : 'Select Receiving Bank Account…'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {selectedBorrowerBank && (
                          <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80">
                            {formatPHP(selectedBorrowerBank.currentBalance)}
                          </span>
                        )}
                        <ChevronDown className="w-4 h-4 text-muted-fg shrink-0" />
                      </div>
                    </button>
                    {isBorrowerBankOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 max-h-60 overflow-y-auto space-y-1">
                        {borrowerBankAccounts.map((acc) => {
                          const isSelected = acc.id === borrowerBankId
                          return (
                            <button
                              key={acc.id}
                              type="button"
                              onClick={() => {
                                setBorrowerBankId(acc.id)
                                setIsBorrowerBankOpen(false)
                              }}
                              className={cn(
                                'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs text-left cursor-pointer border border-transparent transition-colors',
                                isSelected
                                  ? 'bg-blue-50/90 text-blue-900 border-blue-200/70'
                                  : 'text-focus hover:bg-slate-50'
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 font-semibold truncate">
                                  <span>{acc.bankName}</span>
                                  <span className="text-slate-400 font-normal">•</span>
                                  <span className="truncate">{acc.accountName}</span>
                                </div>
                                <div className="text-[11px] text-muted-fg flex items-center gap-2 mt-0.5">
                                  <span>{acc.accountType}</span>
                                  <span>•</span>
                                  <span className="font-medium text-slate-700">
                                    {formatPHP(acc.currentBalance)}
                                  </span>
                                </div>
                              </div>
                              {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
                      className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-stroke/60 bg-white hover:bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-2xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="truncate">{lenderCompany || 'Select Lender Company…'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {lenderCompany && (
                          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/70">
                            {formatPHP(getCompanyBankSummary(lenderCompany).totalBalance)}
                          </span>
                        )}
                        <ChevronDown className="w-4 h-4 text-muted-fg shrink-0" />
                      </div>
                    </button>
                    {isLenderOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 max-h-64 overflow-y-auto space-y-1">
                        {availableLenders.map((c) => {
                          const { accounts, totalBalance } = getCompanyBankSummary(c)
                          const isSelected = lenderCompany === c
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                setLenderCompany(c)
                                setIsLenderOpen(false)
                              }}
                              className={cn(
                                'w-full flex flex-col gap-1 px-3 py-2 rounded-xl text-xs text-left cursor-pointer border border-transparent transition-colors',
                                isSelected
                                  ? 'bg-emerald-50/90 text-emerald-900 border-emerald-200/70'
                                  : 'text-focus hover:bg-slate-50'
                              )}
                            >
                              <div className="flex items-center justify-between gap-2 w-full">
                                <span className={cn('font-semibold', isSelected ? 'text-emerald-900' : 'text-focus')}>
                                  {c}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[11px] font-bold text-emerald-700">
                                    {formatPHP(totalBalance)}
                                  </span>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                                </div>
                              </div>
                              {accounts.length > 0 ? (
                                <div className="pl-2 border-l-2 border-slate-200 space-y-0.5 mt-0.5">
                                  {accounts.map((acc) => (
                                    <div
                                      key={acc.id}
                                      className="flex items-center justify-between gap-2 text-[11px] text-muted-fg"
                                    >
                                      <span className="flex items-center gap-1 truncate">
                                        <Landmark className="w-3 h-3 text-slate-400 shrink-0" />
                                        <span className="truncate">
                                          {acc.bankName} • {acc.accountName}
                                        </span>
                                      </span>
                                      <span className="font-medium text-slate-700 shrink-0">
                                        {formatPHP(acc.currentBalance)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10.5px] text-muted-fg italic pl-2">
                                  No registered bank accounts
                                </span>
                              )}
                            </button>
                          )
                        })}
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
                <FormFieldError error={fieldErrors.amount} />
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
                <FormFieldError error={fieldErrors.particulars} />
              </div>
            </div>

            </>
          )}

          {/* Action buttons - Standard Phase 2 Layout */}
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
              <span>{isReviewing ? 'Submit Loan' : (isCompanyUser ? 'Request Loan' : 'Record Loan')}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
