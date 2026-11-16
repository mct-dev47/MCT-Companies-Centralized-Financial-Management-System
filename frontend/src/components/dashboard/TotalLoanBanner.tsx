import * as React from 'react'
import { Card } from '@/components/ui/card'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'

interface LoanBarData {
  id: number
  height: number
  amount: number
  isHighlighted?: boolean
}

interface TotalLoanBannerProps {
  className?: string
  companies?: string[]
  bars?: LoanBarData[]
}

export const TotalLoanBanner: React.FC<TotalLoanBannerProps> = ({
  className,
  companies = [],
  bars = [],
}) => {
  const [hoveredBar, setHoveredBar] = React.useState<LoanBarData | null>(null)

  return (
    <Card
      className={cn(
        'bg-primary text-white rounded-[15px] p-4 sm:p-5 shadow-xs border-0 transition-all hover:shadow-md',
        className
      )}
    >
      {/* Header with Title and Visible Summary */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm sm:text-base font-semibold text-white/95">
          Total Loan
        </h3>
        <div className="flex items-center gap-2 text-2xs font-semibold text-white/90 bg-white/10 px-2.5 py-0.5 rounded-full border border-white/15">
          <span>Active Installments: {bars.length} Periods</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 sm:gap-6">
        {/* White Inner Chart Container */}
        <div className="flex-1 bg-white rounded-xl p-3 sm:p-4 shadow-2xs relative">
          <div className="h-28 sm:h-30 flex items-end justify-between gap-1 sm:gap-1.5">
            {bars.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-fg font-medium">
                No active loan installments recorded
              </div>
            ) : (
              bars.map((bar) => {
                const isHovered = hoveredBar?.id === bar.id
                return (
                  <div
                    key={bar.id}
                    className="flex-1 flex flex-col items-center justify-end h-full relative cursor-pointer group"
                    onMouseEnter={() => setHoveredBar(bar)}
                    onMouseLeave={() => setHoveredBar(null)}
                  >
                    {/* Tooltip on hover */}
                    {isHovered && (
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-focus text-white text-2xs font-semibold px-2 py-0.5 rounded shadow-md whitespace-nowrap z-20 pointer-events-none">
                        {formatPHP(bar.amount)}
                      </div>
                    )}

                    {/* Highlighted active bar indicator showing actual loan value */}
                    {bar.isHighlighted && !isHovered && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] font-bold text-primary tabular-nums whitespace-nowrap">
                        {formatPHP(bar.amount)}
                      </div>
                    )}

                    {/* Bar */}
                    <div
                      className={cn(
                        'w-full max-w-[14px] rounded-t-xs transition-all duration-200',
                        bar.isHighlighted
                          ? 'bg-primary shadow-xs'
                          : 'bg-[#F2B8B8] hover:bg-[#EAA0A0]'
                      )}
                      style={{ height: `${bar.height}%` }}
                    />
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Company Legend on Right Side */}
        {companies.length > 0 && (
          <div className="md:w-40 shrink-0 flex flex-col justify-center space-y-2 pl-2">
            {companies.map((company) => (
              <div
                key={company}
                className="flex items-center gap-2 text-xs font-medium text-white/95 hover:text-white transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                <span className="truncate">{company}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
