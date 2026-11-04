# 0015. Tenant lease repeat and monthly payment schedule

**Date**: 2026-10-30
**Status**: In Progress

## Summary

When you create a tenant lease for JK Property and Ventures, you can now pick how it repeats (Does not repeat, Daily, Monthly, Quarterly, Annually), the way you pick a repeat in Google Calendar. The system works out every due date and shows a Payment Schedule on the lease details, in the same style as the Lending page, so you can see each month and whether it is paid. Each payment starts at the period you pick, and any extra money pays the following months as advance credit. Late penalties are optional and set per lease, never built in. Existing leases keep working exactly as they do today.

## Context

Tenant leases live only in the browser (`localStorage`, key `mct_jk_tenants_leases_v1`) and are handled in `frontend/src/pages/TenantPage.tsx`. A lease has one Date Contracted, one Due Date, a typed Rent Amount, a typed Total Payable, and a flat list of daily payment records. There is no concept of a repeating due date, so a tenant who pays rent every month has no schedule to check against.

The Lending page already has this idea for loans (`frontend/src/services/lendingService.ts`: `getMonthlyProgress`, `getNextInstallmentInfo`, spec 0007). It cannot be reused as is. It splits one total across cycles, it carries extra money forward as advance credit, and its date helper `getCycleDueDate` uses `Date.setMonth`, which pushes January 31 into March. Rent is different: the same Rent Amount is charged every period.

The tenant data has no backend table, so this change is frontend only. Dates are plain `YYYY-MM-DD` strings. "Today" is the browser's local date.

## Requirements

**User stories**:
- As a property manager, I want to choose how often a lease repeats when I create it, so that each due date is generated for me.
- As a property manager, I want a payment schedule per lease, so that I can see which months are paid, partly paid, missed, or still to come.
- As a property manager, I want to choose which period a payment is for, so that the ledger matches the receipt I issued.
- As the owner of JK Property, I want an optional late penalty per lease, so that I decide whether and how much to charge.

**Acceptance criteria** (the contract, each independently checkable):
- **AC-1**: The New Tenant Lease Agreement form and the Edit form have a Repeat selector with: Does not repeat (default), Daily, Monthly, Quarterly, Annually.
- **AC-2**: When a repeat is chosen, the Due Date field is labelled First Due Date, a required Lease End Date field appears, and an optional Late Penalty (%) field appears. A summary line reads like Google Calendar, for example "Repeats monthly on the 15th, 12 payments".
- **AC-3**: Due dates are generated from the First Due Date by frequency. Each period keeps the same day of the month as the First Due Date (Daily moves one day, Quarterly three months, Annually one year). A day that does not exist in a month falls on that month's last day (the 31st becomes Feb 28 or 29). A due date is included only if it is on or before the Lease End Date.
- **AC-4**: Form validation for a repeating lease: Lease End Date is on or after the First Due Date; First Due Date is on or after Date Contracted; the schedule has between 1 and 1000 periods; Late Penalty is blank or between 0 and 100.
- **AC-5**: For a repeating lease, Total Payable is read only and equals Rent Amount multiplied by the number of periods. The form shows a live preview: number of periods, amount per period, total.
- **AC-6**: A lease set to Does not repeat, and every lease already saved before this change, behaves exactly as today (same fields, same payment modal, same table). No stored data is rewritten.
- **AC-7**: The Tenant Lease Details modal of a repeating lease has a Payment Schedule section with one row per period: period label (Month 1, Quarter 1, Year 1, Day 1), due date, amount due, penalty, paid (direct plus advance), remaining, status. It is paginated at 10 rows, shows "Periods paid X of N", and shows the next due period. The existing Payment Ledger stays below it.
- **AC-8**: In the Tenants table, a repeating lease shows the next unpaid period's due date and label in the Due Date cell, marked as overdue when that date has passed. CSV and PDF export use the same value. A lease with every period paid shows "Fully paid".
- **AC-9**: Update Rent Payment for a repeating lease has a Period selector. It defaults to the earliest period with a balance. Fully paid periods cannot be selected. The amount must be greater than 0 and at most the lease's total remaining. The saved record stores the chosen period number as the starting period.
- **AC-10**: Advance credit. A payment fills its starting period first. Any extra flows forward to the next periods in order, each up to its own remaining, and never back to earlier periods. A later period covered only by this extra money is shown as Advance Paid, with the note "Covered by advance payment". A payment that is not enough for its period leaves that period Partially Paid. Periods before the starting period that were skipped stay as they are.
- **AC-11**: Period status is worked out, not typed. Paid: nothing remaining and some of it paid directly. Advance Paid: nothing remaining and all of it covered by extra money from earlier payments. Partially Paid: something paid, something remaining. Missed: nothing paid and the due date has passed (Monthly, Quarterly, Annually). Unpaid: otherwise. For Daily leases, Missed is set only by the manual Missed control in Update Rent Payment, and a Missed day can still be paid later. The manual Missed control is shown only for Daily leases.
- **AC-12**: Late penalty is off unless Late Penalty (%) is set on the lease, with no default value anywhere in code. When set, a period gets one penalty of that percentage of its rent if its due date has passed and its rent was not fully covered by money paid on or before the due date (money paid on or before the due date counts for the period it flows into, including advance credit). The penalty is added to that period's amount due, is not compounded, and does not repeat. A payment fills a period's rent first, then its penalty.
- **AC-13**: For a repeating lease, Amount Paid, Remaining Balance, collection progress, and the Completed status come from the schedule (total due includes penalties). The lease becomes Completed when every period is fully paid. The manual Status selector still works as today.
- **AC-14**: Edit rules once a repeating lease has any payment: Repeat type and First Due Date are locked; Lease End Date cannot be moved before the last period that has money applied to it (including advance credit); Rent Amount cannot be set so that the new total due is below the total already paid. A message states the reason for each blocked change.
- **AC-15**: Audit role users see the schedule but cannot record payments or edit leases, as on the page today.

