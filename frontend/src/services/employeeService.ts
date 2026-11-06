import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { isCompanyMatch } from '@/utils/companyUtils'
import type { AuthorizedCompany } from '@/config/centralizedCompanies'
import { activityLogService, type ActivityLogItem } from '@/services/activityLogService'

export type { ActivityLogItem }

export interface Company {
  id: string
  name: string
  email?: string
  address: string
  contactPerson?: string
  contactPersonEmail?: string
  contactNumber: string
  telephoneNumber: string
  startingBalance: number
  currentBalance?: number
  pettyCash?: number
  status: 'Active' | 'Inactive'
  createdAt: string
  logoUrl?: string
}

export interface EmployeeUser {
  id: string
  fullName: string
  email: string
  companyId: string
  companyIds?: string[]
  companyName: string
  companyNames?: string[]
  role?: string
  status: 'Active' | 'Inactive'
  lastLogin: string
  isAdmin?: boolean
  isProtected?: boolean
  avatarUrl?: string
  createdAt?: string
}

export interface CreateCompanyPayload {
  name: string
  email?: string
  address: string
  contactPerson?: string
  contactPersonEmail?: string
  contactNumber: string
  telephoneNumber?: string
  startingBalance: number
  currentBalance?: number
  pettyCash?: number
  logoUrl?: string
  logoFile?: File
}

export interface CreateUserPayload {
  fullName: string
  email: string
  assignedCompany?: string
  assignedCompanies?: string[]
  companyIds?: number[]
  role: string
  password?: string
  avatarUrl?: string
  avatarFile?: File
}

export interface UpdateUserPayload {
  fullName?: string
  email?: string
  assignedCompany?: string
  assignedCompanies?: string[]
  companyIds?: number[]
  role?: string
  password?: string
  avatarUrl?: string
  avatarFile?: File
  status?: 'Active' | 'Inactive'
}





// "2026-10-30T09:15:00+00:00" or "2026-10-30 09:15:00" -> "2026-10-30 17:15" in the browser's time
function formatLogTime(value?: string | null): string {
  if (!value) return ''
  const raw = String(value).trim().replace(' ', 'T')
  // The database stores UTC. A value with no zone is UTC.
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(raw)
  const d = new Date(hasZone ? raw : `${raw}Z`)
  if (isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getAuthHeaders(): HeadersInit {
  const token = sessionStorage.getItem(['mct', 'access', 'token'].join('_'))
  return token ? { Authorization: 'Bearer ' + token } : {}
}

async function getApiError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return formatUserFriendlyErrorMessage(
      { status: response.status, ...body },
      `Request failed (${response.status})`
    )
  } catch {
    return formatUserFriendlyErrorMessage(
      { status: response.status },
      `Request failed (${response.status})`
    )
  }
}

async function mapApiResponse<T>(
  response: Response,
  mapper: (value: unknown) => T
): Promise<T> {
  if (!response.ok) throw new Error(await getApiError(response))
  return mapper(await response.json())
}

function mapUser(value: unknown): EmployeeUser {
  const user = value as {
    user_id: number
    name: string
    email: string
    company_id: number | null
    company_ids?: number[]
    company_name: string | null
    company_names?: string[]
    is_admin: boolean
    is_protected?: boolean
    role?: string
    photo_url?: string | null
    last_login_at: string | null
  }

  let roleName = (user.role || '').toLowerCase()
  if (roleName === 'admin' || user.is_admin) {
    roleName = 'Admin'
  } else if (roleName === 'owner') {
    roleName = 'Owner'
  } else if (roleName === 'audit') {
    roleName = 'Audit'
  } else if (roleName === 'finance') {
    roleName = 'Finance'
  } else {
    roleName = 'Supervisor'
  }

  const cids = (user.company_ids && user.company_ids.length > 0)
    ? user.company_ids.map(String)
    : (user.company_id !== null && user.company_id !== undefined ? [String(user.company_id)] : [])

  const cnames = (user.company_names && user.company_names.length > 0)
    ? user.company_names
    : (user.company_name ? [user.company_name] : [])

  return {
    id: String(user.user_id),
    fullName: user.name,
    email: user.email,
    companyId: user.company_id === null ? '' : String(user.company_id),
    companyIds: cids,
    companyName: cnames.join(', ') || 'MCT Group',
    companyNames: cnames,
    role: roleName,
    status: 'Active',
    lastLogin: user.last_login_at
      ? new Date(user.last_login_at).toLocaleString()
      : 'Never',
    isAdmin: user.is_admin,
    isProtected: Boolean(user.is_protected || user.is_admin || user.user_id === 1 || (user.role && user.role.toLowerCase() === 'admin')),
    avatarUrl: user.photo_url || undefined,
    createdAt: (user as { created_at?: string }).created_at || '',
  }
}

