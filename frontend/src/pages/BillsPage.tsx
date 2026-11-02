import * as React from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Receipt,
  CheckCircle2,
  Clock,
  BellRing,
  Plus,
  Download,
  FileSpreadsheet,
  Trash2,
  Pencil,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Building2,
  X,
  AlertCircle,
  Eye,
  MoreVertical,
  FileText,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useSession } from '@/hooks/useSession'
import { useCompany } from '@/context/CompanyContext'
import { formatPHP } from '@/lib/format'
import {
  billsService,
  type BillItem,
  type BillReminder,
  type BillStatus,
} from '@/services/billsService'
import { loanService } from '@/services/loanService'
import { AddBillModal } from '@/components/dashboard/AddBillModal'
import { EditBillModal } from '@/components/dashboard/EditBillModal'
import { BillDetailPageView } from '@/components/dashboard/BillDetailPageView'
import { RecordBillPaymentModal } from '@/components/dashboard/RecordBillPaymentModal'
import { DashboardKpiCard } from '@/components/dashboard/DashboardKpiCard'
import { isCompanyMatch } from '@/utils/companyUtils'
import { formatDisplayDate } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

const DEFAULT_COMPANY_LIST = ['All Companies']

const ITEMS_PER_PAGE = 10

export const BillsPage: React.FC = () => {
  const { user } = useSession()
  const userRole = (user?.role || '').toLowerCase()
  const isAudit = userRole === 'audit' || userRole.includes('auditor')
  const isAdmin = userRole === 'admin' || isAudit
  const isFinance = userRole === 'finance'
  const isCompanyScoped = !isAdmin && !isFinance
  const assignedCompany = user?.assignedCompany || ''

  // Data states
  const [bills, setBills] = React.useState<BillItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [companyList, setCompanyList] = React.useState<string[]>(DEFAULT_COMPANY_LIST)

  const { activeCompany, setActiveCompany } = useCompany()

  // Filters
  const [selectedCompany, setSelectedCompany] = React.useState<string>(
    isCompanyScoped ? assignedCompany : (activeCompany || 'All Companies')
  )

  React.useEffect(() => {
    if (!isCompanyScoped && activeCompany) {
      setSelectedCompany(activeCompany)
    }
  }, [activeCompany, isCompanyScoped])

  const [statusFilter, setStatusFilter] = React.useState<'All' | BillStatus>('All')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [currentPage, setCurrentPage] = React.useState(1)

  // Dropdowns
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false)
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = React.useState(false)
  const [companySearch, setCompanySearch] = React.useState('')

  const exportDropdownRef = React.useRef<HTMLDivElement>(null)
  const companyDropdownRef = React.useRef<HTMLDivElement>(null)
  const statusDropdownRef = React.useRef<HTMLDivElement>(null)
  const tableCardRef = React.useRef<HTMLDivElement>(null)

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false)
  const [editingBill, setEditingBill] = React.useState<BillItem | null>(null)
  const [paymentBill, setPaymentBill] = React.useState<BillItem | null>(null)
  const [deleteConfirmBill, setDeleteConfirmBill] = React.useState<BillItem | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [highlightedBillId, setHighlightedBillId] = React.useState<string | null>(null)
  const [openMenuBillId, setOpenMenuBillId] = React.useState<string | null>(null)
  const [menuPosition, setMenuPosition] = React.useState<{
    top: number
    right: number
    openUpward?: boolean
  } | null>(null)
  const [activeMenuBill, setActiveMenuBill] = React.useState<BillItem | null>(null)

  // Close portal action menu on outside click, window scroll or resize
  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.bill-portal-menu') && !target.closest('.bill-action-btn') && !target.closest('.bill-action-menu')) {
        setOpenMenuBillId(null)
        setMenuPosition(null)
        setActiveMenuBill(null)
      }
    }
    const handleScrollOrResize = () => {
      setOpenMenuBillId(null)
      setMenuPosition(null)
      setActiveMenuBill(null)
    }

    if (openMenuBillId) {
      document.addEventListener('mousedown', handleOutsideClick)
      window.addEventListener('scroll', handleScrollOrResize, true)
      window.addEventListener('resize', handleScrollOrResize)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [openMenuBillId])

  const { billId } = useParams<{ billId?: string }>()
  const navigate = useNavigate()

  // Dedicated bill details page state
  const [selectedDetailBill, setSelectedDetailBill] = React.useState<BillItem | null>(null)

  // Sync selectedDetailBill with URL billId
  React.useEffect(() => {
    if (billId && bills.length > 0) {
      const found = bills.find((b) => b.id === billId)
      if (found) {
        setSelectedDetailBill(found)
      }
    } else if (!billId) {
      setSelectedDetailBill(null)
    }
  }, [billId, bills])

  const handleBackToBills = () => {
    setSelectedDetailBill(null)
    navigate('/bills')
  }

  // Sync assigned company if scoped
  React.useEffect(() => {
    if (isCompanyScoped && user?.assignedCompany) {
      setSelectedCompany(user.assignedCompany)
    }
  }, [isCompanyScoped, user?.assignedCompany])

  // Load companies
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
  }, [])

  // Load bills
  const loadBills = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await billsService.getBills()
      setBills(data)
    } catch (err: any) {
      console.error('Failed to load bills:', err)
      setLoadError(formatUserFriendlyErrorMessage(err, 'Unable to load bills. Please try again.'))
      setBills([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleMarkBillAudit = (bill: BillItem, status: 'Verified' | 'Flagged') => {
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const updated: BillItem = {
      ...bill,
      auditStatus: status,
      auditDate: timestamp,
      auditedBy: user?.fullName,
    }
    setBills((prev) => prev.map((item) => (item.id === bill.id ? updated : item)))
    if (selectedDetailBill?.id === bill.id) {
      setSelectedDetailBill(updated)
    }
    setOpenMenuBillId(null)
    setMenuPosition(null)
    setActiveMenuBill(null)
  }

  React.useEffect(() => {
    loadBills()
  }, [loadBills])

  // Close dropdowns on outside click
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) {
        setIsExportDropdownOpen(false)
      }
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(target)) {
        setIsCompanyDropdownOpen(false)
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setIsStatusDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Active filtered bills
  const filteredBills = React.useMemo(() => {
    return bills.filter((bill) => {
      // Company filter
      if (selectedCompany !== 'All Companies') {
        const matchesCompany = isCompanyMatch(bill.company, selectedCompany)
        if (!matchesCompany) return false
      }

      // Status filter
      if (statusFilter !== 'All') {
        if (bill.status !== statusFilter) return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = bill.billerName.toLowerCase().includes(q)
        const matchComp = bill.company.toLowerCase().includes(q)
        const matchNotes = (bill.notes || '').toLowerCase().includes(q)
        if (!matchName && !matchComp && !matchNotes) {
          return false
        }
      }

      return true
    }).sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      if (timeA !== timeB) return timeB - timeA
      const idA = parseInt(a.id, 10) || 0
      const idB = parseInt(b.id, 10) || 0
      return idB - idA
    })
  }, [bills, selectedCompany, statusFilter, searchQuery])

  // KPI stats for current company scope
  const scopedBills = React.useMemo(() => {
    if (selectedCompany === 'All Companies') return bills
    return bills.filter((b) => isCompanyMatch(b.company, selectedCompany))
  }, [bills, selectedCompany])

  const stats = React.useMemo(() => {
    return billsService.getStats(scopedBills)
  }, [scopedBills])

  // Active reminders
  const reminders = React.useMemo<BillReminder[]>(() => {
    return billsService.getReminders(scopedBills)
  }, [scopedBills])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredBills.length / ITEMS_PER_PAGE))
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredBills.length)
  const paginatedBills = React.useMemo(() => {
    return filteredBills.slice(startIndex, endIndex)
  }, [filteredBills, startIndex, endIndex])

  // Reset page when filter changes
  React.useEffect(() => {
    setCurrentPage(1)
  }, [selectedCompany, statusFilter, searchQuery])

  // Handlers
  const handleBillCreated = (newBill: BillItem) => {
    setBills((prev) => {
      const exists = prev.some((b) => b.id === newBill.id)
      return exists ? prev.map((b) => (b.id === newBill.id ? newBill : b)) : [newBill, ...prev]
    })
    setHighlightedBillId(newBill.id)
    setTimeout(() => setHighlightedBillId(null), 4000)

    // If active company filter doesn't match the new bill, reset to All Companies so it is immediately visible
    if (selectedCompany !== 'All Companies' && !isCompanyMatch(newBill.company, selectedCompany)) {
      setSelectedCompany('All Companies')
      setActiveCompany('All Companies')
    }
    // Clear filters that could hide the newly created bill
    setStatusFilter('All')
    setSearchQuery('')
    setCurrentPage(1)

    // Re-sync with backend to get latest generated records and relations
    loadBills()

    tableCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleBillUpdated = (updated: BillItem) => {
    setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
    if (selectedDetailBill?.id === updated.id) {
      setSelectedDetailBill(updated)
    }
    setHighlightedBillId(updated.id)
    setTimeout(() => setHighlightedBillId(null), 3000)
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirmBill) return
    try {
      setIsDeleting(true)
      await billsService.deleteBill(deleteConfirmBill.id)
      setBills((prev) => prev.filter((b) => b.id !== deleteConfirmBill.id))
      if (selectedDetailBill?.id === deleteConfirmBill.id) {
        setSelectedDetailBill(null)
        navigate('/bills')
      }
      setDeleteConfirmBill(null)
    } catch (err: any) {
      alert(formatUserFriendlyErrorMessage(err, 'Unable to delete bill. Please try again.'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRowClick = (bill: BillItem) => {
    setSelectedDetailBill(bill)
    navigate(`/bills/${bill.id}`)
  }

  const handleExportCsv = () => {
    try {
      const compName = isCompanyScoped ? assignedCompany : selectedCompany
      billsService.exportCsv(
        filteredBills,
        `monthly_bills_${compName.replace(/\s+/g, '_')}_${Date.now()}.csv`
      )
    } catch (err: any) {
      alert(formatUserFriendlyErrorMessage(err, 'Unable to export bills to CSV. Please try again.'))
    } finally {
      setIsExportDropdownOpen(false)
    }
  }

  const handleExportPdf = () => {
    setIsExportDropdownOpen(false)
    try {
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Please allow pop-ups in your browser to export the Bills PDF.')
        return
      }
      const companyTitle = isCompanyScoped ? assignedCompany : selectedCompany
      const rowsHtml =
        filteredBills.length === 0
          ? `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No bills found matching the selected filters.</td></tr>`
          : filteredBills
            .map(
              (b) => `
          <tr>
            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${b.billerName}</td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${b.company}</td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: 600;">₱${b.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${b.dueDate}</td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${b.billingCycle}</td>
            <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${b.status}</td>
          </tr>
        `
            )
            .join('')

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Bills Report - ${companyTitle}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding: 24px; }
              h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; color: #960C01; }
              p { font-size: 12px; color: #64748B; margin: 0 0 16px 0; }
              table { width: 100%; border-collapse: collapse; margin-top: 12px; }
              th { background-color: #F8FAFC; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B; border-bottom: 2px solid #CBD5E1; }
              .summary { margin-top: 20px; padding: 12px 16px; background-color: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 12px; }
              @media print {
                body { padding: 10px; }
                @page { size: landscape; margin: 10mm; }
              }
            </style>
          </head>
          <body>
            <h1>MCT Group of Companies</h1>
            <p>Bills Report for <strong>${companyTitle}</strong> · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
            <table>
              <thead>
                <tr>
                  <th>Biller Name</th>
                  <th>Company</th>
                  <th style="text-align: right;">Amount</th>
                  <th style="text-align: center;">Due Date</th>
                  <th style="text-align: center;">Cycle</th>
                  <th style="text-align: center;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <div class="summary">
              <div><strong>Total Records:</strong> ${filteredBills.length}</div>
              <div><strong>Total Payable:</strong> ₱${stats.totalMonthlyAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
              <div><strong>Total Paid:</strong> ₱${stats.paidAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
              <div><strong>Overdue / Unpaid:</strong> ₱${(stats.overdueAmount + stats.unpaidAmount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            </div>
            <script>
              window.onload = function() {
                window.print();
              };
            </script>
          </body>
        </html>
      `)
      printWindow.document.close()
    } catch (err: any) {
      alert(formatUserFriendlyErrorMessage(err, 'Unable to generate Bills PDF report. Please try again.'))
    }
  }

  const filteredCompanyList = React.useMemo(() => {
    if (!companySearch.trim()) return companyList
    return companyList.filter((c) =>
      c.toLowerCase().includes(companySearch.toLowerCase().trim())
    )
  }, [companySearch, companyList])

  const displayedCompanyTitle = isCompanyScoped
    ? assignedCompany
    : selectedCompany === 'All Companies'
      ? 'All Subsidiaries'
      : selectedCompany

  if (loading && billId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#960C01] border-t-transparent" />
          <span className="text-xs font-semibold text-muted-fg animate-pulse">Loading bill details...</span>
        </div>
      </div>
    )
  }

  if (!loading && billId && !selectedDetailBill) {
    return (
      <div className="max-w-[800px] mx-auto py-16 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
          <Receipt className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-focus">Bill Not Found</h2>
        <p className="text-sm text-muted-fg">The requested bill may have been removed or does not exist.</p>
        <Button onClick={handleBackToBills} className="rounded-xl bg-[#960C01] hover:bg-[#800a01] text-white text-xs font-semibold cursor-pointer">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Bills
        </Button>
      </div>
    )
  }

  if (selectedDetailBill) {
    return (
      <>
        <BillDetailPageView
          bill={selectedDetailBill}
          onBack={handleBackToBills}
          onPay={() => setPaymentBill(selectedDetailBill)}
          onEdit={() => setEditingBill(selectedDetailBill)}
          onDelete={() => setDeleteConfirmBill(selectedDetailBill)}
          onMarkAudit={(status) => handleMarkBillAudit(selectedDetailBill, status)}
          isAudit={isAudit}
        />

        <EditBillModal
          open={Boolean(editingBill)}
          onOpenChange={(open) => !open && setEditingBill(null)}
          bill={editingBill}
          onSuccess={handleBillUpdated}
          isCompanyScoped={isCompanyScoped}
          companies={companyList}
        />

        <RecordBillPaymentModal
          open={Boolean(paymentBill)}
          onOpenChange={(open) => !open && setPaymentBill(null)}
          bill={paymentBill}
          onBillPaid={handleBillUpdated}
        />

        <Dialog
          open={Boolean(deleteConfirmBill)}
          onOpenChange={(open) => !open && setDeleteConfirmBill(null)}
        >
          <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto p-6 rounded-[24px] bg-white border border-neutral-200 shadow-2xl">
            <DialogHeader>
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-2">
                <Trash2 className="w-5 h-5" />
              </div>
              <DialogTitle className="text-lg font-bold text-neutral-900">
                Delete Monthly Bill?
              </DialogTitle>
              <DialogDescription className="text-xs text-neutral-600 mt-1">
                Are you sure you want to delete the bill for{' '}
                <strong className="text-neutral-800">{deleteConfirmBill?.billerName}</strong> (
                {deleteConfirmBill?.company})? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmBill(null)}
                className="rounded-xl h-10 px-4 text-xs font-semibold border-neutral-200 hover:bg-neutral-100 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="rounded-xl h-10 px-5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete Bill'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300">
      {/* 1. Header & Controls */}
      <div className="space-y-4">
        {/* Top Header Row: Page Title on Left, Action Buttons on Right */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
                Company Bills
              </h1>
            </div>
            <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
              Track recurring utility, rental, and scheduled bills for {displayedCompanyTitle} with automated due date reminders and payment history.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 self-start shrink-0">
            {/* Export Dropdown Button */}
            <div ref={exportDropdownRef} className="relative inline-block">
              <Button
                type="button"
                variant={isAudit ? 'default' : 'outline'}
                onClick={() => {
                  setIsExportDropdownOpen((prev) => !prev)
                  setIsStatusDropdownOpen(false)
                  setIsCompanyDropdownOpen(false)
                }}
                className={cn(
                  'h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border',
                  isAudit
                    ? 'bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white'
                    : 'border border-stroke/50 bg-white text-focus hover:bg-surface'
                )}
                aria-haspopup="true"
                aria-expanded={isExportDropdownOpen}
              >
                <Download className={cn('h-4 w-4 shrink-0', isAudit ? 'text-white' : 'text-focus/70')} />
                <span>Export</span>
                <ChevronDown className={cn('h-3.5 w-3.5 ml-0.5', isAudit ? 'text-white/90' : 'text-muted-fg')} />
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

            {/* Add Bill Button (Hidden for Audit) */}
            {!isAudit && (
              <Button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer box-border"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>Add Bill</span>
              </Button>
            )}
          </div>
        </div>

        {/* Second Row: Search Bar & Filter Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
          {/* Extended Width Search Bar — Fills available space while keeping company name uncropped */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
            <Input
              type="search"
              placeholder="Search by biller, company, or notes…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 self-start lg:self-auto shrink-0">
            {/* Status Filter */}
            <div ref={statusDropdownRef} className="relative inline-block shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsStatusDropdownOpen((prev) => !prev)
                  setIsCompanyDropdownOpen(false)
                  setIsExportDropdownOpen(false)
                }}
                className={cn(
                  'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                  isStatusDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                )}
              >
                <span className="font-medium text-focus/90">
                  {statusFilter === 'All' ? 'Status: All' : statusFilter}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-fg shrink-0" />
              </button>

              {isStatusDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl border border-stroke/30 shadow-2xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                  {(['All', 'Due Soon', 'Overdue', 'Unpaid', 'Partially Paid', 'Paid'] as const).map((st) => (
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
                      {statusFilter === st && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Company Filter (Locked for Supervisor, dropdown for Finance/Admin) */}
            {isCompanyScoped ? (
              <div className="inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-slate-50 text-focus text-xs sm:text-sm font-medium shadow-xs shrink-0 whitespace-nowrap">
                <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
                <span className="font-semibold text-focus/90">
                  {assignedCompany}
                </span>
              </div>
            ) : (
              <div ref={companyDropdownRef} className="relative inline-block shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsCompanyDropdownOpen((prev) => !prev)
                    setIsStatusDropdownOpen(false)
                    setIsExportDropdownOpen(false)
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 h-11 px-4 rounded-full border border-stroke/60 bg-white hover:bg-surface text-focus text-xs sm:text-sm font-medium shadow-xs transition-colors cursor-pointer select-none box-border whitespace-nowrap shrink-0',
                    isCompanyDropdownOpen && 'ring-2 ring-slate-100 border-slate-300'
                  )}
                >
                  <Building2 className="h-4 w-4 text-muted-fg shrink-0" />
                  <span className="font-medium text-focus/90">
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
                        Filter by Company
                      </span>
                    </div>

                    <div className="px-1 mb-2">
                      <div className="relative">
                        <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
                        <input
                          type="text"
                          placeholder="Search company..."
                          value={companySearch}
                          onChange={(e) => setCompanySearch(e.target.value)}
                          className="w-full pl-8 pr-2.5 py-1.5 bg-surface rounded-xl text-xs border border-stroke/40 focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-0.5">
                      {filteredCompanyList.map((c) => (
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
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>


      {/* 3. Due Date Reminders Banner (Alert section) */}
      {reminders.length > 0 && (
        <Card className="rounded-[20px] bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-red-500/10 border border-amber-200/70 p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#960C01] text-white flex items-center justify-center shrink-0">
                <BellRing className="w-4 h-4 animate-bounce" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-neutral-900 tracking-tight">
                  Due Date Reminders & Alerts
                </h4>
                <p className="text-2xs text-neutral-600">
                  {reminders.length} bill{reminders.length > 1 ? 's' : ''} require attention for payment settlement
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
              Action Required
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {reminders.slice(0, 6).map((rem) => {
              const isOverdue = rem.type === 'overdue'
              const isToday = rem.type === 'due_today'

              return (
                <div
                  key={rem.bill.id}
                  className={cn(
                    'p-3 rounded-xl border flex items-center justify-between gap-3 transition-all',
                    isOverdue
                      ? 'bg-rose-50/90 border-rose-200 text-rose-900'
                      : isToday
                        ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                        : 'bg-white border-neutral-200 text-neutral-800'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs truncate">{rem.bill.billerName}</span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.2 rounded font-semibold shrink-0',
                          isOverdue
                            ? 'bg-rose-600 text-white'
                            : isToday
                              ? 'bg-amber-600 text-white'
                              : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {isOverdue
                          ? `${rem.daysDiff}d Overdue`
                          : isToday
                            ? 'DUE TODAY'
                            : `Due in ${rem.daysDiff}d`}
                      </span>
                    </div>
                    <div className="text-[11px] opacity-75 mt-0.5 flex items-center gap-1.5">
                      <span>{rem.bill.company}</span>
                      <span>•</span>
                      <span className="font-semibold">
                        {rem.bill.latestAmount && rem.bill.latestAmount > 0
                          ? formatPHP(rem.bill.latestAmount)
                          : rem.bill.amount && rem.bill.amount > 0
                          ? formatPHP(rem.bill.amount)
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {!isAudit && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setPaymentBill(rem.bill)}
                      className={cn(
                        'h-7 px-2.5 rounded-lg text-xs font-semibold shrink-0 shadow-2xs',
                        isOverdue
                          ? 'bg-rose-600 hover:bg-rose-700 text-white'
                          : 'bg-[#960C01] hover:bg-[#800a01] text-white'
                      )}
                    >
                      Pay
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* 4. Bills Summary Table Container */}
      <Card
        ref={tableCardRef}
        className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs scroll-mt-6"
      >
        {/* Table View */}
        <div className="w-full rounded-xl border border-slate-100 overflow-hidden">
          <Table containerClassName="overflow-hidden" className="w-full table-fixed">
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 hover:bg-transparent">
                <TableHead className="w-[28%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-left">
                  BILLER
                </TableHead>
                <TableHead className="w-[22%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  COMPANY
                </TableHead>
                <TableHead className="w-[18%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  LATEST BILLED / PAID
                </TableHead>
                <TableHead className="w-[16%] px-3.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  DUE DATE
                </TableHead>
                <TableHead className="w-[11%] px-2.5 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  STATUS
                </TableHead>
                <TableHead className="w-[5%] px-1 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-center">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={idx} className="border-b border-slate-100">
                    <TableCell className="px-3 py-4 text-left">
                      <div className="h-4 w-28 bg-slate-200/80 animate-pulse rounded" />
                    </TableCell>
                    <TableCell className="px-3 py-4 text-center">
                      <div className="h-4 w-24 bg-slate-200/80 animate-pulse rounded mx-auto" />
                    </TableCell>
                    <TableCell className="px-3 py-4 text-center">
                      <div className="h-4 w-20 bg-slate-200/80 animate-pulse rounded mx-auto" />
                    </TableCell>
                    <TableCell className="px-3 py-4 text-center">
                      <div className="h-4 w-16 bg-slate-200/70 animate-pulse rounded mx-auto" />
                    </TableCell>
                    <TableCell className="px-2.5 py-4 text-center">
                      <div className="h-5 w-16 bg-slate-200/60 animate-pulse rounded-full mx-auto" />
                    </TableCell>
                    <TableCell className="px-1 py-4 text-center">
                      <div className="h-6 w-6 bg-slate-200/60 animate-pulse rounded-md mx-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : loadError ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-14 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-[#960C01]/10 flex items-center justify-center text-[#960C01] mb-1">
                        <AlertCircle className="w-6 h-6 stroke-[1.5]" />
                      </div>
                      <p className="font-semibold text-focus text-sm sm:text-base">
                        Failed to load bill records
                      </p>
                      <p className="text-xs text-[#960C01] leading-relaxed">
                        {loadError}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={loadBills}
                        className="mt-2 text-xs font-semibold rounded-xl"
                      >
                        Try Again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginatedBills.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-14 text-center text-xs sm:text-sm text-muted-fg"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-1">
                        <AlertCircle className="w-6 h-6 stroke-[1.5]" />
                      </div>
                      <p className="font-semibold text-focus text-sm sm:text-base">
                        No bill records found
                      </p>
                      <p className="text-xs text-muted-fg leading-relaxed">
                        There are no monthly bills recorded for {displayedCompanyTitle} matching your current filters.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedBills.map((bill) => {
                  const isHighlighted = highlightedBillId === bill.id
                  const isPaid = bill.status === 'Paid'
                  const isOverdue = bill.status === 'Overdue'
                  const isDueSoon = bill.status === 'Due Soon'

                  return (
                    <TableRow
                      key={bill.id}
                      id={`bill-row-${bill.id}`}
                      onClick={() => handleRowClick(bill)}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/60 transition-all duration-300 cursor-pointer',
                        isHighlighted &&
                        'bg-amber-100/90 hover:bg-amber-100/90 ring-2 ring-amber-500 shadow-md font-semibold'
                      )}
                      title="Click to view complete bill details"
                    >
                      {/* Biller Name */}
                      <TableCell className="w-[28%] px-3 py-3.5 text-xs text-left truncate">
                        <span className="font-semibold text-xs sm:text-sm text-focus truncate block" title={bill.billerName}>
                          {bill.billerName}
                        </span>
                      </TableCell>

                      {/* Company */}
                      <TableCell
                        className="w-[22%] px-3 py-3.5 text-xs font-semibold text-focus truncate text-center"
                        title={bill.company}
                      >
                        <div className="flex items-center justify-center gap-1.5 min-w-0 truncate">
                          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate">{bill.company}</span>
                        </div>
                      </TableCell>

                      {/* Latest Billed / Paid Amount & Recurrence */}
                      <TableCell className="w-[18%] px-3 py-3.5 text-xs font-bold text-focus tabular-nums text-center truncate">
                        <div className="truncate text-center">
                          {bill.latestAmount && bill.latestAmount > 0
                            ? formatPHP(bill.latestAmount)
                            : bill.amount && bill.amount > 0
                            ? formatPHP(bill.amount)
                            : '—'}
                        </div>
                        <div className="text-[10px] font-normal truncate mt-0.5 flex justify-center">
                          {bill.billingCycle === 'Daily' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                              Daily
                            </span>
                          ) : bill.billingCycle === 'Yearly' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200/60">
                              Yearly (Annual)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                              Monthly (Every {bill.dueDayOfMonth || (bill.dueDate ? parseInt(bill.dueDate.slice(8, 10), 10) : 1)})
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Due Date & Reminder */}
                      <TableCell className="w-[16%] px-3 py-3.5 text-xs text-center truncate">
                        <div className="flex flex-col items-center justify-center min-w-0">
                          <span className="font-semibold text-focus truncate">{formatDisplayDate(bill.dueDate)}</span>
                          <span className="text-[11px] text-amber-600 flex items-center justify-center gap-1 truncate font-medium">
                            <BellRing className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">
                              {bill.billingCycle === 'Daily' ? 'Daily Alert' : `Remind ${bill.reminderDaysBefore}d`}
                            </span>
                          </span>
                        </div>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="w-[11%] px-2.5 py-3.5 text-center truncate">
                        <div className="flex flex-col gap-1 items-center justify-center">
                          {isPaid ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold shadow-2xs">
                              <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>Paid</span>
                            </span>
                          ) : isOverdue ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold shadow-2xs">
                              <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                              <span>Overdue</span>
                            </span>
                          ) : isDueSoon ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold shadow-2xs">
                              <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                              <span>Due Soon</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold shadow-2xs">
                              <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span>Unpaid</span>
                            </span>
                          )}
                          {bill.auditDate && (
                            <span className="text-[10px] text-slate-500 font-normal flex items-center justify-center gap-1" title={`Audited at: ${bill.auditDate}`}>
                              <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="truncate max-w-[110px]">{bill.auditDate}</span>
                            </span>
                          )}
                          {bill.auditStatus && (
                            <span className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold w-fit",
                              bill.auditStatus === 'Verified' ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80" : "bg-amber-50 text-amber-700 border border-amber-200/80"
                            )}>
                              {bill.auditStatus === 'Verified' ? 'Audited' : 'Discrepancy'}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Actions: 3 dots button with Edit and Delete choices (Delete removed for Audit) */}
                      <TableCell
                        className="w-[5%] px-1 py-3.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (openMenuBillId === bill.id) {
                              setOpenMenuBillId(null)
                              setMenuPosition(null)
                              setActiveMenuBill(null)
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect()
                              const openUpward = rect.bottom + 120 > window.innerHeight
                              setMenuPosition({
                                top: openUpward ? rect.top - 6 : rect.bottom + 6,
                                right: Math.max(12, window.innerWidth - rect.right),
                                openUpward,
                              })
                              setActiveMenuBill(bill)
                              setOpenMenuBillId(bill.id)
                            }
                          }}
                          className="bill-action-btn h-8 w-8 p-0 rounded-lg text-muted-fg hover:text-focus hover:bg-slate-100 cursor-pointer mx-auto flex items-center justify-center"
                          title="Actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer (Matching Sales table reference) */}
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          {/* Left: Record summary */}
          <span className="font-medium text-focus/80">
            {filteredBills.length === 0
              ? 'Showing 0 of 0 records'
              : `Showing ${startIndex + 1}-${endIndex} of ${filteredBills.length} records`}
          </span>

          {/* Right: Page Indicator & Navigation */}
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
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40"
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
              className="h-8 w-8 p-0 flex items-center justify-center rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Floating Action Menu Portal (rendered directly to body to prevent table overflow clipping) */}
      {openMenuBillId && (activeMenuBill || bills.some((item) => item.id === openMenuBillId)) && menuPosition && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="bill-portal-menu bill-action-menu fixed w-48 bg-white rounded-xl border border-slate-200 shadow-2xl p-1.5 z-[99999] animate-in fade-in-50 zoom-in-95 duration-150"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
              transform: menuPosition.openUpward ? 'translateY(-100%)' : 'none',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {isAudit ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const b = activeMenuBill || bills.find((item) => item.id === openMenuBillId)
                    if (b) handleMarkBillAudit(b, 'Verified')
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors text-left cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Mark as Audit</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const b = activeMenuBill || bills.find((item) => item.id === openMenuBillId)
                    if (b) handleMarkBillAudit(b, 'Flagged')
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors text-left cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Mark as Discrepancy</span>
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const b = activeMenuBill || bills.find((item) => item.id === openMenuBillId)
                    setOpenMenuBillId(null)
                    setMenuPosition(null)
                    setActiveMenuBill(null)
                    if (b) handleRowClick(b)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-slate-500" />
                  <span>View Details</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const b = activeMenuBill || bills.find((item) => item.id === openMenuBillId)
                    setOpenMenuBillId(null)
                    setMenuPosition(null)
                    setActiveMenuBill(null)
                    if (b) handleRowClick(b)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-muted-fg" />
                  <span>View Details</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const b = activeMenuBill || bills.find((item) => item.id === openMenuBillId)
                    setOpenMenuBillId(null)
                    setMenuPosition(null)
                    setActiveMenuBill(null)
                    if (b) setEditingBill(b)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-focus hover:bg-slate-50 transition-colors text-left cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-fg" />
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const b = activeMenuBill || bills.find((item) => item.id === openMenuBillId)
                    setOpenMenuBillId(null)
                    setMenuPosition(null)
                    setActiveMenuBill(null)
                    if (b) setDeleteConfirmBill(b)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>,
          document.body
        )}

      {/* Modals */}
      {/* 1. Add Bill Modal */}
      <AddBillModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onSuccess={handleBillCreated}
        assignedCompany={assignedCompany}
        isCompanyScoped={isCompanyScoped}
        companies={companyList}
      />

      {/* 2. Edit Bill Modal */}
      <EditBillModal
        open={Boolean(editingBill)}
        onOpenChange={(open) => !open && setEditingBill(null)}
        bill={editingBill}
        onSuccess={handleBillUpdated}
        isCompanyScoped={isCompanyScoped}
        companies={companyList}
      />

      {/* 3. Record Bill Payment Modal */}
      <RecordBillPaymentModal
        open={Boolean(paymentBill)}
        onOpenChange={(open) => !open && setPaymentBill(null)}
        bill={paymentBill}
        onBillPaid={handleBillUpdated}
      />



      {/* 5. Delete Confirmation Modal */}
      <Dialog
        open={Boolean(deleteConfirmBill)}
        onOpenChange={(open) => !open && setDeleteConfirmBill(null)}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto p-6 rounded-[24px] bg-white border border-neutral-200 shadow-2xl">
          <DialogHeader>
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-2">
              <Trash2 className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg font-bold text-neutral-900">
              Delete Monthly Bill?
            </DialogTitle>
            <DialogDescription className="text-xs text-neutral-600 mt-1">
              Are you sure you want to delete the bill for{' '}
              <strong className="text-neutral-800">{deleteConfirmBill?.billerName}</strong> (
              {deleteConfirmBill?.company})? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setDeleteConfirmBill(null)}
              className="rounded-xl h-10 px-4 text-xs font-semibold border-neutral-200 hover:bg-neutral-100"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
              className="rounded-xl h-10 px-5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20"
            >
              {isDeleting ? 'Deleting...' : 'Delete Bill'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
