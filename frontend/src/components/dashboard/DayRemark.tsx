import * as React from 'react'
import { CalendarDays, ChevronDown, Loader2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatPHP } from '@/lib/format'
import { notifyError } from '@/utils/errorUtils'

/** One transaction of the day, shown beside the remark box so the writer can see what happened. */
export interface DayRemarkEntry {
  id: string
  ref?: string
  particulars: string
  amount: number
  /** Payment status (Paid / Pending / Unpaid) */
  status?: string
  /** Sales only: Deposited / Not Deposited */
  depositStatus?: string
}

interface DayRemarkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  initialValue: string
  onSave: (text: string) => Promise<void>
  entries?: DayRemarkEntry[]
}

export const DayRemarkDialog: React.FC<DayRemarkDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  initialValue,
  onSave,
  entries,
}) => {
  const [value, setValue] = React.useState(initialValue)
  const [saving, setSaving] = React.useState(false)
  // On phones the list is a dropdown; from md up it sits to the left of the remark box
  const [showList, setShowList] = React.useState(false)
  const hasEntries = !!entries && entries.length > 0

  React.useEffect(() => {
    if (open) {
      setValue(initialValue)
      setShowList(false)
    }
  }, [open, initialValue])

  // Click a transaction to drop its reference and amount into the remark
  const insertEntry = (e: DayRemarkEntry) => {
    const line = `${e.ref ? `${e.ref} - ` : ''}${formatPHP(e.amount)}`
    setValue((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${line}: ` : `${line}: `))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(value.trim())
      onOpenChange(false)
    } catch (err) {
      notifyError(err, 'Failed to save the day remark.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'rounded-[24px] p-6 bg-white border border-stroke/30 shadow-2xl',
          hasEntries ? 'max-w-[460px] md:max-w-[860px]' : 'max-w-[460px]'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="text-left pb-3 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-focus leading-tight">{title}</DialogTitle>
              <DialogDescription className="text-xs text-muted-fg mt-0.5">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className={cn('py-4', hasEntries && 'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-5')}>
          {hasEntries && (
            <div className="mb-3 md:mb-0 min-w-0">
              <button
                type="button"
                onClick={() => setShowList((s) => !s)}
                className="md:hidden w-full flex items-center justify-between rounded-xl border border-stroke/50 bg-slate-50 px-3 py-2 text-xs font-semibold text-focus cursor-pointer"
                aria-expanded={showList}
              >
                <span>Transactions that day ({entries!.length})</span>
                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showList && 'rotate-180')} />
              </button>
              <p className="hidden md:block text-xs font-semibold text-focus mb-1.5">
                Transactions that day ({entries!.length})
              </p>
              <ul
                className={cn(
                  'mt-2 md:mt-0 max-h-64 md:max-h-72 overflow-y-auto rounded-xl border border-stroke/40 divide-y divide-slate-100',
                  showList ? 'block' : 'hidden',
                  'md:block'
                )}
              >
                {entries!.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => insertEntry(e)}
                      title="Click to add this transaction's reference and amount to the remark"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-xs font-medium text-focus line-clamp-2 break-words">
                          {e.particulars}
                        </span>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-focus">{formatPHP(e.amount)}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-fg">
                        {e.ref && <span className="font-mono">{e.ref}</span>}
                        {e.status && <span className="font-semibold">{e.status}</span>}
                        {e.depositStatus && <span>{e.depositStatus}</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs font-semibold text-focus block">Remark for the day</Label>
            <textarea
              rows={hasEntries ? 8 : 4}
              maxLength={5000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Write a note about this whole day. Leave it empty to remove the remark."
              className="w-full rounded-xl border border-stroke/50 text-xs p-3 font-normal focus:outline-none focus:ring-1 focus:ring-focus bg-white resize-y"
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-end gap-2 pt-3 border-t border-stroke/20">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
            className="h-8.5 px-3.5 text-xs font-medium rounded-xl border-stroke/50 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="h-8.5 px-4 text-xs font-semibold rounded-xl bg-primary hover:bg-primary/90 text-white flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            {saving ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Saving…</span>
              </>
            ) : (
              <span>Save Day Remark</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface DayRemarkCellProps {
  /** Distinct company names for the records in this day. A day remark needs exactly one. */
  companyNames: string[]
  date: string // YYYY-MM-DD
  formattedDate: string
  kindLabel: 'Sales' | 'Expense'
  canEdit: boolean
  getRemark: (companyName: string, date: string) => string
  onSave: (companyName: string, date: string, text: string) => Promise<void>
  /** 'cell' is a compact table cell; 'block' shows the full text for a modal. */
  variant?: 'cell' | 'block'
  /** The day's transactions, listed beside the remark box while editing. */
  entries?: DayRemarkEntry[]
}

export const DayRemarkCell: React.FC<DayRemarkCellProps> = ({
  companyNames,
  date,
  formattedDate,
  kindLabel,
  canEdit,
  getRemark,
  onSave,
  variant = 'cell',
  entries,
}) => {
  const [open, setOpen] = React.useState(false)
  const distinct = Array.from(new Set(companyNames.filter(Boolean)))

  if (distinct.length !== 1) {
    return (
      <span
        className="text-2xs text-muted-fg/60 italic"
        title="Pick one company to add a day remark."
      >
        Multiple companies
      </span>
    )
  }

  const company = distinct[0]
  const remark = getRemark(company, date)

  return (
    <>
      {variant === 'block' ? (
        <div className="flex items-start justify-between gap-3 min-w-0">
          <p className="min-w-0 flex-1 text-xs font-medium text-focus whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {remark || <span className="text-muted-fg/60 italic font-normal">No remark for this day</span>}
          </p>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="h-7 px-2.5 text-[11px] font-semibold rounded-lg border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary flex items-center gap-1 shrink-0 cursor-pointer"
            >
              <MessageSquare className="w-3 h-3" />
              <span>{remark ? 'Edit Day Remark' : 'Add Day Remark'}</span>
            </Button>
          )}
        </div>
      ) : remark || canEdit ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
          title={canEdit ? 'Click to view or edit the remark for this day' : remark}
          className={cn(
            'block w-full text-left text-xs rounded-md px-1.5 py-1 truncate',
            canEdit ? 'hover:bg-slate-100 cursor-pointer' : 'cursor-default',
            remark ? 'text-focus font-medium' : 'text-muted-fg/40 italic'
          )}
        >
          {remark || 'Add day remark…'}
        </button>
      ) : (
        <span className="text-xs text-muted-fg/40">-</span>
      )}

      <DayRemarkDialog
        open={open}
        onOpenChange={setOpen}
        title="Day Remark"
        description={`${kindLabel} on ${formattedDate} · ${company}`}
        initialValue={remark}
        onSave={(text) => onSave(company, date, text)}
        entries={entries}
      />
    </>
  )
}
