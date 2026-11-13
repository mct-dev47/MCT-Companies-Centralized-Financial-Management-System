import * as React from 'react'
import {
  Coins,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  AlertCircle,
  Receipt,
  Pencil,
  Plus,
  HandCoins,
} from 'lucide-react'
import { getLoanStatusDisplay, isLoanDisbursed } from '@/components/dashboard/loanStatusStyle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BackButton } from '@/components/common'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  loanService,
  type LoanItem,
  type LoanRepaymentRecord,
} from '@/services/loanService'

export interface LoanDetailPageViewProps {
  loan: LoanItem
  loanType: 'Borrower' | 'Lender'
  isAuditor: boolean
  isOwner: boolean
  canApprove: boolean
  canAuditActions: boolean
  onBack: () => void
  onOpenRecordPayment: (loan: LoanItem) => void
  onOpenEdit: (loan: LoanItem) => void
  onOpenEndorse: (loan: LoanItem) => void
  onOpenAuditReview: (loan: LoanItem) => void
  onOpenDisburse?: (loan: LoanItem) => void
  onMarkAudit: (loan: LoanItem, status: 'Verified' | 'Flagged') => void
}

const HISTORY_ITEMS_PER_PAGE = 8

export const LoanDetailPageView: React.FC<LoanDetailPageViewProps> = ({
  loan,
  loanType,
  isAuditor,
  isOwner,
  canApprove,
  canAuditActions,
  onBack,
  onOpenRecordPayment,
  onOpenEdit,
  onOpenEndorse,
  onOpenAuditReview,
  onOpenDisburse,
  onMarkAudit,
}) => {
  const [detailSearchQuery, setDetailSearchQuery] = React.useState<string>('')
  const [historyPage, setHistoryPage] = React.useState<number>(1)
  const [statementRepayments, setStatementRepayments] = React.useState<LoanRepaymentRecord[]>([])

  React.useEffect(() => {
    setHistoryPage(1)
  }, [loan.id, detailSearchQuery])

  React.useEffect(() => {
    let mounted = true
    const numericId = Number(String(loan.loanId || loan.id).replace(/\D/g, ''))
    if (!numericId || Number.isNaN(numericId)) {
      setStatementRepayments([])
      return
    }
    loanService
      .getCompanyLoanStatement(numericId)
      .then((stmt: any) => {
        if (!mounted || !stmt) return
        const list = Array.isArray(stmt.repayments) ? stmt.repayments : []
        const mapped: LoanRepaymentRecord[] = list.map((r: any, idx: number) => ({
          id: String(r.repayment_id || r.id || `stmt-${idx}`),
          paymentDate: String(r.payment_date || r.paymentDate || loan.rawDate || loan.date),
          amount: Number(r.amount || 0),
          remainingBalance: Number(r.remaining_balance ?? r.remainingBalance ?? 0),
          referenceNo: String(r.reference_no || r.reference || r.referenceNo || '—'),
          paymentMethod: String(r.payment_method || r.paymentMethod || 'Bank Transfer'),
          notes: String(r.notes || r.remarks || 'Loan repayment remittance'),
        }))
        setStatementRepayments(mapped)
      })
      .catch(() => {
        // Fallback to loan.repayments when offline or statement endpoint not available
      })
    return () => {
      mounted = false
    }
  }, [loan.id, loan.loanId, loan.totalPaid, loan.status, loan.rawDate, loan.date])

  const totalAmount = loan.amount || 0
  const totalPaid = loan.totalPaid || 0
  const remainingBalance =
    loan.outstandingBalance !== undefined
      ? loan.outstandingBalance
      : Math.max(0, totalAmount - totalPaid)

  const combinedRepayments = React.useMemo(() => {
    const localList = loan.repayments || []
    const map = new Map<string, LoanRepaymentRecord>()
    statementRepayments.forEach((r) => {
      map.set(`${r.paymentDate}-${r.amount}-${r.referenceNo || ''}`, r)
    })
    localList.forEach((r) => {
      const key = `${r.paymentDate}-${r.amount}-${r.referenceNo || ''}`
      if (!map.has(key)) {
        map.set(key, r)
      }
    })
    return Array.from(map.values()).sort((a, b) =>
      b.paymentDate.localeCompare(a.paymentDate)
    )
  }, [loan.repayments, statementRepayments])

  const filteredRepayments = React.useMemo(() => {
    const q = detailSearchQuery.trim().toLowerCase()
    if (!q) return combinedRepayments
    return combinedRepayments.filter(
      (r) =>
        r.paymentDate.toLowerCase().includes(q) ||
        (r.referenceNo || '').toLowerCase().includes(q) ||
        (r.paymentMethod || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
    )
  }, [combinedRepayments, detailSearchQuery])

  const totalHistoryPages = Math.max(
    1,
    Math.ceil(filteredRepayments.length / HISTORY_ITEMS_PER_PAGE)
  )
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages)
  const historyStartIndex = (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE
  const historyEndIndex = Math.min(
    historyStartIndex + HISTORY_ITEMS_PER_PAGE,
    filteredRepayments.length
  )
  const paginatedHistory = filteredRepayments.slice(historyStartIndex, historyEndIndex)

  const isPendingEndorsement =
    loan.status === 'Pending Finance Endorsement' ||
    loan.status === 'Pending Approval' ||
    ((loan.status || '').toLowerCase().includes('pending') &&
      !(loan.status || '').toLowerCase().includes('audit'))

  const canPayLoan =
    !isAuditor &&
    !isOwner &&
    loanType === 'Borrower' &&
    isLoanDisbursed(loan.status) &&
    remainingBalance > 0.005

  const counterpartyName = loanType === 'Borrower' ? loan.lender || 'Pending Assignment' : loan.borrower

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-200">
      {/* Top navigation row */}
      <div className="flex items-center justify-between gap-3">
        <BackButton onClick={onBack} label="Back to Loans" />
      </div>

      {/* Loan Facility Header (Matching Tenant & FilCap Lending exactly) */}
      <div className="pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-focus tracking-tight">
                {counterpartyName}
              </h1>
              <span
                className={cn(
                  'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider',
                  getLoanStatusDisplay(loan.status).badgeClass
                )}
              >
                {getLoanStatusDisplay(loan.status).label}
              </span>
              {loan.auditStatus && loan.auditStatus !== 'Pending Audit' && (
                <span
                  className={cn(
                    'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider',
                    loan.auditStatus === 'Verified'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  )}
                >
                  {loan.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs sm:text-sm text-muted-fg font-medium">
                Ref No: <strong className="text-focus font-mono">{loan.refNo}</strong>
              </span>
              <span className="text-muted-fg/40">•</span>
              <span className="text-xs sm:text-sm text-muted-fg font-medium">
                Borrower: <strong className="text-focus">{loan.borrower}</strong>
              </span>
              <span className="text-muted-fg/40">•</span>
              <span className="text-xs sm:text-sm text-muted-fg font-medium">
                Lender: <strong className="text-focus">{loan.lender || 'Pending'}</strong>
              </span>
            </div>
          </div>

          {/* Action Buttons in the same row as the Facility Name */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
            {canPayLoan && (
              <Button
                type="button"
                onClick={() => onOpenRecordPayment(loan)}
                className="h-10 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Coins className="h-4 w-4" />
                <span>Record Payment</span>
              </Button>
            )}

            {!isAuditor && !isOwner && canApprove && loan.status === 'Approved' && onOpenDisburse && (
              <Button
                type="button"
                onClick={() => onOpenDisburse(loan)}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <HandCoins className="h-4 w-4" />
                <span>Disburse Loan</span>
              </Button>
            )}

            {!isAuditor && !isOwner && canApprove && isPendingEndorsement && (
              <Button
                type="button"
                onClick={() => onOpenEndorse(loan)}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Endorse Loan</span>
              </Button>
            )}

            {!isAuditor && !isOwner && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenEdit(loan)}
                className="h-10 px-3.5 rounded-xl border border-stroke/60 bg-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer hover:bg-surface text-focus shadow-2xs"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit Terms</span>
              </Button>
            )}

            {canAuditActions && loan.status === 'Pending Audit Approval' && (
              <Button
                type="button"
                onClick={() => onOpenAuditReview(loan)}
                className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Review Approval</span>
              </Button>
            )}

            {canAuditActions && (
              <>
                <Button
                  type="button"
                  onClick={() => onMarkAudit(loan, 'Verified')}
                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{loan.auditStatus === 'Verified' ? 'Re-Audit' : 'Mark as Audited'}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onMarkAudit(loan, 'Flagged')}
                  className="h-10 px-4 rounded-xl border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <AlertCircle className="h-4 w-4" />
                  <span>Flag Discrepancy</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Two Section Layout: Loan Agreement & Terms (Left) & Payment Schedule & History (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Column: Loan Agreement & Terms Styled Like a Financial Receipt */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
          <div className="space-y-3.5">
            {/* Receipt Header */}
            <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-focus">
                  <Receipt className="w-4 h-4 text-focus" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                    Loan Agreement & Terms
                  </h3>
                  <span className="text-[10px] text-muted-fg font-medium">
                    Official Agreement Receipt
                  </span>
                </div>
              </div>
              <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold border border-slate-200">
                {loan.refNo}
              </span>
            </div>

            {/* Terms & Schedule Parameters */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Date Contracted:</span>
                <span className="font-mono text-focus">{loan.rawDate || loan.date}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Maturity / Next Due:</span>
                <span className="font-mono text-focus">
                  {remainingBalance <= 0.005 ? 'Fully Paid' : loan.dueDate || 'On Demand'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Borrower Company:</span>
                <span className="font-semibold text-focus truncate max-w-[180px]">
                  {loan.borrower}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Lender Company:</span>
                <span className="font-semibold text-focus truncate max-w-[180px]">
                  {loan.lender || 'Pending Assignment'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Facility Category:</span>
                <span className="font-semibold text-focus">{loan.category || 'Inter-Company'}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-fg">Particulars / Purpose:</span>
                <span className="font-semibold text-focus truncate max-w-[180px]" title={loan.particulars}>
                  {loan.particulars}
                </span>
              </div>
            </div>

            {/* Dashed Perforation */}
            <div className="border-t border-dashed border-slate-200" />

            {/* Financial Breakdown */}
            <div className="space-y-1.5 text-xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                Financial Breakdown
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-fg">Principal Amount:</span>
                <span className="font-mono font-bold text-focus">{formatPHP(totalAmount)}</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-fg">Interest Rate:</span>
                <span className="font-mono font-bold text-focus">
                  {loan.interestRate !== undefined ? `${loan.interestRate}%` : '0%'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-sm">
                <span className="text-focus">Total Payable:</span>
                <span className="font-mono text-focus">{formatPHP(totalAmount)}</span>
              </div>
            </div>

            {/* Dashed Perforation */}
            <div className="border-t border-dashed border-slate-200" />

            {/* Collections & Balances */}
            <div className="space-y-2 text-xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                Collections & Balances
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-fg">Amount Paid:</span>
                <span className="font-mono font-bold text-emerald-600">{formatPHP(totalPaid)}</span>
              </div>

              {/* Remaining Balance Receipt Box */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-focus block">Remaining Balance</span>
                  <span className="text-[10px] text-muted-fg">Balance to complete</span>
                </div>
                <span
                  className={cn(
                    'text-base font-mono font-extrabold',
                    remainingBalance <= 0.005 ? 'text-emerald-600' : 'text-amber-600'
                  )}
                >
                  {formatPHP(remainingBalance)}
                </span>
              </div>

              {/* Target Principal Box */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-focus block">Contracted Principal</span>
                  <span className="text-[10px] text-muted-fg">Inter-company facility</span>
                </div>
                <span className="text-sm font-mono font-bold text-focus">
                  {formatPHP(totalAmount)}
                </span>
              </div>
            </div>

            {loan.financeRemark && (
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-muted-fg">
                <strong className="text-focus font-semibold block mb-0.5 text-[11px]">
                  Finance Endorsement Note:
                </strong>
                {loan.financeRemark}
              </div>
            )}

            {(loan.auditRemark || loan.auditNotes) && (
              <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl text-xs text-rose-900">
                <strong className="text-rose-900 font-semibold block mb-0.5 text-[11px] flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  Auditor Remarks:
                </strong>
                <p className="leading-relaxed whitespace-pre-wrap">
                  {loan.auditRemark || loan.auditNotes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Full Width Payment Schedule & History Table (Matching Tenant & FilCap) */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
          <div className="flex-1 flex flex-col space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                  Payment Schedule & History ({filteredRepayments.length})
                </h3>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg pointer-events-none" />
                <Input
                  type="text"
                  value={detailSearchQuery}
                  onChange={(e) => {
                    setDetailSearchQuery(e.target.value)
                    setHistoryPage(1)
                  }}
                  placeholder="Search dates or remarks..."
                  className="pl-9 pr-8 h-9 text-xs rounded-xl bg-slate-50 border-stroke/60 focus:bg-white"
                />
                {detailSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailSearchQuery('')
                      setHistoryPage(1)
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus text-xs p-0.5 cursor-pointer"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Payment Schedule & History Table or Empty State */}
            <div className="flex-1 flex flex-col">
              {combinedRepayments.length === 0 ? (
                <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                    <Coins className="w-7 h-7" />
                  </div>
                  <h4 className="text-sm font-bold text-focus">No Payments Recorded Yet</h4>
                  <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                    No repayments have been logged against this loan facility yet. All recorded payment transactions, dates, amounts, and receipt references will appear here.
                  </p>
                  {canPayLoan && (
                    <Button
                      type="button"
                      onClick={() => onOpenRecordPayment(loan)}
                      className="h-9 px-4 rounded-xl font-semibold text-xs bg-focus hover:bg-focus/90 text-white flex items-center gap-2 cursor-pointer shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Record Payment</span>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 flex-1">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-muted-fg font-semibold">
                      <tr>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Due Date</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Payment Date</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Amount Paid</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Method</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Receipt / Ref No.</th>
                        <th className="py-2.5 px-3.5 text-left">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedHistory.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-muted-fg text-xs">
                            No payment records matching &quot;{detailSearchQuery}&quot;
                          </td>
                        </tr>
                      ) : (
                        paginatedHistory.map((rec) => {
                          const isPartial = rec.remainingBalance > 0.005
                          return (
                            <tr
                              key={rec.id}
                              className={cn(
                                'hover:bg-slate-50/70 transition-colors',
                                isPartial && 'bg-amber-50/20'
                              )}
                            >
                              <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                {loan.dueDate || loan.rawDate || loan.date}
                              </td>
                              <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap font-medium">
                                {rec.paymentDate}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                {isPartial ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                    <span>Partially Paid</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Check className="w-2.5 h-2.5 text-emerald-600" />
                                    <span>Paid</span>
                                  </span>
                                )}
                              </td>
                              <td
                                className={cn(
                                  'py-2.5 px-3.5 font-bold whitespace-nowrap tabular-nums',
                                  isPartial ? 'text-amber-700' : 'text-emerald-600'
                                )}
                              >
                                {formatPHP(rec.amount)}
                              </td>
                              <td className="py-2.5 px-3.5 text-focus whitespace-nowrap">
                                {rec.paymentMethod || 'Bank Transfer'}
                              </td>
                              <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap">
                                {rec.referenceNo || '—'}
                              </td>
                              <td className="py-2.5 px-3.5 text-muted-fg truncate max-w-[220px]" title={rec.notes || '—'}>
                                {rec.notes || 'Loan repayment remittance'}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Payment Schedule & History Pagination Footer (Anchored at Bottom Matching FilCap & Tenant) */}
          <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
            <span className="font-medium text-focus/80">
              {filteredRepayments.length === 0
                ? 'Showing 0-0 of 0 records'
                : `Showing ${historyStartIndex + 1}-${historyEndIndex} of ${filteredRepayments.length} records`}
            </span>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span className="text-xs text-muted-fg font-medium">
                Page {safeHistoryPage} out of {totalHistoryPages}
              </span>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safeHistoryPage <= 1}
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                aria-label="Previous history page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safeHistoryPage >= totalHistoryPages}
                onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                aria-label="Next history page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
