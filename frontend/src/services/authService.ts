import type { SignInFormValues } from '@/lib/validation/auth'
import logo2Url from '@/assets/LOGO2.png'
import { encryptPayload } from '@/services/payloadEncryption'

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
const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000

function getInitialUser(): User | null {
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY)
      const lastActivity = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY))
      const tokenPayload = token
        ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        : null
      const tokenIsValid =
        tokenPayload &&
        typeof tokenPayload.exp === 'number' &&
        tokenPayload.exp * 1000 > Date.now()
      if (
        stored &&
        tokenIsValid &&
        Number.isFinite(lastActivity) &&
        Date.now() - lastActivity < SESSION_IDLE_TIMEOUT_MS
      ) {
        return JSON.parse(stored)
      }
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      sessionStorage.removeItem(ACCESS_TOKEN_KEY)
      sessionStorage.removeItem(LAST_ACTIVITY_KEY)
    } catch {
      // ignore
    }
  }
  return null
}

/**
 * Fallback user detection for offline or temporary utility use.
 */
export function detectUserByEmail(email: string): User {
  const normalized = email.trim().toLowerCase()
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
    fullName: email.trim(),
    email: email.trim(),
    role: role,
    assignedCompany: role === 'Supervisor' ? 'MCT Kitchen' : 'All Companies',
    avatarUrl: logo2Url,
  }
}

let inMemorySessionUser: User | null = getInitialUser()

async function getRequest<T>(path: string): Promise<T> {
  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem(ACCESS_TOKEN_KEY)
      : null
  if (!token) {
    throw new Error('No access token available')
  }
  const response = await fetch(`/api/v1/auth${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401) {
    throw new Error('Unauthorized')
  }
  const responseText = await response.text()
  let data: { detail?: string } = {}
  try {
    data = responseText ? (JSON.parse(responseText) as { detail?: string }) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    throw new Error(
      data.detail ||
        responseText ||
        `Authentication request failed (${response.status}).`
    )
  }
  return data as T
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const token =
    typeof window !== 'undefined'
      ? sessionStorage.getItem(ACCESS_TOKEN_KEY)
      : null
  const response = await fetch(`/api/v1/auth${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const responseText = await response.text()
  let data: { detail?: string } = {}
  try {
    data = responseText ? (JSON.parse(responseText) as { detail?: string }) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    throw new Error(
      data.detail ||
        responseText ||
        `Authentication request failed (${response.status}).`
    )
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

  const userCompanyNames =
    user.company_names && user.company_names.length > 0
      ? user.company_names
      : user.company_name
      ? [user.company_name]
      : []

  const assignedCompany =
    role === 'Admin' || role === 'Audit' || role === 'Finance' || role === 'Owner'
      ? 'All Companies'
      : (userCompanyNames[0] || user.company_name || 'MCT Kitchen')

  const displayName = user.name?.trim() || user.email

  const userCompanyIds =
    user.company_ids && user.company_ids.length > 0
      ? user.company_ids
      : user.company_id
      ? [user.company_id]
      : []

  return {
    id: String(user.user_id),
    fullName: displayName,
    email: user.email,
    role: role,
    assignedCompany: assignedCompany,
    companyId: user.company_id ?? undefined,
    companyIds: userCompanyIds,
    companyNames: userCompanyNames,
    avatarUrl: user.photo_url || logo2Url,
  }
}

export const authService = {
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
    }

    if (configuredKey) {
      try {
        const encryptedPayload = await encryptPayload({
          email: values.email,
          password: values.password,
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
  /**
   * Updates user session properties in memory, sessionStorage, and localStorage.
   */
  updateSessionUser(partial: Partial<User>): User | null {
    if (inMemorySessionUser) {
      inMemorySessionUser = { ...inMemorySessionUser, ...partial }
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(inMemorySessionUser))
        } catch { }
      }
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
   * Retrieves the current user session from memory, backend, or storage.
   */
  async getSession(): Promise<User | null> {
    if (typeof window === 'undefined') return null

    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY)
    if (!token) {
      inMemorySessionUser = null
      return null
    }

    // Verify token expiration
    try {
      const tokenPayload = JSON.parse(
        atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      )
      if (
        !tokenPayload ||
        typeof tokenPayload.exp !== 'number' ||
        tokenPayload.exp * 1000 <= Date.now()
      ) {
        await this.signOut()
        return null
      }
    } catch {
      await this.signOut()
      return null
    }

    // Check last activity idle timeout
    const lastActivity = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY))
    if (!Number.isFinite(lastActivity) || Date.now() - lastActivity >= SESSION_IDLE_TIMEOUT_MS) {
      await this.signOut()
      return null
    }

    // Live backend fetch from /me to guarantee user profile is synchronized with Supabase
    try {
      const backendUser = await getRequest<BackendUserPayload>('/me')
      const mapped = mapUser(backendUser)
      inMemorySessionUser = mapped
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(mapped))
      this.touchSessionActivity()
    } catch {
      // If fetching /me fails (e.g. offline/network glitch), fall back to cached session storage if valid
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
      if (stored) {
        try {
          inMemorySessionUser = JSON.parse(stored)
        } catch {
          await this.signOut()
          return null
        }
      } else {
        await this.signOut()
        return null
      }
    }

    if (inMemorySessionUser) {
      try {
        const customAvatar = localStorage.getItem('mct_user_avatar')
        if (customAvatar) {
          inMemorySessionUser.avatarUrl = customAvatar
        }
      } catch { }
    }
    return inMemorySessionUser
  },

  /**
   * Clears session.
   */
  async signOut(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem(ACCESS_TOKEN_KEY)) {
        await request('/logout', {})
      }
    } finally {
      inMemorySessionUser = null
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem(ACCESS_TOKEN_KEY)
          sessionStorage.removeItem(SESSION_STORAGE_KEY)
          sessionStorage.removeItem(LAST_ACTIVITY_KEY)
        } catch {
          // ignore storage cleanup failures
        }
      }
    }
  },

  /**
   * Verify the email OTP and complete authentication.
   */
  async verify2FA(code: string): Promise<Verify2FAResponse> {
    if (code.length !== 6) {
      throw new Error('Please enter a valid 6-digit code.')
    }

    const response = await request<{
      access_token: string
      user: BackendUserPayload
    }>('/login/verify-otp', { otp: code })
    const mapped = mapUser(response.user)
    inMemorySessionUser = mapped
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(ACCESS_TOKEN_KEY, response.access_token)
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(mapped))
        sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
      } catch {
        // ignore
      }
    }
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
}
