import * as React from 'react'
import { useSession } from '@/hooks/useSession'
import { cn } from '@/lib/utils'

interface WelcomeBannerProps {
  className?: string
  greetingName?: string
}

export const WelcomeBanner: React.FC<WelcomeBannerProps> = ({
  className,
  greetingName,
}) => {
  const { user } = useSession()
  const name = greetingName || user?.fullName || 'User'

  const [now, setNow] = React.useState<Date>(() => new Date())

  React.useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Live updated date: e.g. "Wednesday, October 21, 2026"
  const dateStr = React.useMemo(() => {
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }, [now])

  // Live updated timestamp: e.g. "03:15:20 PM"
  const timeStr = React.useMemo(() => {
    return now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  }, [now])

  return (
    <div className={cn('flex flex-col gap-1 sm:gap-1.5', className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl lg:text-2.5xl font-bold tracking-tight text-focus leading-tight">
          Welcome Back, {name}!
        </h1>
        <div className="text-2xl sm:text-3xl lg:text-2xl font-bold tracking-tight text-focus tabular-nums shrink-0">
          {timeStr}
        </div>
      </div>

      {/* Date placed directly below greeting */}
      <p className="text-sm sm:text-base text-muted-fg font-medium">
        {dateStr}
      </p>
    </div>
  )
}
