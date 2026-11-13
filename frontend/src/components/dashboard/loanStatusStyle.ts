/**
 * One place for how a company loan status looks (spec 0046).
 *
 *   Pending Finance                 -> gray
 *   Endorsed by Finance (in audit)  -> yellow
 *   Approved by Audit, to disburse  -> indigo
 *   Disbursed / Paid                -> green
 *   Partially Paid                  -> blue
 *   Rejected / Disapproved          -> red
 */
export type LoanStatusTone = 'gray' | 'yellow' | 'indigo' | 'green' | 'blue' | 'red'

export interface LoanStatusDisplay {
  label: string
  tone: LoanStatusTone
  /** Pill classes (background, text, border). */
  badgeClass: string
  /** Icon color class for the pill icon. */
  iconClass: string
  /** Soft table-row tint, or '' for a plain row. */
  rowClass: string
}

const TONES: Record<LoanStatusTone, { badge: string; icon: string; row: string }> = {
  gray: {
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: 'text-slate-500',
    row: 'bg-slate-50/70 hover:bg-slate-100/60 border-slate-200/60',
  },
  yellow: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: 'text-amber-600',
    row: 'bg-amber-50/70 hover:bg-amber-100/60 border-amber-200/50',
  },
  indigo: {
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    icon: 'text-indigo-600',
    row: 'bg-indigo-50/60 hover:bg-indigo-100/50 border-indigo-200/50',
  },
  green: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: 'text-emerald-600',
    row: '',
  },
  blue: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: 'text-blue-600',
    row: '',
  },
  red: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: 'text-rose-600',
    row: 'bg-rose-50/50 hover:bg-rose-100/50 border-rose-200/50',
  },
}

function make(label: string, tone: LoanStatusTone): LoanStatusDisplay {
  const t = TONES[tone]
  return { label, tone, badgeClass: t.badge, iconClass: t.icon, rowClass: t.row }
}

export function getLoanStatusDisplay(status?: string | null): LoanStatusDisplay {
  const s = (status || '').trim()
  switch (s) {
    case 'Pending Finance Endorsement':
    case 'Pending Approval':
      return make('Pending Finance', 'gray')
    case 'Pending Audit Approval':
      return make('Endorsed · Pending Audit', 'yellow')
    case 'Approved':
      return make('Approved · To Disburse', 'indigo')
    case 'Disbursed':
      return make('Disbursed', 'green')
    case 'Paid':
      return make('Paid', 'green')
    case 'Partially Paid':
      return make('Partially Paid', 'blue')
    case 'Overdue':
      return make('Overdue', 'red')
    case 'Rejected by Finance':
      return make('Rejected', 'red')
    case 'Disapproved by Audit':
      return make('Disapproved', 'red')
    default:
      return make(s || 'Unknown', 'gray')
  }
}

/** Loan statuses whose money has been released to the borrower. */
export const DISBURSED_LOAN_STATUSES = ['Disbursed', 'Paid', 'Partially Paid', 'Overdue']

export function isLoanDisbursed(status?: string | null): boolean {
  return DISBURSED_LOAN_STATUSES.includes((status || '').trim())
}
