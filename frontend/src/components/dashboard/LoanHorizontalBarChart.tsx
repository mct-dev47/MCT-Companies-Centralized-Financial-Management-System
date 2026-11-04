import * as React from 'react'
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import {
  Landmark,
  BarChart3,
  PieChart as PieIcon,
  ChevronDown,
  Check,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { LoanItem } from '@/services/loanService'

interface LoanHorizontalBarChartProps {
  loans: LoanItem[]
  className?: string
  companyScope?: string
}

const LOAN_BAR_COLORS = [
  '#0B0F2B', // Deep navy
  '#960C01', // Brand red
  '#4338CA', // Indigo
  '#0D9488', // Teal
  '#D97706', // Amber
  '#0284C7', // Sky
  '#9333EA', // Purple
]

export const LoanHorizontalBarChart: React.FC<LoanHorizontalBarChartProps> = ({
  loans,
  className,
  companyScope = 'All Companies',
}) => {
  const [chartType, setChartType] = React.useState<'bar' | 'pie'>('bar')
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isDropdownOpen])

  const chartData = React.useMemo(() => {
    const isSingle = companyScope !== 'All Companies'

    const sums: Record<string, number> = {}
    loans.forEach((l) => {
      const groupKey = isSingle ? (l.particulars || 'Loan') : (l.company || 'Other')
      // Shorten lengthy loan particulars for horizontal axis labels
      const label = groupKey.length > 25 ? `${groupKey.slice(0, 24)}…` : groupKey
      sums[label] = (sums[label] || 0) + (l.amount || 0)
    })

    return Object.entries(sums)
      .map(([name, amount], index) => ({
        name,
        amount,
        color: LOAN_BAR_COLORS[index % LOAN_BAR_COLORS.length],
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 7)
  }, [loans, companyScope])

  const total = React.useMemo(
    () => chartData.reduce((sum, d) => sum + d.amount, 0),
    [chartData]
  )

  const title = companyScope === 'All Companies' ? 'Loan Commitments by Company' : 'Loans by Purpose'
  const subtitle =
    companyScope === 'All Companies'
      ? 'Total financing, term borrowings, and corporate credit across companies'
      : `Active debt facilities and term borrowing distribution in ${companyScope}`

  return (
    <Card
      className={cn(
        'bg-white rounded-[24px] border border-stroke/30 p-5 sm:p-6 shadow-xs flex flex-col justify-between transition-all hover:shadow-md w-full',
        className
      )}
    >
      {/* Header with Title and Chart Type Dropdown Filter */}
      <div className="flex items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Landmark className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
              {title}
            </h3>
            <p className="text-xs text-muted-fg font-normal mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Chart Type Toggle Dropdown Filter (Bar Chart / Pie Chart) */}
        <div className="relative inline-block shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-focus transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-expanded={isDropdownOpen}
            aria-label={`Toggle chart type for ${title}`}
          >
            {chartType === 'bar' ? (
              <>
                <BarChart3 className="w-3.5 h-3.5 text-muted-fg" />
                <span>Bar chart</span>
              </>
            ) : (
              <>
                <PieIcon className="w-3.5 h-3.5 text-muted-fg" />
                <span>Pie chart</span>
              </>
            )}
            <ChevronDown className="w-3 h-3 text-muted-fg ml-0.5" />
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-36 bg-white rounded-xl border border-slate-200 shadow-xl p-1.5 z-40 animate-in fade-in-50 zoom-in-95 duration-150">
              <button
                type="button"
                onClick={() => {
                  setChartType('bar')
                  setIsDropdownOpen(false)
                }}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                  chartType === 'bar'
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-focus hover:bg-slate-50'
                )}
              >
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Bar chart</span>
                </div>
                {chartType === 'bar' && <Check className="w-3.5 h-3.5 text-primary" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setChartType('pie')
                  setIsDropdownOpen(false)
                }}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left mt-0.5 cursor-pointer',
                  chartType === 'pie'
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-focus hover:bg-slate-50'
                )}
              >
                <div className="flex items-center gap-2">
                  <PieIcon className="w-3.5 h-3.5" />
                  <span>Pie chart</span>
                </div>
                {chartType === 'pie' && <Check className="w-3.5 h-3.5 text-primary" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chart Display Area */}
      {total === 0 ? (
        <div className="h-56 flex flex-col items-center justify-center text-center p-6 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
          <Landmark className="w-6 h-6 text-slate-300 mb-1" />
          <p className="text-xs font-semibold text-focus">No loan records</p>
          <p className="text-2xs text-muted-fg mt-0.5">No loan data in the selected range.</p>
        </div>
      ) : chartType === 'bar' ? (
        <div className="h-56 w-full my-auto">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 36, left: 36, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                horizontal={false}
                stroke="#F1F5F9"
              />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                tick={{ fill: '#767B89', fontSize: 10 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                width={120}
                tick={{ fill: '#0B0F2B', fontSize: 11, fontWeight: 500 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0].payload as (typeof chartData)[0]
                  return (
                    <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                      <p className="font-semibold text-white/90 mb-1">{item.name}</p>
                      <p className="font-bold text-white text-sm tabular-nums">
                        {formatPHP(item.amount)}
                      </p>
                      {total > 0 && (
                        <p className="text-[10px] text-white/70 mt-0.5">
                          {((item.amount / total) * 100).toFixed(1)}% of total loans
                        </p>
                      )}
                    </div>
                  )
                }}
              />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={24}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-56 sm:h-64 w-full flex items-center justify-center my-auto">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData.filter((d) => d.amount > 0)}
                dataKey="amount"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={3}
                labelLine={true}
                label={({ name, percent }: any) => {
                  const pct = Math.round((percent || 0) * 100)
                  return `${name} (${pct}%)`
                }}
              >
                {chartData
                  .filter((d) => d.amount > 0)
                  .map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.color}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0].payload as (typeof chartData)[0]
                  return (
                    <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <p className="font-semibold text-white/90">{item.name}</p>
                      </div>
                      <p className="font-bold text-white text-sm tabular-nums">
                        {formatPHP(item.amount)}
                      </p>
                      {total > 0 && (
                        <p className="text-[10px] text-white/70 mt-0.5">
                          {((item.amount / total) * 100).toFixed(1)}% of total loans
                        </p>
                      )}
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Footer Metrics & Legend */}
      <div className="pt-3 mt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 text-2xs sm:text-xs">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {chartData.map((item) => (
              <div key={item.name} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-fg font-medium">{item.name}:</span>
                <span className="font-semibold text-focus tabular-nums">
                  {item.amount > 0 ? `${Math.round(item.amount / 1000)}k` : '₱0'}
                </span>
              </div>
            ))}
          </div>

          <div className="font-bold text-focus text-xs sm:text-sm tabular-nums ml-auto">
            Total: {formatPHP(total)}
          </div>
        </div>
      </div>
    </Card>
  )
}
