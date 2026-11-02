export interface NotificationItemOut {
  notification_id: string
  notification_type: string
  title: string
  message: string
  company_id?: number | null
  reference_type?: string | null
  reference_id?: number | null
  is_read?: boolean
  created_at?: string | null
}

export interface NotificationCountResult {
  unread_count: number
}

export interface GetNotificationsOptions {
  userId?: string | number | null
  companyId?: number
  companyName?: string
  userRole?: string
  notificationType?: string
  limit?: number
  forceRefresh?: boolean
}

export const NOTIFICATION_UPDATED_EVENT = 'mct:notifications-updated'
export const READ_STORAGE_KEY_PREFIX = 'mct_read_notification_ids'

const CACHE_TTL_MS = 10_000
const REQUEST_TIMEOUT_MS = 8_000
const ACCESS_TOKEN_KEY = 'mct_access_token'

interface CacheEntry {
  data: NotificationItemOut[]
  timestamp: number
  version: number
}

const _cacheByKey = new Map<string, CacheEntry>()
const _lastGoodByKey = new Map<string, NotificationItemOut[]>()
const _inFlightByKey = new Map<string, Promise<NotificationItemOut[]>>()
let _mutationVersion = 0

export function getReadStorageKey(userId?: string | number | null): string {
  if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
    return `${READ_STORAGE_KEY_PREFIX}_${String(userId).trim()}`
  }
  return READ_STORAGE_KEY_PREFIX
}

export function getReadNotificationIds(userId?: string | number | null): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const scopedKey = getReadStorageKey(userId)
    const raw = localStorage.getItem(scopedKey) ?? localStorage.getItem(READ_STORAGE_KEY_PREFIX)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(parsed.map(String))
      }
    }
  } catch {
    // ignore storage errors
  }
  return new Set()
}

export function saveReadNotificationId(id: string, userId?: string | number | null): void {
  if (typeof window === 'undefined') return
  try {
    const scopedKey = getReadStorageKey(userId)
    const set = getReadNotificationIds(userId)
    set.add(id)
    localStorage.setItem(scopedKey, JSON.stringify(Array.from(set)))
  } catch {
    // ignore storage errors
  }
}

export function saveAllReadNotificationIds(ids: string[], userId?: string | number | null): void {
  if (typeof window === 'undefined') return
  try {
    const scopedKey = getReadStorageKey(userId)
    const set = getReadNotificationIds(userId)
    ids.forEach((i) => set.add(i))
    localStorage.setItem(scopedKey, JSON.stringify(Array.from(set)))
  } catch {
    // ignore storage errors
  }
}

export function clearNotificationCache(): void {
  _mutationVersion += 1
  _cacheByKey.clear()
  _lastGoodByKey.clear()
  _inFlightByKey.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener(NOTIFICATION_UPDATED_EVENT, () => {
    _mutationVersion += 1
    _cacheByKey.clear()
  })
}

export function notifyNotificationsUpdated(): void {
  _mutationVersion += 1
  _cacheByKey.clear()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_UPDATED_EVENT))
  }
}

function getAuthHeaders(userRole?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (typeof window !== 'undefined') {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY)
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }
  if (userRole) {
    headers['X-User-Role'] = userRole
  }
  return headers
}

const OVERDUE_TYPES = new Set([
  'BILL_OVERDUE',
  'LENDING_OVERDUE',
  'LENDING_INSTALLMENT_OVERDUE',
  'LOAN_OVERDUE',
  'TENANT_OVERDUE',
])

const DUE_TODAY_TYPES = new Set([
  'BILL_DUE_TODAY',
  'LENDING_DUE_TODAY',
  'LOAN_DUE_TODAY',
  'TENANT_DUE_TODAY',
])

const DUE_SOON_TYPES = new Set([
  'BILL_DUE_TOMORROW',
  'BILL_DUE_SOON',
  'LENDING_DUE_TOMORROW',
  'LENDING_DUE_SOON',
  'LOAN_DUE_TOMORROW',
  'LOAN_DUE_SOON',
  'TENANT_DUE_TOMORROW',
  'TENANT_DUE_SOON',
  'PETTY_CASH_LOW_BALANCE',
])

function getUrgencyPriority(type: string): number {
  if (OVERDUE_TYPES.has(type)) return 0
  if (DUE_TODAY_TYPES.has(type)) return 1
  if (DUE_SOON_TYPES.has(type)) return 2
  return 3
}

