import { formatRealName } from '@/utils/formatRealName'
import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  RotateCw,
  ArrowUpDown,
  FilterX,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  TrendingUp,
  ArrowDownLeft,
  Check,
  AlertCircle,
  Eye,
  Pencil,
  MoreVertical,
  Info,
  Loader2,
  Landmark,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
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
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'
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
import { isDateInRange, normalizeDateToYYYYMMDD, formatDisplayDate } from '@/utils/dateUtils'
import { getParticularsSummary } from '@/utils/particularsUtils'
import { getPaidDepositForSale, getPaidDisbursementForExpense } from '@/utils/cashLedgerUtils'
import { reportAuditSaveFailure } from '@/services/auditReviewApi'
import { notifyError, notifyWarning } from '@/utils/errorUtils'
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
 * "Deposited Nov 11, 2026 (BDO)" for a sale whose money reached the bank, so the auditor reviewing the
 * sale-day row can see when and where it cleared. Null for anything that is not a deposited sale.
 */
const getDepositBadgeText = (tx: DashboardTransactionItem): string | null => {
  if (tx.type !== 'Sales') return null
  if ((tx.depositStatus || tx.deposit_status) !== 'Deposited') return null
  const day = tx.deposit_date || tx.depositDate
  if (!day) return null
  const bank =
    (tx.bankAccountId
      ? bankService.getCachedAccounts().find((a) => String(a.id) === String(tx.bankAccountId))?.bankName
      : undefined) || tx.bankName
  return `Deposited ${formatDisplayDate(day)}${bank ? ` (${bank})` : ''}`
}

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

/** Deposited / Not Deposited for a sale; null for records that are not sales (no deposit step). */
const getDepositStatusLabel = (tx: DashboardTransactionItem): 'Deposited' | 'Not Deposited' | null => {
  if (tx.type !== 'Sales') return null
  return (tx.depositStatus || tx.deposit_status) === 'Deposited' ? 'Deposited' : 'Not Deposited'
}

const DepositStatusBadge: React.FC<{ tx: DashboardTransactionItem }> = ({ tx }) => {
  const label = getDepositStatusLabel(tx)
  if (!label) return <span className="text-muted-fg/50">—</span>
  const day = label === 'Deposited' ? tx.deposit_date || tx.depositDate : null
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={
          label === 'Deposited'
            ? 'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300'
        }
      >
        {label}
      </span>
      {day && <span className="text-[10px] text-muted-fg">{formatDisplayDate(day)}</span>}
    </div>
  )
}

const isAwaitingAudit = (status?: string | null): boolean =>
  (status || '').trim().toLowerCase() === 'pending audit approval'

/** YYYY-MM-DD -> MM/DD/YY, the same display format the other ledger rows use. */
const toLedgerDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : iso
}

/** True when a row is money in (Deposit). Used by the cash ledger direction filter. */
const isDepositRow = (t: DashboardTransactionItem): boolean => {
  if ((t.deposit || 0) > 0) return true
  if ((t.withdrawal || 0) > 0) return false
  return t.type === 'Sales' || t.type === 'Income'
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
  onResetCompany: () => void
  canClearFilter?: boolean
}

const CompanyFilterDropdown: React.FC<CompanyFilterDropdownProps> = ({
  selectedCompany,
  companyList,
  onSelectCompany,
  onResetCompany,
  canClearFilter = true,
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
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredList = React.useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return companyList
    return companyList.filter((c) => c.toLowerCase().includes(q))
  }, [search, companyList])

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-2 h-10 sm:h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
          isOpen && 'ring-2 ring-slate-100 border-slate-300'
        )}
        aria-label="Filter transactions by company"
      >
        <span className="font-semibold text-focus/90 truncate max-w-[150px]">
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
              ? 'w-[min(calc(100vw-32px),320px)]'
              : 'absolute right-0 top-full mt-2 w-68'
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
}

