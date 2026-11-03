export interface NotificationItemOut {
  notification_id: string
  notification_type: string
  title: string
  message: string
  company_id?: number | null
  reference_type?: string | null
  reference_id?: number | null
  is_read?: boolean
  read_at?: string | null
  resolved_at?: string | null
  expires_at?: string | null
  extra_data?: Record<string, any> | null
  created_at?: string | null
}

export interface NotificationCountResult {
  unread_count: number
}

export interface NotificationFeedResponse {
  items: NotificationItemOut[]
  next_cursor?: string | null
  has_more: boolean
  total_unread?: number | null
}

export interface GetNotificationsOptions {
  userId?: string | number | null
  companyId?: number
  companyName?: string
  userRole?: string
  notificationType?: string
  cursor?: string
  direction?: 'before' | 'after'
  limit?: number
  forceRefresh?: boolean
}

export const NOTIFICATION_UPDATED_EVENT = 'mct:notifications-updated'
export const READ_STORAGE_KEY_PREFIX = 'mct_read_notification_ids'

/**
 * Sanitizes any CP437/OEM mojibake sequences that might occur from legacy
 * encodings, ensuring clean Philippine Peso currency symbols and punctuation.
 */
export function sanitizeNotificationText(text?: string | null): string {
  if (!text) return ''
  return text
    .replace(/Γé▒/g, '₱')
    .replace(/ΓÇö/g, '—')
    .replace(/ΓÇó/g, '•')
    .replace(/ΓöÇ+/g, '─')
}

const CACHE_TTL_MS = 10_000
const REQUEST_TIMEOUT_MS = 8_000
const ACCESS_TOKEN_KEY = 'mct_access_token'
const MAX_HTTP_RETRIES = 3

interface CacheEntry {
  data: NotificationItemOut[]
  timestamp: number
  version: number
  nextCursor?: string | null
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

export function notifyNotificationsUpdated(): void {
  clearNotificationCache()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_UPDATED_EVENT))
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith(READ_STORAGE_KEY_PREFIX)) {
      clearNotificationCache()
    }
  })
}

function getAuthHeaders(userRole?: string): Record<string, string> {
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

function buildScopeCacheKey(options?: GetNotificationsOptions): string {
  const uid = options?.userId !== undefined && options?.userId !== null ? String(options.userId) : 'anon'
  const cid = options?.companyId ? String(options.companyId) : 'all'
  const cname = (options?.companyName || 'All Companies').trim().toLowerCase()
  const ntype = (options?.notificationType || '').trim().toUpperCase()
  const cursor = options?.cursor || ''
  return `u:${uid}|cid:${cid}|cn:${cname}|t:${ntype}|c:${cursor}`
}

/**
 * Fetch with bounded exponential backoff retries for transient errors (429, 502, 503, 504).
 * Respects Retry-After header and fails immediately without retry on client errors (400, 401, 403, 404).
 */
async function fetchWithRetry(url: string, init?: RequestInit, maxRetries = MAX_HTTP_RETRIES): Promise<Response> {
  let attempt = 0

  while (true) {
    try {
      const res = await fetch(url, init)

      // Success or non-retryable client error
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res
      }

      // Check if we should retry transient 5xx or 429
      if (attempt >= maxRetries) {
        return res
      }

      attempt += 1

      // Determine delay: respect Retry-After header or use exponential backoff + jitter
      let delayMs = Math.min(10000, Math.pow(2, attempt) * 500 + Math.floor(Math.random() * 300))
      const retryAfter = res.headers.get('Retry-After')
      if (retryAfter) {
        const sec = parseInt(retryAfter, 10)
        if (!isNaN(sec) && sec > 0) {
          delayMs = Math.min(sec * 1000, 15000)
        }
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    } catch (networkErr) {
      if (attempt >= maxRetries) {
        throw networkErr
      }
      attempt += 1
      const delayMs = Math.min(10000, Math.pow(2, attempt) * 500 + Math.floor(Math.random() * 300))
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
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
      if (options?.notificationType) params.append('notification_type', options.notificationType)
      if (options?.cursor) params.append('cursor', options.cursor)
      if (options?.direction) params.append('direction', options.direction)
      params.append('limit', String(options?.limit || 100))

      const url = `/api/v1/notifications?${params.toString()}`
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null

      try {
        const res = await fetchWithRetry(url, {
          headers: getAuthHeaders(options?.userRole),
          signal: controller?.signal,
        })

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            _cacheByKey.delete(cacheKey)
            return []
          }
          return _lastGoodByKey.get(cacheKey) ?? []
        }

        const data = await res.json()
        const rawItems: NotificationItemOut[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : []

        // Deduplicate by notification_id
        const merged: NotificationItemOut[] = []
        const seenIds = new Set<string>()
        for (const item of rawItems) {
          if (item && item.notification_id && !seenIds.has(item.notification_id)) {
            seenIds.add(item.notification_id)
            merged.push({
              ...item,
              title: sanitizeNotificationText(item.title),
              message: sanitizeNotificationText(item.message),
            })
          }
        }

        const finalResult = merged.slice(0, options?.limit || 100)

        if (requestVersion === _mutationVersion) {
          _cacheByKey.set(cacheKey, {
            data: finalResult,
            timestamp: Date.now(),
            version: requestVersion,
            nextCursor: data?.next_cursor || null,
          })
          _lastGoodByKey.set(cacheKey, finalResult)
        }

        return finalResult
      } catch {
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

  async markAsRead(notificationId: string, userId?: string | number | null): Promise<boolean> {
    saveReadNotificationId(notificationId, userId)
    _mutationVersion += 1

    try {
      const res = await fetchWithRetry(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      return res.ok
    } catch {
      return false
    }
  },

  async markAllRead(companyId?: number, userId?: string | number | null): Promise<boolean> {
    clearNotificationCache()

    try {
      const params = new URLSearchParams()
      if (companyId) params.append('company_id', String(companyId))
      const url = `/api/v1/notifications/mark-all-read?${params.toString()}`

      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      return res.ok
    } catch {
      return false
    }
  },

  async getUnreadCount(
    companyId?: number,
    companyName?: string,
    userRole?: string,
    userId?: string | number | null
  ): Promise<number> {
    try {
      const params = new URLSearchParams()
      if (companyId) params.append('company_id', String(companyId))
      if (companyName && companyName !== 'All Companies') params.append('company_name', companyName)

      const res = await fetchWithRetry(`/api/v1/notifications/count?${params.toString()}`, {
        headers: getAuthHeaders(userRole),
      })

      if (res.ok) {
        const json = await res.json()
        return Number(json.unread_count || 0)
      }

      // Fallback to local calculation
      const items = await this.getNotifications({
        userId,
        companyId,
        companyName,
        userRole,
        limit: 100,
      })
      const readSet = getReadNotificationIds(userId)
      return items.filter((item) => !readSet.has(item.notification_id) && !item.read_at).length
    } catch {
      return 0
    }
  },
}
