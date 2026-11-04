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
import { TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface DailySale {
  day: string
  shortDay: string
  amount: number
}

interface WeeklySalesChartProps {
  data?: DailySale[]
  className?: string
}

const DEFAULT_WEEKLY_DATA: DailySale[] = [
  { day: 'Monday', shortDay: 'Mon', amount: 300000 },
  { day: 'Tuesday', shortDay: 'Tue', amount: 430000 },
  { day: 'Wednesday', shortDay: 'Wed', amount: 180000 },
  { day: 'Thursday', shortDay: 'Thu', amount: 260000 },
  { day: 'Friday', shortDay: 'Fri', amount: 320000 },
  { day: 'Saturday', shortDay: 'Sat', amount: 270000 },
  { day: 'Sunday', shortDay: 'Sun', amount: 140000 },
]

export const WeeklySalesChart: React.FC<WeeklySalesChartProps> = ({
  data = DEFAULT_WEEKLY_DATA,
  className,
}) => {
  return (
    <Card
      className={cn(
        'bg-white rounded-[20px] border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between transition-all hover:shadow-md',
        className
      )}
    >
      {/* 1. Header with Icon Tile, Title, and Subtitle */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
          <TrendingUp className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
            Weekly Sales Trend
          </h3>
          <p className="text-xs text-muted-fg font-normal mt-0.5">
            Daily revenue volume, growth pacing, and weekly milestones
          </p>
        </div>
      </div>

      {/* 2. Top Legend with Hollow Circle matching reference */}
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full border-2 border-primary shrink-0" />
        <span className="text-xs font-medium text-focus/80">Sales (PHP)</span>
      </div>

      {/* 3. Smooth Spline Area Chart Canvas */}
      <div className="h-44 sm:h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
          >
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#960C01" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#960C01" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#F1F5F9"
            />
            <XAxis
              dataKey="shortDay"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: '#767B89', fontSize: 11, fontWeight: 500 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              domain={[100000, 500000]}
              ticks={[100000, 200000, 300000, 400000]}
              tickFormatter={(v) => `${v / 1000}k`}
              tick={{ fill: '#767B89', fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const item = payload[0].payload as DailySale
                return (
                  <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                    <p className="font-semibold text-white/90">{item.day}</p>
                    <p className="font-bold text-white text-sm tabular-nums mt-0.5">
                      {formatPHP(item.amount)}
                    </p>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="amount"
              stroke="#960C01"
              strokeWidth={2.5}
              fill="url(#salesGradient)"
              dot={{
                r: 4,
                fill: '#FFFFFF',
                stroke: '#960C01',
                strokeWidth: 2,
              }}
              activeDot={{
                r: 6,
                fill: '#960C01',
                stroke: '#FFFFFF',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 4. Insight Footer matching reference */}
      <div className="pt-3 mt-1 border-t border-slate-100 flex items-center justify-between text-2xs sm:text-xs text-muted-fg font-medium">
        <span>Average daily sales is ₱271,400 for the selected period.</span>
        <span className="font-semibold text-primary">Peak: Tue (₱430k)</span>
      </div>
    </Card>
  )
}
