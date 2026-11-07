import * as React from 'react'
import { createPortal } from 'react-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TableSkeleton } from '@/components/common/TableSkeleton'
import { CardSkeleton } from '@/components/common/CardSkeleton'
import { TablePagination, TableEmptyState } from '@/components/common'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  MoreVertical,
  Eye,
  Receipt,
  User,
  Building2,
  Search,
  ChevronDown,
  Check,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  FileSpreadsheet,
  FileText,
  X,
  Coins,
  Edit2,
  Trash2,
  AlertTriangle,
  Lock,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { formatPHP } from '@/lib/format'
import { useDropdownPosition } from '@/hooks/useDropdownPosition'
import { isCompanyMatch } from '@/utils/companyUtils'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { loanService } from '@/services/loanService'
import { websocketService } from '@/services/websocketService'
import { useReceivables } from '@/hooks/useReceivables'
import { RecordUtangPaymentModal } from '@/components/receivables/RecordUtangPaymentModal'
import { PersonLedgerPageView } from '@/components/receivables/PersonLedgerPageView'
import type {
  CustomerType,
  PersonLedgerSummary,
  UtangSale,
} from '@/services/receivablesStore'

const ITEMS_PER_PAGE = 10

export const ReceivablesPage: React.FC = () => {
  const { user } = useSession()
  const { activeCompany, setActiveCompany, allCompanies, isCompanyScoped: isStrictlyCompanyScoped } = useCompany()

  const normalizedUserRole = (user?.role || '').toLowerCase()
  const isAudit =
    normalizedUserRole === 'audit' || normalizedUserRole.includes('auditor')
  const isAdmin = normalizedUserRole === 'admin'
  const isOwner = normalizedUserRole === 'owner'
  const isFinance = normalizedUserRole === 'finance'
  const assignedCompany = user?.assignedCompany || ''

  const isCompanyScoped = isStrictlyCompanyScoped

  // Company-scoped write check (AC-3): Finance (all companies) or Company/Supervisor (within assigned company scope)
  const canManageCompany = React.useCallback(
    (companyName?: string, companyId?: number): boolean => {
      if (!user || isAudit || isAdmin) return false
      if (isFinance) return true
      if (normalizedUserRole === 'supervisor' || normalizedUserRole === 'company') {
        if (companyId && user.companyIds && user.companyIds.includes(companyId)) {
          return true
        }
        if (companyId && user.companyId && user.companyId === companyId) {
          return true
        }
        if (companyName) {
          if (user.assignedCompany && isCompanyMatch(companyName, user.assignedCompany)) {
            return true
          }
          if (
            user.companyNames &&
            user.companyNames.some((cnName) => isCompanyMatch(companyName, cnName))
          ) {
            return true
          }
        }
      }
      return false
    },
    [user, isAudit, isAdmin, isFinance, normalizedUserRole]
  )

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
    if (!isAdmin && !isFinance && allCompanies && allCompanies.length > 0) {
      return
    }
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
  }, [allCompanies, isAdmin, isFinance, user])

  // Company filter state
  React.useEffect(() => {
    if (allCompanies && allCompanies.length > 0) {
      setCompanyList(allCompanies)
    }
  }, [allCompanies])
  const [selectedCompany, setSelectedCompany] = React.useState<string>(() => {
    if (isCompanyScoped && assignedCompany) return assignedCompany
    if (activeCompany && activeCompany !== 'All Companies') return activeCompany
    return activeCompany || 'All Companies'
  })

  React.useEffect(() => {
    if (isCompanyScoped && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    }
  }, [isCompanyScoped, user?.assignedCompany])

  React.useEffect(() => {
    if (activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany])

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
    editSale,
    updateDebtor,
    deleteDebtor,
    deleteSale,
    deletePayment,
    refreshFromBackend,
    resetToDefault,
  } = useReceivables(undefined, effectiveCompany)

  // Real-time WebSocket + Reconnect + Window Focus background sync (250ms debounced, AC-10)
  React.useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const triggerDebouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void refreshFromBackend()
      }, 250)
    }

    const unsubReceivables = websocketService.subscribe(
      'RECEIVABLES_UPDATED',
      triggerDebouncedRefresh
    )
    const unsubSales = websocketService.subscribe(
      'SALES_UPDATED',
      triggerDebouncedRefresh
    )
    const unsubAudit = websocketService.subscribe(
      'AUDIT_UPDATED',
      triggerDebouncedRefresh
    )
    const unsubStatus = websocketService.subscribe('WS_STATUS_CHANGE', (data) => {
      if (data?.status === 'connected') {
        triggerDebouncedRefresh()
      }
    })

    const handleWindowFocus = () => {
      triggerDebouncedRefresh()
    }
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      unsubReceivables()
      unsubSales()
      unsubAudit()
      unsubStatus()
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [refreshFromBackend])

  // Debtor batch edit & delete state (AC-9)
  const [editingPerson, setEditingPerson] = React.useState<PersonLedgerSummary | null>(null)
  const [editPersonName, setEditPersonName] = React.useState('')
  const [editPersonType, setEditPersonType] = React.useState<CustomerType>('External')
  const [personEditError, setPersonEditError] = React.useState<string | null>(null)
  const [isSavingPersonEdit, setIsSavingPersonEdit] = React.useState(false)

  const [deletingPerson, setDeletingPerson] = React.useState<PersonLedgerSummary | null>(null)
  const [personDeleteError, setPersonDeleteError] = React.useState<string | null>(null)
  const [isDeletingPerson, setIsDeletingPerson] = React.useState(false)

  const handleOpenEditPerson = (p: PersonLedgerSummary) => {
    if (p.all_locked) return
    setEditingPerson(p)
    setEditPersonName(p.name)
    setEditPersonType(p.type)
    setPersonEditError(null)
  }

  const handleSavePersonEdit = async () => {
    if (!editingPerson) return
    if (!editPersonName.trim()) {
      setPersonEditError('Customer or staff name cannot be empty.')
      return
    }
    setIsSavingPersonEdit(true)
    setPersonEditError(null)
    try {
      const res = await updateDebtor({
        old_customer_name: editingPerson.name,
        new_customer_name: editPersonName.trim(),
        customer_type: editPersonType,
        company: editingPerson.company,
        company_id: editingPerson.company_id,
      })
      if (!res.success) {
        setPersonEditError(res.message)
        return
      }
      showToast(res.message)
      setEditingPerson(null)
    } catch (err: any) {
      setPersonEditError(err?.message || 'Failed to update debtor profile.')
    } finally {
      setIsSavingPersonEdit(false)
    }
  }

  const handleConfirmDeletePerson = async () => {
    if (!deletingPerson) return
    setIsDeletingPerson(true)
    setPersonDeleteError(null)
    try {
      const res = await deleteDebtor({
        customer_name: deletingPerson.name,
        company: deletingPerson.company,
        company_id: deletingPerson.company_id,
      })
      if (!res.success) {
        setPersonDeleteError(res.message)
        return
      }
      showToast(res.message)
      setDeletingPerson(null)
    } catch (err: any) {
      setPersonDeleteError(err?.message || 'Failed to delete debtor account.')
    } finally {
      setIsDeletingPerson(false)
    }
  }

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

  // Floating 3-dots action menu state
  const [openMenuPersonName, setOpenMenuPersonName] = React.useState<string | null>(null)
  const [activeMenuPerson, setActiveMenuPerson] = React.useState<PersonLedgerSummary | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{ top: number; right: number; openUpward: boolean } | null>(null)

  React.useEffect(() => {
    if (!openMenuPersonName) return
    const handleClickOutside = () => {
      setOpenMenuPersonName(null)
      setActiveMenuPerson(null)
    }
    const handleScroll = () => {
      setOpenMenuPersonName(null)
      setActiveMenuPerson(null)
    }
    window.addEventListener('click', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.removeEventListener('click', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [openMenuPersonName])

  // Modals & Drawers state
  const [selectedPersonForLedger, setSelectedPersonForLedger] =
    React.useState<PersonLedgerSummary | null>(null)
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = React.useState(false)
  const [paymentTargetPerson, setPaymentTargetPerson] =
    React.useState<PersonLedgerSummary | null>(null)
  const [paymentTargetSale, setPaymentTargetSale] = React.useState<UtangSale | null>(null)

  // Keep open PersonLedgerDrawer live-synced whenever `people` updates
  React.useEffect(() => {
    setSelectedPersonForLedger((prev) => {
      if (!prev) return null
      return (
        people.find((p) => p.key === prev.key) ||
        people.find((p) => p.name === prev.name && p.company === prev.company) ||
        null
      )
    })
  }, [people])

  // Dropdown menus
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)

  const exportPos = useDropdownPosition(exportDropdownRef, isExportDropdownOpen)
  const statusPos = useDropdownPosition(statusDropdownRef, isStatusDropdownOpen)
  const companyPos = useDropdownPosition(companyDropdownRef, isCompanyDropdownOpen)

  // Feedback banner
  const [toastMessage, setToastMessage] = React.useState<string | null>(null)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 4500)
  }

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

  // Filtered People List (AC-2: search by customer/staff name, no phone/role)
  const filteredPeople = React.useMemo(() => {
    return people.filter((p) => {
      if (activeTab === 'External' && p.type !== 'External') return false
      if (activeTab === 'Staff' && p.type !== 'Staff') return false

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = p.name.toLowerCase().includes(q)
        const matchCompany = (p.company || '').toLowerCase().includes(q)
        if (!matchName && !matchCompany) return false
      }

      if (statusFilter !== 'All') {
        if (statusFilter === 'Unpaid' && p.status !== 'Unpaid') return false
        if (statusFilter === 'Partial' && p.status !== 'Partial') return false
        if (statusFilter === 'Paid' && p.status !== 'Paid') return false
      }

      return true
    })
  }, [people, activeTab, searchQuery, statusFilter])

  React.useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, searchQuery, statusFilter])

  const totalPages = Math.ceil(filteredPeople.length / ITEMS_PER_PAGE) || 1
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredPeople.length)
  const paginatedPeople = filteredPeople.slice(startIndex, endIndex)

  const handleOpenPayment = (person: PersonLedgerSummary, sale?: UtangSale) => {
    setPaymentTargetPerson(person)
    setPaymentTargetSale(sale || null)
    setIsRecordPaymentOpen(true)
  }

  const handleSettlePayroll = (
    customerName: string,
    companyId?: number,
    companyName?: string
  ) => {
    const res = settleStaffPayrollDeduction(customerName, undefined, companyId, companyName)
    if (res.success) {
      showToast(res.message)
    }
  }

  // Real CSV Export (AC-2: no Role/Phone columns)
  const handleExportCsv = () => {
    const headers = [
      'Customer / Staff Name',
      'Customer Type',
      'Company',
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
      `"${(p.company || '').replace(/"/g, '""')}"`,
      p.total_sales_amount.toFixed(2),
      p.total_amount_paid.toFixed(2),
      p.total_owed.toFixed(2),
      p.oldest_unpaid_date || '-',
      p.last_payment_date || '-',
      p.status,
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
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

  // Real PDF Export (AC-2: no Role/Phone subtitles)
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
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${p.name}</td>
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
          <h1>MCT Group of Companies - Receivables &amp; Utang Ledger</h1>
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

      {selectedPersonForLedger ? (
        <PersonLedgerPageView
          person={selectedPersonForLedger}
          onBack={() => setSelectedPersonForLedger(null)}
          onOpenRecordPayment={handleOpenPayment}
          onOpenEditProfile={handleOpenEditPerson}
          onSettlePayrollDeduction={handleSettlePayroll}
          isAudit={isAudit || isOwner}
          canEdit={canManageCompany(
            selectedPersonForLedger.company,
            selectedPersonForLedger.company_id
          )}
          onEditSale={editSale}
          onDeleteSale={deleteSale}
          onDeletePayment={deletePayment}
        />
      ) : (
        <>
          {/* 1. Header Row */}
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
            {isFinance && (
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

            <div ref={exportDropdownRef} className="relative inline-block">
              <Button
                type="button"
                onClick={() => setIsExportDropdownOpen((prev) => !prev)}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white border-transparent"
                aria-haspopup="true"
                aria-expanded={isExportDropdownOpen}
              >
                <span>Export</span>
                <ChevronDown className="h-3.5 w-3.5 ml-0.5 text-white/90" />
              </Button>

              {isExportDropdownOpen && (
                <div
                  style={exportPos.isMobile ? exportPos.style : undefined}
                  className={cn(
                    'bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                    exportPos.isMobile
                      ? 'w-[min(calc(100vw-32px),240px)]'
                      : 'absolute right-0 top-full mt-2 w-52'
                  )}
                >
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
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-muted-fg absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer or staff name…"
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
            {isCompanyScoped ? (
              <div className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-xs">
                <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
                <span className="font-semibold text-focus/90">{assignedCompany}</span>
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
                  <div
                    style={companyPos.isMobile ? companyPos.style : undefined}
                    className={cn(
                      'bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                      companyPos.isMobile
                        ? 'w-[min(calc(100vw-32px),320px)]'
                        : 'absolute right-0 top-full mt-2 w-68'
                    )}
                  >
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
                <div
                  style={statusPos.isMobile ? statusPos.style : undefined}
                  className={cn(
                    'bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150',
                    statusPos.isMobile
                      ? 'w-[min(calc(100vw-32px),220px)]'
                      : 'absolute right-0 top-full mt-2 w-44'
                  )}
                >
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

      {/* 2. KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Total External Utang
            </span>
            {loading ? (
              <CardSkeleton inline={true} />
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

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
            <Building2 className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">Total Staff Utang</span>
            {loading ? (
              <CardSkeleton inline={true} />
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

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
            <User className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>

        <Card className="w-full bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md hover:border-stroke/40">
          <div className="w-full max-w-[calc(100%-60px)]">
            <span className="text-xs font-medium text-muted-fg block">
              Grand Total Receivables
            </span>
            {loading ? (
              <CardSkeleton inline={true} />
            ) : (
              <>
                <h3 className="text-xl sm:text-2xl font-bold text-focus mt-1 tabular-nums tracking-tight">
                  {formatPHP(kpis.totalOutstanding)}
                </h3>
                <p className="text-2xs sm:text-xs text-muted-fg font-normal mt-0.5 truncate">
                  Total unpaid food balance across all accounts
                </p>
              </>
            )}
          </div>

          <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-focus shrink-0 shadow-2xs">
            <Receipt className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </Card>
      </div>

      {/* 3. Main Receivables Table Card */}
      <Card className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6">
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
              <col style={{ width: '14%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                <TableHead className="w-[22%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  CUSTOMER / STAFF
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
                <TableHead className="w-[14%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  TOTAL OWED
                </TableHead>
                <TableHead className="w-[11%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  STATUS
                </TableHead>
                <TableHead className="w-[13%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableSkeleton rows={6} columns={7} />
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
                  const hasOwed = p.total_owed > 0.005
                  const unlockedOwed = p.sales
                    .filter((s) => !s.is_locked)
                    .reduce((acc, s) => acc + s.balance, 0)
                  const rowCanEdit = canManageCompany(p.company, p.company_id)

                  return (
                    <TableRow
                      key={p.key}
                      onClick={() => setSelectedPersonForLedger(p)}
                      className="border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-300 cursor-pointer"
                      title="Click to view detailed account ledger & transaction history"
                    >
                      {/* 1. Customer / Staff Name */}
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
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-xs sm:text-sm text-focus block truncate">
                                {p.name}
                              </span>
                              {p.all_locked && (
                                <Lock
                                  className="w-3.5 h-3.5 text-slate-500 shrink-0"
                                  aria-label="Locked (Verified)"
                                />
                              )}
                            </div>
                            {effectiveCompany === 'All Companies' && p.company && (
                              <span className="text-[11px] text-muted-fg block truncate">
                                {p.company}
                              </span>
                            )}
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
                      <TableCell className="w-[14%] px-3.5 py-3.5 text-left font-bold text-xs sm:text-sm tabular-nums whitespace-nowrap">
                        <span className={cn(hasOwed ? 'text-rose-600 font-bold' : 'text-emerald-600')}>
                          {formatPHP(p.total_owed)}
                        </span>
                      </TableCell>

                      {/* 6. Status Badge */}
                      <TableCell className="w-[11%] px-3.5 py-3.5 text-left whitespace-nowrap">
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

                      {/* 7. Actions (Standard 3-dots Menu matching system) */}
                      <TableCell
                        className="w-[10%] px-3.5 py-3.5 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (openMenuPersonName === p.key) {
                                setOpenMenuPersonName(null)
                                setMenuPosition(null)
                                setActiveMenuPerson(null)
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const openUpward = rect.bottom + 180 > window.innerHeight
                                setMenuPosition({
                                  top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                  right: Math.max(12, window.innerWidth - rect.right),
                                  openUpward,
                                })
                                setActiveMenuPerson(p)
                                setOpenMenuPersonName(p.key)
                              }
                            }}
                            className="h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer flex items-center justify-center transition-colors"
                            title="Row Actions"
                            aria-label={`Actions for ${p.name}`}
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

        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredPeople.length}
          startIndex={startIndex}
          endIndex={endIndex}
          onPageChange={setCurrentPage}
          itemLabel="accounts"
        />
      </Card>

      {/* Floating 3-dots Action Menu Portal */}
      {openMenuPersonName && activeMenuPerson && menuPosition && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed w-52 bg-white rounded-xl border border-slate-200 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg border-b border-slate-100">
              Account Actions
            </div>

            <button
              type="button"
              onClick={() => {
                const target = activeMenuPerson
                setOpenMenuPersonName(null)
                setActiveMenuPerson(null)
                setSelectedPersonForLedger(target)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-focus hover:bg-slate-50 rounded-lg transition-colors cursor-pointer text-left"
            >
              <Eye className="w-3.5 h-3.5 text-muted-fg shrink-0" />
              <span>{isAudit || isOwner ? 'View Account History' : 'View Account Ledger'}</span>
            </button>

            {activeMenuPerson.total_owed > 0.005 && !isAudit && !isOwner && canManageCompany(activeMenuPerson.company, activeMenuPerson.company_id) && (
              <button
                type="button"
                disabled={activeMenuPerson.all_locked || activeMenuPerson.sales.filter((s) => !s.is_locked).reduce((acc, s) => acc + s.balance, 0) <= 0.005}
                onClick={() => {
                  const target = activeMenuPerson
                  setOpenMenuPersonName(null)
                  setActiveMenuPerson(null)
                  handleOpenPayment(target)
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Coins className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Record Payment</span>
              </button>
            )}

            {!isAudit && !isOwner && canManageCompany(activeMenuPerson.company, activeMenuPerson.company_id) && (
              <>
                <button
                  type="button"
                  disabled={activeMenuPerson.all_locked}
                  onClick={() => {
                    const target = activeMenuPerson
                    setOpenMenuPersonName(null)
                    setActiveMenuPerson(null)
                    handleOpenEditPerson(target)
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-focus hover:bg-slate-50 rounded-lg transition-colors cursor-pointer text-left border-t border-slate-100 mt-1 pt-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Edit2 className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                  <span>Edit Debtor Profile</span>
                </button>

                <button
                  type="button"
                  disabled={activeMenuPerson.has_locked}
                  onClick={() => {
                    const target = activeMenuPerson
                    setOpenMenuPersonName(null)
                    setActiveMenuPerson(null)
                    setPersonDeleteError(null)
                    setDeletingPerson(target)
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Delete Debtor Account</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )}
        </>
      )}

      {/* Record Payment Modal */}
      <RecordUtangPaymentModal
        open={isRecordPaymentOpen}
        onOpenChange={setIsRecordPaymentOpen}
        person={paymentTargetPerson}
        sale={paymentTargetSale}
        onRecordPayment={recordPayment}
        onSuccess={(msg) => {
          showToast(msg)
        }}
      />

      {/* Dialog: Edit Debtor Profile (AC-2, AC-3, AC-9) */}
      {editingPerson && (
        <Dialog open={Boolean(editingPerson)} onOpenChange={(o) => !o && setEditingPerson(null)}>
          <DialogContent className="sm:max-w-[440px] p-5 rounded-2xl bg-white shadow-xl">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-base font-bold text-focus flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#960C01]" />
                <span>Edit Debtor Profile</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg">
                Update debtor name or customer classification across all non-locked receivable orders for this account.
              </DialogDescription>
            </DialogHeader>

            {personEditError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{personEditError}</span>
              </div>
            )}

            <div className="space-y-3 pt-2 text-xs text-left">
              <div>
                <label className="font-semibold text-focus block mb-1">
                  Customer / Staff Name
                </label>
                <input
                  type="text"
                  value={editPersonName}
                  onChange={(e) => setEditPersonName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#960C01]"
                />
              </div>

              <div>
                <label className="font-semibold text-focus block mb-1">Customer Type</label>
                <select
                  value={editPersonType}
                  onChange={(e) =>
                    setEditPersonType(e.target.value === 'Staff' ? 'Staff' : 'External')
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-[#960C01]"
                >
                  <option value="External">External</option>
                  <option value="Staff">Staff</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingPerson(null)}
                disabled={isSavingPersonEdit}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSavePersonEdit}
                disabled={isSavingPersonEdit}
                className="bg-[#960C01] hover:bg-[#7d0a00] text-white"
              >
                {isSavingPersonEdit ? 'Updating...' : 'Save Changes'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog: Confirm Delete Debtor Account (AC-3, AC-9) */}
      {deletingPerson && (
        <Dialog open={Boolean(deletingPerson)} onOpenChange={(o) => !o && setDeletingPerson(null)}>
          <DialogContent className="sm:max-w-[440px] p-5 rounded-2xl bg-white shadow-xl">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-base font-bold text-rose-600 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Delete Debtor Account?</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-fg">
                Are you sure you want to delete all receivable records for{' '}
                <strong>{deletingPerson.name}</strong>? Linked sale lines and deposited payments will be reversed automatically.
              </DialogDescription>
            </DialogHeader>

            {personDeleteError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{personDeleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeletingPerson(null)}
                disabled={isDeletingPerson}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmDeletePerson}
                disabled={isDeletingPerson}
                className="bg-rose-600 hover:bg-rose-700 text-white"
              >
                {isDeletingPerson ? 'Deleting...' : 'Confirm Delete'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
