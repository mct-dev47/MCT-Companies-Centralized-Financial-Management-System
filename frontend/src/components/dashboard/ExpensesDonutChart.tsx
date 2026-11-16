import * as React from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { RotateCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ExpenseTrendPoint {
  day: string
  amount: number
}

interface ExpensesDonutChartProps {
  className?: string
  dateRangeLabel?: string
  data?: ExpenseTrendPoint[]
  items?: { id: string; label: string; amount: number; color: string }[]
}

export const ExpensesDonutChart: React.FC<ExpensesDonutChartProps> = ({
  className,
  data = [],
}) => {
  const total = data.reduce((sum, item) => sum + (item.amount || 0), 0)

  return (
    <Card
      className={cn(
        'bg-white rounded-[20px] border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between transition-all hover:shadow-md',
        className
      )}
    >
      {/* 1. Header with Icon Tile, Title, and Subtitle */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
          <RotateCw className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
            Expense Distribution
          </h3>
          <p className="text-xs text-muted-fg font-normal mt-0.5">
            Operational spending, utilities, and cost trends over time
          </p>
        </div>
      </div>

      {/* 2. Top Legend with Hollow Circle matching Customer Satisfaction reference */}
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full border-2 border-[#D97706] shrink-0" />
        <span className="text-xs font-medium text-focus/80">Operating Expenses (PHP)</span>
      </div>

      {/* 3. Smooth Golden Spline Curve Canvas */}
      <div className="h-44 sm:h-52 w-full">
        {data.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-fg font-medium">
            No expense trend data recorded for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
            >
              <defs>
                <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D97706" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#D97706" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#F1F5F9"
              />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: '#767B89', fontSize: 11, fontWeight: 500 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tickFormatter={(v) => `${v / 1000}k`}
                tick={{ fill: '#767B89', fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0].payload as ExpenseTrendPoint
                  return (
                    <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                      <p className="font-semibold text-white/90">{item.day} Expenses</p>
                      <p className="font-bold text-amber-300 text-sm tabular-nums mt-0.5">
                        {formatPHP(item.amount)}
                      </p>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#D97706"
                strokeWidth={2.5}
                fill="url(#expenseGradient)"
                dot={{
                  r: 4,
                  fill: '#FFFFFF',
                  stroke: '#D97706',
                  strokeWidth: 2,
                }}
                activeDot={{
                  r: 6,
                  fill: '#D97706',
                  stroke: '#FFFFFF',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 4. Insight Footer */}
      <div className="pt-3 mt-1 border-t border-slate-100 flex items-center justify-between text-2xs sm:text-xs text-muted-fg font-medium">
        <span>Verified operating expense distribution</span>
        <span className="font-semibold text-focus">Total: {formatPHP(total)}</span>
      </div>
    </Card>
  )
}
