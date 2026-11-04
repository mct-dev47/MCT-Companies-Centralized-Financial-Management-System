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
import { Landmark } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'

interface LoanTrendPoint {
  period: string
  disbursements: number
  repayments: number
}

interface LoanTrendChartProps {
  className?: string
  data?: LoanTrendPoint[]
}

const DEFAULT_LOAN_DATA: LoanTrendPoint[] = [
  { period: 'Mon', disbursements: 120000, repayments: 90000 },
  { period: 'Tue', disbursements: 190000, repayments: 140000 },
  { period: 'Wed', disbursements: 150000, repayments: 130000 },
  { period: 'Thu', disbursements: 220000, repayments: 200000 },
  { period: 'Fri', disbursements: 180000, repayments: 160000 },
  { period: 'Sat', disbursements: 80000, repayments: 70000 },
  { period: 'Sun', disbursements: 50000, repayments: 40000 },
]

export const LoanTrendChart: React.FC<LoanTrendChartProps> = ({
  data = DEFAULT_LOAN_DATA,
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
        <div className="w-10 h-10 rounded-xl bg-[#0B0F2B] text-white flex items-center justify-center shrink-0 shadow-xs">
          <Landmark className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
            Loan & Repayment Trends
          </h3>
          <p className="text-xs text-muted-fg font-normal mt-0.5">
            New loan disbursements vs collected repayments over time
          </p>
        </div>
      </div>

      {/* 2. Top Legend with Hollow Circles matching reference */}
      <div className="flex items-center justify-center gap-5 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-[#4338CA] shrink-0" />
          <span className="text-xs font-medium text-focus/80">Disbursements</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-[#0D9488] shrink-0" />
          <span className="text-xs font-medium text-focus/80">Repayments</span>
        </div>
      </div>

      {/* 3. Dual Spline Area Chart Canvas */}
      <div className="h-44 sm:h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
          >
            <defs>
              <linearGradient id="disburseGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4338CA" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#4338CA" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="repayGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0D9488" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#0D9488" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#F1F5F9"
            />
            <XAxis
              dataKey="period"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: '#767B89', fontSize: 11, fontWeight: 500 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              domain={[0, 250000]}
              ticks={[0, 50000, 100000, 150000, 200000, 250000]}
              tickFormatter={(v) => `${v / 1000}k`}
              tick={{ fill: '#767B89', fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const item = payload[0].payload as LoanTrendPoint
                return (
                  <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs space-y-1">
                    <p className="font-semibold text-white/90 border-b border-white/15 pb-1">
                      {item.period} Timeline
                    </p>
                    <p className="text-indigo-300 font-medium flex justify-between gap-3">
                      <span>Disbursed:</span>
                      <span className="font-bold tabular-nums">
                        {formatPHP(item.disbursements)}
                      </span>
                    </p>
                    <p className="text-teal-300 font-medium flex justify-between gap-3">
                      <span>Repaid:</span>
                      <span className="font-bold tabular-nums">
                        {formatPHP(item.repayments)}
                      </span>
                    </p>
                  </div>
                )
              }}
            />
            {/* Disbursements Area Line */}
            <Area
              type="monotone"
              dataKey="disbursements"
              stroke="#4338CA"
              strokeWidth={2.5}
              fill="url(#disburseGrad)"
              dot={{
                r: 4,
                fill: '#FFFFFF',
                stroke: '#4338CA',
                strokeWidth: 2,
              }}
              activeDot={{
                r: 6,
                fill: '#4338CA',
                stroke: '#FFFFFF',
                strokeWidth: 2,
              }}
            />
            {/* Repayments Area Line */}
            <Area
              type="monotone"
              dataKey="repayments"
              stroke="#0D9488"
              strokeWidth={2.5}
              fill="url(#repayGrad)"
              dot={{
                r: 4,
                fill: '#FFFFFF',
                stroke: '#0D9488',
                strokeWidth: 2,
              }}
              activeDot={{
                r: 6,
                fill: '#0D9488',
                stroke: '#FFFFFF',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 4. Insight Footer matching reference */}
      <div className="pt-3 mt-1 border-t border-slate-100 flex items-center justify-between text-2xs sm:text-xs text-muted-fg font-medium">
        <span>Latest Period: ₱120,000 disbursed, ₱90,000 collected.</span>
        <span className="font-semibold text-amber-600">3 Overdue Loans</span>
      </div>
    </Card>
  )
}
