# 0004. Bills Page and Recurring Payment Workflow Enhancements

**Date**: 2026-10-27
**Status**: In Progress

## Summary

This specification outlines enhancements to the bills management and recurring payment workflow. The categories query filter is removed from the bills page to streamline list exploration. Adding recurring bills is simplified by removing category and account reference number fields while adding duplicate biller name validation. The bill details modal is simplified by removing inline payment settlement inputs and providing a direct Pay Bill button that opens the payment modal. The payment modal enforces chronological settlement starting from the oldest unpaid month from 2025 onwards, supports full and partial payments with clear Partially Paid status tracking, trims obsolete payment methods, and removes the calendar legend.

## Context

The bills tracking interface previously included category filtering queries and form inputs that added unnecessary friction to creating bills. Recurring bill setup required category classification and account numbers even when entities manage providers directly by name. Furthermore, bill provider names could be entered redundantly, creating duplicate vendor schedules under a company.

In the payment settlement flow, the bill details dialog presented redundant inline payment forms that duplicated the specialized payment modal. Users were also able to select arbitrary future billing periods to settle, allowing previous overdue periods to be skipped or left unsettled. When paying partial amounts, the system lacked a distinct partially paid tag for billing cycles. Lastly, payment method options included obsolete channels such as in house and auto debit, and button labels contained verbose period labels instead of a standard action title.

Addressing these issues produces a cleaner interface, preserves strict chronological accounting, and provides clear tracking for partial payment balances.

## Requirements

**User stories**:
- As a finance or operations user, I want to view all bills without category filter constraints so that list browsing is fast and clean.
- As a bill administrator, I want to add recurring bills with only essential details and get prevented from saving duplicate biller names.
- As a finance user viewing bill details, I want a clean modal overview with a single Pay Bill button that immediately transitions into the payment modal.
- As a finance user recording a payment, I want the system to automatically select the oldest unpaid month from 2025 onwards, allowing full or partial payments while tagging incomplete periods as Partially Paid.

**Acceptance criteria**:
- **AC-1**: The categories query filter dropdown is removed from the bills page and table query filtering.
- **AC-2**: The Add Recurring Bill modal has no category select input and no account or reference number input.
- **AC-3**: The Add Recurring Bill form verifies that the biller name is not duplicated for the entity, showing a clear error message when duplicate names are entered.
- **AC-4**: The View Bill Details modal removes the Payment Settlement Details section and all old footer action buttons.
- **AC-5**: The View Bill Details modal provides a single general Pay Bill button that opens the Record Bill Payment modal and closes the details modal.
- **AC-6**: In the Record Bill Payment modal, users cannot freely click and select arbitrary months to pay; the system automatically targets the oldest unpaid month (considering periods from 2025 onwards). Past and current unpaid months must be settled in chronological order before future advance periods.
- **AC-7**: Users can pay any custom amount for the active period. If the amount is less than the scheduled obligation or period balance, the period is marked as Partially Paid rather than Paid.
- **AC-8**: In the Record Bill Payment modal, the payment schedule calendar legend is removed. The payment methods omit In house and Auto Debit. The submission button is titled Pay Bill.

## Options considered

### Option 1: Chronological backlog settlement with partial balance tracking (Chosen)

Enforce strict chronological settlement starting with the oldest unpaid or partially paid month from 2025 onwards. The calendar view becomes an informative progress matrix rather than an arbitrary picker. Payments accumulate toward period balances. If a partial payment is submitted, the period is tagged as Partially Paid and remains the mandatory target for the next payment until fully satisfied.

**Pros**:
- Guarantees financial accounting accuracy by preventing skipped periods.
- Accurately tracks partial disbursements with explicit status badges.
- Keeps calendar visual indicators synchronized with payments.

**Cons**:
- Requires calculating accumulated payments per period.

### Option 2: Unconstrained manual period picker with warning prompts

Allow the user to click any month in the calendar matrix, displaying confirmation warnings if earlier months remain unpaid.

**Pros**:
- Gives users complete manual freedom to assign payments.

**Cons**:
- Fails the requirement that the oldest unpaid month must be paid first.
- Risk of unpaid debt holes in previous fiscal periods.