## Options considered

### Option 1: Derive the schedule from the lease settings, tag each payment with a period

Store only Repeat, First Due Date, Lease End Date, and Late Penalty on the lease. Work out every period, status, penalty, advance credit, and total each time it is needed, from those settings and the payment records, each of which carries the period number it starts from. Payments are replayed in date order to decide where each peso lands.

**Pros**:
- Nothing to keep in sync. A rent change or a late payment can never leave a stale schedule row.
- Additive optional fields, so old leases need no migration.
- The date and status logic is pure functions in one file, easy to test.

**Cons**:
- Totals are recomputed on every render. The cap of 1000 periods keeps this cheap.
- Every place that reads Amount Paid or Remaining Balance must call the helper for repeating leases.

### Option 2: Store the generated schedule rows on the lease

Create a row per period when the lease is saved and mutate the rows on every payment.

**Pros**:
- Easy to read a row back.

**Cons**:
- Editing rent, end date, or penalty means rewriting or reconciling stored rows.
- Overdue and Missed depend on today's date, so stored status goes stale without a job that does not exist (the data is only in the browser).

### Option 3: Create a separate lease record for each period

Like copying a calendar event into every month.

**Pros**:
- Reuses the current table and modals with no new concepts.

**Cons**:
- Fills the Tenants table with duplicates of one lease and breaks the count, search, and export.
- Editing the lease means editing N records.

## Decision

**Chosen option**: Option 1: Derive the schedule from the lease settings, tag each payment with a period

All schedule logic lives in a new pure module, `frontend/src/services/tenantScheduleService.ts`. `TenantPage.tsx` stores the new settings and period tagged payments and renders the results. The Lending code is left alone.

**Implementation skills**: none (no installed community skill covers this).

## Rationale

The data lives only in the browser, and the statuses depend on today's date, so any stored schedule would go stale (Option 2). Deriving it keeps one source of truth: the lease settings and the payments. Rent charges the same amount each period, and the engineer wants to pick the period per payment and also have advance credit. The two fit together if the picked period is where a payment starts and extra money flows forward only. That keeps the receipt matching the ledger and never pays off an older period behind the user's back. Lending instead allocates strictly in order and splits one total across cycles, so its helpers are not a good fit and a small separate module is simpler than bending them. The Lending page keeps its hardcoded 5% penalty untouched. For tenants the owner decides, so the penalty is a per lease setting that is empty by default.

## Feature design

**Data model sketch** (additive, all new fields optional):

| Entity | Field | Type | Notes |
|---|---|---|---|
| `TenantLease` | `repeat` | `'None' \| 'Daily' \| 'Monthly' \| 'Quarterly' \| 'Annually'` | Missing means `'None'`. |
| `TenantLease` | `leaseEndDate` | `YYYY-MM-DD` | Required when `repeat` is not `'None'`. |
| `TenantLease` | `penaltyRate` | number, percent | Blank or missing means no penalty. |
| `TenantLease` | `dueDate` | existing | For a repeating lease this is the First Due Date. |
| `TenantLease` | `totalAmountPayable` | existing | For a repeating lease, saved as `rentAmount × periodCount` (base rent, without penalties). |
| `DailyRentRecord` | `periodIndex` | number, 1 based | The starting period of a payment recorded against a repeating lease. Not used for `'None'`. The money may flow forward from it (advance credit). |

