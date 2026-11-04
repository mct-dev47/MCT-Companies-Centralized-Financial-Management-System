import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  HandCoins,
  Receipt,
  FileText,
  Percent,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { CATEGORY_COLORS } from '@/utils/categoryConstants'
import type { CompanyLoanGroup } from '@/services/loanService'
import { cn } from '@/lib/utils'

export interface RepaymentTimelineItem {
  refNo: string
  paymentDate: string
  amount: number
  remainingBalance: number
  reference: string
}

interface CompanyLoanDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: CompanyLoanGroup | null
  timeline: RepaymentTimelineItem[]
  loadingTimeline?: boolean
}

export const CompanyLoanDetailsModal: React.FC<CompanyLoanDetailsModalProps> = ({
  open,
  onOpenChange,
  group,
  timeline,
  loadingTimeline = false,
}) => {
  if (!group) return null

  const categoryColor =
    (CATEGORY_COLORS as Record<string, string>)[group.category] || '#64748B'

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Fully Paid':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
          icon: CheckCircle2,
          label: 'Fully Paid / Settled',
        }
      case 'Partially Paid':
        return {
          bg: 'bg-blue-50 text-blue-700 border-blue-200/80',
          icon: Clock,
          label: 'Partially Paid',
        }
      case 'Overdue':
        return {
          bg: 'bg-red-50 text-red-700 border-red-200/80',
          icon: AlertTriangle,
          label: 'Overdue',
        }
      case 'Unpaid':
      default:
        return {
          bg: 'bg-amber-50 text-amber-700 border-amber-200/80',
          icon: Clock,
          label: status || 'Unpaid',
        }
    }
  }

  const statusBadge = getStatusBadge(group.paymentStatus)
  const StatusIcon = statusBadge.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] sm:rounded-[28px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl sm:max-w-[820px] max-h-[85vh] overflow-y-auto">
        {/* 1. Header */}
        <DialogHeader className="text-left pb-4 border-b border-stroke/20 pr-8">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#960C01]/10 text-[#960C01] flex items-center justify-center shrink-0 shadow-xs">
                <HandCoins className="w-5 h-5 text-[#960C01]" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-bold text-focus leading-tight">
                  Company Loan Details
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
                  Inter-company borrowing breakdown and repayment timeline record
                </DialogDescription>
              </div>
            </div>

            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border shadow-2xs',
                statusBadge.bg
              )}
            >
              <StatusIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{statusBadge.label}</span>
            </span>
          </div>
        </DialogHeader>

        {/* 2. Modal Body */}
        <div className="space-y-5 pt-3">
          {/* Company Relationship & Balance Highlight Banner */}
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-50 via-slate-50/80 to-slate-100/60 border border-slate-200/80 shadow-2xs space-y-4">
            {/* Companies row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200/60">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10.5px] uppercase font-bold text-muted-fg tracking-wider block">
                      Borrower
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-focus block">
                      {group.borrower}
                    </span>
                  </div>
                </div>

                <ArrowRight className="w-4 h-4 text-muted-fg shrink-0 mx-1 hidden sm:block" />

                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10.5px] uppercase font-bold text-muted-fg tracking-wider block">
                      Lender
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-focus block">
                      {group.lender}
                    </span>
                  </div>
                </div>
              </div>

              {/* Category & Interest Badge */}
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-stroke/30 text-xs font-semibold text-focus shadow-2xs">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: categoryColor }}
                  />
                  <span>{group.category}</span>
                </div>
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-stroke/30 text-xs font-semibold text-focus shadow-2xs">
                  <Percent className="w-3 h-3 text-muted-fg" />
                  <span>{group.interestDisplay || '0.00%'}</span>
                </div>
              </div>
            </div>

            {/* Financial summary numbers: Total Loan, Total Paid, Outstanding Balance */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-white border border-slate-200/70 shadow-2xs">
                <span className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider block">
                  Total Loan Amount
                </span>
                <span className="text-base sm:text-lg font-bold text-focus tabular-nums tracking-tight mt-0.5 block">
                  {formatPHP(group.totalLoanAmount)}
                </span>
                <span className="text-[11px] text-muted-fg mt-0.5 block">
                  {group.loanCount} facility record(s)
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white border border-emerald-200/70 shadow-2xs">
                <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider block">
                  Total Paid
                </span>
                <span className="text-base sm:text-lg font-bold text-emerald-600 tabular-nums tracking-tight mt-0.5 block">
                  {formatPHP(group.totalPaid)}
                </span>
                <span className="text-[11px] text-emerald-700/80 mt-0.5 block">
                  Settled principal
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white border border-amber-200/70 shadow-2xs">
                <span className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider block">
                  Outstanding Balance
                </span>
                <span className="text-base sm:text-lg font-bold text-amber-700 tabular-nums tracking-tight mt-0.5 block">
                  {formatPHP(group.outstandingBalance)}
                </span>
                <span className="text-[11px] text-amber-700/80 mt-0.5 block">
                  Remaining payable
                </span>
              </div>
            </div>
          </div>

          {/* 3. Included Loan Facilities */}
          {group.loans && group.loans.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-focus uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-muted-fg" />
                  <span>Approved Facilities ({group.loans.length})</span>
                </span>
              </div>

              <div className="rounded-xl border border-slate-200/80 overflow-hidden divide-y divide-slate-100 bg-white">
                {group.loans.map((loan) => (
                  <div
                    key={loan.id}
                    className="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-focus">
                          {loan.refNo}
                        </span>
                        <span className="text-[11px] text-muted-fg flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-muted-fg" />
                          <span>{loan.date}</span>
                        </span>
                      </div>
                      <p className="text-muted-fg text-[11px] truncate max-w-md">
                        {loan.particulars}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 sm:text-right shrink-0">
                      <div>
                        <span className="text-[10px] text-muted-fg uppercase block">
                          Principal
                        </span>
                        <span className="font-bold text-focus tabular-nums">
                          {formatPHP(loan.amount)}
                        </span>
                      </div>
                      {loan.dueDate && (
                        <div>
                          <span className="text-[10px] text-muted-fg uppercase block">
                            Due Date
                          </span>
                          <span className="text-muted-fg font-medium">
                            {loan.dueDate}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Repayment Timeline Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-focus uppercase tracking-wider flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-muted-fg" />
                <span>Repayment Timeline & Ledger</span>
              </span>
              <span className="text-[11px] text-muted-fg">
                {timeline.length} payment entry(s)
              </span>
            </div>

            {loadingTimeline ? (
              <div className="p-5 rounded-xl border border-slate-200/80 bg-white space-y-3">
                <div className="h-4 w-36 bg-slate-200/70 rounded animate-pulse" />
                <div className="h-9 w-full bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-9 w-full bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-9 w-full bg-slate-100 rounded-lg animate-pulse" />
              </div>
            ) : timeline.length === 0 ? (
              <div className="p-6 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
                <Clock className="w-6 h-6 text-slate-300 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-focus">No repayments recorded yet</p>
                <p className="text-[11px] text-muted-fg mt-0.5">
                  Payments recorded against this loan group will appear here with balance tracking.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white">
                <table className="w-full text-left text-xs min-w-[540px]">
                  <thead className="bg-slate-50 border-b border-slate-200/80 text-[10.5px] uppercase font-bold text-muted-fg">
                    <tr>
                      <th className="px-3 py-2.5">REF NO.</th>
                      <th className="px-3 py-2.5">PAYMENT DATE</th>
                      <th className="px-3 py-2.5 text-right">AMOUNT PAID</th>
                      <th className="px-3 py-2.5 text-right">REMAINING BALANCE</th>
                      <th className="px-3 py-2.5">REFERENCE / NOTES</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {timeline.map((entry, idx) => (
                      <tr
                        key={`${entry.refNo}-${entry.paymentDate}-${idx}`}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="px-3 py-2.5 font-mono font-medium text-focus">
                          {entry.refNo}
                        </td>
                        <td className="px-3 py-2.5 text-muted-fg whitespace-nowrap">
                          {entry.paymentDate}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-emerald-600 text-right tabular-nums whitespace-nowrap">
                          {formatPHP(entry.amount)}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-focus text-right tabular-nums whitespace-nowrap">
                          {formatPHP(entry.remainingBalance)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-fg truncate max-w-[180px]">
                          {entry.reference || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
