import * as React from 'react'
import { Calendar, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LiveDateTimeBadgeProps {
  className?: string
  showSeconds?: boolean
}

export const LiveDateTimeBadge: React.FC<LiveDateTimeBadgeProps> = ({
  className,
  showSeconds = true,
}) => {
  const [now, setNow] = React.useState<Date>(() => new Date())

  React.useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Format e.g.: "Wed, Oct 21, 2026"
  const dateStr = React.useMemo(() => {
    return now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }, [now])

  // Format e.g.: "1:45:12 PM"
  const timeStr = React.useMemo(() => {
    return now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: showSeconds ? '2-digit' : undefined,
      hour12: true,
    })
  }, [now, showSeconds])

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2.5 sm:gap-3 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-white border border-stroke/40 text-focus shadow-2xs select-none',
        className
      )}
      aria-label={`Current Date and Time: ${dateStr} ${timeStr}`}
      title="Current System Date & Time"
    >
      <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-focus/90">
        <Calendar className="h-4 w-4 text-primary shrink-0" />
        <span>{dateStr}</span>
      </div>

      <span className="text-muted-fg/40 text-xs sm:text-sm font-light">•</span>

      <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-focus/90">
        <Clock className="h-4 w-4 text-muted-fg shrink-0" />
        <span className="tabular-nums font-semibold">{timeStr}</span>
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse ml-0.5" title="Live clock" />
      </div>
    </div>
  )
}
