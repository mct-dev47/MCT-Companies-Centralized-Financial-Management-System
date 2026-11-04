import * as React from 'react'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { PieChart as PieIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ExpenseItem } from '@/services/expenseService'

interface ExpensePieChartProps {
  expenses: ExpenseItem[]
  className?: string
}

import { CATEGORY_COLORS } from '@/utils/categoryConstants'

const CATEGORY_PALETTE: Record<string, string> = {
  ...CATEGORY_COLORS,
  'Other': '#767B89',
}

export const ExpensePieChart: React.FC<ExpensePieChartProps> = ({
  expenses,
  className,
}) => {
  const { chartData, totalExpense } = React.useMemo(() => {
    const sums: Record<string, number> = {}

    expenses.forEach((e) => {
      const cat = e.category || 'Other'
      sums[cat] = (sums[cat] || 0) + (e.withdrawal || 0)
    })

    const total = Object.values(sums).reduce((a, b) => a + b, 0)

    const data = Object.entries(sums)
      .map(([cat, amount]) => ({
        category: cat,
        amount,
        color: CATEGORY_PALETTE[cat] || '#767B89',
        percentage: total > 0 ? (amount / total) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)

    return { chartData: data, totalExpense: total }
  }, [expenses])

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
          <PieIcon className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
            Expense by Category
          </h3>
          <p className="text-xs text-muted-fg font-normal mt-0.5">
            Distribution of operational expenditures across categories
          </p>
        </div>
      </div>

      {/* Chart Canvas */}
      {totalExpense === 0 ? (
        <div className="h-52 flex flex-col items-center justify-center text-center p-6 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
          <PieIcon className="w-6 h-6 text-slate-300 mb-1" />
          <p className="text-xs font-semibold text-focus">No expense records</p>
          <p className="text-2xs text-muted-fg mt-0.5">No expense data in the selected range.</p>
        </div>
      ) : (
        <div className="h-52 w-full flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData.filter((d) => d.amount > 0)}
                dataKey="amount"
                nameKey="category"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
              >
                {chartData
                  .filter((d) => d.amount > 0)
                  .map((entry) => (
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
                  const item = payload[0].payload as (typeof chartData)[0]
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

      {/* Legend */}
      <div className="pt-3 mt-2 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-2xs sm:text-xs">
          {chartData.slice(0, 6).map((cat) => (
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
        </div>
      </div>
    </Card>
  )
}
