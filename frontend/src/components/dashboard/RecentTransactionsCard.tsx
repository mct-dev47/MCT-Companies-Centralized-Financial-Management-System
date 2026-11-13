import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Eye,
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
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TablePagination } from '@/components/common/TablePagination'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AuditTransactionModal } from '@/components/dashboard/AuditTransactionModal'
import { normalizeDateToYYYYMMDD } from '@/utils/dateUtils'
import { TransactionStatusBadge } from '@/components/transactions/TransactionProgress'
import {
  deriveTransactionLifecycle,
  getTransactionTypeMeta,
  formatSignedTransactionAmount,
  getDepositedAmountForRow,
  getCleanParticularsTitle,
  getRowSaleDateIso,
} from '@/utils/transactionLifecycle'
import type { DashboardTransactionItem } from '@/services/dashboardService'

export type { DashboardTransactionItem as DashboardTransaction }

const ITEMS_PER_PAGE = 10

const toLedgerDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : iso
}

const getDepositDayShort = (tx: DashboardTransactionItem): string | null => {
  if (tx.type !== 'Sales') return null
  if ((tx.depositStatus || (tx as any).deposit_status) !== 'Deposited') return null
  const day = String((tx as any).deposit_date || tx.depositDate || '').slice(0, 10)
  const [y, m, d] = day.split('-')
  return y && m && d ? `${m}/${d}/${y.slice(2)}` : null
}

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
      {/* 1. Header with Red View All Button */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-focus leading-tight">
            All Transactions
          </h2>
          <p className="text-xs sm:text-sm text-muted-fg font-normal mt-0.5">
            Here's the summary of all transactions (all records) in {displayedTitle}.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => navigate('/transaction?tab=all')}
          className="h-9 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer transition-colors"
        >
          <span>View All</span>
          <ArrowRight className="h-3.5 w-3.5 text-white" />
        </Button>
      </div>

      {/* 2. Table matching All Transactions (All Records):
          DATE | PARTICULARS | METHOD | AMOUNT | CHEQUE NO. | DEPOSIT DATE | AMOUNT DEPOSIT | STATUS
      */}
      <div className="overflow-x-auto">
        <Table className="w-full min-w-[820px] lg:min-w-0 table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <TableHeader>
            <TableRow className="border-b border-slate-200/80 bg-slate-50/70 hover:bg-slate-50/70">
              <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                DATE
              </TableHead>
              <TableHead className="px-2.5 sm:px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                PARTICULARS
              </TableHead>
              <TableHead className="px-2 sm:px-2.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                METHOD
              </TableHead>
              <TableHead className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right">
                AMOUNT
              </TableHead>
              <TableHead className="px-2 sm:px-2.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left">
                CHEQUE NO.
              </TableHead>
              <TableHead
                className="px-2 sm:px-2.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-left"
                title="Day the sale's money was deposited or transferred; empty until deposited"
              >
                DEPOSIT DATE
              </TableHead>
              <TableHead
                className="pl-2 pr-3 sm:pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-right"
                title="Amount actually deposited to the bank; empty until deposited"
              >
                AMOUNT DEPOSIT
              </TableHead>
              <TableHead className="px-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-fg text-center">
                STATUS
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {paginatedTransactions.length === 0 ? (
              <TableEmptyState
                colSpan={8}
                title="No transactions found"
                description="No transactions found for the selected date range."
              />
            ) : (
              paginatedTransactions.map((tx) => {
                const depositAmt = tx.deposit || 0
                const withdrawalAmt = tx.withdrawal || 0
                const rowAmt = tx.amount || (depositAmt > 0 ? depositAmt : withdrawalAmt)
                const depositedAmt = getDepositedAmountForRow(tx)
                const lifecycle = deriveTransactionLifecycle(tx)
                const typeMeta = getTransactionTypeMeta(tx)
                const { title, itemCount } = getCleanParticularsTitle(
                  tx.particulars || tx.description,
                  tx.items,
                  rowAmt
                )
                const saleDateShort = toLedgerDate(getRowSaleDateIso(tx)) || tx.date
                const depDateShort = lifecycle.effectiveDepositDate
                  ? toLedgerDate(lifecycle.effectiveDepositDate)
                  : getDepositDayShort(tx)

                return (
                  <TableRow
                    key={tx.id}
                    onClick={() => handleOpenAudit(tx)}
                    title="Click to view complete details"
                    className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors cursor-pointer text-xs"
                  >
                    {/* 1. Date */}
                    <TableCell className="px-2.5 sm:px-3 py-3 text-xs font-medium text-focus whitespace-nowrap align-top">
                      {saleDateShort}
                    </TableCell>

                    {/* 2. Particulars */}
                    <TableCell className="px-2.5 sm:px-3 py-3 text-xs align-top">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-focus break-words leading-snug">
                          {title}
                        </span>
                        {itemCount > 1 && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-[#960C01]/10 text-[#960C01] border border-[#960C01]/20">
                            +{itemCount - 1} more
                          </span>
                        )}
                        {lifecycle.overdueLabel && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                            {lifecycle.overdueLabel}
                          </span>
                        )}
                      </div>
                      {tx.company && (
                        <div className="mt-0.5 text-[11px] font-medium text-focus/70 truncate">
                          {tx.company}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-muted-fg font-mono truncate">
                        {tx.refNo || '—'}
                      </div>
                    </TableCell>

                    {/* 3. Method */}
                    <TableCell className="px-2 sm:px-2.5 py-3 text-xs text-focus/90 font-medium truncate align-top">
                      {tx.paymentMethod || 'Cash'}
                    </TableCell>

                    {/* 4. Signed Gross Amount */}
                    <TableCell
                      className={cn(
                        'pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top',
                        typeMeta.isOutflow ? 'text-rose-700' : 'text-emerald-700'
                      )}
                    >
                      {formatSignedTransactionAmount(tx, rowAmt, formatPHP)}
                    </TableCell>

                    {/* 5. Cheque No. */}
                    <TableCell className="px-2 sm:px-2.5 py-3 text-xs font-mono text-focus/80 truncate align-top">
                      {tx.chequeNo || '—'}
                    </TableCell>

                    {/* 6. Deposit Date */}
                    <TableCell className="px-2 sm:px-2.5 py-3 text-xs font-medium whitespace-nowrap align-top">
                      {depDateShort ? (
                        <span className="text-emerald-700">{depDateShort}</span>
                      ) : (
                        <span className="text-muted-fg/50">—</span>
                      )}
                    </TableCell>

                    {/* 7. Deposit Amount */}
                    <TableCell className="pl-2 pr-3 sm:pr-4 py-3 text-xs font-bold text-right tabular-nums whitespace-nowrap align-top">
                      {depositedAmt > 0 ? (
                        <span className="text-emerald-700">{formatPHP(depositedAmt)}</span>
                      ) : (
                        <span className="text-muted-fg/50 font-normal">—</span>
                      )}
                    </TableCell>

                    {/* 8. Status Badge */}
                    <TableCell className="px-2 py-3 text-center align-top">
                      <TransactionStatusBadge lifecycle={lifecycle} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 3. Pagination Footer */}
      <div className="pt-4 mt-2 border-t border-slate-100">
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalRecords={totalItems}
          startIndex={startIndex}
          endIndex={endIndex}
          pageSize={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
          itemLabel="transactions"
        />
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
