import * as React from 'react'

export interface UseCountdownOptions {
  initialSeconds: number
  onExpire?: () => void
}

export function useCountdown({ initialSeconds, onExpire }: UseCountdownOptions) {
  const [secondsLeft, setSecondsLeft] = React.useState<number>(initialSeconds)
  const [isRunning, setIsRunning] = React.useState<boolean>(true)
  const timerRef = React.useRef<NodeJS.Timeout | null>(null)
  const onExpireRef = React.useRef(onExpire)
  React.useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  const stop = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsRunning(false)
  }, [])

  const start = React.useCallback((seconds?: number) => {
    stop()
    const target = typeof seconds === 'number' ? seconds : initialSeconds
    setSecondsLeft(target)
    setIsRunning(true)
  }, [initialSeconds, stop])

  React.useEffect(() => {
    if (!isRunning) return

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          setIsRunning(false)
          onExpireRef.current?.()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isRunning])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  // Aria announcement string: only at start, 10s, and expiry (0s)
  const ariaAnnouncement = React.useMemo(() => {
    if (secondsLeft === initialSeconds) {
      return `Code expires in ${minutes} minutes and ${seconds} seconds`
    }
    if (secondsLeft === 10) {
      return 'Code expires in 10 seconds'
    }
    if (secondsLeft === 0) {
      return 'Code has expired. Please request a new code.'
    }
    return ''
  }, [secondsLeft, initialSeconds, minutes, seconds])

  return {
    secondsLeft,
    formattedTime,
    isExpired: secondsLeft === 0,
    isRunning,
    start,
    stop,
    ariaAnnouncement,
  }
}