function mapCompany(value: unknown): Company {
  const company = value as {
    id: number
    name: string
    location: string
    contact_number: string | null
    phone: string | null
    starting_balance: number
    petty_cash?: number
    created_at: string | null
    logo_url?: string | null
  }
  return {
    id: String(company.id),
    name: company.name,
    address: company.location,
    contactNumber: company.contact_number || '',
    telephoneNumber: company.phone || '',
    startingBalance: Number(company.starting_balance) || 0,
    pettyCash: Number(company.petty_cash) || 0,
    status: 'Active',
    createdAt: company.created_at || '',
    logoUrl: company.logo_url || undefined,
  }
}

function resolveCompanyId(nameOrId: string | number, companies: Company[]): number | null {
  const str = String(nameOrId).trim()
  const num = Number(str)
  if (!isNaN(num) && num > 0) {
    const byId = companies.find((c) => Number(c.id) === num)
    if (byId) return num
  }

  // 1. Exact match by ID or exact company name (case-insensitive)
  const exact = companies.find(
    (c) => c.id === str || c.name.trim().toLowerCase() === str.toLowerCase()
  )
  if (exact && !isNaN(Number(exact.id))) {
    return Number(exact.id)
  }

  // 2. Only fallback to fuzzy match if no company has an exact match
  const fuzzy = companies.find((c) => isCompanyMatch(c.name, str))
  if (fuzzy && !isNaN(Number(fuzzy.id))) {
    return Number(fuzzy.id)
  }

  return null
}