const BankAccountFilterDropdown: React.FC<BankAccountFilterDropdownProps> = ({
  selectedAccountId,
  bankAccounts,
  onSelectAccount,
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
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedAcc = React.useMemo(
    () => bankAccounts.find((a) => String(a.id) === String(selectedAccountId)) || bankAccounts[0],
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
    ? `${selectedAcc.bankName}${selectedAcc.accountName ? ` - ${selectedAcc.accountName}` : ''}`
    : 'Select Bank Account'

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-2 h-10 sm:h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
          isOpen && 'ring-2 ring-slate-100 border-slate-300'
        )}
        aria-label="Select bank account"
      >
        <Landmark className="h-3.5 w-3.5 text-muted-fg shrink-0" />
        <span className="font-semibold text-focus/90 truncate max-w-[180px]">
          {triggerLabel}
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
              Select Bank Account
            </span>
          </div>

          {bankAccounts.length >= 4 && (
            <div className="relative mb-2 px-1">
              <Search className="w-3.5 h-3.5 text-muted-fg absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bank or account..."
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
          )}

          <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
            {filteredAccounts.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-fg">
                No matching bank accounts
              </div>
            ) : (
              filteredAccounts.map((acc) => {
                const isSelected = selectedAcc ? String(selectedAcc.id) === String(acc.id) : false
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
                      'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                      isSelected
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-focus/80 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-semibold truncate">
                          {acc.bankName}
                          {acc.accountName ? ` - ${acc.accountName}` : ''}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-fg truncate">{acc.companyName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-right">
                      <div className="flex flex-col text-right">
                        <span className="text-[11px] font-semibold text-focus">
                          {formatPHP(acc.startingBalance)}
                        </span>
                        <span className="text-[9px] text-muted-fg">start bal</span>
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
  const { activeCompany, setActiveCompany, allCompanies } = useCompany()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole.includes('audit')
  const isFinance = userRole.includes('finance')
  const isAdmin = userRole === 'admin' || userRole === 'owner'
  const isSupervisor = userRole.includes('supervisor') || userRole === 'company'

  // Crucial requirement: Only Audit and Finance (and Admin) can choose "All Companies", not the supervisor!
  const canSelectAllCompanies = isAudit || isFinance || isAdmin

  // Resolve all assigned company names for a supervisor
  const supervisorCompanies = React.useMemo(() => {
    const list: string[] = []
    if (user?.assignedCompany && user.assignedCompany !== 'All Companies') {
      list.push(user.assignedCompany)
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

  const isCompanyScoped = !canSelectAllCompanies && supervisorCompanies.length <= 1

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

  const handleSelectCompany = (c: string) => {
    if (!canSelectAllCompanies && c === 'All Companies') return
    setSelectedCompany(c)
    setActiveCompany(c)
    setSelectedBankAccountId('')
    setDepositCurrentPage(1)
    setSalesCurrentPage(1)
  }

  const handleResetCompany = () => {
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
  }

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

  // The page always shows one bank. Pick the first bank in scope when none (or an out of scope one) is chosen.
  React.useEffect(() => {
    if (availableBankAccounts.length > 0) {
      const exists = availableBankAccounts.some((a) => String(a.id) === String(selectedBankAccountId))
      if (!exists) setSelectedBankAccountId(String(availableBankAccounts[0].id))
    } else if (selectedBankAccountId) {
      setSelectedBankAccountId('')
    }
  }, [availableBankAccounts, selectedBankAccountId])

  const selectedBankAccount = React.useMemo(
    () =>
      availableBankAccounts.find((a) => String(a.id) === String(selectedBankAccountId)) ||
      availableBankAccounts[0],
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
  const canAudit = (isAdmin || isAudit) && !isOwner

  // 3-Dots Action Menu state
  const [openMenuTxId, setOpenMenuTxId] = React.useState<string | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward: boolean
  } | null>(null)
  const [activeMenuTx, setActiveMenuTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isDiscrepancyModalOpen, setIsDiscrepancyModalOpen] = React.useState(false)
  // 3 dots menu on a By Day row (acts on the whole day)
  const [dayMenu, setDayMenu] = React.useState<{ date: string; top: number; right: number; openUpward: boolean } | null>(null)
  const [discrepancyReason, setDiscrepancyReason] = React.useState('')
  const [isSubmittingAudit, setIsSubmittingAudit] = React.useState(false)

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

  // Switch bar tab: 'deposit' (cash/bank ledger) | 'all' (full accrual ledger)
  const [activeTab, setActiveTab] = React.useState<'deposit' | 'all'>('deposit')

  // Independent Filters & Pagination for DEPOSIT (cash ledger) Tab
  const [depositSearchQuery, setDepositSearchQuery] = React.useState('')
  // Direction filter for the cash ledger: All | Deposits (money in) | Withdrawals (money out)
  const [depositDirectionFilter, setDepositDirectionFilter] = React.useState<'All' | 'Deposits' | 'Withdrawals'>('All')
  const [depositDateRange, setDepositDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
  })
  const [depositSortOrder, setDepositSortOrder] = React.useState<'desc' | 'asc'>('desc')
  const [depositCurrentPage, setDepositCurrentPage] = React.useState(1)


  // Independent Filters & Pagination for ALL TRANSACTIONS (accrual) Tab
  const [salesSearchQuery, setSalesSearchQuery] = React.useState('')
  const [salesStatusFilter, setSalesStatusFilter] = React.useState<'All' | 'Paid' | 'Unpaid' | 'Pending' | 'On hold'>('All')
  // Record-type filter for the accrual ledger: All | Sales | Expense | Loan | Petty Cash
  const [salesTypeFilter, setSalesTypeFilter] = React.useState<
    'All' | 'Sales' | 'Expense' | 'Loan' | 'Petty Cash' | 'Income'
  >('All')
  const [salesDateRange, setSalesDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
  })
  const [salesSortOrder, setSalesSortOrder] = React.useState<'desc' | 'asc'>('desc')
  const [salesCurrentPage, setSalesCurrentPage] = React.useState(1)
  const [isSalesStatusDropdownOpen, setIsSalesStatusDropdownOpen] = React.useState(false)
  const salesStatusDropdownRef = React.useRef<HTMLDivElement>(null)
  const [isSalesTypeDropdownOpen, setIsSalesTypeDropdownOpen] = React.useState(false)
  const salesTypeDropdownRef = React.useRef<HTMLDivElement>(null)

  // Export dropdown state
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)

  const itemsPerPage = 12

  // View mode for All Transactions tab: 'all' (records table) vs 'daily_summary' (grouped by date per bank)
  const [salesViewMode, setSalesViewMode] = React.useState<'all' | 'daily_summary'>('daily_summary')
  const [expandedDates, setExpandedDates] = React.useState<Set<string>>(new Set())
  const toggleDateExpansion = (date: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })

  // Modal inspection
  const [selectedTx, setSelectedTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  // Close dropdowns on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (salesStatusDropdownRef.current && !salesStatusDropdownRef.current.contains(target)) {
        setIsSalesStatusDropdownOpen(false)
      }
      if (salesTypeDropdownRef.current && !salesTypeDropdownRef.current.contains(target)) {
        setIsSalesTypeDropdownOpen(false)
      }

    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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
        depositStatus: 'Deposited',
        deposit_status: 'Deposited',
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
          // The sale date stays on `saleDate`; a deposited sale with no deposit date keeps its sale date.
          const depDay = String(t.deposit_date || t.depositDate || '').slice(0, 10)
          const [y, m, d] = depDay.split('-')
          const depositDisplayDate = y && m && d ? `${m}/${d}/${y.slice(2)}` : t.date
          return { ...t, date: depositDisplayDate, amount: depositVal, deposit: depositVal, withdrawal: 0 }
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

  const filteredDepositTransactions = React.useMemo(() => {
    let list = depositBaseList

    // Direction filter: All | Deposits (money in) | Withdrawals (money out)
    if (depositDirectionFilter === 'Deposits') {
      list = list.filter(isDepositRow)
    } else if (depositDirectionFilter === 'Withdrawals') {
      list = list.filter((t) => !isDepositRow(t))
    }

    // Search query
    const q = depositSearchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (t) =>
          t.refNo.toLowerCase().includes(q) ||
          (t.chequeNo && t.chequeNo.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q) ||
          (t.particulars && t.particulars.toLowerCase().includes(q)) ||
          t.company.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      )
    }

    // Date range
    if (depositDateRange.startDate && depositDateRange.endDate) {
      list = list.filter((t) =>
        isDateInRange(t.date, depositDateRange.startDate, depositDateRange.endDate)
      )
    }

    // Sort
    list = [...list].sort((a, b) => {
      const dateA = normalizeDateToYYYYMMDD(a.date)
      const dateB = normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) {
        return depositSortOrder === 'desc' ? cmp : -cmp
      }
      const timeCmp = (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      return depositSortOrder === 'desc' ? timeCmp : -timeCmp
    })

    return list
  }, [
    depositBaseList,
    depositDirectionFilter,
    depositSearchQuery,
    depositDateRange,
    depositSortOrder,
  ])

  const depositTotalPages = Math.max(1, Math.ceil(filteredDepositTransactions.length / itemsPerPage))
  const displayedDepositTransactions = React.useMemo(() => {
    const start = (depositCurrentPage - 1) * itemsPerPage
    return filteredDepositTransactions.slice(start, start + itemsPerPage)
  }, [filteredDepositTransactions, depositCurrentPage, itemsPerPage])

  // 2. FILTERED ALL TRANSACTIONS (full accrual ledger: sales + expenses + loans, every status)
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

    // Record-type filter: All | Sales | Expense | Loan | Petty Cash
    if (salesTypeFilter !== 'All') {
      list = list.filter((t) => t.type === salesTypeFilter)
    }

    // Status filter: All | Paid | Unpaid | Pending | On hold
    if (salesStatusFilter !== 'All') {
      if (salesStatusFilter === 'Unpaid') {
        list = list.filter((t) => t.status !== 'Paid')
      } else {
        list = list.filter((t) => t.status === salesStatusFilter)
      }
    }

    // Search query
    const q = salesSearchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (t) =>
          t.refNo.toLowerCase().includes(q) ||
          (t.chequeNo && t.chequeNo.toLowerCase().includes(q)) ||
          t.description.toLowerCase().includes(q) ||
          (t.particulars && t.particulars.toLowerCase().includes(q)) ||
          t.company.toLowerCase().includes(q) ||
          (t.paymentMethod && t.paymentMethod.toLowerCase().includes(q))
      )
    }

    // Date range
    if (salesDateRange.startDate && salesDateRange.endDate) {
      list = list.filter((t) =>
        isDateInRange(t.date, salesDateRange.startDate, salesDateRange.endDate)
      )
    }

    // Sort
    list = [...list].sort((a, b) => {
      const dateA = normalizeDateToYYYYMMDD(a.date)
      const dateB = normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) {
        return salesSortOrder === 'desc' ? cmp : -cmp
      }
      const timeCmp = (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
      return salesSortOrder === 'desc' ? timeCmp : -timeCmp
    })

    return list
  }, [
    transactions,
    effectiveTargetCompany,
    selectedBankAccount,
    resolveTxBank,
    salesTypeFilter,
    salesStatusFilter,
    salesSearchQuery,
    salesDateRange,
    salesSortOrder,
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
  }, [activeTab, filteredDepositTransactions, filteredSalesTransactions, resolveTxBank])

  // The By Day table gets a Company column only when a shared (multi-company) bank is in view
  const showDayCompanyColumn = dailySummaryGroups.some((g) => !!g.company)
  const dayColCount = showDayCompanyColumn ? 9 : 8

  // Active dataset & clear filters check
  const activeDataset = activeTab === 'deposit' ? filteredDepositTransactions : filteredSalesTransactions
  // Non-narrowed copy for use inside the per-tab toolbar branches, where TypeScript
  // otherwise narrows `activeTab` to a single literal and flags the switcher comparisons.
  const currentTab: 'deposit' | 'all' = activeTab

  // View mode toggle (By Day vs All records), shared by the Deposit and All Transactions toolbars
  const viewModeToggle = (
    <div className="flex items-center bg-slate-100/90 rounded-full border border-stroke/40 p-1 gap-1">
      {(
        [
          { value: 'all', label: 'All Records' },
          { value: 'daily_summary', label: 'By Day' },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setSalesViewMode(opt.value)}
          className={cn(
            'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none',
            salesViewMode === opt.value
              ? 'bg-[#960C01] text-white shadow-2xs'
              : 'text-focus/70 hover:text-focus hover:bg-white/60'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
  const hasDepositActiveFilters =
    depositSearchQuery.trim().length > 0 ||
    (canSelectAllCompanies && selectedCompany !== 'All Companies') ||
    (!canSelectAllCompanies && supervisorCompanies.length > 1 && selectedCompany !== defaultSupervisorCompany) ||
    depositDirectionFilter !== 'All' ||
    (depositDateRange.startDate !== null && depositDateRange.endDate !== null)

  const hasSalesActiveFilters =
    salesSearchQuery.trim().length > 0 ||
    (canSelectAllCompanies && selectedCompany !== 'All Companies') ||
    (!canSelectAllCompanies && supervisorCompanies.length > 1 && selectedCompany !== defaultSupervisorCompany) ||
    salesStatusFilter !== 'All' ||
    salesTypeFilter !== 'All' ||
    (salesDateRange.startDate !== null && salesDateRange.endDate !== null)

  const handleClearDepositFilters = () => {
    setDepositSearchQuery('')
    setDepositDirectionFilter('All')
    setDepositDateRange({ startDate: null, endDate: null, label: 'All Dates' })
    handleResetCompany()
    setDepositCurrentPage(1)
  }

  const handleClearSalesFilters = () => {
    setSalesSearchQuery('')
    setSalesStatusFilter('All')
    setSalesTypeFilter('All')
    setSalesDateRange({ startDate: null, endDate: null, label: 'All Dates' })
    handleResetCompany()
    setSalesCurrentPage(1)
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

  // Supervisor and Finance can edit an unaudited sale or expense in the spreadsheet editor
  const canEditTx = (tx: DashboardTransactionItem) =>
    !canAudit &&
    !isOwner &&
    (tx.type === 'Sales' || tx.type === 'Expense') &&
    !tx.isMirrorRow &&
    tx.auditStatus !== 'Verified'

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

  const handleMenuMarkAudit = async (tx: DashboardTransactionItem) => {
    setOpenMenuTxId(null)
    setMenuPosition(null)
    setActiveMenuTx(null)
    const today = new Date().toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
    })
    const auditorName = formatRealName(user?.fullName || user?.name || user?.email || 'Audit Officer', user?.role || 'Audit Officer')

    const updatedTx: DashboardTransactionItem = {
      ...tx,
      auditStatus: 'Verified',
      auditedBy: auditorName,
      auditDate: today,
      auditNotes: undefined,
    }
    setTransactions((prev) => prev.map((t) => (t.id === tx.id && t.type === tx.type ? updatedTx : t)))

    try {
      if (tx.type === 'Sales') {
        await salesService.updateSaleAuditStatus(tx.id, 'Verified', auditorName)
      } else if (tx.type === 'Expense') {
        await expenseService.updateExpenseAuditStatus(tx.id, 'Verified', auditorName)
      } else if (tx.type === 'Loan') {
        const loanId = tx.id.replace(/:lender$/, '')
        await loanService.updateLoan(loanId, { auditStatus: 'Verified', auditedBy: auditorName, auditDate: today })
      } else if (tx.type === 'Income') {
        const leaseId = tx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
        await tenantService.saveAuditReview(leaseId, 'Verified')
      }
    } catch (err) {
      reportAuditSaveFailure(err)
      fetchAllTransactions(true)
    }
  }

  // Sales and Expense rows the auditor can review here (petty cash is a read only mirror,
  // loans awaiting audit are handled on their own page)
  const isRowAuditable = (tx: DashboardTransactionItem) =>
    tx.type !== 'Petty Cash' && !tx.awaitingAudit

  // Audit a whole day in one go: every auditable row that is not already audited or flagged.
  // Flagged rows keep their discrepancy and must be re-audited by hand.
  const handleAuditWholeDay = async (date: string, dayTxs: DashboardTransactionItem[]) => {
    const targets = dayTxs.filter(
      (t) => isRowAuditable(t) && t.auditStatus !== 'Verified' && t.auditStatus !== 'Flagged'
    )
    if (targets.length === 0) return
    if (!window.confirm(`Mark ${targets.length} ${targets.length === 1 ? 'record' : 'records'} on ${date} as audited?`)) return

    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
    const auditorName = formatRealName(user?.fullName || user?.name || user?.email || 'Audit Officer', user?.role || 'Audit Officer')
    const keys = new Set(targets.map((t) => `${t.type}:${t.id}`))

    setTransactions((prev) =>
      prev.map((t) =>
        keys.has(`${t.type}:${t.id}`)
          ? { ...t, auditStatus: 'Verified', auditedBy: auditorName, auditDate: today, auditNotes: undefined }
          : t
      )
    )

    const results = await Promise.allSettled(
      targets.map((tx) => {
        if (tx.type === 'Sales') return salesService.updateSaleAuditStatus(tx.id, 'Verified', auditorName)
        if (tx.type === 'Expense') return expenseService.updateExpenseAuditStatus(tx.id, 'Verified', auditorName)
        if (tx.type === 'Loan') {
          const loanId = tx.id.replace(/:lender$/, '')
          return loanService.updateLoan(loanId, { auditStatus: 'Verified', auditedBy: auditorName, auditDate: today })
        }
        if (tx.type === 'Income') {
          const leaseId = tx.id.replace(/^tenant_(pmt|lease)_/, '').split('_')[0]
          return tenantService.saveAuditReview(leaseId, 'Verified')
        }
        return Promise.resolve()
      })
    )
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
    const auditorName = formatRealName(user?.fullName || user?.name || user?.email || 'Audit Officer', user?.role || 'Audit Officer')

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
          <title>${isDeposit ? 'Bank Cash Ledger' : 'All Transactions'} Report - ${displayedTitle}</title>
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
          <p>Consolidated <strong>${isDeposit ? 'Bank Cash Ledger' : 'All Transactions'}</strong> for <strong>${displayedTitle}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
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
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300 select-none">
      {/* 1. Header & Actions Block */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
            Transactions
          </h1>
          {selectedBankAccount && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              <Landmark className="h-4 w-4 shrink-0" />
              <span className="text-sm font-bold">
                {selectedBankAccount.bankName}
                {selectedBankAccount.accountName ? ` - ${selectedBankAccount.accountName}` : ''}
              </span>
            </div>
          )}
          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
            {!canSelectAllCompanies
              ? `Financial transaction ledger for ${effectiveTargetCompany}`
              : selectedCompany !== 'All Companies'
              ? `Financial transaction ledger for ${selectedCompany}`
              : 'Bank cash ledger and the full record of sales, expenses, and loans'}
          </p>
        </div>

        {/* Top Right Action Buttons: Sort, Refresh, Live Date & Red Export Dropdown */}
        <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (activeTab === 'deposit') {
                setDepositSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
              } else {
                setSalesSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
              }
            }}
            className="h-10 sm:h-11 px-3.5 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer"
            title="Toggle chronological sorting order"
          >
            <ArrowUpDown className="h-4 w-4 text-focus/70 shrink-0" />
            <span className="hidden sm:inline">
              {(activeTab === 'deposit' ? depositSortOrder : salesSortOrder) === 'desc'
                ? 'Latest First'
                : 'Oldest First'}
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer"
            aria-label="Refresh transaction records"
          >
            <RotateCw
              className={`h-4 w-4 text-focus/70 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {/* Export Button with CSV & PDF options (Red across all accounts) */}
          <div ref={exportDropdownRef} className="relative inline-block">
            <Button
              type="button"
              disabled={activeDataset.length === 0}
              onClick={() => setIsExportDropdownOpen((prev) => !prev)}
              className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-50"
              aria-haspopup="true"
              aria-expanded={isExportDropdownOpen}
              aria-label="Export transaction records"
            >
              <span>Export</span>
              <ChevronDown className="h-3.5 w-3.5 ml-0.5 text-white/90" />
            </Button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Download as CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Download as PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* 3. Independent Filters Toolbar per Active Tab */}
      {activeTab === 'deposit' ? (
        /* DEPOSIT FILTERS TOOLBAR */
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg" />
            <Input
              type="search"
              placeholder="Search deposited transactions by Cheque No., particulars, category..."
              value={depositSearchQuery}
              onChange={(e) => {
                setDepositSearchQuery(e.target.value)
                setDepositCurrentPage(1)
              }}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          {/* Right Controls: Date Range Picker, Clear Button, and Tab Switcher */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {canSelectAllCompanies || supervisorCompanies.length > 1 ? (
              <CompanyFilterDropdown
                selectedCompany={selectedCompany}
                companyList={availableCompanyOptions}
                onSelectCompany={handleSelectCompany}
                onResetCompany={handleResetCompany}
                canClearFilter={canSelectAllCompanies}
              />
            ) : (
              <div className="inline-flex items-center gap-2 h-10 sm:h-11 px-4 rounded-full border border-stroke/60 bg-slate-50 text-focus text-xs sm:text-sm font-semibold shadow-xs select-none">
                <span className="truncate max-w-[180px]">{effectiveTargetCompany}</span>
              </div>
            )}

            {availableBankAccounts.length > 0 && (
              <BankAccountFilterDropdown
                selectedAccountId={selectedBankAccountId}
                bankAccounts={availableBankAccounts}
                onSelectAccount={(id) => {
                  setSelectedBankAccountId(id)
                  setDepositCurrentPage(1)
                  setSalesCurrentPage(1)
                }}
              />
            )}

            <DateRangePicker
              value={depositDateRange}
              onChange={(newRange) => {
                setDepositDateRange(newRange)
                setDepositCurrentPage(1)
              }}
            />

            {/* Tab Switcher: Deposit / All Transactions (Right Side, matching Sales & Expense page) */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('deposit')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'deposit'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <ArrowDownLeft className="h-4 w-4 shrink-0" />
                <span>Deposit</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'deposit' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredDepositTransactions.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'all'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <TrendingUp className="h-4 w-4 shrink-0" />
                <span>All Transactions</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredSalesTransactions.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ALL TRANSACTIONS FILTERS TOOLBAR (type + status filters over sales, expenses and loans) */
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg" />
            <Input
              type="search"
              placeholder="Search all transactions by particulars, Ref No., company, payment method..."
              value={salesSearchQuery}
              onChange={(e) => {
                setSalesSearchQuery(e.target.value)
                setSalesCurrentPage(1)
              }}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          {/* Right Controls: Company Filter Dropdown, Type Filter, Status Filter (Paid/Unpaid/Pending), Date Range Picker & Clear Button */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
            {canSelectAllCompanies || supervisorCompanies.length > 1 ? (
              <CompanyFilterDropdown
                selectedCompany={selectedCompany}
                companyList={availableCompanyOptions}
                onSelectCompany={handleSelectCompany}
                onResetCompany={handleResetCompany}
                canClearFilter={canSelectAllCompanies}
              />
            ) : (
              <div className="inline-flex items-center gap-2 h-10 sm:h-11 px-4 rounded-full border border-stroke/60 bg-slate-50 text-focus text-xs sm:text-sm font-semibold shadow-xs select-none">
                <span className="truncate max-w-[180px]">{effectiveTargetCompany}</span>
              </div>
            )}

            {/* Type Filter Dropdown (All / Sales / Expense / Loan) */}
            <div ref={salesTypeDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsSalesTypeDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-10 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                  isSalesTypeDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-semibold text-focus/90">
                  {salesTypeFilter === 'All' ? 'Type: All' : `Type: ${salesTypeFilter}`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
              </button>

              {isSalesTypeDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="space-y-1">
                    {[
                      { label: 'All Types', value: 'All' as const, dot: 'bg-slate-400' },
                      { label: 'Sales', value: 'Sales' as const, dot: 'bg-emerald-500' },
                      { label: 'Expense', value: 'Expense' as const, dot: 'bg-rose-500' },
                      { label: 'Loan', value: 'Loan' as const, dot: 'bg-sky-500' },
                      { label: 'Petty Cash', value: 'Petty Cash' as const, dot: 'bg-amber-500' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSalesTypeFilter(opt.value)
                          setIsSalesTypeDropdownOpen(false)
                          setSalesCurrentPage(1)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                          salesTypeFilter === opt.value
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-focus/80 hover:bg-slate-50'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', opt.dot)} />
                          <span>{opt.label}</span>
                        </div>
                        {salesTypeFilter === opt.value && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Status Filter Dropdown */}
            <div ref={salesStatusDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsSalesStatusDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-10 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                  isSalesStatusDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-semibold text-focus/90">
                  {salesStatusFilter === 'All' ? 'Status: All' : `Status: ${salesStatusFilter}`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
              </button>

              {isSalesStatusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  <div className="space-y-1">
                    {[
                      { label: 'All Statuses', value: 'All' as const, dot: 'bg-slate-400' },
                      { label: 'Paid', value: 'Paid' as const, dot: 'bg-emerald-500' },
                      { label: 'Unpaid', value: 'Unpaid' as const, dot: 'bg-rose-500' },
                      { label: 'Pending', value: 'Pending' as const, dot: 'bg-amber-500' },
                      { label: 'On hold', value: 'On hold' as const, dot: 'bg-stone-500' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSalesStatusFilter(opt.value)
                          setIsSalesStatusDropdownOpen(false)
                          setSalesCurrentPage(1)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                          salesStatusFilter === opt.value
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-focus/80 hover:bg-slate-50'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', opt.dot)} />
                          <span>{opt.label}</span>
                        </div>
                        {salesStatusFilter === opt.value && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Date Range Picker */}
            <DateRangePicker
              value={salesDateRange}
              onChange={(newRange) => {
                setSalesDateRange(newRange)
                setSalesCurrentPage(1)
              }}
            />

            {/* Tab Switcher: Deposit / All Transactions (Right Side) */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('deposit')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'deposit'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <ArrowDownLeft className="h-4 w-4 shrink-0" />
                <span>Deposit</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'deposit' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredDepositTransactions.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={cn(
                  'inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-4.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none',
                  currentTab === 'all'
                    ? 'bg-[#960C01] text-white shadow-xs'
                    : 'text-focus/70 hover:bg-white hover:text-focus'
                )}
              >
                <TrendingUp className="h-4 w-4 shrink-0" />
                <span>All Transactions</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-bold ml-1',
                    currentTab === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-focus/70'
                  )}
                >
                  {filteredSalesTransactions.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Table / Daily Summary Card Rendering Based on Active Tab & View Mode */}
      <div className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          {viewModeToggle}
          <span className="text-xs text-muted-fg font-medium">
            {salesViewMode === 'daily_summary'
              ? `${dailySummaryGroups.length} ${dailySummaryGroups.length === 1 ? 'day' : 'days'} (${activeDataset.length} total records)`
              : `${activeDataset.length} ${activeDataset.length === 1 ? 'record' : 'records'} shown`}
          </span>
        </div>
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          {activeTab === 'deposit' ? (
            <p>
              <strong className="text-focus">Deposit tab uses the deposit date.</strong> A sale appears on the day its money was
              deposited, and By Day totals are grouped by that deposit day. Sales that are Pending, Unpaid or not yet
              deposited do not appear here until they are deposited; find them in All Transactions.
            </p>
          ) : (
            <p>
              <strong className="text-focus">All Transactions uses the sales date.</strong> Every record is listed and grouped
              By Day on the day it was made, including Pending and Unpaid sales that have not been deposited yet. The
              Deposit Day column shows when each sale's money was deposited, and stays empty until it is.
            </p>
          )}
        </div>
        {salesViewMode === 'daily_summary' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <Table className="w-full table-fixed min-w-[900px]">
              <colgroup>
                {(showDayCompanyColumn ? [11, 13, 10, 13, 13, 13, 11, 8, 8] : [14, 12, 15, 15, 15, 12, 9, 8]).map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">{activeTab === 'deposit' ? 'DEPOSIT DAY' : 'SALES DATE'}</TableHead>
                  {showDayCompanyColumn && (
                    <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">COMPANY</TableHead>
                  )}
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">TRANSACTIONS</TableHead>
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">TOTAL DEPOSITS</TableHead>
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">TOTAL WITHDRAWALS</TableHead>
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">BANK BALANCE</TableHead>
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">AUDIT STATUS</TableHead>
                  <TableHead className="px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">DRILLDOWN</TableHead>
                  <TableHead className="px-2 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">ACTION</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={dayColCount} className="py-12 text-center text-sm text-muted-fg">
                      <Loader2 className="w-6 h-6 animate-spin text-primary inline-block" />
                    </TableCell>
                  </TableRow>
                ) : dailySummaryGroups.length === 0 ? (
                  <TableEmptyState
                    colSpan={dayColCount}
                    title="No daily records found"
                    message="No transactions match the selected company and filters."
                  />
                ) : (
                  dailySummaryGroups.map((group) => {
                    const isExpanded = expandedDates.has(group.id)
                    const parsed = new Date(`${group.date}T00:00:00`)
                    const validDate = !isNaN(parsed.getTime())
                    const dayTxs = group.banks.flatMap((b) => b.transactions)
                    return (
                      <React.Fragment key={group.id}>
                        <TableRow
                          onClick={() => toggleDateExpansion(group.id)}
                          className={cn(
                            'border-b border-slate-100 transition-colors cursor-pointer select-none',
                            isExpanded ? 'bg-slate-50/90 font-medium' : 'hover:bg-slate-50/50'
                          )}
                        >
                          <TableCell className="px-3.5 py-3.5 text-left">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-focus">
                                {validDate
                                  ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                  : group.date}
                              </span>
                            </div>
                          </TableCell>
                          {showDayCompanyColumn && (
                            <TableCell className="px-3.5 py-3.5 text-left">
                              {group.company ? (
                                <span
                                  className="inline-flex max-w-full items-center px-2 py-0.5 rounded-full text-2xs font-semibold bg-slate-100 text-slate-800 border border-slate-200"
                                  title={group.company}
                                >
                                  <span className="truncate">{group.company}</span>
                                </span>
                              ) : (
                                <span className="text-muted-fg">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="px-3.5 py-3.5 text-center">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-slate-100 text-focus border border-slate-200">
                              {group.dayTransactionCount} {group.dayTransactionCount === 1 ? 'record' : 'records'}
                            </span>
                          </TableCell>
                          <TableCell className="px-3.5 py-3.5 text-right font-bold tabular-nums text-emerald-600 text-xs sm:text-sm">
                            {group.dayTotalDeposit > 0 ? formatPHP(group.dayTotalDeposit) : '—'}
                          </TableCell>
                          <TableCell className="px-3.5 py-3.5 text-right font-bold tabular-nums text-rose-600 text-xs sm:text-sm">
                            {group.dayTotalWithdrawal > 0 ? formatPHP(group.dayTotalWithdrawal) : '—'}
                          </TableCell>
                          <TableCell className="px-3.5 py-3.5 text-right font-bold tabular-nums text-xs sm:text-sm">
                            {(() => {
                              const bal = getClosingBalance(group.date)
                              if (bal === null) return <span className="text-muted-fg">—</span>
                              return (
                                <span className={bal < 0 ? 'text-rose-600' : 'text-focus'}>
                                  {bal < 0 ? `-${formatPHP(Math.abs(bal))}` : formatPHP(bal)}
                                </span>
                              )
                            })()}
                          </TableCell>
                          <TableCell className="px-3.5 py-3.5 text-center">
                            {(() => {
                              const flagged = dayTxs.some((t) => t.auditStatus === 'Flagged')
                              const pending = dayTxs.filter((t) => t.auditStatus !== 'Verified' && t.auditStatus !== 'Flagged').length
                              const label = flagged ? 'Discrepancy' : pending > 0 ? `${pending} Pending` : 'All Audited'
                              return (
                                <span
                                  className={cn(
                                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-bold border',
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
                          <TableCell className="px-3.5 py-3.5 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleDateExpansion(group.id)
                              }}
                              className="h-8 px-2.5 text-xs font-semibold text-focus/80 hover:bg-slate-200/60 rounded-lg inline-flex items-center gap-1"
                            >
                              <span>{isExpanded ? 'Hide' : 'Show'}</span>
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </Button>
                          </TableCell>
                          <TableCell className="px-2 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
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
                              className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors"
                              title="Day actions"
                              aria-label="Open day action menu"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="bg-slate-50/40 border-b border-slate-200">
                            <TableCell colSpan={dayColCount} className="p-3 sm:p-4">
                              <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
                                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-focus">
                                  Transactions on {group.date}{group.company ? ` · ${group.company}` : ''}{' '}
                                  <span className="text-2xs text-muted-fg font-medium">({dayTxs.length} total)</span>
                                  {canAudit && dayTxs.some((t) => isRowAuditable(t) && t.auditStatus !== 'Verified' && t.auditStatus !== 'Flagged') && (
                                    <button
                                      type="button"
                                      onClick={() => handleAuditWholeDay(group.date, dayTxs)}
                                      className="ml-3 px-2.5 py-1 rounded-lg text-2xs font-semibold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                                    >
                                      Audit whole day
                                    </button>
                                  )}
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-100/60 text-muted-fg text-2xs uppercase tracking-wider border-b border-slate-100">
                                      <tr>
                                        <th className="px-3 py-2 font-bold">Type</th>
                                        <th className="px-3 py-2 font-bold">Bank / Method</th>
                                        <th className="px-3 py-2 font-bold">Particulars</th>
                                        <th className="px-3 py-2 font-bold text-right">Deposit</th>
                                        <th className="px-3 py-2 font-bold text-right">Withdrawal</th>
                                        {activeTab !== 'deposit' && <th className="px-3 py-2 font-bold text-center">Status</th>}
                                        {activeTab !== 'deposit' && <th className="px-3 py-2 font-bold text-center">Deposit Status</th>}
                                        <th className="px-3 py-2 font-bold text-center">Audit Status</th>
                                        <th className="w-12 px-3 py-2 font-bold text-center">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {dayTxs.map((tx) => {
                                        const { deposit, withdrawal } = getRowAmounts(tx)
                                        return (
                                          <tr key={`${tx.type}-${tx.id}`} className="hover:bg-slate-50/60 transition-colors">
                                            <td className="px-3 py-2 font-medium text-focus">{tx.type}</td>
                                            <td className="px-3 py-2 text-muted-fg">{tx.bankName || tx.paymentMethod || '—'}</td>
                                            <td className="px-3 py-2 text-focus max-w-[260px]">
                                              <p className="truncate font-medium">{tx.particulars}</p>
                                              {getDepositBadgeText(tx) && (
                                                <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                  {getDepositBadgeText(tx)}
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-right font-bold tabular-nums text-emerald-600">
                                              {deposit > 0 ? formatPHP(deposit) : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right font-bold tabular-nums text-rose-600">
                                              {withdrawal > 0 ? formatPHP(withdrawal) : '—'}
                                            </td>
                                            {activeTab !== 'deposit' && (
                                              <td className="px-3 py-2 text-center">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-bold border bg-slate-100 text-slate-700 border-slate-300 uppercase">
                                                  {tx.status}
                                                </span>
                                              </td>
                                            )}
                                            {activeTab !== 'deposit' && (
                                              <td className="px-3 py-2 text-center">
                                                <DepositStatusBadge tx={tx} />
                                              </td>
                                            )}
                                            <td className="px-3 py-2 text-center">
                                              <span
                                                className={cn(
                                                  'inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-bold border',
                                                  tx.auditStatus === 'Verified'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    : tx.auditStatus === 'Flagged'
                                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                                )}
                                              >
                                                {tx.auditStatus === 'Verified' ? 'Audited' : tx.auditStatus === 'Flagged' ? 'Discrepancy' : 'Pending'}
                                              </span>
                                            </td>
                                            {/* Same 3 dots menu as All Records: View Details for everyone, audit actions for auditors */}
                                            <td className="px-3 py-2 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  const txKey = `${tx.type}:${tx.id}`
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
                                                className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer inline-flex items-center justify-center transition-colors"
                                                title="Actions"
                                                aria-label="Open action menu"
                                              >
                                                <MoreVertical className="w-4 h-4" />
                                              </Button>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
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
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  {activeTab === 'deposit' ? 'DEPOSIT DATE' : 'SALES DATE'}
                </TableHead>
                {activeTab !== 'deposit' && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg" title="Day the sale's money was deposited; empty until it is deposited">
                    DEPOSIT DAY
                  </TableHead>
                )}
                {activeTab === 'deposit' && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                    COMPANY
                  </TableHead>
                )}
                {/* Type shows on deposit tab */}
                {activeTab === 'deposit' && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                    TYPE
                  </TableHead>
                )}
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  CHEQUE NO.
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  PARTICULARS
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                  {activeTab === 'deposit' ? 'CATEGORY' : 'PAYMENT METHOD'}
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  DEPOSIT
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  WITHDRAWAL
                </TableHead>
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                  {activeTab === 'deposit' ? 'BALANCE' : 'NET AMOUNT'}
                </TableHead>
                {/* Deposit tab rows are paid by definition, so no payment Status column there */}
                {activeTab !== 'deposit' && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                    STATUS
                  </TableHead>
                )}
                {activeTab !== 'deposit' && (
                  <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                    DEPOSIT STATUS
                  </TableHead>
                )}
                <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  AUDIT STATUS
                </TableHead>
                <TableHead className="w-12 px-3 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTION
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-slate-100">
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                    {activeTab !== 'deposit' && (
                      <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                    )}
                    {activeTab === 'deposit' && (
                      <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-28 rounded-md" /></TableCell>
                    )}
                    {activeTab === 'deposit' && (
                      <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                    )}
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-24 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-48 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                    <TableCell className="px-4 py-3.5 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                    <TableCell className="px-4 py-3.5 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                    <TableCell className="px-4 py-3.5 text-right"><Skeleton className="h-4 w-20 rounded-md ml-auto" /></TableCell>
                    {activeTab !== 'deposit' && (
                      <TableCell className="px-4 py-3.5 text-center"><Skeleton className="h-5 w-16 rounded-full mx-auto" /></TableCell>
                    )}
                    {activeTab !== 'deposit' && (
                      <TableCell className="px-4 py-3.5 text-center"><Skeleton className="h-5 w-16 rounded-full mx-auto" /></TableCell>
                    )}
                    <TableCell className="px-4 py-3.5 text-center"><Skeleton className="h-5 w-16 rounded-full mx-auto" /></TableCell>
                    <TableCell className="px-4 py-3.5"><Skeleton className="h-4 w-24 rounded-md" /></TableCell>
                    <TableCell className="px-3 py-3.5 text-center">
                      <Skeleton className="h-7 w-7 rounded-lg mx-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (activeTab === 'deposit' ? displayedDepositTransactions : displayedSalesTransactions).length === 0 ? (
                <TableEmptyState
                  colSpan={activeTab === 'deposit' ? 11 : 12}
                  title={`No ${activeTab === 'deposit' ? 'deposit records' : 'transaction records'} found`}
                  message="No records match your active company, date range, or search criteria."
                />
              ) : (
                (activeTab === 'deposit' ? displayedDepositTransactions : displayedSalesTransactions).map((tx) => {
                  const { deposit: depositAmt, withdrawal: withdrawalAmt } = getRowAmounts(tx)

                  const txKey = `${tx.type}:${tx.id}`
                  return (
                    <TableRow
                      key={txKey}
                      onClick={() => handleRowClick(tx)}
                      title="Click to view transaction details and audit history"
                      className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer"
                    >
                      {/* 1. Date: deposit day on the Deposit tab, sales date on All Transactions */}
                      <TableCell className="px-4 py-3.5 text-xs font-medium text-focus whitespace-nowrap">
                        {tx.date}
                      </TableCell>

                      {/* 1b. Deposit day (All Transactions only): empty until the sale is deposited */}
                      {activeTab !== 'deposit' && (
                        <TableCell className="px-4 py-3.5 text-xs font-medium whitespace-nowrap">
                          {getDepositDayShort(tx) ? (
                            <span className="text-emerald-700">{getDepositDayShort(tx)}</span>
                          ) : (
                            <span className="text-muted-fg/50">—</span>
                          )}
                        </TableCell>
                      )}

                      {/* 2. Company (Deposit tab only) */}
                      {activeTab === 'deposit' && (
                        <TableCell className="px-4 py-3.5 text-xs font-medium text-focus/90 truncate max-w-[160px]" title={tx.company}>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200/60 max-w-full truncate">
                            {tx.company || '—'}
                          </span>
                        </TableCell>
                      )}

                      {/* 2b. Type (Deposit tab only): Sales, Expense, Loan or Petty Cash */}
                      {activeTab === 'deposit' && (
                        <TableCell className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                              tx.type === 'Sales'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : tx.type === 'Expense'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : tx.type === 'Loan'
                                ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : tx.type === 'Petty Cash'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            )}
                          >
                            {tx.type}
                          </span>
                        </TableCell>
                      )}

                      {/* 3. Cheque No */}
                      <TableCell className="px-4 py-3.5 text-xs text-focus/90 whitespace-nowrap font-mono">
                        {tx.chequeNo || '—'}
                      </TableCell>

                      {/* 4. Particulars */}
                      <TableCell className="px-4 py-3.5 text-xs text-focus/90 font-normal max-w-xs" title={tx.particulars || tx.description}>
                        {(() => {
                          const summary = getParticularsSummary(tx.particulars || tx.description, tx.items)
                          if (summary.count > 1) {
                            return (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate block font-medium">{summary.firstItemName}</span>
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                  +{summary.count - 1} more
                                </span>
                              </div>
                            )
                          }
                          if (tx.awaitingAudit) {
                            // Only reachable on the All tab: Finance endorsed it, Audit has not approved yet
                            return (
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate block font-medium">{summary.firstItemName}</span>
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200"
                                  title="Endorsed by Finance. Waiting for Internal Audit approval."
                                >
                                  Pending Audit
                                </span>
                              </div>
                            )
                          }
                          return <span className="truncate block font-medium">{summary.firstItemName}</span>
                        })()}
                        {getDepositBadgeText(tx) && (
                          <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {getDepositBadgeText(tx)}
                          </span>
                        )}
                      </TableCell>

                      {/* 5. Category or Payment Method */}
                      <TableCell className="px-4 py-3.5 text-xs text-focus/90 font-medium whitespace-nowrap">
                        {activeTab === 'deposit' ? tx.category : (tx.paymentMethod || 'Cash')}
                      </TableCell>

                      {/* 6. Deposit (money in) */}
                      <TableCell className="px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap text-emerald-600">
                        {depositAmt > 0 ? formatPHP(depositAmt) : <span className="text-muted-fg/50 font-normal">—</span>}
                      </TableCell>

                      {/* 7. Withdrawal (money out) */}
                      <TableCell className="px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap text-rose-600">
                        {withdrawalAmt > 0 ? formatPHP(withdrawalAmt) : <span className="text-muted-fg/50 font-normal">—</span>}
                      </TableCell>

                      {/* 7b. Balance (Deposit tab: running total per company) or Net Amount (All tab: deposit minus withdrawal) */}
                      {(() => {
                        const shown =
                          activeTab === 'deposit'
                            ? depositBalanceByKey.get(`${tx.type}:${tx.id}`) ?? depositBalanceByKey.get(`${escapeHtml(tx.type)}:${tx.id}`) ?? 0
                            : Math.round((depositAmt - withdrawalAmt) * 100) / 100
                        return (
                          <TableCell
                            className={cn(
                              'px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap',
                              shown < 0 ? 'text-rose-600' : 'text-focus'
                            )}
                          >
                            {shown < 0 ? `-${formatPHP(Math.abs(shown))}` : formatPHP(shown)}
                          </TableCell>
                        )
                      })()}

                      {/* 8. Status (hidden on the Deposit tab: deposited means paid) */}
                      {activeTab !== 'deposit' && (
                      <TableCell className="px-4 py-3.5 text-center whitespace-nowrap">
                        {tx.status === 'Paid' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Paid
                          </span>
                        ) : tx.status === 'Pending' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Pending
                          </span>
                        ) : tx.status === 'On hold' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-700 border border-stone-200">
                            On hold
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            {tx.status || 'Unpaid'}
                          </span>
                        )}
                      </TableCell>
                      )}

                      {/* 8b. Deposit Status (sales only) */}
                      {activeTab !== 'deposit' && (
                        <TableCell className="px-4 py-3.5 text-center whitespace-nowrap">
                          <DepositStatusBadge tx={tx} />
                        </TableCell>
                      )}

                      {/* 8. Audit Status Badge (Visible for all roles) */}
                      <TableCell className="px-4 py-3.5 text-center whitespace-nowrap">
                        {tx.auditStatus === 'Verified' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Audited</span>
                          </span>
                        ) : tx.auditStatus === 'Flagged' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                            <AlertCircle className="w-3 h-3 text-rose-600" />
                            <span>Discrepancy</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shadow-2xs">
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            <span>Pending</span>
                          </span>
                        )}
                      </TableCell>

                      {/* 9. Actions: 3 dots action button */}
                      <TableCell
                        className="px-3 py-3.5 text-center whitespace-nowrap"
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
                            className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                            title="Actions"
                            aria-label="Open action menu"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

        {/* 4b. Totals for the rows that match the current filters (spec 0016) */}
        {salesViewMode === 'daily_summary' ? null : activeTab === 'deposit' ? (
          <div
            className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs"
            aria-label="Totals for the filtered deposit rows"
            data-testid="ledger-totals"
          >
            <div
              className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-sky-200/70 bg-sky-50/60"
              title={
                selectedBankAccount
                  ? `${selectedBankAccount.bankName} (${selectedBankAccount.accountType}) starting balance`
                  : `Consolidated starting balance (${availableBankAccounts.length} bank account${availableBankAccounts.length === 1 ? '' : 's'})`
              }
            >
              <div className="flex flex-col min-w-0 pr-1">
                <span className="font-semibold text-sky-800 truncate">Starting Balance</span>
                {selectedBankAccount && (
                  <span className="text-[10px] text-sky-600 truncate font-normal">
                    {selectedBankAccount.bankName}
                  </span>
                )}
              </div>
              <span className="font-bold tabular-nums text-sky-700 shrink-0">{formatPHP(activeStartingBalance)}</span>
            </div>
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-emerald-200/70 bg-emerald-50/60">
              <span className="font-semibold text-emerald-800">Total Deposits</span>
              <span className="font-bold tabular-nums text-emerald-700">{formatPHP(activeTotals.deposits)}</span>
            </div>
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-rose-200/70 bg-rose-50/60">
              <span className="font-semibold text-rose-800">Total Withdrawals</span>
              <span className="font-bold tabular-nums text-rose-700">{formatPHP(activeTotals.withdrawals)}</span>
            </div>
            <div
              className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50"
              title={
                selectedBankAccount
                  ? `${selectedBankAccount.bankName} ending balance`
                  : 'Starting balance + net deposits'
              }
            >
              <div className="flex flex-col min-w-0 pr-1">
                <span className="font-semibold text-focus truncate">Ending Balance</span>
                {selectedBankAccount && (
                  <span className="text-[10px] text-muted-fg truncate font-normal">
                    {selectedBankAccount.bankName}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'font-bold tabular-nums shrink-0',
                  activeEndingBalance < 0 ? 'text-rose-600' : 'text-focus'
                )}
              >
                {activeEndingBalance < 0 ? `-${formatPHP(Math.abs(activeEndingBalance))}` : formatPHP(activeEndingBalance)}
              </span>
            </div>
          </div>
        ) : (
          <div
            className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs"
            aria-label="Totals for the filtered rows"
            data-testid="ledger-totals"
          >
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-emerald-200/70 bg-emerald-50/60">
              <span className="font-semibold text-emerald-800">Total Deposits</span>
              <span className="font-bold tabular-nums text-emerald-700">{formatPHP(activeTotals.deposits)}</span>
            </div>
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-rose-200/70 bg-rose-50/60">
              <span className="font-semibold text-rose-800">Total Withdrawals</span>
              <span className="font-bold tabular-nums text-rose-700">{formatPHP(activeTotals.withdrawals)}</span>
            </div>
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50">
              <span className="font-semibold text-focus">Net Amount</span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  activeTotals.net < 0 ? 'text-rose-600' : 'text-focus'
                )}
              >
                {activeTotals.net < 0 ? `-${formatPHP(Math.abs(activeTotals.net))}` : formatPHP(activeTotals.net)}
              </span>
            </div>
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

      {/* 6. Transaction Details Modal (If audited, editing is locked; if not audited, provides edit in Excel sheet) */}
      <AuditTransactionModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        transaction={selectedTx}
        onTransactionUpdated={handleTransactionUpdated}
        editable={!isAdmin}
      />

      {/* 6b. By Day row menu (acts on the whole day) */}
      {dayMenu && typeof document !== 'undefined' && (() => {
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
                <button
                  type="button"
                  disabled={auditable.length === 0}
                  onClick={() => {
                    close()
                    handleAuditWholeDay(dayGroup?.date ?? dayMenu.date, dayTxs)
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Audit whole day{auditable.length > 0 ? ` (${auditable.length})` : ''}</span>
                </button>
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
      {openMenuTxId && activeMenuTx && menuPosition && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {canAudit && (
              <>
                <button
                  type="button"
                  onClick={() => handleMenuMarkAudit(activeMenuTx)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{activeMenuTx.auditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleMenuOpenDiscrepancy(activeMenuTx)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Flag Discrepancy</span>
                </button>
              </>
            )}

            {canEditTx(activeMenuTx) && (
              <button
                type="button"
                onClick={() => handleMenuEdit(activeMenuTx)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Edit</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleMenuViewDetails(activeMenuTx)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer",
                canAudit && "border-t border-slate-100 mt-1 pt-1.5"
              )}
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>View Details</span>
            </button>

          </div>,
          document.body
        )}

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

    </div>
  )
}
