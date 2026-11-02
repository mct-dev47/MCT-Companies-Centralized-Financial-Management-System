/**
 * Centralized Error Sanitization Utility
 * Formats raw exceptions, network failures, and HTTP error responses into concise,
 * friendly, non-verbose messages so users never see raw technical messages
 * like "Failed to fetch", "Error 500", or Python tracebacks.
 */

export function formatUserFriendlyErrorMessage(
  err: unknown,
  fallbackMessage: string = 'An unexpected error occurred. Please try again.'
): string {
  if (!err) return fallbackMessage

  let rawMessage = ''
  let status: number | undefined

  if (typeof err === 'string') {
    rawMessage = err
  } else if (err instanceof Error) {
    rawMessage = err.message
    const statusMatch = rawMessage.match(/\b([45]\d{2})\b/)
    if (statusMatch) {
      status = parseInt(statusMatch[1], 10)
    }
  } else if (typeof err === 'object') {
    const anyErr = err as any
    status = anyErr.status || anyErr.statusCode
    if (typeof anyErr.detail === 'string') {
      rawMessage = anyErr.detail
    } else if (Array.isArray(anyErr.detail)) {
      rawMessage = anyErr.detail.map((d: any) => d?.msg || String(d)).join(', ')
    } else {
      rawMessage = anyErr.message || anyErr.error || ''
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
    lower.includes('cannot connect')
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
      if (rawMessage && rawMessage.length < 120 && !lower.includes('sql') && !lower.includes('traceback')) {
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
  if (status === 401 || lower.includes('unauthorized')) {
    return 'Your session has expired. Please sign in again to continue.'
  }
  if (status === 403 || lower.includes('forbidden') || lower.includes('permission')) {
    return 'You do not have permission to perform this operation.'
  }

  // 8. HTTP 422 / 400 Validation Errors
  if (status === 422 || status === 400 || lower.includes('validation')) {
    if (rawMessage && !lower.includes('object') && !lower.includes('error:') && rawMessage.length < 100) {
      return rawMessage.replace(/^(error|validation error):\s*/i, '').trim()
    }
    return 'Please check the entered values and ensure all required fields are correct.'
  }

  // 9. Strip code stack traces, file paths, and syntax exceptions
  if (
    lower.includes('at ') ||
    lower.includes('line ') ||
    lower.includes('sql') ||
    lower.includes('typeerror') ||
    lower.includes('referenceerror') ||
    lower.includes('exception') ||
    lower.includes('file ')
  ) {
    return fallbackMessage
  }

  // 10. Clean user-ready messages
  const cleaned = rawMessage.replace(/HTTP \d+ \w+:\s*/i, '').trim()
  if (cleaned.length > 0 && cleaned.length < 140) {
    // Capitalize first letter if needed
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }

  return fallbackMessage
}

