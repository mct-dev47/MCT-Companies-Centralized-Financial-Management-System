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
  CheckCircle2,
  AlertCircle,
  Building2,
  ChevronDown,
  Check,
  ShieldCheck,
  Landmark,
  Clock,
} from 'lucide-react'
import {
  loanService,
  type LoanItem,
} from '@/services/loanService'
import {
  bankService,
  type BankAccount,
} from '@/services/bankService'
import { formatPHP } from '@/lib/format'
import { formatCreatedAt } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

interface ApproveLoanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loan: LoanItem | null
  onSuccess: (approvedLoan: LoanItem) => void
  companies?: string[]
}

export const ApproveLoanModal: React.FC<ApproveLoanModalProps> = ({
  open,
  onOpenChange,
  loan,
  onSuccess,
}) => {
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>([])
  const [selectedBankId, setSelectedBankId] = React.useState('')
  const [interestRate, setInterestRate] = React.useState('0')
  const [dueDate, setDueDate] = React.useState('')
  const [isBankDropdownOpen, setIsBankDropdownOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [remark, setRemark] = React.useState('')
  const bankDropdownRef = React.useRef<HTMLDivElement>(null)

  // Fetch all registered bank accounts
  React.useEffect(() => {
    let mounted = true
    bankService.getAccounts().then((accounts) => {
      if (mounted && accounts) {
        setBankAccounts(accounts)
      }
    }).catch(() => {})
    return () => {
      mounted = false
    }
  }, [open])

  // Filter out bank accounts belonging to the borrower company so borrower does not fund itself
  const eligibleBanks = React.useMemo(() => {
    if (!loan) return bankAccounts
    const borrowerNorm = (loan.borrower || '').trim().toLowerCase()
    return bankAccounts.filter((acc) => {
      const cNorm = (acc.companyName || '').trim().toLowerCase()
      return cNorm !== borrowerNorm
    })
  }, [bankAccounts, loan])

  const selectedBank = React.useMemo(() => {
    if (selectedBankId) {
      const match = eligibleBanks.find((b) => b.id === selectedBankId)
      if (match) return match
    }
    return eligibleBanks[0] || null
  }, [eligibleBanks, selectedBankId])

  // Reset modal state when opened
  React.useEffect(() => {
    if (open && loan) {
      setError('')
      setRemark('')
      setIsSubmitting(false)
      setIsBankDropdownOpen(false)
      setInterestRate(String(loan.interestRate || 0))
      setDueDate(loan.dueDate || '')

      if (loan.bankAccountId) {
        setSelectedBankId(loan.bankAccountId)
      } else if (eligibleBanks.length > 0) {
        setSelectedBankId(eligibleBanks[0].id)
      } else {
        setSelectedBankId('')
      }
    }
  }, [open, loan, eligibleBanks])

  // Close dropdown on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        bankDropdownRef.current &&
        !bankDropdownRef.current.contains(e.target as Node)
      ) {
        setIsBankDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!loan) return null

  const handleEndorse = async () => {
    setError('')
    if (!selectedBank) {
      setError('Please choose a bank account to disburse this loan.')
      return
    }

    if (
      (selectedBank.companyName || '').trim().toLowerCase() ===
      (loan.borrower || '').trim().toLowerCase()
    ) {
      setError('Lender bank company cannot be the same as the borrower company.')
      return
    }

    if (!remark.trim()) {
      setError('A finance endorsement remark is required.')
      return
    }

    setIsSubmitting(true)
    try {
      const parsedInterest = parseFloat(interestRate) || 0
      const endorsed = await loanService.endorseLoan(loan.id, {
        action: 'endorse',
        bankAccountId: selectedBank.id,
        interestRate: parsedInterest,
        dueDate: dueDate.trim() || undefined,
        remark: remark.trim(),
      })
      onSuccess(endorsed)
      onOpenChange(false)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to endorse loan request.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    setError('')
    if (!remark.trim()) {
      setError('Please provide a reason / remark for rejecting this loan.')
      return
    }

    setIsSubmitting(true)
    try {
      const rejected = await loanService.endorseLoan(loan.id, {
        action: 'reject',
        remark: remark.trim(),
      })
      onSuccess(rejected)
      onOpenChange(false)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to reject loan request.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg sm:text-xl font-bold text-focus leading-tight">
                Finance Review & Endorse Loan
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg font-normal">
                Assign funding bank and endorse loan request from{' '}
                <span className="font-semibold text-focus">{loan.borrower}</span> to Internal Audit
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Loan Request Summary Card */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Borrower (Requester):</span>
              <span className="font-bold text-focus flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-primary" />
                {loan.borrower}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Requested Principal:</span>
              <span className="font-bold text-emerald-600 text-sm tabular-nums">
                {formatPHP(loan.amount)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-fg font-medium">Request Date:</span>
              <div className="text-right">
                <span className="font-medium text-focus">{loan.date}</span>
                {loan.createdAt && (
                  <span className="text-[11px] text-slate-500 font-normal flex items-center justify-end gap-1 mt-0.5">
                    <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                    <span>Created: {formatCreatedAt(loan.createdAt)}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="pt-2 border-t border-slate-200/60">
              <span className="text-muted-fg block mb-0.5">Purpose / Particulars:</span>
              <p className="font-medium text-focus italic">{loan.particulars}</p>
            </div>
          </div>

          {/* FINANCE DECISION CONTROLS */}
          <div className="space-y-3.5 pt-1">
            {/* 1. Choose Funding Bank Account */}
            <div className="space-y-1.5" ref={bankDropdownRef}>
              <Label className="text-xs font-semibold text-focus flex items-center justify-between">
                <span>
                  Choose Bank <span className="text-red-500">*</span>
                </span>
                <span className="text-[11px] text-muted-fg font-normal">
                  (Bank account to deduct upon audit approval)
                </span>
              </Label>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsBankDropdownOpen((prev) => !prev)}
                  className={cn(
                    'w-full min-h-[44px] px-3 py-2 rounded-xl border border-stroke/60 bg-white hover:bg-slate-50 text-focus text-xs font-medium shadow-2xs flex items-center justify-between transition-colors cursor-pointer text-left',
                    isBankDropdownOpen && 'ring-2 ring-blue-500/20 border-blue-600'
                  )}
                >
                  {selectedBank ? (
                    <div className="flex items-center gap-2.5 truncate">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                        <Landmark className="w-3.5 h-3.5" />
                      </div>
                      <div className="truncate">
                        <div className="font-semibold text-focus flex items-center gap-1.5 truncate">
                          <span>{selectedBank.bankName}</span>
                          <span className="text-muted-fg font-normal">•</span>
                          <span className="text-slate-600">{selectedBank.accountName}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                            {selectedBank.companyName}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-fg flex items-center gap-2">
                          <span>•••• {selectedBank.accountNumber.slice(-4)}</span>
                          <span>•</span>
                          <span className="text-emerald-600 font-semibold">
                            Balance: {formatPHP(selectedBank.currentBalance)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-fg">
                      <Landmark className="w-4 h-4 text-slate-400" />
                      <span>Select bank account…</span>
                    </div>
                  )}
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-muted-fg shrink-0 transition-transform duration-200 ml-2',
                      isBankDropdownOpen && 'rotate-180'
                    )}
                  />
                </button>

                {isBankDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150 max-h-60 overflow-y-auto">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-fg px-2 py-1">
                      Available Corporate Bank Accounts
                    </p>
                    {eligibleBanks.length === 0 ? (
                      <p className="text-xs text-muted-fg px-3 py-2 italic">
                        No eligible bank accounts registered.
                      </p>
                    ) : (
                      eligibleBanks.map((acc) => (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setSelectedBankId(acc.id)
                            setIsBankDropdownOpen(false)
                          }}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs transition-colors text-left cursor-pointer border-b border-slate-50 last:border-b-0',
                            selectedBank?.id === acc.id
                              ? 'bg-blue-50 text-blue-900 font-semibold'
                              : 'hover:bg-slate-50 text-focus'
                          )}
                        >
                          <div className="truncate mr-2">
                            <div className="flex items-center gap-1.5 font-semibold text-focus truncate">
                              <span>{acc.bankName}</span>
                              <span className="text-slate-400 font-normal">•</span>
                              <span className="text-slate-700">{acc.accountName}</span>
                            </div>
                            <div className="text-[11px] text-muted-fg flex items-center gap-2 mt-0.5">
                              <span className="font-medium text-blue-700 bg-blue-100/60 px-1.5 py-0.2 rounded text-[10px]">
                                {acc.companyName}
                              </span>
                              <span>•••• {acc.accountNumber.slice(-4)}</span>
                              <span>•</span>
                              <span className="text-emerald-600 font-semibold">
                                {formatPHP(acc.currentBalance)}
                              </span>
                            </div>
                          </div>
                          {selectedBank?.id === acc.id && (
                            <Check className="h-4 w-4 text-blue-600 shrink-0 ml-1" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Terms: Due Date and Interest Rate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-focus block">
                  Repayment Due Date
                </Label>
                <div className="relative">
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-10 text-xs sm:text-sm rounded-xl"
                  />
                </div>
              </div>

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
            </div>

            {/* 3. Mandatory Finance Remark */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-focus block">
                  Finance Endorsement Remark <span className="text-red-500">* (Required)</span>
                </Label>
                <span className="text-[11px] text-muted-fg">Mandatory</span>
              </div>
              <textarea
                value={remark}
                onChange={(e) => {
                  setRemark(e.target.value)
                  if (error) setError('')
                }}
                rows={2}
                placeholder="Enter treasury verification notes, fund allocation rationale, or reason..."
                className="w-full p-2.5 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none focus:ring-2 focus:ring-focus placeholder:text-muted-fg resize-none"
                required
              />
            </div>
          </div>

          <p className="text-2xs sm:text-xs text-slate-500 leading-relaxed pt-1">
            Endorsing forward will transmit this loan request to the Internal Audit team for final compliance review. Upon audit approval, the loan amount will be deducted from the chosen bank and credited to the borrower.
          </p>

          <div className="pt-3 flex items-center justify-between gap-2.5 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 rounded-xl text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleReject}
                disabled={isSubmitting || !remark.trim()}
                className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-semibold shadow-xs cursor-pointer"
              >
                <span>{isSubmitting ? 'Rejecting…' : 'Reject'}</span>
              </Button>
              <Button
                type="button"
                onClick={handleEndorse}
                disabled={isSubmitting || !selectedBank || !remark.trim()}
                className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-semibold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSubmitting ? 'Endorsing…' : 'Endorse to Audit'}</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