function buildScopeCacheKey(options?: GetNotificationsOptions): string {
  const uid = options?.userId !== undefined && options?.userId !== null ? String(options.userId) : 'anon'
  const role = (options?.userRole || '').trim().toLowerCase()
  const cid = options?.companyId ? String(options.companyId) : ''
  const cname = (options?.companyName || 'All Companies').trim().toLowerCase()
  const ntype = (options?.notificationType || '').trim().toUpperCase()
  const limit = String(options?.limit || 100)
  return `u:${uid}|r:${role}|cid:${cid}|cn:${cname}|t:${ntype}|l:${limit}`
}

export const notificationService = {
  async getNotifications(options?: GetNotificationsOptions): Promise<NotificationItemOut[]> {
    const cacheKey = buildScopeCacheKey(options)
    const now = Date.now()

    if (!options?.forceRefresh) {
      const cached = _cacheByKey.get(cacheKey)
      if (cached && cached.version === _mutationVersion && now - cached.timestamp < CACHE_TTL_MS) {
        return cached.data
      }
    }

    const existingInFlight = _inFlightByKey.get(cacheKey)
    if (existingInFlight) {
      return existingInFlight
    }

    const requestVersion = _mutationVersion

    const fetchPromise = (async (): Promise<NotificationItemOut[]> => {
      const params = new URLSearchParams()
      if (options?.companyId) params.append('company_id', String(options.companyId))
      if (options?.companyName && options.companyName !== 'All Companies') {
        params.append('company_name', options.companyName)
      }
      if (options?.userRole) params.append('user_role', options.userRole)
      if (options?.notificationType) params.append('notification_type', options.notificationType)
      params.append('limit', String(options?.limit || 100))

      const url = `/api/v1/notifications?${params.toString()}`
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null

      try {
        const res = await fetch(url, {
          headers: getAuthHeaders(options?.userRole),
          signal: controller?.signal,
        })

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            _cacheByKey.delete(cacheKey)
            return []
          }
          // Preserve last known good data on transient 5xx errors without caching failure as fresh
          return _lastGoodByKey.get(cacheKey) ?? []
        }

        const data = await res.json()
        const rawItems: NotificationItemOut[] = Array.isArray(data) ? data : []

        // Deduplicate by notification_id
        const merged: NotificationItemOut[] = []
        const seenIds = new Set<string>()
        for (const item of rawItems) {
          if (item && item.notification_id && !seenIds.has(item.notification_id)) {
            seenIds.add(item.notification_id)
            merged.push(item)
          }
        }

        const filtered = options?.notificationType
          ? merged.filter(
              (n) => n.notification_type.toUpperCase() === options.notificationType!.toUpperCase()
            )
          : merged

        filtered.sort((a, b) => {
          const pA = getUrgencyPriority(a.notification_type)
          const pB = getUrgencyPriority(b.notification_type)
          if (pA !== pB) return pA - pB
          const tA = a.created_at ? new Date(a.created_at).getTime() : 0
          const tB = b.created_at ? new Date(b.created_at).getTime() : 0
          return tB - tA
        })

        const finalResult = filtered.slice(0, options?.limit || 100)

        // Only update cache if no mutation occurred while this request was in flight
        if (requestVersion === _mutationVersion) {
          _cacheByKey.set(cacheKey, {
            data: finalResult,
            timestamp: Date.now(),
            version: requestVersion,
          })
          _lastGoodByKey.set(cacheKey, finalResult)
        }

        return finalResult
      } catch {
        // On timeout or network failure, never fire a multi-service retry storm and never cache empty array as fresh.
        // Fall back to last known good notifications for this exact user/company scope if available.
        return _lastGoodByKey.get(cacheKey) ?? []
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
    })()

    _inFlightByKey.set(cacheKey, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      if (_inFlightByKey.get(cacheKey) === fetchPromise) {
        _inFlightByKey.delete(cacheKey)
      }
    }
  },

  async getUnreadCount(
    companyId?: number,
    companyName?: string,
    userRole?: string,
    userId?: string | number | null
  ): Promise<number> {
    try {
      const items = await this.getNotifications({
        userId,
        companyId,
        companyName,
        userRole,
        limit: 100,
      })
      const readSet = getReadNotificationIds(userId)
      return items.filter((item) => !readSet.has(item.notification_id)).length
    } catch {
      return 0
    }
  },
}
