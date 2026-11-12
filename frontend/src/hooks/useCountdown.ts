import * as React from 'react'

export interface UseCountdownOptions {
  initialSeconds: number
  autoStart?: boolean
  onExpire?: () => void
}

export function useCountdown({ initialSeconds, autoStart = true, onExpire }: UseCountdownOptions) {
  const [secondsLeft, setSecondsLeft] = React.useState<number>(autoStart ? initialSeconds : 0)
  const [isRunning, setIsRunning] = React.useState<boolean>(autoStart && initialSeconds > 0)
  const [trigger, setTrigger] = React.useState<number>(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const endTimeRef = React.useRef<number | null>(
    autoStart && initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : null
  )
  const onExpireRef = React.useRef(onExpire)

  React.useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stop = React.useCallback(() => {
    clearTimer()
    endTimeRef.current = null
    setIsRunning(false)
    setSecondsLeft(0)
  }, [clearTimer])

  const start = React.useCallback(
    (seconds?: number) => {
      clearTimer()
      const target = typeof seconds === 'number' ? seconds : initialSeconds
      if (target <= 0) {
        setSecondsLeft(0)
        endTimeRef.current = null
        setIsRunning(false)
        return
      }
      setSecondsLeft(target)
      endTimeRef.current = Date.now() + target * 1000
      setIsRunning(true)
      setTrigger((prev) => prev + 1)
    },
    [clearTimer, initialSeconds]
  )

  React.useEffect(() => {
    if (!isRunning || !endTimeRef.current) {
      clearTimer()
      return
    }

    const tick = () => {
      if (!endTimeRef.current) return
      const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining <= 0) {
        clearTimer()
        endTimeRef.current = null
        setIsRunning(false)
        onExpireRef.current?.()
      }
    }

    tick()
    timerRef.current = setInterval(tick, 1000)

    return () => clearTimer()
  }, [isRunning, trigger, clearTimer])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  // Aria announcement string: only at start, 10s, and expiry (0s)
  const ariaAnnouncement = React.useMemo(() => {
    if (initialSeconds > 0 && secondsLeft === 0) {
      return 'Code has expired. Please request a new code.'
    }
    if (initialSeconds > 0 && secondsLeft === initialSeconds) {
      return `Code expires in ${minutes} minutes and ${seconds} seconds`
    }
    if (secondsLeft === 10) {
      return 'Code expires in 10 seconds'
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
