import { formatRealName } from '@/utils/formatRealName'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  RotateCw,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Check,
  AlertCircle,
  Eye,
  Pencil,
  MoreVertical,
  HelpCircle,
  Loader2,
  Landmark,
  Trash2,
  ArrowLeft,
  X,
  MessageSquare,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TablePagination } from '@/components/common/TablePagination'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import type { DateRange } from '@/components/ui/DateRangePicker'
import { TransactionDateRangeControl } from '@/components/transactions/TransactionDateRangeControl'
import { DropdownFilter } from '@/components/common/DropdownFilter'
import {
  deriveTransactionLifecycle,
  getRowSaleDateIso,
  getCleanParticularsTitle,
  getTransactionTypeMeta,
  formatSignedTransactionAmount,
  getDepositedAmountForRow,
} from '@/utils/transactionLifecycle'
import { TransactionStatusBadge } from '@/components/transactions/TransactionProgress'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { salesService } from '@/services/salesService'
import { expenseService } from '@/services/expenseService'
import { loanService, type LoanItem } from '@/services/loanService'
import { pettyCashService, type PettyCashMovement } from '@/services/pettyCashService'
import { tenantService, TENANT_COMPANY_NAME, type TenantLease } from '@/services/tenantService'
import { bankService, isAccountOwnedBy, isSharedAccount, type BankAccount } from '@/services/bankService'
import type { DashboardTransactionItem } from '@/services/dashboardService'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { isCompanyMatch } from '@/utils/companyUtils'
import { formatPHP } from '@/lib/format'
import { isDateInRange, normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { getPaidDepositForSale, getPaidDisbursementForExpense } from '@/utils/cashLedgerUtils'
import { reportAuditSaveFailure } from '@/services/auditReviewApi'
import { notifyError, notifyWarning, notifySuccess } from '@/utils/errorUtils'
import { websocketService } from '@/services/websocketService'
import { escapeHtml, csvCell } from '@/utils/exportSafety'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'
import { cn } from '@/lib/utils'

// ── Loan and petty cash rows (spec 0013) ─────────────────────────────────────────────────────
// The company that receives the money sees a Deposit; the company that funds it sees a Withdrawal.
// A record shows up from the moment Finance endorses it, and disappears if it is rejected.

/** Loan statuses that appear in the ledger: endorsed by Finance, through approval and repayment. */
const LEDGER_LOAN_STATUSES = new Set([
  'pending audit approval',
  'approved',
  'paid',
  'partially paid',
  'overdue',
])

/**
 * The day a sale's money was deposited, as MM/DD/YY (same format as the row date).
 * Null when the record is not a sale or the sale has not been deposited yet.
 */
const getDepositDayShort = (tx: DashboardTransactionItem): string | null => {
  if (tx.type !== 'Sales') return null
  if ((tx.depositStatus || tx.deposit_status) !== 'Deposited') return null
  const day = String(tx.deposit_date || tx.depositDate || '').slice(0, 10)
  const [y, m, d] = day.split('-')
  return y && m && d ? `${m}/${d}/${y.slice(2)}` : null
}

const isAwaitingAudit = (status?: string | null): boolean =>
  (status || '').trim().toLowerCase() === 'pending audit approval'

/** YYYY-MM-DD -> MM/DD/YY, the same display format the other ledger rows use. */
const toLedgerDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : iso
}

/** The company has a real lender (not "Pending Finance Assignment" or an external lender). */
const loanHasLender = (l: LoanItem): boolean => {
  if (l.lenderId) return true
  const name = (l.lender || '').trim().toLowerCase()
  return !!name && name !== 'pending finance assignment' && name !== 'external lender'
}

/**
 * One loan becomes up to two rows: a Deposit for the borrower, a Withdrawal for the lender.
 */
const buildLoanRows = (l: LoanItem): DashboardTransactionItem[] => {
  if (!LEDGER_LOAN_STATUSES.has((l.status || '').trim().toLowerCase())) return []

  const awaitingAudit = isAwaitingAudit(l.status)
  const status: DashboardTransactionItem['status'] = awaitingAudit
    ? 'Pending'
    : (l.status || '').trim().toLowerCase() === 'overdue'
    ? 'Overdue'
    : 'Paid'
  const amount = l.amount || 0

  const base = {
    refNo: l.refNo,
    chequeNo: l.chequeNo || '',
    date: l.date,
    type: 'Loan' as const,
    amount,
    category: l.category as any,
    status,
    awaitingAudit,
    auditStatus: l.auditStatus,
    auditedBy: l.auditedBy,
    auditNotes: l.auditNotes,
    auditDate: l.auditDate,
    createdBy: l.createdBy,
    createdAt: l.createdAt || l.rawDate,
    updatedAt: l.updatedAt,
    attachments: [],
    bankAccountId: l.bankAccountId,
  }

  const rows: DashboardTransactionItem[] = [
    {
      ...base,
      id: l.id,
      company: l.borrower || l.company,
      description: l.particulars,
      particulars: l.particulars,
      deposit: amount,
      withdrawal: 0,
    },
  ]

  const sameCompany =
    (!!l.lenderId && !!l.borrowerId && l.lenderId === l.borrowerId) ||
    (l.lender || '').trim().toLowerCase() === (l.borrower || '').trim().toLowerCase()
  if (loanHasLender(l) && !sameCompany) {
    const particulars = `Loan disbursed to ${l.borrower}${l.particulars ? `: ${l.particulars}` : ''}`
    rows.push({
      ...base,
      id: `${l.id}:lender`,
      company: l.lender,
      description: particulars,
      particulars,
      deposit: 0,
      withdrawal: amount,
      isMirrorRow: true,
    })
  }
  return rows
}

/**
 * One petty cash top up becomes:
 *  - funded by another company: a Deposit for the requesting company, a Withdrawal for the funder
 *  - funded from the company's own bank account: a single Withdrawal, and no Deposit
 * Every petty cash row is a read only mirror (petty cash is audited on its own page).
 */
/**
 * One petty cash top up or reimbursement becomes:
 *  - for top up: funded by another company: a Deposit for the requesting company, a Withdrawal for the funder
 *  - for top up: funded from the company's own bank account: a single Withdrawal, and no Deposit
 *  - for reimbursement: a Withdrawal for the company/funder reflecting employee payout or float disbursement
 * Every petty cash row is a read only mirror (petty cash is audited on its own page).
 */
const buildPettyCashRows = (m: PettyCashMovement): DashboardTransactionItem[] => {
  const reqType = (m.requestType || '').trim().toLowerCase()
  const isReimbursement = reqType === 'reimbursement' || reqType === 'replenishment' || reqType === 'replenishment_disbursement'
  const statusLower = (m.status || '').trim().toLowerCase()
  const awaitingAudit = isAwaitingAudit(m.status) || statusLower.includes('pending')
  const isDisapproved = statusLower.includes('disapproved') || statusLower.includes('rejected')
  const auditStatus: DashboardTransactionItem['auditStatus'] = awaitingAudit ? 'Pending Audit' : isDisapproved ? 'Flagged' : 'Verified'
  const txStatus: DashboardTransactionItem['status'] = awaitingAudit ? 'Pending' : 'Paid'

  const base = {
    refNo: m.refNo,
    chequeNo: '',
    date: toLedgerDate(m.date),
    type: 'Petty Cash' as const,
    amount: m.amount,
    category: (m.category || 'Petty Cash') as any,
    paymentMethod: m.isOwnAccount || !m.fundingCompanyId ? 'Cash Float' : 'Bank Transfer',
    status: txStatus,
    awaitingAudit,
    auditStatus,
    auditedBy: m.reviewedBy || undefined,
    auditDate: m.reviewedAt ? toLedgerDate(m.reviewedAt) : undefined,
    auditNotes: m.remark || m.financeRemark || undefined,
    createdBy: m.createdByName || (m.createdBy ? String(m.createdBy) : undefined),
    createdAt: m.createdAt || m.date,
    attachments: m.receiptUrl ? [m.receiptUrl] : [],
    isMirrorRow: true,
    paidAmount: m.amountReimbursed || m.amount,
    bankAccountId: m.fundingBankId || undefined,
    bankName: m.fundingBankName || undefined,
  }

  if (isReimbursement) {
    const claimant = m.paidBy || 'Employee'
    const desc = m.description || `Petty cash reimbursement for ${claimant} (${m.refNo})`

    if (m.isOwnAccount || !m.fundingCompanyId || m.fundingCompanyName === m.companyName) {
      return [
        {
          ...base,
          id: `pc_${m.topupId}:out`,
          company: m.companyName,
          description: desc,
          particulars: desc,
          deposit: 0,
          withdrawal: m.amount,
        },
      ]
    }

    const fundingDesc = `Petty cash reimbursement funded for ${m.companyName} (${m.refNo})`
    return [
      {
        ...base,
        id: `pc_${m.topupId}:exp`,
        company: m.companyName,
        description: desc,
        particulars: desc,
        deposit: 0,
        withdrawal: m.amount,
      },
      {
        ...base,
        id: `pc_${m.topupId}:out`,
        company: m.fundingCompanyName,
        description: fundingDesc,
        particulars: fundingDesc,
        deposit: 0,
        withdrawal: m.amount,
      },
    ]
  }

  if (m.isOwnAccount) {
    const particulars = `Petty cash top up funded from own bank account (${m.refNo})`
    return [
      {
        ...base,
        id: `pc_${m.topupId}:out`,
        company: m.companyName,
        description: particulars,
        particulars,
        deposit: 0,
        withdrawal: m.amount,
      },
    ]
  }

  const received = `Petty cash top up from ${m.fundingCompanyName} (${m.refNo})`
  const funded = `Petty cash top up funded for ${m.companyName} (${m.refNo})`
  return [
    {
      ...base,
      id: `pc_${m.topupId}:in`,
      company: m.companyName,
      description: received,
      particulars: received,
      deposit: m.amount,
      withdrawal: 0,
    },
    {
      ...base,
      id: `pc_${m.topupId}:out`,
      company: m.fundingCompanyName,
      description: funded,
      particulars: funded,
      deposit: 0,
      withdrawal: m.amount,
    },
  ]
}

interface CompanyFilterDropdownProps {
  selectedCompany: string
  companyList: string[]
  onSelectCompany: (company: string) => void
  fullWidth?: boolean
  className?: string
}

