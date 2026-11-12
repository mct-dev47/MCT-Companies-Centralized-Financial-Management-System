import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import * as React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Loader2, AlertCircle, Check, ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp'
import { Button } from '@/components/ui/button'
import { useSession } from '@/hooks/useSession'
import { useCountdown } from '@/hooks/useCountdown'
import { authService } from '@/services/authService'

interface TwoFactorDialogProps {
  open: boolean
}

export const TwoFactorDialog: React.FC<TwoFactorDialogProps> = ({ open }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { verify2FA, resend2FA, complete2FA } = useSession()
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [isResending, setIsResending] = React.useState(false)
  const [isSuccess, setIsSuccess] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const resendCountdown = useCountdown({ initialSeconds: 120, autoStart: false })
  const lockoutCountdown = useCountdown({ initialSeconds: 0, autoStart: false })

  const challengeEmail = (location.state as { email?: string })?.email
  const resendStop = resendCountdown.stop
  const lockoutStop = lockoutCountdown.stop
  const resendStart = resendCountdown.start
  const lockoutStart = lockoutCountdown.start

  // Synchronize server authoritative cooldown and resend lockout state on mount (AC-15, AC-19)
  React.useEffect(() => {
    let isCurrent = true
    async function syncStatus() {
      try {
        const st = await authService.getRateLimitStatus(challengeEmail)
        if (!isCurrent) return
        if (st.resend_locked && st.resend_retry_after > 0) {
          resendStop()
          lockoutStart(st.resend_retry_after)
        } else if (st.cooldown_remaining > 0) {
          resendStart(st.cooldown_remaining)
        } else {
          resendStop()
        }
      } catch {
        // keep fallback 120 running
      }
    }
    if (open) {
      resendStart(120)
      syncStatus()
    } else {
      resendStop()
      lockoutStop()
    }
    return () => {
      isCurrent = false
    }
  }, [open, challengeEmail, resendStart, resendStop, lockoutStart, lockoutStop])

  const resetState = React.useCallback(() => {
    setCode('')
    setError(null)
    setIsLoading(false)
    setIsResending(false)
    setIsSuccess(false)
    resendStop()
    lockoutStop()
  }, [resendStop, lockoutStop])

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState()
      navigate('/login')
    }
  }

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (code.length !== 6 || isLoading || isResending) return

    try {
      setError(null)
      setIsLoading(true)
      await verify2FA(code)
      setIsSuccess(true)
    } catch (err: unknown) {
      setError(formatUserFriendlyErrorMessage(err, 'Invalid authentication code. Please try again.'))
      if (inputRef.current) {
        inputRef.current.focus()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleContinue = async () => {
    await complete2FA()
    const { authService } = await import('@/services/authService')
    const sessionUser = await authService.getSession()
    resetState()
    const role = (sessionUser?.role || '').toLowerCase()
    const assignedCount = Math.max(
      sessionUser?.companyIds?.length || 0,
      sessionUser?.companyNames?.length || 0,
      sessionUser?.assignedCompanies?.length || 0
    )

    if (role === 'admin') {
      navigate('/employee', { replace: true })
    } else if (assignedCount >= 2) {
      navigate('/centralized-auth', { replace: true })
    } else if (role === 'finance' || role === 'audit' || role.includes('audit')) {
      navigate('/centralized-auth', { replace: true })
    } else {
      const singleComp = sessionUser?.companyNames?.[0] || sessionUser?.companyName
      if (singleComp && typeof window !== 'undefined') {
        sessionStorage.setItem('mct_selected_company', singleComp)
      }
      navigate('/dashboard', { replace: true })
    }
  }

  const isVerifyDisabled = code.length !== 6 || isLoading || isResending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px] sm:max-w-[500px] rounded-[24px] p-6 sm:p-8 bg-white border border-slate-200/80 shadow-2xl outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0">
        {isSuccess ? (
          <div className="space-y-6 text-center py-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-surface border border-stroke/40 text-focus shadow-xs">
              <Check className="h-7 w-7 stroke-[2.5]" aria-hidden="true" />
            </div>

            <DialogHeader className="text-center sm:text-center space-y-2">
              <DialogTitle className="text-xl sm:text-2xl font-bold text-focus text-center">
                Authentication Successful
              </DialogTitle>
              <DialogDescription className="text-center text-muted-fg text-xs sm:text-sm leading-relaxed max-w-xs mx-auto">
                Your identity has been verified. Welcome to the MCT Financial
                Management System.
              </DialogDescription>
            </DialogHeader>

            <div className="pt-2 w-full">
              <Button
                type="button"
                onClick={handleContinue}
                className="w-full h-11 text-sm font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs transition-all cursor-pointer"
              >
                Continue to System
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <DialogHeader className="text-center sm:text-center flex flex-col items-center space-y-2">
              <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xs mb-1">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <DialogTitle className="text-2xl font-bold text-focus text-center">
                Two-Factor Authentication
              </DialogTitle>
              <DialogDescription className="text-center text-muted-fg text-sm leading-relaxed max-w-sm mx-auto">
                Enter the 6-digit code sent to your registered email to complete
                signing in{challengeEmail ? ` (${challengeEmail})` : ''}.
              </DialogDescription>
            </DialogHeader>

            {/* Error Alert */}
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-center gap-3 rounded-xl border border-error/30 bg-error/10 p-3.5 text-xs sm:text-sm text-error font-medium"
              >
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 6-digit OTP Form */}
            <form onSubmit={handleVerify} className="space-y-6">
              <div className="flex flex-col items-center justify-center space-y-3">
                <InputOTP
                  ref={inputRef}
                  maxLength={6}
                  value={code}
                  onChange={(val) => {
                    setCode(val)
                    if (error) setError(null)
                  }}
                  pattern="^[0-9]*$"
                  autoComplete="one-time-code"
                  aria-label="6-digit two-factor authentication code"
                  disabled={isLoading || isResending}
                >
                  <InputOTPGroup aria-label="First 3 digits">
                    <InputOTPSlot index={0} isError={!!error} />
                    <InputOTPSlot index={1} isError={!!error} />
                    <InputOTPSlot index={2} isError={!!error} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup aria-label="Last 3 digits">
                    <InputOTPSlot index={3} isError={!!error} />
                    <InputOTPSlot index={4} isError={!!error} />
                    <InputOTPSlot index={5} isError={!!error} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 w-full pt-1">
                <Button
                  type="submit"
                  disabled={isVerifyDisabled}
                  className="w-full h-11 text-sm font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    'Verify & Sign In'
                  )}
                </Button>

                <div className="space-y-1.5 w-full">
                  <div className="text-center text-xs sm:text-sm text-muted-fg font-medium">
                    {lockoutCountdown.secondsLeft > 0
                      ? `Resend locked. Try again in ${lockoutCountdown.formattedTime}`
                      : resendCountdown.secondsLeft > 0
                      ? `Resend code in ${resendCountdown.formattedTime}`
                      : 'You can request a new code.'}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        setIsResending(true)
                        setError(null)
                        const result = await resend2FA()
                        setCode('')
                        resendStart(result.resendAvailableIn || 120)
                      } catch (err: unknown) {
                        const anyErr = err as any
                        const retrySec = anyErr?.retry_after || anyErr?.response?.data?.retry_after || anyErr?.data?.retry_after
                        if (anyErr?.code === 'OTP_RESEND_LOCKED' || (retrySec && Number(retrySec) > 120)) {
                          lockoutStart(Number(retrySec || 900))
                        } else if (retrySec && Number(retrySec) > 0) {
                          resendStart(Number(retrySec))
                        }
                        setError(formatUserFriendlyErrorMessage(err, 'Unable to resend the code.'))
                      } finally {
                        setIsResending(false)
                      }
                    }}
                    disabled={lockoutCountdown.secondsLeft > 0 || resendCountdown.secondsLeft > 0 || isLoading || isResending}
                    className="w-full h-11 text-xs sm:text-sm font-semibold rounded-xl border-stroke/40 hover:bg-surface text-focus transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isResending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Resending…
                      </>
                    ) : (
                      'Resend Code'
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
