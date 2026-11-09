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
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Edit2,
  Trash2,
  AlertTriangle,
  Lock,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { isCompanyMatch } from '@/utils/companyUtils'
import { cn } from '@/lib/utils'
import { ConfirmModal, RowActionsMenu } from '@/components/common'
import { bankService, type BankAccount } from '@/services/bankService'
import type {
  CustomerType,
  PaymentStatus,
  PersonLedgerSummary,
  UtangSale,
} from '@/services/receivablesStore'

export interface PersonLedgerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: PersonLedgerSummary | null
  onOpenRecordPayment: (person: PersonLedgerSummary, sale?: UtangSale) => void
  onSettlePayrollDeduction: (
    customerName: string,
    companyId?: number,
    companyName?: string
  ) => void
  isAudit?: boolean
  canEdit?: boolean
  onEditSale?: (
    saleId: string,
    params: {
      customer_name?: string
      customer_type?: CustomerType
      items_summary?: string
      total_amount?: number
      notes?: string
      date?: string
      payment_status?: PaymentStatus
      payment_method?: string
      bank_account_id?: string
    }
  ) => Promise<{ success: boolean; message: string }>
  onDeleteSale?: (saleId: string) => Promise<{ success: boolean; message: string }>
  onDeletePayment?: (paymentId: string) => Promise<{ success: boolean; message: string }>
}

