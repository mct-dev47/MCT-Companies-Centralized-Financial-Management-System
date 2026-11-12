/**
 * Header indicator and outbox panel for entries saved while offline (spec 0038).
 *
 * The indicator is hidden while online with nothing waiting. Otherwise it shows "Offline" and/or
 * "N waiting to sync"; clicking it opens the panel, where each entry can be edited, deleted, or
 * retried, and syncing can be paused, resumed, run now, or cleared.
 */
import * as React from 'react'
import { AlertTriangle, CloudOff, Loader2, Pause, Pencil, Play, RefreshCw, Trash2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmModal } from '@/components/common/ConfirmModal'
import { useOutbox } from '@/hooks/useOutbox'
import { offlineQueue, type OutboxEntry } from '@/services/offlineQueue'
import { offlineSync } from '@/services/offlineSync'
import { formatPHP } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatToYYYYMMDD } from '@/utils/dateUtils'

const KIND_LABEL: Record<OutboxEntry['kind'], string> = {
  sale: 'Sale',
  expense: 'Expense',
  receivable: 'Receivable',
}

function entrySummary(entry: OutboxEntry): { date: string; text: string; amount: number } {
  if (entry.kind === 'receivable') {
    return {
      date: entry.input.date || '',
      text: `${entry.input.customer_name}: ${entry.input.items_summary}`,
      amount: entry.input.total_amount,
    }
  }
  return { date: entry.input.date, text: entry.input.particulars, amount: entry.input.amount }
}

function statusLabel(entry: OutboxEntry, entries: OutboxEntry[]): { text: string; tone: 'wait' | 'send' | 'warn' } {
  if (entry.status === 'needs_attention') return { text: 'Needs attention', tone: 'warn' }
  if (entry.status === 'sending') return { text: 'Sending…', tone: 'send' }
  if (entry.kind === 'receivable' && entries.some((e) => e.id === entry.dependsOn)) {
    return { text: 'Waiting for its sale', tone: 'wait' }
  }
  return { text: 'Waiting to sync', tone: 'wait' }
}

// ------------------------------------------------------------------ indicator

export const OutboxIndicator: React.FC = () => {
  const { entries, online, syncing, needsLogin } = useOutbox()
  const [open, setOpen] = React.useState(false)
  const count = entries.length
  const attention = entries.some((e) => e.status === 'needs_attention')

  if (online && count === 0) return null

  const label = !online
    ? count > 0
      ? `Offline · ${count} waiting`
      : 'Offline'
    : `${count} waiting to sync`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={needsLogin ? 'Log in again to sync your offline entries' : 'Open the offline outbox'}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap',
          attention || needsLogin
            ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
            : !online
              ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
              : 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
        )}
      >
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : !online ? (
          <CloudOff className="h-3.5 w-3.5" />
        ) : attention ? (
          <AlertTriangle className="h-3.5 w-3.5" />
        ) : (
          <UploadCloud className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{count > 0 ? count : 'Offline'}</span>
      </button>
      <OutboxPanel open={open} onOpenChange={setOpen} />
    </>
  )
}

// ------------------------------------------------------------------ panel

interface EditDraft {
  date: string
  amount: string
  particulars: string
  remarks: string
  customerName: string
}

function draftFor(entry: OutboxEntry): EditDraft {
  if (entry.kind === 'receivable') {
    return {
      date: entry.input.date || '',
      amount: String(entry.input.total_amount),
      particulars: entry.input.items_summary,
      remarks: entry.input.notes || '',
      customerName: entry.input.customer_name,
    }
  }
  return {
    date: entry.input.date,
    amount: String(entry.input.amount),
    particulars: entry.input.particulars,
    remarks: entry.input.remarks || '',
    customerName: '',
  }
}

const RESET_FOR_RETRY = { status: 'waiting' as const, attempts: 0, nextAttemptAt: 0, lastError: undefined }

async function saveEdit(entry: OutboxEntry, draft: EditDraft): Promise<string | null> {
  const amount = Math.round(Number(draft.amount) * 100) / 100
  const today = formatToYYYYMMDD(new Date())
  if (!draft.particulars.trim()) return 'Particulars cannot be blank.'

  if (entry.kind === 'receivable') {
    if (!draft.customerName.trim()) return 'Customer name cannot be blank.'
    await offlineQueue.update(entry.id, {
      ...RESET_FOR_RETRY,
      input: { ...entry.input, customer_name: draft.customerName.trim(), notes: draft.remarks.trim() || undefined },
    })
    return null
  }

  if (!draft.date || draft.date > today) return 'Pick a date that is not in the future.'
  if (!Number.isFinite(amount) || amount < 1) return 'Amount must be at least 1.00.'

  const patch = {
    date: draft.date,
    amount,
    particulars: draft.particulars.trim(),
    remarks: draft.remarks.trim() || undefined,
    items: undefined, // the itemized breakdown no longer matches once edited by hand
  }
  if (entry.kind === 'sale') {
    await offlineQueue.update(entry.id, { ...RESET_FOR_RETRY, input: { ...entry.input, ...patch } })
    // Keep the sale's receivable in step with the edited sale
    for (const dep of offlineQueue.getSnapshot().entries) {
      if (dep.kind === 'receivable' && dep.dependsOn === entry.id) {
        await offlineQueue.update(dep.id, {
          input: { ...dep.input, total_amount: amount, date: draft.date, items_summary: patch.particulars },
        })
      }
    }
  } else {
    await offlineQueue.update(entry.id, { ...RESET_FOR_RETRY, input: { ...entry.input, ...patch } })
  }
  return null
}

