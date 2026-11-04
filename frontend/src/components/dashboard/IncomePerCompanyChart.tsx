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

const DEFAULT_COMPANY_INCOME: CompanyIncome[] = [
  { rank: 1, company: 'MCT Kitchen', score: 9, amount: 980000, color: '#4338CA' },
  { rank: 2, company: 'MCT Hotel', score: 8, amount: 850000, color: '#0D9488' },
  { rank: 3, company: 'JK Cafe', score: 7, amount: 720000, color: '#D97706' },
  { rank: 4, company: 'Annex Nine', score: 6, amount: 610000, color: '#E11D48' },
  { rank: 5, company: 'Merillon', score: 5, amount: 530000, color: '#0284C7' },
  { rank: 6, company: 'JK Printing', score: 4, amount: 440000, color: '#9333EA' },
]

const DEFAULT_COMPANY_DEPARTMENT_INCOME: CompanyIncome[] = [
  { rank: 1, company: 'Dine-In Operations', score: 9, amount: 380000, color: '#4338CA' },
  { rank: 2, company: 'Catering & Banquet', score: 8, amount: 280000, color: '#0D9488' },
  { rank: 3, company: 'Commissary Supply', score: 7, amount: 150000, color: '#D97706' },
  { rank: 4, company: 'Takeout & Delivery', score: 6, amount: 95000, color: '#E11D48' },
  { rank: 5, company: 'Bar & Beverage', score: 5, amount: 50000, color: '#0284C7' },
  { rank: 6, company: 'Special Events', score: 4, amount: 25000, color: '#9333EA' },
]

export const IncomePerCompanyChart: React.FC<IncomePerCompanyChartProps> = ({
  className,
  companyName,
  data,
}) => {
  const isSingleCompany = Boolean(companyName && companyName !== 'All Companies')
  const chartData = data ?? (isSingleCompany ? DEFAULT_COMPANY_DEPARTMENT_INCOME : DEFAULT_COMPANY_INCOME)
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

      {/* 3. Insight Footer matching reference */}
      <div className="pt-3 mt-1 border-t border-slate-100 flex items-center justify-between text-2xs sm:text-xs text-muted-fg font-normal">
        <span>
          {isSingleCompany
            ? `Top stream: Dine-In Operations with highest share (₱380k).`
            : 'Top contributor: MCT Kitchen with highest revenue share (₱980k).'}
        </span>
        <span className="font-medium text-emerald-700">Active Growth</span>
      </div>
    </Card>
  )
}
