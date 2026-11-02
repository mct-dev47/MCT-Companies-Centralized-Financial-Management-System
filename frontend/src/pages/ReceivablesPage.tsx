import * as React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Receipt,
  User,
  Building2,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  FileSpreadsheet,
  FileText,
  X,
  Coins,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { loanService } from '@/services/loanService'
import { useReceivables } from '@/hooks/useReceivables'
import { RecordUtangPaymentModal } from '@/components/receivables/RecordUtangPaymentModal'
import { PersonLedgerDrawer } from '@/components/receivables/PersonLedgerDrawer'
import type {
  PersonLedgerSummary,
  UtangSale,
} from '@/services/receivablesStore'

const ITEMS_PER_PAGE = 10

export const ReceivablesPage: React.FC = () => {
  const { user } = useSession()
  const { activeCompany, setActiveCompany } = useCompany()

  const normalizedUserRole = (user?.role || '').toLowerCase()
  const isAudit =
    normalizedUserRole === 'audit' || normalizedUserRole.includes('auditor')
  const isFinance = normalizedUserRole === 'finance'
  const assignedCompany = user?.assignedCompany || ''

  const isCompanyScoped = Boolean(
    assignedCompany &&
      assignedCompany !== 'All Companies' &&
      !isFinance &&
      !isAudit
  )

  // Company list for dropdown
  const [companyList, setCompanyList] = React.useState<string[]>([
    'All Companies',
    'MyCity.Kitchen Corporation',
    'MCTolentino Hospitality Business Corporation',
    'JK Global Headways Inc.',
    'Speedfire Construction',
    'JK Property and Ventures',
    'FilCap Prime Holdings Corp.',
    'MCT Group of Companies',
  ])

  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((companies) => {
      if (mounted && companies.length > 0) {
        const names = companies.map((c) => c.company_name).filter(Boolean)
        const combined = Array.from(new Set(['All Companies', ...names]))
        setCompanyList(combined)
      }
    })
    return () => {
      mounted = false
    }
  }, [user])

  // Company filter state
  const [selectedCompany, setSelectedCompany] = React.useState<string>(
    isCompanyScoped ? assignedCompany : activeCompany || 'All Companies'
  )

  React.useEffect(() => {
    if (isCompanyScoped && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    }
  }, [isCompanyScoped, user?.assignedCompany])

  React.useEffect(() => {
    if (!isCompanyScoped && activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany, isCompanyScoped])

  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false)
  const [companySearch, setCompanySearch] = React.useState('')
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)

  const filteredCompanyList = React.useMemo(() => {
    if (!companySearch.trim()) return companyList
    return companyList.filter((c) =>
      c.toLowerCase().includes(companySearch.toLowerCase().trim())
    )
  }, [companyList, companySearch])

  const effectiveCompany = isCompanyScoped ? assignedCompany : selectedCompany

  const {
    people,
    kpis,
    recordPayment,
    settleStaffPayrollDeduction,
    resetToDefault,
  } = useReceivables(undefined, effectiveCompany)

  // State Filters
  const [activeTab, setActiveTab] = React.useState<'All' | 'External' | 'Staff'>('All')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<'All' | 'Unpaid' | 'Partial' | 'Paid'>('All')

  // Skeleton loading state
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [effectiveCompany, activeTab, statusFilter])

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)

  // Modals & Drawers state
  const [selectedPersonForLedger, setSelectedPersonForLedger] = React.useState<PersonLedgerSummary | null>(null)
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = React.useState(false)
  const [paymentTargetPerson, setPaymentTargetPerson] = React.useState<PersonLedgerSummary | null>(null)
  const [paymentTargetSale, setPaymentTargetSale] = React.useState<UtangSale | null>(null)

  // Dropdown menus
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)

  // Feedback banner
  const [toastMessage, setToastMessage] = React.useState<string | null>(null)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 4500)
  }

  // Click-outside listener for dropdowns
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false)
      }
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(target)) {
        setIsCompanyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filtered People List
  const filteredPeople = React.useMemo(() => {
    return people.filter((p) => {
      // Tab check: External vs Staff
      if (activeTab === 'External' && p.type !== 'External') return false
      if (activeTab === 'Staff' && p.type !== 'Staff') return false

      // Search check
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = p.name.toLowerCase().includes(q)
        const matchRole = (p.role_or_dept || '').toLowerCase().includes(q)
        const matchPhone = (p.phone || '').toLowerCase().includes(q)
        if (!matchName && !matchRole && !matchPhone) return false
      }

      // Status filter
      if (statusFilter !== 'All') {
        if (statusFilter === 'Unpaid' && p.status !== 'Unpaid') return false
        if (statusFilter === 'Partial' && p.status !== 'Partial') return false
        if (statusFilter === 'Paid' && p.status !== 'Paid') return false
      }

      return true
    })
  }, [people, activeTab, searchQuery, statusFilter])

  // Reset to page 1 on filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, searchQuery, statusFilter])

  // Pagination calculation
  const totalPages = Math.ceil(filteredPeople.length / ITEMS_PER_PAGE) || 1
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredPeople.length)
  const paginatedPeople = filteredPeople.slice(startIndex, endIndex)

  // Open Payment modal from a table row
  const handleOpenPayment = (person: PersonLedgerSummary, sale?: UtangSale) => {
    setPaymentTargetPerson(person)
    setPaymentTargetSale(sale || null)
    setIsRecordPaymentOpen(true)
  }

  // Handle Payroll deduction
  const handleSettlePayroll = (customerName: string) => {
    const res = settleStaffPayrollDeduction(customerName)
    if (res.success) {
      showToast(res.message)
      if (selectedPersonForLedger?.name === customerName) {
        const updated = people.find((p) => p.name === customerName) || null
        setSelectedPersonForLedger(updated)
      }
    }
  }

  // Real CSV Export
  const handleExportCsv = () => {
    const headers = [
      'Name',
      'Customer Type',
      'Role / Department',
      'Contact Phone',
      'Total Purchases (PHP)',
      'Total Paid (PHP)',
      'Outstanding Owed (PHP)',
      'Oldest Unpaid Date',
      'Last Payment Date',
      'Status',
    ]

    const rows = filteredPeople.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      p.type,
      `"${(p.role_or_dept || '').replace(/"/g, '""')}"`,
      p.phone || '-',
      p.total_sales_amount.toFixed(2),
      p.total_amount_paid.toFixed(2),
      p.total_owed.toFixed(2),
      p.oldest_unpaid_date || '-',
      p.last_payment_date || '-',
      p.status,
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,﻿' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute(
      'download',
      `receivables_summary_${new Date().toISOString().slice(0, 10)}.csv`
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setIsExportDropdownOpen(false)
  }

  // Real PDF Export (Print Window)
  const handleExportPdf = () => {
    setIsExportDropdownOpen(false)
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const rowsHtml =
      filteredPeople.length === 0
        ? `<tr><td colspan="7" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No receivables recorded for this selection.</td></tr>`
        : filteredPeople
            .map(
              (p) => `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${p.name}<br/><span style="font-weight: normal; font-size: 10px; color: #64748b;">${p.role_or_dept || ''}</span></td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${p.type}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right;">₱${p.total_sales_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; color: #16a34a;">₱${p.total_amount_paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 700; color: ${p.total_owed > 0 ? '#dc2626' : '#16a34a'};">₱${p.total_owed.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${p.last_payment_date || '-'}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${p.status}</td>
        </tr>`
            )
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCT Receivables Report - ${new Date().toLocaleDateString()}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 32px; color: #0F172A; }
            h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; color: #0F172A; }
            .subtitle { font-size: 12px; color: #64748B; margin-bottom: 20px; }
            .kpi-row { display: flex; gap: 16px; margin-bottom: 24px; }
            .kpi-card { flex: 1; padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
            .kpi-label { font-size: 10px; text-transform: uppercase; font-weight: 600; color: #64748B; margin-bottom: 4px; }
            .kpi-val { font-size: 18px; font-weight: 700; color: #0F172A; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #cbd5e1; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; }
            @media print { body { margin: 16px; } }
          </style>
        </head>
        <body>
          <h1>MCT Group of Companies — Receivables & Utang Ledger</h1>
          <div class="subtitle">Generated on ${new Date().toLocaleString()} &bull; Total Accounts: ${filteredPeople.length}</div>
          <div class="kpi-row">
            <div class="kpi-card">
              <div class="kpi-label">Total External Utang</div>
              <div class="kpi-val">₱${kpis.totalExternalUtang.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Total Staff Utang</div>
              <div class="kpi-val">₱${kpis.totalStaffUtang.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Grand Total Receivables</div>
              <div class="kpi-val" style="color: #dc2626;">₱${kpis.totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Customer / Staff</th>
                <th>Type</th>
                <th style="text-align: right;">Total Purchases</th>
                <th style="text-align: right;">Amount Paid</th>
                <th style="text-align: right;">Balance Owed</th>
                <th>Last Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 400)
  }

  return (
    <div className="space-y-6 pb-12 max-w-[1600px] mx-auto animate-in fade-in duration-300">
      {/* Toast Confirmation Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-emerald-700 text-white shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
          <span className="text-xs sm:text-sm font-semibold">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="p-1 rounded-lg hover:bg-emerald-600/80 text-white ml-2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. Header Row (Matching Sales & Expense Pages) */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
                Receivables
              </h1>

            </div>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Summary of customer and staff food credit, aging balances, and remittances in{' '}
              <strong className="font-semibold text-focus">
                {isCompanyScoped
                  ? assignedCompany
                  : selectedCompany === 'All Companies'
                  ? 'MCT Group of Companies'
                  : selectedCompany}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start sm:self-auto">
            {/* Reset Demo Data Button (Hidden for Audit) */}
            {!isAudit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  resetToDefault()
                  showToast('Reset sample receivables data to default demo state.')
                }}
                className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl border border-stroke/50 bg-white text-muted-fg hover:text-focus text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer transition-all box-border"
                title="Reset sample data back to default demo records"
              >
                <RotateCcw className="w-3.5 h-3.5 text-muted-fg" />
                <span>Reset Demo</span>
              </Button>
            )}

            {/* Export Dropdown (CSV / PDF) */}
            <div ref={exportDropdownRef} className="relative inline-block">
              <Button
                type="button"
                onClick={() => setIsExportDropdownOpen((prev) => !prev)}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white border-transparent"
                aria-haspopup="true"
                aria-expanded={isExportDropdownOpen}
              >
                <Download className="h-4 w-4 shrink-0 text-white" />
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

        {/* Second Row: Search Bar & Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
          {/* Extended Width Search Bar */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-muted-fg absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, department, or phone…"
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {/* Company Dropdown Filter Button */}
            {isCompanyScoped ? (
              <div className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-xs">
                <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
                <span className="font-semibold text-focus/90">
                  {assignedCompany}
                </span>
              </div>
            ) : (
              <div ref={companyDropdownRef} className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setIsCompanyDropdownOpen((prev) => !prev)}
                  className={cn(
                    'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                    isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                  )}
                  aria-label="Filter receivables by company"
                >
                  <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
                  <span className="font-medium text-focus/90 truncate max-w-[150px]">
                    {selectedCompany}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
                  {selectedCompany !== 'All Companies' && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedCompany('All Companies')
                        setActiveCompany('All Companies')
                      }}
                      className="p-0.5 rounded-full hover:bg-slate-200 text-muted-fg hover:text-focus transition-colors ml-0.5 inline-flex items-center justify-center cursor-pointer"
                      title="Reset to All Companies"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </button>

                {isCompanyDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-68 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-stroke/20 px-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                        Filter By Company
                      </span>
                      {selectedCompany !== 'All Companies' && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCompany('All Companies')
                            setActiveCompany('All Companies')
                            setIsCompanyDropdownOpen(false)
                          }}
                          className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                        >
                          Clear Filter
                        </button>
                      )}
                    </div>

                    <div className="relative mb-2 px-1">
                      <Search className="w-3.5 h-3.5 text-muted-fg absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                        placeholder="Search company…"
                        className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-stroke/40 bg-slate-50/70 text-xs text-focus placeholder:text-muted-fg/60 focus:outline-none focus:ring-1 focus:ring-focus focus:bg-white"
                      />
                      {companySearch && (
                        <button
                          type="button"
                          onClick={() => setCompanySearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg hover:text-focus p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-0.5 max-h-56 overflow-y-auto pr-0.5">
                      {filteredCompanyList.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-fg">
                          No matching companies
                        </div>
                      ) : (
                        filteredCompanyList.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setSelectedCompany(c)
                              setActiveCompany(c)
                              setIsCompanyDropdownOpen(false)
                              setCompanySearch('')
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
            )}

            {/* Status Dropdown Filter */}
            <div ref={statusDropdownRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsStatusDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border',
                  statusFilter === 'Unpaid'
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : statusFilter === 'Partial'
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : statusFilter === 'Paid'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-stroke/60',
                  isStatusDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium">
                  {statusFilter === 'All' ? 'Status' : statusFilter}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-fg shrink-0 transition-transform duration-200',
                    isStatusDropdownOpen && 'transform rotate-180'
                  )}
                />
              </button>

              {isStatusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  {(['All', 'Unpaid', 'Partial', 'Paid'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setStatusFilter(st)
                        setIsStatusDropdownOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                        statusFilter === st
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-focus/80 hover:bg-slate-50'
                      )}
                    >
                      <span>{st === 'All' ? 'All Status' : st}</span>
                      {statusFilter === st && (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dynamic Tab Switcher: All / External / Staff */}
            <div className="flex items-center bg-slate-100 rounded-full border border-stroke/30 p-1 gap-1 shrink-0">
              {(['All', 'External', 'Staff'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none',
                    activeTab === tab
                      ? 'bg-[#960C01] text-white shadow-xs'
                      : 'text-focus/70 hover:bg-white hover:text-focus'
                  )}
                >
                  <span>{tab === 'All' ? 'All' : tab}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. KPI Cards (Exact match to Sales & Expense styling, typography & colors) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Total External Utang */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total External Utang
            </span>
            {loading ? (
              <div className="space-y-1.5 mt-2">
                <Skeleton className="h-7 w-36 rounded-md" />
                <Skeleton className="h-3.5 w-56 rounded-md" />
              </div>
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalExternalUtang)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  {kpis.externalDebtorCount} outside customers with open credit
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-sky-50 border border-sky-200/60 flex items-center justify-center text-sky-600 shrink-0 shadow-2xs">
            <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* Card 2: Total Staff Utang */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total Staff Utang
            </span>
            {loading ? (
              <div className="space-y-1.5 mt-2">
                <Skeleton className="h-7 w-36 rounded-md" />
                <Skeleton className="h-3.5 w-56 rounded-md" />
              </div>
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalStaffUtang)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  {kpis.staffDebtorCount} staff members eligible for payroll deduction
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-purple-50 border border-purple-200/60 flex items-center justify-center text-purple-600 shrink-0 shadow-2xs">
            <User className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        {/* Card 3: Grand Total Receivables */}
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Grand Total Receivables
            </span>
            {loading ? (
              <div className="space-y-1.5 mt-2">
                <Skeleton className="h-7 w-36 rounded-md" />
                <Skeleton className="h-3.5 w-56 rounded-md" />
              </div>
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-rose-600 mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalOutstanding)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Total unpaid food balance across all accounts
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-rose-50 border border-rose-200/60 flex items-center justify-center text-rose-600 shrink-0 shadow-2xs">
            <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>
      </div>

      {/* 3. Main Receivables Table Card (Matching System Standards) */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6">
        {/* Dynamic Context & Filter Bar (Matching System Standards) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 mb-2 border-b border-slate-100">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border',
                activeTab === 'Staff'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : activeTab === 'External'
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-[#960C01]/10 text-[#960C01] border-[#960C01]/20'
              )}
            >
              <span>{activeTab === 'All' ? 'All Receivables' : `${activeTab} Receivables`}</span>
            </span>

            {statusFilter !== 'All' && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border',
                  statusFilter === 'Paid'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : statusFilter === 'Partial'
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                )}
              >
                <span>Status: {statusFilter}</span>
                <button
                  type="button"
                  onClick={() => setStatusFilter('All')}
                  className="hover:opacity-75 cursor-pointer"
                  title="Clear status filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>

          <span className="text-xs text-muted-fg font-medium">
            {filteredPeople.length} {filteredPeople.length === 1 ? 'account' : 'accounts'} shown
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full table-fixed min-w-[940px]">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                <TableHead className="w-[22%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  NAME / CONTACT
                </TableHead>
                <TableHead className="w-[12%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TYPE
                </TableHead>
                <TableHead className="w-[14%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TOTAL PURCHASES
                </TableHead>
                <TableHead className="w-[14%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  AMOUNT PAID
                </TableHead>
                <TableHead className="w-[15%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TOTAL OWED
                </TableHead>
                <TableHead className="w-[13%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  STATUS
                </TableHead>
                <TableHead className="w-[10%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <TableRow key={idx} className="border-b border-slate-100">
                    <TableCell className="w-[22%] px-3.5 py-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Skeleton className="w-8 h-8 rounded-xl shrink-0" />
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <Skeleton className="h-4 w-28 rounded-md" />
                          <Skeleton className="h-3 w-36 rounded-md" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="w-[12%] px-3.5 py-4">
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </TableCell>
                    <TableCell className="w-[14%] px-3.5 py-4">
                      <Skeleton className="h-4 w-24 rounded-md" />
                    </TableCell>
                    <TableCell className="w-[14%] px-3.5 py-4">
                      <Skeleton className="h-4 w-24 rounded-md" />
                    </TableCell>
                    <TableCell className="w-[15%] px-3.5 py-4">
                      <Skeleton className="h-4 w-24 rounded-md" />
                    </TableCell>
                    <TableCell className="w-[13%] px-3.5 py-4">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell className="w-[10%] px-3.5 py-4 text-center">
                      <Skeleton className="h-7 w-14 rounded-lg mx-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : paginatedPeople.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-14 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                        <AlertCircle className="w-6 h-6 stroke-[1.5]" />
                      </div>
                      <p className="font-semibold text-focus text-sm sm:text-base">
                        No matching receivables found
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        Try adjusting your search query or status filter to view more debtor accounts.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedPeople.map((p) => {
                  const isStaff = p.type === 'Staff'
                  const hasOwed = p.total_owed > 0

                  return (
                    <TableRow
                      key={p.name}
                      onClick={() => setSelectedPersonForLedger(p)}
                      className="border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-300 cursor-pointer"
                      title="Click to view detailed customer ledger & transaction history"
                    >
                      {/* 1. Name & Contact */}
                      <TableCell className="w-[22%] px-3.5 py-3.5 text-left truncate">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={cn(
                              'w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs',
                              isStaff ? 'bg-purple-100 text-purple-700' : 'bg-sky-100 text-sky-700'
                            )}
                          >
                            {p.name.charAt(0)}
                          </div>
                          <div className="min-w-0 truncate">
                            <span className="font-semibold text-xs sm:text-sm text-focus block truncate">
                              {p.name}
                            </span>
                            <span className="text-[11px] text-muted-fg block truncate">
                              {p.role_or_dept || ''} {p.phone ? `• ${p.phone}` : ''}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {/* 2. Customer Type Badge */}
                      <TableCell className="w-[12%] px-3.5 py-3.5 text-left whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border',
                            isStaff
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-sky-50 text-sky-700 border-sky-200'
                          )}
                        >
                          {isStaff ? (
                            <>
                              <User className="w-3 h-3 text-purple-600" />
                              <span>Staff</span>
                            </>
                          ) : (
                            <>
                              <Building2 className="w-3 h-3 text-sky-600" />
                              <span>External</span>
                            </>
                          )}
                        </span>
                      </TableCell>

                      {/* 3. Total Purchases */}
                      <TableCell className="w-[14%] px-3.5 py-3.5 text-left font-medium text-xs text-focus tabular-nums whitespace-nowrap">
                        <div>
                          <span className="font-semibold">{formatPHP(p.total_sales_amount)}</span>
                          <span className="text-[10.5px] text-muted-fg block font-normal">
                            {p.sales_count} order{p.sales_count > 1 ? 's' : ''}
                          </span>
                        </div>
                      </TableCell>

                      {/* 4. Amount Paid */}
                      <TableCell className="w-[14%] px-3.5 py-3.5 text-left font-medium text-xs text-emerald-600 tabular-nums whitespace-nowrap">
                        <span className="font-semibold">{formatPHP(p.total_amount_paid)}</span>
                      </TableCell>

                      {/* 5. Total Owed */}
                      <TableCell className="w-[15%] px-3.5 py-3.5 text-left font-bold text-xs sm:text-sm tabular-nums whitespace-nowrap">
                        <span className={cn(hasOwed ? 'text-rose-600 font-bold' : 'text-emerald-600')}>
                          {formatPHP(p.total_owed)}
                        </span>
                      </TableCell>

                      {/* 6. Status Badge (Exact System Theme) */}
                      <TableCell className="w-[13%] px-3.5 py-3.5 text-left whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wide uppercase',
                            p.status === 'Paid' && 'bg-emerald-50 text-emerald-700 border-emerald-300',
                            p.status === 'Partial' && 'bg-amber-50 text-amber-700 border-amber-300',
                            p.status === 'Unpaid' && 'bg-rose-50 text-rose-700 border-rose-300'
                          )}
                        >
                          <span
                            className={cn(
                              'w-1.5 h-1.5 rounded-full',
                              p.status === 'Paid' && 'bg-emerald-500',
                              p.status === 'Partial' && 'bg-amber-500',
                              p.status === 'Unpaid' && 'bg-rose-500'
                            )}
                          />
                          <span>{p.status}</span>
                        </span>
                      </TableCell>

                      {/* 7. Actions */}
                      <TableCell
                        className="w-[10%] px-3.5 py-3.5 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          {hasOwed && !isAudit && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleOpenPayment(p)}
                              className="h-8 px-2.5 sm:px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-xs flex items-center gap-1 shadow-2xs cursor-pointer"
                              title="Record payment remittance"
                            >
                              <Coins className="w-3.5 h-3.5" />
                              <span>Pay</span>
                            </Button>
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedPersonForLedger(p)}
                            className="h-8 px-2.5 rounded-lg text-xs font-semibold text-focus hover:bg-slate-100 cursor-pointer"
                            title={isAudit ? 'View debtor account history' : 'View account ledger'}
                          >
                            <span>{isAudit ? 'View' : 'Ledger'}</span>
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

        {/* 4. Standard System Pagination Footer (Matching Sales & Expense Pages) */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          <span className="font-medium text-focus/80">
            {filteredPeople.length === 0
              ? 'Showing 0 of 0 accounts'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredPeople.length} accounts`}
          </span>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs text-muted-fg italic">
              Page {currentPage} out of {totalPages}
            </span>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Record Payment Modal */}
      <RecordUtangPaymentModal
        open={isRecordPaymentOpen}
        onOpenChange={setIsRecordPaymentOpen}
        person={paymentTargetPerson}
        sale={paymentTargetSale}
        onRecordPayment={recordPayment}
        onSuccess={(msg) => {
          showToast(msg)
          if (selectedPersonForLedger && paymentTargetPerson) {
            const updated = people.find((p) => p.name === paymentTargetPerson.name) || null
            setSelectedPersonForLedger(updated)
          }
        }}
      />

      {/* Person Ledger Drawer / Full View */}
      <PersonLedgerDrawer
        open={Boolean(selectedPersonForLedger)}
        onOpenChange={(open) => !open && setSelectedPersonForLedger(null)}
        person={selectedPersonForLedger}
        onOpenRecordPayment={handleOpenPayment}
        onSettlePayrollDeduction={handleSettlePayroll}
        isAudit={isAudit}
      />
    </div>
  )
}
