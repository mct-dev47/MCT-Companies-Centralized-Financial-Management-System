/**
 * Global HTTP Error Service & Interceptor
 *
 * Coordinates HTTP error responses (401, 403, 500, 502, 503, 504, etc.)
 * across the application. Differentiates between fatal page-level errors
 * (which display the full ErrorPage) and inline non-fatal errors
 * (which show inline banners or toasts without disrupting unsaved user input).
 */

import * as React from 'react'

export interface HttpErrorEvent {
  status: number
  message?: string
  fatal?: boolean
  url?: string
  timestamp: number
}

type HttpErrorListener = (event: HttpErrorEvent | null) => void
type ErrorNotifier = (err: unknown, fallback?: string, options?: any) => void

const listeners = new Set<HttpErrorListener>()
let currentFatalError: HttpErrorEvent | null = null
let errorNotifier: ErrorNotifier | null = null

export function setHttpErrorNotifier(notifier: ErrorNotifier): void {
  errorNotifier = notifier
}

export const httpErrorService = {
  /**
   * Register a subscriber to HTTP error events
   */
  subscribe(listener: HttpErrorListener): () => void {
    listeners.add(listener)
    // If there is an active fatal error, inform new listener immediately
    if (currentFatalError) {
      listener(currentFatalError)
    }
    return () => {
      listeners.delete(listener)
    }
  },

  /**
   * Dispatch an HTTP error event
   */
  dispatch(status: number, options: { fatal?: boolean; message?: string; url?: string } = {}): void {
    const event: HttpErrorEvent = {
      status,
      message: options.message,
      fatal: options.fatal ?? false,
      url: options.url,
      timestamp: Date.now(),
    }

    if (event.fatal) {
      currentFatalError = event
    }

    listeners.forEach((listener) => {
      try {
        listener(event)
      } catch (e) {
        console.error('Error in HTTP error listener:', e)
      }
    })

    // Also dispatch a browser custom event for maximum interoperability
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mct_http_error', { detail: event }))
    }
  },

  /**
   * Clear any active fatal HTTP error state
   */
  clear(): void {
    currentFatalError = null
    listeners.forEach((listener) => {
      try {
        listener(null)
      } catch (e) {
        console.error('Error clearing HTTP error listener:', e)
      }
    })
  },

  /**
   * Get the active fatal error, if any
   */
  getActiveFatalError(): HttpErrorEvent | null {
    return currentFatalError
  },

  /**
   * Handle an HTTP error response according to application policy:
   * - Fatal (e.g. critical page initialization failed): displays matching ErrorPage
   * - Non-fatal (e.g. form submission failed): shows inline toast/banner to protect user inputs
   */
  handleResponse(
    status: number,
    options: {
      fatal?: boolean
      message?: string
      url?: string
      onRetry?: () => void
    } = {}
  ): void {
    const isFatal = options.fatal ?? false

    if (isFatal) {
      this.dispatch(status, { fatal: true, message: options.message, url: options.url })
    } else {
      // Inline non-fatal error: display toast without full-page takeover
      if (errorNotifier) {
        errorNotifier(
          options.message || { status },
          undefined,
          options.onRetry ? { onRetry: options.onRetry } : undefined
        )
      }
      this.dispatch(status, { fatal: false, message: options.message, url: options.url })
    }
  },
}

/**
 * React hook to observe and respond to global fatal HTTP errors
 */
export function useGlobalHttpError() {
  const [fatalError, setFatalError] = React.useState<HttpErrorEvent | null>(
    httpErrorService.getActiveFatalError()
  )

  React.useEffect(() => {
    return httpErrorService.subscribe((event) => {
      if (event === null) {
        setFatalError(null)
      } else if (event.fatal) {
        setFatalError(event)
      }
    })
  }, [])

  return {
    fatalError,
    clearFatalError: () => httpErrorService.clear(),
  }
}
