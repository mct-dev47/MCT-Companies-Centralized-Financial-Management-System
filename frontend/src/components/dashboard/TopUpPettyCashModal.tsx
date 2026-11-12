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
  Wallet,
  Building2,
  AlertCircle,
  PlusCircle,
  Clock,
  Landmark,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPHP } from '@/lib/format'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { useSession } from '@/hooks/useSession'
import { bankService, isAccountOwnedBy, preferSoleOwnedBanks, type BankAccount } from '@/services/bankService'
import { loanService } from '@/services/loanService'
import { pettyCashService } from '@/services/pettyCashService'

export interface TopUpPettyCashModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  company: string
  currentBalance?: number | null
  companies?: string[]
  bankAccounts?: BankAccount[]
  banksLoading?: boolean
  banksError?: string | null
  onRetryBanks?: () => void
  onSuccess?: (newRequest?: PettyCashTopUpRecord) => void
}

export interface PettyCashTopUpRecord {
  id: string
  recordId: number
  companyName: string
  date: string
  type: 'topup' | 'request'
  description: string
  referenceNo?: string
  bankSource?: string
  amountRequested: number
  amountIn: number
  amountOut: number
  runningBalance: number
  status: 'Approved' | 'Pending Finance Approval' | 'Pending Audit Approval' | 'Disapproved' | 'Rejected'
  remark?: string
  requestedBy: string
  approvedBy?: string
  approvedAt?: string
}

const todayIso = () => formatToYYYYMMDD(new Date())

