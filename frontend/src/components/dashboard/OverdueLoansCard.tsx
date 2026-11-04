import * as React from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface OverdueLoansCardProps {
  count?: number
  className?: string
  onClick?: () => void
}

export const OverdueLoansCard: React.FC<OverdueLoansCardProps> = ({
  count = 3,
  className,
  onClick,
}) => {
  return (
    <Card
      onClick={onClick}
      className={cn(
        'bg-primary text-white rounded-[15px] p-4 sm:p-5 shadow-xs border-0 flex items-center justify-between transition-all hover:shadow-md cursor-pointer group',
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-3xl sm:text-4xl font-bold tracking-tight text-white tabular-nums">
          {count}
        </span>
        <span className="text-xs font-semibold text-white/95 mt-0.5 tracking-tight">
          Overdue Loans
        </span>
        <span className="text-2xs text-white/75 font-medium mt-0.5">
          Requires attention
        </span>
      </div>

      <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-black/20 flex items-center justify-center text-white/95 shrink-0 shadow-inner group-hover:scale-105 transition-transform">
        <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
    </Card>
  )
}
