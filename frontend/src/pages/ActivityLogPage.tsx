import * as React from 'react'
import {
  Search,
  Download,
  RotateCw,
  Clock,
  FilterX,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Copy,
  Check,
  Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  ErrorBanner,
  TableEmptyState,
  TableErrorState,
  TablePagination,
  TableSkeleton,
} from '@/components/common'
import { DateRangeFilter, type DateRange } from '@/components/employee/DateRangeFilter'
import { ActivityLogDetailDrawer } from '@/components/admin/ActivityLogDetailDrawer'
import { activityLogService, type ActivityLogItem } from '@/services/activityLogService'
import { formatRealName } from '@/utils/formatRealName'
import { escapeHtml, csvCell } from '@/utils/exportSafety'
import {
  formatUserFriendlyErrorMessage,
  notifyError,
  notifyWarning,
  notifySuccess,
} from '@/utils/errorUtils'

// Helper to parse date string like "Oct 6, 2026 · 9:15 AM" or "2026-10-05 08:14"
function parseDateForFilter(dateStr: string): Date | null {
  if (!dateStr) return null
  const datePart = dateStr.includes('·')
    ? dateStr.split('·')[0].trim()
    : dateStr.split(' ')[0].trim()
  const parsed = Date.parse(datePart)
  if (!isNaN(parsed)) return new Date(parsed)
  return null
}