export const TopUpPettyCashModal: React.FC<TopUpPettyCashModalProps> = ({
  open,
  onOpenChange,
  company,
  currentBalance = 0,
  companies = [],
  bankAccounts: initialBankAccounts,
  banksLoading = false,
  banksError = null,
  onRetryBanks,
  onSuccess,
}) => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const isFinance = userRole === 'finance' || userRole === 'admin' || userRole === 'superadmin'
  const isSupervisor = userRole === 'supervisor'
  const isCompanyScoped = isSupervisor

  const [requestingCompany, setRequestingCompany] = React.useState(company)
  const [amountInput, setAmountInput] = React.useState('')
  const [requestDate, setRequestDate] = React.useState(todayIso)
  const [particulars, setParticulars] = React.useState('')
  const [fundingBankId, setFundingBankId] = React.useState('')
  const [financeRemark, setFinanceRemark] = React.useState('')
  const [error, setError] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  // Bank accounts list
  const [localBankAccounts, setLocalBankAccounts] = React.useState<BankAccount[]>(initialBankAccounts || [])
  const [localBanksLoading, setLocalBanksLoading] = React.useState(false)
  const [localBanksError, setLocalBanksError] = React.useState<string | null>(null)
  const [dbCompanies, setDbCompanies] = React.useState<string[]>([])
  const prevOpenRef = React.useRef(false)
  const prevBankCompRef = React.useRef('')
  const banksAutoSelectedRef = React.useRef(false)

  const bankAccountsList = React.useMemo(() => {
    if (initialBankAccounts && initialBankAccounts.length > 0) return initialBankAccounts
    return localBankAccounts
  }, [initialBankAccounts, localBankAccounts])

  const effectiveBanksLoading = Boolean(banksLoading) || localBanksLoading
  const effectiveBanksError = banksError || localBanksError

  const fetchFallbackBanks = React.useCallback(async (forceRefresh = false) => {
    setLocalBanksLoading(true)
    setLocalBanksError(null)
    try {
      const accounts = await bankService.getAccounts(undefined, { forceRefresh })
      setLocalBankAccounts(accounts || [])
    } catch (err: any) {
      setLocalBanksError(err instanceof Error ? err.message : 'Could not load bank accounts.')
    } finally {
      setLocalBanksLoading(false)
    }
  }, [])

  // Sync parent-provided banks
  React.useEffect(() => {
    if (initialBankAccounts && initialBankAccounts.length > 0) {
      setLocalBankAccounts(initialBankAccounts)
      setLocalBanksError(null)
    }
  }, [initialBankAccounts])

  // Load bank accounts and companies if needed
  React.useEffect(() => {
    let mounted = true
    if (open) {
      if (isFinance && (!initialBankAccounts || initialBankAccounts.length === 0)) {
        void fetchFallbackBanks(false)
      }

      if (companies.length === 0) {
        loanService.getCompanies().then((comps) => {
          if (mounted && comps && comps.length > 0) {
            setDbCompanies(comps.map((c) => c.company_name).filter(Boolean))
          }
        }).catch(() => {})
      }
    }
    return () => {
      mounted = false
    }
  }, [open, isFinance, initialBankAccounts, companies.length, fetchFallbackBanks])

  // Reset form on open
  React.useEffect(() => {
    if (open) {
      const initialComp = company && company !== 'All Companies' ? company : (user?.assignedCompany || 'MCT Kitchen')
      setRequestingCompany(initialComp)
      setAmountInput('')
      setRequestDate(todayIso())
      setParticulars('')
      setFundingBankId('')
      prevBankCompRef.current = ''
      banksAutoSelectedRef.current = false
      setFinanceRemark(isFinance ? 'Endorsed for petty cash replenishment' : '')
      setError('')
      setIsSubmitting(false)
    }
  }, [open, company, user?.assignedCompany, isFinance])

  // Auto-preselect requesting company's sole-owned bank when opened or company changes
  React.useEffect(() => {
    if (!open || !isFinance) {
      prevOpenRef.current = open
      if (!open) banksAutoSelectedRef.current = false
      return
    }
    const compChanged = prevBankCompRef.current !== requestingCompany
    const justOpened = !prevOpenRef.current && open
    prevOpenRef.current = open

    if (justOpened || compChanged) {
      banksAutoSelectedRef.current = false
      prevBankCompRef.current = requestingCompany
      if (bankAccountsList.length === 0) setFundingBankId('')
    }

    if (bankAccountsList.length > 0 && requestingCompany && !banksAutoSelectedRef.current) {
      const ownAccount = preferSoleOwnedBanks(
        bankAccountsList.filter((acc) => isAccountOwnedBy(acc, requestingCompany)),
        requestingCompany
      )[0]
      setFundingBankId(ownAccount ? ownAccount.id : '')
      banksAutoSelectedRef.current = true
    }
  }, [open, isFinance, requestingCompany, bankAccountsList])

  const parsedAmount = parseFloat(amountInput) || 0

  const availableCompanies = React.useMemo(() => {
    const list = companies.length > 0 ? companies : dbCompanies
    return list.filter((c) => c && c !== 'All Companies')
  }, [companies, dbCompanies])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!parsedAmount || parsedAmount < 1) {
      setError('Please enter a valid amount of at least ₱1.00')
      return
    }

    if (!requestDate || requestDate > todayIso()) {
      setError('Date cannot be in the future (maximum date is today).')
      return
    }

    if (!particulars.trim()) {
      setError('Please provide particulars / reason for the petty cash request.')
      return
    }

    if (isFinance) {
      if (!fundingBankId) {
        setError('Please choose a funding bank account before endorsing to Internal Audit.')
        return
      }
      if (!financeRemark.trim()) {
        setError('Please enter an endorsement remark.')
        return
      }
    }

    setIsSubmitting(true)

    try {
      const targetStatus = isFinance ? 'Pending Audit Approval' : 'Pending Finance Approval'

      await pettyCashService.createTopUp({
        company: requestingCompany,
        company_name: requestingCompany,
        amount: parsedAmount,
        date: requestDate,
        description: particulars.trim(),
        status: targetStatus,
        request_type: 'topup',
        bank_account_id: isFinance ? fundingBankId : undefined,
        finance_remark: isFinance ? financeRemark.trim() : undefined,
      })

      const newRecord: PettyCashTopUpRecord = {
        id: `pc-${Date.now()}`,
        recordId: Date.now(),
        companyName: requestingCompany,
        date: requestDate,
        type: 'request',
        description: particulars.trim(),
        amountRequested: parsedAmount,
        amountIn: 0,
        amountOut: 0,
        runningBalance: currentBalance || 0,
        status: targetStatus,
        bankSource: isFinance ? fundingBankId : undefined,
        remark: isFinance ? financeRemark.trim() : undefined,
        requestedBy: user?.fullName || user?.email || (isFinance ? 'Finance Officer' : 'Supervisor'),
        approvedBy: isFinance ? (user?.fullName || 'Finance Officer') : undefined,
        approvedAt: isFinance ? new Date().toISOString() : undefined,
      }

      onSuccess?.(newRecord)
      onOpenChange(false)
    } catch (err: any) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to submit petty cash request.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] lg:max-w-[800px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#960C01] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                {isFinance ? 'Endorse Petty Cash Top Up' : 'Request Petty Cash Top Up'}
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
                {isFinance
                  ? 'Endorse petty cash replenishment directly to Internal Audit with funding bank account and remark.'
                  : 'Submit petty cash replenishment request. Finance will review and record their decision with required remarks.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-2">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Row 1: Request Type (Left) & Requesting Company (Right) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus block">Request Type</Label>
              <div className="h-9 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-focus text-xs font-medium flex items-center justify-between shadow-2xs select-none">
                <div className="flex items-center gap-2">
                  <Wallet className="w-3.5 h-3.5 text-[#960C01] shrink-0" />
                  <span className="font-semibold text-focus">Petty Cash Top Up</span>
                </div>
                <span className="text-[10.5px] text-[#960C01] font-semibold px-2 py-0.5 rounded-full bg-[#960C01]/10 border border-[#960C01]/20 shrink-0">
                  {isFinance ? 'Direct Endorsement' : 'Automatic'}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus block">
                Requesting Company <span className="text-red-500">*</span>
              </Label>
              {isCompanyScoped ? (
                <div className="h-9 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-focus text-xs font-medium flex items-center gap-2 shadow-2xs">
                  <Building2 className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span className="truncate font-semibold">{requestingCompany}</span>
                </div>
              ) : (
                <select
                  value={requestingCompany}
                  onChange={(e) => setRequestingCompany(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none focus:ring-2 focus:ring-focus"
                >
                  {availableCompanies.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Row 2: Top Up Amount (Left) & Request Date (Right) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-focus block">
                  Top Up Amount (₱) <span className="text-red-500">*</span>
                </Label>
                {parsedAmount > 0 && (
                  <span className="text-[11px] text-primary font-semibold">
                    {formatPHP(parsedAmount)}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-focus text-xs">
                  ₱
                </span>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="pl-7 h-9 text-xs font-semibold rounded-xl"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-focus block">
                Request Date <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                value={requestDate}
                max={todayIso()}
                onChange={(e) => setRequestDate(e.target.value)}
                className="h-9 text-xs rounded-xl cursor-pointer"
                required
              />
            </div>
          </div>

          {/* Row 3: Particulars / Purpose (Full Width) */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-focus block">
              Particulars / Purpose <span className="text-red-500">*</span>
            </Label>
            <Input
              type="text"
              placeholder="e.g. Weekly operational petty cash buffer, kitchen consumables, minor supplies"
              value={particulars}
              onChange={(e) => setParticulars(e.target.value)}
              className="h-9 text-xs rounded-xl"
              required
            />
          </div>

          {/* Finance Endorsement Fields */}
          {isFinance && (
            <div className="space-y-3.5 pt-1 border-t border-stroke/20">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus block">
                    Funding Bank Account <span className="text-red-500">*</span>
                  </Label>
                  {effectiveBanksLoading && bankAccountsList.length === 0 ? (
                    <Skeleton className="h-9 w-full rounded-xl" aria-label="Loading bank accounts" />
                  ) : effectiveBanksError && bankAccountsList.length === 0 ? (
                    <div className="h-9 px-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700 flex items-center justify-between gap-2">
                      <span className="truncate" title={effectiveBanksError}>Couldn't load bank accounts.</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (onRetryBanks) onRetryBanks()
                          void fetchFallbackBanks(true)
                        }}
                        className="shrink-0 font-semibold underline underline-offset-2 hover:text-rose-800 cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select
                        value={fundingBankId}
                        onChange={(e) => setFundingBankId(e.target.value)}
                        className="w-full h-9 px-3 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus focus:outline-none focus:ring-2 focus:ring-focus"
                        required
                      >
                        <option value="">Select funding bank account...</option>
                        {(requestingCompany
                          ? bankAccountsList.filter((acc) => isAccountOwnedBy(acc, requestingCompany))
                          : bankAccountsList
                        ).map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.bankName} ({acc.accountName}) [{acc.companyName || 'Corporate'}]
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!effectiveBanksLoading && !effectiveBanksError && (requestingCompany ? bankAccountsList.filter((acc) => isAccountOwnedBy(acc, requestingCompany)).length === 0 : bankAccountsList.length === 0) && (
                    <p className="text-[11px] text-amber-700 font-medium">
                      {requestingCompany
                        ? `No bank accounts registered for ${requestingCompany}. Add a bank account for this company before endorsing.`
                        : 'No bank accounts found. Add a bank account before endorsing.'}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-focus block">
                    Endorsement Remark <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="text"
                    placeholder="e.g. Endorsed for weekly operations, verified sufficient bank balance"
                    value={financeRemark}
                    onChange={(e) => setFinanceRemark(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notice to user */}
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200/60 text-xs text-amber-900 flex items-center gap-2">
            {isFinance ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  As Finance, submitting this request directly endorses it and forwards it to Internal Audit for final approval.
                </span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Request will be routed to the Finance team for review. Required remarks and approval are confirmed by Finance.
                </span>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stroke/20">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 px-4 rounded-xl text-xs font-medium border-stroke/60 hover:bg-slate-50"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-10 px-5 rounded-xl bg-primary hover:bg-primary-hover active:bg-primary-active text-white font-semibold text-xs shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? 'Submitting...'
                  : isFinance
                  ? 'Endorse to Internal Audit'
                  : 'Submit Request to Finance'}
              </span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export const RequestPettyCashModal = TopUpPettyCashModal
