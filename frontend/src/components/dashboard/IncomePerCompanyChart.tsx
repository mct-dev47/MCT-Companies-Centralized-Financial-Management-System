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
  LabelList,
} from 'recharts'
import { Building2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface CompanyIncome {
  rank: number
  company: string
  score: number
  amount: number
  color?: string
}

interface IncomePerCompanyChartProps {
  className?: string
  companyName?: string
  data?: CompanyIncome[]
}

export const IncomePerCompanyChart: React.FC<IncomePerCompanyChartProps> = ({
  className,
  companyName,
  data = [],
}) => {
  const isSingleCompany = Boolean(companyName && companyName !== 'All Companies')
  const chartData = data
  const maxDomain = isSingleCompany ? 400000 : 1000000
  const ticks = isSingleCompany
    ? [0, 100000, 200000, 300000, 400000]
    : [0, 200000, 400000, 600000, 800000, 1000000]

  const formatShort = (val: unknown) => {
    const num = Number(val)
    if (isNaN(num)) return ''
    return `${Math.round(num / 10000)}`
  }

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
          <Building2 className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-focus leading-tight">
            {isSingleCompany ? 'Department Revenue Breakdown' : 'Income per Company'}
          </h3>
          <p className="text-xs text-muted-fg font-normal mt-0.5">
            {isSingleCompany
              ? `Stream distribution and sales audit metrics for ${companyName}`
              : 'Metrics across subsidiaries, operations, and quarterly revenue'}
          </p>
        </div>
      </div>

      {/* 2. Horizontal Bar Chart Canvas */}
      <div className="h-44 sm:h-52 w-full my-auto">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 6, right: 36, left: 24, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              horizontal={false}
              stroke="#F1F5F9"
            />
            <XAxis
              type="number"
              domain={[0, maxDomain]}
              ticks={ticks}
              tickFormatter={(v) => `${v / 10000}`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#767B89', fontSize: 10 }}
            />
            <YAxis
              type="category"
              dataKey="company"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              tick={{ fill: '#0B0F2B', fontSize: 11, fontWeight: 500 }}
              width={100}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const item = payload[0].payload as CompanyIncome
                return (
                  <div className="bg-focus text-white px-3 py-2 rounded-xl shadow-lg border border-white/10 text-xs">
                    <p className="font-semibold text-white/90">{item.company}</p>
                    <p className="font-bold text-white text-sm tabular-nums mt-0.5">
                      {formatPHP(item.amount)}
                    </p>
                  </div>
                )
              }}
            />
            <Bar
              dataKey="amount"
              radius={[0, 6, 6, 0]}
              barSize={14}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color || '#960C01'} />
              ))}
              {/* Always-visible actual values displayed at the end of each bar */}
              <LabelList
                dataKey="amount"
                position="right"
                formatter={formatShort}
                fill="#475569"
                fontSize={10.5}
                fontWeight={500}
                offset={8}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 3. Insight Footer */}
      <div className="pt-3 mt-1 border-t border-slate-100 flex items-center justify-between text-2xs sm:text-xs text-muted-fg font-normal">
        <span>
          {chartData.length > 0
            ? `Top: ${chartData[0]?.company} (${formatPHP(chartData[0]?.amount || 0)}).`
            : 'No income recorded for this period.'}
        </span>
        <span className="font-medium text-emerald-700">Verified</span>
      </div>
    </Card>
  )
}
