/**
 * Centralized Error Sanitization Utility
 * Formats raw exceptions, network failures, and HTTP error responses into concise,
 * friendly, non-verbose messages so users never see raw technical messages
 * like "Failed to fetch", "Error 500", or Python tracebacks.
 *
 * Display conventions (used across every page):
 * - Action feedback (save / delete / export failures, client-side validation,
 *   success confirmations) -> toast via `notifyError` / `notifyWarning` / `notifySuccess`.
 * - Persistent page-load failures and inline form errors -> `<ErrorBanner />`
 *   from `@/components/common/ErrorBanner`, with the message produced by
 *   `formatUserFriendlyErrorMessage`.
 */

import { pushToast } from '@/lib/toastStore'

export function formatSecondsToMMSS(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(minutes)}:${pad(seconds)}`
}

export function formatUserFriendlyErrorMessage(
  err: unknown,
  fallbackMessage: string = 'An unexpected error occurred. Please try again.'
): string {
  if (!err) return fallbackMessage

  let rawMessage = ''
  let status: number | undefined
  let code: string | undefined
  let retryAfter: number | undefined

  if (typeof err === 'string') {
    rawMessage = err
    if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
      try {
        const parsed = JSON.parse(rawMessage)
        if (parsed.code) code = String(parsed.code)
        if (parsed.retry_after) retryAfter = Number(parsed.retry_after)
        if (parsed.detail) rawMessage = String(parsed.detail)
      } catch {
        // ignore
      }
    }
  } else if (err instanceof Error) {
    rawMessage = err.message
    const anyErr = err as any
    status = anyErr.status || anyErr.statusCode || anyErr.response?.status
    code = anyErr.code || anyErr.data?.code || anyErr.response?.data?.code
    retryAfter = anyErr.retry_after || anyErr.data?.retry_after || anyErr.response?.data?.retry_after

    if (rawMessage.startsWith('{') && rawMessage.endsWith('}')) {
      try {
        const parsed = JSON.parse(rawMessage)
        if (parsed.code) code = String(parsed.code)
        if (parsed.retry_after) retryAfter = Number(parsed.retry_after)
        if (parsed.detail) rawMessage = String(parsed.detail)
      } catch {
        // ignore
      }
    }

    const statusMatch = rawMessage.match(/\b([45]\d{2})\b/)
    if (statusMatch && !status) {
      status = parseInt(statusMatch[1], 10)
    }
  } else if (typeof err === 'object') {
    const anyErr = err as any
    status = anyErr.status || anyErr.statusCode || anyErr.response?.status
    code = anyErr.code || anyErr.data?.code || anyErr.response?.data?.code
    retryAfter = anyErr.retry_after || anyErr.data?.retry_after || anyErr.response?.data?.retry_after

    const data = anyErr.response?.data || anyErr.data
    if (data && typeof data === 'object') {
      if (data.code) code = String(data.code)
      if (data.retry_after) retryAfter = Number(data.retry_after)
      if (typeof data.detail === 'string') {
        rawMessage = data.detail
      } else if (Array.isArray(data.detail)) {
        rawMessage = data.detail.map((d: any) => d?.msg || String(d)).join(', ')
      } else if (typeof data.message === 'string') {
        rawMessage = data.message
      }
    }
    if (!rawMessage) {
      if (typeof anyErr.detail === 'string') {
        rawMessage = anyErr.detail
      } else if (Array.isArray(anyErr.detail)) {
        rawMessage = anyErr.detail.map((d: any) => d?.msg || String(d)).join(', ')
      } else {
        rawMessage = anyErr.message || anyErr.error || ''
      }
    }
  }

  // Authoritative machine-readable error code mappings (AC-32)
  if (code) {
    switch (code.toUpperCase()) {
      case 'AUTH_INVALID_CREDENTIALS':
        return 'Invalid email or password.'
      case 'AUTH_RATE_LIMITED':
        return retryAfter && retryAfter > 0
          ? `Too many attempts. Please try again in ${formatSecondsToMMSS(retryAfter)}.`
          : 'Too many attempts. Please try again in 15:00.'
      case 'AUTH_IP_RATE_LIMITED':
        return 'Too many login attempts from this network. Try again later.'
      case 'OTP_COOLDOWN_ACTIVE':
        return retryAfter && retryAfter > 0
          ? `Please wait ${formatSecondsToMMSS(retryAfter)} before requesting another code.`
          : 'Please wait 02:00 before requesting another code.'
      case 'OTP_RESEND_LOCKED':
        return retryAfter && retryAfter > 0
          ? `You have reached the resend limit. Please try again in ${formatSecondsToMMSS(retryAfter)}.`
          : 'You have reached the resend limit. Please try again in 15:00.'
      case 'OTP_INVALID':
        return 'The code is invalid or has expired. Request a new code if needed.'
      case 'OTP_MAX_ATTEMPTS':
        return 'Too many verification attempts. Please sign in again.'
      case 'OTP_DELIVERY_FAILED':
        return 'Unable to send verification code. Please try again later.'
      case 'TOKEN_EXPIRED':
        return 'This link has expired or is no longer valid. Request a new link.'
      case 'API_RATE_LIMITED':
        return 'Too many requests. Please slow down.'
      case 'SERVICE_UNAVAILABLE':
        return 'Authentication service temporarily unavailable. Please try again.'
      case 'INTERNAL_SERVER_ERROR':
        return 'Something went wrong. Please try again later.'
      case 'VALIDATION_ERROR':
        return 'Please check the entered values and ensure all required fields are correct.'
    }
  }

  const lower = rawMessage.toLowerCase()

  // 1. Network / Connection errors (ERR_CONNECTION_REFUSED, Failed to fetch, etc.)
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('err_connection') ||
    lower.includes('connection refused') ||
    lower.includes('network connection failed') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('cannot connect') ||
    lower.includes('connecterror') ||
    lower.includes('econnrefused')
  ) {
    return 'Unable to connect. Please check your internet connection or try again later.'
  }

  // 2. Request timeouts or cancellations
  if (lower.includes('abort') || lower.includes('timeout') || lower.includes('timed out')) {
    return 'The request timed out. Please try again.'
  }

  // 3. HTTP 500 & Unhandled Server Exceptions
  if (
    status === 500 ||
    lower.includes('500') ||
    lower.includes('internal server error') ||
    lower.includes('server error (500)') ||
    lower.includes('server error') ||
    lower.includes('unboundlocalerror') ||
    lower.includes('syntaxerror') ||
    lower.includes('operationalerror') ||
    lower.includes('nameerror') ||
    lower.includes('traceback')
  ) {
    return 'The server encountered a temporary issue while processing your request. Please try again in a few moments.'
  }

  // 4. HTTP 502, 503, 504 Bad Gateway / Service Unavailable
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway timeout')
  ) {
    return 'The service is temporarily unavailable. Please try again shortly.'
  }

  // 5. HTTP 404 Not Found
  if (status === 404 || lower.includes('404') || lower.includes('not found')) {
    return 'The requested record could not be found.'
  }

  // 6. HTTP 409 Conflict (e.g. Period settlement locking, duplicate names)
  if (status === 409 || lower.includes('409') || lower.includes('settled') || lower.includes('already exists') || lower.includes('duplicate')) {
    if (lower.includes('already exists') || lower.includes('duplicate')) {
      if (rawMessage && rawMessage.length < 140 && !lower.includes('sql') && !lower.includes('traceback')) {
        return rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim()
      }
      return 'A record with these details already exists.'
    }
    if (lower.includes('settle')) {
      return 'This billing period or installment is already fully settled and locked.'
    }
    return rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim() || 'A conflicting record was found. Please refresh and try again.'
  }

  // 7. HTTP 401 / 403 Authentication / Authorization
  if (status === 401 || lower.includes('unauthorized') || lower.includes('session has expired') || lower.includes('credentials were not provided')) {
    // Preserve sign-in / OTP failure reasons so a failed login isn't reported as an expired session
    if (
      lower.includes('invalid email or password') ||
      lower.includes('user profile not found') ||
      lower.includes('verification code') ||
      lower.includes('verification session')
    ) {
      return rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim()
    }
    return 'Your session has expired. Please sign in again to continue.'
  }
  if (status === 403 || lower.includes('forbidden') || lower.includes('permission') || lower.includes('access denied')) {
    // Preserve authoritative security policy explanations from server
    if (
      lower.includes('locked') ||
      lower.includes('suspended') ||
      lower.includes('invitation is pending') ||
      lower.includes('password setup') ||
      lower.includes('administrator accounts manage system configuration') ||
      lower.includes('owner accounts') ||
      lower.includes('auditor accounts') ||
      lower.includes('read-only access') ||
      lower.includes('business operations are reserved') ||
      lower.includes('exclusively authorized') ||
      lower.includes('must set up your password')
    ) {
      return rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim()
    }
    return 'You do not have permission to perform this operation.'
  }

  // 8. HTTP 429 Too Many Requests / Rate Limiting
  if (status === 429 || lower.includes('429') || lower.includes('too many requests') || lower.includes('temporarily locked')) {
    if (rawMessage && (lower.includes('minutes') || lower.includes('try again in'))) {
      return rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim()
    }
    return 'Too many requests. Please wait a moment and try again.'
  }

  // 9. Email Delivery & Provider Sanitization (Brevo, Resend, SMTP, Circuit Breaker)
  if (
    lower.includes('brevo') ||
    lower.includes('resend') ||
    lower.includes('smtp') ||
    lower.includes('circuit breaker') ||
    lower.includes('email delivery') ||
    lower.includes('authorised_ips') ||
    lower.includes('authorized_ips') ||
    lower.includes('unrecognised ip') ||
    lower.includes('unrecognized ip')
  ) {
    return 'We were unable to deliver the email verification message right now. Please try again shortly or contact support.'
  }

  // 10. HTTP 422 / 400 Validation Errors & Setup/Invitation Messages
  if (
    status === 422 ||
    status === 400 ||
    lower.includes('validation') ||
    lower.includes('invitation') ||
    lower.includes('password') ||
    lower.includes('@gmail.com') ||
    lower.includes('already been used') ||
    lower.includes('expired') ||
    lower.includes('allowed roles') ||
    lower.includes('invalid role')
  ) {
    if (
      rawMessage &&
      !lower.includes('object') &&
      !lower.includes('traceback') &&
      !lower.includes('sql') &&
      rawMessage.length < 180
    ) {
      return rawMessage.replace(/^(error|validation error):\s*/i, '').replace(/HTTP \d+ \w+:\s*/i, '').trim()
    }
    return 'Please check the entered values and ensure all required fields are correct.'
  }

  // 9. Strip code stack traces, file paths, and syntax exceptions.
  // Stack-frame / traceback markers are matched as patterns rather than bare substrings so that
  // ordinary sentences containing "that ", "at least", "guideline", or "profile" are not discarded.
  if (
    /^\s*at\s|\bat\s+\S+\s+\(/m.test(rawMessage) ||
    /\bline \d+/.test(lower) ||
    /\bfile "/.test(lower) ||
    lower.includes('sql') ||
    lower.includes('typeerror') ||
    lower.includes('referenceerror') ||
    lower.includes('exception')
  ) {
    return fallbackMessage
  }

  // 11. Clean user-ready messages
  const cleaned = rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim()
  if (cleaned.length > 0 && cleaned.length < 180) {
    // Capitalize first letter if needed
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }

  return fallbackMessage
}

/**
 * Show a sanitized error toast for a failed action (API failure, export failure, etc.).
 * Returns the user-facing message so callers can also store it if needed.
 */
export function notifyError(
  err: unknown,
  fallbackMessage: string = 'An unexpected error occurred. Please try again.'
): string {
  const message = formatUserFriendlyErrorMessage(err, fallbackMessage)
  pushToast({ variant: 'error', message })
  return message
}

/**
 * Show a warning toast for client-side validation or blocked actions
 * (e.g. "Please enter a bank name.", "Pop-up blocked..."). The message is shown verbatim,
 * so only pass already user-friendly text here.
 */
export function notifyWarning(message: string): void {
  pushToast({ variant: 'warning', message })
}

/** Show a success toast after a completed action. */
export function notifySuccess(message: string): void {
  pushToast({ variant: 'success', message })
}

/** Show a neutral informational toast. */
export function notifyInfo(message: string): void {
  pushToast({ variant: 'info', message })
}

export const getErrorMessage = formatUserFriendlyErrorMessage
