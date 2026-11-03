import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import * as React from 'react'
import { Download, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatPHP } from '@/lib/format'
import {
  loanService,
  type CompanyLoanGroup,
  type CompanyOption,
} from '@/services/loanService'

const PAGE_SIZE = 20
const CATEGORIES = ['Rent', 'Electricity', 'Water Bill', 'Internet', 'Operating Supplies']

export const CompanyLoansPage: React.FC = () => {
  const [groups, setGroups] = React.useState<CompanyLoanGroup[]>([])
  const [companies, setCompanies] = React.useState<CompanyOption[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [filters, setFilters] = React.useState({
    borrowerId: '', category: '', paymentStatus: '', date: '',
  })
  const [selectedGroup, setSelectedGroup] = React.useState<CompanyLoanGroup | null>(null)
  const [repaymentTimeline, setRepaymentTimeline] = React.useState<Array<{
    refNo: string
    paymentDate: string
    amount: number
    remainingBalance: number
    reference: string
  }>>([])

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

  React.useEffect(() => { loanService.getCompanies().then(setCompanies) }, [])
  React.useEffect(() => { void loadGroups() }, [loadGroups])

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
      setError(formatUserFriendlyErrorMessage(err, 'Unable to export company loans.'))
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
      setError(formatUserFriendlyErrorMessage(err, 'Unable to load the repayment timeline.'))
    }
  }


  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Company Loans</h1>
          <p className="text-sm text-slate-500">Approved loans grouped by borrower, lender, and category.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void exportGroups()} className="bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white"><Download className="mr-2 h-4 w-4 text-white" />Export CSV</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex min-w-max items-center gap-3 overflow-x-auto pb-1">
          <select className="h-10 rounded-md border px-3 text-sm" value={filters.borrowerId} onChange={(e) => updateFilter('borrowerId', e.target.value)}>
            <option value="">All borrowers</option>
            {companies.map((company) => <option key={company.company_id} value={company.company_id}>{company.company_name}</option>)}
          </select>
          <select className="h-10 rounded-md border px-3 text-sm" value={filters.category} onChange={(e) => updateFilter('category', e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
          </select>
          <select className="h-10 rounded-md border px-3 text-sm" value={filters.paymentStatus} onChange={(e) => updateFilter('paymentStatus', e.target.value)}>
            <option value="">All payment statuses</option><option>Unpaid</option><option>Partially Paid</option><option>Fully Paid</option><option>Overdue</option>
          </select>
          <Input className="w-40" type="date" value={filters.date} onChange={(e) => updateFilter('date', e.target.value)} />
          <Button variant="outline" onClick={clearFilters}><X className="mr-2 h-4 w-4" />Clear filters</Button>
        </div>
      </Card>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="rounded-[24px] bg-white border border-stroke/30 p-5 sm:p-7 shadow-xs">
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading company loans...</div>
          ) : groups.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <Search className="mx-auto mb-2 h-5 w-5" />
              No approved loans match these filters.
            </div>
          ) : (
            <table className="w-full min-w-[1000px] text-left text-xs">
              <thead className="border-b border-slate-200/80 bg-slate-50/70 text-xs font-bold uppercase tracking-wider text-muted-fg">
                <tr>
                  {['Borrower Company', 'Lender Company', 'Category', 'Total Loan Amount', 'Total Paid', 'Outstanding Balance', 'Int. Rate', 'Status'].map((heading) => (
                    <th key={heading} className="px-4 py-3.5 font-bold uppercase tracking-wider text-muted-fg text-xs">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((group) => (
                  <tr
                    key={group.key}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/60 transition-colors text-xs"
                    onClick={() => void openGroupDetails(group)}
                  >
                    <td className="px-4 py-3.5 font-medium text-focus">{group.borrower}</td>
                    <td className="px-4 py-3.5 text-focus/90">{group.lender}</td>
                    <td className="px-4 py-3.5 text-focus/90">{group.category}</td>
                    <td className="px-4 py-3.5 font-bold text-focus tabular-nums">{formatPHP(group.totalLoanAmount)}</td>
                    <td className="px-4 py-3.5 font-bold text-emerald-600 tabular-nums">{formatPHP(group.totalPaid)}</td>
                    <td className="px-4 py-3.5 font-bold text-rose-600 tabular-nums">{formatPHP(group.outstandingBalance)}</td>
                    <td className="px-4 py-3.5 font-medium text-focus/80">{group.interestDisplay}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {group.paymentStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-fg">
          <span className="font-medium text-focus/80">
            {total} loan group{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-xs text-muted-fg italic">
              Page {page + 1} out of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => setPage((current) => current - 1)}
              className="h-8 px-3 rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40"
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={(page + 1) * PAGE_SIZE >= total || loading}
              onClick={() => setPage((current) => current + 1)}
              className="h-8 px-3 rounded-lg border-slate-200 text-focus hover:bg-slate-50 disabled:opacity-40"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(selectedGroup)} onOpenChange={(open) => !open && setSelectedGroup(null)}>
        <DialogContent className="sm:max-w-[850px] rounded-[24px] bg-white border border-stroke/30 shadow-2xl p-6 sm:p-8 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-stroke/20">
            <DialogTitle className="text-xl font-bold text-focus">Company Loan Details</DialogTitle>
          </DialogHeader>
          {selectedGroup && (
            <div className="space-y-5 text-sm pt-2">
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 p-4 rounded-2xl bg-surface border border-stroke/30">
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Borrower</b><p className="font-semibold text-focus mt-0.5">{selectedGroup.borrower}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Lender</b><p className="font-semibold text-focus mt-0.5">{selectedGroup.lender}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Category</b><p className="font-semibold text-focus mt-0.5">{selectedGroup.category}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Status</b><p className="font-semibold text-focus mt-0.5">{selectedGroup.paymentStatus}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Total Loan Amount</b><p className="font-semibold text-focus mt-0.5">{formatPHP(selectedGroup.totalLoanAmount)}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Total Paid</b><p className="font-semibold text-emerald-600 mt-0.5">{formatPHP(selectedGroup.totalPaid)}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Outstanding Balance</b><p className="font-semibold text-rose-600 mt-0.5">{formatPHP(selectedGroup.outstandingBalance)}</p></div>
                <div><b className="text-xs text-muted-fg uppercase tracking-wider block">Interest</b><p className="font-semibold text-focus mt-0.5">{selectedGroup.interestDisplay}</p></div>
              </div>
              <div>
                <h3 className="font-bold text-focus text-sm mb-2">Repayment Timeline</h3>
                {repaymentTimeline.length > 0 ? (
                  <div className="divide-y divide-stroke/30 rounded-2xl border border-stroke/30 overflow-hidden bg-white">
                    {repaymentTimeline.map((repayment, index) => (
                      <div key={`${repayment.refNo}-${repayment.paymentDate}-${index}`} className="grid gap-2 p-3 text-xs md:grid-cols-5 items-center hover:bg-slate-50/70">
                        <span className="font-mono font-medium">{repayment.refNo}</span>
                        <span className="text-muted-fg">{repayment.paymentDate}</span>
                        <span className="font-semibold text-emerald-600">{formatPHP(repayment.amount)}</span>
                        <span className="text-muted-fg">Balance: {formatPHP(repayment.remainingBalance)}</span>
                        <span className="text-muted-fg truncate">{repayment.reference}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-fg text-xs">No repayments recorded for this group.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
