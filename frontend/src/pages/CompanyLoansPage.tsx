import * as React from 'react'
import { Building2, Download, Search, Tag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  BaseModal,
  DropdownFilter,
  ErrorBanner,
  StatusBadge,
  StatusPill,
  TableEmptyState,
  TableErrorState,
  TablePagination,
  TableSkeleton,
} from '@/components/common'
import { formatPHP } from '@/lib/format'
import {
  formatUserFriendlyErrorMessage,
  notifyError,
} from '@/utils/errorUtils'
import {
  loanService,
  type CompanyLoanGroup,
  type CompanyOption,
} from '@/services/loanService'

const PAGE_SIZE = 20
const CATEGORIES = ['Rent', 'Electricity', 'Water Bill', 'Internet', 'Operating Supplies']
const PAYMENT_STATUSES = ['Unpaid', 'Partially Paid', 'Fully Paid', 'Overdue']

export const CompanyLoansPage: React.FC = () => {
  const [groups, setGroups] = React.useState<CompanyLoanGroup[]>([])
  const [companies, setCompanies] = React.useState<CompanyOption[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [filters, setFilters] = React.useState({
    borrowerId: '',
    category: '',
    paymentStatus: '',
    date: '',
  })
  const [selectedGroup, setSelectedGroup] = React.useState<CompanyLoanGroup | null>(null)
  const [repaymentTimeline, setRepaymentTimeline] = React.useState<
    Array<{
      refNo: string
      paymentDate: string
      amount: number
      remainingBalance: number
      reference: string
    }>
  >([])

  const loadGroups = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loanService.getCompanyLoans({
        borrowerId: filters.borrowerId ? Number(filters.borrowerId) : undefined,
        category: filters.category || undefined,
        paymentStatus: filters.paymentStatus || undefined,
        startDate: filters.date || undefined,
        endDate: filters.date || undefined,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      })
      setGroups(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(formatUserFriendlyErrorMessage(err, 'Unable to load company loans.'))
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  React.useEffect(() => {
    loanService.getCompanies().then(setCompanies)
  }, [])
  React.useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setPage(0)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const clearFilters = () => {
    setPage(0)
    setFilters({ borrowerId: '', category: '', paymentStatus: '', date: '' })
  }

  const exportGroups = async () => {
    try {
      await loanService.exportCompanyLoans({
        borrowerId: filters.borrowerId ? Number(filters.borrowerId) : undefined,
        category: filters.category || undefined,
        paymentStatus: filters.paymentStatus || undefined,
        startDate: filters.date || undefined,
        endDate: filters.date || undefined,
      })
    } catch (err) {
      setError(notifyError(err, 'Unable to export company loans.'))
    }
  }

  const openGroupDetails = async (group: CompanyLoanGroup) => {
    setSelectedGroup(group)
    setRepaymentTimeline([])
    try {
      const statements = await Promise.all(
        group.loans.map(async (loan) => ({
          loan,
          statement: await loanService.getCompanyLoanStatement(loan.loanId || 0),
        }))
      )
      setRepaymentTimeline(
        statements
          .flatMap(({ loan, statement }) =>
            (statement.repayments || []).map((repayment: any) => ({
              refNo: loan.refNo,
              paymentDate: repayment.payment_date,
              amount: Number(repayment.amount || 0),
              remainingBalance: Number(repayment.remaining_balance || 0),
              reference: repayment.reference_no || repayment.notes || '—',
            }))
          )
          .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))
      )
    } catch (err) {
      setError(notifyError(err, 'Unable to load the repayment timeline.'))
    }
  }

  const borrowerOptions = React.useMemo(
    () => [
      { value: '', label: 'All Borrowers' },
      ...companies.map((c) => ({
        value: String(c.company_id),
        label: c.company_name,
      })),
    ],
    [companies]
  )

  const categoryOptions = React.useMemo(
    () => [
      { value: '', label: 'All Categories' },
      ...CATEGORIES.map((c) => ({ value: c, label: c })),
    ],
    []
  )

  const statusOptions = React.useMemo(
    () => [
      { value: '', label: 'All Statuses' },
      ...PAYMENT_STATUSES.map((s) => ({ value: s, label: s })),
    ],
    []
  )

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-focus">Company Loans</h1>
          <p className="text-sm text-muted-fg">
            Approved loans grouped by borrower, lender, and category.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void exportGroups()}
            className="h-10 sm:h-11 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs sm:text-sm font-semibold"
          >
            <Download className="mr-2 h-4 w-4 text-white" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="p-4 rounded-[20px] border border-stroke/20 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <DropdownFilter
            value={filters.borrowerId}
            defaultValue=""
            placeholder="All Borrowers"
            menuTitle="Filter By Borrower"
            searchable
            searchPlaceholder="Search borrower…"
            clearable
            options={borrowerOptions}
            onChange={(val) => updateFilter('borrowerId', val)}
          />
          <DropdownFilter
            value={filters.category}
            defaultValue=""
            placeholder="All Categories"
            menuTitle="Filter By Category"
            clearable
            options={categoryOptions}
            onChange={(val) => updateFilter('category', val)}
          />
          <DropdownFilter
            value={filters.paymentStatus}
            defaultValue=""
            placeholder="All Statuses"
            menuTitle="Payment Status"
            clearable
            options={statusOptions}
            onChange={(val) => updateFilter('paymentStatus', val)}
          />
          <Input
            className="w-44 h-11 rounded-full border-stroke/60 px-4 text-xs sm:text-sm"
            type="date"
            value={filters.date}
            onChange={(e) => updateFilter('date', e.target.value)}
          />
          {(filters.borrowerId ||
            filters.category ||
            filters.paymentStatus ||
            filters.date) && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="h-11 rounded-full px-4 text-xs font-semibold"
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      <ErrorBanner
        message={error}
        onRetry={() => void loadGroups()}
        onDismiss={() => setError(null)}
      />

      <div className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs">
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <Table className="w-full min-w-[1000px] text-left text-xs">
            <TableHeader>
              <TableRow>
                {[
                  'Borrower Company',
                  'Lender Company',
                  'Category',
                  'Total Loan Amount',
                  'Total Paid',
                  'Outstanding Balance',
                  'Int. Rate',
                  'Status',
                ].map((heading) => (
                  <TableHead key={heading} className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeleton
                  rows={5}
                  columns={[
                    { width: 'w-32' },
                    { width: 'w-32' },
                    { width: 'w-24' },
                    { width: 'w-24' },
                    { width: 'w-24' },
                    { width: 'w-24' },
                    { width: 'w-16' },
                    { width: 'w-20', shape: 'pill' },
                  ]}
                />
              ) : error ? (
                <TableErrorState
                  colSpan={8}
                  title="Unable to load company loans"
                  message={error}
                  onRetry={loadGroups}
                />
              ) : groups.length === 0 ? (
                <TableEmptyState
                  colSpan={8}
                  icon={Search}
                  title="No company loans found"
                  description="No approved loans match these filters."
                />
              ) : (
                groups.map((group) => (
                  <TableRow
                    key={group.key}
                    className="hover-row-click text-xs"
                    onClick={() => void openGroupDetails(group)}
                  >
                    <TableCell className="font-medium text-focus">
                      {group.borrower}
                    </TableCell>
                    <TableCell className="text-focus/90">{group.lender}</TableCell>
                    <TableCell className="text-focus/90">{group.category}</TableCell>
                    <TableCell className="font-bold text-focus tabular-nums">
                      {formatPHP(group.totalLoanAmount)}
                    </TableCell>
                    <TableCell className="font-bold text-emerald-600 tabular-nums">
                      {formatPHP(group.totalPaid)}
                    </TableCell>
                    <TableCell className="font-bold text-rose-600 tabular-nums">
                      {formatPHP(group.outstandingBalance)}
                    </TableCell>
                    <TableCell className="font-medium text-focus/80">
                      {group.interestDisplay}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={group.paymentStatus} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination
          currentPage={page + 1}
          totalPages={totalPages}
          totalItems={total}
          pageSize={PAGE_SIZE}
          itemLabel="loan groups"
          disabled={loading}
          onPageChange={(nextPage) => setPage(nextPage - 1)}
        />
      </div>

      <BaseModal
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => !open && setSelectedGroup(null)}
        title="Company Loan Details"
        size="xl"
      >
        {selectedGroup && (
          <div className="space-y-5 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 p-4 rounded-2xl bg-surface border border-stroke/30">
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Borrower
                </b>
                <p className="font-semibold text-focus mt-0.5">
                  {selectedGroup.borrower}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Lender
                </b>
                <p className="font-semibold text-focus mt-0.5">
                  {selectedGroup.lender}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Category
                </b>
                <p className="font-semibold text-focus mt-0.5">
                  {selectedGroup.category}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Status
                </b>
                <p className="font-semibold text-focus mt-0.5">
                  {selectedGroup.paymentStatus}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Total Loan Amount
                </b>
                <p className="font-semibold text-focus mt-0.5">
                  {formatPHP(selectedGroup.totalLoanAmount)}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Total Paid
                </b>
                <p className="font-semibold text-emerald-600 mt-0.5">
                  {formatPHP(selectedGroup.totalPaid)}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Outstanding Balance
                </b>
                <p className="font-semibold text-rose-600 mt-0.5">
                  {formatPHP(selectedGroup.outstandingBalance)}
                </p>
              </div>
              <div>
                <b className="text-xs text-muted-fg uppercase tracking-wider block">
                  Interest
                </b>
                <p className="font-semibold text-focus mt-0.5">
                  {selectedGroup.interestDisplay}
                </p>
              </div>
            </div>
            <div>
              <h3 className="font-bold text-focus text-sm mb-2">
                Repayment Timeline
              </h3>
              {repaymentTimeline.length > 0 ? (
                <div className="divide-y divide-stroke/30 rounded-2xl border border-stroke/30 overflow-hidden bg-white">
                  {repaymentTimeline.map((repayment, index) => (
                    <div
                      key={`${repayment.refNo}-${repayment.paymentDate}-${index}`}
                      className="grid gap-2 p-3 text-xs md:grid-cols-5 items-center hover-row"
                    >
                      <span className="font-mono font-medium">
                        {repayment.refNo}
                      </span>
                      <span className="text-muted-fg">
                        {repayment.paymentDate}
                      </span>
                      <span className="font-semibold text-emerald-600">
                        {formatPHP(repayment.amount)}
                      </span>
                      <span className="text-muted-fg">
                        Balance: {formatPHP(repayment.remainingBalance)}
                      </span>
                      <span className="text-muted-fg truncate">
                        {repayment.reference}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-fg text-xs">
                  No repayments recorded for this group.
                </p>
              )}
            </div>
          </div>
        )}
      </BaseModal>
    </div>
  )
}
