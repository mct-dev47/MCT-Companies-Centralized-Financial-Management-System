import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Lock, Eye, EyeOff, CheckCircle2, XCircle, ArrowRight, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'

const scrubUrlToken = () => {
  if (typeof window === 'undefined') return
  if (window.location.hash || window.location.search) {
    try {
      window.history.replaceState(
        window.history.state,
        document.title,
        window.location.pathname
      )
    } catch {
      // ignore
    }
  }
}

const extractTokenFromUrl = (): string => {
  if (typeof window === 'undefined') return ''
  try {
    let extracted = ''
    // 1. Read token from URL hash (#token=... or #/auth/setup-password?token=...)
    if (window.location.hash) {
      const match = window.location.hash.match(/token=([^&]+)/)
      if (match) extracted = decodeURIComponent(match[1])
    }
    // 2. Read token from query parameters (?token=...)
    if (!extracted && window.location.search) {
      const params = new URLSearchParams(window.location.search)
      const qToken = params.get('token')
      if (qToken) extracted = qToken
    }
    // 3. Fallback to tab sessionStorage (preserves token across StrictMode double runs and accidental page refresh)
    if (!extracted) {
      extracted = sessionStorage.getItem('mct_setup_token') || ''
    }

    if (extracted) {
      try {
        sessionStorage.setItem('mct_setup_token', extracted)
      } catch {
        // ignore
      }
      scrubUrlToken()
    }

    return extracted
  } catch {
    return ''
  }
}

