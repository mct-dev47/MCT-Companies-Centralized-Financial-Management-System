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
  User,
  Building,
  Coins,
  Receipt,
  CheckCircle2,
  Phone,
  Briefcase,
  Calendar,
  AlertCircle,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PersonLedgerSummary, UtangSale } from '@/services/receivablesStore'

export interface PersonLedgerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: PersonLedgerSummary | null
  onOpenRecordPayment: (person: PersonLedgerSummary, sale?: UtangSale) => void
  onSettlePayrollDeduction: (customerName: string) => void
  isAudit?: boolean
}

export const PersonLedgerDrawer: React.FC<PersonLedgerDrawerProps> = ({
  open,
  onOpenChange,
  person,
  onOpenRecordPayment,
  onSettlePayrollDeduction,
  isAudit = false,
}) => {
  const [activeTab, setActiveTab] = React.useState<'ledger' | 'sales' | 'payments'>('ledger')
  const [showPayrollConfirm, setShowPayrollConfirm] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setActiveTab('ledger')
      setShowPayrollConfirm(false)
    }
  }, [open, person])

  // Combine sales and payments into a chronological running-balance ledger
  const combinedEvents = React.useMemo(() => {
    if (!person) return []

    type LedgerEvent = {
      id: string
      date: string
      type: 'Sale' | 'Payment'
      description: string
      debit: number // sale (increases balance)
      credit: number // payment (decreases balance)
      method?: string
      notes?: string
      status?: string
      runningBalance: number
    }

    const events: Array<{
      id: string
      date: string
      type: 'Sale' | 'Payment'
      description: string
      debit: number
      credit: number
      method?: string
      notes?: string
      status?: string
    }> = []

    person.sales.forEach((s) => {
      events.push({
        id: s.id,
        date: s.date,
        type: 'Sale',
        description: s.items_summary,
        debit: s.total_amount,
        credit: 0,
        status: s.payment_status,
        notes: s.notes,
      })
    })

    person.payments.forEach((p) => {
      events.push({
        id: p.id,
        date: p.date,
        type: 'Payment',
        description: `Payment via ${p.method}${p.notes ? ` (${p.notes})` : ''}`,
        debit: 0,
        credit: p.amount,
        method: p.method,
        notes: p.notes,
      })
    })

    // Sort ascending by date to compute accurate running balance
    events.sort((a, b) => a.date.localeCompare(b.date))

    let currentBalance = 0
    const listWithBalance: LedgerEvent[] = events.map((e) => {
      currentBalance = currentBalance + e.debit - e.credit
      return {
        ...e,
        runningBalance: Math.max(0, currentBalance),
      }
    })

    // Return reversed so newest events appear first in ledger display
    return listWithBalance.reverse()
  }, [person])

  if (!person) return null

  const isStaff = person.type === 'Staff'
  const hasBalance = person.total_owed > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] md:max-w-[840px] max-h-[88vh] flex flex-col bg-white rounded-[24px] p-5 sm:p-6 shadow-2xl overflow-hidden">
        {/* Header Profile */}
        <DialogHeader className="shrink-0 pb-3 border-b border-stroke/20 pr-8 text-left">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-base shrink-0 shadow-xs',
                  isStaff ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                )}
              >
                {person.name.charAt(0)}
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-focus leading-tight flex items-center gap-2">
                  <span>{person.name}</span>
                  <span
                    className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full border',
                      isStaff
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    )}
                  >
                    {isStaff ? 'Staff' : 'External'}
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-fg mt-0.5 flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Briefcase className="w-3 h-3" />
                    <span>{person.role_or_dept}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span>{person.phone}</span>
                  </span>
                </DialogDescription>
              </div>
            </div>

            {/* Badges & Actions */}
            <div className="flex items-center gap-2">
              {isAudit && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
                  View Only (Auditor)
                </span>
              )}
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-bold border shadow-2xs inline-flex items-center gap-1',
                  person.status === 'Paid'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : person.status === 'Partial'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                )}
              >
                {person.status === 'Paid' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Fully Settled</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5" />
                    <span>{person.status} ({person.agingBucket}d aging)</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* 3 Overview Financial Metrics */}
        <div className="grid grid-cols-3 gap-2.5 pt-3 pb-1 shrink-0">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg block">
              Total Purchases
            </span>
            <span className="text-sm sm:text-base font-bold text-focus mt-0.5 block tabular-nums">
              {formatPHP(person.total_sales_amount)}
            </span>
            <span className="text-[10px] text-muted-fg block">{person.sales_count} sales on record</span>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70 text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
              Total Paid
            </span>
            <span className="text-sm sm:text-base font-bold text-emerald-900 mt-0.5 block tabular-nums">
              {formatPHP(person.total_amount_paid)}
            </span>
            <span className="text-[10px] text-emerald-700 block">
              {person.total_sales_amount > 0
                ? `${Math.round((person.total_amount_paid / person.total_sales_amount) * 100)}% settled`
                : '100%'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
              Outstanding Utang
            </span>
            <span className="text-sm sm:text-base font-bold text-amber-950 mt-0.5 block tabular-nums">
              {formatPHP(person.total_owed)}
            </span>
            <span className="text-[10px] text-amber-700 block">
              {hasBalance ? 'Balance due' : 'Zero balance'}
            </span>
          </div>
        </div>

        {/* Payroll Settlement Banner for Staff (Disabled for Audit) */}
        {isStaff && hasBalance && !isAudit && (
          <div className="p-3 rounded-xl bg-purple-50/80 border border-purple-200/80 flex items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2 text-purple-900">
              <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
              <span>
                Staff credit of <strong className="font-bold">{formatPHP(person.total_owed)}</strong> can be
                settled directly via payroll deduction.
              </span>
            </div>
            {!showPayrollConfirm ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setShowPayrollConfirm(true)}
                className="h-8 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shrink-0 cursor-pointer shadow-2xs"
              >
                Deduct from Payroll
              </Button>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPayrollConfirm(false)}
                  className="h-8 px-2.5 rounded-lg text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onSettlePayrollDeduction(person.name)
                    setShowPayrollConfirm(false)
                  }}
                  className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
                >
                  Confirm Settle
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Tab Controls & Filter Bar */}
        <div className="flex items-center justify-between gap-2 pt-2 pb-1 shrink-0 border-b border-stroke/20">
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer',
                activeTab === 'ledger'
                  ? 'bg-white text-focus shadow-2xs font-bold'
                  : 'text-muted-fg hover:text-focus'
              )}
            >
              Running Ledger ({combinedEvents.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer',
                activeTab === 'sales'
                  ? 'bg-white text-focus shadow-2xs font-bold'
                  : 'text-muted-fg hover:text-focus'
              )}
            >
              Sales ({person.sales.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer',
                activeTab === 'payments'
                  ? 'bg-white text-focus shadow-2xs font-bold'
                  : 'text-muted-fg hover:text-focus'
              )}
            >
              Payments ({person.payments.length})
            </button>
          </div>

          {hasBalance && !isAudit && (
            <Button
              type="button"
              onClick={() => onOpenRecordPayment(person)}
              className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Record Payment</span>
            </Button>
          )}
        </div>

        {/* Tab Content Display */}
        <div className="overflow-y-auto pr-1 flex-1 min-h-0 pt-2 text-left">
          {/* TAB 1: Running Ledger View */}
          {activeTab === 'ledger' && (
            <div className="rounded-xl border border-slate-200/80 overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold text-muted-fg border-b border-slate-200/80">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Particulars / Details</th>
                    <th className="py-2.5 px-3 text-right">Debit (+)</th>
                    <th className="py-2.5 px-3 text-right">Credit (-)</th>
                    <th className="py-2.5 px-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {combinedEvents.map((evt) => (
                    <tr key={evt.id} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-focus whitespace-nowrap">
                        {evt.date}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                            evt.type === 'Sale'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          )}
                        >
                          {evt.type === 'Sale' ? (
                            <>
                              <ArrowUpRight className="w-2.5 h-2.5" />
                              <span>Sale</span>
                            </>
                          ) : (
                            <>
                              <ArrowDownLeft className="w-2.5 h-2.5" />
                              <span>Payment</span>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-focus font-medium max-w-[220px] truncate" title={evt.description}>
                        {evt.description}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-focus tabular-nums whitespace-nowrap">
                        {evt.debit > 0 ? formatPHP(evt.debit) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-emerald-600 tabular-nums whitespace-nowrap">
                        {evt.credit > 0 ? formatPHP(evt.credit) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-focus tabular-nums whitespace-nowrap">
                        {formatPHP(evt.runningBalance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: Sales List */}
          {activeTab === 'sales' && (
            <div className="space-y-2">
              {person.sales.map((sale) => (
                <div
                  key={sale.id}
                  className="p-3 rounded-xl border border-slate-200/80 bg-white hover:bg-slate-50/50 transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1 max-w-[65%]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#960C01]">{sale.id}</span>
                      <span className="text-muted-fg font-medium">({sale.date})</span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-bold border',
                          sale.payment_status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : sale.payment_status === 'Partial'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        )}
                      >
                        {sale.payment_status}
                      </span>
                    </div>
                    <p className="font-medium text-focus truncate" title={sale.items_summary}>
                      {sale.items_summary}
                    </p>
                    {sale.notes && (
                      <p className="text-[11px] text-muted-fg italic truncate">{sale.notes}</p>
                    )}
                  </div>

                  <div className="text-right space-y-1 shrink-0">
                    <div>
                      <span className="text-[10px] text-muted-fg block">Total: {formatPHP(sale.total_amount)}</span>
                      <span className="text-xs font-bold text-focus block tabular-nums">
                        Balance: {formatPHP(sale.balance)}
                      </span>
                    </div>
                    {sale.balance > 0 && !isAudit && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onOpenRecordPayment(person, sale)}
                        className="h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-2xs"
                      >
                        Pay Sale
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: Payments List */}
          {activeTab === 'payments' && (
            <div className="space-y-2">
              {person.payments.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-fg bg-slate-50 rounded-xl border border-slate-100">
                  No payment records recorded yet for this customer.
                </div>
              ) : (
                person.payments.map((pay) => (
                  <div
                    key={pay.id}
                    className="p-3 rounded-xl border border-slate-200/80 bg-white flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-fg">{pay.id}</span>
                        <span className="font-semibold text-focus">{pay.date}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-slate-100 text-focus border border-slate-200">
                          {pay.method}
                        </span>
                      </div>
                      {pay.notes && (
                        <p className="text-[11px] text-muted-fg">{pay.notes}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-xs sm:text-sm font-bold text-emerald-600 tabular-nums">
                        +{formatPHP(pay.amount)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 shrink-0">
          <div className="text-[11px] text-muted-fg">
            Food credit ledger updated automatically on each transaction.
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Close Ledger
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

