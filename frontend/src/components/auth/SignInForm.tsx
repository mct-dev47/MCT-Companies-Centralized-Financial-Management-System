import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
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

export const SignInForm: React.FC = () => {
  const navigate = useNavigate()
  const { signIn } = useSession()
  const [serverError, setServerError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

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

  const onSubmit = async (values: SignInFormValues) => {
    try {
      setServerError(null)
      setIsLoading(true)
      const response = await signIn(values)

      if (response.status === 'authenticated') {
        const role = (response.user.role || '').toLowerCase()
        const assignedCount = Math.max(
          response.user.companyIds?.length || 0,
          response.user.companyNames?.length || 0
        )

        if (role === 'admin') {
          navigate('/employee', { replace: true })
        } else if (assignedCount >= 2) {
          navigate('/centralized-auth', { replace: true })
        } else if (role === 'finance') {
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
      const message =
        err instanceof Error ? err.message : 'Invalid email or password.'
      setServerError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-[480px] sm:max-w-[540px] px-6 sm:px-8 py-8 mx-auto">
      {/* Header Block */}
      <div className="text-center mb-8">
        <h1 className="text-4xl sm:text-5xl lg:text-heading font-bold text-primary tracking-tight">
          Welcome Back!
        </h1>
        <p className="mt-2 text-base sm:text-lg text-muted-fg font-normal">
          Sign in to access MCT Financial Management System
        </p>
      </div>

      {/* Server Error Alert Banner */}
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-6 flex items-center gap-3 rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Main Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
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
                    leadingIcon={<Mail className="h-5 w-5" />}
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
          <div className="flex items-center justify-between pt-1">
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id="remember-me"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <Label
                    htmlFor="remember-me"
                    className="text-sm font-normal text-focus cursor-pointer select-none"
                  >
                    Remember me
                  </Label>
                </div>
              )}
            />

            <Link
              to="/forgot-password"
              className="text-sm font-semibold text-focus hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
            >
              Forgot Password?
            </Link>
          </div>

          {/* Submit Button - Solid Vibrant #960C01 */}
          <div className="pt-2">
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-14 text-base font-semibold shadow-sm bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
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
