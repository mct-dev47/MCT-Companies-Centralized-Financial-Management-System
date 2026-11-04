import * as React from 'react'
import {
  Coins,
  Search,
  X,
  Phone,
  Briefcase,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  FileSpreadsheet,
  FileText,
  ChevronDown,
  ShoppingBag,
  CheckCircle2,
  Receipt,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  BackButton,
  TableEmptyState,
  TablePagination,
} from '@/components/common'
import { formatPHP } from '@/lib/format'
import { notifyError } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'
import type { PersonLedgerSummary, UtangSale } from '@/services/receivablesStore'

export interface PersonLedgerPageViewProps {
  person: PersonLedgerSummary
  onBack: () => void
  onOpenRecordPayment: (person: PersonLedgerSummary, sale?: UtangSale) => void
  onSettlePayrollDeduction: (customerName: string) => void
  isAudit?: boolean
}

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
  runningBalance: number
}

const LEDGER_ITEMS_PER_PAGE = 8

export const PersonLedgerPageView: React.FC<PersonLedgerPageViewProps> = ({
  person,
  onBack,
  onOpenRecordPayment,
  onSettlePayrollDeduction,
  isAudit = false,
}) => {
  const [activeTab, setActiveTab] = React.useState<'ledger' | 'sales' | 'payments'>('ledger')
  const [searchQuery, setSearchQuery] = React.useState<string>('')
  const [ledgerPage, setLedgerPage] = React.useState<number>(1)
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState<boolean>(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setLedgerPage(1)
  }, [person.name, searchQuery, activeTab])

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        exportDropdownRef.current &&
        !exportDropdownRef.current.contains(event.target as Node)
      ) {
        setIsExportDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Combine sales and payments into a chronological running-balance ledger
  const combinedEvents = React.useMemo(() => {
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

  const filteredEvents = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return combinedEvents
    return combinedEvents.filter(
      (e) =>
        e.date.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q))
    )
  }, [combinedEvents, searchQuery])

  const totalLedgerPages = Math.max(1, Math.ceil(filteredEvents.length / LEDGER_ITEMS_PER_PAGE))
  const safeLedgerPage = Math.min(ledgerPage, totalLedgerPages)
  const startIndex = (safeLedgerPage - 1) * LEDGER_ITEMS_PER_PAGE
  const endIndex = Math.min(safeLedgerPage * LEDGER_ITEMS_PER_PAGE, filteredEvents.length)
  const paginatedEvents = filteredEvents.slice(startIndex, endIndex)

  const isStaff = person.type === 'Staff'
  const hasBalance = person.total_owed > 0
  const settledPercent =
    person.total_sales_amount > 0
      ? Math.round((person.total_amount_paid / person.total_sales_amount) * 100)
      : 100

  const handleExportCsv = () => {
    try {
      const csvRows: string[][] = [
        ['MCT Group of Companies - Food Utang Account Ledger'],
        ['Customer Name', `"${person.name.replace(/"/g, '""')}"`],
        ['Customer Type', isStaff ? 'Staff' : 'External Customer'],
        ['Role / Department', `"${(person.role_or_dept || 'N/A').replace(/"/g, '""')}"`],
        ['Contact Phone', `"${(person.phone || 'N/A').replace(/"/g, '""')}"`],
        ['Total Purchases', String(person.total_sales_amount)],
        ['Total Settled', String(person.total_amount_paid)],
        ['Outstanding Balance', String(person.total_owed)],
        ['Status', person.status],
        ['Aging Bucket', `${person.agingBucket} days`],
        [],
        ['Running Ledger Statement'],
        ['Date', 'Type', 'Particulars / Details', 'Debit (+)', 'Credit (-)', 'Running Balance']
      ]

      combinedEvents.forEach((evt) => {
        csvRows.push([
          `"${evt.date}"`,
          `"${evt.type}"`,
          `"${evt.description.replace(/"/g, '""')}"`,
          evt.debit > 0 ? String(evt.debit) : '0',
          evt.credit > 0 ? String(evt.credit) : '0',
          String(evt.runningBalance)
        ])
      })

      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + csvRows.map((e) => e.join(',')).join('\n')
      const encodedUri = encodeURI(csvContent)
      const link = document.createElement('a')
      link.setAttribute('href', encodedUri)
      link.setAttribute('download', `${person.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Account_Ledger_${new Date().toISOString().slice(0, 10)}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err: unknown) {
      notifyError(err, 'Unable to export Account Ledger CSV. Please try again.')
    }
  }

  const handleExportPdf = () => {
    try {
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        notifyError(new Error('Popup blocked'), 'Please allow popups to export PDF.')
        return
      }

      const rowsHtml =
        combinedEvents.length === 0
          ? `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #64748B; font-size: 11px; font-style: italic;">No transactions recorded.</td></tr>`
          : combinedEvents
              .map(
                (evt) => `
            <tr>
              <td style="font-family: monospace; font-size: 11px; color: #0B0F2B; white-space: nowrap;">${evt.date}</td>
              <td style="text-align: center;">
                <span class="badge ${evt.type === 'Sale' ? 'badge-sale' : 'badge-payment'}">
                  ${evt.type}
                </span>
              </td>
              <td style="color: #0B0F2B; max-width: 250px;">${evt.description}</td>
              <td style="text-align: right; font-weight: 600; color: #0B0F2B;">
                ${evt.debit > 0 ? formatPHP(evt.debit) : '—'}
              </td>
              <td style="text-align: right; font-weight: 600; color: #047857;">
                ${evt.credit > 0 ? formatPHP(evt.credit) : '—'}
              </td>
              <td style="text-align: right; font-weight: 700; color: #0B0F2B;">
                ${formatPHP(evt.runningBalance)}
              </td>
            </tr>
          `
              )
              .join('')

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Account Ledger - ${person.name}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #0B0F2B; font-size: 11px; line-height: 1.4; }
              .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #E2E8F0; margin-bottom: 16px; }
              .brand-title { font-size: 16px; font-weight: 800; color: #960C01; letter-spacing: -0.02em; }
              .brand-subtitle { font-size: 10px; color: #64748B; margin-top: 2px; }
              .doc-badge { font-size: 9px; font-weight: 700; text-transform: uppercase; background: #F1F5F9; padding: 4px 8px; border-radius: 6px; color: #334155; }
              .section-box { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; margin-bottom: 16px; }
              .section-heading { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; margin-bottom: 10px; border-bottom: 1px solid #F1F5F9; padding-bottom: 4px; }
              .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
              .metric-box { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 12px; }
              .metric-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #64748B; }
              .metric-value { font-size: 13px; font-weight: 800; color: #0B0F2B; margin-top: 2px; }
              table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 10.5px; }
              th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; border-bottom: 2px solid #CBD5E1; }
              td { padding: 8px 10px; border-bottom: 1px solid #E2E8F0; }
              .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
              .badge-sale { background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; }
              .badge-payment { background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; }
              .table-summary { margin-top: 12px; padding: 10px 12px; background: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; }
              @media print {
                body { padding: 8px; }
                @page { size: portrait; margin: 10mm; }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <div>
                <div class="brand-title">MCT GROUP OF COMPANIES</div>
                <div class="brand-subtitle">Centralized Receivables & Food Credit Ledger Statement</div>
              </div>
              <div style="text-align: right;">
                <div class="doc-badge">Official Customer Ledger</div>
                <div style="font-size: 9.5px; color: #64748B; margin-top: 4px;">Generated: ${new Date().toLocaleDateString('en-PH', { dateStyle: 'medium' })}</div>
              </div>
            </div>

            <div class="section-box">
              <div class="section-heading">Debtor Profile & Terms</div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div>
                  <h2 style="margin: 0; font-size: 15px; font-weight: 800; color: #0B0F2B;">${person.name}</h2>
                  <div style="font-size: 10px; color: #64748B; margin-top: 2px;">
                    ${isStaff ? 'Staff Member' : 'External Customer'} · ${person.role_or_dept} ${person.phone ? `· ${person.phone}` : ''}
                  </div>
                </div>
                <div style="text-align: right;">
                  <span class="badge ${person.status === 'Paid' ? 'badge-payment' : 'badge-sale'}">
                    ${person.status === 'Paid' ? 'Fully Settled' : `${person.status} (${person.agingBucket}d aging)`}
                  </span>
                </div>
              </div>

              <div class="metrics-grid">
                <div class="metric-box">
                  <div class="metric-label">Total Credit / Sales</div>
                  <div class="metric-value">${formatPHP(person.total_sales_amount)}</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Settled Amount</div>
                  <div class="metric-value">${formatPHP(person.total_amount_paid)}</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Outstanding Balance</div>
                  <div class="metric-value" style="color: ${hasBalance ? '#B91C1C' : '#0B0F2B'};">${formatPHP(person.total_owed)}</div>
                </div>
                <div class="metric-box">
                  <div class="metric-label">Settlement Rate</div>
                  <div class="metric-value">${settledPercent}%</div>
                </div>
              </div>
            </div>

            <div class="section-box">
              <div class="section-heading">Running Account Ledger</div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th style="text-align: center;">Type</th>
                    <th>Particulars / Details</th>
                    <th style="text-align: right;">Debit (+)</th>
                    <th style="text-align: right;">Credit (-)</th>
                    <th style="text-align: right;">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>

              <div class="table-summary">
                <div>Total Recorded Events: <strong>${combinedEvents.length}</strong></div>
                <div>Remaining Due: <strong>${formatPHP(person.total_owed)}</strong></div>
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
    } catch (err: unknown) {
      notifyError(err, 'Unable to export Account Ledger PDF. Please try again.')
    }
  }

  return (
    <div className="space-y-5 pb-12 max-w-[1600px] mx-auto animate-in fade-in duration-200">
      {/* Top Action & Navigation Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} label="Back to Receivables" />
        </div>
      </div>

      {/* Main Details Header (Matching BillDetailPageView) */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 px-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-focus tracking-tight">
              {person.name}
            </h1>
            <span
              className={cn(
                'text-xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs',
                isStaff
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              )}
            >
              {isStaff ? 'Staff' : 'External'}
            </span>
            <span
              className={cn(
                'text-xs font-semibold px-2.5 py-0.5 rounded-full border shadow-2xs inline-flex items-center gap-1',
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

          <div className="flex items-center gap-3 text-xs text-muted-fg font-medium flex-wrap pt-0.5">
            <div className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="font-semibold text-focus/90">{person.role_or_dept}</span>
            </div>
            {person.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>{person.phone}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons in same row */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Export Dropdown with NO leading icon, only text + ChevronDown */}
          <div ref={exportDropdownRef} className="relative inline-block">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsExportDropdownOpen((prev) => !prev)}
              className="h-10 px-4 rounded-xl border-stroke/60 bg-white hover:bg-slate-50 text-focus font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer select-none"
            >
              <span>Export</span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-fg transition-transform duration-200',
                  isExportDropdownOpen && 'rotate-180'
                )}
              />
            </Button>
            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-2xl border border-stroke/30 shadow-xl p-1.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setIsExportDropdownOpen(false)
                    handleExportCsv()
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-focus hover:bg-slate-50 flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-muted-fg" />
                  <span>Export as CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsExportDropdownOpen(false)
                    handleExportPdf()
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-focus hover:bg-slate-50 flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-fg" />
                  <span>Export as PDF</span>
                </button>
              </div>
            )}
          </div>

          {!isAudit && (
            <>
              {hasBalance && (
                <Button
                  type="button"
                  onClick={() => onOpenRecordPayment(person)}
                  className="h-10 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Coins className="h-4 w-4" />
                  <span>Record Payment</span>
                </Button>
              )}

              {isStaff && hasBalance && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSettlePayrollDeduction(person.name)}
                  className="h-10 px-4 rounded-xl border-purple-200 bg-purple-50/70 hover:bg-purple-100 text-purple-700 font-semibold text-xs flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                  <span>Deduct from Payroll</span>
                </Button>
              )}
            </>
          )}

          {isAudit && (
            <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
              Auditor View Only
            </span>
          )}
        </div>
      </div>

      {/* 4 Financial Overview KPI Cards (Strictly Monochrome, Black Numbers text-focus, Slate Icon Container) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Purchases */}
        <div className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-fg block">Total Purchases</span>
            <span className="text-xl sm:text-2xl font-bold text-focus block tabular-nums">
              {formatPHP(person.total_sales_amount)}
            </span>
            <span className="text-[11px] text-muted-fg block">
              {person.sales_count} sales on record
            </span>
          </div>
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0">
            <ShoppingBag className="w-5 h-5 text-focus" />
          </div>
        </div>

        {/* Card 2: Total Settled */}
        <div className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-fg block">Total Settled</span>
            <span className="text-xl sm:text-2xl font-bold text-focus block tabular-nums">
              {formatPHP(person.total_amount_paid)}
            </span>
            <span className="text-[11px] text-muted-fg block">
              {settledPercent}% settled
            </span>
          </div>
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0">
            <CheckCircle2 className="w-5 h-5 text-focus" />
          </div>
        </div>

        {/* Card 3: Outstanding Utang */}
        <div className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-fg block">Outstanding Utang</span>
            <span className="text-xl sm:text-2xl font-bold text-focus block tabular-nums">
              {formatPHP(person.total_owed)}
            </span>
            <span className="text-[11px] text-muted-fg block">
              {hasBalance ? 'Balance due' : 'Zero balance'}
            </span>
          </div>
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0">
            <Receipt className="w-5 h-5 text-focus" />
          </div>
        </div>

        {/* Card 4: Customer Status */}
        <div className="bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-fg block">Credit Status</span>
            <span className="text-xl sm:text-2xl font-bold text-focus block">
              {person.status}
            </span>
            <span className="text-[11px] text-muted-fg block">
              {person.agingBucket}d aging profile
            </span>
          </div>
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0">
            <Clock className="w-5 h-5 text-focus" />
          </div>
        </div>
      </div>

      {/* Main Ledger Table Card */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs space-y-4">
        {/* Tab Controls and Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-stroke/20">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
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
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
                activeTab === 'sales'
                  ? 'bg-white text-focus shadow-2xs font-bold'
                  : 'text-muted-fg hover:text-focus'
              )}
            >
              Sales Records ({person.sales.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer select-none',
                activeTab === 'payments'
                  ? 'bg-white text-focus shadow-2xs font-bold'
                  : 'text-muted-fg hover:text-focus'
              )}
            >
              Payment History ({person.payments.length})
            </button>
          </div>

          {activeTab === 'ledger' && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-fg pointer-events-none" />
              <input
                type="text"
                placeholder="Search transactions…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-8 text-xs rounded-xl border border-stroke/50 bg-white placeholder:text-muted-fg focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
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
          )}
        </div>

        {/* TAB 1: Running Ledger Table */}
        {activeTab === 'ledger' && (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-2xl border border-stroke/20">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 border-b border-stroke/20 hover:bg-slate-50/80">
                    <TableHead className="text-[11px] font-bold text-muted-fg uppercase py-3 px-4">
                      Date
                    </TableHead>
                    <TableHead className="text-[11px] font-bold text-muted-fg uppercase py-3 px-4 text-center">
                      Type
                    </TableHead>
                    <TableHead className="text-[11px] font-bold text-muted-fg uppercase py-3 px-4">
                      Particulars / Details
                    </TableHead>
                    <TableHead className="text-[11px] font-bold text-muted-fg uppercase py-3 px-4 text-right">
                      Debit (+)
                    </TableHead>
                    <TableHead className="text-[11px] font-bold text-muted-fg uppercase py-3 px-4 text-right">
                      Credit (-)
                    </TableHead>
                    <TableHead className="text-[11px] font-bold text-muted-fg uppercase py-3 px-4 text-right">
                      Running Balance
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedEvents.length === 0 ? (
                    <TableEmptyState
                      colSpan={6}
                      title="No transactions found"
                      description={
                        searchQuery
                          ? 'No ledger entries matched your search query.'
                          : 'No sales or payment transactions recorded for this customer.'
                      }
                      icon={<Receipt className="w-8 h-8 text-slate-300" />}
                    />
                  ) : (
                    paginatedEvents.map((evt) => (
                      <TableRow key={evt.id} className="hover:bg-slate-50/50 transition-colors">
                        <TableCell className="py-3 px-4 font-mono text-xs text-focus whitespace-nowrap">
                          {evt.date}
                        </TableCell>
                        <TableCell className="py-3 px-4 text-center whitespace-nowrap">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border shadow-2xs',
                              evt.type === 'Sale'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            )}
                          >
                            {evt.type === 'Sale' ? (
                              <>
                                <ArrowUpRight className="w-3 h-3" />
                                <span>Sale</span>
                              </>
                            ) : (
                              <>
                                <ArrowDownLeft className="w-3 h-3" />
                                <span>Payment</span>
                              </>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 px-4 text-xs font-medium text-focus max-w-[320px] truncate" title={evt.description}>
                          {evt.description}
                        </TableCell>
                        <TableCell className="py-3 px-4 text-right font-semibold text-focus tabular-nums whitespace-nowrap text-xs">
                          {evt.debit > 0 ? formatPHP(evt.debit) : '—'}
                        </TableCell>
                        <TableCell className="py-3 px-4 text-right font-semibold text-emerald-600 tabular-nums whitespace-nowrap text-xs">
                          {evt.credit > 0 ? formatPHP(evt.credit) : '—'}
                        </TableCell>
                        <TableCell className="py-3 px-4 text-right font-bold text-focus tabular-nums whitespace-nowrap text-xs">
                          {formatPHP(evt.runningBalance)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {filteredEvents.length > LEDGER_ITEMS_PER_PAGE && (
              <TablePagination
                currentPage={safeLedgerPage}
                totalPages={totalLedgerPages}
                totalItems={filteredEvents.length}
                startIndex={startIndex}
                endIndex={endIndex}
                onPageChange={(page) => setLedgerPage(page)}
              />
            )}
          </div>
        )}

        {/* TAB 2: Sales List */}
        {activeTab === 'sales' && (
          <div className="space-y-3">
            {person.sales.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-fg bg-slate-50 rounded-2xl border border-slate-100">
                No recorded sales entries for this customer.
              </div>
            ) : (
              person.sales.map((sale) => (
                <div
                  key={sale.id}
                  className="p-4 rounded-2xl border border-stroke/20 bg-white hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs shadow-2xs"
                >
                  <div className="space-y-1 max-w-full sm:max-w-[70%]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-[#960C01]">{sale.id}</span>
                      <span className="text-muted-fg font-medium">({sale.date})</span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[10.5px] font-bold border shadow-2xs',
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
                    <p className="font-semibold text-focus truncate" title={sale.items_summary}>
                      {sale.items_summary}
                    </p>
                    {sale.notes && (
                      <p className="text-[11px] text-muted-fg italic">{sale.notes}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-left sm:text-right">
                      <span className="text-[10px] text-muted-fg block">
                        Total: {formatPHP(sale.total_amount)}
                      </span>
                      <span className="text-xs sm:text-sm font-bold text-focus block tabular-nums">
                        Balance: {formatPHP(sale.balance)}
                      </span>
                    </div>
                    {sale.balance > 0 && !isAudit && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onOpenRecordPayment(person, sale)}
                        className="h-8 px-3 rounded-xl text-xs font-semibold bg-[#960C01] hover:bg-[#800a01] text-white cursor-pointer shadow-2xs"
                      >
                        Pay Sale
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: Payments List */}
        {activeTab === 'payments' && (
          <div className="space-y-3">
            {person.payments.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-fg bg-slate-50 rounded-2xl border border-slate-100">
                No recorded payments yet for this customer.
              </div>
            ) : (
              person.payments.map((pay) => (
                <div
                  key={pay.id}
                  className="p-4 rounded-2xl border border-stroke/20 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs shadow-2xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-fg">{pay.id}</span>
                      <span className="font-semibold text-focus">{pay.date}</span>
                      <span className="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-slate-100 text-focus border border-slate-200">
                        {pay.method}
                      </span>
                    </div>
                    {pay.notes && (
                      <p className="text-[11px] text-muted-fg">{pay.notes}</p>
                    )}
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <span className="text-xs sm:text-sm font-bold text-emerald-600 tabular-nums">
                      +{formatPHP(pay.amount)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