const CompanyFilterDropdown: React.FC<CompanyFilterDropdownProps> = ({
  selectedCompany,
  companyList,
  onSelectCompany,
  fullWidth = false,
  className,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const pos = useDropdownPosition(dropdownRef, isOpen)

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [])

  const filteredList = React.useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return companyList
    return companyList.filter((c) => c.toLowerCase().includes(q))
  }, [search, companyList])

  return (
    <div ref={dropdownRef} className={cn('relative', fullWidth ? 'block w-full' : 'inline-block', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center justify-between gap-2 min-h-[44px] h-11 min-w-[200px] sm:min-w-[220px] px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          fullWidth && 'w-full',
          isOpen && 'ring-2 ring-focus/20 border-focus/50'
        )}
        aria-label="Filter transactions by company"
        aria-expanded={isOpen}
      >
        <span className="font-semibold text-focus truncate min-w-0 flex-1 text-left">
          {selectedCompany}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
      </button>

      {isOpen && (
        <div
          style={pos.isMobile ? pos.style : undefined}
          className={cn(
            'bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
            pos.isMobile
              ? 'w-[min(calc(100vw-32px),340px)]'
              : 'absolute right-0 top-full mt-2 w-80'
          )}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-stroke/20 px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
              Filter By Company
            </span>
          </div>

          <div className="relative mb-2 px-1">
            <Search className="w-3.5 h-3.5 text-muted-fg absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company…"
              className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-stroke/40 bg-slate-50/70 text-xs text-focus placeholder:text-muted-fg/60 focus:outline-none focus:ring-1 focus:ring-focus focus:bg-white"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="space-y-0.5 max-h-56 overflow-y-auto pr-0.5">
            {filteredList.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-fg">
                No matching companies
              </div>
            ) : (
              filteredList.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onSelectCompany(c)
                    setIsOpen(false)
                    setSearch('')
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                    selectedCompany === c
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-focus/80 hover:bg-slate-50'
                  )}
                >
                  <span className="truncate">{c}</span>
                  {selectedCompany === c && (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const isTxMatchingBankAccount = (tx: DashboardTransactionItem, account: BankAccount): boolean => {
  // 1. Direct bankAccountId match
  if (tx.bankAccountId && String(tx.bankAccountId) === String(account.id)) {
    return true
  }

  // 2. Direct bankName match
  if (tx.bankName && account.bankName) {
    if (tx.bankName.trim().toLowerCase() === account.bankName.trim().toLowerCase()) {
      return true
    }
  }

  // 3. Match against account direct transactions
  if (account.transactions && account.transactions.length > 0) {
    const matchedInAccount = account.transactions.some((bt) => {
      if (String(bt.id) === String(tx.id)) return true
      if (tx.chequeNo && bt.chequeNo && tx.chequeNo.trim().toLowerCase() === bt.chequeNo.trim().toLowerCase()) return true
      if (tx.refNo && bt.chequeNo && tx.refNo.trim().toLowerCase() === bt.chequeNo.trim().toLowerCase()) return true
      if (tx.refNo && bt.particulars && bt.particulars.toLowerCase().includes(tx.refNo.toLowerCase())) return true
      return false
    })
    if (matchedInAccount) return true
  }

  // 4. Payment method, description, or particulars match on bank name
  const bankNameLower = (account.bankName || '').trim().toLowerCase()
  if (bankNameLower && bankNameLower.length >= 3) {
    const pMethod = (tx.paymentMethod || '').toLowerCase()
    const desc = (tx.description || '').toLowerCase()
    const part = (tx.particulars || '').toLowerCase()
    if (pMethod.includes(bankNameLower) || desc.includes(bankNameLower) || part.includes(bankNameLower)) {
      return true
    }
  }

  // 5. Account number match (last 4 digits or full number)
  const accNum = (account.accountNumber || '').replace(/\D/g, '')
  if (accNum.length >= 4) {
    const last4 = accNum.slice(-4)
    const combinedText = `${tx.particulars || ''} ${tx.description || ''} ${tx.chequeNo || ''} ${tx.refNo || ''}`
    if (combinedText.includes(accNum) || combinedText.includes(last4)) {
      return true
    }
  }

  return false
}

interface BankAccountFilterDropdownProps {
  selectedAccountId: string
  bankAccounts: BankAccount[]
  onSelectAccount: (accountId: string) => void
  fullWidth?: boolean
  className?: string
}

const BankAccountFilterDropdown: React.FC<BankAccountFilterDropdownProps> = ({
  selectedAccountId,
  bankAccounts,
  onSelectAccount,
  fullWidth = false,
  className,
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const pos = useDropdownPosition(dropdownRef, isOpen)

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [])

  const selectedAcc = React.useMemo(
    () => (selectedAccountId ? bankAccounts.find((a) => String(a.id) === String(selectedAccountId)) : undefined),
    [bankAccounts, selectedAccountId]
  )

  const filteredAccounts = React.useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return bankAccounts
    return bankAccounts.filter((a) => {
      return (
        a.bankName.toLowerCase().includes(q) ||
        a.accountName.toLowerCase().includes(q) ||
        (a.accountNumber && a.accountNumber.toLowerCase().includes(q)) ||
        (a.companyName && a.companyName.toLowerCase().includes(q))
      )
    })
  }, [search, bankAccounts])

  const triggerLabel = selectedAcc
    ? `Bank: ${selectedAcc.bankName}${selectedAcc.accountName ? ` – ${selectedAcc.accountName}` : ''}`
    : 'Bank: All'

  return (
    <div ref={dropdownRef} className={cn('relative', fullWidth ? 'block w-full' : 'inline-block', className)}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center justify-between gap-2 min-h-[44px] h-11 px-4 rounded-full border bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          fullWidth && 'w-full',
          selectedAcc ? 'border-primary/50 bg-primary/5' : 'border-stroke/60',
          isOpen && 'ring-2 ring-focus/20 border-focus/50'
        )}
        aria-label={`Filter by bank account: ${triggerLabel}`}
        aria-expanded={isOpen}
      >
        <span className="inline-flex items-center gap-2 min-w-0 flex-1">
          <Landmark className={cn('h-4 w-4 shrink-0', selectedAcc ? 'text-primary' : 'text-muted-fg')} />
          <span className="font-semibold text-focus truncate text-left">
            {triggerLabel}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
      </button>

      {isOpen && (
        <div
          style={pos.isMobile ? pos.style : undefined}
          className={cn(
            'bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
            pos.isMobile
              ? 'w-[min(calc(100vw-32px),360px)]'
              : 'absolute right-0 top-full mt-2 w-80'
          )}
        >
          <div className="pb-2 mb-2 border-b border-stroke/20 px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
              Filter By Bank Account
            </span>
          </div>

          {bankAccounts.length >= 4 && (
            <div className="relative mb-2 px-1">
              <Search className="w-3.5 h-3.5 text-muted-fg absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Search bank accounts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bank or account..."
                className="w-full min-h-[44px] pl-8 pr-8 py-1.5 rounded-lg border border-stroke/40 bg-slate-50/70 text-xs text-focus placeholder:text-muted-fg/70 focus:outline-none focus:ring-2 focus:ring-focus focus:bg-white"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear bank search"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-1 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
            {!search.trim() && (
              <button
                type="button"
                onClick={() => {
                  onSelectAccount('')
                  setIsOpen(false)
                  setSearch('')
                }}
                className={cn(
                  'w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  !selectedAccountId
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-focus/85 hover:bg-surface'
                )}
              >
                <span>All Banks</span>
                {!selectedAccountId && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />}
              </button>
            )}
            {filteredAccounts.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-fg">
                No matching bank accounts
              </div>
            ) : (
              filteredAccounts.map((acc) => {
                const isSelected = Boolean(selectedAccountId) && String(selectedAccountId) === String(acc.id)
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => {
                      onSelectAccount(String(acc.id))
                      setIsOpen(false)
                      setSearch('')
                    }}
                    className={cn(
                      'w-full min-h-[44px] flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      isSelected
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-focus/85 hover:bg-surface'
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-semibold truncate">
                          {acc.bankName}
                          {acc.accountName ? ` – ${acc.accountName}` : ''}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-fg truncate">{acc.companyName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-right">
                      <div className="flex flex-col text-right">
                        <span className="text-[11px] font-semibold text-focus">
                          {formatPHP(acc.startingBalance)}
                        </span>
                        <span className="text-[10px] text-muted-fg">start bal</span>
                      </div>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const TransactionPage: React.FC = () => {
  const { user } = useSession()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { activeCompany, setActiveCompany, allCompanies } = useCompany()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole.includes('audit')
  const isFinance = userRole.includes('finance')
  const isAdmin = userRole === 'admin' || userRole === 'owner'

  // Crucial requirement: Only Audit and Finance (and Admin) can choose "All Companies", not the supervisor!
  const canSelectAllCompanies = isAudit || isFinance || isAdmin

  // Resolve all assigned company names for a supervisor
  const supervisorCompanies = React.useMemo(() => {
    const list: string[] = []
    if (user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      const parts = user.assignedCompany.includes(',')
        ? user.assignedCompany.split(',').map((c) => c.trim()).filter(Boolean)
        : [user.assignedCompany.trim()]
      parts.forEach((c) => {
        if (c && c !== 'All Companies' && !list.includes(c)) list.push(c)
      })
    }
    if (Array.isArray(user?.companyNames)) {
      user.companyNames.forEach((c) => {
        if (c && c !== 'All Companies' && !list.includes(c)) list.push(c)
      })
    }
    if (Array.isArray(user?.assignedCompanies)) {
      user.assignedCompanies.forEach((c) => {
        if (c && c !== 'All Companies' && !list.includes(c)) list.push(c)
      })
    }
    if (list.length === 0 && activeCompany && activeCompany !== 'All Companies') {
      list.push(activeCompany)
    }
    return list
  }, [user, activeCompany])

  const defaultSupervisorCompany = supervisorCompanies[0] || ''

  // Dynamic company list loaded from CompanyContext
  const [companyList, setCompanyList] = React.useState<string[]>(() => {
    if (allCompanies && allCompanies.length > 0) return allCompanies
    return ['All Companies']
  })

  React.useEffect(() => {
    if (allCompanies && allCompanies.length > 0) {
      setCompanyList(allCompanies)
    }
  }, [allCompanies])

  // Company options displayed in dropdown:
  // - Audit/Finance: "All Companies" + all registered companies
  // - Supervisor: strictly their assigned companies (never "All Companies")
  const availableCompanyOptions = React.useMemo(() => {
    if (!canSelectAllCompanies) {
      return supervisorCompanies.length > 0 ? supervisorCompanies : [defaultSupervisorCompany]
    }
    const list = companyList.filter((c) => c !== 'All Companies')
    return ['All Companies', ...list]
  }, [canSelectAllCompanies, supervisorCompanies, defaultSupervisorCompany, companyList])

  // Selected company state
  const [selectedCompany, setSelectedCompany] = React.useState<string>(() => {
    if (!canSelectAllCompanies) {
      if (activeCompany && activeCompany !== 'All Companies' && supervisorCompanies.includes(activeCompany)) {
        return activeCompany
      }
      return defaultSupervisorCompany
    }
    if (activeCompany) return activeCompany
    return 'All Companies'
  })

  // Ensure supervisor NEVER gets stuck on 'All Companies'
  React.useEffect(() => {
    if (!canSelectAllCompanies) {
      if (
        !selectedCompany ||
        selectedCompany === 'All Companies' ||
        (supervisorCompanies.length > 0 && !supervisorCompanies.includes(selectedCompany))
      ) {
        setSelectedCompany(defaultSupervisorCompany)
      }
    }
  }, [canSelectAllCompanies, selectedCompany, supervisorCompanies, defaultSupervisorCompany])

  React.useEffect(() => {
    if (activeCompany) {
      if (canSelectAllCompanies || (supervisorCompanies.includes(activeCompany) && activeCompany !== 'All Companies')) {
        setSelectedCompany(activeCompany)
      }
    }
  }, [activeCompany, canSelectAllCompanies, supervisorCompanies])

  // Effective company for data fetching and filtering:
  // - For Audit/Finance: specific company name, or undefined for "All Companies"
  // - For Supervisor: always their specific selected/assigned company, NEVER undefined!
  const effectiveTargetCompany = React.useMemo(() => {
    if (!canSelectAllCompanies) {
      return selectedCompany && selectedCompany !== 'All Companies' ? selectedCompany : defaultSupervisorCompany
    }
    return selectedCompany !== 'All Companies' ? selectedCompany : undefined
  }, [canSelectAllCompanies, selectedCompany, defaultSupervisorCompany])

  const [selectedBankAccountId, setSelectedBankAccountId] = React.useState<string>('')
  const [depositCurrentPage, setDepositCurrentPage] = React.useState(1)
  const [salesCurrentPage, setSalesCurrentPage] = React.useState(1)

  const handleSelectCompany = (c: string) => {
    if (!canSelectAllCompanies && c === 'All Companies') return
    setSelectedCompany(c)
    setActiveCompany(c)
    setSelectedBankAccountId('')
    setDepositCurrentPage(1)
    setSalesCurrentPage(1)
  }

  const handleResetCompany = React.useCallback(() => {
    if (!canSelectAllCompanies) {
      setSelectedCompany(defaultSupervisorCompany)
      setActiveCompany(defaultSupervisorCompany)
    } else {
      setSelectedCompany('All Companies')
      setActiveCompany('All Companies')
    }
    setSelectedBankAccountId('')
    setDepositCurrentPage(1)
    setSalesCurrentPage(1)
  }, [canSelectAllCompanies, defaultSupervisorCompany, setActiveCompany])

  const [transactions, setTransactions] = React.useState<DashboardTransactionItem[]>([])
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Bank accounts filtered by company scope
  const availableBankAccounts = React.useMemo(() => {
    if (effectiveTargetCompany) {
      return bankAccounts.filter((a) => isAccountOwnedBy(a, effectiveTargetCompany))
    }
    return bankAccounts
  }, [bankAccounts, effectiveTargetCompany])

  // Clear selectedBankAccountId only if it no longer belongs to the scoped company's banks
  React.useEffect(() => {
    if (!selectedBankAccountId) return
    if (
      availableBankAccounts.length > 0 &&
      !availableBankAccounts.some((a) => String(a.id) === String(selectedBankAccountId))
    ) {
      setSelectedBankAccountId('')
    }
  }, [availableBankAccounts, selectedBankAccountId])

  const selectedBankAccount = React.useMemo(
    () =>
      selectedBankAccountId
        ? availableBankAccounts.find((a) => String(a.id) === String(selectedBankAccountId))
        : undefined,
    [availableBankAccounts, selectedBankAccountId]
  )

  // Which registered bank account a record belongs to (stored bank id first, then name / ledger matching).
  const resolveTxBank = React.useCallback(
    (tx: DashboardTransactionItem): BankAccount | undefined => {
      if (tx.bankAccountId) {
        const byId = availableBankAccounts.find((a) => String(a.id) === String(tx.bankAccountId))
        if (byId) return byId
      }
      if (tx.bankName) {
        const byName = availableBankAccounts.find(
          (a) => a.bankName.toLowerCase() === tx.bankName!.toLowerCase()
        )
        if (byName) return byName
      }
      return availableBankAccounts.find((a) => isTxMatchingBankAccount(tx, a))
    },
    [availableBankAccounts]
  )

  // Starting balances from registered bank accounts grouped by company
  const getStartingBalanceForCompany = React.useCallback(
    (companyName: string): number => {
      let total = 0
      bankAccounts.forEach((acc) => {
        if (isAccountOwnedBy(acc, companyName)) {
          total += Number(acc.startingBalance) || 0
        }
      })
      return Math.round(total * 100) / 100
    },
    [bankAccounts]
  )

  const isOwner = userRole === 'owner'
  const isFinanceOnly = isFinance && !isAudit && !isAdmin && !isOwner
  const isViewOnlyUser = isOwner
  const showActionColumn = !isOwner
  const canAudit = (isAdmin || isAudit) && !isOwner
  const isBusinessWriter =
    (userRole === 'supervisor' || userRole === 'company') &&
    !isAudit &&
    !isAdmin &&
    !isOwner

  // Row delete confirmation state
  const [deleteConfirmTx, setDeleteConfirmTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isDeletingTx, setIsDeletingTx] = React.useState(false)

  // Day level audit (By Day focus): Mark as Audited / Flag Discrepancy with optional remarks
  const [dayAudit, setDayAudit] = React.useState<{
    action: 'Verified' | 'Flagged'
    date: string
    targets: DashboardTransactionItem[]
  } | null>(null)
  const [dayAuditRemarks, setDayAuditRemarks] = React.useState('')
  const [isSubmittingDayAudit, setIsSubmittingDayAudit] = React.useState(false)

  // 3-Dots Action Menu state
  const [openMenuTxId, setOpenMenuTxId] = React.useState<string | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)
  const [activeMenuTx, setActiveMenuTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = React.useState(false)
  const [isMarkAuditModalOpen, setIsMarkAuditModalOpen] = React.useState(false)
  const [markAuditTargetTx, setMarkAuditTargetTx] = React.useState<DashboardTransactionItem | null>(null)
  const [markAuditRemarks, setMarkAuditRemarks] = React.useState('')
  // 3 dots menu on a By Day row (acts on the whole day)
  const [dayMenu, setDayMenu] = React.useState<{ date: string; top: number; right: number; openUpward: boolean } | null>(null)
  const [discrepancyReason, setDiscrepancyReason] = React.useState('')
  const [isSubmittingAudit, setIsSubmittingAudit] = React.useState(false)
  const [remarksTargetTx, setRemarksTargetTx] = React.useState<DashboardTransactionItem | null>(null)
  const [remarksInput, setRemarksInput] = React.useState('')
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = React.useState(false)
  const [isSavingRemarks, setIsSavingRemarks] = React.useState(false)

  // Close floating 3-dots action menu on click outside, scroll or resize
  React.useEffect(() => {
    const handleCloseMenu = () => {
      setOpenMenuTxId(null)
      setMenuPosition(null)
      setActiveMenuTx(null)
    }
    window.addEventListener('click', handleCloseMenu)
    window.addEventListener('scroll', handleCloseMenu, true)
    window.addEventListener('resize', handleCloseMenu)
    return () => {
      window.removeEventListener('click', handleCloseMenu)
      window.removeEventListener('scroll', handleCloseMenu, true)
      window.removeEventListener('resize', handleCloseMenu)
    }
  }, [])

  // Switch bar tab: 'deposit' (Bank Ledger) | 'all' (All Transactions), preserved via ?tab= query param
  const [activeTab, setActiveTabState] = React.useState<'deposit' | 'all'>(() => {
    const param = searchParams.get('tab')
    return param === 'deposit' ? 'deposit' : 'all'
  })

  const setActiveTab = React.useCallback(
    (tab: 'deposit' | 'all') => {
      setActiveTabState(tab)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', tab)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Shared filters & group-by choice persisted across tab switches
  const [searchQuery, setSearchQuery] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<'All' | 'Sales' | 'Expenses'>('All')
  const [dateRange, setDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
    preset: 'All Dates',
  })
  const [statusFilter, setStatusFilter] = React.useState<
    | 'All'
    | 'Deposited'
    | 'Awaiting'
    | 'Unpaid Sales'
    | 'Paid'
    | 'Pending'
    | 'Unpaid'
    | 'On hold'
    | 'Pending Audit'
    | 'Audited'
    | 'Flagged'
  >('All')
  const [categoryFilter, setCategoryFilter] = React.useState<string>('All')
  const [paymentMethodFilter, setPaymentMethodFilter] = React.useState<string>('All')
  const [sortOrder, setSortOrder] = React.useState<'desc' | 'asc'>('desc')

  // Help popover state
  const [isHelpOpen, setIsHelpOpen] = React.useState(false)
  const helpPopoverRef = React.useRef<HTMLDivElement>(null)

  // Export dropdown state
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)

  const itemsPerPage = 12

  // View mode / group-by choice persisted across tabs (Step 4 expands with Transaction grouping)
  const [salesViewMode, setSalesViewMode] = React.useState<'all' | 'daily_summary'>('all')
  const [expandedDates, setExpandedDates] = React.useState<Set<string>>(new Set())
  const toggleDateExpansion = (date: string) =>
    setExpandedDates((prev) => (prev.has(date) ? new Set() : new Set([date])))

  // Modal inspection
  const [selectedTx, setSelectedTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  // Close dropdowns / popovers on click outside or Escape
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (helpPopoverRef.current && !helpPopoverRef.current.contains(target)) {
        setIsHelpOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExportDropdownOpen(false)
        setIsHelpOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [])

  // Fetch all transactions across Sales, Expenses, and Loans
  const fetchAllTransactions = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const targetCompany = effectiveTargetCompany
      const shouldFetchTenants = !targetCompany || isCompanyMatch(TENANT_COMPANY_NAME, targetCompany)
      const [salesData, expenseData, loanData, pettyCashData, tenantLeases, bankAccountsData] = await Promise.all([
        salesService.getSales(targetCompany),
        expenseService.getExpenses({ company: targetCompany }),
        loanService.getLoans({ company: targetCompany }),
        // A petty cash failure must not break the rest of the ledger.
        pettyCashService.getMovements(targetCompany).catch(() => [] as PettyCashMovement[]),
        shouldFetchTenants
          ? tenantService.listLeases().catch(() => [] as TenantLease[])
          : Promise.resolve([] as TenantLease[]),
        bankService.getAccounts(targetCompany).catch(() => [] as BankAccount[]),
      ])

      const unifiedSales: DashboardTransactionItem[] = salesData.map((s) => ({
        id: s.id,
        refNo: s.refNo,
        chequeNo: s.chequeNo || '',
        date: s.date,
        type: 'Sales',
        company: s.company,
        description: s.particulars,
        particulars: s.particulars,
        amount: s.deposit || s.withdrawal || 0,
        withdrawal: s.withdrawal || 0,
        deposit: s.deposit || 0,
        category: s.category as any,
        paymentMethod: s.paymentMethod,
        status: s.status,
        auditStatus: s.auditStatus,
        auditedBy: s.auditedBy,
        auditNotes: s.auditNotes,
        auditDate: s.auditDate,
        createdBy: s.createdBy,
        createdAt: s.createdAt || s.rawDate,
        updatedAt: s.updatedAt,
        attachments: [],
        items: s.items,
        paidAmount: getPaidDepositForSale(s),
        depositStatus: s.depositStatus || (s as any).deposit_status || 'Pending',
        deposit_status: s.depositStatus || (s as any).deposit_status || 'Pending',
        remarks: s.remarks || '',
        bankAccountId: (s as any).bankAccountId || (s as any).bank_account_id,
        bankName: (s as any).bankName || (s as any).bank_name,
        // The row stays on the sale date for auditing; the bank deposit date rides along
        saleDate: s.rawDate,
        deposit_date: s.deposit_date ?? s.depositDate ?? null,
        depositDate: s.deposit_date ?? s.depositDate ?? null,
      }))

      const unifiedExpenses: DashboardTransactionItem[] = expenseData.map((e) => ({
        id: e.id,
        refNo: e.refNo,
        chequeNo: e.chequeNo || '',
        date: e.date,
        type: 'Expense',
        company: e.company,
        description: e.particulars,
        particulars: e.particulars,
        amount: e.withdrawal || e.netAmount || 0,
        withdrawal: e.withdrawal || e.netAmount || 0,
        deposit: 0,
        category: e.category as any,
        paymentMethod: e.paymentMethod,
        status: e.status,
        auditStatus: e.auditStatus,
        auditedBy: e.auditedBy,
        auditNotes: e.auditNotes,
        auditDate: e.auditDate,
        createdBy: e.createdBy,
        createdAt: e.createdAt || e.rawDate,
        updatedAt: e.updatedAt,
        attachments: [],
        items: e.items,
        paidAmount: getPaidDisbursementForExpense(e),
        remarks: e.remarks || '',
        bankAccountId: (e as any).bankAccountId || (e as any).bank_account_id,
        bankName: (e as any).bankName || (e as any).bank_name,
      }))

      // Spec 0013: each loan and petty cash top up shows each company's own side of the money.
      const unifiedLoans: DashboardTransactionItem[] = loanData.flatMap(buildLoanRows)
      const unifiedPettyCash: DashboardTransactionItem[] = pettyCashData.flatMap(buildPettyCashRows)

      const unifiedTenants: DashboardTransactionItem[] = []
      tenantLeases.forEach((lease) => {
        const leaseCompany = lease.companyName || TENANT_COMPANY_NAME
        if (targetCompany && !isCompanyMatch(leaseCompany, targetCompany)) return

        if (lease.dailyPayments && lease.dailyPayments.length > 0) {
          lease.dailyPayments.forEach((p) => {
            if (p.status === "Missed" || (p.amount || 0) <= 0) return
            unifiedTenants.push({
              id: `tenant_pmt_${p.id}`,
              refNo: p.referenceNo || lease.tenantId,
              chequeNo: "",
              date: p.date,
              type: "Income",
              company: leaseCompany,
              description: `Rental Collection - ${lease.tenantName} (${lease.unitName})`,
              particulars: `Rental Payment - ${lease.tenantName} (${lease.unitName})`,
              amount: p.amount,
              withdrawal: 0,
              deposit: p.amount,
              category: "Rental Income" as any,
              paymentMethod: p.method,
              status: "Paid",
              auditStatus: (lease.auditStatus as any) || "Pending Audit",
              auditedBy: lease.auditedBy,
              auditNotes: lease.auditRemarks,
              auditDate: lease.auditDate,
              createdAt: p.timestamp || `${p.date}T00:00:00Z`,
              isMirrorRow: true,
              paidAmount: p.amount,
            })
          })
        } else if (lease.amountPaid > 0) {
          unifiedTenants.push({
            id: `tenant_lease_${lease.id}`,
            refNo: lease.tenantId,
            chequeNo: "",
            date: lease.contractDate,
            type: "Income",
            company: leaseCompany,
            description: `Rental Collection - ${lease.tenantName} (${lease.unitName})`,
            particulars: `Rental Payment - ${lease.tenantName} (${lease.unitName})`,
            amount: lease.amountPaid,
            withdrawal: 0,
            deposit: lease.amountPaid,
            category: "Rental Income" as any,
            paymentMethod: "Cash",
            status: "Paid",
            auditStatus: (lease.auditStatus as any) || "Pending Audit",
            auditedBy: lease.auditedBy,
            auditNotes: lease.auditRemarks,
            auditDate: lease.auditDate,
            createdAt: `${lease.contractDate}T00:00:00Z`,
            isMirrorRow: true,
            paidAmount: lease.amountPaid,
          })
        }
      })

      const combined = [...unifiedSales, ...unifiedExpenses, ...unifiedLoans, ...unifiedPettyCash, ...unifiedTenants]
      setTransactions(combined)
      setBankAccounts(bankAccountsData)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [effectiveTargetCompany])

  React.useEffect(() => {
    fetchAllTransactions(false)
  }, [fetchAllTransactions])

  // Realtime: an Audit review of a sale or expense, or an Audit approval of a loan or petty cash
  // top up, reloads the ledger for everyone (Finance, Audit and company users). Reloads are
  // silent (no loading skeleton) and bunched together when several messages arrive at once.
  React.useEffect(() => {
    let timer: number | null = null
    const reload = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // Each service keeps a 30 second cache. Clear them so the reload shows what the server has now.
        salesService.invalidateCache()
        expenseService.invalidateCache()
        loanService.invalidateCache()
        pettyCashService.invalidateCache()
        bankService.invalidateCache()
        void fetchAllTransactions(true)
      }, 250)
    }
    const unsubs = [
      websocketService.subscribe('EXPENSE_CREATED', reload),
      websocketService.subscribe('EXPENSE_UPDATED', reload),
      websocketService.subscribe('EXPENSE_DELETED', reload),
      websocketService.subscribe('SALES_UPDATED', reload),
      websocketService.subscribe('BANK_UPDATED', reload),
      websocketService.subscribe('LOANS_UPDATED', reload),
      websocketService.subscribe('PETTY_CASH_UPDATED', reload),
      websocketService.subscribe('AUDIT_UPDATED', reload),
      websocketService.subscribe('TENANTS_UPDATED', reload),
    ]
    return () => {
      if (timer) window.clearTimeout(timer)
      unsubs.forEach((off) => off())
    }
  }, [fetchAllTransactions])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchAllTransactions(false)
  }

  // 1. FILTERED CASH LEDGER
  //    Deposits    = paid sales, plus money a company receives from a loan or petty cash top up
  //    Withdrawals = paid expenses, plus money a company funds out for a loan or petty cash top up
  //    Loan and petty cash rows appear once Audit approves them and are removed if the record is
  //    rejected (spec 0013, narrowed by spec 0016).
  //    Spec 0016: loans and petty cash top ups still waiting for Audit are not money movement yet, so
  //    they are kept off this tab. They stay on the All tab, marked pending.
  const depositBaseList = React.useMemo(() => {
    // Spec 0013 & updated deposit filter: Any transaction that represents a deposit / money in
    // (Sales, Rental Income, Loan deposit to borrower, Petty Cash top up received) is included.
    let list = transactions
      .filter((t) => {
        // Spec 0040: Sales must strictly have deposit_status === 'Deposited' to appear in Deposit tab.
        // Pending, Unpaid, and Paid-but-undeposited sales remain in All Transactions only.
        if (t.type === 'Sales') {
          const isDeposited = t.depositStatus === 'Deposited' || t.deposit_status === 'Deposited'
          return isDeposited && ((t.deposit || 0) > 0 || (t.paidAmount || 0) > 0 || (t.amount || 0) > 0)
        }
        // All tenant rental collections / income are deposits
        if (t.type === 'Income') return true
        // Only PAID expenses are cash ledger withdrawals. Pending and Unpaid expenses have a withdrawal
        // amount but no money has left yet, so they stay in All Transactions only.
        if (t.type === 'Expense') return (t.paidAmount || 0) > 0
        // Loans and petty cash movements are included once approved (not awaiting audit)
        if (t.type === 'Loan' || t.type === 'Petty Cash') return !t.awaitingAudit
        // Any other record with explicit deposit > 0
        if ((t.deposit || 0) > 0) return true
        return false
      })
      .map((t): DashboardTransactionItem => {
        if (t.type === 'Sales') {
          const depositVal = (t.paidAmount || 0) > 0 ? t.paidAmount! : (t.deposit || t.amount || 0)
          // Deposit tab = cash ledger: the row sits on the day the money was DEPOSITED (By Day groups on it too).
          // Keep original gross t.amount intact for Amount vs Deposit Amount columns.
          const depDay = String(t.deposit_date || t.depositDate || '').slice(0, 10)
          const [y, m, d] = depDay.split('-')
          const depositDisplayDate = y && m && d ? `${m}/${d}/${y.slice(2)}` : t.date
          return { ...t, date: depositDisplayDate, paidAmount: depositVal, deposit: depositVal, withdrawal: 0 }
        }
        if (t.type === 'Income') {
          const depositVal = (t.deposit || 0) > 0 ? t.deposit : (t.amount || t.paidAmount || 0)
          return { ...t, amount: depositVal, deposit: depositVal, withdrawal: 0 }
        }
        if (t.type === 'Expense') {
          const withdrawalVal = (t.paidAmount || 0) > 0 ? t.paidAmount! : (t.withdrawal || t.amount || 0)
          return { ...t, amount: withdrawalVal, deposit: 0, withdrawal: withdrawalVal }
        }
        return t
      })

    // Company scope
    if (effectiveTargetCompany) {
      list = list.filter((t) => isCompanyMatch(t.company, effectiveTargetCompany))
    }

    // Bank scope: only this bank's records (and so only this bank's running balance)
    if (selectedBankAccount) {
      list = list.filter((t) => resolveTxBank(t)?.id === selectedBankAccount.id)
    }

    return list
  }, [transactions, effectiveTargetCompany, selectedBankAccount, resolveTxBank])

  // Running balance per company or selected bank account (deposits minus withdrawals, oldest first, seeded from bank starting balances).
  // It is worked out over the whole company scoped ledger, before the search, direction and date filters,
  // so a filter never restarts it. Keyed by record type and id.
  const depositBalanceByKey = React.useMemo(() => {
    const ordered = [...depositBaseList].sort((a, b) => {
      const byDate = normalizeDateToYYYYMMDD(a.date).localeCompare(normalizeDateToYYYYMMDD(b.date))
      if (byDate !== 0) return byDate
      return (a.createdAt || a.id).localeCompare(b.createdAt || b.id)
    })
    const running = new Map<string, number>()
    const balances = new Map<string, number>()
    ordered.forEach((t) => {
      const groupKey = selectedBankAccount
        ? String(selectedBankAccount.id)
        : (t.company || '').toLowerCase().trim()

      if (!running.has(groupKey)) {
        const seedBalance = selectedBankAccount
          ? (Number(selectedBankAccount.startingBalance) || 0)
          : getStartingBalanceForCompany(t.company)
        running.set(groupKey, seedBalance)
      }
      const prev = running.get(groupKey)!
      const next = Math.round((prev + (t.deposit || 0) - (t.withdrawal || 0)) * 100) / 100
      running.set(groupKey, next)
      balances.set(`${t.type}:${t.id}`, next)
    })
    return balances
  }, [depositBaseList, selectedBankAccount, getStartingBalanceForCompany])

  // Total bank balance at the close of each day (sum of the per-company/bank running balances above).
  const closingBalanceDates = React.useMemo(() => {
    const ordered = [...depositBaseList].sort((a, b) => {
      const byDate = normalizeDateToYYYYMMDD(a.date).localeCompare(normalizeDateToYYYYMMDD(b.date))
      if (byDate !== 0) return byDate
      return (a.createdAt || a.id).localeCompare(b.createdAt || b.id)
    })
    const latest = new Map<string, number>()
    const closing = new Map<string, number>()
    ordered.forEach((t) => {
      const groupKey = selectedBankAccount ? String(selectedBankAccount.id) : (t.company || '').toLowerCase().trim()
      latest.set(groupKey, depositBalanceByKey.get(`${t.type}:${t.id}`) ?? latest.get(groupKey) ?? 0)
      let total = 0
      latest.forEach((v) => (total += v))
      closing.set(normalizeDateToYYYYMMDD(t.date), Math.round(total * 100) / 100)
    })
    return Array.from(closing.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [depositBaseList, depositBalanceByKey, selectedBankAccount])

  // Balance as of the end of `date`: the latest ledger close on or before that day (falls back to the starting balance).
  const getClosingBalance = React.useCallback(
    (date: string) => {
      let result: number | null = null
      for (const [d, v] of closingBalanceDates) {
        if (d <= date) result = v
        else break
      }
      return result
    },
    [closingBalanceDates]
  )

  const matchesTypeFilter = React.useCallback(
    (t: DashboardTransactionItem): boolean => {
      if (typeFilter === 'All') return true
      if (typeFilter === 'Sales') return t.type === 'Sales'
      if (typeFilter === 'Expenses') return t.type === 'Expense'
      return true
    },
    [typeFilter]
  )

  const matchesSharedStatus = React.useCallback(
    (t: DashboardTransactionItem): boolean => {
      if (statusFilter === 'All') return true
      const lc = deriveTransactionLifecycle(t)
      if (statusFilter === 'Deposited') return t.type === 'Sales' && lc.bucket === 'deposited'
      if (statusFilter === 'Awaiting') return t.type === 'Sales' && lc.bucket === 'awaiting'
      if (statusFilter === 'Unpaid Sales') return t.type === 'Sales' && lc.bucket === 'unpaid'
      if (statusFilter === 'Paid') return lc.paymentStatus === 'Paid'
      if (statusFilter === 'Pending') {
        return lc.paymentStatus === 'Pending' || lc.paymentStatus === 'Partially Paid'
      }
      if (statusFilter === 'Unpaid') {
        return lc.paymentStatus === 'Unpaid' || lc.paymentStatus === 'Overdue'
      }
      if (statusFilter === 'On hold') return lc.paymentStatus === 'On hold'
      if (statusFilter === 'Pending Audit') return lc.isAuditPending
      if (statusFilter === 'Audited') return t.auditStatus === 'Verified'
      if (statusFilter === 'Flagged') return t.auditStatus === 'Flagged'
      return true
    },
    [statusFilter]
  )

  const matchesPaymentMethod = React.useCallback(
    (t: DashboardTransactionItem): boolean => {
      if (paymentMethodFilter === 'All') return true
      const pm = (t.paymentMethod || 'Cash').trim().toLowerCase()
      return pm === paymentMethodFilter.trim().toLowerCase()
    },
    [paymentMethodFilter]
  )

  const paymentMethodOptions = React.useMemo(() => {
    const set = new Set<string>(['Cash', 'GCash', 'Cheque'])
    transactions.forEach((t) => {
      if (t.paymentMethod && t.paymentMethod.trim()) {
        set.add(t.paymentMethod.trim())
      }
    })
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [transactions])

  const matchesCategoryFilter = React.useCallback(
    (t: DashboardTransactionItem): boolean => {
      if (categoryFilter === 'All') return true
      const cat = (t.category || 'Uncategorized').trim().toLowerCase()
      return cat === categoryFilter.trim().toLowerCase()
    },
    [categoryFilter]
  )

  const categoryOptions = React.useMemo(() => {
    const set = new Set<string>()
    transactions.forEach((t) => {
      if (t.category && String(t.category).trim()) {
        set.add(String(t.category).trim())
      }
    })
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [transactions])

  const filteredDepositTransactions = React.useMemo(() => {
    let list = depositBaseList

    // Type filter (All | Sales | Expenses)
    if (typeFilter !== 'All') {
      list = list.filter(matchesTypeFilter)
    }

    // Category filter
    if (categoryFilter !== 'All') {
      list = list.filter(matchesCategoryFilter)
    }

    // Status filter
    if (statusFilter !== 'All') {
      list = list.filter(matchesSharedStatus)
    }

    // Payment method filter
    if (paymentMethodFilter !== 'All') {
      list = list.filter(matchesPaymentMethod)
    }

    // Search query
    const q = searchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (t) =>
          t.refNo.toLowerCase().includes(q) ||
          (t.chequeNo && t.chequeNo.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q) ||
          (t.particulars && t.particulars.toLowerCase().includes(q)) ||
          t.company.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.paymentMethod && t.paymentMethod.toLowerCase().includes(q))
      )
    }

    // Date range (Bank Ledger filters by deposit / ledger date)
    if (dateRange.startDate && dateRange.endDate) {
      list = list.filter((t) =>
        isDateInRange(t.date, dateRange.startDate, dateRange.endDate)
      )
    }

    // Sort
    list = [...list].sort((a, b) => {
      const dateA = normalizeDateToYYYYMMDD(a.date)
      const dateB = normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) {
        return sortOrder === 'desc' ? cmp : -cmp
      }
      const timeCmp = (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      return sortOrder === 'desc' ? timeCmp : -timeCmp
    })

    return list
  }, [
    depositBaseList,
    typeFilter,
    matchesTypeFilter,
    categoryFilter,
    matchesCategoryFilter,
    statusFilter,
    matchesSharedStatus,
    paymentMethodFilter,
    matchesPaymentMethod,
    searchQuery,
    dateRange,
    sortOrder,
  ])

  const depositTotalPages = Math.max(1, Math.ceil(filteredDepositTransactions.length / itemsPerPage))
  const displayedDepositTransactions = React.useMemo(() => {
    const start = (depositCurrentPage - 1) * itemsPerPage
    return filteredDepositTransactions.slice(start, start + itemsPerPage)
  }, [filteredDepositTransactions, depositCurrentPage, itemsPerPage])

  // 2. FILTERED ALL TRANSACTIONS (Sales + Expenses/Withdrawals + all company ledger entries)
  const filteredSalesTransactions = React.useMemo(() => {
    let list = transactions.slice()

    // Company scope
    if (effectiveTargetCompany) {
      list = list.filter((t) => isCompanyMatch(t.company, effectiveTargetCompany))
    }

    // Bank scope
    if (selectedBankAccount) {
      list = list.filter((t) => resolveTxBank(t)?.id === selectedBankAccount.id)
    }

    // Type filter (All | Sales | Expenses)
    if (typeFilter !== 'All') {
      list = list.filter(matchesTypeFilter)
    }

    // Category filter
    if (categoryFilter !== 'All') {
      list = list.filter(matchesCategoryFilter)
    }

    // Status filter
    if (statusFilter !== 'All') {
      list = list.filter(matchesSharedStatus)
    }

    // Payment method filter
    if (paymentMethodFilter !== 'All') {
      list = list.filter(matchesPaymentMethod)
    }

    // Search query
    const q = searchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (t) =>
          t.refNo.toLowerCase().includes(q) ||
          (t.chequeNo && t.chequeNo.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q) ||
          (t.particulars && t.particulars.toLowerCase().includes(q)) ||
          t.company.toLowerCase().includes(q) ||
          (t.category && String(t.category).toLowerCase().includes(q)) ||
          (t.paymentMethod && t.paymentMethod.toLowerCase().includes(q))
      )
    }

    // Date range (All Transactions filters by sale/expense transaction date)
    if (dateRange.startDate && dateRange.endDate) {
      list = list.filter((t) =>
        isDateInRange(getRowSaleDateIso(t) || t.date, dateRange.startDate, dateRange.endDate)
      )
    }

    // Sort by transaction date (sales date for Sales, expense date for Expenses)
    list = [...list].sort((a, b) => {
      const dateA = getRowSaleDateIso(a) || normalizeDateToYYYYMMDD(a.date)
      const dateB = getRowSaleDateIso(b) || normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) {
        return sortOrder === 'desc' ? cmp : -cmp
      }
      const timeCmp = (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      return sortOrder === 'desc' ? timeCmp : -timeCmp
    })

    return list
  }, [
    transactions,
    effectiveTargetCompany,
    selectedBankAccount,
    resolveTxBank,
    typeFilter,
    matchesTypeFilter,
    categoryFilter,
    matchesCategoryFilter,
    statusFilter,
    matchesSharedStatus,
    paymentMethodFilter,
    matchesPaymentMethod,
    searchQuery,
    dateRange,
    sortOrder,
  ])

  const salesTotalPages = Math.max(1, Math.ceil(filteredSalesTransactions.length / itemsPerPage))
  const displayedSalesTransactions = React.useMemo(() => {
    const start = (salesCurrentPage - 1) * itemsPerPage
    return filteredSalesTransactions.slice(start, start + itemsPerPage)
  }, [filteredSalesTransactions, salesCurrentPage, itemsPerPage])

  // Resolve a row into bank-statement style deposit (money in) / withdrawal (money out) amounts.
  // Loan and petty cash rows carry their own direction (Deposit for the receiving company,
  // Withdrawal for the funding company). Sales are inflows and expenses outflows. Each row is
  // one direction only.
  const getRowAmounts = React.useCallback(
    (t: DashboardTransactionItem): { deposit: number; withdrawal: number } => {
      // Prefer the record's explicit deposit/withdrawal fields when present.
      if ((t.deposit || 0) > 0) {
        return { deposit: t.deposit, withdrawal: 0 }
      }
      if ((t.withdrawal || 0) > 0) {
        return { deposit: 0, withdrawal: t.withdrawal }
      }
      // Fall back to the record type to decide the direction of the raw amount.
      const amt = t.amount || 0
      if (t.type === 'Sales' || t.type === 'Income') {
        return { deposit: amt, withdrawal: 0 }
      }
      // Expense (and any other record without its own direction) is money out.
      return { deposit: 0, withdrawal: amt }
    },
    []
  )

  // Daily Summary per bank grouping for All Transactions tab
  const dailySummaryGroups = React.useMemo(() => {
    const groupsMap = new Map<
      string,
      Map<
        string,
        {
          date: string
          bankKey: string
          bankName: string
          accountNumber?: string
          totalDeposit: number
          totalWithdrawal: number
          netMovement: number
          transactionCount: number
          transactions: DashboardTransactionItem[]
        }
      >
    >()

    const sourceTransactions = activeTab === 'deposit' ? filteredDepositTransactions : filteredSalesTransactions
    const groupMeta = new Map<string, { date: string; company: string }>()
    sourceTransactions.forEach((tx) => {
      const dateKey = normalizeDateToYYYYMMDD(tx.date) || tx.date || 'Unknown Date'
      const matchedBank = resolveTxBank(tx)
      // A bank owned by several companies gets its own day row per company; single-owner banks stay one row per day.
      const company = isSharedAccount(matchedBank) ? (tx.company || '').trim() || 'Unassigned' : ''
      const groupId = company ? `${dateKey}||${company.toLowerCase()}` : dateKey
      if (!groupsMap.has(groupId)) {
        groupsMap.set(groupId, new Map())
        groupMeta.set(groupId, { date: dateKey, company })
      }
      const banksMap = groupsMap.get(groupId)!

      const bankKey = matchedBank ? String(matchedBank.id) : (tx.bankName || tx.paymentMethod || 'General Fund')
      const bankName = matchedBank ? matchedBank.bankName : (tx.bankName || (tx.paymentMethod ? `${tx.paymentMethod}` : 'General Fund'))
      const accountNumber = matchedBank?.accountNumber

      if (!banksMap.has(bankKey)) {
        banksMap.set(bankKey, {
          date: dateKey,
          bankKey,
          bankName,
          accountNumber,
          totalDeposit: 0,
          totalWithdrawal: 0,
          netMovement: 0,
          transactionCount: 0,
          transactions: [],
        })
      }

      const item = banksMap.get(bankKey)!
      const { deposit, withdrawal } = getRowAmounts(tx)
      item.totalDeposit = Math.round((item.totalDeposit + deposit) * 100) / 100
      item.totalWithdrawal = Math.round((item.totalWithdrawal + withdrawal) * 100) / 100
      item.netMovement = Math.round((item.totalDeposit - item.totalWithdrawal) * 100) / 100
      item.transactionCount += 1
      item.transactions.push(tx)
    })

    const sortedDates = Array.from(groupsMap.keys()).sort((a, b) => {
      const ma = groupMeta.get(a)!
      const mb = groupMeta.get(b)!
      const byDate = mb.date.localeCompare(ma.date)
      return byDate !== 0 ? byDate : ma.company.localeCompare(mb.company)
    })

    return sortedDates.map((groupId) => {
      const { date: dateKey, company } = groupMeta.get(groupId)!
      const banksMap = groupsMap.get(groupId)!
      const banks = Array.from(banksMap.values()).sort((a, b) => a.bankName.localeCompare(b.bankName))
      const dayTotalDeposit = Math.round(banks.reduce((acc, b) => acc + b.totalDeposit, 0) * 100) / 100
      const dayTotalWithdrawal = Math.round(banks.reduce((acc, b) => acc + b.totalWithdrawal, 0) * 100) / 100
      const dayNetMovement = Math.round((dayTotalDeposit - dayTotalWithdrawal) * 100) / 100
      const dayTransactionCount = banks.reduce((acc, b) => acc + b.transactionCount, 0)

      return {
        id: groupId,
        date: dateKey,
        company,
        banks,
        dayTotalDeposit,
        dayTotalWithdrawal,
        dayNetMovement,
        dayTransactionCount,
      }
    })
  }, [activeTab, filteredDepositTransactions, filteredSalesTransactions, resolveTxBank, getRowAmounts])

  // The By Day table gets a Company column only when a shared (multi-company) bank is in view
  const showDayCompanyColumn = dailySummaryGroups.some((g) => !!g.company)
  const showDayBalanceColumn = activeTab === 'deposit'
  const dayColCount = activeTab === 'deposit'
    ? 6
    : (showDayCompanyColumn ? 7 : 6) +
      (showDayBalanceColumn ? 1 : 0) +
      (showActionColumn ? 1 : 0)
  const hasFocusedDay = React.useMemo(
    () => dailySummaryGroups.some((g) => expandedDates.has(g.id)),
    [dailySummaryGroups, expandedDates]
  )
  const visibleDayGroups = React.useMemo(
    () =>
      hasFocusedDay
        ? dailySummaryGroups.filter((g) => expandedDates.has(g.id))
        : dailySummaryGroups,
    [dailySummaryGroups, hasFocusedDay, expandedDates]
  )

  // Active dataset & shared filter chips
  const activeDataset = activeTab === 'deposit' ? filteredDepositTransactions : filteredSalesTransactions

  // View mode toggle (All Records | By Day), updated in Step 4 to None | Day | Transaction
  const viewModeToggle = (
    <div
      role="group"
      aria-label="Group transactions"
      className="inline-flex items-center rounded-full border border-stroke/50 bg-slate-100/80 p-0.5 shrink-0"
    >
      {(
        [
          { value: 'all', label: 'All Records' },
          { value: 'daily_summary', label: 'By Day' },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={salesViewMode === opt.value}
          onClick={() => setSalesViewMode(opt.value)}
          className={cn(
            'min-h-[44px] px-3.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            salesViewMode === opt.value
              ? 'bg-[#960C01] text-white shadow-xs'
              : 'text-focus/70 hover:text-focus hover:bg-white/60'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )

  const activeFilterChips = React.useMemo(() => {
    const chips: { key: string; label: string; onClear: () => void }[] = []

    if (typeFilter !== 'All') {
      chips.push({
        key: 'type',
        label: `Type: ${typeFilter}`,
        onClear: () => {
          setTypeFilter('All')
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    if (searchQuery.trim()) {
      chips.push({
        key: 'search',
        label: `Search: "${searchQuery.trim()}"`,
        onClear: () => {
          setSearchQuery('')
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    if (canSelectAllCompanies && selectedCompany !== 'All Companies') {
      chips.push({
        key: 'company',
        label: `Company: ${selectedCompany}`,
        onClear: handleResetCompany,
      })
    } else if (
      !canSelectAllCompanies &&
      supervisorCompanies.length > 1 &&
      selectedCompany !== defaultSupervisorCompany
    ) {
      chips.push({
        key: 'company',
        label: `Company: ${selectedCompany}`,
        onClear: handleResetCompany,
      })
    }

    if (selectedBankAccount) {
      chips.push({
        key: 'bank',
        label: `Bank: ${selectedBankAccount.bankName}${selectedBankAccount.accountName ? ` – ${selectedBankAccount.accountName}` : ''}`,
        onClear: () => {
          setSelectedBankAccountId('')
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    if (dateRange.startDate || dateRange.endDate) {
      chips.push({
        key: 'date',
        label: dateRange.label || `${dateRange.startDate} – ${dateRange.endDate}`,
        onClear: () => {
          setDateRange({ startDate: null, endDate: null, label: 'All Dates', preset: 'All Dates' })
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    if (statusFilter !== 'All') {
      const statusDisplay =
        statusFilter === 'Awaiting' ? 'Awaiting Deposit / Transfer' : statusFilter
      chips.push({
        key: 'status',
        label: `Status: ${statusDisplay}`,
        onClear: () => {
          setStatusFilter('All')
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    if (categoryFilter !== 'All') {
      chips.push({
        key: 'category',
        label: `Category: ${categoryFilter}`,
        onClear: () => {
          setCategoryFilter('All')
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    if (paymentMethodFilter !== 'All') {
      chips.push({
        key: 'method',
        label: `Method: ${paymentMethodFilter}`,
        onClear: () => {
          setPaymentMethodFilter('All')
          setDepositCurrentPage(1)
          setSalesCurrentPage(1)
        },
      })
    }

    return chips
  }, [
    typeFilter,
    searchQuery,
    canSelectAllCompanies,
    selectedCompany,
    supervisorCompanies.length,
    defaultSupervisorCompany,
    selectedBankAccount,
    dateRange,
    categoryFilter,
    statusFilter,
    paymentMethodFilter,
    handleResetCompany,
  ])

  const handleClearAllFilters = () => {
    setTypeFilter('All')
    setSearchQuery('')
    setDateRange({ startDate: null, endDate: null, label: 'All Dates', preset: 'All Dates' })
    setCategoryFilter('All')
    setStatusFilter('All')
    setPaymentMethodFilter('All')
    handleResetCompany()
  }

  // Totals of the rows that match the current filters on the active tab (spec 0016)
  const activeTotals = React.useMemo(() => {
    let deposits = 0
    let withdrawals = 0
    activeDataset.forEach((t) => {
      const { deposit, withdrawal } = getRowAmounts(t)
      deposits += deposit || 0
      withdrawals += withdrawal || 0
    })
    deposits = Math.round(deposits * 100) / 100
    withdrawals = Math.round(withdrawals * 100) / 100
    return { deposits, withdrawals, net: Math.round((deposits - withdrawals) * 100) / 100 }
  }, [activeDataset, getRowAmounts])

  // Sum of starting balances for the active company or selected bank account
  const activeStartingBalance = React.useMemo(() => {
    if (selectedBankAccount) {
      return Number(selectedBankAccount.startingBalance) || 0
    }
    if (effectiveTargetCompany) {
      return getStartingBalanceForCompany(effectiveTargetCompany)
    }
    return Math.round(
      bankAccounts.reduce((sum, acc) => sum + (Number(acc.startingBalance) || 0), 0) * 100
    ) / 100
  }, [selectedBankAccount, effectiveTargetCompany, getStartingBalanceForCompany, bankAccounts])

  // Active ending balance on Deposit tab taking into account starting balance
  const activeEndingBalance = React.useMemo(() => {
    return Math.round((activeStartingBalance + activeTotals.deposits - activeTotals.withdrawals) * 100) / 100
  }, [activeStartingBalance, activeTotals.deposits, activeTotals.withdrawals])

  const handleRowClick = (tx: DashboardTransactionItem) => {
    // The cash ledger tab shows only the paid part of a record. The detail window needs the full record.
    const fullRecord = transactions.find((t) => t.id === tx.id && t.type === tx.type) || tx
    setSelectedTx(fullRecord)
    setIsModalOpen(true)
  }

  const handleMenuViewDetails = (tx: DashboardTransactionItem) => {
    setOpenMenuTxId(null)
    setMenuPosition(null)
    setActiveMenuTx(null)
    handleRowClick(tx)
  }

  // Supervisors can edit an unaudited sale or expense in the spreadsheet editor.
  // Finance is view only here (it can only add remarks on unaudited records).
  const canEditTx = (tx: DashboardTransactionItem) =>
    !canAudit &&
    !isOwner &&
    !isFinanceOnly &&
    (tx.type === 'Sales' || tx.type === 'Expense') &&
    !tx.isMirrorRow &&
    tx.auditStatus !== 'Verified'

  // Unaudited Sales/Expenses can be deleted by Finance/Supervisors (never audited/verified or deposited sales)
  const canShowDeleteOption = (tx: DashboardTransactionItem) =>
    isBusinessWriter &&
    (tx.type === 'Sales' || tx.type === 'Expense') &&
    !tx.isMirrorRow &&
    tx.auditStatus !== 'Verified'

  const getDeleteBlockedReason = (tx: DashboardTransactionItem): string | null => {
    if (tx.auditStatus === 'Verified') return 'Audited records cannot be deleted'
    if (tx.type === 'Sales' && (tx.depositStatus === 'Deposited' || tx.deposit_status === 'Deposited')) {
      return 'Deposited sales cannot be deleted'
    }
    if (tx.type === 'Sales' && String(tx.id).startsWith('utang-')) {
      return 'Manage standalone receivables from the Receivables page'
    }
    return null
  }

  const handleMenuEdit = (tx: DashboardTransactionItem) => {
    setOpenMenuTxId(null)
    setMenuPosition(null)
    setActiveMenuTx(null)
    const fullRecord = transactions.find((t) => t.id === tx.id && t.type === tx.type) || tx
    if (tx.type === 'Expense') {
      navigate('/expense/add', { state: { editExpense: fullRecord } })
    } else {
      navigate('/sales/add', { state: { editSale: fullRecord } })
    }
  }

  const handleMenuDelete = (tx: DashboardTransactionItem) => {
    if (getDeleteBlockedReason(tx)) return
    setOpenMenuTxId(null)
    setMenuPosition(null)
    setActiveMenuTx(null)
    const fullRecord = transactions.find((t) => t.id === tx.id && t.type === tx.type) || tx
    setDeleteConfirmTx(fullRecord)
  }

  const handleConfirmDeleteTx = async () => {
    if (!deleteConfirmTx || !isBusinessWriter) return
    const target = deleteConfirmTx
    if (getDeleteBlockedReason(target)) return
    setIsDeletingTx(true)
    try {
      if (target.type === 'Expense') {
        await expenseService.deleteExpense(target.id)
      } else {
        await salesService.deleteSale(target.id)
      }
      setTransactions((prev) =>
        prev.filter((t) => !(t.id === target.id && t.type === target.type))
      )
      setDeleteConfirmTx(null)
      notifySuccess(`${target.type === 'Expense' ? 'Expense' : 'Sale'} record deleted.`)
    } catch (err) {
      notifyError(err, 'Failed to delete transaction. Please try again.')
    } finally {
      setIsDeletingTx(false)
    }
  }

  const handleMenuMarkAudit = (tx: DashboardTransactionItem) => {
    setOpenMenuTxId(null)
    setMenuPosition(null)
    setActiveMenuTx(null)
    setMarkAuditTargetTx(tx)
    setMarkAuditRemarks(tx.auditNotes || '')
    setIsMarkAuditModalOpen(true)
  }

  const handleConfirmQuickMarkAudit = async () => {
    if (!markAuditTargetTx) return
    setIsSubmittingAudit(true)
    const tx = markAuditTargetTx
    const trimmedNotes = markAuditRemarks.trim() || undefined
    const today = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    })
    const auditorName = formatRealName(user?.fullName || user?.email || 'Audit Officer', user?.role || 'Audit Officer')

    const updatedTx: DashboardTransactionItem = {
      ...tx,
      auditStatus: 'Verified',
      auditedBy: auditorName,
      auditDate: today,
      auditNotes: trimmedNotes,
    }
    setTransactions((prev) => prev.map((t) => (t.id === tx.id && t.type === tx.type ? updatedTx : t)))

    try {
      if (tx.type === 'Sales') {
        await salesService.updateSaleAuditStatus(tx.id, 'Verified', auditorName, trimmedNotes)
      } else if (tx.type === 'Expense') {
        await expenseService.updateExpenseAuditStatus(tx.id, 'Verified', auditorName, trimmedNotes)
      } else if (tx.type === 'Loan') {
        const loanId = tx.id.replace(/:lender$/, '')
        await loanService.updateLoan(loanId, {
          auditStatus: 'Verified',
          auditedBy: auditorName,
          auditDate: today,
          auditNotes: trimmedNotes,
        })
      } else if (tx.type === 'Income') {
        const leaseId = tx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
        await tenantService.saveAuditReview(leaseId, 'Verified', trimmedNotes)
      }
      setIsMarkAuditModalOpen(false)
      setMarkAuditRemarks('')
      setMarkAuditTargetTx(null)
    } catch (err) {
      reportAuditSaveFailure(err)
      fetchAllTransactions(true)
    } finally {
      setIsSubmittingAudit(false)
    }
  }

  // Sales and Expense rows the auditor can review here (petty cash is a read only mirror,
  // loans awaiting audit are handled on their own page)
  const isRowAuditable = (tx: DashboardTransactionItem) =>
    tx.type !== 'Petty Cash' && !tx.awaitingAudit

  // Audit a whole day in one go: every auditable row that is not already audited or flagged.
  // Flagged rows keep their discrepancy and must be re-audited by hand.
  const getDayAuditTargets = (dayTxs: DashboardTransactionItem[]) =>
    dayTxs.filter((t) => isRowAuditable(t) && t.auditStatus !== 'Verified' && t.auditStatus !== 'Flagged')

  // Opens the day level audit dialog (Mark as Audited or Flag Discrepancy, remarks optional)
  const openDayAudit = (action: 'Verified' | 'Flagged', date: string, dayTxs: DashboardTransactionItem[]) => {
    const targets = getDayAuditTargets(dayTxs)
    if (targets.length === 0) return
    setDayMenu(null)
    setDayAuditRemarks('')
    setDayAudit({ action, date, targets })
  }

  const handleConfirmDayAudit = async () => {
    if (!dayAudit) return
    const { action, targets } = dayAudit
    const notes = dayAuditRemarks.trim() || undefined
    setIsSubmittingDayAudit(true)

    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
    const auditorName = formatRealName(user?.fullName || user?.email || 'Audit Officer', user?.role || 'Audit Officer')
    const keys = new Set(targets.map((t) => `${t.type}:${t.id}`))

    setTransactions((prev) =>
      prev.map((t) =>
        keys.has(`${t.type}:${t.id}`)
          ? { ...t, auditStatus: action, auditedBy: auditorName, auditDate: today, auditNotes: notes }
          : t
      )
    )

    const results = await Promise.allSettled(
      targets.map((tx) => {
        if (tx.type === 'Sales') return salesService.updateSaleAuditStatus(tx.id, action, auditorName, notes)
        if (tx.type === 'Expense') return expenseService.updateExpenseAuditStatus(tx.id, action, auditorName, notes)
        if (tx.type === 'Loan') {
          const loanId = tx.id.replace(/:lender$/, '')
          return loanService.updateLoan(loanId, { auditStatus: action, auditedBy: auditorName, auditDate: today, auditNotes: notes })
        }
        if (tx.type === 'Income') {
          const leaseId = tx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
          return tenantService.saveAuditReview(leaseId, action, notes)
        }
        return Promise.resolve()
      })
    )
    setIsSubmittingDayAudit(false)
    setDayAudit(null)
    setDayAuditRemarks('')
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (failed) {
      reportAuditSaveFailure(failed.reason)
      fetchAllTransactions(true)
    }
  }

  const handleMenuOpenDiscrepancy = (tx: DashboardTransactionItem) => {
    setOpenMenuTxId(null)
    setMenuPosition(null)
    setActiveMenuTx(tx)
    setDiscrepancyReason(tx.auditNotes || '')
    setIsDiscrepancyModalOpen(true)
  }

  const handleConfirmQuickDiscrepancy = async () => {
    if (!activeMenuTx || !discrepancyReason.trim()) return
    setIsSubmittingAudit(true)
    const tx = activeMenuTx
    const trimmed = discrepancyReason.trim()
    const today = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    })
    const auditorName = formatRealName(user?.fullName || user?.email || 'Audit Officer', user?.role || 'Audit Officer')

    const updatedTx: DashboardTransactionItem = {
      ...tx,
      auditStatus: 'Flagged',
      auditedBy: auditorName,
      auditDate: today,
      auditNotes: trimmed,
    }
    setTransactions((prev) => prev.map((t) => (t.id === tx.id && t.type === tx.type ? updatedTx : t)))

    try {
      if (tx.type === 'Sales') {
        await salesService.updateSaleAuditStatus(tx.id, 'Flagged', auditorName, trimmed)
      } else if (tx.type === 'Expense') {
        await expenseService.updateExpenseAuditStatus(tx.id, 'Flagged', auditorName, trimmed)
      } else if (tx.type === 'Loan') {
        const loanId = tx.id.replace(/:lender$/, '')
        await loanService.updateLoan(loanId, { auditStatus: 'Flagged', auditedBy: auditorName, auditDate: today, auditNotes: trimmed })
      } else if (tx.type === 'Income') {
        const leaseId = tx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
        await tenantService.saveAuditReview(leaseId, 'Flagged', trimmed)
      }
      setIsDiscrepancyModalOpen(false)
      setDiscrepancyReason('')
      setActiveMenuTx(null)
    } catch (err: any) {
      notifyError(err, 'Failed to flag audit discrepancy. Please try again.')
    } finally {
      setIsSubmittingAudit(false)
    }
  }

  const handleTransactionUpdated = (updatedItem: DashboardTransactionItem) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === updatedItem.id && t.type === updatedItem.type ? updatedItem : t))
    )
    setSelectedTx(updatedItem)
  }

  const handleSaveRemarks = async () => {
    if (!remarksTargetTx) return
    setIsSavingRemarks(true)
    try {
      const trimmed = remarksInput.trim()
      const isExp = remarksTargetTx.type === 'Expense' || remarksTargetTx.type === 'Bill'
      if (isExp) {
        const updatedExpense = await expenseService.updateExpenseRemarks(remarksTargetTx.id, trimmed)
        const tx = expenseService.toDashboardTransaction(updatedExpense)
        handleTransactionUpdated(tx)
      } else {
        const updatedSale = await salesService.updateSaleRemarks(remarksTargetTx.id, trimmed)
        const tx = salesService.toDashboardTransaction(updatedSale)
        handleTransactionUpdated(tx)
      }
      notifySuccess(trimmed ? 'Remarks updated successfully' : 'Remarks removed successfully')
      setIsRemarksDialogOpen(false)
      setRemarksTargetTx(null)
    } catch (err: any) {
      notifyError(err, 'Failed to update remarks')
    } finally {
      setIsSavingRemarks(false)
    }
  }

  // Export CSV handler
  const handleExportCsv = () => {
    const isDeposit = activeTab === 'deposit'
    const headers = isDeposit
      ? ['DEPOSIT DATE', 'COMPANY', 'TYPE', 'CHEQUE NO.', 'PARTICULARS', 'CATEGORY', 'DEPOSIT', 'WITHDRAWAL', 'BALANCE', 'AUDIT STATUS']
      : ['SALES DATE', 'DEPOSIT DAY', 'COMPANY', 'TYPE', 'REF NO.', 'PARTICULARS', 'PAYMENT METHOD', 'DEPOSIT', 'WITHDRAWAL', 'NET AMOUNT', 'STATUS', 'AUDIT STATUS']

    const rows = (isDeposit ? filteredDepositTransactions : filteredSalesTransactions).map((t) => {
      const { deposit, withdrawal } = getRowAmounts(t)
      if (isDeposit) {
        return [
          csvCell(t.date),
          csvCell(t.company),
          csvCell(t.type),
          csvCell(t.chequeNo || '—'),
          csvCell(t.particulars || t.description),
          csvCell(t.category),
          deposit || 0,
          withdrawal || 0,
          depositBalanceByKey.get(`${t.type}:${t.id}`) ?? 0,
          csvCell(t.auditStatus || 'Pending Audit'),
        ]
      }
      return [
        csvCell(t.date),
        csvCell(getDepositDayShort(t) || ''),
        csvCell(t.company),
        csvCell(t.type),
        csvCell(t.refNo || '—'),
        csvCell(t.particulars || t.description),
        csvCell(t.paymentMethod || 'Cash'),
        deposit || 0,
        withdrawal || 0,
        Math.round(((deposit || 0) - (withdrawal || 0)) * 100) / 100,
        csvCell(t.status || 'Paid'),
        csvCell(t.auditStatus || 'Pending Audit'),
      ]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `mct_${activeTab}_records_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setIsExportDropdownOpen(false)
  }

  // Export PDF handler
  const handleExportPdf = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      notifyWarning('Pop-up blocked. Please allow pop-ups for this site to export PDF.')
      return
    }

    const isDeposit = activeTab === 'deposit'
    const records = isDeposit ? filteredDepositTransactions : filteredSalesTransactions

    const fmtAmt = (n: number) =>
      n > 0 ? `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'
    // Signed amount for the Balance and Net Amount columns (zero and negative values still show)
    const fmtSigned = (n: number) =>
      `${n < 0 ? '-' : ''}₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

    const rowsHtml =
      records.length === 0
        ? `<tr><td colspan="${isDeposit ? 10 : 12}" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No ${isDeposit ? 'deposit' : 'transaction'} records found for this selection.</td></tr>`
        : records
            .map((tx) => {
              const { deposit, withdrawal } = getRowAmounts(tx)
              if (isDeposit) {
                return `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.date)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(tx.company || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.type)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${escapeHtml(tx.chequeNo || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.particulars || tx.description)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.category)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 700;">${fmtAmt(deposit)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #dc2626; font-weight: 700;">${fmtAmt(withdrawal)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">${fmtSigned(depositBalanceByKey.get(`${escapeHtml(tx.type)}:${tx.id}`) ?? 0)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${tx.auditStatus === 'Verified' ? 'Audited' : 'Pending Audit'}</td>
        </tr>
      `
              }
              return `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.date)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(getDepositDayShort(tx) || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(tx.company || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.type)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-size: 11px;">${escapeHtml(tx.refNo || '—')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.particulars || tx.description)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(tx.paymentMethod || 'Cash')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a; font-weight: 700;">${fmtAmt(deposit)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #dc2626; font-weight: 700;">${fmtAmt(withdrawal)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700;">${fmtSigned(Math.round((deposit - withdrawal) * 100) / 100)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(tx.status || 'Paid')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${tx.auditStatus === 'Verified' ? 'Audited' : 'Pending Audit'}</td>
        </tr>
      `
            })
            .join('')

    const displayedTitle = !canSelectAllCompanies
      ? (effectiveTargetCompany || 'Assigned Subsidiary')
      : selectedCompany !== 'All Companies'
      ? selectedCompany
      : 'All Subsidiaries'

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${isDeposit ? 'Bank Ledger' : 'All Transactions'} Report - ${displayedTitle}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding: 24px; }
            h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; color: #960C01; }
            p { font-size: 12px; color: #64748B; margin: 0 0 16px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; border-bottom: 2px solid #CBD5E1; }
            .summary { margin-top: 20px; padding: 12px 16px; background-color: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 12px; }
            @media print {
              body { padding: 10px; }
              @page { size: landscape; margin: 10mm; }
            }
          </style>
        </head>
        <body>
          <h1>MCT Group of Companies</h1>
          <p>Consolidated <strong>${isDeposit ? 'Bank Ledger' : 'All Transactions'}</strong> for <strong>${displayedTitle}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>${isDeposit ? 'Deposit Date' : 'Sales Date'}</th>
                ${!isDeposit ? '<th>Deposit Day</th>' : ''}
                <th>Company</th>
                <th>Type</th>
                <th>${isDeposit ? 'Cheque No.' : 'Ref No.'}</th>
                <th>Particulars</th>
                <th>${isDeposit ? 'Category' : 'Payment Method'}</th>
                <th style="text-align: right;">Deposit</th>
                <th style="text-align: right;">Withdrawal</th>
                <th style="text-align: right;">${isDeposit ? 'Balance' : 'Net Amount'}</th>
                ${!isDeposit ? '<th>Status</th>' : ''}
                <th>Audit Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Records:</strong> ${records.length}</div>
            ${isDeposit ? `<div><strong>Starting Balance:</strong> ${fmtSigned(activeStartingBalance)}</div>` : ''}
            ${isDeposit ? `<div><strong>Ending Balance:</strong> ${fmtSigned(activeEndingBalance)}</div>` : ''}
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
    setIsExportDropdownOpen(false)
  }

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300 select-none">
      {/* 1. Header & Actions Block */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
              Transactions
            </h1>

            {/* Dismissible "?" Help Popover beside title (no background box) */}
            <div ref={helpPopoverRef} className="relative inline-flex items-center">
              <button
                type="button"
                onClick={() => setIsHelpOpen((prev) => !prev)}
                aria-label="Help: How Bank Ledger and All Transactions work"
                aria-expanded={isHelpOpen}
                aria-haspopup="dialog"
                className={cn(
                  'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full text-muted-fg hover:text-focus transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  isHelpOpen && 'text-focus'
                )}
                title="About these tabs"
              >
                <HelpCircle className="h-5 w-5" />
              </button>

              {isHelpOpen && (
                <div
                  role="dialog"
                  aria-label="Tab guide"
                  className="absolute left-0 top-full mt-1.5 w-[min(calc(100vw-2rem),380px)] rounded-2xl border border-stroke/40 bg-white p-4 shadow-2xl z-50 animate-in fade-in-50 zoom-in-95 duration-150 text-left"
                >
                  <div className="flex items-start justify-between gap-2 pb-2 mb-2.5 border-b border-stroke/20">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-focus">
                      How these views work
                    </h2>
                    <button
                      type="button"
                      onClick={() => setIsHelpOpen(false)}
                      aria-label="Dismiss help popover"
                      className="p-1.5 -m-1 rounded-lg text-muted-fg hover:text-focus hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                    <p>
                      <strong className="text-focus">Bank Ledger:</strong> Uses the{' '}
                      <strong className="text-focus">deposit / ledger date</strong>. Shows money in and out of the company bank (deposited sales, paid expenses/withdrawals, and approved movements), with a running bank balance. Unpaid or not-yet-deposited sales stay in All Transactions until banked.
                    </p>
                    <p>
                      <strong className="text-focus">All Transactions:</strong> Uses each entry&apos;s{' '}
                      <strong className="text-focus">transaction date</strong>. Lists every sale (Sold → Paid → Deposited → Audited) and expense/withdrawal (stored payment status → Audited), including unpaid and awaiting deposit/transfer items.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1 truncate">
            {(() => {
              const specificCompanies = availableCompanyOptions.filter((c) => c !== 'All Companies')
              const scopedCompany = !canSelectAllCompanies
                ? effectiveTargetCompany
                : selectedCompany !== 'All Companies'
                ? selectedCompany
                : specificCompanies.length === 1
                ? specificCompanies[0]
                : ''
              return scopedCompany
                ? `Financial ledger for ${scopedCompany}`
                : 'Bank ledger and all sales and withdrawals across companies'
            })()}
          </p>
        </div>

        {/* Top Right Action Buttons: Sort, Refresh, and Red Export Dropdown (kept on one row) */}
        <div className="flex flex-nowrap items-center gap-2 shrink-0 whitespace-nowrap self-start md:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            className="min-h-[44px] h-11 px-3.5 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            title="Toggle chronological sorting order"
          >
            <ArrowUpDown className="h-4 w-4 text-focus/70 shrink-0" />
            <span>{sortOrder === 'desc' ? 'Latest first' : 'Oldest first'}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="min-h-[44px] h-11 px-3.5 sm:px-4 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            aria-label="Refresh transaction records"
          >
            <RotateCw
              className={`h-4 w-4 text-focus/70 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </Button>

          {/* Export Button with CSV & PDF options */}
          <div ref={exportDropdownRef} className="relative inline-block shrink-0">
            <Button
              type="button"
              disabled={activeDataset.length === 0}
              onClick={() => setIsExportDropdownOpen((prev) => !prev)}
              className="min-h-[44px] h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs inline-flex items-center gap-2 cursor-pointer transition-all box-border bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-50 whitespace-nowrap shrink-0"
              aria-haspopup="true"
              aria-expanded={isExportDropdownOpen}
              aria-label="Export transaction records"
            >
              <span>Export</span>
              <ChevronDown className="h-3.5 w-3.5 ml-0.5 text-white/90 shrink-0" />
            </Button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-surface transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Download as CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-surface transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Download as PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Primary Tab Switcher: Bank Ledger | All Transactions */}
      <div
        role="tablist"
        aria-label="Transactions views"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'deposit'}
          onClick={() => setActiveTab('deposit')}
          className={cn(
            'min-h-[64px] w-full rounded-[15px] px-5 py-3.5 text-left transition-all border cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 flex items-center justify-between gap-3',
            activeTab === 'deposit'
              ? 'bg-[#960C01] border-[#960C01] text-white shadow-xs'
              : 'bg-white border-stroke/40 text-focus hover:bg-surface/60'
          )}
        >
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold leading-tight">Bank Ledger</div>
            <div
              className={cn(
                'text-xs mt-0.5 leading-snug',
                activeTab === 'deposit' ? 'text-white/85' : 'text-muted-fg'
              )}
            >
              Money in and out of the bank
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums',
              activeTab === 'deposit' ? 'bg-white/20 text-white' : 'bg-surface text-focus/80'
            )}
          >
            {filteredDepositTransactions.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
          className={cn(
            'min-h-[64px] w-full rounded-[15px] px-5 py-3.5 text-left transition-all border cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 flex items-center justify-between gap-3',
            activeTab === 'all'
              ? 'bg-[#960C01] border-[#960C01] text-white shadow-xs'
              : 'bg-white border-stroke/40 text-focus hover:bg-surface/60'
          )}
        >
          <div className="min-w-0">
            <div className="text-sm sm:text-base font-bold leading-tight">All Transactions</div>
            <div
              className={cn(
                'text-xs mt-0.5 leading-snug',
                activeTab === 'all' ? 'text-white/85' : 'text-muted-fg'
              )}
            >
              Every sale and withdrawal, paid or unpaid
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums',
              activeTab === 'all' ? 'bg-white/20 text-white' : 'bg-surface text-focus/80'
            )}
          >
            {filteredSalesTransactions.length}
          </span>
        </button>
      </div>

      {/* 3. Main Workspace Card: Shared Filter Bar + Active Filter Chips + Table */}
      <div className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs space-y-4">
        {/* Shared Filter Bar (persists across tab switches) */}
        <div className="space-y-3">
          {/* Row 1: Company + Bank + Date Range + All Records / By Day toggle */}
          <div className="flex flex-col lg:flex-row lg:flex-wrap items-stretch lg:items-center justify-between gap-2.5 w-full">
            <div className="flex flex-1 flex-wrap sm:flex-nowrap items-center gap-2.5 min-w-0">
              {/* Company */}
              {canSelectAllCompanies || supervisorCompanies.length > 1 ? (
                <CompanyFilterDropdown
                  selectedCompany={selectedCompany}
                  companyList={availableCompanyOptions}
                  onSelectCompany={handleSelectCompany}
                  fullWidth
                  className="flex-1 min-w-[170px]"
                />
              ) : (
                <div
                  className="inline-flex items-center justify-between gap-2 min-h-[44px] h-11 flex-1 min-w-[170px] px-4 rounded-full border border-stroke/50 bg-surface/70 text-focus text-xs sm:text-sm font-semibold shadow-xs select-none"
                  title={effectiveTargetCompany}
                >
                  <span className="truncate min-w-0">{effectiveTargetCompany}</span>
                </div>
              )}

              {/* Bank */}
              {availableBankAccounts.length > 0 && (
                <BankAccountFilterDropdown
                  selectedAccountId={selectedBankAccountId}
                  bankAccounts={availableBankAccounts}
                  fullWidth
                  className="flex-1 min-w-[170px]"
                  onSelectAccount={(id) => {
                    setSelectedBankAccountId(id)
                    setDepositCurrentPage(1)
                    setSalesCurrentPage(1)
                  }}
                />
              )}

              {/* Date Range Control in Row 1 */}
              <div className="w-full sm:w-auto min-w-[190px] shrink-0">
                <TransactionDateRangeControl
                  value={dateRange}
                  onChange={(newRange) => {
                    setDateRange(newRange)
                    setDepositCurrentPage(1)
                    setSalesCurrentPage(1)
                  }}
                  fullWidth
                />
              </div>
            </div>

            {/* Day audit actions (Audit, By Day with a focused day) + All Records / By Day toggle */}
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              {canAudit && salesViewMode === 'daily_summary' && hasFocusedDay && (() => {
                const focusedTxs = visibleDayGroups.flatMap((g) => g.banks.flatMap((b) => b.transactions))
                const focusedDate = visibleDayGroups.map((g) => g.date).join(', ')
                const pendingCount = getDayAuditTargets(focusedTxs).length
                const disabledTitle = 'Every transaction on this day is already audited or flagged'
                return (
                  <>
                    <Button
                      type="button"
                      disabled={pendingCount === 0}
                      onClick={() => openDayAudit('Verified', focusedDate, focusedTxs)}
                      title={pendingCount === 0 ? disabledTitle : `Mark ${pendingCount} pending record(s) on ${focusedDate} as audited`}
                      className="min-h-[44px] h-11 px-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold shadow-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Mark as Audited{pendingCount > 0 ? ` (${pendingCount})` : ''}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pendingCount === 0}
                      onClick={() => openDayAudit('Flagged', focusedDate, focusedTxs)}
                      title={pendingCount === 0 ? disabledTitle : `Flag ${pendingCount} pending record(s) on ${focusedDate} as a discrepancy`}
                      className="min-h-[44px] h-11 px-4 rounded-full border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 text-xs sm:text-sm font-semibold shadow-xs inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Flag Discrepancy</span>
                    </Button>
                  </>
                )
              })()}
              {viewModeToggle}
            </div>
          </div>

          {/* Row 2: Full-width Search Bar using all available space */}
          <div className="relative w-full">
            <label htmlFor="transactions-search-input" className="sr-only">
              Search transactions
            </label>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
            <Input
              id="transactions-search-input"
              type="search"
              placeholder="Search particulars, Ref No., Cheque No., company, method…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setDepositCurrentPage(1)
                setSalesCurrentPage(1)
              }}
              className="min-h-[44px] h-11 pl-11 pr-4 rounded-full border border-stroke/50 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-2 focus-visible:ring-focus w-full"
            />
          </div>

          {/* Active Filter Chips Row */}
          {activeFilterChips.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 pt-0.5"
              aria-label="Active filters"
            >
              <span className="text-xs font-medium text-muted-fg">Active filters:</span>
              {activeFilterChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 min-h-[36px] pl-3 pr-1 rounded-full bg-surface border border-stroke/30 text-xs font-medium text-focus"
                >
                  <span className="truncate max-w-[220px]">{chip.label}</span>
                  <button
                    type="button"
                    onClick={chip.onClear}
                    aria-label={`Remove ${chip.label} filter`}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-full text-muted-fg hover:text-focus hover:bg-slate-200/70 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="min-h-[44px] px-2 text-xs font-semibold text-primary underline underline-offset-4 hover:text-primary-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-lg"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Summary meta bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          {salesViewMode === 'daily_summary' && hasFocusedDay ? (
            <button
              type="button"
              onClick={() => setExpandedDates(new Set())}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 rounded-xl border border-stroke/40 bg-surface/80 hover:bg-surface text-xs font-semibold text-focus transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to all {dailySummaryGroups.length} days</span>
            </button>
          ) : (
            <span className="text-xs text-muted-fg font-medium">
              Sorted by {activeTab === 'deposit' ? 'Deposit / ledger date' : typeFilter === 'Sales' ? 'Sales date' : typeFilter === 'Expenses' ? 'Expense date' : 'Transaction date'}, {sortOrder === 'desc' ? 'latest first' : 'oldest first'}
            </span>
          )}
        </div>
        {salesViewMode === 'daily_summary' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <Table className="w-full min-w-[760px] lg:min-w-0 table-fixed">
              <colgroup>
                {(activeTab === 'deposit'
                  ? [14, 18, 17, 17, 18, 16]
                  : (showActionColumn
                    ? showDayBalanceColumn
                      ? showDayCompanyColumn
                        ? [12, 12, 10, 12, 12, 12, 13, 11, 6]
                        : [15, 12, 14, 14, 14, 14, 11, 6]
                      : showDayCompanyColumn
                      ? [14, 14, 11, 14, 14, 14, 13, 6]
                      : [17, 13, 16, 16, 16, 15, 7]
                    : showDayBalanceColumn
                    ? showDayCompanyColumn
                      ? [13, 13, 11, 13, 13, 13, 13, 11]
                      : [16, 13, 15, 15, 15, 14, 12]
                    : showDayCompanyColumn
                    ? [15, 15, 12, 15, 15, 15, 13]
                    : [19, 14, 17, 17, 17, 16])
                ).map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <TableHeader>
                {activeTab === 'deposit' ? (
                  <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                      DATE
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                      CHECK NO
                    </TableHead>
                    <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                      WITHDRAWAL
                    </TableHead>
                    <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                      DEPOSIT
                    </TableHead>
                    <TableHead
                      className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right"
                      title="Balance of the bank"
                    >
                      BALANCE
                    </TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                      TRAN-CODE
                    </TableHead>
                  </TableRow>
                ) : (
                  <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">DATE</TableHead>
                    {showDayCompanyColumn && (
                      <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">COMPANY</TableHead>
                    )}
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">TRANSACTIONS</TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">MONEY IN</TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">MONEY OUT</TableHead>
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">NET</TableHead>
                    {showDayBalanceColumn && (
                      <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right" title="End-of-day balance">BANK BALANCE</TableHead>
                    )}
                    <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">AUDIT STATUS</TableHead>
                    {showActionColumn && (
                      <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">ACTION</TableHead>
                    )}
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={dayColCount} className="py-12 text-center text-sm text-muted-fg">
                      <Loader2 className="w-6 h-6 animate-spin text-primary inline-block" />
                    </TableCell>
                  </TableRow>
                ) : visibleDayGroups.length === 0 ? (
                  <TableEmptyState
                    colSpan={dayColCount}
                    title="No daily records found"
                    message="No transactions match the selected company and filters."
                  />
                ) : (
                  visibleDayGroups.map((group) => {
                    const isExpanded = expandedDates.has(group.id)
                    const parsed = new Date(`${group.date}T00:00:00`)
                    const validDate = !isNaN(parsed.getTime())
                    const dayTxs = group.banks.flatMap((b) => b.transactions)

                    if (activeTab === 'deposit') {
                      return (
                        <TableRow
                          key={group.id}
                          className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors"
                        >
                          {/* 1. DATE - NO CHEVRON */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-medium text-focus whitespace-nowrap">
                            {validDate
                              ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : group.date}
                          </TableCell>

                          {/* 2. CHECK NO */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-mono text-focus/80 truncate">
                            {Array.from(new Set(dayTxs.map((t) => t.chequeNo).filter(Boolean))).join(', ') || '—'}
                          </TableCell>

                          {/* 3. WITHDRAWAL */}
                          <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-rose-700">
                            {group.dayTotalWithdrawal > 0 ? (
                              `−${formatPHP(group.dayTotalWithdrawal)}`
                            ) : (
                              <span className="text-muted-fg/40 font-normal">—</span>
                            )}
                          </TableCell>

                          {/* 4. DEPOSIT */}
                          <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-emerald-700">
                            {group.dayTotalDeposit > 0 ? (
                              `+${formatPHP(group.dayTotalDeposit)}`
                            ) : (
                              <span className="text-muted-fg/40 font-normal">—</span>
                            )}
                          </TableCell>

                          {/* 5. BALANCE */}
                          <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap">
                            {(() => {
                              const bal = getClosingBalance(group.date)
                              if (bal === null) return <span className="text-muted-fg">—</span>
                              return (
                                <span className={bal < 0 ? 'text-rose-600' : 'text-focus'}>
                                  {bal < 0 ? `−${formatPHP(Math.abs(bal))}` : formatPHP(bal)}
                                </span>
                              )
                            })()}
                          </TableCell>

                          {/* 6. TRAN-CODE */}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-mono text-focus/80 truncate">
                            {Array.from(new Set(dayTxs.map((t) => t.refNo || (t as any).reference_no).filter(Boolean))).join(', ') || '—'}
                          </TableCell>
                        </TableRow>
                      )
                    }

                    return (
                      <React.Fragment key={group.id}>
                        <TableRow
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onClick={() => toggleDateExpansion(group.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleDateExpansion(group.id)
                            }
                          }}
                          title={isExpanded ? 'Click to return to all days' : 'Click row to focus and view all transactions for this day'}
                          className={cn(
                            'border-b border-slate-100 transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
                            isExpanded ? 'bg-slate-50/90 font-medium' : 'hover:bg-slate-50/50'
                          )}
                        >
                          <TableCell className="px-2.5 sm:px-3 py-3 text-left">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-primary shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-fg shrink-0" />
                              )}
                              <span className="text-xs font-bold text-focus truncate">
                                {validDate
                                  ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                  : group.date}
                              </span>
                            </div>
                          </TableCell>
                          {showDayCompanyColumn && (
                            <TableCell className="px-2.5 sm:px-3 py-3 text-left text-xs">
                              {group.company ? (
                                <span
                                  className="inline-flex max-w-full items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200"
                                  title={group.company}
                                >
                                  <span className="truncate">{group.company}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-muted-fg">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-center text-xs">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-focus border border-slate-200">
                              {group.dayTransactionCount} {group.dayTransactionCount === 1 ? 'item' : 'items'}
                            </span>
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-3 text-right font-bold tabular-nums text-emerald-700 text-xs whitespace-nowrap">
                            {group.dayTotalDeposit > 0 ? `+${formatPHP(group.dayTotalDeposit)}` : '—'}
                          </TableCell>
                          <TableCell className="px-2.5 sm:px-3 py-3 text-right font-bold tabular-nums text-rose-700 text-xs whitespace-nowrap">
                            {group.dayTotalWithdrawal > 0 ? `−${formatPHP(group.dayTotalWithdrawal)}` : '—'}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'px-2.5 sm:px-3 py-3 text-right font-bold tabular-nums text-xs whitespace-nowrap',
                              group.dayNetMovement < 0 ? 'text-rose-700' : 'text-focus'
                            )}
                          >
                            {group.dayNetMovement < 0
                              ? `−${formatPHP(Math.abs(group.dayNetMovement))}`
                              : `+${formatPHP(group.dayNetMovement)}`}
                          </TableCell>
                          {showDayBalanceColumn && (
                            <TableCell className="px-2.5 sm:px-3 py-3 text-right font-bold tabular-nums text-xs whitespace-nowrap">
                              {(() => {
                                const bal = getClosingBalance(group.date)
                                if (bal === null) return <span className="text-muted-fg">—</span>
                                return (
                                  <span className={bal < 0 ? 'text-rose-600' : 'text-focus'}>
                                    {bal < 0 ? `−${formatPHP(Math.abs(bal))}` : formatPHP(bal)}
                                  </span>
                                )
                              })()}
                            </TableCell>
                          )}
                          <TableCell className="px-2.5 sm:px-3 py-3 text-center text-xs">
                            {(() => {
                              const flagged = dayTxs.some((t) => t.auditStatus === 'Flagged')
                              const pending = dayTxs.filter((t) => t.auditStatus !== 'Verified' && t.auditStatus !== 'Flagged').length
                              const label = flagged ? 'Discrepancy' : pending > 0 ? `${pending} Pending` : 'All Audited'
                              return (
                                <span
                                  className={cn(
                                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border',
                                    flagged
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : pending > 0
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  )}
                                >
                                  {label}
                                </span>
                              )
                            })()}
                          </TableCell>
                          {showActionColumn && (
                            <TableCell className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (dayMenu?.date === group.id) {
                                    setDayMenu(null)
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const openUpward = rect.bottom + 120 > window.innerHeight
                                    setDayMenu({
                                      date: group.id,
                                      top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                      right: Math.max(12, window.innerWidth - rect.right),
                                      openUpward,
                                    })
                                  }
                                }}
                                className="h-9 w-9 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors"
                                title={canAudit ? 'Audit & day actions' : 'Day actions'}
                                aria-label="Open day action menu"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="bg-slate-50/40 border-b border-slate-200 hover:bg-slate-50/40">
                            <TableCell colSpan={dayColCount} className="p-2.5 sm:p-3.5">
                              <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-x-auto">
                                <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-focus">
                                  <span>
                                    Transactions on {group.date}{group.company ? ` · ${group.company}` : ''}
                                  </span>
                                </div>
                                <table className="w-full min-w-[820px] lg:min-w-0 table-fixed text-left text-xs">
                                  <colgroup>
                                    {(activeTab === 'deposit'
                                      ? [14, 18, 17, 17, 18, 16]
                                      : showActionColumn
                                      ? [9, 23, 8, 11, 9, 9, 11, 14, 6]
                                      : [9, 25, 9, 12, 9, 9, 12, 15]
                                    ).map((w, i) => (
                                      <col key={i} style={{ width: `${w}%` }} />
                                    ))}
                                  </colgroup>
                                  <thead className="bg-slate-100/60 text-muted-fg text-xs font-bold uppercase tracking-wider border-b border-slate-100">
                                    {activeTab === 'deposit' ? (
                                      <tr>
                                        <th className="px-2.5 sm:px-3 py-2.5 font-bold text-left">DATE</th>
                                        <th className="px-2.5 sm:px-3 py-2.5 font-bold text-left">CHECK NO</th>
                                        <th className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right">WITHDRAWAL</th>
                                        <th className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right">DEPOSIT</th>
                                        <th className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right" title="Balance of the bank">BALANCE</th>
                                        <th className="px-2.5 sm:px-3 py-2.5 font-bold text-left">TRAN-CODE</th>
                                      </tr>
                                    ) : (
                                      <tr>
                                        <th className="px-2 py-2.5 font-bold text-left">DATE</th>
                                        <th className="px-2.5 sm:px-3 py-2.5 font-bold text-left">PARTICULARS</th>
                                        <th className="px-2 py-2.5 font-bold text-left">METHOD</th>
                                        <th className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right">AMOUNT</th>
                                        <th className="px-2 py-2.5 font-bold text-left">CHEQUE NO.</th>
                                        <th className="px-2 py-2.5 font-bold text-left">DEPOSIT DATE</th>
                                        <th className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right">AMOUNT DEPOSIT</th>
                                        <th className="pl-3 pr-2 py-2.5 font-bold text-center">STATUS</th>
                                        {showActionColumn && (
                                          <th className="px-1.5 py-2.5 font-bold text-center">ACTION</th>
                                        )}
                                      </tr>
                                    )}
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 text-xs">
                                    {dayTxs.map((tx) => {
                                      const { deposit, withdrawal } = getRowAmounts(tx)
                                      const rowAmt = tx.amount || (deposit > 0 ? deposit : withdrawal)
                                      const depositedAmt = getDepositedAmountForRow(tx)
                                      const lifecycle = deriveTransactionLifecycle(tx)
                                      const typeMeta = getTransactionTypeMeta(tx)
                                      const { title, itemCount } = getCleanParticularsTitle(
                                        tx.particulars || tx.description,
                                        tx.items,
                                        rowAmt
                                      )
                                      const saleDateShort = toLedgerDate(getRowSaleDateIso(tx)) || tx.date
                                      const depDateShort = lifecycle.effectiveDepositDate
                                        ? toLedgerDate(lifecycle.effectiveDepositDate)
                                        : getDepositDayShort(tx)
                                      const rowBal =
                                        activeTab === 'deposit'
                                          ? depositBalanceByKey.get(`${tx.type}:${tx.id}`) ?? 0
                                          : null
                                      const txKey = `${tx.type}:${tx.id}`

                                      if (activeTab === 'deposit') {
                                        return (
                                          <tr
                                            key={txKey}
                                            onClick={() => handleRowClick(tx)}
                                            title="Click to view transaction details and audit history"
                                            className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                                          >
                                            <td className="px-2.5 sm:px-3 py-2.5 font-medium text-focus whitespace-nowrap">
                                              {saleDateShort}
                                            </td>
                                            <td className="px-2.5 sm:px-3 py-2.5 font-mono text-focus/80 truncate">
                                              {tx.chequeNo || '—'}
                                            </td>
                                            <td className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right tabular-nums whitespace-nowrap text-rose-700">
                                              {withdrawal > 0 ? formatPHP(withdrawal) : <span className="text-muted-fg/40 font-normal">—</span>}
                                            </td>
                                            <td className="pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right tabular-nums whitespace-nowrap text-emerald-700">
                                              {deposit > 0 ? formatPHP(deposit) : <span className="text-muted-fg/40 font-normal">—</span>}
                                            </td>
                                            <td
                                              className={cn(
                                                'pl-2 pr-3 sm:pr-4 py-2.5 font-bold text-right tabular-nums whitespace-nowrap',
                                                (rowBal ?? 0) < 0 ? 'text-rose-600' : 'text-focus'
                                              )}
                                              title="Balance of the bank"
                                            >
                                              {(rowBal ?? 0) < 0
                                                ? `−${formatPHP(Math.abs(rowBal ?? 0))}`
                                                : formatPHP(rowBal ?? 0)}
                                            </td>
                                            <td className="px-2.5 sm:px-3 py-2.5 font-mono text-focus/80 truncate">
                                              {tx.refNo || '—'}
                                            </td>
                                          </tr>
                                        )
                                      }

                                      return (
                                        <tr
                                          key={txKey}
                                          onClick={() => handleRowClick(tx)}
                                          title="Click to view transaction details and audit history"
                                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                                        >
                                          {/* 1. Date */}
                                          <td className="px-2 py-3 text-xs font-medium text-focus whitespace-nowrap align-top">
                                            {saleDateShort}
                                          </td>

                                          {/* 2. Particulars: Title, Company, Ref (No Cheque) */}
                                          <td className="px-2.5 py-3 text-xs align-top">
                                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                              <span className="font-semibold text-focus break-words leading-snug">
                                                {title}
                                              </span>
                                              {itemCount > 1 && (
                                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                                  +{itemCount - 1} more
                                                </span>
                                              )}
                                              {lifecycle.overdueLabel && (
                                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                                                  {lifecycle.overdueLabel}
                                                </span>
                                              )}
                                            </div>
                                            {tx.company && (
                                              <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                                                {tx.company}
                                              </div>
                                            )}
                                            <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                                              {tx.refNo || '—'}
                                            </div>
                                          </td>

                                          {/* 3. Method */}
                                          <td className="px-2 py-3 text-xs text-focus/90 font-medium truncate align-top">
                                            {tx.paymentMethod || 'Cash'}
                                          </td>

                                          {/* 4. Amount */}
                                          <td
                                            className={cn(
                                              'pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top',
                                              typeMeta.isOutflow ? 'text-rose-700' : 'text-emerald-700'
                                            )}
                                          >
                                            {formatSignedTransactionAmount(tx, rowAmt, formatPHP)}
                                          </td>

                                          {/* 5. Cheque No. */}
                                          <td className="px-2 py-3 text-xs font-mono text-focus/80 truncate align-top">
                                            {tx.chequeNo || '—'}
                                          </td>

                                          {/* 6. Deposit Date */}
                                          <td className="px-2 py-3 text-xs font-medium whitespace-nowrap align-top">
                                            {depDateShort ? (
                                              <span className="text-emerald-700">{depDateShort}</span>
                                            ) : (
                                              <span className="text-muted-fg/50">—</span>
                                            )}
                                          </td>

                                          {/* 7. Deposit Amount */}
                                          <td className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top">
                                            {depositedAmt > 0 ? (
                                              <span className="text-emerald-700">{formatPHP(depositedAmt)}</span>
                                            ) : (
                                              <span className="text-muted-fg/50 font-normal">—</span>
                                            )}
                                          </td>

                                          {/* 8. Status */}
                                          <td className="pl-3 pr-2 py-3 text-center align-top">
                                            <TransactionStatusBadge lifecycle={lifecycle} />
                                          </td>

                                          {/* 9. Action */}
                                          {showActionColumn && (
                                            <td className="px-1.5 py-2.5 text-center whitespace-nowrap align-top" onClick={(e) => e.stopPropagation()}>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  if (openMenuTxId === txKey) {
                                                    setOpenMenuTxId(null)
                                                    setMenuPosition(null)
                                                    setActiveMenuTx(null)
                                                  } else {
                                                    const rect = e.currentTarget.getBoundingClientRect()
                                                    const openUpward = rect.bottom + 160 > window.innerHeight
                                                    setMenuPosition({
                                                      top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                                      right: Math.max(12, window.innerWidth - rect.right),
                                                      openUpward,
                                                    })
                                                    setActiveMenuTx(tx)
                                                    setOpenMenuTxId(txKey)
                                                  }
                                                }}
                                                className="h-9 w-9 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors"
                                                title={canAudit ? 'Audit & transaction actions' : 'Actions'}
                                                aria-label={canAudit ? 'Open audit action menu' : 'Open action menu'}
                                              >
                                                <MoreVertical className="w-4 h-4" />
                                              </Button>
                                            </td>
                                          )}
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                  <tfoot className="bg-slate-50/90 border-t border-slate-200 text-xs font-semibold">
                                    <tr>
                                      <td colSpan={2} className="px-2.5 py-2.5 text-muted-fg">
                                        Day totals
                                      </td>
                                      <td colSpan={activeTab === 'deposit' ? 4 : (showActionColumn ? 7 : 6)} className="px-2.5 py-2.5 text-right tabular-nums">
                                        <span className="text-emerald-700 mr-3">Money In: +{formatPHP(group.dayTotalDeposit)}</span>
                                        <span className="text-rose-700 mr-3">Money Out: −{formatPHP(group.dayTotalWithdrawal)}</span>
                                        <span className={group.dayNetMovement < 0 ? 'text-rose-700' : 'text-focus'}>
                                          Net: {group.dayNetMovement < 0 ? `−${formatPHP(Math.abs(group.dayNetMovement))}` : `+${formatPHP(group.dayNetMovement)}`}
                                        </span>
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full min-w-[860px] lg:min-w-0 table-fixed">
            <colgroup>
              {(activeTab === 'deposit'
                ? [14, 18, 17, 17, 18, 16]
                : showActionColumn
                ? [9, 23, 8, 11, 9, 9, 11, 14, 6]
                : [9, 25, 9, 12, 9, 9, 12, 15]
              ).map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <TableHeader>
              {activeTab === 'deposit' ? (
                <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    DATE
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    CHECK NO
                  </TableHead>
                  <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                    WITHDRAWAL
                  </TableHead>
                  <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                    DEPOSIT
                  </TableHead>
                  <TableHead
                    className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right"
                    title="Balance of the bank"
                  >
                    BALANCE
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    TRAN-CODE
                  </TableHead>
                </TableRow>
              ) : (
                <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                  <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    DATE
                  </TableHead>
                  <TableHead className="px-2.5 sm:px-3 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    PARTICULARS
                  </TableHead>
                  <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    METHOD
                  </TableHead>
                  <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                    AMOUNT
                  </TableHead>
                  <TableHead className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                    CHEQUE NO.
                  </TableHead>
                  <TableHead
                    className="px-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-left"
                    title="Day the sale's money was deposited or transferred; empty until deposited"
                  >
                    DEPOSIT DATE
                  </TableHead>
                  <TableHead
                    className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-right"
                    title="Amount actually deposited to the bank; empty until deposited"
                  >
                    AMOUNT DEPOSIT
                  </TableHead>
                  <TableHead className="pl-3 pr-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                    STATUS
                  </TableHead>
                  {showActionColumn && (
                    <TableHead className="px-1.5 py-3 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                      ACTION
                    </TableHead>
                  )}
                </TableRow>
              )}
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-slate-100">
                    {activeTab === 'deposit' ? (
                      <>
                        <TableCell className="px-2.5 sm:px-3 py-3"><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                        <TableCell className="px-2.5 sm:px-3 py-3"><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-right"><Skeleton className="h-4 w-24 rounded-md ml-auto" /></TableCell>
                        <TableCell className="px-2.5 sm:px-3 py-3"><Skeleton className="h-4 w-24 rounded-md" /></TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="px-2 py-3"><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                        <TableCell className="px-2.5 sm:px-3 py-3"><Skeleton className="h-4 w-44 rounded-md" /></TableCell>
                        <TableCell className="px-2 py-3"><Skeleton className="h-4 w-14 rounded-md" /></TableCell>
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                        <TableCell className="px-2 py-3"><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                        <TableCell className="px-2 py-3"><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                        <TableCell className="pl-3 pr-2 py-3 text-center"><Skeleton className="h-5 w-24 rounded-full mx-auto" /></TableCell>
                        {showActionColumn && (
                          <TableCell className="px-1.5 py-3 text-center">
                            <Skeleton className="h-7 w-7 rounded-lg mx-auto" />
                          </TableCell>
                        )}
                      </>
                    )}
                  </TableRow>
                ))
              ) : (activeTab === 'deposit' ? displayedDepositTransactions : displayedSalesTransactions).length === 0 ? (
                <TableEmptyState
                  colSpan={activeTab === 'deposit' ? 6 : (8 + (showActionColumn ? 1 : 0))}
                  title={`No ${activeTab === 'deposit' ? 'bank ledger' : 'transaction'} records found`}
                  message="No records match your active company, date range, or search criteria."
                />
              ) : (
                (activeTab === 'deposit' ? displayedDepositTransactions : displayedSalesTransactions).map((tx) => {
                  const { deposit: depositAmt, withdrawal: withdrawalAmt } = getRowAmounts(tx)
                  const rowAmt = tx.amount || (depositAmt > 0 ? depositAmt : withdrawalAmt)
                  const depositedAmt = getDepositedAmountForRow(tx)
                  const lifecycle = deriveTransactionLifecycle(tx)
                  const typeMeta = getTransactionTypeMeta(tx)
                  const { title, itemCount } = getCleanParticularsTitle(
                    tx.particulars || tx.description,
                    tx.items,
                    rowAmt
                  )
                  const saleDateShort = toLedgerDate(getRowSaleDateIso(tx)) || tx.date
                  const depDateShort = lifecycle.effectiveDepositDate
                    ? toLedgerDate(lifecycle.effectiveDepositDate)
                    : getDepositDayShort(tx)
                  const rowBalance =
                    activeTab === 'deposit'
                      ? depositBalanceByKey.get(`${tx.type}:${tx.id}`) ?? 0
                      : null

                  const txKey = `${tx.type}:${tx.id}`

                  if (activeTab === 'deposit') {
                    return (
                      <TableRow
                        key={txKey}
                        onClick={() => handleRowClick(tx)}
                        title="Click to view transaction details and audit history"
                        className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
                      >
                        {/* 1. DATE */}
                        <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-medium text-focus whitespace-nowrap">
                          {saleDateShort}
                        </TableCell>

                        {/* 2. CHECK NO */}
                        <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-mono text-focus/80 truncate">
                          {tx.chequeNo || '—'}
                        </TableCell>

                        {/* 3. WITHDRAWAL */}
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-rose-700">
                          {withdrawalAmt > 0 ? formatPHP(withdrawalAmt) : <span className="text-muted-fg/40 font-normal">—</span>}
                        </TableCell>

                        {/* 4. DEPOSIT */}
                        <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap text-emerald-700">
                          {depositAmt > 0 ? formatPHP(depositAmt) : <span className="text-muted-fg/40 font-normal">—</span>}
                        </TableCell>

                        {/* 5. BALANCE */}
                        <TableCell
                          className={cn(
                            'pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap',
                            (rowBalance ?? 0) < 0 ? 'text-rose-600' : 'text-focus'
                          )}
                          title="Balance of the bank"
                        >
                          {(rowBalance ?? 0) < 0
                            ? `−${formatPHP(Math.abs(rowBalance ?? 0))}`
                            : formatPHP(rowBalance ?? 0)}
                        </TableCell>

                        {/* 6. TRAN-CODE */}
                        <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-mono text-focus/80 truncate">
                          {tx.refNo || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  }

                  return (
                    <TableRow
                      key={txKey}
                      onClick={() => handleRowClick(tx)}
                      title="Click to view transaction details and audit history"
                      className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
                    >
                      {/* 1. Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium text-focus whitespace-nowrap align-top">
                        {saleDateShort}
                      </TableCell>

                      {/* 2. Particulars: Title on Line 1, Company on Line 2, Ref on Line 3 (No cheque, no badge) */}
                      <TableCell className="px-2.5 sm:px-3 py-3 text-xs text-focus/90 align-top" title={tx.particulars || tx.description}>
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-focus break-words leading-snug">
                            {title}
                          </span>
                          {itemCount > 1 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                              +{itemCount - 1} more
                            </span>
                          )}
                          {lifecycle.overdueLabel && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                              {lifecycle.overdueLabel}
                            </span>
                          )}
                        </div>
                        {tx.company && (
                          <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                            {tx.company}
                          </div>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                          {tx.refNo || '—'}
                        </div>
                      </TableCell>

                      {/* 3. Method */}
                      <TableCell className="px-2 py-3 text-xs text-focus/90 font-medium truncate align-top">
                        {tx.paymentMethod || 'Cash'}
                      </TableCell>

                      {/* 4. Signed Gross Amount */}
                      <TableCell
                        className={cn(
                          'pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top',
                          typeMeta.isOutflow ? 'text-rose-700' : 'text-emerald-700'
                        )}
                      >
                        {formatSignedTransactionAmount(tx, rowAmt, formatPHP)}
                      </TableCell>

                      {/* 5. Cheque No. */}
                      <TableCell className="px-2 py-3 text-xs font-mono text-focus/80 truncate align-top">
                        {tx.chequeNo || '—'}
                      </TableCell>

                      {/* 6. Deposit Date */}
                      <TableCell className="px-2 py-3 text-xs font-medium whitespace-nowrap align-top">
                        {depDateShort ? (
                          <span className="text-emerald-700">{depDateShort}</span>
                        ) : (
                          <span className="text-muted-fg/50">—</span>
                        )}
                      </TableCell>

                      {/* 7. Deposit Amount */}
                      <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top">
                        {depositedAmt > 0 ? (
                          <span className="text-emerald-700">{formatPHP(depositedAmt)}</span>
                        ) : (
                          <span className="text-muted-fg/50 font-normal">—</span>
                        )}
                      </TableCell>

                      {/* 8. Status Badge */}
                      <TableCell className="pl-3 pr-2 py-3 text-center align-top">
                        <TransactionStatusBadge lifecycle={lifecycle} />
                      </TableCell>

                      {/* 9. Action: 3 dots action button */}
                      {showActionColumn && (
                        <TableCell
                          className="px-1.5 py-2.5 text-center whitespace-nowrap align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (openMenuTxId === txKey) {
                                  setOpenMenuTxId(null)
                                  setMenuPosition(null)
                                  setActiveMenuTx(null)
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const openUpward = rect.bottom + 160 > window.innerHeight
                                  setMenuPosition({
                                    top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                    right: Math.max(12, window.innerWidth - rect.right),
                                    openUpward,
                                  })
                                  setActiveMenuTx(tx)
                                  setOpenMenuTxId(txKey)
                                }
                              }}
                              className="h-9 w-9 p-0 rounded-lg text-focus/75 hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                              title={canAudit ? 'Audit & transaction actions' : 'Actions'}
                              aria-label={canAudit ? 'Open audit action menu' : 'Open action menu'}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}



        {/* 5. Pagination Footer */}
        {salesViewMode === 'all' && (
          <TablePagination
            currentPage={activeTab === 'deposit' ? depositCurrentPage : salesCurrentPage}
            totalPages={activeTab === 'deposit' ? depositTotalPages : salesTotalPages}
            totalRecords={activeTab === 'deposit' ? filteredDepositTransactions.length : filteredSalesTransactions.length}
            startIndex={((activeTab === 'deposit' ? depositCurrentPage : salesCurrentPage) - 1) * itemsPerPage}
            endIndex={Math.min(
              (activeTab === 'deposit' ? depositCurrentPage : salesCurrentPage) * itemsPerPage,
              activeTab === 'deposit' ? filteredDepositTransactions.length : filteredSalesTransactions.length
            )}
            itemLabel={activeTab === 'deposit' ? 'deposit records' : 'transaction records'}
            onPageChange={(p) => {
              if (activeTab === 'deposit') {
                setDepositCurrentPage(p)
              } else {
                setSalesCurrentPage(p)
              }
            }}
          />
        )}
      </div>

      {/* 6. Transaction Details Modal (Finance can add/update remarks on unaudited; Supervisor: edit unaudited; Audit: audit review; Owner: read-only) */}
      <AuditTransactionModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        transaction={selectedTx}
        onTransactionUpdated={handleTransactionUpdated}
        editable={!isAdmin && !isOwner && !isFinanceOnly}
        viewOnly={isOwner}
      />

      {/* 6b. By Day row menu (acts on the whole day) */}
      {showActionColumn && dayMenu && typeof document !== 'undefined' && (() => {
        const dayGroup = dailySummaryGroups.find((g) => g.id === dayMenu.date)
        const dayTxs = dayGroup ? dayGroup.banks.flatMap((b) => b.transactions) : []
        const auditable = dayTxs.filter(
          (t) => isRowAuditable(t) && t.auditStatus !== 'Verified' && t.auditStatus !== 'Flagged'
        )
        const close = () => setDayMenu(null)
        return createPortal(
          <>
            <div className="fixed inset-0 z-[99998]" onClick={close} />
            <div
              className="fixed w-52 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
              style={{
                top: `${dayMenu.top}px`,
                right: `${dayMenu.right}px`,
                transform: dayMenu.openUpward ? 'translateY(-100%)' : 'none',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {canAudit && (
                <>
                  <button
                    type="button"
                    disabled={auditable.length === 0}
                    onClick={() => openDayAudit('Verified', dayGroup?.date ?? dayMenu.date, dayTxs)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Mark day as Audited{auditable.length > 0 ? ` (${auditable.length})` : ''}</span>
                  </button>
                  <button
                    type="button"
                    disabled={auditable.length === 0}
                    onClick={() => openDayAudit('Flagged', dayGroup?.date ?? dayMenu.date, dayTxs)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>Flag day Discrepancy</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  close()
                  toggleDateExpansion(dayMenu.date)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer',
                  canAudit && 'border-t border-slate-100 mt-1 pt-1.5'
                )}
              >
                <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>{expandedDates.has(dayMenu.date) ? 'Hide transactions' : 'View transactions'}</span>
              </button>
            </div>
          </>,
          document.body
        )
      })()}

      {/* 7. Floating 3-Dots Action Portal Menu */}
      {showActionColumn && openMenuTxId && activeMenuTx && menuPosition && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-52 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {canAudit && isRowAuditable(activeMenuTx) && (
              <>
                <button
                  type="button"
                  onClick={() => handleMenuMarkAudit(activeMenuTx)}
                  className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{activeMenuTx.auditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                </button>

                {activeMenuTx.auditStatus !== 'Verified' && (
                  <button
                    type="button"
                    onClick={() => handleMenuOpenDiscrepancy(activeMenuTx)}
                    className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    <span>Flag Discrepancy</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => handleMenuViewDetails(activeMenuTx)}
              className={cn(
                'w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer',
                canAudit && isRowAuditable(activeMenuTx) && 'border-t border-slate-100 mt-1 pt-1.5'
              )}
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>View Details</span>
            </button>

            {isFinance && activeMenuTx.auditStatus !== 'Verified' && (
              <button
                type="button"
                onClick={() => {
                  const tx = activeMenuTx
                  setOpenMenuTxId(null)
                  setMenuPosition(null)
                  setRemarksTargetTx(tx)
                  setRemarksInput(tx.remarks || '')
                  setIsRemarksDialogOpen(true)
                }}
                className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/5 transition-colors text-left cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{activeMenuTx.remarks ? 'Edit Remarks' : 'Add Remarks'}</span>
              </button>
            )}

            {canEditTx(activeMenuTx) && (
              <button
                type="button"
                onClick={() => handleMenuEdit(activeMenuTx)}
                className="w-full min-h-[40px] flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Edit</span>
              </button>
            )}

            {canShowDeleteOption(activeMenuTx) && (() => {
              const blockedReason = getDeleteBlockedReason(activeMenuTx)
              return (
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    type="button"
                    disabled={!!blockedReason}
                    onClick={() => handleMenuDelete(activeMenuTx)}
                    title={blockedReason || 'Delete this unaudited record'}
                    className={cn(
                      'w-full min-h-[40px] flex flex-col items-start justify-center px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors',
                      blockedReason
                        ? 'text-rose-400 opacity-60 cursor-not-allowed'
                        : 'text-rose-600 hover:bg-rose-50 cursor-pointer'
                    )}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Delete…</span>
                    </span>
                    {blockedReason && (
                      <span className="text-[10px] font-normal text-muted-fg pl-6 leading-tight">
                        {blockedReason}
                      </span>
                    )}
                  </button>
                </div>
              )
            })()}
          </div>,
          document.body
        )}

      {/* 7b. Delete Unaudited Transaction Confirmation Modal */}
      <ConfirmModal
        open={!!deleteConfirmTx}
        onOpenChange={(open) => {
          if (!open && !isDeletingTx) setDeleteConfirmTx(null)
        }}
        title={`Delete ${deleteConfirmTx?.type === 'Expense' ? 'Expense' : 'Sale'} Record`}
        description={
          deleteConfirmTx ? (
            <span>
              Are you sure you want to delete 1 item (Ref:{' '}
              <strong className="font-mono">{deleteConfirmTx.refNo}</strong>) totaling{' '}
              <strong>
                {formatPHP(
                  Math.abs(deleteConfirmTx.amount || deleteConfirmTx.withdrawal || deleteConfirmTx.deposit || 0)
                )}
              </strong>
              ? This action cannot be undone.
            </span>
          ) : undefined
        }
        confirmLabel="Delete record"
        variant="destructive"
        actionType="delete"
        isLoading={isDeletingTx}
        loadingLabel="Deleting…"
        onConfirm={handleConfirmDeleteTx}
      />

      {/* 8. Quick Discrepancy Modal from Action Menu */}
      <Dialog open={isDiscrepancyModalOpen} onOpenChange={setIsDiscrepancyModalOpen}>
        <DialogContent className="max-w-[440px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                  Flag Audit Discrepancy
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Describe the discrepancy or required correction for this transaction.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Discrepancy Reason / Remarks <span className="text-rose-600">*</span>
              </Label>
              <textarea
                rows={3}
                value={discrepancyReason}
                onChange={(e) => setDiscrepancyReason(e.target.value)}
                placeholder="e.g. Voucher amount does not match the attached receipt..."
                className="w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-normal leading-relaxed resize-none"
              />
              {!discrepancyReason.trim() && (
                <p className="text-[10px] text-muted-fg leading-tight">
                  A reason is required so Finance and Operations can address the discrepancy.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/30">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingAudit}
                onClick={() => {
                  setIsDiscrepancyModalOpen(false)
                  setDiscrepancyReason('')
                  setActiveMenuTx(null)
                }}
                className="h-10 px-4 text-xs font-semibold rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!discrepancyReason.trim() || isSubmittingAudit}
                onClick={handleConfirmQuickDiscrepancy}
                className="h-10 px-5 text-xs font-semibold rounded-xl bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSubmittingAudit ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Flagging…</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-white" />
                    <span>Flag Discrepancy</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 8b. Quick Mark as Audited Modal from Action Menu (with optional remarks) */}
      <Dialog
        open={isMarkAuditModalOpen}
        onOpenChange={(nextOpen) => {
          if (!isSubmittingAudit) {
            setIsMarkAuditModalOpen(nextOpen)
            if (!nextOpen) {
              setMarkAuditRemarks('')
              setMarkAuditTargetTx(null)
            }
          }
        }}
      >
        <DialogContent className="max-w-[440px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                  {markAuditTargetTx?.auditStatus === 'Verified' ? 'Re-Audit Transaction' : 'Mark as Audited'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Confirm audit verification. Adding remarks is optional.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Audit Remarks <span className="text-muted-fg font-normal">(Optional)</span>
              </Label>
              <textarea
                rows={3}
                value={markAuditRemarks}
                onChange={(e) => setMarkAuditRemarks(e.target.value)}
                placeholder="Optional audit remarks or verification notes (leave blank if none)..."
                className="w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-normal leading-relaxed resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/30">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingAudit}
                onClick={() => {
                  setIsMarkAuditModalOpen(false)
                  setMarkAuditRemarks('')
                  setMarkAuditTargetTx(null)
                }}
                className="h-10 px-4 text-xs font-semibold rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isSubmittingAudit}
                onClick={handleConfirmQuickMarkAudit}
                className="h-10 px-5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSubmittingAudit ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    <span>{markAuditTargetTx?.auditStatus === 'Verified' ? 'Confirm Re-Audit' : 'Confirm & Mark Audited'}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 8d. Day level audit dialog (Mark as Audited / Flag Discrepancy, remarks optional) */}
      <Dialog
        open={!!dayAudit}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isSubmittingDayAudit) {
            setDayAudit(null)
            setDayAuditRemarks('')
          }
        }}
      >
        <DialogContent className="max-w-[460px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal">
          {dayAudit && (() => {
            const isFlag = dayAudit.action === 'Flagged'
            const count = dayAudit.targets.length
            return (
              <>
                <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl border flex items-center justify-center shrink-0',
                        isFlag ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'
                      )}
                    >
                      {isFlag ? (
                        <AlertCircle className="w-5 h-5 text-rose-600" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      )}
                    </div>
                    <div>
                      <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                        {isFlag ? 'Flag Day Discrepancy' : 'Mark Day as Audited'}
                      </DialogTitle>
                      <DialogDescription className="text-xs text-muted-fg mt-0.5">
                        Applies to {count} pending {count === 1 ? 'record' : 'records'} on {dayAudit.date}. Already audited or flagged records are not changed.
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-focus block">
                      Remarks <span className="text-muted-fg font-normal">(Optional)</span>
                    </Label>
                    <textarea
                      rows={3}
                      value={dayAuditRemarks}
                      onChange={(e) => setDayAuditRemarks(e.target.value)}
                      placeholder={isFlag ? 'Describe the discrepancy for this day (optional)…' : 'Optional audit remarks (leave blank if none)…'}
                      className={cn(
                        'w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 font-normal leading-relaxed resize-none',
                        isFlag ? 'focus:ring-rose-500/20 focus:border-rose-500' : 'focus:ring-emerald-500/20 focus:border-emerald-500'
                      )}
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/30">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmittingDayAudit}
                      onClick={() => {
                        setDayAudit(null)
                        setDayAuditRemarks('')
                      }}
                      className="h-10 px-4 text-xs font-semibold rounded-xl border-stroke/50 cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      disabled={isSubmittingDayAudit}
                      onClick={handleConfirmDayAudit}
                      className={cn(
                        'h-10 px-5 text-xs font-semibold rounded-xl text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50',
                        isFlag ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      )}
                    >
                      {isSubmittingDayAudit ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving…</span>
                        </>
                      ) : isFlag ? (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-white" />
                          <span>Flag {count} {count === 1 ? 'record' : 'records'}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                          <span>Mark {count} as Audited</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 8c. Standalone Add/Edit Remarks Dialog from Action Menu */}
      <Dialog
        open={isRemarksDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isSavingRemarks) {
            setIsRemarksDialogOpen(nextOpen)
            if (!nextOpen) {
              setRemarksInput('')
              setRemarksTargetTx(null)
            }
          }
        }}
      >
        <DialogContent className="max-w-[440px] rounded-[24px] p-6 sm:p-7 bg-white border border-stroke/50 shadow-modal">
          <DialogHeader className="text-left pb-3 border-b border-stroke/30 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-extrabold text-focus leading-tight">
                  {remarksTargetTx?.remarks ? 'Edit Remarks' : 'Add Remarks'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5">
                  Enter operational remarks for {remarksTargetTx?.particulars || remarksTargetTx?.description || 'transaction'}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus block">
                Remarks
              </Label>
              <textarea
                rows={4}
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                placeholder="Enter remarks or notes here…"
                className="w-full text-xs p-3 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-[#960C01]/20 focus:border-[#960C01] font-normal leading-relaxed resize-y bg-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/30">
              <Button
                type="button"
                variant="outline"
                disabled={isSavingRemarks}
                onClick={() => {
                  setIsRemarksDialogOpen(false)
                  setRemarksInput('')
                  setRemarksTargetTx(null)
                }}
                className="h-10 px-4 text-xs font-semibold rounded-xl border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isSavingRemarks}
                onClick={handleSaveRemarks}
                className="h-10 px-5 text-xs font-semibold rounded-xl bg-[#960C01] hover:bg-[#960C01]/90 text-white flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSavingRemarks ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <span>Save Remarks</span>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
