import * as React from 'react'
import {
  authService,
  type User,
  type SignInResult,
  type Verify2FAResponse,
  type Resend2FAResponse,
} from '@/services/authService'
import type { SignInFormValues } from '@/lib/validation/auth'
import { clearNotificationCache } from '@/services/notificationService'

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface SessionContextValue {
  status: SessionStatus
  user: User | null
  signIn: (values: SignInFormValues) => Promise<SignInResult>
  verify2FA: (code: string) => Promise<Verify2FAResponse>
  resend2FA: () => Promise<Resend2FAResponse>
  complete2FA: () => Promise<void>
  signOut: () => Promise<void>
  updateUser: (partial: Partial<User>) => void
}

export const SessionContext = React.createContext<SessionContextValue | undefined>(
  undefined
)

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = React.useState<SessionStatus>('loading')
  const [user, setUser] = React.useState<User | null>(null)
  const idleTimer = React.useRef<number | null>(null)

  const resetIdleTimer = React.useCallback(() => {
    authService.touchSessionActivity()
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current)
    }
    if (status === 'authenticated') {
      idleTimer.current = window.setTimeout(() => {
        void handleSignOut()
      }, 2 * 60 * 60 * 1000)
    }
  }, [status])

  React.useEffect(() => {
    if (status !== 'authenticated') return
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((event) => window.addEventListener(event, resetIdleTimer))
    resetIdleTimer()
    return () => {
      events.forEach((event) => window.removeEventListener(event, resetIdleTimer))
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    }
  }, [status, resetIdleTimer])

  // Bootstrap session from in-memory service on initial load
  React.useEffect(() => {
    let isMounted = true

    const bootstrapSession = async () => {
      try {
        const sessionUser = await authService.getSession()
        if (!isMounted) return

        if (sessionUser) {
          setUser(sessionUser)
          setStatus('authenticated')
        } else {
          setUser(null)
      clearNotificationCache()
          setStatus('unauthenticated')
        }
      } catch {
        if (!isMounted) return
        setUser(null)
      clearNotificationCache()
        setStatus('unauthenticated')
      }
    }

    bootstrapSession()

    return () => {
      isMounted = false
    }
  }, [])

  const handleSignIn = React.useCallback(
    async (values: SignInFormValues): Promise<SignInResult> => {
      const result = await authService.signIn(values)
      if (result.status === 'authenticated') {
        setUser(result.user)
        setStatus('authenticated')
      }
      return result
    },
    []
  )

  const handleVerify2FA = React.useCallback(
    async (code: string): Promise<Verify2FAResponse> => {
      return authService.verify2FA(code)
    },
    []
  )

  const handleResend2FA = React.useCallback(
    async (): Promise<Resend2FAResponse> => authService.resend2FA(),
    []
  )

  const handleComplete2FA = React.useCallback(async (): Promise<void> => {
    const sessionUser = await authService.getSession()
    setUser(sessionUser)
    setStatus('authenticated')
  }, [])

  const handleSignOut = React.useCallback(async (): Promise<void> => {
    try {
      await authService.signOut()
    } finally {
      // Regardless of outcome, clear session state in memory
      setUser(null)
      clearNotificationCache()
      setStatus('unauthenticated')
    }
  }, [])

  const handleUpdateUser = React.useCallback((partial: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null
      const updated = { ...prev, ...partial }
      authService.updateSessionUser(partial)
      return updated
    })
  }, [])

  const value = React.useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      signIn: handleSignIn,
      verify2FA: handleVerify2FA,
      resend2FA: handleResend2FA,
      complete2FA: handleComplete2FA,
      signOut: handleSignOut,
      updateUser: handleUpdateUser,
    }),
    [status, user, handleSignIn, handleVerify2FA, handleResend2FA, handleComplete2FA, handleSignOut, handleUpdateUser]
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
