import * as React from 'react'
import {
  Coins,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertCircle,
  AlertTriangle,
  Receipt,
  Pencil,
  Plus,
  Sparkles,
  Lock,
  Edit2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { BackButton, ConfirmModal, RowActionsMenu } from '@/components/common'
import { formatPHP } from '@/lib/format'
import { isCompanyMatch } from '@/utils/companyUtils'
import { cn } from '@/lib/utils'
import { bankService, type BankAccount } from '@/services/bankService'
import type {
  CustomerType,
  PaymentStatus,
  PersonLedgerSummary,
  UtangSale,
} from '@/services/receivablesStore'

export interface PersonLedgerPageViewProps {
  person: PersonLedgerSummary
  onBack: () => void
  onOpenRecordPayment: (person: PersonLedgerSummary, sale?: UtangSale) => void
  onOpenEditProfile?: (person: PersonLedgerSummary) => void
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

const HISTORY_ITEMS_PER_PAGE = 8

export const PersonLedgerPageView: React.FC<PersonLedgerPageViewProps> = ({
  person,
  onBack,
  onOpenRecordPayment,
  onOpenEditProfile,
  onSettlePayrollDeduction,
  isAudit = false,
  canEdit = false,
  onEditSale,
  onDeleteSale,
  onDeletePayment,
}) => {
  const [activeTab, setActiveTab] = React.useState<'payments' | 'orders'>('payments')
  const [detailSearchQuery, setDetailSearchQuery] = React.useState<string>('')
  const [historyPage, setHistoryPage] = React.useState<number>(1)
  const [showPayrollConfirm, setShowPayrollConfirm] = React.useState(false)

  // Edit Order state
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
    setHistoryPage(1)
  }, [person.key, detailSearchQuery, activeTab])

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

  const isStaff = person.type === 'Staff'
  const hasBalance = person.total_owed > 0.005
  const unlockedBalance = person.sales
    .filter((s) => !s.is_locked)
    .reduce((acc, s) => acc + s.balance, 0)
  const canMutate = canEdit && !isAudit

  const firstOrderDate = React.useMemo(() => {
    if (!person.sales.length) return '—'
    const sorted = [...person.sales].sort((a, b) => a.date.localeCompare(b.date))
    return sorted[0]?.date || '—'
  }, [person.sales])

  const filteredPayments = React.useMemo(() => {
    const q = detailSearchQuery.trim().toLowerCase()
    const list = [...person.payments].sort((a, b) => b.date.localeCompare(a.date))
    if (!q) return list
    return list.filter(
      (p) =>
        p.date.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
    )
  }, [person.payments, detailSearchQuery])

  const filteredSales = React.useMemo(() => {
    const q = detailSearchQuery.trim().toLowerCase()
    const list = [...person.sales].sort((a, b) => b.date.localeCompare(a.date))
    if (!q) return list
    return list.filter(
      (s) =>
        s.date.toLowerCase().includes(q) ||
        s.items_summary.toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.payment_status.toLowerCase().includes(q)
    )
  }, [person.sales, detailSearchQuery])

  const activeRecordsCount =
    activeTab === 'payments' ? filteredPayments.length : filteredSales.length
  const totalHistoryPages = Math.max(1, Math.ceil(activeRecordsCount / HISTORY_ITEMS_PER_PAGE))
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages)
  const historyStartIndex = (safeHistoryPage - 1) * HISTORY_ITEMS_PER_PAGE
  const historyEndIndex = Math.min(historyStartIndex + HISTORY_ITEMS_PER_PAGE, activeRecordsCount)

  const paginatedPayments = filteredPayments.slice(historyStartIndex, historyEndIndex)
  const paginatedSales = filteredSales.slice(historyStartIndex, historyEndIndex)

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

  const editedNumAmt = parseFloat(editTotalAmount) || 0
  const showPaidSettlementFields =
    editingSale &&
    editPaymentStatus === 'Paid' &&
    editedNumAmt > editingSale.amount_paid + 0.005

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
      if (editingSale.amount_paid <= 0) {
        setActionError(
          'To record a specific partial amount on an unpaid order, use Record Payment instead.'
        )
        return
      }
      if (numAmt <= editingSale.amount_paid) {
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
        payment_status: editPaymentStatus,
        payment_method: needsSettlementDeposit ? editPaymentMethod : undefined,
        bank_account_id:
          needsSettlementDeposit && editBankAccountId ? editBankAccountId : undefined,
        notes: editNotes.trim(),
      })
      if (!res.success) {
        setActionError(res.message)
        return
      }
      setEditingSale(null)
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
      if (!res.success) {
        setActionError(res.message)
        return
      }
      setConfirmDeleteSaleId(null)
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
      if (!res.success) {
        setActionError(res.message)
        return
      }
      setConfirmDeletePaymentId(null)
    } catch (err: any) {
      setActionError(err?.message || 'Failed to reverse payment.')
    } finally {
      setIsDeletingPayment(false)
    }
  }

  const accountRefCode = `UTG-${person.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ACC'}-${String(person.sales_count).padStart(3, '0')}`

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-200">
      {/* Top navigation row */}
      <div className="flex items-center justify-between gap-3">
        <BackButton onClick={onBack} label="Back to Receivables" />
      </div>

      {/* Account Header (Matching Tenant & FilCap Lending View Page exactly) */}
      <div className="pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-focus tracking-tight">
                {person.name}
              </h1>
              <span
                className={cn(
                  'inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border uppercase tracking-wider',
                  person.status === 'Paid'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : person.status === 'Partial'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20'
                )}
              >
                {person.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs sm:text-sm text-muted-fg font-medium">
                Ref No: <strong className="text-focus font-mono">{accountRefCode}</strong>
              </span>
              <span className="text-muted-fg/40">•</span>
              <span className="text-xs sm:text-sm text-muted-fg font-medium">
                Account Type:{' '}
                <strong className="text-focus">
                  {isStaff ? 'Staff Credit' : 'External Customer'}
                </strong>
              </span>
              {person.company && (
                <>
                  <span className="text-muted-fg/40">•</span>
                  <span className="text-xs sm:text-sm text-muted-fg font-medium">
                    Company: <strong className="text-focus">{person.company}</strong>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons in the same row as the Account Name */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">
            {canMutate && hasBalance && (
              <Button
                type="button"
                disabled={person.all_locked || unlockedBalance <= 0.005}
                onClick={() => onOpenRecordPayment(person)}
                className="h-10 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Coins className="h-4 w-4" />
                <span>Record Payment</span>
              </Button>
            )}

            {canMutate && isStaff && hasBalance && (
              <Button
                type="button"
                variant="outline"
                disabled={person.all_locked || unlockedBalance <= 0.005}
                onClick={() => setShowPayrollConfirm(true)}
                className="h-10 px-3.5 rounded-xl border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                <span>Deduct from Payroll</span>
              </Button>
            )}

            {canMutate && onOpenEditProfile && (
              <Button
                type="button"
                variant="outline"
                disabled={person.all_locked}
                onClick={() => onOpenEditProfile(person)}
                className="h-10 px-3.5 rounded-xl border border-stroke/60 bg-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer hover:bg-surface text-focus shadow-2xs disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit Terms</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Payroll Deduction Confirmation Banner */}
      {showPayrollConfirm && canMutate && isStaff && hasBalance && (
        <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs animate-in fade-in duration-150">
          <div className="space-y-0.5">
            <span className="font-bold text-purple-950 block">
              Confirm Full Payroll Deduction ({formatPHP(unlockedBalance)})
            </span>
            <span className="text-purple-800 block">
              This will settle all unlocked unpaid credit orders for <strong>{person.name}</strong> via Staff Payroll Deduction.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowPayrollConfirm(false)}
              className="h-8 px-3 text-xs rounded-xl bg-white"
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
              className="h-8 px-3.5 text-xs rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-semibold cursor-pointer"
            >
              Confirm Deduction
            </Button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 font-bold text-xs px-1.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Two Section Layout: Official Agreement Receipt (Left) & Payment Schedule & History (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Column: Receivable Agreement & Terms Styled Like a Financial Receipt */}
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
                    Receivable Account & Terms
                  </h3>
                  <span className="text-[10px] text-muted-fg font-medium">
                    Official Agreement Receipt
                  </span>
                </div>
              </div>
              <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold border border-slate-200">
                {accountRefCode}
              </span>
            </div>

            {/* Terms & Account Parameters */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Date Opened:</span>
                <span className="font-mono text-focus">{firstOrderDate}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Latest Activity:</span>
                <span className="font-mono text-focus">
                  {person.last_payment_date || person.oldest_unpaid_date || firstOrderDate}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Account Classification:</span>
                <span className="font-semibold text-focus">
                  {isStaff ? 'Staff Credit' : 'External Customer'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Settlement Schedule:</span>
                <span className="font-semibold text-focus">
                  {isStaff ? 'Cash / Payroll Deduction' : 'On-Demand / FIFO'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100/70">
                <span className="text-muted-fg">Aging Profile:</span>
                <span className="font-mono font-semibold text-focus">
                  {person.agingBucket} Days ({person.daysOverdue}d max)
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-fg">Assigned Company:</span>
                <span className="font-semibold text-focus truncate max-w-[180px]">
                  {person.company || 'All Companies'}
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
                <span className="text-muted-fg">Credit Orders Recorded:</span>
                <span className="font-mono font-bold text-focus">
                  {person.sales_count} {person.sales_count === 1 ? 'Order' : 'Orders'}
                </span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span className="text-muted-fg">Payments Logged:</span>
                <span className="font-mono font-bold text-focus">
                  {person.payments.length} {person.payments.length === 1 ? 'Payment' : 'Payments'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-sm">
                <span className="text-focus">Total Payable:</span>
                <span className="font-mono text-focus">{formatPHP(person.total_sales_amount)}</span>
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
                <span className="font-mono font-bold text-emerald-600">
                  {formatPHP(person.total_amount_paid)}
                </span>
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
                    person.total_owed <= 0.005 ? 'text-emerald-600' : 'text-amber-600'
                  )}
                >
                  {formatPHP(person.total_owed)}
                </span>
              </div>

              {/* Unpaid Orders Box */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                <div>
                  <span className="text-xs font-bold text-focus block">Open Credit Orders</span>
                  <span className="text-[10px] text-muted-fg">Orders with remaining balance</span>
                </div>
                <span className="text-sm font-mono font-bold text-focus">
                  {person.sales.filter((s) => s.balance > 0.005).length} Open
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Full Width Payment Schedule & History Table (Matching Tenant & FilCap) */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between h-full">
          <div className="flex-1 flex flex-col space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-focus">
                    Payment Schedule & History ({activeRecordsCount})
                  </h3>
                </div>

                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl border border-slate-200/70">
                  <button
                    type="button"
                    onClick={() => setActiveTab('payments')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer',
                      activeTab === 'payments'
                        ? 'bg-white text-focus shadow-2xs font-bold'
                        : 'text-muted-fg hover:text-focus'
                    )}
                  >
                    Payments ({person.payments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('orders')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer',
                      activeTab === 'orders'
                        ? 'bg-white text-focus shadow-2xs font-bold'
                        : 'text-muted-fg hover:text-focus'
                    )}
                  >
                    Credit Orders ({person.sales.length})
                  </button>
                </div>
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

            {/* Table Content */}
            <div className="flex-1 flex flex-col">
              {activeTab === 'payments' ? (
                person.payments.length === 0 ? (
                  <div className="flex-1 py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-3 text-emerald-600 shadow-2xs">
                      <Coins className="w-7 h-7" />
                    </div>
                    <h4 className="text-sm font-bold text-focus">No Payments Recorded Yet</h4>
                    <p className="text-xs text-muted-fg max-w-md mt-1 mb-4 leading-relaxed">
                      No payment remittances have been logged for this account yet. All recorded payment transactions, dates, amounts, and methods will appear here.
                    </p>
                    {canMutate && hasBalance && (
                      <Button
                        type="button"
                        onClick={() => onOpenRecordPayment(person)}
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
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Order / Ref</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Payment Date</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Amount Paid</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Method</th>
                          <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Receipt / Ref No.</th>
                          <th className="py-2.5 px-3.5 text-left">Remarks</th>
                          {canMutate && (
                            <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedPayments.length === 0 ? (
                          <tr>
                            <td colSpan={canMutate ? 8 : 7} className="py-12 text-center text-muted-fg text-xs">
                              No payment records matching &quot;{detailSearchQuery}&quot;
                            </td>
                          </tr>
                        ) : (
                          paginatedPayments.map((pay) => {
                            const linkedSale = pay.sale_id
                              ? person.sales.find((s) => s.id === pay.sale_id)
                              : undefined
                            const paymentLocked = Boolean(
                              (linkedSale && linkedSale.is_locked) || person.all_locked
                            )

                            return (
                              <tr key={pay.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                  {linkedSale ? `${linkedSale.date} (#${linkedSale.id})` : pay.date}
                                </td>
                                <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap font-medium">
                                  {pay.date}
                                </td>
                                <td className="py-2.5 px-3.5 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Check className="w-2.5 h-2.5 text-emerald-600" />
                                    <span>Paid</span>
                                  </span>
                                </td>
                                <td className="py-2.5 px-3.5 font-bold text-emerald-600 whitespace-nowrap tabular-nums">
                                  {formatPHP(pay.amount)}
                                </td>
                                <td className="py-2.5 px-3.5 text-focus whitespace-nowrap">
                                  {pay.method || 'Cash'}
                                </td>
                                <td className="py-2.5 px-3.5 font-mono text-muted-fg whitespace-nowrap">
                                  {pay.id}
                                </td>
                                <td className="py-2.5 px-3.5 text-muted-fg truncate max-w-[200px]" title={pay.notes || '—'}>
                                  {pay.notes || 'Payment remittance'}
                                </td>
                                {canMutate && (
                                  <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                                    <div className="inline-flex items-center justify-center">
                                      <RowActionsMenu
                                        canDelete={!paymentLocked && Boolean(onDeletePayment)}
                                        onDelete={() => setConfirmDeletePaymentId(pay.id)}
                                        deleteLabel="Reverse Payment"
                                        customItems={
                                          paymentLocked ? (
                                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-700">
                                              <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                              <span>Locked (Audited)</span>
                                            </div>
                                          ) : undefined
                                        }
                                      />
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 flex-1">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-muted-fg font-semibold">
                      <tr>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Order Date</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Order Ref</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Status</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Total Amount</th>
                        <th className="py-2.5 px-3.5 text-left whitespace-nowrap">Balance Due</th>
                        <th className="py-2.5 px-3.5 text-left">Particulars</th>
                        {canMutate && (
                          <th className="py-2.5 px-3.5 text-center whitespace-nowrap">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedSales.length === 0 ? (
                        <tr>
                          <td colSpan={canMutate ? 7 : 6} className="py-12 text-center text-muted-fg text-xs">
                            No credit orders matching &quot;{detailSearchQuery}&quot;
                          </td>
                        </tr>
                      ) : (
                        paginatedSales.map((sale) => {
                          const locked = Boolean(sale.is_locked)
                          return (
                            <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-3.5 font-mono text-focus whitespace-nowrap font-medium">
                                {sale.date}
                              </td>
                              <td className="py-2.5 px-3.5 font-mono font-bold text-[#960C01] whitespace-nowrap">
                                #{sale.id}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border',
                                    sale.payment_status === 'Paid'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : sale.payment_status === 'Partial'
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-rose-50 text-rose-700 border-rose-200'
                                  )}
                                >
                                  {sale.payment_status === 'Paid' && (
                                    <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  )}
                                  <span>{sale.payment_status}</span>
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 font-bold text-focus whitespace-nowrap tabular-nums">
                                {formatPHP(sale.total_amount)}
                              </td>
                              <td
                                className={cn(
                                  'py-2.5 px-3.5 font-bold whitespace-nowrap tabular-nums',
                                  sale.balance <= 0.005 ? 'text-emerald-600' : 'text-amber-700'
                                )}
                              >
                                {formatPHP(sale.balance)}
                              </td>
                              <td className="py-2.5 px-3.5 text-focus truncate max-w-[220px]" title={sale.items_summary}>
                                {sale.items_summary}
                              </td>
                              {canMutate && (
                                <td className="py-2.5 px-3.5 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center justify-center">
                                    <RowActionsMenu
                                      canEdit={!locked && Boolean(onEditSale)}
                                      canDelete={!locked && Boolean(onDeleteSale)}
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
                                        ) : sale.balance > 0.005 ? (
                                          <button
                                            type="button"
                                            onClick={() => onOpenRecordPayment(person, sale)}
                                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                                          >
                                            <Coins className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                            <span>Pay This Order</span>
                                          </button>
                                        ) : undefined
                                      }
                                    />
                                  </div>
                                </td>
                              )}
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

          {/* Pagination Footer (Anchored at Bottom Matching Tenant & FilCap) */}
          <div className="pt-4 mt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
            <span className="font-medium text-focus/80">
              {activeRecordsCount === 0
                ? 'Showing 0-0 of 0 records'
                : `Showing ${historyStartIndex + 1}-${historyEndIndex} of ${activeRecordsCount} records`}
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

      {/* Modal: Edit Receivable Order */}
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
                    Update customer assignment, item summary, total amount, or payment status.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 pt-2 text-xs text-left">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-focus block mb-1">Customer / Staff Name</label>
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
        description={`Are you sure you want to delete order #${confirmDeleteSaleId}? This will remove the receivable entry and reverse any deposited remittances.`}
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
        description={`Are you sure you want to reverse payment #${confirmDeletePaymentId}? The customer debt balance will increase and any linked bank deposit will be reversed.`}
        confirmLabel="Confirm Reversal"
        variant="destructive"
        action="delete"
        isLoading={isDeletingPayment}
        onConfirm={handleConfirmDeletePayment}
      />
    </div>
  )
}
