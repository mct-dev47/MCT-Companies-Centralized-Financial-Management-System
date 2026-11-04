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
  BarChart3,
  PieChart as PieIcon,
  ChevronDown,
  Check,
  TrendingUp,
  RotateCw,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DashboardTransactionItem } from '@/services/dashboardService'

import {
  CATEGORY_COLORS,
  CATEGORY_LIST,
  SALES_CATEGORY_LIST,
} from '@/utils/categoryConstants'

export { CATEGORY_COLORS, CATEGORY_LIST }

interface CategorySummaryChartProps {
  type: 'income' | 'expense'
  transactions?: DashboardTransactionItem[]
  className?: string
  defaultChartType?: 'bar' | 'pie'
}

// Number of categories always shown; the rest go into "Others" and the See more dropdown
const COLLAPSED_CATEGORY_COUNT = 5
const OTHERS_COLOR = '#94A3B8'

export const CategorySummaryChart: React.FC<CategorySummaryChartProps> = ({
  type,
  transactions = [],
  className,
  defaultChartType,
}) => {
  // Chart type dropdown: defaults to 'pie' for expense, 'bar' for income (unless overridden)
  const [chartType, setChartType] = React.useState<'bar' | 'pie'>(
    defaultChartType || (type === 'expense' ? 'pie' : 'bar')
  )
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false)
  const [isMoreOpen, setIsMoreOpen] = React.useState(false)
  const moreRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!isMoreOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setIsMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isMoreOpen])
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

  // Aggregate by category
  // Income uses Deposit amounts; Expense uses Withdrawal amounts
  const { categoryData, totalAmount } = React.useMemo(() => {
    const sums: Record<string, number> = {}

    transactions.forEach((tx) => {
      const cat = !tx.category || tx.category === 'None' ? 'Uncategorized' : tx.category
      const val = type === 'income' ? (tx.deposit || tx.amount || 0) : (tx.withdrawal || tx.amount || 0)
      sums[cat] = (sums[cat] || 0) + val
    })

    const total = Object.values(sums).reduce((a, b) => a + b, 0)

    const extraColors: Record<string, string> = {
      General: '#64748B',
      Other: '#767B89',
      Uncategorized: '#64748B',
    }

    // Categories with a value, largest first, padded with the standard list so at least 5 always show
    const withValue = Object.keys(sums)
      .filter((cat) => sums[cat] > 0)
      .sort((a, b) => sums[b] - sums[a])
    const padding = (type === 'income' ? SALES_CATEGORY_LIST : CATEGORY_LIST)
      .filter((cat) => !withValue.includes(cat))
      .slice(0, Math.max(COLLAPSED_CATEGORY_COUNT - withValue.length, 0))

    const data = [...withValue, ...padding]
      .map((cat) => ({
        category: cat,
        amount: sums[cat] || 0,
        color: (CATEGORY_COLORS as Record<string, string>)[cat] || extraColors[cat] || '#6366F1',
        percentage: total > 0 ? ((sums[cat] || 0) / total) * 100 : 0,
      }))

    return { categoryData: data, totalAmount: total }
  }, [transactions, type])

  // Top N categories plus a single "Others" bucket; the hidden ones are listed in the See more dropdown
  const hiddenData = categoryData.slice(COLLAPSED_CATEGORY_COUNT)
  const hiddenCount = hiddenData.length
  const displayData = React.useMemo(() => {
    if (hiddenCount === 0) return categoryData
    const rest = categoryData.slice(COLLAPSED_CATEGORY_COUNT)
    const restAmount = rest.reduce((sum, c) => sum + c.amount, 0)
    return [
      ...categoryData.slice(0, COLLAPSED_CATEGORY_COUNT),
      {
        category: 'Others',
        amount: restAmount,
        color: OTHERS_COLOR,
        percentage: totalAmount > 0 ? (restAmount / totalAmount) * 100 : 0,
      },
    ]
  }, [categoryData, hiddenCount, totalAmount])

  const title = type === 'income' ? 'Income Summary' : 'Expense Summary'
  const subtitle =
    type === 'income'
      ? 'Deposit amounts broken down by category'
      : 'Withdrawal amounts broken down by category'
  const Icon = type === 'income' ? TrendingUp : RotateCw
  const iconBg = type === 'income' ? 'bg-primary' : 'bg-[#0B0F2B]'

  const hasData = totalAmount > 0

  return (
    <Card
      className={cn(
        'bg-white rounded-[20px] border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between transition-all hover:shadow-md',
        className
      )}
    >
      {/* 1. Header with Icon, Title, and Independent Chart Type Dropdown */}
      <div className="flex items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs',
              iconBg
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
              {title}
            </h3>
            <p className="text-xs text-muted-fg font-normal mt-0.5 line-clamp-1">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Chart Type Toggle Dropdown */}
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
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left',
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
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left mt-0.5',
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

      {/* 2. Chart Display Area */}
      {!hasData ? (
        /* Empty State */
        <div className="h-48 sm:h-56 flex flex-col items-center justify-center text-center p-6 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2.5">
            <BarChart3 className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-xs sm:text-sm font-semibold text-focus">
            No {type === 'income' ? 'income' : 'expense'} data
          </p>
          <p className="text-2xs sm:text-xs text-muted-fg mt-0.5 max-w-xs">
            No {type === 'income' ? 'deposit' : 'withdrawal'} transactions found for the selected date range.
          </p>
        </div>
      ) : chartType === 'bar' ? (
        /* Bar Chart View */
        <div className="h-48 sm:h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={displayData}
              margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#F1F5F9"
              />
              <XAxis
                dataKey="category"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: '#767B89', fontSize: 11, fontWeight: 500 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                tick={{ fill: '#767B89', fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0].payload as (typeof categoryData)[0]
                  return (
                    <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <p className="font-semibold text-white/90">{item.category}</p>
                      </div>
                      <p className="font-bold text-white text-sm tabular-nums">
                        {formatPHP(item.amount)}
                      </p>
                      <p className="text-[10px] text-white/70 mt-0.5">
                        {item.percentage.toFixed(1)}% of total
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {displayData.map((entry) => (
                  <Cell key={entry.category} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        /* Pie Chart View */
        <div className="h-56 sm:h-64 w-full flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={displayData.filter((d) => d.amount > 0)}
                dataKey="amount"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={72}
                paddingAngle={3}
                labelLine={true}
                label={({ category, name, percent }: any) => {
                  const cat = category || name || ''
                  const pct = Math.round((percent || 0) * 100)
                  return `${cat} (${pct}%)`
                }}
              >
                {displayData.filter((d) => d.amount > 0).map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={entry.color}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0].payload as (typeof categoryData)[0]
                  return (
                    <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <p className="font-semibold text-white/90">{item.category}</p>
                      </div>
                      <p className="font-bold text-white text-sm tabular-nums">
                        {formatPHP(item.amount)}
                      </p>
                      <p className="text-[10px] text-white/70 mt-0.5">
                        {item.percentage.toFixed(1)}% of total
                      </p>
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 3. Category Color Legend */}
      <div className="pt-3 mt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 text-2xs sm:text-xs">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {displayData.filter((cat) => cat.category !== 'Others').map((cat) => (
              <div key={cat.category} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-muted-fg font-medium">{cat.category}:</span>
                <span className="font-semibold text-focus tabular-nums">
                  {cat.amount > 0 ? `${Math.round(cat.amount / 1000)}k` : '₱0'}
                </span>
              </div>
            ))}
            {hiddenCount > 0 && (
              <div ref={moreRef} className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setIsMoreOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                  aria-expanded={isMoreOpen}
                  aria-haspopup="true"
                >
                  See more (+{hiddenCount})
                  <ChevronDown className="w-3 h-3" />
                </button>
                {isMoreOpen && (
                  <div className="absolute left-0 bottom-full mb-1.5 w-60 max-h-64 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl p-1.5 z-40 animate-in fade-in-50 zoom-in-95 duration-150">
                    <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">
                      Others ({formatPHP(displayData[displayData.length - 1]?.amount || 0)})
                    </p>
                    {hiddenData.map((cat) => (
                      <div
                        key={cat.category}
                        className="flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-50"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="truncate text-focus font-medium">{cat.category}</span>
                        </span>
                        <span className="shrink-0 font-semibold text-focus tabular-nums">
                          {formatPHP(cat.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="font-bold text-focus text-xs sm:text-sm tabular-nums ml-auto">
            Total: {formatPHP(totalAmount)}
          </div>
        </div>
      </div>
    </Card>
  )
}

export const IncomeSummaryChart: React.FC<Omit<CategorySummaryChartProps, 'type'>> = (
  props
) => <CategorySummaryChart type="income" {...props} />

export const ExpenseSummaryChart: React.FC<Omit<CategorySummaryChartProps, 'type'>> = (
  props
) => <CategorySummaryChart type="expense" {...props} />