Relationships: one `TenantLease` has many `DailyRentRecord` (existing, unchanged). The schedule is not stored. It is a derived list of `SchedulePeriod { index, label, dueDate, baseAmount, penalty, amountDue, directPaid, advancePaid, paid, remaining, status, isOverdue }`, where `paid = directPaid + advancePaid`.

**Allocation rule** (the replay inside `buildSchedule`): take the payment records that are not Missed, in order of payment date then timestamp. For each, fill its starting period (rent first, then penalty), then push any extra into the following periods in order, each up to its own remaining. Money applied to the starting period is `directPaid`. Money pushed forward is `advancePaid` of the later period. Nothing goes to periods before the starting period. A payment never exceeds the lease's total remaining, so no money is left over.

**State transitions**: lease `status` stays a manual selector, plus the existing rule that it becomes Completed when nothing remains. Period status is derived (AC-11). There is no stored period state.

**Helpers** (`tenantScheduleService.ts`, pure, no storage, today passed in as a `YYYY-MM-DD` string):
- `addPeriodClamped(anchorDate, frequency, n)`: n-th due date with day of month clamping.
- `buildSchedule(lease, payments, today)`: returns `SchedulePeriod[]`, applying the allocation rule.
- `countPeriods(firstDue, endDate, frequency)`: used by the form preview and validation.
- `getLeaseFinancials(lease, today)`: `{ totalDue, amountPaid, remaining, nextPeriod | null }`. For `'None'` it returns the stored values.
- `validateRepeatSettings(input)` and `getEditLocks(lease)`: return error messages for AC-4 and AC-14.

**API surface**: none. No backend or network calls. Storage stays `localStorage` under the existing key.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Create / edit lease | Number of periods | Derived: `countPeriods(dueDate, leaseEndDate, repeat)` |
| Create / edit lease | Total Payable (repeating) | Derived: `rentAmount × periodCount` |
| Create / edit lease | Period amount | Input: `rentAmount` |
| Schedule | Each period due date | Derived from `dueDate` (First Due Date) and `repeat`, day clamped |
| Schedule | Period direct paid | Derived: allocation rule, from records whose `periodIndex` is this period, status not Missed |
| Schedule | Period advance paid | Derived: allocation rule, extra money pushed forward from earlier starting periods |
| Schedule | Period penalty | Derived: `penaltyRate`, period `baseAmount`, money applied by payments dated on or before the due date, and today |
| Schedule | Overdue / Missed | Derived: today (browser local date via `formatToYYYYMMDD(new Date())`) compared with the period due date |
| Daily Missed | Missed day | A `DailyRentRecord` with `status: 'Missed'` and its `periodIndex` |
| Update Rent Payment | Default period | Derived: earliest period with `remaining > 0` |
| Update Rent Payment | Max amount | Derived: lease total `remaining` from `getLeaseFinancials` |
| Update Rent Payment | Preview of where the money lands | Derived: the allocation rule applied to the typed amount and selected period |
| Update Rent Payment | Payment date | Input: the existing date field, default today |
| Tenants table / export | Next due | Derived: `getLeaseFinancials().nextPeriod` |
| Details progress % | Collection progress | Derived: `amountPaid / totalDue` |

**Key invariants**:
- Money is rounded to two decimals (centavos) at each step.
- A period's `paid` never exceeds its `amountDue`, and one payment never exceeds the lease's total remaining. The payment form enforces both.
- The schedule length is at least 1 and at most 1000.
- A lease with `repeat` missing or `'None'` goes through the old code paths unchanged.
- Payments recorded before the schedule exists on a lease are never edited. Locks in AC-14 protect period meaning.

