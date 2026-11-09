import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, CheckCircle2, AlertCircle, ArrowRight, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { passwordRecoveryService } from '@/services/passwordRecoveryService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

interface RecoveryDialogProps {
  open: boolean
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({ open }) => {
  const navigate = useNavigate()
  const [email, setEmail] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const resetFlow = React.useCallback(() => {
    setEmail('')
    setIsSubmitting(false)
    setSubmitted(false)
    setError(null)
  }, [])

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetFlow()
      navigate('/login')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanEmail = email.trim()
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await passwordRecoveryService.requestPasswordReset(cleanEmail)
      setSubmitted(true)
    } catch (err: unknown) {
      setError(formatUserFriendlyErrorMessage(err, 'Unable to send reset instructions. Please try again later.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[480px] sm:max-w-[500px] rounded-[24px] p-6 sm:p-8 bg-white border border-slate-100 shadow-2xl">
        {submitted ? (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-xs">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div className="space-y-2">
              <DialogTitle className="text-2xl font-bold tracking-tight text-slate-900">
                Check Your Email
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
                If an account exists for that email address, you will receive instructions to reset your password.
              </DialogDescription>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-600 leading-relaxed text-left space-y-1.5">
              <p className="font-semibold text-slate-700">Next Steps:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-500">
                <li>Click the secure link inside the email to choose a new password.</li>
                <li>The single-use link expires in 30 minutes for your security.</li>
                <li>If you don&apos;t see the message, check your spam or junk folder.</li>
              </ul>
            </div>

            <Button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold flex items-center justify-center gap-2 transition-all shadow-md"
            >
              <span>Back to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <DialogHeader className="text-center sm:text-center flex flex-col items-center space-y-2">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs mb-1">
                <Mail className="h-7 w-7" />
              </div>
              <DialogTitle className="text-2xl font-bold text-slate-900">
                Forgot Password
              </DialogTitle>
              <DialogDescription className="text-center text-slate-500 text-sm leading-relaxed max-w-sm mx-auto">
                Enter your registered email address below and we will send you a secure link to reset your account credentials.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-center gap-2.5 rounded-xl border border-red-200/80 bg-red-50 p-3.5 text-xs text-red-700 font-medium"
              >
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-1.5 text-left">
                <Label htmlFor="recovery-email" className="text-xs font-semibold text-slate-700">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="recovery-email"
                    type="email"
                    placeholder="name@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 rounded-xl text-sm"
                    disabled={isSubmitting}
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="submit"
                  disabled={isSubmitting || !email.trim()}
                  className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold transition-all shadow-md flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Sending Instructions...</span>
                    </>
                  ) : (
                    <span>Send Reset Instructions</span>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleOpenChange(false)}
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-sm font-medium"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
