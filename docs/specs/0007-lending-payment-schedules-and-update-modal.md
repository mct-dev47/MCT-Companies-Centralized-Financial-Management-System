# 0007. Lending Payment Schedules and Update Modal Revisions

**Date**: 2026-10-28
**Status**: Accepted

## Summary

This specification defines the revisions for loan payment frequency schedules, settled period immutability, dual due date calculation, and the payment remittance modal on the Lending page. It updates the facility creation modal to capture payment schedules, refines the payment update modal to adapt to daily, monthly, quarterly, and annual schedules, locks fully paid dates and months against duplicate additions or deletions, automates periodic installment due date tracking, removes collection status and quick amount buttons, enforces strict payment boundaries between one peso and the remaining balance, prevents mouse wheel scrolling on numeric inputs, empties default values for references and notes, and expands the remarks field into a multi line area.

## Context

The lending module previously assumed every loan operated on a daily remittance schedule. It included preset quick collection buttons and a collection status switcher in the update modal that allowed manual toggling between paid and missed collections.

Borrowers operate under diverse agreements including daily, monthly, quarterly, and annual schedules. For daily agreements, uncollected days should be recognized as missed automatically, displaying clean placeholder marks rather than fabricated text. For monthly agreements, borrowers may remit in full or in installments for a given month, and must satisfy any partial balance before advancing to subsequent months.

Furthermore, once a date or month is fully settled, financial ledger integrity requires that the period is locked. Users must not be allowed to append duplicate payments or remove payments from a settled date or month. In addition, loans require a dual due date model: the overall maturity due date for the facility as a whole, and automated recurring installment due dates for each collection period so delinquencies are spotted immediately.

## Requirements

**User stories**:
- As a lending officer, I want to record credit facilities with daily, monthly, quarterly, or annual payment schedules so that the repayment schedule matches the borrower contract.
- As a collection officer, I want the system to calculate recurring installment due dates automatically from the date borrowed and final due date so that I always know which cycle is currently due.
- As a collection officer, I want the update payment modal to adapt to the facility payment schedule without irrelevant daily quick picks or collection toggles so that recording a remittance is straightforward and error free.
- As a financial administrator, I want fully paid dates and fully paid months to lock automatically so that users cannot add duplicate collections or delete historical settled payments.
- As a loan administrator, I want payment inputs to enforce strict bounds between one peso and the remaining balance, disable scroll wheel adjustments, and provide a spacious notes field with no prefilled defaults.
- As an auditor, I want daily facilities without payment for a day to display as missed with dash placeholders, and monthly facilities with partial payments to track the remaining month balance before the next month is unlocked.

**Acceptance criteria**:
- **AC-1**: The Add Lending Facility modal includes a prominent Payment Schedule dropdown offering Daily, Monthly, Quarterly, and Annually options, with dynamic installment calculations matching the selected frequency.
- **AC-2**: The payment update modal removes the Collection Status segmented control and removes all preset suggested amount buttons.
- **AC-3**: The payment amount field enforces a minimum of one peso and a maximum equal to the facility remaining balance, disabling mouse wheel increment or decrement scrolling and hiding browser spinner arrows.
- **AC-4**: The Receipt or Reference Number and Remarks fields have no default text when opening the modal, and the Remarks input is rendered as a multi line text area.
- **AC-5**: For daily facilities, days without recorded payments are marked as Missed. All missed records display a dash in the amount, method, reference, and remarks columns with a Missed status badge.
- **AC-6**: For monthly facilities, payments track the target month. Partial remittances keep the month in Partial status without marking it as Paid, requiring completion of the month balance before subsequent months can be paid.
- **AC-7**: When a date is fully paid for daily loans, users cannot add another payment for that date or delete the settled record. When a month is fully paid for monthly loans, users cannot add more funds to that month or delete settled records, and new payments automatically route to the next unpaid installment.
- **AC-8**: The system automatically computes periodic installment due dates based on the payment frequency (daily calendar targets, monthly cycle day, quarterly spacing, or annual anniversary) while keeping the overall maturity due date intact. Overdue flags apply to overdue installments when periodic due dates pass unpaid.

## Options considered

### Option 1: Dynamic schedule handler with unified payment ledger and period locking

Implement schedule aware computation, period locking, and automated cycle due date derivation directly within `LendingPage.tsx`. For daily loans, compute missing dates from disbursement date to current date and display them with dash placeholders, while locking settled dates against duplicate entries. For monthly loans, compute month target installments, recurring cycle due dates, and active month progress, locking settled months and requiring completion before moving forward.

**Pros**:
- Self contained inside the lending component without requiring database migrations or breaking local storage persistence.
- Provides immediate real time feedback in both the update modal and the payment history table.
- Directly satisfies all acceptance criteria including immutability and dual due date tracking.

**Cons**:
- Requires careful date iteration and month balance accumulation logic.

### Option 2: Separate modal forms and manual installment entry

Create separate distinct modal dialogs for daily payments and monthly payments, and require loan officers to type every individual monthly due date manually.

**Pros**:
- Allows manual overrides for non standard irregular installment schedules.

**Cons**:
- Increases data entry friction and human error.
- Duplicates form submission, toast alerts, and modal dialog scaffolding.

## Decision

**Chosen option**: Option 1: Dynamic schedule handler with unified payment ledger and period locking