export const employeeService = {
  async getUsers(): Promise<EmployeeUser[]> {
    const response = await fetch('/api/v1/users', {
      headers: getAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(await getApiError(response))
    }
    return await mapApiResponse(response, (value) =>
      (value as unknown[]).map(mapUser)
    )
  },

  async getCompanies(): Promise<Company[]> {
    const response = await fetch('/api/v1/companies', {
      headers: getAuthHeaders(),
    })
    return await mapApiResponse(response, (value) =>
      (value as unknown[]).map(mapCompany)
    )
  },

  async getAuthorizedCompanies(): Promise<AuthorizedCompany[]> {
    try {
      const response = await fetch('/api/v1/companies/authorized', {
        headers: getAuthHeaders(),
      })
      if (response.ok) {
        return await response.json()
      }
      console.warn('GET /api/v1/companies/authorized failed with status', response.status)
    } catch (error) {
      console.warn('Failed to fetch authorized companies:', error)
    }
    return []
  },


  async createUser(payload: CreateUserPayload): Promise<EmployeeUser> {
    const companies = await employeeService.getCompanies()
    
    // Consolidate company IDs from companyIds, assignedCompanies, and assignedCompany
    const companyIds: number[] = []
    if (payload.companyIds && payload.companyIds.length > 0) {
      for (const cid of payload.companyIds) {
        const numId = Number(cid)
        if (!isNaN(numId) && !companyIds.includes(numId)) {
          companyIds.push(numId)
        }
      }
    }
    if (payload.assignedCompanies && payload.assignedCompanies.length > 0) {
      for (const nameOrId of payload.assignedCompanies) {
        const resolved = resolveCompanyId(nameOrId, companies)
        if (resolved !== null && !companyIds.includes(resolved)) {
          companyIds.push(resolved)
        }
      }
    }
    if (payload.assignedCompany) {
      const resolved = resolveCompanyId(payload.assignedCompany, companies)
      if (resolved !== null && !companyIds.includes(resolved)) {
        companyIds.push(resolved)
      }
    }

    const primaryCompanyId = companyIds.length > 0 ? companyIds[0] : null
    const assignedCompanyNames = payload.assignedCompanies && payload.assignedCompanies.length > 0
      ? payload.assignedCompanies
      : (payload.assignedCompany ? [payload.assignedCompany] : [])

    const response = await fetch('/api/v1/users', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: payload.fullName,
        email: payload.email,
        company_id: primaryCompanyId,
        company_ids: companyIds,
        company_name: assignedCompanyNames[0] || payload.assignedCompany || undefined,
        company_names: assignedCompanyNames,
        is_admin: payload.role === 'Admin',
        role: payload.role.toLowerCase(),
        photo_url: payload.avatarUrl && !payload.avatarUrl.startsWith('data:') ? payload.avatarUrl : null,
      }),
    })

    if (!response.ok) {
      throw new Error(await getApiError(response))
    }

    let created = await mapApiResponse(response, mapUser)

    if (payload.avatarFile) {
      const formData = new FormData()
      formData.append('picture', payload.avatarFile)
      const picResponse = await fetch(`/api/v1/users/${created.id}/picture`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      })
      if (picResponse.ok) {
        created = await mapApiResponse(picResponse, mapUser)
      }
    }


    return created
  },

  async updateUser(id: string, payload: UpdateUserPayload): Promise<EmployeeUser> {
    const companies = (payload.assignedCompanies || payload.assignedCompany || payload.companyIds)
      ? await employeeService.getCompanies()
      : []

    const body: Record<string, unknown> = {}
    if (payload.fullName !== undefined) body.name = payload.fullName
    if (payload.email !== undefined) body.email = payload.email
    if (payload.role !== undefined) {
      body.role = payload.role.toLowerCase()
      body.is_admin = payload.role === 'Admin'
    }
    if (payload.password) body.password = payload.password
    if (payload.avatarUrl !== undefined && !payload.avatarUrl.startsWith('data:')) {
      body.photo_url = payload.avatarUrl
    }

    if (payload.companyIds !== undefined) {
      const resolvedIds: number[] = []
      for (const cid of payload.companyIds) {
        const numId = Number(cid)
        if (!isNaN(numId) && !resolvedIds.includes(numId)) {
          resolvedIds.push(numId)
        }
      }
      body.company_ids = resolvedIds
      body.company_id = resolvedIds[0] || null
    } else if (payload.assignedCompanies !== undefined) {
      const resolvedIds: number[] = []
      for (const nameOrId of payload.assignedCompanies) {
        const resolved = resolveCompanyId(nameOrId, companies)
        if (resolved !== null && !resolvedIds.includes(resolved)) {
          resolvedIds.push(resolved)
        }
      }
      body.company_ids = resolvedIds
      body.company_id = resolvedIds[0] || null
    } else if (payload.assignedCompany !== undefined) {
      const resolved = resolveCompanyId(payload.assignedCompany, companies)
      if (resolved !== null) {
        body.company_ids = [resolved]
        body.company_id = resolved
      } else {
        body.company_ids = []
        body.company_id = null
      }
    }

    const response = await fetch(`/api/v1/users/${id}`, {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(await getApiError(response))
    }

    let updated = await mapApiResponse(response, mapUser)

    if (payload.avatarFile) {
      const formData = new FormData()
      formData.append('picture', payload.avatarFile)
      const picResponse = await fetch(`/api/v1/users/${id}/picture`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      })
      if (picResponse.ok) {
        updated = await mapApiResponse(picResponse, mapUser)
      }
    }


    return updated
  },

  async deleteUser(id: string): Promise<void> {
    const response = await fetch(`/api/v1/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(await getApiError(response))
    }
  },

  async reinviteUser(userId: string): Promise<EmployeeUser> {
    const response = await fetch(`/api/v1/users/${userId}/reinvite`, {
      method: 'POST',
      headers: getAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(await getApiError(response))
    }
    return await mapApiResponse(response, mapUser)
  },

  async createCompany(payload: CreateCompanyPayload): Promise<Company> {
    let endpoint = '/api/v1/companies'
    let headers: HeadersInit = {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    }
    let body: BodyInit = JSON.stringify({
      name: payload.name,
      location: payload.address,
      contact_number: payload.contactNumber || null,
      phone: payload.telephoneNumber || null,
      starting_balance: Number(payload.startingBalance) || 0,
      petty_cash: Number(payload.pettyCash) || 0,
      logo_url: payload.logoUrl && !payload.logoUrl.startsWith('data:') ? payload.logoUrl : null,
    })

    if (payload.logoFile) {
      const formData = new FormData()
      formData.append('name', payload.name)
      formData.append('location', payload.address)
      formData.append('contact_number', payload.contactNumber || '')
      formData.append('phone', payload.telephoneNumber || '')
      formData.append('starting_balance', String(Number(payload.startingBalance) || 0))
      formData.append('petty_cash', String(Number(payload.pettyCash) || 0))
      formData.append('picture', payload.logoFile)
      endpoint = '/api/v1/companies/with-picture'
      headers = getAuthHeaders()
      body = formData
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    })

    return await mapApiResponse(response, mapCompany)
  },

  async updateCompany(
    id: string,
    payload: Partial<CreateCompanyPayload>
  ): Promise<Company> {
    const body: Record<string, unknown> = {}
    if (payload.name !== undefined) body.name = payload.name
    if (payload.address !== undefined) body.location = payload.address
    if (payload.contactNumber !== undefined) body.contact_number = payload.contactNumber || null
    if (payload.telephoneNumber !== undefined) body.phone = payload.telephoneNumber || null
    if (payload.startingBalance !== undefined) body.starting_balance = payload.startingBalance
    if (payload.pettyCash !== undefined) body.petty_cash = payload.pettyCash
    if (payload.logoUrl !== undefined && !payload.logoUrl.startsWith('data:')) {
      body.logo_url = payload.logoUrl
    }

    const response = await fetch(`/api/v1/companies/${id}`, {
      method: 'PATCH',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    let comp = await mapApiResponse(response, mapCompany)

    if (payload.logoFile) {
      const formData = new FormData()
      formData.append('picture', payload.logoFile)
      const picResponse = await fetch(`/api/v1/companies/${id}/picture`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      })
      comp = await mapApiResponse(picResponse, mapCompany)
    }

    return comp
  },

  async deleteCompany(id: string): Promise<void> {
    const response = await fetch(`/api/v1/companies/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(await getApiError(response))
    }
  },

  /**
   * The real activity log: retrieved directly from Supabase via activityLogService.
   */
  async getActivityLogs(): Promise<ActivityLogItem[]> {
    return activityLogService.getActivityLogs()
  },
}
