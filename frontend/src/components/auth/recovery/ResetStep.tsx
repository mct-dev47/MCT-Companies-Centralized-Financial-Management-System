import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Circle, Loader2, AlertCircle, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PasswordInput } from '@/components/auth/PasswordInput'
import {
  resetPasswordSchema,
  validatePasswordRules,
  type ResetPasswordFormValues,
} from '@/lib/validation/recovery'
import { passwordRecoveryService } from '@/services/passwordRecoveryService'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

interface ResetStepProps {
  resetToken: string
  onResetComplete: () => void
}

export const ResetStep: React.FC<ResetStepProps> = ({
  resetToken,
  onResetComplete,
}) => {
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  const passwordValue = form.watch('password') || ''
  const confirmPasswordValue = form.watch('confirmPassword') || ''

  const rules = validatePasswordRules(passwordValue)
  const passwordsMatch =
    confirmPasswordValue.length > 0 &&
    passwordValue === confirmPasswordValue

  const areAllRulesMet = rules.minLength && rules.hasLetterAndNumber && passwordsMatch
  const isDoneDisabled = !areAllRulesMet || isLoading

  const onSubmit = async (values: ResetPasswordFormValues) => {
    try {
      setServerError(null)
      setIsLoading(true)
      await passwordRecoveryService.resetPassword(resetToken, values.password)
      onResetComplete()
    } catch (err: unknown) {
      setServerError(formatUserFriendlyErrorMessage(err, 'Unable to reset password. Please try again.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-[#960C01]">
          <KeyRound className="w-6 h-6" />
        </div>
        <DialogHeader className="text-center sm:text-center space-y-1">
          <DialogTitle className="text-2xl font-bold tracking-tight text-[#0B0F2B]">
            Reset Password
          </DialogTitle>
          <DialogDescription className="text-sm text-[#4E5BA6] max-w-sm mx-auto">
            Choose a strong password to secure your account.
          </DialogDescription>
        </DialogHeader>
      </div>

      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-3 rounded-xl border border-error/30 bg-error/10 p-3.5 text-xs sm:text-sm text-error font-medium"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{serverError}</span>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label htmlFor="new-password">New Password</Label>
                <FormControl>
                  <PasswordInput
                    id="new-password"
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    error={!!fieldState.error}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <FormControl>
                  <PasswordInput
                    id="confirm-password"
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    error={!!fieldState.error}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Real-time Checklist of Password Rules */}
          <div className="rounded-xl bg-surface border border-stroke/40 p-4 space-y-2 mt-2">
            <p className="text-xs font-semibold text-focus">Password requirements:</p>
            <ul className="space-y-1.5 text-xs">
              <li
                className={cn(
                  'flex items-center gap-2 transition-colors',
                  rules.minLength ? 'text-focus font-medium' : 'text-muted-fg'
                )}
              >
                {rules.minLength ? (
                  <Check className="h-4 w-4 stroke-[3] text-focus shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-fg/60 shrink-0" aria-hidden="true" />
                )}
                <span>At least 8 characters long</span>
                <span className="sr-only">
                  {rules.minLength ? '(Requirement met)' : '(Requirement not met)'}
                </span>
              </li>

              <li
                className={cn(
                  'flex items-center gap-2 transition-colors',
                  rules.hasLetterAndNumber ? 'text-focus font-medium' : 'text-muted-fg'
                )}
              >
                {rules.hasLetterAndNumber ? (
                  <Check className="h-4 w-4 stroke-[3] text-focus shrink-0" aria-hidden="true" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-fg/60 shrink-0" aria-hidden="true" />
                )}
                <span>Includes both letters and numbers</span>
                <span className="sr-only">
                  {rules.hasLetterAndNumber ? '(Requirement met)' : '(Requirement not met)'}
                </span>
              </li>

              {confirmPasswordValue.length > 0 && (
                <li
                  className={cn(
                    'flex items-center gap-2 transition-colors',
                    passwordsMatch ? 'text-focus font-medium' : 'text-error'
                  )}
                >
                  {passwordsMatch ? (
                    <Check className="h-4 w-4 stroke-[3] text-focus shrink-0" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4 text-error shrink-0" aria-hidden="true" />
                  )}
                  <span>Passwords match</span>
                  <span className="sr-only">
                    {passwordsMatch ? '(Requirement met)' : '(Requirement not met)'}
                  </span>
                </li>
              )}
            </ul>
          </div>

          <div className="pt-2 w-full">
            <Button
              type="submit"
              disabled={isDoneDisabled}
              className="w-full h-12 rounded-xl text-base font-semibold bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white shadow-xs transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Resetting password…
                </>
              ) : (
                'Done'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