We implement the schedule aware payment logic, period immutability locking, automated cycle due dates, and modal updates directly within `frontend/src/pages/LendingPage.tsx`.

## Rationale

Option 1 provides a unified experience for loan officers while preserving existing local storage records and action menu portals. Schedule calculations happen dynamically based on disbursement date, final maturity due date, and payment history. Locking settled periods guarantees ledger integrity without restricting operators from collecting on upcoming active installments.

## Feature design

**Data model sketch**:
`DailyPaymentRecord` is extended with optional schedule tracking and lock fields:
```ts
export interface DailyPaymentRecord {
  id: string
  date: string
  amount: number
  method: string
  referenceNo?: string
  notes?: string
  status?: 'Paid' | 'Missed' | 'Partial'
  missedReason?: string
  timestamp: string
  monthIndex?: number
  periodLabel?: string
  isLocked?: boolean
}
```

**Dual Due Date Derivation**:
1. **Maturity Date (Whole Loan)**: Stored as `facility.dueDate`. Marks the complete contract maturity.
2. **Periodic Cycle Due Date**: Derived dynamically from `facility.dateBorrowed`, `facility.dueDate`, and `facility.paymentFrequency`:
   - Daily: Every single calendar day.
   - Monthly: The recurring day of the month matching the disbursement date (e.g. 21st of each month). If today is past the installment due date and the installment is unpaid, the installment is flagged as Overdue.
   - Quarterly: Spaced every three calendar months.
   - Annually: Spaced every twelve calendar months.

**Period Immutability and Locking Rules**:
- **Daily Lock**: If a calendar date has an existing payment record where amount is greater than or equal to the daily target, that date is locked. The payment modal blocks recording duplicate payments on that date. Settled daily records cannot be deleted.
- **Monthly Lock**: If the active month target is reached, that month is closed and locked. Settled monthly payments cannot be removed. Any new payment automatically targets the next active month.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Open Update Modal | Clean empty form with active cycle info | Blank initial state for ref and remarks |
| Payment Amount Validation | Error message or valid submission | Checked against one peso and remaining active balance |
| Daily History Render | Paid row or Missed row with dashes | Evaluated per calendar date |
| Monthly History Render | Paid or Partial month status with cycle due date | Sum of payments allocated to month index |
| Periodic Due Date Render | Active installment due date | Computed from disbursement day and cycle index |
| Record Deletion Check | Allowed or disabled action | Verified against period settlement status |

**Key invariants**:
- Payment amount must satisfy: `1 <= paymentAmount <= remainingBalance`.
- For monthly agreements, payment amount cannot exceed the active installment remaining balance.
- Receipt reference and remarks fields must never contain random or mocked default strings when opened.
- Missed payments must strictly render dashes for amount, method, reference, and remarks.
- A monthly partial payment can never mark the month as Paid.
- Fully settled dates and months cannot receive duplicate additions or have records deleted.
- Periodic installment due dates are derived deterministically from Date Borrowed, Due Date, and Payment Frequency.

**Security model**:
Audit role users cannot access the update modal or submit payments.

**Critical test scenarios**:
- Amount validation: entering 0 or values greater than remaining balance triggers validation, verifying **AC-3**.
- Wheel prevention: mouse wheel on amount input does not change the numeric value, verifying **AC-3**.
- Default values: opening update modal displays empty reference and empty multi line remarks, verifying **AC-4**.
- Missed rendering: missed days display dashes across columns with a Missed badge, verifying **AC-5**.
- Monthly installments: partial payment records with Partial status and displays remaining month requirement, verifying **AC-6**.
- Period locking: selecting a fully paid date or month blocks duplicate entry, verifying **AC-7**.
- Record protection: delete actions are disabled on fully paid settled records, verifying **AC-7**.
- Cycle due dates: monthly facilities display the active installment due date alongside the final maturity date, verifying **AC-8**.

## Build plan

1. Update `DailyPaymentRecord` interface to support Partial status, month index, and locked tracking, satisfies **AC-6**, **AC-7**.
2. Enhance Add Lending Facility modal with clear Payment Schedule selection, satisfies **AC-1**.
3. Implement automated periodic due date derivation for monthly, quarterly, and annual frequencies, satisfies **AC-8**.
4. Refactor Update Payment modal: rename title, display active cycle due date, remove collection status, remove suggested amount buttons, enforce boundaries, prevent wheel scroll, empty default fields, and convert remarks into textarea, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-8**.
5. Enforce period immutability: block duplicate payments on fully settled dates and prevent deletion of settled records, satisfies **AC-7**.
6. Implement daily missed day tracking and dash placeholder rendering for missed records, satisfies **AC-5**.
7. Implement monthly installment allocation, partial tracking, and month completion enforcement, satisfies **AC-6**.

## Consequences

**Positive**:
- Users experience a clean, modern payment modal tailored to the specific loan schedule.
- Erroneous wheel adjustments and accidental submissions are completely eliminated.
- Audit trails for daily and monthly agreements reflect real life accounting practices.
- Fully paid periods remain protected against tampering, accidental double charging, or destructive deletion.
- Collection officers know exactly when each periodic cycle is due without manual calendar calculations.

**Negative / tradeoffs**:
- Generating full daily schedules for very long active loans requires date iteration, handled efficiently via memoization.

**Neutral**:
- Existing recorded payments remain fully compatible and continue to load properly.

