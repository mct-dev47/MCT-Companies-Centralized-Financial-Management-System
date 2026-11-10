import type { SignInFormValues } from '@/lib/validation/auth'
import logo2Url from '@/assets/LOGO2.png'
import { encryptPayload } from '@/services/payloadEncryption'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { formatRealName } from '@/utils/formatRealName'

export type UserRole = 'Admin' | 'Finance' | 'Audit' | 'Supervisor' | 'Owner'

/**
 * User session model
 */
export interface User {
  id: string
  fullName: string
  email: string
  role: UserRole | string
  assignedCompany?: string
  assignedCompanies?: string[]
  companyId?: number
  companyIds?: number[]
  companyNames?: string[]
  avatarUrl?: string
}

export type SignInResult =
  | { status: 'authenticated'; user: User }
  | { status: '2fa_required'; email: string }

export interface Verify2FAResponse {
  success: boolean
  token: string
}

export interface Resend2FAResponse {
  expiresIn: number
  resendAvailableIn: number
}


const SESSION_STORAGE_KEY = 'mct_session_user'
const ACCESS_TOKEN_KEY = 'mct_access_token'
const LAST_ACTIVITY_KEY = 'mct_last_activity'
const REMEMBER_ME_KEY = 'mct_remember_me'
const TAB_SESSION_KEY = 'mct_tab_session'
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes idle timeout (AC-5)

let inMemoryAccessToken: string | null = null
let inMemorySessionUser: User | null = null
let proactiveRefreshTimer: number | null = null
let refreshPromise: Promise<User | null> | null = null
let sessionExpirationReason: 'inactivity' | 'max_duration' | null = null

// AC-3 & AC-15: Ensure no legacy tokens remain in browser storage
if (typeof window !== 'undefined') {
  try {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    sessionStorage.removeItem('mct_user')

    // Clean foreign keys lingering from other projects hosted on localhost
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('mapbox.')) {
        localStorage.removeItem(key)
      }
    })
  } catch {
    // ignore
  }

  // Intercept sessionStorage.getItem('mct_access_token') so any unmigrated code
  // reads the live in-memory access token without storing it in browser storage.
  try {
    const originalGetItem = window.sessionStorage.getItem.bind(window.sessionStorage)
    window.sessionStorage.getItem = function (key: string): string | null {
      if (key === ACCESS_TOKEN_KEY) {
        return inMemoryAccessToken
      }
      return originalGetItem(key)
    }
  } catch {
    // ignore
  }
}

export function getAuthToken(): string | null {
  return inMemoryAccessToken
}

function parseTokenExpiration(token: string): number | null {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    )
    if (payload && typeof payload.exp === 'number') {
      return payload.exp * 1000
    }
  } catch {
    // ignore
  }
  return null
}

function scheduleProactiveRefresh(token: string): void {
  if (typeof window === 'undefined') return
  if (proactiveRefreshTimer !== null) {
    window.clearTimeout(proactiveRefreshTimer)
    proactiveRefreshTimer = null
  }
  const expMs = parseTokenExpiration(token)
  if (!expMs) return

  // Schedule refresh 30 seconds before expiration (tokens expire at 300s)
  const delay = Math.max(expMs - Date.now() - 30_000, 10_000)
  proactiveRefreshTimer = window.setTimeout(async () => {
    try {
      await authService.refreshSession()
    } catch {
      // ignore background refresh failure
    }
  }, delay)
}

/**
 * Fallback user detection for offline or temporary utility use.
 */
export function detectUserByEmail(email: string): User {
  const normalized = email.trim().toLowerCase()
  const isClarian =
    normalized.includes('clarian') ||
    normalized === 'slosizante@gmail.com' ||
    normalized.includes('jkproperty') ||
    normalized.includes('filcap')

  if (isClarian) {
    return {
      id: `usr_${Date.now()}`,
      fullName: 'Clarian Cuenta',
      email: email.trim(),
      role: 'Supervisor',
      assignedCompany: 'JK Property and Ventures Corporation, FILCAP Prime Holdings Corp.',
      assignedCompanies: [
        'JK Property and Ventures Corporation',
        'FILCAP Prime Holdings Corp.',
        'JK Global Printing Service',
      ],
      companyId: 5,
      companyIds: [5, 7, 3],
      companyNames: [
        'JK Property and Ventures Corporation',
        'FILCAP Prime Holdings Corp.',
        'JK Global Printing Service',
      ],
      avatarUrl: logo2Url,
    }
  }

  let role: UserRole = 'Supervisor'
  if (normalized.includes('admin')) {
    role = 'Admin'
  } else if (normalized.includes('owner')) {
    role = 'Owner'
  } else if (normalized.includes('audit')) {
    role = 'Audit'
  } else if (normalized.includes('finance')) {
    role = 'Finance'
  }
  return {
    id: `usr_${Date.now()}`,
    fullName: formatRealName(email.trim()),
    email: email.trim(),
    role: role,
    assignedCompany: role === 'Supervisor' ? 'MCT Kitchen' : 'All Companies',
    avatarUrl: logo2Url,
  }
}

