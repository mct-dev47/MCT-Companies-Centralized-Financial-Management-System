import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  Info,
  Clock,
  User,
  Building,
  Globe,
  Monitor,
  Hash,
  ArrowRight,
  Layers,
} from 'lucide-react'
import { formatPHP } from '@/lib/format'
import { notifySuccess } from '@/utils/errorUtils'
import type { ActivityLogItem } from '@/services/activityLogService'

export interface ActivityLogDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  log: ActivityLogItem | null
}

function formatDiffValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-fg italic text-xs">Empty</span>
  }

  if (typeof value === 'boolean') {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
          value
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-slate-100 text-slate-600 border border-slate-200'
        }`}
      >
        {value ? 'Yes' : 'No'}
      </span>
    )
  }

  const strVal = String(value)
  if (strVal === '[REDACTED]') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
        [REDACTED]
      </span>
    )
  }

  const lowerKey = key.toLowerCase()
  const isCurrency =
    lowerKey.includes('amount') ||
    lowerKey.includes('balance') ||
    lowerKey.includes('cost') ||
    lowerKey.includes('price') ||
    lowerKey.includes('fee') ||
    lowerKey.includes('total')

  if (isCurrency && !isNaN(Number(value)) && typeof value !== 'boolean') {
    return (
      <span className="font-semibold tabular-nums text-focus">
        {formatPHP(Number(value))}
      </span>
    )
  }

  if (typeof value === 'object') {
    return (
      <pre className="text-[11px] font-mono bg-surface p-1.5 rounded border border-stroke/30 overflow-x-auto max-w-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  return <span className="break-words">{strVal}</span>
}

export const ActivityLogDetailDrawer: React.FC<ActivityLogDetailDrawerProps> = ({
  open,
  onOpenChange,
  log,
}) => {
  const [copiedIp, setCopiedIp] = React.useState(false)

  if (!log) return null

  const handleCopyIp = async (ip: string) => {
    if (!ip || ip === '-') return
    try {
      await navigator.clipboard.writeText(ip)
      setCopiedIp(true)
      notifySuccess('IP address copied to clipboard')
      setTimeout(() => setCopiedIp(false), 2000)
    } catch {
      // Fallback
    }
  }

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Critical</span>
          </span>
        )
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Warning</span>
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Info</span>
          </span>
        )
    }
  }

  const changesList = log.changes
    ? Object.entries(log.changes)
    : []

  const hasChanges = changesList.length > 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl bg-white p-6 sm:p-8 overflow-y-auto space-y-6 flex flex-col justify-between"
      >
        <div className="space-y-6">
          {/* Drawer Header */}
          <SheetHeader className="text-left space-y-2 border-b border-stroke/30 pb-4">
            <div className="flex items-center justify-between gap-3 pr-8">
              <div className="flex items-center gap-2">
                {getSeverityBadge(log.severity)}
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-surface border border-stroke/40 text-focus/80">
                  {log.module}
                </span>
              </div>
              <span className="text-xs font-mono text-muted-fg">
                Log #{log.id}
              </span>
            </div>
            <SheetTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
              {log.action}
            </SheetTitle>
            <SheetDescription className="text-xs sm:text-sm text-muted-fg flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{log.time}</span>
            </SheetDescription>
          </SheetHeader>

          {/* Overview Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl border border-stroke/30 bg-surface/40 flex items-start gap-3">
              <User className="w-4 h-4 text-focus/70 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider">
                  Actor
                </div>
                <div className="text-sm font-semibold text-focus truncate">
                  {log.user}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-stroke/30 bg-surface/40 flex items-start gap-3">
              <Building className="w-4 h-4 text-focus/70 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider">
                  Company
                </div>
                <div className="text-sm font-semibold text-focus truncate">
                  {log.company}
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-stroke/30 bg-surface/40 flex items-start gap-3">
              <Hash className="w-4 h-4 text-focus/70 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider">
                  Affected Record
                </div>
                <div className="text-sm font-semibold text-focus truncate font-mono">
                  {log.recordRef || log.target || '-'}
                </div>
                {log.recordType && (
                  <div className="text-[11px] text-muted-fg mt-0.5">
                    Type: {log.recordType}
                    {log.recordId ? ` #${log.recordId}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-stroke/30 bg-surface/40 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <Globe className="w-4 h-4 text-focus/70 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-muted-fg uppercase tracking-wider">
                    Client IP Address
                  </div>
                  <div className="text-sm font-mono font-medium text-focus truncate">
                    {log.ipAddress}
                  </div>
                </div>
              </div>
              {log.ipAddress && log.ipAddress !== '-' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyIp(log.ipAddress)}
                  className="h-8 px-2 rounded-lg text-xs font-semibold text-muted-fg hover:text-focus hover:bg-white border border-stroke/30"
                  aria-label="Copy IP address"
                >
                  {copiedIp ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* User Agent / Device Network Info */}
          {log.userAgent && (
            <div className="p-3.5 rounded-xl border border-stroke/30 bg-surface/30 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-fg uppercase tracking-wider">
                <Monitor className="w-3.5 h-3.5 text-focus/70" />
                <span>Client User Agent</span>
              </div>
              <div className="text-xs font-mono text-focus/80 break-all bg-white p-2.5 rounded-lg border border-stroke/20">
                {log.userAgent}
              </div>
            </div>
          )}

          {/* Change Diff Section (AC-2, AC-3) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-focus/80" />
                <h3 className="text-sm font-bold text-focus uppercase tracking-wider">
                  Field Changes
                </h3>
              </div>
              {hasChanges && (
                <span className="text-xs text-muted-fg font-medium">
                  {changesList.length} field{changesList.length > 1 ? 's' : ''} modified
                </span>
              )}
            </div>

            {hasChanges ? (
              <div className="rounded-xl border border-stroke/30 overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface/80 border-b border-stroke/30 text-focus/80 font-bold uppercase tracking-wider text-[11px]">
                      <th className="py-2.5 px-3 w-[28%]">Field</th>
                      <th className="py-2.5 px-3 w-[36%]">Previous Value</th>
                      <th className="py-2.5 px-3 w-[36%]">Updated Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stroke/20 bg-white">
                    {changesList.map(([key, diff]) => (
                      <tr key={key} className="hover:bg-surface/30 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-focus align-top">
                          <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                          <span className="block text-[10px] text-muted-fg font-mono">
                            {key}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <div className="p-1.5 rounded-md bg-rose-50/70 border border-rose-200/60 text-rose-900 font-mono text-xs break-all">
                            {formatDiffValue(key, diff?.old)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 align-top">
                          <div className="p-1.5 rounded-md bg-emerald-50/70 border border-emerald-200/60 text-emerald-900 font-mono text-xs break-all">
                            {formatDiffValue(key, diff?.new)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : log.rawDetails && Object.keys(log.rawDetails).length > 0 ? (
              <div className="p-4 rounded-xl border border-stroke/30 bg-surface/30 space-y-2">
                <div className="text-xs font-semibold text-focus flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-focus/70" />
                  <span>Payload Details</span>
                </div>
                <pre className="text-xs font-mono text-focus/80 bg-white p-3 rounded-lg border border-stroke/20 overflow-x-auto max-h-60">
                  {JSON.stringify(log.rawDetails, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="p-6 rounded-xl border border-dashed border-stroke/40 bg-surface/20 text-center space-y-1">
                <Info className="w-5 h-5 text-muted-fg mx-auto" />
                <div className="text-xs font-medium text-focus/80">
                  No field level changes recorded
                </div>
                <p className="text-[11px] text-muted-fg">
                  This action was recorded as an event snapshot without before and after diff attributes.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="pt-4 border-t border-stroke/30 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl px-4 text-xs font-semibold"
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