export const SetupPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const [token, setToken] = useState<string>(() => extractTokenFromUrl())
  const [purpose, setPurpose] = useState<string>('initial_password_setup')
  const [maskedEmail, setMaskedEmail] = useState<string>('')
  const [isValidating, setIsValidating] = useState<boolean>(true)
  const [validationError, setValidationError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const validateToken = useCallback(async (tokenToValidate: string) => {
    try {
      setIsValidating(true)
      setValidationError(null)

      const res = await fetch('/api/v1/auth/tokens/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: tokenToValidate }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 410) {
          setValidationError('This security link has expired. Please request a new one.')
        } else if (res.status === 400) {
          setValidationError(data.detail || 'This security link has already been used or has been revoked.')
        } else if (res.status === 403) {
          setValidationError(data.detail || 'Your account is not eligible to complete this action. Please contact an administrator.')
        } else if (res.status === 422) {
          setValidationError('The security link is invalid or malformed.')
        } else {
          setValidationError(data.detail || 'Unable to validate security link. Please request a fresh link.')
        }
        return
      }

      setPurpose(data.purpose || 'initial_password_setup')
      setMaskedEmail(data.masked_email || '')
    } catch (err: unknown) {
      setValidationError(formatUserFriendlyErrorMessage(err, 'Unable to connect to the server to validate your link.'))
    } finally {
      setIsValidating(false)
    }
  }, [])

  useEffect(() => {
    // 1. Set referrer policy to prevent leaking token
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)

    // 2. Validate token and persist to sessionStorage, then scrub address bar
    const currentToken = token || extractTokenFromUrl()
    if (currentToken) {
      if (!token) {
        setToken(currentToken)
      }
      try {
        sessionStorage.setItem('mct_setup_token', currentToken)
      } catch {
        // ignore
      }
      scrubUrlToken()
      const t0 = setTimeout(scrubUrlToken, 0)
      const t1 = setTimeout(scrubUrlToken, 50)
      const t2 = setTimeout(scrubUrlToken, 200)

      validateToken(currentToken)

      const handleHashOrPopState = () => {
        const freshToken = extractTokenFromUrl()
        if (freshToken) {
          setToken(freshToken)
          scrubUrlToken()
          validateToken(freshToken)
        }
      }

      window.addEventListener('hashchange', handleHashOrPopState)
      window.addEventListener('popstate', handleHashOrPopState)

      return () => {
        clearTimeout(t0)
        clearTimeout(t1)
        clearTimeout(t2)
        window.removeEventListener('hashchange', handleHashOrPopState)
        window.removeEventListener('popstate', handleHashOrPopState)
        document.head.removeChild(meta)
      }
    } else {
      setIsValidating(false)
      setValidationError('No security token found in link. Please check your email or request a new reset link.')
    }

    return () => {
      document.head.removeChild(meta)
    }
  }, [token, validateToken])

  // Validation rules
  const hasMinLength = password.length >= 10
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[!@#$%^&*(),.?":{}|<>\-_]/.test(password)
  const passwordsMatch = password.length > 0 && password === confirmPassword
  const isFormValid = hasMinLength && hasUpper && hasLower && hasNumber && hasSymbol && passwordsMatch

  const isPasswordReset = purpose === 'password_reset'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) {
      setSubmitError('Missing security token. Please use the link sent to your email.')
      return
    }
    if (!isFormValid) {
      setSubmitError('Please ensure your password meets all complexity requirements.')
      return
    }

    try {
      setIsSubmitting(true)
      setSubmitError(null)

      const endpoint = isPasswordReset ? '/api/v1/auth/reset-password' : '/api/v1/auth/setup-password'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          new_password: password,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to set password. Link may be expired or already used.')
      }

      setSuccess(true)
      try {
        sessionStorage.removeItem('mct_setup_token')
      } catch {
        // ignore storage errors
      }
    } catch (err: unknown) {
      setSubmitError(formatUserFriendlyErrorMessage(err, 'Failed to update password. Please try again or request a fresh link.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md bg-white rounded-2xl sm:rounded-3xl shadow-xl border border-slate-100 p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-2">
            {isPasswordReset ? <Lock className="h-8 w-8" /> : <ShieldCheck className="h-8 w-8" />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isPasswordReset ? 'Reset Your Password' : 'Set Up Your Password'}
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            {isPasswordReset
              ? `Enter a new secure password for ${maskedEmail || 'your account'}.`
              : 'Welcome to MCT Financial Management System. Please choose a strong password to activate your account.'}
          </p>
        </div>

        {isValidating ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-xs font-medium">Verifying security token...</p>
          </div>
        ) : validationError ? (
          <div className="space-y-6 text-center">
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/70 text-amber-900 space-y-2 text-left">
              <div className="flex items-center gap-2 font-semibold text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Security Notice</span>
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                {validationError}
              </p>
            </div>
            <Button
              onClick={() => navigate('/login')}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold flex items-center justify-center gap-2 transition-all shadow-md"
            >
              <span>Return to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : success ? (
          <div className="space-y-6 text-center">
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/60 text-emerald-800 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
              <p className="font-semibold text-base">
                {isPasswordReset ? 'Password Reset Complete!' : 'Account Activated!'}
              </p>
              <p className="text-xs text-emerald-700 leading-relaxed">
                {isPasswordReset
                  ? 'Your password has been successfully updated. All active sessions have been terminated. You may now sign in with your new credentials.'
                  : 'Your password has been successfully configured. You may now sign in to access your dashboard.'}
              </p>
            </div>
            <Button
              onClick={() => navigate('/login')}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold flex items-center justify-center gap-2 transition-all shadow-md"
            >
              <span>Go to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {submitError && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/70 text-red-700 text-xs flex items-start gap-2.5">
                <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs font-semibold text-slate-700">
                New Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter a secure password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-11 h-11 rounded-xl text-sm"
                  disabled={isSubmitting || !token}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-xs font-semibold text-slate-700">
                Confirm New Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 pr-11 h-11 rounded-xl text-sm"
                  disabled={isSubmitting || !token}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  aria-pressed={showConfirm}
                >
                  {showConfirm ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {/* Password Complexity Checklist */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 space-y-2 text-xs">
              <p className="font-semibold text-slate-700">Password Requirements:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>10+ characters</span>
                </div>
                <div className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Uppercase letter</span>
                </div>
                <div className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Lowercase letter</span>
                </div>
                <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>At least one number</span>
                </div>
                <div className={`flex items-center gap-1.5 ${hasSymbol ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Special character</span>
                </div>
                <div className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Passwords match</span>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !isFormValid || !token}
              className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold transition-all shadow-md"
            >
              {isSubmitting
                ? isPasswordReset ? 'Resetting Password...' : 'Setting up Password...'
                : isPasswordReset ? 'Reset Password' : 'Activate Account'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