export const PersonLedgerDrawer: React.FC<PersonLedgerDrawerProps> = ({
  open,
  onOpenChange,
  person,
  onOpenRecordPayment,
  onSettlePayrollDeduction,
  isAudit = false,
  canEdit = false,
  onEditSale,
  onDeleteSale,
  onDeletePayment,
}) => {
  const [activeTab, setActiveTab] = React.useState<'ledger' | 'sales' | 'payments'>('ledger')
  const [showPayrollConfirm, setShowPayrollConfirm] = React.useState(false)

  // Edit Order state (AC-4)
  const [editingSale, setEditingSale] = React.useState<UtangSale | null>(null)
  const [editCustomerName, setEditCustomerName] = React.useState('')
  const [editCustomerType, setEditCustomerType] = React.useState<CustomerType>('External')
  const [editParticulars, setEditParticulars] = React.useState('')
  const [editTotalAmount, setEditTotalAmount] = React.useState('')
  const [editDate, setEditDate] = React.useState('')
  const [editPaymentStatus, setEditPaymentStatus] = React.useState<PaymentStatus>('Unpaid')
  const [editPaymentMethod, setEditPaymentMethod] = React.useState<string>('Cash')
  const [editBankAccountId, setEditBankAccountId] = React.useState<string>('')
  const [editBankAccounts, setEditBankAccounts] = React.useState<BankAccount[]>([])
  const [editNotes, setEditNotes] = React.useState('')
  const [isSavingEdit, setIsSavingEdit] = React.useState(false)

  const [confirmDeleteSaleId, setConfirmDeleteSaleId] = React.useState<string | null>(null)
  const [isDeletingSale, setIsDeletingSale] = React.useState(false)

  const [confirmDeletePaymentId, setConfirmDeletePaymentId] = React.useState<string | null>(null)
  const [isDeletingPayment, setIsDeletingPayment] = React.useState(false)

  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setShowPayrollConfirm(false)
      setActionError(null)
    } else {
      setActiveTab('ledger')
      setEditingSale(null)
      setConfirmDeleteSaleId(null)
      setConfirmDeletePaymentId(null)
      setActionError(null)
    }
  }, [open])

  // Load company-scoped bank accounts when Edit Order modal opens
  React.useEffect(() => {
    if (!editingSale) return
    let mounted = true
    const saleCompany = editingSale.company || person?.company || ''

    const filterForCompany = (list: BankAccount[]) => {
      if (!saleCompany || saleCompany === 'All Companies') return list
      const matched = list.filter((a) => isCompanyMatch(a.companyName, saleCompany))
      if (matched.length > 0) return matched
      return list.filter(
        (a) =>
          !a.companyName ||
          a.companyName.toLowerCase().includes('general') ||
          a.companyName.toLowerCase().includes('unassigned')
      )
    }

    const cached = filterForCompany(bankService.getCachedAccounts(saleCompany))
    setEditBankAccounts(cached)
    setEditBankAccountId(cached.length > 0 ? cached[0].id : '')

    bankService
      .getAccounts(saleCompany)
      .then((accounts) => {
        if (!mounted) return
        const filtered = filterForCompany(accounts || [])
        setEditBankAccounts(filtered)
        setEditBankAccountId((prev) =>
          prev && filtered.some((b) => b.id === prev)
            ? prev
            : filtered.length > 0
              ? filtered[0].id
              : ''
        )
      })
      .catch(() => {})

    return () => {
      mounted = false
    }
  }, [editingSale, person?.company])

  const combinedEvents = React.useMemo(() => {
    if (!person) return []

    type LedgerEvent = {
      id: string
      date: string
      type: 'Sale' | 'Payment'
      description: string
      debit: number
      credit: number
      method?: string
      notes?: string
      status?: string
      isLocked?: boolean
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
      isLocked?: boolean
    }> = []

    person.sales.forEach((s) => {
      events.push({
        id: `sale-${s.id}`,
        date: s.date,
        type: 'Sale',
        description: s.items_summary,
        debit: s.total_amount,
        credit: 0,
        status: s.payment_status,
        notes: s.notes,
        isLocked: Boolean(s.is_locked),
      })
    })

    person.payments.forEach((p) => {
      events.push({
        id: `pay-${p.id}`,
        date: p.date,
        type: 'Payment',
        description: `Payment received (${p.method})${p.notes ? `: ${p.notes}` : ''}`,
        debit: 0,
        credit: p.amount,
        method: p.method,
        notes: p.notes,
      })
    })

    events.sort((a, b) => a.date.localeCompare(b.date))

    let currentBalance = 0
    const runningEvents: LedgerEvent[] = events.map((e) => {
      currentBalance = currentBalance + e.debit - e.credit
      return {
        ...e,
        runningBalance: Math.max(0, currentBalance),
      }
    })

    return runningEvents.reverse()
  }, [person])

  if (!person) return null

  const isStaff = person.type === 'Staff'
  const hasBalance = person.total_owed > 0.005
  const unlockedBalance = person.sales
    .filter((s) => !s.is_locked)
    .reduce((acc, s) => acc + s.balance, 0)
  const canMutate = canEdit && !isAudit

  const handleStartEditSale = (sale: UtangSale) => {
    if (sale.is_locked) return
    setActionError(null)
    setEditingSale(sale)
    setEditCustomerName(sale.customer_name)
    setEditCustomerType(sale.customer_type)
    setEditParticulars(sale.items_summary)
    setEditTotalAmount(String(sale.total_amount))
    setEditDate(sale.date)
    setEditPaymentStatus(sale.payment_status)
    setEditPaymentMethod('Cash')
    setEditNotes(sale.notes || '')
  }

  const handleSaveEditSale = async () => {
    if (!editingSale || !onEditSale) return
    if (!editCustomerName.trim()) {
      setActionError('Customer or staff name cannot be empty.')
      return
    }
    if (!editParticulars.trim()) {
      setActionError('Particulars summary cannot be empty.')
      return
    }
    const numAmt = parseFloat(editTotalAmount)
    if (isNaN(numAmt) || numAmt <= 0) {
      setActionError('Please enter a valid total amount greater than 0.')
      return
    }

    if (editPaymentStatus === 'Partial') {
      if (editingSale.amount_paid > 0 && numAmt <= editingSale.amount_paid) {
        setActionError(
          `For Partial status, total amount must exceed already paid remittances (${formatPHP(editingSale.amount_paid)}). Choose Paid or Unpaid instead.`
        )
        return
      }
    }

    if (
      editPaymentStatus !== 'Unpaid' &&
      editPaymentStatus !== 'Paid' &&
      numAmt < editingSale.amount_paid
    ) {
      setActionError(
        `Total amount cannot be less than already remitted payments (${formatPHP(editingSale.amount_paid)}) unless status is set to Unpaid.`
      )
      return
    }

    setIsSavingEdit(true)
    setActionError(null)
    try {
      const needsSettlementDeposit =
        editPaymentStatus === 'Paid' && numAmt > editingSale.amount_paid + 0.005

      const res = await onEditSale(editingSale.id, {
        customer_name: editCustomerName.trim(),
        customer_type: editCustomerType,
        items_summary: editParticulars.trim(),
        total_amount: numAmt,
        date: editDate,
        notes: editNotes.trim(),
        payment_status: editPaymentStatus,
        payment_method: needsSettlementDeposit ? editPaymentMethod : undefined,
        bank_account_id:
          needsSettlementDeposit && editBankAccountId ? editBankAccountId : undefined,
      })
      if (res && !res.success) {
        setActionError(res.message)
      } else {
        setEditingSale(null)
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update order.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleConfirmDeleteSale = async () => {
    if (!confirmDeleteSaleId || !onDeleteSale) return
    setIsDeletingSale(true)
    setActionError(null)
    try {
      const res = await onDeleteSale(confirmDeleteSaleId)
      if (res && !res.success) {
        setActionError(res.message)
      } else {
        setConfirmDeleteSaleId(null)
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to delete order.')
    } finally {
      setIsDeletingSale(false)
    }
  }

  const handleConfirmDeletePayment = async () => {
    if (!confirmDeletePaymentId || !onDeletePayment) return
    setIsDeletingPayment(true)
    setActionError(null)
    try {
      const res = await onDeletePayment(confirmDeletePaymentId)
      if (res && !res.success) {
        setActionError(res.message)
      } else {
        setConfirmDeletePaymentId(null)
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to reverse payment.')
    } finally {
      setIsDeletingPayment(false)
    }
  }

  const editedNumAmt = parseFloat(editTotalAmount) || 0
  const showPaidSettlementFields =
    Boolean(editingSale) &&
    editPaymentStatus === 'Paid' &&
    editedNumAmt > (editingSale?.amount_paid || 0) + 0.005

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[92vh] flex flex-col p-6 rounded-[20px] bg-white gap-3 overflow-hidden shadow-2xl">
        <DialogHeader className="space-y-1.5 pb-2 border-b border-stroke/20 shrink-0 text-left">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 shadow-2xs',
                  isStaff ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                )}
              >
                {isStaff ? <User className="w-5 h-5" /> : <Building className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-lg sm:text-xl font-bold text-focus truncate">
                    {person.name}
                  </DialogTitle>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border uppercase shrink-0',
                      isStaff
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    )}
                  >
                    {person.type}
                  </span>
                  {person.all_locked && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 shrink-0">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Locked (Verified)</span>
                    </span>
                  )}
                </div>
                <DialogDescription className="text-xs text-muted-fg font-normal truncate mt-0.5">
                  {person.company} &bull; {person.sales_count}{' '}
                  {person.sales_count === 1 ? 'order' : 'orders'} on record
                </DialogDescription>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border',
                  person.status === 'Paid'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : person.status === 'Partial'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                )}
              >
                {person.status === 'Paid' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Settled in Full</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {person.daysOverdue > 0 ? `${person.daysOverdue}d overdue` : 'Due today'}
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>
        </DialogHeader>

        {actionError && (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 3 Overview Financial Metrics */}
        <div className="grid grid-cols-3 gap-2.5 pt-1 pb-1 shrink-0">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg block">
              Total Purchases
            </span>
            <span className="text-sm sm:text-base font-bold text-focus mt-0.5 block tabular-nums">
              {formatPHP(person.total_sales_amount)}
            </span>
            <span className="text-[10px] text-muted-fg block">
              {person.sales_count} {person.sales_count === 1 ? 'order' : 'orders'} on record
            </span>
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

        {/* Payroll Settlement Banner for Staff */}
        {isStaff && unlockedBalance > 0.005 && canMutate && (
          <div className="p-3 rounded-xl bg-purple-50/80 border border-purple-200/80 flex items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2 text-purple-900">
              <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
              <span>
                Staff credit of <strong className="font-bold">{formatPHP(unlockedBalance)}</strong> can be
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
                    onSettlePayrollDeduction(person.name, person.company_id, person.company)
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
        <div className="flex items-center justify-between gap-2 pt-1 pb-1 shrink-0 border-b border-stroke/20">
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
              Orders ({person.sales.length})
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

          {unlockedBalance > 0.005 && canMutate && (
            <Button
              type="button"
              onClick={() => onOpenRecordPayment(person)}
              className="h-9 px-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Record Payment</span>
            </Button>
          )}
        </div>

        {/* Tab Content Display */}
        <div className="overflow-y-auto pr-1 flex-1 min-h-0 pt-1 text-left">
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
                              <span>Order</span>
                            </>
                          ) : (
                            <>
                              <ArrowDownLeft className="w-2.5 h-2.5" />
                              <span>Payment</span>
                            </>
                          )}
                        </span>
                      </td>
                      <td
                        className="py-2.5 px-3 text-focus font-medium max-w-[240px] truncate"
                        title={evt.description}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span className="truncate">{evt.description}</span>
                          {evt.isLocked && (
                            <Lock
                              className="w-3 h-3 text-slate-500 shrink-0"
                              aria-label="Locked (Verified)"
                            />
                          )}
                        </span>
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

          {/* TAB 2: Orders List */}
          {activeTab === 'sales' && (
            <div className="space-y-2">
              {person.sales.map((sale) => {
                const locked = Boolean(sale.is_locked)
                return (
                  <div
                    key={sale.id}
                    className={cn(
                      'p-3 rounded-xl border bg-white transition-colors flex items-center justify-between gap-3 text-xs',
                      locked
                        ? 'border-slate-200 bg-slate-50/40'
                        : 'border-slate-200/80 hover:bg-slate-50/50'
                    )}
                  >
                    <div className="space-y-1 max-w-[60%] min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-[#960C01]">#{sale.id}</span>
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
                        {locked && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300"
                            title="Locked and read only because its linked sale has been Verified by an Auditor"
                          >
                            <Lock className="w-2.5 h-2.5" />
                            <span>Locked (Verified)</span>
                          </span>
                        )}
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
                        <span className="text-[10px] text-muted-fg block">
                          Total: {formatPHP(sale.total_amount)}
                        </span>
                        <span className="text-xs font-bold text-focus block tabular-nums">
                          Balance: {formatPHP(sale.balance)}
                        </span>
                      </div>
                      {canMutate && (
                        <div className="flex items-center gap-1.5 justify-end">
                          {sale.balance > 0.005 && !locked && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => onOpenRecordPayment(person, sale)}
                              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-2xs"
                            >
                              Pay
                            </Button>
                          )}
                          <RowActionsMenu
                            canEdit={!locked}
                            canDelete={!locked}
                            onEdit={() => handleStartEditSale(sale)}
                            onDelete={() => setConfirmDeleteSaleId(sale.id)}
                            editLabel="Edit Order"
                            deleteLabel="Delete Order"
                            customItems={
                              locked ? (
                                <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-700">
                                  <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Locked (Audited)</span>
                                </div>
                              ) : undefined
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* TAB 3: Payments List */}
          {activeTab === 'payments' && (
            <div className="space-y-2">
              {person.payments.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-fg bg-slate-50 rounded-xl border border-slate-100">
                  No payment records recorded yet for this account.
                </div>
              ) : (
                person.payments.map((pay) => {
                  const parentSale = person.sales.find((s) => s.id === pay.sale_id)
                  const paymentLocked = Boolean(parentSale?.is_locked)
                  return (
                    <div
                      key={pay.id}
                      className="p-3 rounded-xl border border-slate-200/80 bg-white flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] text-muted-fg">#{pay.id}</span>
                          <span className="font-semibold text-focus">{pay.date}</span>
                          <span className="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-slate-100 text-focus border border-slate-200">
                            {pay.method}
                          </span>
                          {paymentLocked && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                              <Lock className="w-2.5 h-2.5" />
                              <span>Locked</span>
                            </span>
                          )}
                        </div>
                        {pay.notes && <p className="text-[11px] text-muted-fg">{pay.notes}</p>}
                      </div>
                      <div className="text-right space-y-1">
                        <span className="text-xs sm:text-sm font-bold text-emerald-600 tabular-nums block">
                          +{formatPHP(pay.amount)}
                        </span>
                        {canMutate && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={paymentLocked}
                            onClick={() => setConfirmDeletePaymentId(pay.id)}
                            className="h-6 px-1.5 text-[10px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              paymentLocked
                                ? 'Locked: linked sale has been Verified by an Auditor'
                                : 'Reverse and delete payment'
                            }
                          >
                            <Trash2 className="w-2.5 h-2.5 mr-1" />
                            <span>Reverse</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
<div className="flex items-center justify-between pt-2.5 border-t border-slate-100 shrink-0">
          <div className="text-[11px] text-muted-fg">
            Food credit ledger synchronized in real time with Sales &amp; Bank records.
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

        {/* Modal: Edit Receivable Order (AC-4) */}
        {editingSale && (
          <Dialog open={Boolean(editingSale)} onOpenChange={(o) => !o && setEditingSale(null)}>
            <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto p-6 sm:p-7 rounded-[24px] bg-white border border-stroke/50 shadow-modal">
              <DialogHeader className="text-left space-y-1.5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
                    <Edit2 className="w-5 h-5" />
                  </div>
                  <div>
                    <DialogTitle className="text-lg font-extrabold text-focus">
                      Edit Receivable Order #{editingSale.id}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-fg mt-0.5">
                      Update customer assignment, item summary, total amount, or payment status. Linked sales and bank ledgers update automatically.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-3 pt-2 text-xs text-left">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-focus block mb-1">
                      Customer / Staff Name
                    </label>
                    <input
                      type="text"
                      value={editCustomerName}
                      onChange={(e) => setEditCustomerName(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-focus block mb-1">Customer Type</label>
                    <select
                      value={editCustomerType}
                      onChange={(e) =>
                        setEditCustomerType(e.target.value === 'Staff' ? 'Staff' : 'External')
                      }
                      className="w-full h-10 px-3.5 rounded-xl border border-stroke/50 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                      <option value="External">External</option>
                      <option value="Staff">Staff</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-focus block mb-1">Transaction Date</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-focus block mb-1">Payment Status</label>
                    <select
                      value={editPaymentStatus}
                      onChange={(e) => setEditPaymentStatus(e.target.value as PaymentStatus)}
                      className="w-full h-10 px-3.5 rounded-xl border border-stroke/50 bg-white font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                      <option value="Unpaid">Unpaid</option>
                      <option value="Partial">Partial</option>
                      <option value="Paid">Paid</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-focus block mb-1">
                    Particulars / Items Summary
                  </label>
                  <input
                    type="text"
                    value={editParticulars}
                    onChange={(e) => setEditParticulars(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    placeholder="e.g. Pork Sisig Rice Meal"
                  />
                </div>

                <div>
                  <label className="font-semibold text-focus block mb-1">Total Amount (PHP)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={editTotalAmount}
                    onChange={(e) => setEditTotalAmount(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono font-semibold"
                  />
                  <span className="text-[10px] text-muted-fg block mt-1">
                    Amount currently remitted: {formatPHP(editingSale.amount_paid)}
                  </span>
                </div>

                {showPaidSettlementFields && (
                  <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2.5">
                    <div className="text-[11px] font-semibold text-emerald-900">
                      Settling remaining {formatPHP(Math.max(0, editedNumAmt - editingSale.amount_paid))} as Paid
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="font-semibold text-emerald-900 block mb-1">
                          Payment Method
                        </label>
                        <select
                          value={editPaymentMethod}
                          onChange={(e) => setEditPaymentMethod(e.target.value)}
                          className="w-full h-10 px-2.5 rounded-xl border border-emerald-300 bg-white text-focus"
                        >
                          <option value="Cash">Cash</option>
                          <option value="GCash">GCash</option>
                          <option value="Bank Transfer">Bank Transfer</option>
                        </select>
                      </div>

                      <div>
                        <label className="font-semibold text-emerald-900 block mb-1">
                          Deposit Bank (Optional)
                        </label>
                        <select
                          value={editBankAccountId}
                          onChange={(e) => setEditBankAccountId(e.target.value)}
                          className="w-full h-10 px-2.5 rounded-xl border border-emerald-300 bg-white text-focus"
                        >
                          <option value="">No bank deposit</option>
                          {editBankAccounts.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bankName} ({b.accountNumber})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {editPaymentStatus === 'Unpaid' && editingSale.amount_paid > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                    Switching status to <strong>Unpaid</strong> will reverse{' '}
                    <strong>{formatPHP(editingSale.amount_paid)}</strong> in recorded payments and any linked bank deposits.
                  </div>
                )}

                <div>
                  <label className="font-semibold text-focus block mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-stroke/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    placeholder="Optional adjustment notes"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/30">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingSale(null)}
                  disabled={isSavingEdit}
                  className="h-10 px-4 rounded-xl text-xs font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveEditSale}
                  disabled={isSavingEdit}
                  className="h-10 px-5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Dialog: Confirm Delete Order */}
        <ConfirmModal
          open={Boolean(confirmDeleteSaleId)}
          onOpenChange={(o) => !o && setConfirmDeleteSaleId(null)}
          title="Delete Receivable Order?"
          description={`Are you sure you want to delete order #${confirmDeleteSaleId}? This will remove the receivable entry, reverse any deposited remittances, and update the linked sale record.`}
          confirmLabel="Confirm Delete"
          variant="destructive"
          action="delete"
          isLoading={isDeletingSale}
          onConfirm={handleConfirmDeleteSale}
        />

        {/* Dialog: Confirm Reverse Payment */}
        <ConfirmModal
          open={Boolean(confirmDeletePaymentId)}
          onOpenChange={(o) => !o && setConfirmDeletePaymentId(null)}
          title="Reverse Payment Remittance?"
          description={`Are you sure you want to reverse payment #${confirmDeletePaymentId}? The customer debt balance will increase, any linked bank deposit will be reversed, and the linked sale status will update.`}
          confirmLabel="Confirm Reversal"
          variant="destructive"
          action="delete"
          isLoading={isDeletingPayment}
          onConfirm={handleConfirmDeletePayment}
        />
      </DialogContent>
    </Dialog>
  )
}
