/**
 * activityLogService.ts
 * ---------------------
 * Dedicated client-side service for managing and querying real activity logs
 * stored in Supabase. Backed by the event-driven architecture and automated
 * 6-month data retention policy.
 *
 * Utilizes errorUtils to catch, sanitize, and format all potential network,
 * server, and validation errors into user-friendly messages.
 */

import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { getAuthToken } from '@/services/authService'

export interface ActivityLogItem {
  id: string
  company: string
  user: string
  userRole?: string
  action: string
  module: string
  target: string
  time: string
  ipAddress: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  recordType?: string
  recordId?: string | number
  recordRef?: string
  userAgent?: string
  changes?: Record<string, { old: unknown; new: unknown }>
  rawDetails?: Record<string, unknown>
  details?: any
  rawCreatedAt?: string
}

export interface ActivityLogQueryParams {
  search?: string
  userId?: number
  companyId?: number
  module?: string
  actionCategory?: string
  startDate?: string | null
  endDate?: string | null
  limit?: number
  offset?: number
}

export interface PurgeExpiredResult {
  purged_count: number
  cutoff_date: string
  message: string
}

export interface EntityTimelineEvent {
  id: string
  action: string
  event_type: 'created' | 'edited' | 'audited' | 'endorsed' | 'disbursed' | 'payment' | 'general'
  title: string
  actor_name: string
  actor_role?: string | null
  timestamp: string
  description?: string | null
  changes?: Record<string, unknown> | null
  notes?: string | null
  status_badge?: string | null
}

export interface EntityTimelineQueryParams {
  recordType: string
  recordId?: string | number
  refNo?: string
  companyId?: number
}

interface RawAuditLogRow {
  audit_log_id: number
  action: string
  action_category?: string
  created_at?: string | null
  user_name?: string
  company_name?: string
  description?: string
  module?: string
  target?: string
  ip_address?: string | null
  severity?: string | null
  record_type?: string | null
  record_id?: string | number | null
  record_ref?: string | null
  user_agent?: string | null
  changes?: Record<string, { old: unknown; new: unknown }> | null
  details?: any
}

function getAuthHeaders(): HeadersInit {
  const token = getAuthToken() || sessionStorage.getItem('mct_access_token')
  return token ? { Authorization: 'Bearer ' + token } : {}
}

async function getApiError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return formatUserFriendlyErrorMessage(
      body,
      response.statusText || 'Unable to complete the request. Please try again.'
    )
  } catch {
    return formatUserFriendlyErrorMessage(
      { status: response.status, message: response.statusText },
      'Unable to complete the request. Please try again.'
    )
  }
}

/**
 * Formats ISO UTC date string into "YYYY-MM-DD HH:mm" in the browser's local timezone.
 */
