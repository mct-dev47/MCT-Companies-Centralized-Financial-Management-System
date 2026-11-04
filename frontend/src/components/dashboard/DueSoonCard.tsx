import * as React from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface DueSoonCardProps {
  count?: number
  className?: string
  onClick?: () => void
}

export const DueSoonCard: React.FC<DueSoonCardProps> = ({
  count = 3,
  className,
  onClick,
}) => {
  return (
    <Card
      onClick={onClick}
      className={cn(
        'bg-white rounded-[15px] border border-stroke/20 p-4 sm:p-5 shadow-xs flex items-center justify-between transition-all hover:shadow-md cursor-pointer group',
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-3xl sm:text-4xl font-bold tracking-tight text-focus tabular-nums">
          {count}
        </span>
        <span className="text-xs font-semibold text-focus mt-0.5 tracking-tight">
          Due Soon
        </span>
        <span className="text-2xs text-muted-fg font-medium mt-0.5">
          Upcoming this week
        </span>
      </div>

      <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-[#E5E5E5] flex items-center justify-center text-focus/70 shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
        <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6" />
      </div>
    </Card>
  )
}