**Security model**: no backend, no new roles. The page is already limited to JK Property and Ventures by `TenantRouteGuard`. Audit role stays read only. All form input is validated before it is saved. No personal data is added.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: create a Monthly lease, First Due Date 2026-11-15, Lease End Date 2027-10-15, rent 30,000. Form previews 12 payments and total 360,000. Details show 12 rows, due on the 15th. Verifies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-7**.
- Day clamping: First Due Date 2026-01-31, Monthly. Period 2 is 2026-02-28, period 3 is 2026-03-31. Verifies **AC-3**.
- Counting: End Date one day before a due date leaves that due date out. Verifies **AC-3**.
- Validation: End before First Due, First Due before Contracted, more than 1000 Daily periods, penalty 101. Each is rejected with a message. Verifies **AC-4**.
- Payment by period: rent 30,000, pay 10,000 on period 2. Period 2 is Partially Paid with 20,000 remaining, period 1 is untouched, a fully paid period is not selectable, and an amount above the lease's total remaining is rejected. Verifies **AC-9**, **AC-11**.
- Advance credit: pay 75,000 starting at period 1. Periods 1 and 2 are Paid, period 3 is Partially Paid with 15,000 remaining. Pay 60,000 starting at period 1 and period 2 is Paid, period 1 is Paid, nothing is left for period 3. Pay 45,000 starting at period 2: period 2 is Paid, period 3 is Partially Paid, period 1 stays Unpaid or Missed. A period covered only by overflow shows Advance Paid. Verifies **AC-9**, **AC-10**, **AC-11**.
- Missed rules: a past Monthly period with nothing paid shows Missed; a Daily past day without a mark shows Unpaid until marked Missed; a Missed day can be paid later. Verifies **AC-11**.
- Penalty off by default: with blank penalty, overdue periods owe only rent. With 5% set, one overdue 30,000 period owes 31,500 once, paying on the due date adds none, and advance money paid before a later due date prevents that period's penalty. Verifies **AC-12**.
- Old data: open the page with the old localStorage payload. Every old lease looks and works the same. Verifies **AC-6**.
- Lease completion: pay every period in full, lease becomes Completed and the table shows "Fully paid". Verifies **AC-8**, **AC-13**.
- Edit locks: after one payment, Repeat and First Due Date are disabled; moving the end date before a period that has money applied (including advance credit) is blocked. Verifies **AC-14**.
- Audit role: the schedule is visible, Record Daily Rent and Edit are absent. Verifies **AC-15**.

## Build plan

The project records no build approach, so this uses end to end slices (Tracer Bullet). It is one frontend change with no migration.

1. Create `tenantScheduleService.ts` with `addPeriodClamped`, `countPeriods`, `buildSchedule` (including the allocation rule), `getLeaseFinancials`, `validateRepeatSettings`, `getEditLocks`, and their types, satisfies **AC-3**, **AC-4**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**
2. Extend `TenantLease` and `DailyRentRecord` with the optional fields, and add Repeat, First Due Date label, Lease End Date, Late Penalty, summary line, read only Total Payable, and the live preview to the New Lease form with validation, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-6**
3. Add the same fields to the Edit form with the lock rules and messages, satisfies **AC-1**, **AC-14**
4. Add the Payment Schedule section (paginated table with Advance Paid rows, progress line, next due) to the Tenant Lease Details modal, satisfies **AC-7**, **AC-10**, **AC-11**, **AC-13**, **AC-15**
5. Update Update Rent Payment: Period selector as the starting period, total remaining limit, a preview of where the money lands (including advance credit), period tagged records, Missed control for Daily only, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-15**
6. Update the Tenants table Due Date cell, the search and totals that read Amount Paid and Remaining, and CSV and PDF export to use `getLeaseFinancials`, satisfies **AC-8**, **AC-13**
7. Confirm an old localStorage payload loads and behaves unchanged, satisfies **AC-6**

## Consequences

**Positive**:
- Every due date and status is visible in one table and always matches the payments.
- Old leases and the Lending page are untouched.
- The owner decides on penalties.

**Negative / tradeoffs**:
- Two schedule implementations now exist (Lending and Tenant). Both have advance credit but allocate differently (Lending in strict order, Tenant from the chosen period forward). They could drift.
- Choosing the starting period for each payment can be mistyped. The ledger could show money landing in the wrong months until corrected, and a payment that flows forward cannot be undone in part.
- Locking Repeat and First Due Date after a payment means a wrong schedule needs a new lease. There is no tool to reschedule.
- Daily leases over a long term create up to 1000 rows. They are paginated, but the daily list is long.

**Neutral**:
- Data still lives only in the browser. Clearing site data loses all leases.
- No migration. Optional fields are added when a lease is saved with a repeat.

## Follow-up

- [ ] Decide whether Lending should get the same owner set penalty setting (it hardcodes 5% today). Left out here on purpose.
- [ ] Move tenant leases and payments to a backend table when ready. Today they are browser only.
- [ ] Consider a way to correct or reassign a payment's period. Not in this spec.
- [ ] Optional later: a Google Calendar style month grid with due dates marked (offered, not chosen).

## Migration plan

**Strategy**: no migration needed.
**Rollback**: revert the commit. The added optional fields in saved data are ignored by the old code.
**Risks**: a lease saved with a repeat and then opened by older code would show its stored Total Payable and an unmatched Due Date. Ship the whole change together.
