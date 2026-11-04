# 0013. Late Payment Detection, Penalty Calculation, and Calendar Driven Tracking

**Date**: 2026-10-29
**Status**: Accepted

## Summary

This specification defines how the lending system identifies late payments, applies a flat five percent penalty per overdue cycle, and keeps transactions accurately linked to installment periods through the visual payment calendar. Loan officers use the existing interactive calendar in the payment modal to see at a glance which dates are paid, partially paid, or missed. When an officer clicks a missed calendar date, the system compares the actual date cash was collected against the scheduled due date of that installment. If the payment occurred after the due date, the system assesses a five percent penalty on the installment target for each overdue period, adds that penalty to the amount due and total payable balance, and updates the borrower ledger with full transparency.

## Context

Micro lending facilities require clear rules for repayment schedules and delayed remittances. Under our current system, borrowers choose a payment frequency such as daily, monthly, quarterly, or annually. Each frequency divides the total debt into fixed installment targets with scheduled due dates.

However, the existing software cannot distinguish whether a borrower paid on time or late. When a payment is recorded, the service simply logs the transaction date and decrements the remaining balance. The penalty portion is hardcoded to zero, and the system does not compare the date the cash was received against the due date of the specific installment.

Field operations present another challenge. Loan officers frequently collect cash in the field on schedule but only encode the receipts into the computer system later in the evening or days afterward. If the system evaluated lateness using the computer entry timestamp, prompt borrowers would be penalized unfairly. Furthermore, abstract dropdown lists of cycle numbers cause confusion because officers do not remember which numerical cycle corresponds to a specific date.

Instead of a confusing dropdown list, the system will utilize the interactive payment calendar already present in the modal. Unpaid past dates will be highlighted in red as missed dates. When an officer clicks any missed date on the calendar, the system knows exactly which installment is being paid, displays the overdue duration, computes the five percent late fee per overdue period, and protects on time borrowers by checking the date cash was actually collected.

## Requirements

**User stories**:
- As a loan officer, I want the payment calendar to visually highlight missed dates in red so that I immediately see which dates the borrower owes without guessing cycle numbers.
- As a loan officer, I want to click a missed date on the calendar to record its payment so that the remittance links directly to that calendar installment.
- As a loan officer, I want the system to check the actual cash collection date against the scheduled installment date rather than the computer entry timestamp so that delayed data entry never penalizes on time borrowers.
- As a finance manager, I want the system to charge a five percent penalty on the installment target for every overdue cycle so that late payments accumulate the agreed fee transparently.
- As an auditor, I want each payment transaction to clearly show the installment date settled, the date cash was collected, whether it was on time or late, and any penalty assessed.
- As a borrower, I want to see how penalties are added to my total payable balance so that I know exactly what I owe and why.

**Acceptance criteria**:
- **AC-1**: The payment modal calendar visually highlights every past date with an unpaid installment using a distinct red or rose indicator (for example a red badge or dot labeled Missed).
- **AC-2**: Clicking a missed date on the calendar selects it as the target installment date and displays its scheduled due date, base target amount, days overdue, and computed penalty fee.
- **AC-3**: The modal provides a Cash Received Date field (defaulting to today, editable by staff). Lateness is calculated strictly by comparing `payment_date` (cash received date) with the selected installment `due_date`. System creation time (`created_at`) is preserved for audit logs but never used for lateness checks.
- **AC-4**: If `payment_date <= installment_due_date`, the transaction status is marked on time with zero penalty portion.
- **AC-5**: If `payment_date > installment_due_date`, the system calculates overdue periods (days for daily, months for monthly, quarters for quarterly, years for annually). The penalty is calculated as five percent of the installment target multiplied by the count of overdue periods.
- **AC-6**: The calculated penalty fee is added to the cycle required amount and borrower total payable balance. The remaining balance reflects total payable plus total penalties minus total payments.
- **AC-7**: In the lending transaction record, the database persists `cycle_index`, `cycle_due_date`, `is_late`, `days_late`, and `penalty_portion`.
- **AC-8**: For non daily loans (monthly, quarterly, annually), the modal presents an installment period calendar card grid showing green for paid periods and red for missed periods.

## Options considered

### Option 1: Visual calendar selection with actual payment date comparison (Chosen)

Utilize the existing interactive calendar in the payment modal. Highlight missed dates in red. Clicking a date selects that installment, derives the overdue duration against the cash received date, computes the five percent fee, and adds it to the debt balance.

**Pros**:
- High usability: officers see the calendar they already know, with immediate visual cues for missed days.
- Eliminates cycle number confusion completely because dates are concrete calendar days.
- Protects prompt borrowers against delayed employee computer input.
- Fully supports non daily loans through period cards.

**Cons**:
- Requires updating the calendar day renderer to detect missed dates in the past and style them in red.

### Option 2: Numerical cycle dropdown selector

Provide a text dropdown list with entries such as Cycle 1, Cycle 2, etc.

**Pros**:
- Simple HTML select element.

**Cons**:
- Poor user experience: users get confused about which cycle number matches which calendar date.
- Fails to leverage the calendar component already built into the application.

## Decision

**Chosen option**: Option 1: Visual calendar selection with actual payment date comparison