const inputClass =
  'w-full h-9 rounded-lg border border-stroke/40 bg-background px-3 text-sm text-focus outline-none focus:border-focus/60'

const EntryRow: React.FC<{ entry: OutboxEntry; entries: OutboxEntry[] }> = ({ entry, entries }) => {
  const [editing, setEditing] = React.useState(false)
  const [today] = React.useState(() => formatToYYYYMMDD(new Date()))
  const [draft, setDraft] = React.useState<EditDraft>(() => draftFor(entry))
  const [error, setError] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const summary = entrySummary(entry)
  const status = statusLabel(entry, entries)
  const dependents = entries.filter((e) => e.kind === 'receivable' && e.dependsOn === entry.id).length
  const busy = entry.status === 'sending'

  const onSave = async () => {
    const problem = await saveEdit(entry, draft)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setEditing(false)
    void offlineSync.syncNow()
  }

  return (
    <li className="rounded-xl border border-stroke/30 bg-background p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-surface px-2 py-0.5 font-semibold text-focus">{KIND_LABEL[entry.kind]}</span>
            <span className="text-muted-fg">{entry.company}</span>
            <span className="text-muted-fg">{summary.date}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-semibold',
                status.tone === 'warn' && 'bg-rose-50 text-rose-700',
                status.tone === 'send' && 'bg-sky-50 text-sky-700',
                status.tone === 'wait' && 'bg-amber-50 text-amber-800'
              )}
            >
              {status.text}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-focus break-words">{summary.text}</p>
          {entry.lastError && entry.status === 'needs_attention' && (
            <p className="mt-1 text-xs text-rose-700 break-words">Server said: {entry.lastError}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-focus">{formatPHP(summary.amount)}</p>
          <div className="mt-2 flex justify-end gap-1">
            {entry.status === 'needs_attention' && (
              <Button
                size="icon"
                variant="ghost"
                title="Retry"
                onClick={async () => {
                  await offlineQueue.update(entry.id, RESET_FOR_RETRY)
                  void offlineSync.syncNow()
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              title="Edit"
              disabled={busy}
              onClick={() => {
                setDraft(draftFor(entry))
                setError(null)
                setEditing((v) => !v)
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" title="Delete" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4 text-rose-600" />
            </Button>
          </div>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 border-t border-stroke/20 pt-3">
          {entry.kind === 'receivable' ? (
            <label className="text-xs text-muted-fg sm:col-span-2">
              Customer name
              <input
                className={inputClass}
                value={draft.customerName}
                onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
              />
            </label>
          ) : (
            <>
              <label className="text-xs text-muted-fg">
                Date
                <input
                  type="date"
                  className={inputClass}
                  value={draft.date}
                  max={today}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-fg">
                Amount
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  className={inputClass}
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-fg sm:col-span-2">
                Particulars
                <input
                  className={inputClass}
                  value={draft.particulars}
                  onChange={(e) => setDraft({ ...draft, particulars: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="text-xs text-muted-fg sm:col-span-2">
            {entry.kind === 'receivable' ? 'Notes' : 'Remarks'}
            <input
              className={inputClass}
              value={draft.remarks}
              onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
            />
          </label>
          {error && <p className="text-xs text-rose-700 sm:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSave}>
              Save changes
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this entry?"
        description={
          dependents > 0
            ? 'This entry and its receivable will be removed from this device and never sent to the server.'
            : 'This entry will be removed from this device and never sent to the server.'
        }
        confirmLabel="Delete"
        actionType="delete"
        variant="destructive"
        onConfirm={async () => {
          await offlineQueue.remove(entry.id)
          setConfirmDelete(false)
        }}
      />
    </li>
  )
}

export const OutboxPanel: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({
  open,
  onOpenChange,
}) => {
  const { entries, paused, online, syncing, needsLogin, persistent } = useOutbox()
  const [confirmClear, setConfirmClear] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Offline outbox</DialogTitle>
          <DialogDescription>
            Entries saved on this device while the server could not be reached. They are sent automatically when you
            are back online. Totals and bank balances include them only after they sync.
          </DialogDescription>
        </DialogHeader>

        {!online && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            You are offline. Keep this app open; entries will sync when the internet is back.
          </p>
        )}
        {needsLogin && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Your session expired. Log in again with the same account to send these entries.
          </p>
        )}
        {paused && (
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-focus">Syncing is paused. Nothing will be sent until you resume.</p>
        )}
        {!persistent && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
            This browser blocks on device storage (private window?). Waiting entries will be lost if you reload.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!online || paused || syncing || entries.length === 0}
            onClick={() => void offlineSync.syncNow()}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Sync now
          </Button>
          <Button size="sm" variant="outline" onClick={async () => {
            await offlineQueue.setPaused(!paused)
            if (paused) void offlineSync.syncNow()
          }}>
            {paused ? <Play className="h-4 w-4 mr-1.5" /> : <Pause className="h-4 w-4 mr-1.5" />}
            {paused ? 'Resume sync' : 'Pause sync'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-rose-700"
            disabled={entries.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Clear all
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-fg">Nothing is waiting. Everything has reached the server.</p>
        ) : (
          <ul className="grid gap-2">
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} entries={entries} />
            ))}
          </ul>
        )}

        <ConfirmModal
          open={confirmClear}
          onOpenChange={setConfirmClear}
          title={`Delete all ${entries.length} waiting entries?`}
          description="They will be removed from this device and never sent to the server. This cannot be undone."
          confirmLabel="Delete all"
          actionType="delete"
          variant="destructive"
          onConfirm={async () => {
            await offlineQueue.clearAll()
            setConfirmClear(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
