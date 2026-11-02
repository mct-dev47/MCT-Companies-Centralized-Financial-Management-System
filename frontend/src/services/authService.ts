import type { SignInFormValues } from '@/lib/validation/auth'
import logo2Url from '@/assets/LOGO2.png'
import { encryptPayload } from '@/services/payloadEncryption'

export type UserRole = 'Admin' | 'Finance' | 'Audit' | 'Supervisor'

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

// Seeded accounts in the system
export interface SeededAccount {
  id: string
  fullName: string
  email: string
  role: UserRole
  assignedCompany?: string
  avatarUrl?: string
}

export const SEEDED_ACCOUNTS: SeededAccount[] = [
  // 1. Central Admin accounts (Full access including Company & User Management)
  {
    id: 'usr_admin_01',
    fullName: 'Remi Lee',
    email: 'admin@mct.com',
    role: 'Admin',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_admin_02',
    fullName: 'Remi Lee',
    email: 'remi.lee@mct.com',
    role: 'Admin',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  },
  // 2. Audit accounts (Same frontend as Admin: multi-company audit view; no company/user management)
  {
    id: 'usr_audit_01',
    fullName: 'Financial Auditor',
    email: 'audit@mct.com',
    role: 'Audit',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_audit_02',
    fullName: 'Audit Officer',
    email: 'auditor@mct.com',
    role: 'Audit',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  },
  // 3. Finance accounts (Approves loans and selects lending company)
  {
    id: 'usr_finance_01',
    fullName: 'Finance Officer',
    email: 'finance@mct.com',
    role: 'Finance',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_finance_02',
    fullName: 'Finance Manager',
    email: 'finance.manager@mct.com',
    role: 'Finance',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  },
  // 4. Supervisor accounts (Operational branch supervisors)
  {
    id: 'usr_kitchen_00',
    fullName: 'Temporary Employee',
    email: 'temporaryemployee@gmail.com',
    role: 'Supervisor',
    assignedCompany: 'MCT Kitchen',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_kitchen_01',
    fullName: 'Temporary Employee',
    email: 'temporary.employee@mct.com',
    role: 'Supervisor',
    assignedCompany: 'MCT Kitchen',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_hotel_01',
    fullName: 'Temporary Employee 1',
    email: 'temporary.employee1@mct.com',
    role: 'Supervisor',
    assignedCompany: 'MCT Hotel',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_jk_property_01',
    fullName: 'Jessica Kho (JK Property)',
    email: 'jkproperty@mct.com',
    role: 'Supervisor',
    assignedCompany: 'JK Property and Ventures',
    avatarUrl: logo2Url,
  },
  {
    id: 'usr_filcap_01',
    fullName: 'Carlos Tan (FilCap)',
    email: 'filcap@mct.com',
    role: 'Supervisor',
    assignedCompany: 'FilCap Prime Holdings Corp.',
    avatarUrl: logo2Url,
  },
]

export const ADMIN_USER: User = SEEDED_ACCOUNTS[0]
export const AUDIT_USER: User = SEEDED_ACCOUNTS[2]
export const FINANCE_USER: User = SEEDED_ACCOUNTS[4]
export const SUPERVISOR_USER: User = SEEDED_ACCOUNTS[6]
export const COMPANY_USER: User = SUPERVISOR_USER
export const AUDITOR_USER: User = SEEDED_ACCOUNTS[2]
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
 * Automatically detects whether an authenticated user is Admin, Audit, Finance, or Company
 * based on their seeded account and email credentials.
 */
