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

interface RawAuditLogRow {
  audit_log_id: number
  action: string
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
  details?: Record<string, unknown> | string | null
}

function getAuthHeaders(): HeadersInit {
  const token = sessionStorage.getItem(['mct', 'access', 'token'].join('_'))
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
      const url = new URL('/api/v1/activity-logs', window.location.origin)
      const limit = params.limit ?? 1000
      url.searchParams.set('limit', String(limit))

      if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset))
      if (params.search) url.searchParams.set('search', params.search.trim())
      if (params.userId) url.searchParams.set('user_id', String(params.userId))
      if (params.companyId) url.searchParams.set('company_id', String(params.companyId))
      if (params.module) url.searchParams.set('module', params.module.trim())
      if (params.actionCategory) url.searchParams.set('action_category', params.actionCategory.trim())
      if (params.startDate) url.searchParams.set('start_date', params.startDate)
      if (params.endDate) url.searchParams.set('end_date', params.endDate)

      const response = await fetch(url.toString(), {
        cache: 'no-store',
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

        const sev = (row.severity || parsedDetails?.severity || 'INFO') as string
        const normalizedSeverity: 'INFO' | 'WARNING' | 'CRITICAL' =
          sev.toUpperCase() === 'CRITICAL'
            ? 'CRITICAL'
            : sev.toUpperCase() === 'WARNING'
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
          ipAddress: row.ip_address || (parsedDetails?.ip_address as string) || (parsedDetails?.ip as string) || '-',
          severity: normalizedSeverity,
          recordType: row.record_type || (parsedDetails?.record_type as string) || undefined,
          recordId: row.record_id ?? (parsedDetails?.record_id as string | number) ?? undefined,
          recordRef: row.record_ref || (parsedDetails?.record_ref as string) || undefined,
          userAgent: row.user_agent || (parsedDetails?.user_agent as string) || undefined,
          changes: row.changes || (parsedDetails?.changes as Record<string, { old: unknown; new: unknown }>) || undefined,
          rawDetails: parsedDetails,
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