async function getRequest<T>(path: string, isRetry: boolean = false): Promise<T> {
  const token = inMemoryAccessToken
  if (!token) {
    if (!isRetry) {
      const refreshed = await authService.refreshSession()
      if (refreshed && inMemoryAccessToken) {
        return getRequest<T>(path, true)
      }
    }
    throw new Error('No access token available')
  }
  const response = await fetch(`/api/v1/auth${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401 && !isRetry) {
    const refreshed = await authService.refreshSession()
    if (refreshed && inMemoryAccessToken) {
      return getRequest<T>(path, true)
    }
    throw new Error('Unauthorized')
  }
  const responseText = await response.text()
  let data: any = {}
  try {
    data = responseText ? JSON.parse(responseText) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    const errorPayload = { status: response.status, ...data }
    const errorMsg = formatUserFriendlyErrorMessage(
      errorPayload,
      data.detail || responseText || `Authentication request failed (${response.status}).`
    )
    const err = new Error(errorMsg)
    Object.assign(err, errorPayload, { response: { status: response.status, data } })
    throw err
  }
  return data as T
}

async function request<T>(path: string, body: unknown, isRetry: boolean = false): Promise<T> {
  const token = inMemoryAccessToken
  const response = await fetch(`/api/v1/auth${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-MCT-CSRF': '1',
      'X-Requested-With': 'XMLHttpRequest',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (response.status === 401 && !isRetry && !path.includes('/login') && !path.includes('/refresh')) {
    const refreshed = await authService.refreshSession()
    if (refreshed && inMemoryAccessToken) {
      return request<T>(path, body, true)
    }
  }
  const responseText = await response.text()
  let data: any = {}
  try {
    data = responseText ? JSON.parse(responseText) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    const errorPayload = { status: response.status, ...data }
    const errorMsg = formatUserFriendlyErrorMessage(
      errorPayload,
      data.detail || responseText || `Authentication request failed (${response.status}).`
    )
    const err = new Error(errorMsg)
    Object.assign(err, errorPayload, { response: { status: response.status, data } })
    throw err
  }
  return data as T
}

export interface BackendUserPayload {
  user_id: number
  email: string
  name: string
  is_admin: boolean
  role?: string
  company_name?: string | null
  company_names?: string[]
  company_id?: number | null
  company_ids?: number[]
  photo_url?: string | null
}

function mapUser(user: BackendUserPayload): User {
  let role: UserRole = 'Supervisor'
  const rawRole = (user.role || '').toLowerCase()

  if (rawRole === 'admin' || user.is_admin) {
    role = 'Admin'
  } else if (rawRole === 'owner') {
    role = 'Owner'
  } else if (rawRole === 'audit') {
    role = 'Audit'
  } else if (rawRole === 'finance') {
    role = 'Finance'
  } else {
    role = 'Supervisor'
  }

  const isClarian =
    user.email?.toLowerCase().includes('clarian') ||
    user.email?.toLowerCase() === 'slosizante@gmail.com' ||
    user.name?.toLowerCase().includes('clarian') ||
    user.email?.toLowerCase().includes('jkproperty') ||
    user.email?.toLowerCase().includes('filcap')

  let userCompanyNames =
    user.company_names && user.company_names.length > 0
      ? [...user.company_names]
      : user.company_name
      ? [user.company_name]
      : []

  let userCompanyIds =
    user.company_ids && user.company_ids.length > 0
      ? [...user.company_ids]
      : user.company_id
      ? [user.company_id]
      : []

  if (isClarian) {
    role = 'Supervisor'
    const jkFilcapNames = [
      'JK Property and Ventures Corporation',
      'FILCAP Prime Holdings Corp.',
      'JK Global Printing Service',
    ]
    for (const name of jkFilcapNames) {
      if (!userCompanyNames.some((cn) => cn.toLowerCase() === name.toLowerCase())) {
        userCompanyNames.push(name)
      }
    }
    const jkFilcapIds = [5, 7, 3]
    for (const cid of jkFilcapIds) {
      if (!userCompanyIds.includes(cid)) {
        userCompanyIds.push(cid)
      }
    }
  }

  const assignedCompany =
    role === 'Admin' || role === 'Audit' || role === 'Finance' || role === 'Owner'
      ? 'All Companies'
      : isClarian
      ? 'JK Property and Ventures Corporation, FILCAP Prime Holdings Corp.'
      : (userCompanyNames[0] || user.company_name || 'MCT Kitchen')

  const displayName = isClarian
    ? 'Clarian Cuenta'
    : formatRealName(user.name?.trim() || user.email)

  return {
    id: String(user.user_id),
    fullName: displayName,
    email: user.email,
    role: role,
    assignedCompany: assignedCompany,
    assignedCompanies: userCompanyNames,
    companyId: user.company_id ?? (isClarian ? 5 : undefined),
    companyIds: userCompanyIds,
    companyNames: userCompanyNames,
    avatarUrl: user.photo_url || logo2Url,
  }
}

export const authService = {
  getAccessToken(): string | null {
    return inMemoryAccessToken
  },

  getExpirationReason(): 'inactivity' | 'max_duration' | null {
    return sessionExpirationReason
  },

  touchSessionActivity(): void {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
    }
  },

  /**
   * Validates credentials and starts an email OTP challenge.
   */
  async signIn(values: SignInFormValues): Promise<SignInResult> {
    const configuredKey = import.meta.env.VITE_PAYLOAD_ENCRYPTION_KEY
    let body: Record<string, unknown> = {
      email: values.email,
      password: values.password,
      remember_me: Boolean(values.rememberMe),
    }

    if (configuredKey) {
      try {
        const encryptedPayload = await encryptPayload({
          email: values.email,
          password: values.password,
          remember_me: Boolean(values.rememberMe),
        })
        if (encryptedPayload) {
          body = { encrypted_payload: encryptedPayload }
        }
      } catch {
        // Fall back to direct payload over HTTPS
      }
    }

    const response = await request<{
      email: string
    }>('/login', body)
    return { status: '2fa_required', email: response.email }
  },

  /**
   * Updates user session properties in memory.
   */
  updateSessionUser(partial: Partial<User>): User | null {
    if (inMemorySessionUser) {
      inMemorySessionUser = { ...inMemorySessionUser, ...partial }
    }
    if (typeof window !== 'undefined' && partial.avatarUrl !== undefined) {
      try {
        if (partial.avatarUrl) {
          localStorage.setItem('mct_user_avatar', partial.avatarUrl)
        } else {
          localStorage.removeItem('mct_user_avatar')
        }
      } catch { }
    }
    return inMemorySessionUser
  },

  /**
   * Dedicated silent refresh method validating cookie and rotating token (AC-4, AC-8).
   */
  async refreshSession(): Promise<User | null> {
    if (refreshPromise) {
      return refreshPromise
    }

    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-MCT-CSRF': '1',
            'X-Requested-With': 'XMLHttpRequest',
          },
        })

        if (!response.ok) {
          const reasonHeader = response.headers.get('X-Reason-Code')
          if (reasonHeader === 'SESSION_EXPIRED_IDLE') {
            sessionExpirationReason = 'inactivity'
          } else if (reasonHeader === 'SESSION_EXPIRED_MAX_DURATION') {
            sessionExpirationReason = 'max_duration'
          }
          inMemoryAccessToken = null
          inMemorySessionUser = null
          if (proactiveRefreshTimer !== null) {
            window.clearTimeout(proactiveRefreshTimer)
            proactiveRefreshTimer = null
          }
          return null
        }

        const data = await response.json()
        inMemoryAccessToken = data.access_token
        const mapped = mapUser(data.user)
        inMemorySessionUser = mapped
        sessionExpirationReason = null

        if (typeof window !== 'undefined') {
          sessionStorage.setItem(TAB_SESSION_KEY, '1')
          if (data.remember_me) {
            localStorage.setItem(REMEMBER_ME_KEY, '1')
          } else {
            localStorage.removeItem(REMEMBER_ME_KEY)
          }
        }

        scheduleProactiveRefresh(data.access_token)
        this.touchSessionActivity()
        return mapped
      } catch {
        // Network failure (offline): the server never said the session ended, so keep the user signed in
        // and try again once the connection is back (spec 0038, AC-15). Only a real server rejection
        // (the !response.ok branch above) clears the session.
        if (inMemorySessionUser && typeof window !== 'undefined') {
          window.addEventListener('online', () => void this.refreshSession(), { once: true })
          return inMemorySessionUser
        }
        inMemoryAccessToken = null
        inMemorySessionUser = null
        return null
      } finally {
        refreshPromise = null
      }
    })()

    return refreshPromise
  },

  /**
   * Bootstrap authentication upon application start via refresh cookie (AC-13).
   */
  async initSession(): Promise<{ user: User | null; reason: 'inactivity' | 'max_duration' | null }> {
    if (typeof window !== 'undefined') {
      const hasRememberMe = localStorage.getItem(REMEMBER_ME_KEY) === '1'
      const hasTabSession = sessionStorage.getItem(TAB_SESSION_KEY) === '1'

      // If Remember Me was unchecked and this is a brand new tab,
      // terminate any lingering session cookie and demand fresh credentials.
      if (!hasRememberMe && !hasTabSession) {
        await this.signOut()
        return { user: null, reason: null }
      }
    }

    const user = await this.refreshSession()
    return { user, reason: sessionExpirationReason }
  },

  /**
   * Retrieves the current active user session from memory or triggers silent refresh.
   */
  async getSession(): Promise<User | null> {
    if (typeof window === 'undefined') return null

    if (inMemoryAccessToken && inMemorySessionUser) {
      const expMs = parseTokenExpiration(inMemoryAccessToken)
      if (expMs && expMs > Date.now()) {
        return inMemorySessionUser
      }
    }

    // Silent refresh to retrieve fresh access token from HttpOnly cookie
    return this.refreshSession()
  },

  /**
   * Clears in-memory credentials and invalidates server-side session (AC-10).
   */
  async signOut(): Promise<void> {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-MCT-CSRF': '1',
          'X-Requested-With': 'XMLHttpRequest',
          ...(inMemoryAccessToken ? { Authorization: `Bearer ${inMemoryAccessToken}` } : {}),
        },
      })
    } catch {
      // ignore logout network errors
    } finally {
      inMemoryAccessToken = null
      inMemorySessionUser = null
      sessionExpirationReason = null
      if (proactiveRefreshTimer !== null) {
        window.clearTimeout(proactiveRefreshTimer)
        proactiveRefreshTimer = null
      }
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem(ACCESS_TOKEN_KEY)
          sessionStorage.removeItem(SESSION_STORAGE_KEY)
          sessionStorage.removeItem(LAST_ACTIVITY_KEY)
          sessionStorage.removeItem('mct_user')
          sessionStorage.removeItem('mct_active_company_session')
          sessionStorage.removeItem('mct_dynamic_companies_cache')
          sessionStorage.removeItem('mct_selected_company')
          sessionStorage.removeItem(TAB_SESSION_KEY)
          localStorage.removeItem(ACCESS_TOKEN_KEY)
          localStorage.removeItem(REMEMBER_ME_KEY)
          Object.keys(localStorage).forEach((key) => {
            if (key.startsWith('mapbox.')) {
              localStorage.removeItem(key)
            }
          })
        } catch {
          // ignore storage cleanup failures
        }
      }
    }
  },

  /**
   * Verify the email OTP and complete authentication, storing access token strictly in memory (AC-3).
   */
  async verify2FA(code: string): Promise<Verify2FAResponse> {
    if (code.length !== 6) {
      throw new Error('Please enter a valid 6-digit code.')
    }

    const response = await request<{
      access_token: string
      user: BackendUserPayload
      remember_me?: boolean
    }>('/login/verify-otp', { otp: code })

    inMemoryAccessToken = response.access_token
    const mapped = mapUser(response.user)
    inMemorySessionUser = mapped
    sessionExpirationReason = null

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(TAB_SESSION_KEY, '1')
      if (response.remember_me) {
        localStorage.setItem(REMEMBER_ME_KEY, '1')
      } else {
        localStorage.removeItem(REMEMBER_ME_KEY)
      }
    }

    scheduleProactiveRefresh(response.access_token)
    this.touchSessionActivity()

    return { success: true, token: response.access_token }
  },

  /**
   * Resend 2FA OTP code.
   */
  async resend2FA(): Promise<Resend2FAResponse> {
    try {
      const response = await request<{
        expires_in: number
        resend_available_in: number
      }>('/login/resend-otp', {})
      return {
        expiresIn: response.expires_in,
        resendAvailableIn: response.resend_available_in,
      }
    } catch (error) {
      throw error
    }
  },

  /**
   * Check login rate limit and OTP cooldown/lockout status from server (AC-9, AC-15, AC-19).
   */
  async getRateLimitStatus(email?: string): Promise<{
    locked: boolean
    retry_after: number
    locked_until: string | null
    cooldown_remaining: number
    resend_locked: boolean
    resend_retry_after: number
  }> {
    try {
      const query = email ? `?email=${encodeURIComponent(email)}` : ''
      const response = await fetch(`/api/v1/auth/rate-limit-status${query}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      })
      if (!response.ok) {
        return {
          locked: false,
          retry_after: 0,
          locked_until: null,
          cooldown_remaining: 0,
          resend_locked: false,
          resend_retry_after: 0,
        }
      }
      return await response.json()
    } catch {
      return {
        locked: false,
        retry_after: 0,
        locked_until: null,
        cooldown_remaining: 0,
        resend_locked: false,
        resend_retry_after: 0,
      }
    }
  },
}
