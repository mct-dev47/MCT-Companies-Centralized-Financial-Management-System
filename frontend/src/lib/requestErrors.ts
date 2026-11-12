/**
 * Error types for save requests (spec 0038).
 *
 * Both extend Error, so existing callers that only read `err.message` keep working.
 * The offline queue uses them to tell "no internet" (keep the entry and retry) apart
 * from "the server said no" (show the message, never queue).
 */

/** The server answered with a non 2xx status. */
export class HttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** The request never got an answer (offline, DNS failure, server down). */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/** Gateway statuses mean the backend itself could not be reached. */
const UNREACHABLE_STATUSES = new Set([502, 503, 504])

/**
 * True when the save failed because the server could not be reached,
 * so the entry should wait in the outbox instead of being shown as an error.
 */
export function isConnectivityError(err: unknown): boolean {
  if (err instanceof NetworkError) return true
  if (err instanceof TypeError) return true // fetch() rejects with TypeError when offline
  if (err instanceof HttpError) return UNREACHABLE_STATUSES.has(err.status)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return false
}

/** True when the server rejected the request because the session is no longer valid. */
export function isAuthError(err: unknown): boolean {
  return err instanceof HttpError && err.status === 401
}

/** True for a server error worth retrying later (500 and up). */
export function isServerError(err: unknown): boolean {
  return err instanceof HttpError && err.status >= 500
}