## Decision

**Chosen option**: Option 1: Chronological backlog settlement with partial balance tracking.

We will automate the selection of the oldest unpaid period from 2025 onwards, remove category and account number inputs from bill creation, prevent duplicate provider names, clean up the view modal, and update the payment modal to support partial payment tagging and refined payment methods.

## Feature design

### Data model adjustments

- In `bills` entity, `category` defaults to `"General"` when not supplied by the UI, keeping backward compatibility with the database column requirement.
- In `bill_payments`, individual payments store the `period_key`, `amount`, `payment_date`, and `payment_method`. Multiple payments for the same period accumulate toward the monthly obligation.
- A period status is calculated as:
  - If total paid for period is zero and period is past due: `Overdue`.
  - If total paid for period is zero and period is current: `Due Soon` or `Unpaid`.
  - If total paid is greater than zero but less than scheduled bill amount: `Partially Paid`.
  - If total paid is greater than or equal to scheduled bill amount: `Paid`.

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/bills | GET | company_name (optional) | list of bills | bearer | 400 |
| /api/v1/bills | POST | bill_name, company, amount, due_date, recurring, reminder_days | created bill | bearer | 400 (duplicate name), 422 |
| /api/v1/bills/{id}/payments | POST | period_key, payment_date, amount, payment_method, ref_no, notes | updated bill | bearer | 400, 409 (out of order period) |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Load Bills Page | Bill items list | Backend `/api/v1/bills` filtered only by company scope and search text |
| Add Recurring Bill | New bill record | Form inputs with category defaulted to `"General"` and account number omitted |
| Duplicate Check | Error message | Comparison against existing bill names in the company |
| View Bill Details | Pay Bill action | Direct trigger setting active payment bill and closing view dialog |
| Open Payment Modal | Active period | Computed oldest unpaid or partially paid period from year 2025 to future |
| Open Payment Modal | Default amount | Remaining balance of active period (bill amount minus previous payments) |
| Render Calendar | Period badge | Derived status (Paid, Partially Paid, Overdue, Due Soon, Upcoming) |
| Submit Payment | Payment record | Payment modal form values submitted to `/api/v1/bills/{id}/payments` |

### Key invariants

- In `Add Recurring Bill`, biller name must be unique within the company scope (case insensitive comparison).
- In `Record Bill Payment`, payment periods prior to 2025 are excluded from calculation.
- The targeted period is strictly the earliest chronological period that has not been fully settled.
- Partial payment leaves the period in `Partially Paid` status and retains it as the target for subsequent payments.

## Build plan

- **Task 1 (Bills Page cleanup)**: Remove category filter state, dropdown UI, and category filtering logic from `frontend/src/pages/BillsPage.tsx` (satisfies **AC-1**).
- **Task 2 (Add Recurring Bill simplification and duplicate guard)**: Update `AddBillModal.tsx` and backend `bills_service.py` to remove category and account number inputs, set default category to `"General"`, and enforce uniqueness checks on biller name with descriptive error messages (satisfies **AC-2**, **AC-3**).
- **Task 3 (View Bill Details streamlining)**: In `BillsPage.tsx`, remove the Payment Settlement Details section and old footer buttons. Add the single Pay Bill button that closes View Bill modal and opens Record Bill Payment modal (satisfies **AC-4**, **AC-5**).
- **Task 4 (Period calculation and partial payment logic)**: Update `billsService.ts` and `backend/app/services/bills_service.py` to calculate accumulated payments per period, support periods from 2025 onwards, identify the oldest unpaid or partially paid period, and compute `Partially Paid` status (satisfies **AC-6**, **AC-7**).
- **Task 5 (Record Bill Payment modal overhaul)**: In `RecordBillPaymentModal.tsx`, disable manual month selection so the modal automatically locks to the oldest payable period, remove the calendar legend, remove In house and Auto Debit payment methods, support partial amount input with remaining balance indicators, and update the submit button label to Pay Bill (satisfies **AC-6**, **AC-7**, **AC-8**).
- **Task 6 (Verification and polish)**: Verify TypeScript types, UI rendering, error messaging, and end to end payment workflow.