export function formatLogTime(value?: string | null): string {
  if (!value) return ''
  const raw = String(value).trim().replace(' ', 'T')
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(raw)
  const d = new Date(hasZone ? raw : `${raw}Z`)
  if (isNaN(d.getTime())) return value

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const activityLogService = {
  /**
   * Fetches real activity logs directly from Supabase via the backend API.
   * Admin-only. Supports query filtering and pagination.
   */
  async getActivityLogs(params: ActivityLogQueryParams = {}): Promise<ActivityLogItem[]> {
    try {
      const searchParams = new URLSearchParams()
      const limit = params.limit ?? 1000
      searchParams.set('limit', String(limit))

      if (params.offset !== undefined) searchParams.set('offset', String(params.offset))
      if (params.search) searchParams.set('search', params.search.trim())
      if (params.userId) searchParams.set('user_id', String(params.userId))
      if (params.companyId) searchParams.set('company_id', String(params.companyId))
      if (params.module) searchParams.set('module', params.module.trim())
      if (params.actionCategory) searchParams.set('action_category', params.actionCategory.trim())
      if (params.startDate) searchParams.set('start_date', params.startDate)
      if (params.endDate) searchParams.set('end_date', params.endDate)

      const endpoint = `/api/v1/activity-logs?${searchParams.toString()}`
      const response = await fetch(endpoint, {
        cache: 'no-store',
        credentials: 'include',
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error(await getApiError(response))
      }

      const rows = (await response.json()) as RawAuditLogRow[]
      return rows.map((row) => {
        let parsedDetails: Record<string, unknown> | undefined
        if (typeof row.details === 'object' && row.details !== null) {
          parsedDetails = row.details as Record<string, unknown>
        } else if (typeof row.details === 'string') {
          try {
            parsedDetails = JSON.parse(row.details)
          } catch {
            // ignore malformed details
          }
        }

        const sevRaw = row.severity || parsedDetails?.severity || 'INFO'
        const sevStr = typeof sevRaw === 'string' ? sevRaw : String(sevRaw || 'INFO')
        const normalizedSeverity: 'INFO' | 'WARNING' | 'CRITICAL' =
          sevStr.toUpperCase() === 'CRITICAL'
            ? 'CRITICAL'
            : sevStr.toUpperCase() === 'WARNING'
            ? 'WARNING'
            : 'INFO'

        return {
          id: String(row.audit_log_id),
          company: row.company_name || 'System',
          user: row.user_name || 'System',
          action: row.description || row.action,
          module: row.module || 'General',
          target: row.target || (row.record_ref ? String(row.record_ref) : '-'),
          time: formatLogTime(row.created_at),
          ipAddress: row.ip_address || (parsedDetails?.ip_address as string) || (parsedDetails?.ip as string) || '—',
          severity: normalizedSeverity,
          recordType: row.record_type || (parsedDetails?.record_type as string) || undefined,
          recordId: row.record_id ?? (parsedDetails?.record_id as string | number) ?? undefined,
          recordRef: row.record_ref || (parsedDetails?.record_ref as string) || undefined,
          userAgent: row.user_agent || (parsedDetails?.user_agent as string) || undefined,
          changes: row.changes || (parsedDetails?.changes as Record<string, { old: unknown; new: unknown }>) || undefined,
          rawDetails: parsedDetails,
          details: row.details,
          rawCreatedAt: row.created_at || '',
        }
      })
    } catch (err) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to load activity logs. Please try again.'))
    }
  },

  /**
   * Data Retention Maintenance: Purge activity logs older than retention period (default 180 days / 6 months).
   */
  async purgeExpiredLogs(retentionDays = 180): Promise<PurgeExpiredResult> {
    try {
      const response = await fetch(`/api/v1/activity-logs/purge-expired?retention_days=${retentionDays}`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      })
      if (!response.ok) {
        throw new Error(await getApiError(response))
      }
      return (await response.json()) as PurgeExpiredResult
    } catch (err) {
      throw new Error(formatUserFriendlyErrorMessage(err, 'Unable to purge expired activity logs. Please try again.'))
    }
  },

  /**
   * Fetches the unified lifecycle timeline for any financial movement or record
   * (Sales, Expenses, Petty Cash topups/reimbursements, Loans, etc.).
   */
  async getEntityTimeline(params: EntityTimelineQueryParams): Promise<EntityTimelineEvent[]> {
    try {
      const searchParams = new URLSearchParams()
      searchParams.set('record_type', params.recordType)
      if (params.recordId !== undefined && params.recordId !== null) {
        searchParams.set('record_id', String(params.recordId))
      }
      if (params.refNo) {
        searchParams.set('ref_no', params.refNo)
      }
      if (params.companyId !== undefined && params.companyId !== null) {
        searchParams.set('company_id', String(params.companyId))
      }

      const endpoint = `/api/v1/activity-logs/timeline?${searchParams.toString()}`
      const response = await fetch(endpoint, {
        cache: 'no-store',
        credentials: 'include',
        headers: getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error(await getApiError(response))
      }

      return (await response.json()) as EntityTimelineEvent[]
    } catch (err) {
      console.warn('Unable to load entity timeline:', err)
      return []
    }
  },

  /**
   * Subscribe to real-time WebSocket broadcast notifications for new activity logs.
   */
  subscribeToActivityLogs(callback: (data: unknown) => void): () => void {
    const handler = (event: Event) => {
      try {
        const customEvent = event as CustomEvent
        if (customEvent.detail?.type === 'ACTIVITY_LOG_CREATED') {
          callback(customEvent.detail.data)
        }
      } catch (err) {
        console.warn('Error handling activity log websocket event:', err)
      }
    }
    window.addEventListener('mct_ws_message', handler)
    return () => {
      window.removeEventListener('mct_ws_message', handler)
    }
  },
}
