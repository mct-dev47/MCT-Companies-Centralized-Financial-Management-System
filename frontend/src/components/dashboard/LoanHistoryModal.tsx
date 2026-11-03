import * as React from 'react'
import {
  History,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Info,
  ShieldCheck,
  CreditCard,
  Hash,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatPHP } from '@/lib/format'
import { CATEGORY_COLORS } from '@/utils/categoryConstants'
import type { LoanItem } from '@/services/loanService'
import { cn } from '@/lib/utils'

interface LoanHistoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  loan: LoanItem | null
}

export const LoanHistoryModal: React.FC<LoanHistoryModalProps> = ({
  open,
  onOpenChange,
  loan,
}) => {
  if (!loan) return null

  const categoryColor = (CATEGORY_COLORS as Record<string, string>)[loan.category] || '#64748B'

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Paid':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
          icon: CheckCircle2,
          label: 'Paid / Settled',
        }
      case 'Pending':
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200/80',
          icon: Clock,
          label: 'Pending Settlement',
        }
      case 'Overdue':
        return {
          bg: 'bg-red-50 text-red-700 border-red-200/80',
          icon: AlertTriangle,
          label: 'Overdue',
        }
      default:
        return {
          bg: 'bg-slate-50 text-slate-700 border-slate-200/80',
          icon: Clock,
          label: status,
        }
    }
  }

  const statusBadge = getStatusBadge(loan.status)
  const StatusIcon = statusBadge.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] p-5 sm:p-6 bg-white border border-stroke/30 shadow-2xl sm:max-w-[680px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-7">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
                <History className="w-4 h-4 text-white" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-focus leading-tight">
                  Loan History & Details
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-fg font-normal mt-0.5">
                  Historical audit and origination record · View-only for Lender
                </DialogDescription>
              </div>
            </div>

            {/* Status Badge */}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border',
                statusBadge.bg
              )}
            >
              <StatusIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{statusBadge.label}</span>
            </span>
          </div>
        </DialogHeader>

        {/* Modal Body */}
        <div className="space-y-4 pt-3">
          {/* 1. Primary Highlight Card: Borrower & Amount */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/70 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider block">
                Total Loan Amount
              </span>
              <span className="text-xl sm:text-2xl font-bold text-focus tabular-nums tracking-tight">
                {formatPHP(loan.amount)}
              </span>
              <span className="text-2xs text-muted-fg block mt-0.5">
                Ref No: <span className="font-mono font-semibold text-focus/90">{loan.refNo}</span>
              </span>
            </div>

            <div className="sm:text-right bg-white/80 sm:bg-transparent p-2.5 sm:p-0 rounded-xl border sm:border-0 border-slate-200/60">
              <span className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider block">
                Borrowing Company
              </span>
              <div className="inline-flex items-center gap-1.5 mt-0.5 text-focus font-bold text-sm">
                <Building2 className="w-4 h-4 text-[#960C01] shrink-0" />
                <span>{loan.company}</span>
              </div>
              <span className="text-2xs text-muted-fg block">
                Borrower responsible for repayment
              </span>
            </div>
          </div>

          {/* 2. Key Information Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {/* Created At */}
            <div className="p-2.5 rounded-xl bg-surface/50 border border-stroke/20">
              <div className="flex items-center gap-1.5 text-muted-fg mb-1">
                <Calendar className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span className="text-[11px] font-medium">Date Created</span>
              </div>
              <span className="font-semibold text-focus font-mono text-xs">
                {loan.createdAt || loan.date}
              </span>
            </div>

            {/* Transaction Date */}
            <div className="p-2.5 rounded-xl bg-surface/50 border border-stroke/20">
              <div className="flex items-center gap-1.5 text-muted-fg mb-1">
                <Clock className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span className="text-[11px] font-medium">Transaction Date</span>
              </div>
              <span className="font-semibold text-focus text-xs">
                {loan.date}
              </span>
            </div>

            {/* Cheque No */}
            <div className="p-2.5 rounded-xl bg-surface/50 border border-stroke/20">
              <div className="flex items-center gap-1.5 text-muted-fg mb-1">
                <Hash className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span className="text-[11px] font-medium">Cheque Number</span>
              </div>
              <span className="font-semibold text-focus font-mono text-xs">
                {loan.chequeNo || '—'}
              </span>
            </div>

            {/* Category */}
            <div className="p-2.5 rounded-xl bg-surface/50 border border-stroke/20">
              <div className="flex items-center gap-1.5 text-muted-fg mb-1">
                <CreditCard className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span className="text-[11px] font-medium">Category / Method</span>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: categoryColor }}
                />
                <span className="font-semibold text-focus text-xs">
                  {loan.category}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Particulars Box */}
          <div className="p-3 rounded-xl bg-surface/40 border border-stroke/20 space-y-1">
            <span className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider block">
              Loan Particulars & Purpose
            </span>
            <p className="text-xs text-focus leading-relaxed">
              {loan.particulars || 'No additional particulars recorded.'}
            </p>
          </div>

          {/* 4. Loan Audit & History Timeline */}
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-bold text-focus uppercase tracking-wider block flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-focus/70" />
              <span>Loan Lifecycle & Audit Trail</span>
            </span>

            <div className="relative pl-5 border-l-2 border-slate-200 space-y-3.5 text-xs py-1">
              {/* Step 1: Origination */}
              <div className="relative">
                <div className="absolute -left-[27px] top-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white shadow-xs" />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-focus">Loan Originated</span>
                  <span className="text-[10px] text-muted-fg font-mono">
                    {loan.createdAt || loan.date}
                  </span>
                </div>
                <p className="text-[11px] text-muted-fg mt-0.5">
                  Facility created for <strong className="text-focus">{loan.company}</strong> by{' '}
                  <span className="text-focus/90 font-medium">
                    {loan.createdBy || 'Authorized Accounting Specialist'}
                  </span>
                  . Amount disbursed: <strong className="text-focus">{formatPHP(loan.amount)}</strong>.
                </p>
              </div>

              {/* Step 2: Audit Review */}
              <div className="relative">
                <div className="absolute -left-[27px] top-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-xs" />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-focus">Audit Review</span>
                  <span className="text-[10px] text-muted-fg font-mono">
                    {loan.auditDate || loan.createdAt || loan.date}
                  </span>
                </div>
                <p className="text-[11px] text-muted-fg mt-0.5">
                  Verified by{' '}
                  <span className="text-focus/90 font-medium">
                    {loan.auditedBy || 'Financial Auditor'}
                  </span>
                  . Audit Status:{' '}
                  <span className="font-semibold text-focus">{loan.auditStatus}</span>.
                  {loan.auditNotes && (
                    <span className="block mt-0.5 italic text-slate-500">
                      "{loan.auditNotes}"
                    </span>
                  )}
                </p>
              </div>

              {/* Step 3: Current Status */}
              <div className="relative">
                <div
                  className={cn(
                    'absolute -left-[27px] top-0.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow-xs',
                    loan.status === 'Paid' ? 'bg-emerald-600' : 'bg-amber-500'
                  )}
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-focus">
                    Repayment Status: {loan.status}
                  </span>
                  <span className="text-[10px] text-muted-fg font-mono">
                    {loan.updatedAt || loan.date}
                  </span>
                </div>
                <p className="text-[11px] text-muted-fg mt-0.5">
                  {loan.status === 'Paid'
                    ? 'Loan has been confirmed settled and marked as Paid by the borrowing company.'
                    : 'Payment is active / pending. The borrower is responsible for updating loan repayment status.'}
                </p>
              </div>
            </div>
          </div>

          {/* 5. View-Only Informational Banner */}
          <div className="p-3 rounded-xl bg-blue-50/80 border border-blue-200/70 text-blue-900 text-xs flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold block">View-Only Facility</span>
              <p className="text-[11px] text-blue-800 leading-relaxed">
                As the lender, this record is view-only. The borrower (<strong>{loan.company}</strong>) is responsible for updating the repayment status upon loan settlement.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
