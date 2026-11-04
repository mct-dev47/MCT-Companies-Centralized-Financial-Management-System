import * as React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ExpenseItem } from '@/services/expenseService'

interface ExpenseHorizontalBarChartProps {
  expenses: ExpenseItem[]
  className?: string
  companyScope?: string
}

const BAR_COLORS = [
  '#960C01', // MCT brand red
  '#4338CA', // Indigo
  '#0D9488', // Teal
  '#D97706', // Amber
  '#E11D48', // Rose
  '#0284C7', // Sky
  '#9333EA', // Purple
]

export const ExpenseHorizontalBarChart: React.FC<ExpenseHorizontalBarChartProps> = ({
  expenses,
  className,
  companyScope = 'All Companies',
}) => {
  const chartData = React.useMemo(() => {
    // If a single company is selected, show expenses by category or department
    const isSingle = companyScope !== 'All Companies'

    const sums: Record<string, number> = {}
    expenses.forEach((e) => {
      const groupKey = isSingle ? (e.category || 'Other') : (e.company || 'Other')
      sums[groupKey] = (sums[groupKey] || 0) + (e.withdrawal || 0)
    })

    return Object.entries(sums)
      .map(([name, amount], index) => ({
        name,
        amount,
        color: BAR_COLORS[index % BAR_COLORS.length],
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6)
  }, [expenses, companyScope])

  const total = React.useMemo(
    () => chartData.reduce((sum, d) => sum + d.amount, 0),
    [chartData]
  )

  return (
    <Card
      className={cn(
        'bg-white rounded-[24px] border border-stroke/30 p-5 sm:p-6 shadow-xs flex flex-col justify-between transition-all hover:shadow-md',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
          <BarChart3 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
            {companyScope === 'All Companies' ? 'Expenses by Company' : 'Expenses by Category'}
          </h3>
          <p className="text-xs text-muted-fg font-normal mt-0.5">
            {companyScope === 'All Companies'
              ? 'Operational expenditure comparison across subsidiaries'
              : `Outflow distribution across categories in ${companyScope}`}
          </p>
        </div>
      </div>

      {/* Horizontal Bar Chart */}
      {total === 0 ? (
        <div className="h-52 flex flex-col items-center justify-center text-center p-6 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
          <BarChart3 className="w-6 h-6 text-slate-300 mb-1" />
          <p className="text-xs font-semibold text-focus">No expense records</p>
          <p className="text-2xs text-muted-fg mt-0.5">No expense data in the selected range.</p>
        </div>
      ) : (
        <div className="h-52 w-full my-auto">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 6, right: 30, left: 30, bottom: 0 }}
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
                width={90}
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
                          {((item.amount / total) * 100).toFixed(1)}% of total
                        </p>
                      )}
                    </div>
                  )
                }}
              />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={22}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Footer Metric */}
      <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-2xs sm:text-xs">
        <span className="text-muted-fg font-medium">Top Category / Entity</span>
        <span className="font-bold text-focus">
          {chartData[0] ? `${chartData[0].name} (${formatPHP(chartData[0].amount)})` : 'None'}
        </span>
      </div>
    </Card>
  )
}
