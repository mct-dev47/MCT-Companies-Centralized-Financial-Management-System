import * as React from 'react'
import {
  CheckCircle2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileText,
  Coins,
  Search,
  X,
  Building2,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { formatPHP } from '@/lib/format'
import {
  getBillPaymentOptions,
  type BillItem,
} from '@/services/billsService'
import { formatDisplayDate } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

function formatPeriodDisplay(periodLabelOrKey?: string): string {
  if (!periodLabelOrKey) return '—'
  const trimmed = periodLabelOrKey.trim()
  if (/[a-zA-Z]/.test(trimmed)) {
    return trimmed
  }
  const dayMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dayMatch) {
    return formatDisplayDate(trimmed)
  }
  const monthMatch = trimmed.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    const [, y, m] = monthMatch
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }
  }
  return trimmed
}

interface BillDetailPageViewProps {
  bill: BillItem
  onBack: () => void
  onPay: () => void
  onEdit: () => void
  onDelete: () => void
  onMarkAudit?: (status: 'Verified' | 'Flagged') => void
  isAudit: boolean
}

const LEDGER_ITEMS_PER_PAGE = 5

export const BillDetailPageView: React.FC<BillDetailPageViewProps> = ({
  bill,
  onBack,
  onPay,
  onEdit,
  onMarkAudit,
  isAudit,
}) => {
  const [searchQuery, setSearchQuery] = React.useState<string>('')
  const [ledgerPage, setLedgerPage] = React.useState<number>(1)

  React.useEffect(() => {
    setLedgerPage(1)
  }, [bill.id, searchQuery])

  const options = getBillPaymentOptions(bill)
  const schedule = options.periods
  const nextPayable = options.nextPayable
  const dueDay = bill.dueDayOfMonth || parseInt(bill.dueDate?.slice(8, 10) || '15', 10) || 15

  const payments = bill.payments || []
  const totalPaidAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0)

  const currentRemainingDue =
    bill.status === 'Paid'
      ? 0
      : nextPayable?.remainingAmount !== undefined
      ? nextPayable.remainingAmount
      : nextPayable?.billedAmount !== undefined
      ? Math.max(0, nextPayable.billedAmount - (nextPayable?.paidAmount || 0))
      : bill.latestAmount || bill.amount || 0

  // Pre-calculate per-period payment totals and statement amounts from transactions
  const periodStatsMap = React.useMemo(() => {
    const map = new Map<string, { totalPaid: number; statementAmount: number; isSettled: boolean }>()
    payments.forEach((p) => {
      const key = p.periodKey || p.paymentDate
      const current = map.get(key) || { totalPaid: 0, statementAmount: 0, isSettled: false }
      current.totalPaid += p.amount || 0
      if (p.billedAmount !== undefined && p.billedAmount > current.statementAmount) {
        current.statementAmount = p.billedAmount
      }
      map.set(key, current)
    })

    // Cross-reference with schedule if available
    map.forEach((val, key) => {
      const sp = schedule.find((item) => item.key === key)
      if (sp) {
        val.isSettled = sp.paid
        if (sp.billedAmount && sp.billedAmount > val.statementAmount) {
          val.statementAmount = sp.billedAmount
        }
      } else if (val.statementAmount > 0) {
        val.isSettled = val.totalPaid >= val.statementAmount - 0.005
      } else if (bill.amount > 0) {
        val.isSettled = val.totalPaid >= bill.amount - 0.005
      } else {
        val.isSettled = true
      }
    })
    return map
  }, [payments, schedule, bill.amount])

  // Build ledger entries from recorded payment transactions only
  const ledgerRows = React.useMemo(() => {
    const rows: Array<{
      id: string
      date: string
      periodLabel?: string
      status: 'Paid' | 'Partially Paid'
      amount: number
      method: string
      referenceNo: string
      notes: string
    }> = []

    payments.forEach((p) => {
      const key = p.periodKey || p.paymentDate
      const matchedPeriod = schedule.find((sp) => sp.key === p.periodKey)
      const stats = periodStatsMap.get(key)
      const isPeriodPaid = stats ? stats.isSettled : (matchedPeriod ? matchedPeriod.paid : true)
      const isPartial = !isPeriodPaid

      rows.push({
        id: p.id,
        date: p.paymentDate,
        periodLabel: matchedPeriod?.label || p.periodKey,
        status: isPartial ? 'Partially Paid' : 'Paid',
        amount: p.amount,
        method: p.paymentMethod || '—',
        referenceNo: p.referenceNo || p.refNo || '—',
        notes: p.notes || '—',
      })
    })

    return rows
  }, [payments, schedule, periodStatsMap])

  const filteredLedgerRows = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return ledgerRows
    return ledgerRows.filter((r) => {
      const matchDate = (r.date || '').toLowerCase().includes(q)
      const matchFormattedDate = formatDisplayDate(r.date).toLowerCase().includes(q)
      const matchPeriod = (r.periodLabel || '').toLowerCase().includes(q)
      const matchFormattedPeriod = formatPeriodDisplay(r.periodLabel || r.date).toLowerCase().includes(q)
      const matchRef = (r.referenceNo || '').toLowerCase().includes(q)
      const matchNotes = (r.notes || '').toLowerCase().includes(q)
      const matchMethod = (r.method || '').toLowerCase().includes(q)
      const matchStatus = (r.status || '').toLowerCase().includes(q)
      return (
        matchDate ||
        matchFormattedDate ||
        matchPeriod ||
        matchFormattedPeriod ||
        matchRef ||
        matchNotes ||
        matchMethod ||
        matchStatus
      )
    })
  }, [ledgerRows, searchQuery])

  const totalLedgerPages = Math.max(1, Math.ceil(filteredLedgerRows.length / LEDGER_ITEMS_PER_PAGE))
  const safeLedgerPage = Math.min(ledgerPage, totalLedgerPages)
  const paginatedLedger = filteredLedgerRows.slice(
    (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE,
    safeLedgerPage * LEDGER_ITEMS_PER_PAGE
  )

  const handleExportPdf = () => {
    try {
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Please allow pop-ups in your browser to export the Bill Details PDF.')
        return
      }

    const exportDateStr = new Date().toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const recurrenceRuleText =
      bill.billingCycle === 'Daily'
        ? 'Every Day'
        : bill.billingCycle === 'Yearly'
        ? `Annual (${new Date((bill.initialDueDate || bill.dueDate) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`
        : `Every ${dueDay}${dueDay === 1 ? 'st' : dueDay === 2 ? 'nd' : dueDay === 3 ? 'rd' : 'th'} of month`

    const reminderText =
      bill.billingCycle === 'Daily'
        ? 'Daily alert on due date'
        : `${bill.reminderDaysBefore || 5} days before due date`

    const latestAmountStr =
      bill.latestAmount && bill.latestAmount > 0
        ? formatPHP(bill.latestAmount)
        : bill.amount && bill.amount > 0
        ? formatPHP(bill.amount)
        : '—'

    const currentDueStr =
      bill.status === 'Paid'
        ? '₱0.00'
        : currentRemainingDue > 0
        ? formatPHP(currentRemainingDue)
        : '—'

    const rowsHtml =
      ledgerRows.length === 0
        ? `<tr><td colspan="7" style="padding: 24px; text-align: center; color: #64748B; font-size: 11px; font-style: italic;">No payment transactions recorded yet.</td></tr>`
        : ledgerRows
            .map(
              (r) => `
          <tr>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; font-weight: 600; color: #0F172A;">
              ${formatPeriodDisplay(r.periodLabel || r.date)}
            </td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; color: #475569;">
              ${formatDisplayDate(r.date)}
            </td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 10px; text-align: center;">
              <span style="display: inline-block; padding: 2px 7px; border-radius: 9999px; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; ${
                r.status === 'Paid'
                  ? 'background-color: #ECFDF5; color: #047857; border: 1px solid #A7F3D0;'
                  : 'background-color: #FFFBEB; color: #B45309; border: 1px solid #FDE68A;'
              }">
                ${r.status}
              </span>
            </td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; text-align: right; font-weight: 700; color: #047857;">
              ${r.amount > 0 ? formatPHP(r.amount) : '—'}
            </td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; color: #0F172A;">
              ${r.method || '—'}
            </td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; font-family: monospace; color: #475569;">
              ${r.referenceNo || '—'}
            </td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 11px; color: #64748B;">
              ${r.notes || '—'}
            </td>
          </tr>
        `
            )
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bill Details - ${bill.billerName} (${bill.company})</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              color: #0F172A;
              padding: 28px;
              background-color: #FFFFFF;
              line-height: 1.4;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #960C01;
              padding-bottom: 14px;
              margin-bottom: 20px;
            }
            .brand-title {
              font-size: 20px;
              font-weight: 800;
              color: #960C01;
              letter-spacing: -0.02em;
              margin: 0 0 3px 0;
            }
            .report-title {
              font-size: 13px;
              font-weight: 600;
              color: #475569;
              margin: 0;
            }
            .meta-right {
              text-align: right;
              font-size: 11px;
              color: #64748B;
            }
            .kpi-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 10px;
              margin-bottom: 20px;
            }
            .kpi-card {
              background-color: #F8FAFC;
              border: 1px solid #E2E8F0;
              border-radius: 8px;
              padding: 10px 12px;
            }
            .kpi-label {
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #64748B;
              margin-bottom: 4px;
            }
            .kpi-value {
              font-size: 15px;
              font-weight: 800;
              color: #0F172A;
            }
            .section-box {
              background-color: #FFFFFF;
              border: 1px solid #E2E8F0;
              border-radius: 8px;
              padding: 14px;
              margin-bottom: 20px;
            }
            .section-heading {
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #0F172A;
              border-bottom: 1px solid #E2E8F0;
              padding-bottom: 6px;
              margin-bottom: 10px;
            }
            .terms-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 8px 24px;
              font-size: 11px;
            }
            .terms-item {
              display: flex;
              justify-content: space-between;
              padding: 3px 0;
              border-bottom: 1px solid #F1F5F9;
            }
            .terms-label {
              color: #64748B;
            }
            .terms-val {
              font-weight: 600;
              color: #0F172A;
              text-align: right;
            }
            .remarks-box {
              margin-top: 10px;
              padding: 8px 10px;
              background-color: #F8FAFC;
              border: 1px solid #E2E8F0;
              border-radius: 6px;
              font-size: 11px;
              color: #334155;
              white-space: pre-wrap;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            th {
              background-color: #F8FAFC;
              text-align: left;
              padding: 8px 10px;
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #64748B;
              border-bottom: 2px solid #CBD5E1;
            }
            .table-summary {
              margin-top: 12px;
              padding: 10px 12px;
              background-color: #F8FAFC;
              border: 1px solid #E2E8F0;
              border-radius: 6px;
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              font-weight: 700;
            }
            @media print {
              body { padding: 6mm; }
              @page { size: portrait; margin: 8mm; }
              tr { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="brand-title">MCT Group of Companies</div>
              <div class="report-title">Bill Particulars & Payment Ledger Report</div>
            </div>
            <div class="meta-right">
              <div><strong>Export Date:</strong> ${exportDateStr}</div>
              <div><strong>Biller:</strong> ${bill.billerName}</div>
              <div><strong>Company:</strong> ${bill.company}</div>
            </div>
          </div>

          <!-- Overview KPI Cards -->
          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">Latest Billed / Paid</div>
              <div class="kpi-value">${latestAmountStr}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Billing Cycle</div>
              <div class="kpi-value">${bill.billingCycle}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Current Period Due</div>
              <div class="kpi-value">${currentDueStr}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Next Due Date</div>
              <div class="kpi-value">${formatDisplayDate(bill.dueDate)}</div>
            </div>
          </div>

          <!-- Bill Particulars & Terms -->
          <div class="section-box">
            <div class="section-heading">Bill Particulars & Agreement Terms</div>
            <div class="terms-grid">
              <div class="terms-item">
                <span class="terms-label">Biller / Vendor Name</span>
                <span class="terms-val">${bill.billerName}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Assigned Subsidiary</span>
                <span class="terms-val">${bill.company}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Recurrence Schedule</span>
                <span class="terms-val">${bill.billingCycle}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Recurrence Rule</span>
                <span class="terms-val">${recurrenceRuleText}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Scheduled Due Date</span>
                <span class="terms-val">${formatDisplayDate(bill.dueDate)}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Due Date Reminder</span>
                <span class="terms-val">${reminderText}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Current Bill Status</span>
                <span class="terms-val">${bill.status}</span>
              </div>
              <div class="terms-item">
                <span class="terms-label">Audit Status</span>
                <span class="terms-val">${bill.auditStatus || 'Pending Audit'}${bill.auditDate ? ` (${bill.auditDate})` : ''}</span>
              </div>
            </div>

            <div style="margin-top: 10px;">
              <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B;">Remarks & Notes</span>
              <div class="remarks-box">${bill.notes || 'No additional remarks recorded for this bill.'}</div>
            </div>
          </div>

          <!-- Payment Schedule & History Table -->
          <div class="section-box">
            <div class="section-heading">Payment Schedule & History</div>
            <table>
              <thead>
                <tr>
                  <th>Billing Period</th>
                  <th>Payment Date</th>
                  <th style="text-align: center;">Status</th>
                  <th style="text-align: right;">Amount Paid</th>
                  <th>Method</th>
                  <th>Reference No.</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>

            <div class="table-summary">
              <div>Total Payment Records: <strong>${ledgerRows.length}</strong></div>
              <div>Total Amount Settled: <strong style="color: #047857;">${formatPHP(totalPaidAmount)}</strong></div>
            </div>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 250);
            };
          </script>
        </body>
      </html>
    `)
      printWindow.document.close()
    } catch (err: any) {
      alert(formatUserFriendlyErrorMessage(err, 'Unable to export Bill Details PDF. Please try again.'))
    }
  }

  return (
    <div className="space-y-5 pb-12 max-w-[1600px] mx-auto animate-in fade-in duration-200">
      {/* Top Action & Navigation Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="h-10 px-4 rounded-xl border-stroke/60 bg-white hover:bg-slate-50 text-focus font-semibold text-xs flex items-center gap-2 shadow-2xs cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back to Bills</span>
          </Button>
        </div>
      </div>

      {/* Main Details Header (No container background, no status badge, buttons in same row as name) */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-1">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-focus tracking-tight">
            {bill.billerName}
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-fg font-medium">
            <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="font-semibold text-focus/90">{bill.company}</span>
          </div>
        </div>

        {/* Action Buttons in the same row as the Biller Name */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportPdf}
            className="h-10 px-4 rounded-xl border-stroke/60 bg-white hover:bg-slate-50 text-focus font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-focus" />
            <span>Export PDF</span>
          </Button>

          {!isAudit && (
            <>
              <Button
                type="button"
                onClick={onPay}
                className="h-10 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Coins className="h-4 w-4" />
                <span>Record Payment</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onEdit}
                className="h-10 px-4 rounded-xl border-stroke/60 bg-white hover:bg-slate-50 text-focus font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit Terms</span>
              </Button>
            </>
          )}

          {isAudit && onMarkAudit && (
            <>
              <Button
                type="button"
                onClick={() => onMarkAudit('Verified')}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Mark as Audited</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onMarkAudit('Flagged')}
                className="h-10 px-4 rounded-xl border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <AlertCircle className="h-4 w-4" />
                <span>Flag Discrepancy</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 4 Financial Overview KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
            Latest Billed / Paid
          </span>
          <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
            {bill.latestAmount && bill.latestAmount > 0
              ? formatPHP(bill.latestAmount)
              : bill.amount && bill.amount > 0
              ? formatPHP(bill.amount)
              : '—'}
          </span>
        </div>

        <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
            Billing Cycle
          </span>
          <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
            {bill.billingCycle}
          </span>
        </div>

        <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
            Current Period Due
          </span>
          <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
            {bill.status === 'Paid'
              ? '₱0.00'
              : currentRemainingDue > 0
              ? formatPHP(currentRemainingDue)
              : '—'}
          </span>
        </div>

        <div className="bg-white border border-stroke/60 rounded-2xl p-4 shadow-2xs">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-fg block">
            Next Due Date
          </span>
          <span className="text-base sm:text-lg font-extrabold text-focus tabular-nums mt-1 block">
            {formatDisplayDate(bill.dueDate)}
          </span>
        </div>
      </div>

      {/* Split Section: Bill Agreement & Terms (Left) + Payment Schedule & History (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left 1 Column: Bill Agreement & Terms */}
        <div className="lg:col-span-1 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <FileText className="h-4 w-4 text-[#960C01]" />
            <h2 className="text-sm font-bold text-focus">Bill Agreement & Terms</h2>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-muted-fg">Recurrence Schedule</span>
              <span className="font-semibold text-focus">{bill.billingCycle}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-muted-fg">Recurrence Rule</span>
              <span className="font-semibold text-focus text-right">
                {bill.billingCycle === 'Daily'
                  ? 'Every Day'
                  : bill.billingCycle === 'Yearly'
                  ? `Annual (${new Date((bill.initialDueDate || bill.dueDate) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`
                  : `Every ${dueDay}${dueDay === 1 ? 'st' : dueDay === 2 ? 'nd' : dueDay === 3 ? 'rd' : 'th'} of month`}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-muted-fg">Scheduled Due Date</span>
              <span className="font-semibold text-focus">{formatDisplayDate(bill.dueDate)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-muted-fg">Due Date Reminder</span>
              <span className="font-medium text-amber-700">
                {bill.billingCycle === 'Daily'
                  ? 'Daily alert on due date'
                  : `${bill.reminderDaysBefore || 5} days before due date`}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-muted-fg">Current Status</span>
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-[10.5px] font-bold border',
                  bill.status === 'Paid'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : bill.status === 'Overdue'
                    ? 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/25'
                    : bill.status === 'Due Soon'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : bill.status === 'Partially Paid'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                )}
              >
                {bill.status}
              </span>
            </div>
            {bill.auditStatus && (
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-muted-fg">Audit Status</span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-[10.5px] font-bold border',
                    bill.auditStatus === 'Verified'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  )}
                >
                  {bill.auditStatus} {bill.auditDate ? `(${bill.auditDate})` : ''}
                </span>
              </div>
            )}
          </div>

          <div className="pt-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg block mb-1.5">
              Remarks & Notes
            </span>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-xs text-focus min-h-[64px] whitespace-pre-wrap">
              {bill.notes || 'No additional remarks recorded for this bill.'}
            </div>
          </div>
        </div>

        {/* Right 3 Columns: Payment Schedule & History Table */}
        <div className="lg:col-span-3 bg-white border border-stroke/60 rounded-2xl p-5 shadow-2xs flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-focus flex items-center gap-2">
                  <Coins className="h-4 w-4 text-emerald-600" />
                  <span>Payment Schedule & History</span>
                </h2>
                <p className="text-[11px] text-muted-fg mt-0.5">
                  Showing Payment Transactions made for this Bill
                </p>
              </div>

              {/* Real-time Search Input */}
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-muted-fg absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search date, ref no, remarks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-8 pr-8 rounded-xl border border-stroke/60 bg-white text-xs font-medium text-focus placeholder:text-muted-fg/70 focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                      Billing Period
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                      Payment Date
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-center">
                      Status
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3 text-right">
                      Amount Paid
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                      Method
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                      Reference No.
                    </TableHead>
                    <TableHead className="text-[11px] font-bold uppercase text-muted-fg py-2.5 px-3">
                      Remarks
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLedger.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-36 text-center text-xs text-muted-fg">
                        {searchQuery
                          ? `No payment records found matching "${searchQuery}".`
                          : 'No payment transactions recorded yet.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedLedger.map((entry) => {
                      const badgeStyle =
                        entry.status === 'Paid'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : entry.status === 'Partially Paid'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'

                      return (
                        <TableRow key={entry.id} className="hover:bg-slate-50/60 border-b border-slate-100">
                          <TableCell className="py-3 px-3 text-xs font-semibold text-focus whitespace-nowrap">
                            {formatPeriodDisplay(entry.periodLabel || entry.date)}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-xs text-muted-fg whitespace-nowrap">
                            {formatDisplayDate(entry.date)}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                            <span
                              className={cn(
                                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider',
                                badgeStyle
                              )}
                            >
                              {entry.status}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 px-3 text-right font-bold text-xs tabular-nums whitespace-nowrap">
                            {entry.amount > 0 ? (
                              <span className="text-emerald-700">{formatPHP(entry.amount)}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-xs text-focus whitespace-nowrap">
                            {entry.method || '—'}
                          </TableCell>
                          <TableCell className="py-3 px-3 font-mono text-xs text-muted-fg whitespace-nowrap">
                            {entry.referenceNo || '—'}
                          </TableCell>
                          <TableCell className="py-3 px-3 text-xs text-muted-fg max-w-[220px] truncate" title={entry.notes}>
                            {entry.notes || '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* 5-Row Pagination Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-muted-fg">
            <div>
              Showing{' '}
              <span className="font-semibold text-focus">
                {filteredLedgerRows.length === 0
                  ? 0
                  : (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE + 1}
              </span>{' '}
              to{' '}
              <span className="font-semibold text-focus">
                {Math.min(safeLedgerPage * LEDGER_ITEMS_PER_PAGE, filteredLedgerRows.length)}
              </span>{' '}
              of <span className="font-semibold text-focus">{filteredLedgerRows.length}</span> entries
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safeLedgerPage <= 1}
                onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Prev
              </Button>
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-focus font-semibold text-xs">
                Page {safeLedgerPage} of {totalLedgerPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={safeLedgerPage >= totalLedgerPages}
                onClick={() => setLedgerPage((p) => Math.min(totalLedgerPages, p + 1))}
                className="h-8 px-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
