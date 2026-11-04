import * as React from 'react'
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { useCountdown } from '@/hooks/useCountdown'
import {
  passwordRecoveryService,
  OTP_TTL_SECONDS,
} from '@/services/passwordRecoveryService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

interface VerifyStepProps {
  email: string
  onVerified: (resetToken: string) => void
}

export const VerifyStep: React.FC<VerifyStepProps> = ({ email, onVerified }) => {
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [isVerifying, setIsVerifying] = React.useState(false)
  const [isResending, setIsResending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const countdown = useCountdown({
    initialSeconds: OTP_TTL_SECONDS,
  })

  // Handle OTP verification
  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (code.length !== 4 || isVerifying || countdown.isExpired) return

    try {
      setError(null)
      setIsVerifying(true)
      const res = await passwordRecoveryService.verifyCode(email, code)
      onVerified(res.resetToken)
    } catch (err: unknown) {
      setError(formatUserFriendlyErrorMessage(err, 'Invalid verification code. Please try again.'))
      // Refocus first slot on error
      if (inputRef.current) {
        inputRef.current.focus()
      }
    } finally {
      setIsVerifying(false)
    }
  }

  // Handle Resend code
  const handleResend = async () => {
    if (!countdown.isExpired || isResending) return

    try {
      setIsResending(true)
      setError(null)
      setCode('') // Clear boxes
      await passwordRecoveryService.resendCode(email)
      countdown.start(OTP_TTL_SECONDS) // Reset timer
      if (inputRef.current) {
        inputRef.current.focus()
      }
    } catch (err: unknown) {
      setError(formatUserFriendlyErrorMessage(err, 'Failed to resend code. Please try again.'))
    } finally {
      setIsResending(false)
    }
  }

  const isVerifyDisabled =
    code.length !== 4 || isVerifying || countdown.isExpired

  return (
    <div className="space-y-6">
      <DialogHeader className="text-center sm:text-center flex flex-col items-center space-y-2">
        <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xs mb-1">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <DialogTitle className="text-2xl font-bold text-focus text-center">Verify Code</DialogTitle>
        <DialogDescription className="text-center text-muted-fg text-sm leading-relaxed max-w-sm mx-auto">
          Enter the 4-digit verification code sent to{' '}
          <strong className="text-focus font-semibold">{email}</strong>
        </DialogDescription>
      </DialogHeader>

      {/* Error Announcement */}
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

      {/* Form with OTP */}
      <form onSubmit={handleVerify} className="space-y-6">
        <div className="flex flex-col items-center justify-center space-y-4">
          <InputOTP
            ref={inputRef}
            maxLength={4}
            value={code}
            onChange={(val) => {
              setCode(val)
              if (error) setError(null)
            }}
            pattern="^[0-9]*$"
            autoComplete="one-time-code"
            aria-label="4-digit verification code"
            disabled={isVerifying}
          >
            <InputOTPGroup aria-label="Verification code digits">
              <InputOTPSlot index={0} isError={!!error} />
              <InputOTPSlot index={1} isError={!!error} />
              <InputOTPSlot index={2} isError={!!error} />
              <InputOTPSlot index={3} isError={!!error} />
            </InputOTPGroup>
          </InputOTP>

          {/* Countdown timer display */}
          <div className="text-center">
            {countdown.isExpired ? (
              <p className="text-xs sm:text-sm font-semibold text-error">
                Code has expired. Please resend a new code.
              </p>
            ) : (
              <p className="text-xs sm:text-sm font-semibold text-error">
                Code expires in {countdown.formattedTime}
              </p>
            )}

            {/* Screen reader only announcement for timer at start, 10s, and expiry */}
            <span aria-live="polite" className="sr-only">
              {countdown.ariaAnnouncement}
            </span>
          </div>
        </div>

        {/* Action Buttons - Full Width Aligned */}
        <div className="space-y-2.5 w-full pt-1">
          <Button
            type="submit"
            disabled={isVerifyDisabled}
            className="w-full h-12 text-base font-semibold rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs transition-all cursor-pointer"
          >
            {isVerifying ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Verifying…
              </>
            ) : (
              'Verify'
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleResend}
            disabled={!countdown.isExpired || isResending}
            className="w-full h-12 text-sm font-semibold rounded-xl border-stroke/40 hover:bg-surface text-focus transition-all cursor-pointer disabled:opacity-50"
          >
            {isResending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Resending…
              </>
            ) : (
              'Resend Code'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
