import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { getParticularsSummary } from '@/utils/particularsUtils'
import type { DashboardTransactionItem } from '@/services/dashboardService'

export type { DashboardTransactionItem as DashboardTransaction }

const ITEMS_PER_PAGE = 10

interface RecentTransactionsCardProps {
  className?: string
  companyName?: string
  transactions?: DashboardTransactionItem[]
  readOnly?: boolean
}

export const RecentTransactionsCard: React.FC<RecentTransactionsCardProps> = ({
  className,
  companyName = 'MCT Kitchen',
  transactions = [],
}) => {
  const navigate = useNavigate()
  const [selectedTx, setSelectedTx] = React.useState<DashboardTransactionItem | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  // Pagination state: max 10 transactions per page
  const [currentPage, setCurrentPage] = React.useState(1)

  // Reset to page 1 when the date range or transactions change
  React.useEffect(() => {
    setCurrentPage(1)
  }, [transactions])

  // Ensure transactions are sorted latest first
  const sortedTransactions = React.useMemo(() => {
    return [...transactions].sort((a, b) => {
      const dateA = normalizeDateToYYYYMMDD(a.date)
      const dateB = normalizeDateToYYYYMMDD(b.date)
      const cmp = dateB.localeCompare(dateA)
      if (cmp !== 0) return cmp
      return (b.createdAt || b.id).localeCompare(a.createdAt || a.id)
    })
  }, [transactions])

  const totalItems = sortedTransactions.length
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE))
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems)
  const paginatedTransactions = sortedTransactions.slice(startIndex, endIndex)

  const handleOpenAudit = (tx: DashboardTransactionItem) => {
    setSelectedTx(tx)
    setIsModalOpen(true)
  }

  const displayedTitle =
    companyName === 'All Companies' ? 'MCT Group of Companies' : companyName

  return (
    <Card
      className={cn(
        'rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs',
        className
      )}
    >
      {/* 1. Clean Header with Red View All Button */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-focus leading-tight">
            Recent Transactions
          </h2>
          <p className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
            Here's the summary of recent transactions in {displayedTitle}.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => navigate('/transaction')}
          className="h-9 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer transition-colors"
        >
          <span>View All</span>
          <ArrowRight className="h-3.5 w-3.5 text-white" />
        </Button>
      </div>

      {/* 2. Table matching the Sales table columns:
          DATE | CHEQUE NO. | PARTICULARS | WITHDRAWAL | DEPOSIT | CATEGORY | NET AMOUNT
      */}
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                DATE
              </TableHead>
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                CHEQUE NO.
              </TableHead>
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                PARTICULARS
              </TableHead>
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                WITHDRAWAL
              </TableHead>
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                DEPOSIT
              </TableHead>
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg">
                CATEGORY
              </TableHead>
              <TableHead className="px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-muted-fg text-right">
                NET AMOUNT
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {paginatedTransactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-12 text-center text-xs sm:text-sm text-muted-fg"
                >
                  No transactions found for the selected date range.
                </TableCell>
              </TableRow>
            ) : (
              paginatedTransactions.map((tx) => {
                const netAmount = (tx.deposit || 0) - (tx.withdrawal || 0)

                return (
                  <TableRow
                    key={tx.id}
                    onClick={() => handleOpenAudit(tx)}
                    title="Click to view complete details"
                    className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer text-xs"
                  >
                    {/* 1. Date */}
                    <TableCell className="px-4 py-3.5 text-xs font-medium text-focus whitespace-nowrap">
                      {tx.date}
                    </TableCell>

                    {/* 2. Cheque No. */}
                    <TableCell className="px-4 py-3.5 text-xs text-focus/90 whitespace-nowrap font-mono">
                      {tx.chequeNo || '—'}
                    </TableCell>

                    {/* 3. Particulars */}
                    <TableCell className="px-4 py-3.5 text-xs text-focus/90 font-normal max-w-xs" title={tx.particulars || tx.description}>
                      {(() => {
                        const summary = getParticularsSummary(tx.particulars || tx.description, tx.items)
                        if (summary.count > 1) {
                          return (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate block font-medium">{summary.firstItemName}</span>
                              <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                                +{summary.count - 1} more
                              </span>
                            </div>
                          )
                        }
                        return <span className="truncate block font-medium">{summary.firstItemName}</span>
                      })()}
                    </TableCell>

                    {/* 4. Withdrawal */}
                    <TableCell className="px-4 py-3.5 text-xs font-medium text-right tabular-nums whitespace-nowrap text-muted-fg">
                      {tx.withdrawal > 0 ? formatPHP(tx.withdrawal) : ''}
                    </TableCell>

                    {/* 5. Deposit */}
                    <TableCell className="px-4 py-3.5 text-xs font-semibold text-right tabular-nums whitespace-nowrap text-emerald-600">
                      {tx.deposit > 0 ? formatPHP(tx.deposit) : ''}
                    </TableCell>

                    {/* 6. Category (Clean text per Sales table reference) */}
                    <TableCell className="px-4 py-3.5 text-xs text-focus/90 font-medium whitespace-nowrap">
                      {tx.category}
                    </TableCell>

                    {/* 7. Net Amount */}
                    <TableCell className="px-4 py-3.5 text-xs font-bold text-right tabular-nums whitespace-nowrap text-focus">
                      {formatPHP(netAmount)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 3. Pagination Footer matching Sales table */}
      <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
        {/* Left: Record summary */}
        <span className="font-medium text-focus/80">
          {totalItems === 0
            ? 'Showing 0 of 0 records'
            : `Showing ${startIndex + 1}-${endIndex} of ${totalItems} records`}
        </span>

        {/* Right: Page Indicator & Navigation without words Previous and Next */}
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

      {/* 4. Complete Read-Only Transaction Details Modal */}
      <AuditTransactionModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        transaction={selectedTx}
      />
    </Card>
  )
}