We enhance the interactive calendar in the payment modal to display red missed indicators for unpaid past dates. Staff click a date to settle that installment, and the system evaluates lateness using the cash collection date to assess the five percent fee.

## Rationale

Option 1 builds directly on the existing UI and workflow of the application. Staff members already interact with the calendar when viewing or recording payments. Coloring missed dates in red makes overdue accounts immediately obvious. Evaluating lateness using the actual cash collection date ensures fairness, while calculating five percent per late interval maintains strict contract compliance.

## Feature design

**Calendar Visual States**:
- **Green (Emerald)**: Fully paid date, locked with checkmark icon.
- **Amber**: Partially paid date with amber indicator dot.
- **Red (Rose)**: Missed date (a date between loan start date and today that has unpaid installment balance).
- **Blue or Ring**: Today date highlight.
- **Selected**: Solid brand color indicating the installment currently being paid.

**Data model sketch**:
The `lending_transactions` table receives the following tracking columns:
- `cycle_index`: Integer, nullable, indicates the installment cycle number
- `cycle_due_date`: Date, nullable, the scheduled due date for that specific cycle
- `is_late`: Boolean, default False, True if `payment_date > cycle_due_date`
- `days_late`: Integer, default 0, the number of overdue units (days or months or periods)
- `penalty_portion`: Numeric(15, 2), default 0.00, the computed 5% penalty amount

The `borrowers` model balances are dynamically computed:
- `total_penalties`: sum of all `penalty_portion` across transactions plus any uncollected penalties on overdue cycles
- `total_payable`: base loan total payable plus `total_penalties`
- `remaining_balance`: `total_payable - amount_paid`

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/lending/cycles/{borrower_id} | GET | borrower_id: int | list of cycles with index, due date, target, status, penalty | bearer | 404 |
| /api/v1/lending/payments | POST | borrower_id, cycle_index, cycle_due_date, payment_date, amount, method, reference_no, notes | created transaction with is_late, penalty_portion, updated balance | bearer | 400, 404, 409, 422 |
| /api/v1/lending/ledger/{borrower_id} | GET | borrower_id: int | borrower details, updated ledger items, total penalties, compliance status | bearer | 404 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Render calendar | Red missed badge | Derived by checking if calendar date is before today and unpaid |
| Click calendar date | Target installment and due date | Sourced from the clicked calendar date cell |
| Record payment | Lateness flag (`is_late`) | Computed by comparing cash received `payment_date` with selected calendar `due_date` |
| Record payment | Penalty amount | Computed as `5% * installment_target * days_late` |
| Record payment | System entry time | Saved in `created_at` timestamp |
| Render ledger | Penalty badge and fee | Read from `LendingTransaction.penalty_portion` and `is_late` |

**Key invariants**:
- Actual `payment_date` is the sole determinant of on time or late status, never `created_at`.
- If `payment_date <= cycle_due_date`, `penalty_portion` must be zero.
- Penalty is non compounding, calculated strictly as five percent of the installment target times overdue periods.
- Total payable dynamically reflects base principal, interest, and all accrued penalties.

**Critical test scenarios**:
- Visual missed date identification: past calendar days with zero payment render with red styling and missed label, verifies **AC-1**.
- Click missed date: clicking a red missed date populates the payment form with that date and computes days overdue and 5% penalty, verifies **AC-2**, **AC-5**.
- Delayed computer encoding: borrower paid cash on the due date, officer encodes it into the computer three days later; setting cash received date to due date marks payment on time with zero penalty, verifies **AC-3**, **AC-4**.

## Build plan

1. Add cycle tracking columns (`cycle_index`, `cycle_due_date`, `is_late`, `days_late`) to `LendingTransaction` model and database migration, satisfies **AC-7**.
2. Update `LendingService` with cycle schedule generator and late penalty calculation logic based on transaction `payment_date`, satisfies **AC-3**, **AC-4**, **AC-5**, **AC-6**.
3. Create API endpoint `/api/v1/lending/cycles/{borrower_id}` returning open and completed installment cycles with status (paid, missed, partial), satisfies **AC-1**, **AC-2**.
4. Update `record_payment` endpoint and schema in backend to accept and process `cycle_due_date` and `cycle_index`, satisfies **AC-7**.
5. Update frontend Record Payment modal calendar:
   - Mark unpaid past calendar days with red missed styling and legend item, satisfies **AC-1**.
   - When a missed date is clicked, compute days overdue and five percent penalty preview, satisfies **AC-2**, **AC-5**.
   - Provide Cash Received Date field so delayed entry does not penalize prompt borrowers, satisfies **AC-3**, **AC-4**.
   - For monthly, quarterly, and annual loans, display an installment period card grid with green paid and red missed statuses, satisfies **AC-8**.
6. Update frontend ledger and payment history tables to show late status badges and penalty amounts, satisfies **AC-6**.

## Consequences

**Positive**:
- Natural visual experience where users instantly see red missed dates on the calendar without memorizing cycle numbers.
- Complete fairness for borrowers when field staff encounter data entry delays.
- Accurate ledger accounting where penalties increase total payable and remaining debt properly.

**Negative / tradeoffs**:
- Calendar day cell rendering logic has a few extra checks to determine if a past date is unpaid.
