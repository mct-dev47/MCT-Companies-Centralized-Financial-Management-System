import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Receipt,
  AlertCircle,
  Building2,
  Calendar,
  Bell,
  Check,
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import {
  billsService,
  type BillItem,
  type NewBillInput,
} from '@/services/billsService'
import { loanService } from '@/services/loanService'
import { formatToYYYYMMDD } from '@/utils/dateUtils'
import { formatUserFriendlyErrorMessage } from '@/utils/errorUtils'
import { cn } from '@/lib/utils'

interface AddBillModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (newBill: BillItem) => void
  assignedCompany: string
  isCompanyScoped?: boolean
  companies?: string[]
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

export const AddBillModal: React.FC<AddBillModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  assignedCompany,
  companies: propsCompanies,
}) => {
  const { user } = useSession()
  const isFinance = user?.role === 'Finance'
  const isAdmin = user?.role === 'Admin'
  const canChooseCompany = isFinance || isAdmin

  const [dbCompanies, setDbCompanies] = React.useState<string[]>(() =>
    propsCompanies?.filter((c) => c !== 'All Companies') || []
  )

  React.useEffect(() => {
    let mounted = true
    loanService.getCompanies().then((res) => {
      if (mounted && res.length > 0) {
        const names = res.map((c) => c.company_name).filter(Boolean)
        setDbCompanies(names)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  const getTodayIso = () => formatToYYYYMMDD(new Date())

  // Form states
  const [billerName, setBillerName] = React.useState('')
  const [company, setCompany] = React.useState(assignedCompany || propsCompanies?.find((c) => c !== 'All Companies') || '')
  const [billingCycle, setBillingCycle] = React.useState<'Daily' | 'Monthly' | 'Yearly'>('Monthly')

  // Recurrence-specific schedule states (effective immediately)
  const [dueDayOfMonth, setDueDayOfMonth] = React.useState<number>(() => new Date().getDate())
  const [yearlyMonth, setYearlyMonth] = React.useState<number>(() => new Date().getMonth() + 1)
  const [yearlyDay, setYearlyDay] = React.useState<number>(() => new Date().getDate())

  const [reminderDaysBefore, setReminderDaysBefore] = React.useState<number>(5)
  const [notes, setNotes] = React.useState('')

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<{
    billerName?: string
    dueDate?: string
  }>({})

  const handleBillingCycleChange = (cycle: 'Daily' | 'Monthly' | 'Yearly') => {
    setBillingCycle(cycle)
    if (cycle === 'Daily') {
      setReminderDaysBefore(0)
    } else if (cycle === 'Monthly') {
      if (reminderDaysBefore === 0) setReminderDaysBefore(5)
    } else if (cycle === 'Yearly') {
      if (reminderDaysBefore < 7) setReminderDaysBefore(14)
    }
  }

  const getComputedDueDate = (): string => {
    const now = new Date()
    const y = now.getFullYear()
    if (billingCycle === 'Daily') {
      return getTodayIso()
    }
    if (billingCycle === 'Yearly') {
      const maxDays = new Date(y, yearlyMonth, 0).getDate()
      const day = Math.min(yearlyDay, maxDays)
      return `${y}-${String(yearlyMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    // Monthly (effective immediately for current month)
    const m = now.getMonth() + 1
    const maxDays = new Date(y, m, 0).getDate()
    const day = Math.min(dueDayOfMonth, maxDays)
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // Reset when opening
  React.useEffect(() => {
    if (open) {
      const now = new Date()
      setBillerName('')
      setDueDayOfMonth(now.getDate())
      setYearlyMonth(now.getMonth() + 1)
      setYearlyDay(now.getDate())
      setCompany(assignedCompany || propsCompanies?.find((c) => c !== 'All Companies') || dbCompanies[0] || '')
      setBillingCycle('Monthly')
      setReminderDaysBefore(5)
      setNotes('')
      setError('')
      setFieldErrors({})
      setIsSubmitting(false)
    }
  }, [open, assignedCompany])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const errors: { billerName?: string; dueDate?: string } = {}

    if (!billerName.trim()) {
      errors.billerName = 'Bill / Provider name is required.'
    }

    const computedDueDate = getComputedDueDate()
    if (!computedDueDate) {
      errors.dueDate = 'Valid schedule / due date is required.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    const targetCompany = canChooseCompany ? company : assignedCompany

    // Check for duplicate biller name under this company
    try {
      const existingBills = await billsService.getBills(targetCompany)
      const isDuplicate = existingBills.some(
        (b) =>
          b.company.toLowerCase() === targetCompany.toLowerCase() &&
          b.billerName.trim().toLowerCase() === billerName.trim().toLowerCase()
      )
      if (isDuplicate) {
        setFieldErrors({
          billerName: `A bill for provider "${billerName.trim()}" already exists for ${targetCompany}. Provider names cannot be duplicated.`,
        })
        setError(`A bill for provider "${billerName.trim()}" already exists for ${targetCompany}.`)
        return
      }
    } catch {
      // Continue to submission if verification fails
    }

    setIsSubmitting(true)
    try {
      const input: NewBillInput = {
        billerName: billerName.trim(),
        amount: 0,
        dueDate: computedDueDate,
        dueDayOfMonth: billingCycle === 'Monthly' ? dueDayOfMonth : undefined,
        company: targetCompany,
        billingCycle,
        reminderDaysBefore,
        notes: notes.trim(),
      }

      const created = await billsService.createBill(input)
      onSuccess(created)
      onOpenChange(false)
    } catch (err: any) {
      const msg = formatUserFriendlyErrorMessage(err, 'Unable to create bill record. Please try again.')
      if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('duplicate')) {
        setFieldErrors({ billerName: msg })
      }
      setError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6 sm:p-8 bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left pb-4 border-b border-stroke/20 pr-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#960C01] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-focus leading-tight">
                Add Recurring Bill
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-fg font-normal">
                Set up a recurring bill schedule and due date reminder
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Biller Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-focus flex items-center gap-1.5">
              <span>Bill / Provider Name</span>
              <span className="text-red-500">*</span>
            </Label>
            <Input
              type="text"
              placeholder="e.g. Meralco Commercial Power, Manila Water, PLDT Fiber..."
              value={billerName}
              onChange={(e) => {
                setBillerName(e.target.value)
                if (fieldErrors.billerName) {
                  setFieldErrors((prev) => ({ ...prev, billerName: undefined }))
                }
              }}
              className={cn(
                'h-10 rounded-xl border-stroke/50 text-xs font-medium',
                fieldErrors.billerName && 'border-red-500 focus-visible:ring-red-200'
              )}
            />
            {fieldErrors.billerName && (
              <p className="text-[11px] text-red-600 font-medium">{fieldErrors.billerName}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 2. Company */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Company</span>
                <span className="text-red-500">*</span>
              </Label>
              {canChooseCompany ? (
                <select
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
                >
                  {dbCompanies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="w-full h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-xs text-focus font-semibold flex items-center truncate">
                  {assignedCompany}
                </div>
              )}
            </div>

            {/* 3. Recurring Schedule */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Recurring Schedule</span>
                <span className="text-red-500">*</span>
              </Label>
              <select
                value={billingCycle}
                onChange={(e) => handleBillingCycleChange(e.target.value as 'Daily' | 'Monthly' | 'Yearly')}
                className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
              >
                <option value="Daily">Daily (Every Day)</option>
                <option value="Monthly">Monthly (Day of Month)</option>
                <option value="Yearly">Yearly (Annual Renewal)</option>
              </select>
            </div>
          </div>

          {/* 4. Recurrence Dynamic Schedule */}
          {billingCycle === 'Monthly' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Due Day of the Month</span>
                <span className="text-red-500">*</span>
              </Label>
              <select
                value={dueDayOfMonth}
                onChange={(e) => setDueDayOfMonth(parseInt(e.target.value, 10))}
                className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
              >
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    Due every {d}{getOrdinalSuffix(d)} of the month
                  </option>
                ))}
                <option value={31}>Due every 31st (or last day of month)</option>
              </select>
            </div>
          )}

          {billingCycle === 'Yearly' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-focus flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-fg shrink-0" />
                <span>Annual Renewal (Month & Day)</span>
                <span className="text-red-500">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={yearlyMonth}
                  onChange={(e) => setYearlyMonth(parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
                >
                  {MONTH_NAMES.map((m, idx) => (
                    <option key={m} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={yearlyDay}
                  onChange={(e) => setYearlyDay(parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d} ({d}{getOrdinalSuffix(d)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 5. Reminder Notification */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-focus flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Due Date Reminder</span>
            </Label>
            {billingCycle === 'Daily' ? (
              <div className="w-full h-10 px-3 rounded-xl border border-stroke/40 bg-slate-50 text-xs text-muted-fg font-medium flex items-center">
                <span>Automatic daily alerts: Notifies on <strong>Due Today</strong> and <strong>Overdue</strong></span>
              </div>
            ) : billingCycle === 'Yearly' ? (
              <select
                value={reminderDaysBefore}
                onChange={(e) => setReminderDaysBefore(parseInt(e.target.value, 10))}
                className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
              >
                <option value={7}>7 days before annual renewal</option>
                <option value={14}>14 days before annual renewal</option>
                <option value={30}>30 days before annual renewal</option>
                <option value={60}>60 days before annual renewal</option>
              </select>
            ) : (
              <select
                value={reminderDaysBefore}
                onChange={(e) => setReminderDaysBefore(parseInt(e.target.value, 10))}
                className="w-full h-10 px-3 rounded-xl border border-stroke/50 bg-white text-xs font-medium text-focus shadow-2xs focus:outline-none focus:ring-2 focus:ring-focus/20 focus:border-focus cursor-pointer"
              >
                <option value={1}>1 day before due date</option>
                <option value={3}>3 days before due date</option>
                <option value={5}>5 days before due date</option>
                <option value={7}>7 days before due date</option>
                <option value={10}>10 days before due date</option>
                <option value={14}>14 days before due date</option>
              </select>
            )}
          </div>

          {/* 6. Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-focus block">
              Notes / Particulars (Optional)
            </Label>
            <Input
              type="text"
              placeholder="e.g. Meter reading ID, store location, payment instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-10 rounded-xl border-stroke/50 text-xs"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-stroke/15">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-10 px-4 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-10 px-5 rounded-xl bg-[#960C01] hover:bg-[#800a01] active:bg-[#700801] text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : 'Add Bill Record'}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