export function detectUserByEmail(email: string): User {
  const normalized = email.trim().toLowerCase()
  const matched = SEEDED_ACCOUNTS.find(
    (acc) => acc.email.toLowerCase() === normalized
  )

  if (matched) {
    return {
      id: matched.id,
      fullName: matched.fullName,
      email: matched.email,
      role: matched.role,
      assignedCompany: matched.assignedCompany,
      avatarUrl: matched.avatarUrl,
    }
  }

  // 1. Detection for Central Admin
  if (normalized === 'admin@mct.com' || normalized === 'remi.lee@mct.com' || normalized.startsWith('admin')) {
    return {
      id: `usr_admin_${Date.now()}`,
      fullName: 'Remi Lee',
      email: email.trim(),
      role: 'Admin',
      assignedCompany: 'All Companies',
      avatarUrl: logo2Url,
    }
  }

  // 2. Detection for Audit role
  if (normalized === 'audit@mct.com' || normalized === 'auditor@mct.com' || normalized.startsWith('audit')) {
    return {
      id: `usr_audit_${Date.now()}`,
      fullName: 'Audit Officer',
      email: email.trim(),
      role: 'Audit',
      assignedCompany: 'All Companies',
      avatarUrl: logo2Url,
    }
  }

  // Detection by company auditor / supervisor
  if (normalized.includes('company_auditor') || normalized.includes('company-auditor') || normalized.includes('supervisor')) {
    return {
      id: `usr_supervisor_${Date.now()}`,
      fullName: 'Branch Supervisor',
      email: email.trim(),
      role: 'Supervisor',
      assignedCompany: 'MCT Kitchen',
      avatarUrl: logo2Url,
    }
  }

  // Detection by finance keyword
  if (normalized.includes('finance')) {
    return {
      id: `usr_finance_${Date.now()}`,
      fullName: 'Finance Officer',
      email: email.trim(),
      role: 'Finance',
      assignedCompany: 'All Companies',
      avatarUrl: logo2Url,
    }
  }

  // Detection for JK Property employee
  if (normalized.includes('jkproperty') || normalized.includes('jk_property')) {
    return {
      id: `usr_jk_${Date.now()}`,
      fullName: 'Jessica Kho',
      email: email.trim(),
      role: 'Supervisor',
      assignedCompany: 'JK Property and Ventures',
      avatarUrl: logo2Url,
    }
  }

  // Detection for FilCap employee
  if (normalized.includes('filcap') || normalized.includes('filcam')) {
    return {
      id: `usr_filcap_${Date.now()}`,
      fullName: 'Carlos Tan',
      email: email.trim(),
      role: 'Supervisor',
      assignedCompany: 'FilCap Prime Holdings Corp.',
      avatarUrl: logo2Url,
    }
  }

  // Default to Admin
  return {
    id: `usr_admin_${Date.now()}`,
    fullName: 'Remi Lee',
    email: email.trim(),
    role: 'Admin',
    assignedCompany: 'All Companies',
    avatarUrl: logo2Url,
  }
}

let inMemorySessionUser: User | null = getInitialUser()
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

function mapUser(user: {
  user_id: number
  email: string
  name: string
  is_admin: boolean
  role?: string
  company_name?: string | null
  photo_url?: string | null
}): User {
  let role: UserRole = 'Supervisor'
  const rawRole = (user.role || '').toLowerCase()
  const rawEmail = (user.email || '').toLowerCase()

  // 1. Central Admin takes absolute precedence
  if (rawEmail === 'admin@mct.com' || rawEmail === 'remi.lee@mct.com' || rawRole === 'admin' || (user.is_admin && rawEmail !== 'audit@mct.com')) {
    role = 'Admin'
  }
  // 2. Audit account (Audit view only, no company/user management)
  else if (rawEmail === 'audit@mct.com' || rawEmail === 'auditor@mct.com' || rawRole === 'audit') {
    role = 'Audit'
  }
  // 3. Finance account
  else if (rawRole === 'finance' || rawEmail.includes('finance')) {
    role = 'Finance'
  }
  // 4. Operational Supervisor user
  else {
    role = 'Supervisor'
  }

  // Look up seeded account or detect from email
  const seeded = SEEDED_ACCOUNTS.find((acc) => acc.email.toLowerCase() === rawEmail)
  let resolvedCompany = user.company_name || seeded?.assignedCompany

  if (!resolvedCompany) {
    if (rawEmail.includes('filcap') || rawEmail.includes('filcam')) {
      resolvedCompany = 'FilCap Prime Holdings Corp.'
    } else if (rawEmail.includes('jkproperty') || rawEmail.includes('jk_property')) {
      resolvedCompany = 'JK Property and Ventures'
    }
  }

  const assignedCompany = (role === 'Admin' || role === 'Audit' || role === 'Finance')
    ? 'All Companies'
    : (resolvedCompany || 'MCT Kitchen')

  const displayName = rawEmail === 'admin@mct.com' || rawEmail === 'remi.lee@mct.com'
    ? 'Remi Lee'
    : rawEmail === 'audit@mct.com'
    ? 'Audit Officer'
    : user.name

  const userCompanyIds = (user as any).company_ids || ((user as any).company_id ? [(user as any).company_id] : [])
  const userCompanyNames = (user as any).company_names || (resolvedCompany ? [resolvedCompany] : [])

  return {
    id: String(user.user_id),
    fullName: displayName,
    email: user.email,
    role: role,
    assignedCompany: assignedCompany,
    companyId: (user as any).company_id,
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
    const encryptedPayload = await encryptPayload({
      email: values.email,
      password: values.password,
    })
    const response = await request<{
      email: string
    }>('/login', { encrypted_payload: encryptedPayload })
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
   * Retrieves the current user session from memory or storage.
   */
  async getSession(): Promise<User | null> {
    if (!inMemorySessionUser && typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
        if (stored) {
          inMemorySessionUser = JSON.parse(stored)
        }
      } catch {
        // ignore
      }
    }
    if (inMemorySessionUser && typeof window !== 'undefined') {
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
      user: {
        user_id: number
        email: string
        name: string
        is_admin: boolean
        company_name?: string | null
      }
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
