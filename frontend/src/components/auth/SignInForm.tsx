import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Mail, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { IconInput } from '@/components/auth/IconInput'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { signInSchema, type SignInFormValues } from '@/lib/validation/auth'
import { useSession } from '@/hooks/useSession'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

export const SignInForm: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useSession()
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  const reasonParam = React.useMemo(() => {
    try {
      const params = new URLSearchParams(location.search)
      return params.get('reason')
    } catch {
      return null
    }
  }, [location.search])

  const expirationNotice = React.useMemo(() => {
    if (reasonParam === 'inactivity') {
      return 'Your session has ended due to 30 minutes of inactivity. Please sign in again.'
    }
    if (reasonParam === 'max_duration') {
      return 'Your session reached the maximum duration of 8 hours. Please sign in again.'
    }
    if (reasonParam === 'revoked') {
      return 'Your session was invalidated due to a security update or password change. Please sign in again.'
    }
    return null
  }, [reasonParam])

  const form = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      email: '',
      password: '',
      rememberMe: false,
    },
  })

  // Ensure Remember Me is always unchecked and fields are reset upon entering sign-in
  React.useEffect(() => {
    form.reset({
      email: '',
      password: '',
      rememberMe: false,
    })
  }, [form])

  const onSubmit = async (values: SignInFormValues) => {
    try {
      setServerError(null)
      setIsLoading(true)
      const response = await signIn(values)

      if (response.status === 'authenticated') {
        const role = (response.user.role || '').toLowerCase()
        const isClarian = Boolean(
          response.user.email?.toLowerCase().includes('clarian') ||
          response.user.email?.toLowerCase() === 'slosizante@gmail.com' ||
          response.user.fullName?.toLowerCase().includes('clarian') ||
          response.user.email?.toLowerCase().includes('jkproperty') ||
          response.user.email?.toLowerCase().includes('filcap')
        )
        const assignedCount = Math.max(
          response.user.companyIds?.length || 0,
          response.user.companyNames?.length || 0,
          response.user.assignedCompanies?.length || 0,
          isClarian ? 2 : 0
        )

        if (role === 'admin') {
          navigate('/employee', { replace: true })
        } else if (assignedCount >= 2 || isClarian) {
          navigate('/centralized-auth', { replace: true })
        } else if (role === 'finance' || role === 'audit' || role.includes('audit')) {
          navigate('/centralized-auth', { replace: true })
        } else {
          const singleComp = response.user.companyNames?.[0] || response.user.companyName
          if (singleComp && typeof window !== 'undefined') {
            sessionStorage.setItem('mct_selected_company', singleComp)
          }
          navigate('/dashboard', { replace: true })
        }
      } else if (response.status === '2fa_required') {
        // Route to 2FA verification step
        navigate('/verify-2fa', { state: { email: response.email } })
      }
    } catch (err: unknown) {
      // Generic server error for bad credentials; never reveal which field failed
      setServerError(formatUserFriendlyErrorMessage(err, 'Invalid email or password.'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-[min(480px,94vw)] px-[clamp(0.75rem,2.5vw,2rem)] py-[clamp(0.5rem,2vh,2rem)] mx-auto">
      {/* Header Block */}
      <div className="text-center mb-[clamp(0.75rem,2.5vh,2rem)]">
        <h1 className="text-[clamp(1.5rem,3.2vh,2.5rem)] md:text-4xl lg:text-heading font-bold text-primary tracking-tight">
          Welcome Back!
        </h1>
        <p className="mt-1 sm:mt-1.5 text-[clamp(0.75rem,1.5vh,1rem)] text-muted-fg font-normal">
          Sign in to access MCT Financial Management System
        </p>
      </div>

      {/* Session Expiration Notice Alert Banner (AC-13) */}
      {expirationNotice && !serverError && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-4 sm:mb-6 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:p-4 text-xs sm:text-sm text-amber-800 dark:text-amber-200"
        >
          <AlertCircle className="h-4 sm:h-5 w-4 sm:w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{expirationNotice}</span>
        </div>
      )}

      {/* Server Error Alert Banner */}
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 sm:mb-6 flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 p-3 sm:p-4 text-xs sm:text-sm text-error"
        >
          <AlertCircle className="h-4 sm:h-5 w-4 sm:w-5 shrink-0" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Main Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-[clamp(0.75rem,1.8vh,1.25rem)]" noValidate>
          {/* Email Field */}
          <FormField
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label htmlFor="sign-in-email" className="sr-only">
                  Email Address
                </Label>
                <FormControl>
                  <IconInput
                    id="sign-in-email"
                    type="email"
                    placeholder="Email Address"
                    autoComplete="email"
                    leadingIcon={<Mail className="h-4 sm:h-5 w-4 sm:w-5" />}
                    error={!!fieldState.error}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Password Field */}
          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem>
                <Label htmlFor="sign-in-password" className="sr-only">
                  Password
                </Label>
                <FormControl>
                  <PasswordInput
                    id="sign-in-password"
                    placeholder="Password"
                    autoComplete="current-password"
                    error={!!fieldState.error}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Remember Me & Forgot Password Row */}
          <div className="flex items-center justify-between pt-0.5 sm:pt-1">
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <div className="flex items-center gap-2 sm:gap-2.5">
                  <Checkbox
                    id="remember-me"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label
                    htmlFor="remember-me"
                    className="text-xs sm:text-sm font-normal text-focus cursor-pointer select-none"
                  >
                    Remember me
                  </Label>
                </div>
              )}
            />

            <Link
              to="/forgot-password"
              className="text-xs sm:text-sm font-semibold text-focus hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
            >
              Forgot Password?
            </Link>
          </div>

          {/* Submit Button - Responsive Height & Typography */}
          <div className="pt-1.5 sm:pt-2">
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 sm:h-12 md:h-14 rounded-xl text-sm sm:text-base md:text-lg font-bold shadow-md shadow-[#960C01]/20 hover:shadow-lg bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white transition-all cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 sm:h-5 w-4 sm:w-5 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
