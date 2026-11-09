export type DailyRemarkKind = 'sales' | 'expense'

export interface DailyRemark {
  companyId: number
  kind: DailyRemarkKind
  date: string // YYYY-MM-DD
  remarks: string
  updatedBy?: string
  updatedAt?: string
}

function authHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? sessionStorage.getItem('mct_access_token') : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function mapRow(row: any): DailyRemark {
  return {
    companyId: row.company_id,
    kind: row.kind,
    date: row.remark_date,
    remarks: row.remarks || '',
    updatedBy: row.updated_by || undefined,
    updatedAt: row.updated_at || undefined,
  }
}

export const dailyRemarksService = {
  async list(
    companyId: number,
    kind: DailyRemarkKind,
    range?: { from?: string; to?: string }
  ): Promise<DailyRemark[]> {
    const params = new URLSearchParams({ company_id: String(companyId), kind })
    if (range?.from) params.set('date_from', range.from)
    if (range?.to) params.set('date_to', range.to)

    const res = await fetch(`/api/v1/daily-remarks?${params.toString()}`, {
      headers: authHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to load day remarks.')
    }
    const rows = await res.json()
    return Array.isArray(rows) ? rows.map(mapRow) : []
  },

  /** Saves the remark for one day. Empty text clears it. Returns null when cleared. */
  async save(
    companyId: number,
    kind: DailyRemarkKind,
    date: string,
    remarks: string
  ): Promise<DailyRemark | null> {
    const res = await fetch('/api/v1/daily-remarks', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        company_id: companyId,
        kind,
        remark_date: date,
        remarks: remarks.trim(),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(typeof err.detail === 'string' ? err.detail : 'Failed to save day remark.')
    }
    const row = await res.json()
    return row ? mapRow(row) : null
  },
}