// Log values come from the database
export const ActivityLogPage: React.FC = () => {
  const [logs, setLogs] = React.useState<ActivityLogItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [dateRange, setDateRange] = React.useState<DateRange>({
    startDate: null,
    endDate: null,
    label: 'All Dates',
  })

  // Drawer inspection state
  const [selectedLog, setSelectedLog] = React.useState<ActivityLogItem | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false)

  // Copy IP feedback state
  const [copiedIpId, setCopiedIpId] = React.useState<string | null>(null)

  const handleCopyIp = async (logId: string, ip: string) => {
    if (!ip || ip === '-') return
    try {
      await navigator.clipboard.writeText(ip)
      setCopiedIpId(logId)
      notifySuccess('IP address copied to clipboard')
      setTimeout(() => setCopiedIpId(null), 2000)
    } catch {
      // Fallback
    }
  }

  // Export dropdown state
  const [isExportDropdownOpen, setIsExportDropdownOpen] = React.useState(false)
  const exportDropdownRef = React.useRef<HTMLDivElement>(null)

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)
  const itemsPerPage = 10

  // Close export dropdown on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        exportDropdownRef.current &&
        !exportDropdownRef.current.contains(e.target as Node)
      ) {
        setIsExportDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchLogs = React.useCallback(async () => {
    try {
      const data = await activityLogService.getActivityLogs()
      setLogs(data)
      setLoadError('')
    } catch (err) {
      setLoadError(
        formatUserFriendlyErrorMessage(
          err,
          'Could not load the activity log. Please try again.'
        )
      )
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    setLoading(true)
    fetchLogs()
  }, [fetchLogs])

  // Real-time synchronization via WebSockets
  React.useEffect(() => {
    const unsubscribe = activityLogService.subscribeToActivityLogs(() => {
      fetchLogs()
    })
    return () => unsubscribe()
  }, [fetchLogs])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await fetchLogs()
    } catch (err) {
      setLoadError(
        formatUserFriendlyErrorMessage(
          err,
          'Could not refresh activity logs. Please try again.'
        )
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  // Filter logs by search and date range
  const filteredLogs = React.useMemo(() => {
    let result = logs

    // Search query
    const q = searchQuery.toLowerCase().trim()
    if (q) {
      result = result.filter(
        (l) =>
          l.company.toLowerCase().includes(q) ||
          l.user.toLowerCase().includes(q) ||
          l.action.toLowerCase().includes(q) ||
          l.module.toLowerCase().includes(q) ||
          l.target.toLowerCase().includes(q) ||
          (l.recordRef && l.recordRef.toLowerCase().includes(q)) ||
          l.ipAddress.toLowerCase().includes(q) ||
          l.time.toLowerCase().includes(q)
      )
    }

    // Date range filter
    if (dateRange.startDate && dateRange.endDate) {
      const start = new Date(`${dateRange.startDate}T00:00:00`)
      const end = new Date(`${dateRange.endDate}T23:59:59`)
      result = result.filter((l) => {
        const lDate = parseDateForFilter(l.time)
        if (!lDate) return true
        return lDate >= start && lDate <= end
      })
    }

    return result
  }, [logs, searchQuery, dateRange])

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = Math.min(startIndex + itemsPerPage, filteredLogs.length)
  const displayedLogs = React.useMemo(
    () => filteredLogs.slice(startIndex, endIndex),
    [filteredLogs, startIndex, endIndex]
  )

  const handleClearFilters = () => {
    setSearchQuery('')
    setDateRange({ startDate: null, endDate: null, label: 'All Dates' })
    setCurrentPage(1)
  }

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    (dateRange.startDate !== null && dateRange.endDate !== null)

  // Export CSV handler
  const handleExportCsv = () => {
    try {
      const headers = [
        'Company',
        'User',
        'Action',
        'Module',
        'Record / Target',
        'Client IP',
        'Severity',
        'Time',
      ]
      const rows = filteredLogs.map((l) => [
        csvCell(l.company),
        csvCell(l.user),
        csvCell(l.action),
        csvCell(l.module),
        csvCell(l.recordRef || l.target || '-'),
        csvCell(l.ipAddress || '-'),
        csvCell(l.severity || 'INFO'),
        csvCell(l.time),
      ])

      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute(
        'download',
        `mct_activity_logs_${new Date().toISOString().slice(0, 10)}.csv`
      )
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      setIsExportDropdownOpen(false)
    } catch (err) {
      notifyError(err, 'Failed to export CSV. Please try again.')
    }
  }

  // Export PDF handler
  const handleExportPdf = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      notifyWarning('Pop-up blocked. Please allow pop-ups for this site to export PDF.')
      return
    }

    const rowsHtml =
      filteredLogs.length === 0
        ? `<tr><td colspan="8" style="padding: 24px; text-align: center; color: #64748B; font-size: 12px; font-style: italic;">No activity logs found for this selection.</td></tr>`
        : filteredLogs
            .map(
              (l) => `
        <tr>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(l.company)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(l.user)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(l.action)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${escapeHtml(l.module)}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-family: monospace;">${escapeHtml(l.recordRef || l.target || '-')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-family: monospace;">${escapeHtml(l.ipAddress || '-')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 600;">${escapeHtml(l.severity || 'INFO')}</td>
          <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748B;">${escapeHtml(l.time)}</td>
        </tr>
      `
            )
            .join('')

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MCT Activity Log Report</title>
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
          <p>System Activity Log Report · Generated on ${new Date().toLocaleDateString('en-PH', { dateStyle: 'full' })}</p>
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>User</th>
                <th>Action</th>
                <th>Module</th>
                <th>Record</th>
                <th>Client IP</th>
                <th>Severity</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <div><strong>Total Activity Records:</strong> ${filteredLogs.length}</div>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
    }, 250)
    setIsExportDropdownOpen(false)
  }

  // Module badge style helper
  const getModuleBadgeStyle = (moduleName: string) => {
    switch (moduleName.toLowerCase()) {
      case 'sales':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
      case 'expense':
        return 'bg-amber-50 text-amber-700 border-amber-200/80'
      case 'loan':
        return 'bg-blue-50 text-blue-700 border-blue-200/80'
      case 'employee':
        return 'bg-purple-50 text-purple-700 border-purple-200/80'
      default:
        return 'bg-surface text-focus/80 border-stroke/30'
    }
  }

  return (
    <div className="space-y-6 w-full max-w-[1600px] mx-auto pb-12">
      {/* 1. Header & Actions Block */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-focus tracking-tight">
            Activity Log
          </h1>
          <p className="text-sm sm:text-base text-muted-fg font-normal mt-1">
            {logs.length} system activity records tracked across all companies · 6-month retention policy
          </p>
        </div>

        {/* Top Right Action Buttons: Refresh, Live Date & Red Export Dropdown */}
        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          {/* Refresh Button */}
          <Button
            type="button"
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl border border-stroke/50 bg-white text-focus hover:bg-surface font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 transition-all cursor-pointer"
            aria-label="Refresh activity logs"
          >
            <RotateCw
              className={`h-4 w-4 text-focus/70 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          {/* Export Button with CSV & PDF options */}
          <div ref={exportDropdownRef} className="relative inline-block">
            <Button
              type="button"
              disabled={filteredLogs.length === 0}
              onClick={() => setIsExportDropdownOpen((prev) => !prev)}
              className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl font-semibold text-xs sm:text-sm shadow-xs flex items-center gap-2 cursor-pointer transition-all box-border bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white disabled:opacity-50"
              aria-haspopup="true"
              aria-expanded={isExportDropdownOpen}
              aria-label="Export activity logs"
            >
              <span>Export</span>
              <ChevronDown className="h-3.5 w-3.5 ml-0.5 text-white/90" />
            </Button>

            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl border border-stroke/30 shadow-xl p-2 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover-item text-left"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Download as CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-focus/90 hover-item text-left"
                >
                  <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Download as PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error alert banner if refreshing or fetching fails */}
      {loadError && logs.length > 0 && (
        <ErrorBanner
          message={loadError}
          onRetry={fetchLogs}
          isRetrying={isRefreshing}
        />
      )}

      {/* 2. Filters Toolbar with Extended Width Search Bar & Date Range Filter */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Extended width search bar */}
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg pointer-events-none" />
          <Input
            type="search"
            placeholder="Search by company, action, module, or target reference..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setCurrentPage(1)
            }}
            className="h-10 sm:h-11 pl-11 pr-4 rounded-full border border-stroke/40 bg-white text-sm text-focus placeholder:text-muted-fg/80 shadow-xs focus-visible:ring-1 focus-visible:ring-focus w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
          {/* Date Range Filter */}
          <DateRangeFilter
            value={dateRange}
            onChange={(newRange) => {
              setDateRange(newRange)
              setCurrentPage(1)
            }}
          />

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="h-10 sm:h-11 px-3 rounded-full text-xs font-semibold text-muted-fg hover:text-focus hover:bg-surface flex items-center gap-1.5 cursor-pointer"
            >
              <FilterX className="h-3.5 w-3.5" />
              <span>Clear</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-[20px] border border-stroke/30 shadow-xs p-4 sm:p-6 lg:p-8">
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full min-w-[980px] text-left">
            <TableHeader>
              <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="px-5 w-[18%] text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Company</TableHead>
                <TableHead className="px-5 w-[18%] text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Action</TableHead>
                <TableHead className="px-4 w-[12%] text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Module</TableHead>
                <TableHead className="px-4 w-[13%] text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Record</TableHead>
                <TableHead className="px-4 w-[15%] text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Client IP</TableHead>
                <TableHead className="px-4 w-[14%] text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Time</TableHead>
                <TableHead className="px-4 w-[10%] text-right text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeleton
                  rows={8}
                  columns={[
                    { width: 'w-32' },
                    { width: 'w-28' },
                    { width: 'w-16', shape: 'pill' },
                    { width: 'w-20' },
                    { width: 'w-24' },
                    { width: 'w-24' },
                    { width: 'w-16' },
                  ]}
                />
              ) : loadError ? (
                <TableErrorState
                  colSpan={7}
                  title="Unable to load activity logs"
                  message={loadError}
                  onRetry={fetchLogs}
                />
              ) : displayedLogs.length === 0 ? (
                <TableEmptyState
                  colSpan={7}
                  icon={Clock}
                  title="No activity logs found"
                  description={
                    hasActiveFilters
                      ? 'No activity logs matched your current search and filter criteria. Try adjusting your query or date range.'
                      : 'No recent system activity records have been recorded yet.'
                  }
                  action={
                    hasActiveFilters ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleClearFilters}
                        className="text-xs font-semibold rounded-lg"
                      >
                        Clear all filters
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                displayedLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="py-4 px-6 text-sm font-medium text-focus whitespace-nowrap">
                      {log.company}
                    </TableCell>
                    <TableCell className="py-4 px-5 text-sm text-focus/90 whitespace-nowrap">
                      <div className="font-medium">{log.action}</div>
                      <div className="text-[11px] text-muted-fg">
                        by {formatRealName(log.user)}
                      </div>
                    </TableCell>
                    <TableCell className="py-4 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getModuleBadgeStyle(
                          log.module
                        )}`}
                      >
                        {log.module}
                      </span>
                    </TableCell>
                    <TableCell className="py-4 px-4 whitespace-nowrap">
                      <span className="font-mono text-xs px-2 py-1 rounded-md bg-surface border border-stroke/30 text-focus/80">
                        {log.recordRef || log.target}
                      </span>
                    </TableCell>
                    <TableCell className="py-4 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-focus/80">
                          {log.ipAddress || '-'}
                        </span>
                        {log.ipAddress && log.ipAddress !== '-' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyIp(log.id, log.ipAddress)
                            }}
                            className="h-7 w-7 p-0 rounded-md text-muted-fg hover:text-focus hover:bg-surface opacity-70 group-hover:opacity-100 transition-opacity"
                            aria-label="Copy IP address"
                          >
                            {copiedIpId === log.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-4 px-4 text-sm text-focus/70 tabular-nums whitespace-nowrap">
                      {log.time}
                    </TableCell>
                    <TableCell className="py-4 px-4 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedLog(log)
                          setIsDrawerOpen(true)
                        }}
                        className="h-8 px-2.5 rounded-lg text-xs font-semibold text-focus/80 hover:text-focus hover:bg-surface border border-stroke/30 inline-flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredLogs.length}
          startIndex={startIndex}
          endIndex={endIndex}
          pageSize={itemsPerPage}
          itemLabel="activity records"
          onPageChange={setCurrentPage}
        />
      </div>

      {/* Activity Log Inspection Detail Drawer */}
      <ActivityLogDetailDrawer
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        log={selectedLog}
      />
    </div>
  )
}
