import * as React from 'react'
import { useCompany } from '@/context/CompanyContext'
import { dailyRemarksService, type DailyRemarkKind } from '@/services/dailyRemarksService'

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Loads and saves day remarks (one per company, per date, per kind).
 * Pass the company names currently on screen; remarks are keyed by company name and date.
 */
export function useDailyRemarks(kind: DailyRemarkKind, companyNames: string[]) {
  const { dbCompanies } = useCompany()
  const [remarks, setRemarks] = React.useState<Record<string, string>>({})

  const resolveCompanyId = React.useCallback(
    (name: string): number | null => {
      const target = norm(name || '')
      if (!target) return null
      const match = dbCompanies.find((c) => norm(c.name || c.company_name || '') === target)
      const id = match ? (match.id ?? match.company_id) : null
      return id && id > 0 ? id : null
    },
    [dbCompanies]
  )

  const key = (name: string, date: string) => `${norm(name)}|${date}`

  // A stable string so the effect only reruns when the set of companies changes.
  const namesKey = React.useMemo(
    () => Array.from(new Set(companyNames.filter(Boolean).map(norm))).sort().join('||'),
    [companyNames]
  )

  const load = React.useCallback(async () => {
    const names = namesKey ? namesKey.split('||') : []
    const results = await Promise.all(
      names.map(async (name) => {
        const id = resolveCompanyId(name)
        if (!id) return []
        try {
          const rows = await dailyRemarksService.list(id, kind)
          return rows.map((r) => [key(name, r.date), r.remarks] as const)
        } catch {
          return []
        }
      })
    )
    const next: Record<string, string> = {}
    for (const group of results) for (const [k, v] of group) next[k] = v
    setRemarks(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, kind, resolveCompanyId])

  React.useEffect(() => {
    void load()
  }, [load])

  const getRemark = React.useCallback(
    (name: string, date: string) => remarks[key(name, date)] || '',
    [remarks]
  )

  const saveRemark = React.useCallback(
    async (name: string, date: string, text: string) => {
      const id = resolveCompanyId(name)
      if (!id) throw new Error('Could not find this company. Please refresh and try again.')
      const saved = await dailyRemarksService.save(id, kind, date, text)
      setRemarks((prev) => {
        const next = { ...prev }
        if (saved) next[key(name, date)] = saved.remarks
        else delete next[key(name, date)]
        return next
      })
    },
    [kind, resolveCompanyId]
  )

  return { getRemark, saveRemark, resolveCompanyId, reload: load }
}
