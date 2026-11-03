# 0025. Tenant Form Validation Duplicate Prevention and Schedules

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification fixes the tenant creation workflow and schedule mechanics across the entire tenant management surface. It prevents duplicate lease records caused by rapid clicking on the save button by using both client side submission locks and server side idempotency checks. It ensures that typing rent amounts automatically updates total payable values, that repeating lease selections set proper initial due dates based on the chosen period, that tenant identification codes remain unique and database driven, and that tenant filtering and due date displays work consistently for all frequencies.

## Context

In the current implementation, users who click the Create Lease button multiple times in rapid succession trigger duplicate requests. Each request generates a distinct database record because the button remains active while network requests are in flight, and the backend lacks a short window duplicate check.

In addition, the tenant lease form contains several calculations and date defaults that do not update smoothly. When typing a rent amount, one time leases do not reliably mirror the value into total payable, and repeating leases fail to recalculate when end dates are missing. Selecting repeat options like Monthly or Quarterly does not prefill appropriate first due dates relative to today, while the main tenant table uses a hardcoded fourth quarter filter that fails for general quarterly queries. Tenant identification strings rely on client prefixes that do not reflect dynamic company codes and need guaranteed database sequencing.

## Requirements

**User stories**:
- As a property manager, I want the lease save button to disable immediately upon submission so that clicking it repeatedly never creates duplicate tenant records.
- As a leasing officer, I want typing the rent amount to update the total payable automatically so that I do not have to calculate or retype values manually.
- As a leasing officer, I want choosing a repeat frequency to automatically calculate the first due date and default lease end date relative to today so that schedules are accurate right away.
- As an auditor and administrator, I want tenant identification codes to be unique per company and persisted directly from the database so that records remain traceable.
- As an operator, I want the tenant page to filter correctly across daily, monthly, quarterly, and annual leases with accurate due date indicators so that payment follow ups are timely.

**Acceptance criteria**:
- **AC-1**: When submitting the Add Tenant or Edit Tenant forms, the submit button is immediately disabled, displays a loading state, and ignores repeated clicks until the request completes.
- **AC-2**: The backend rejects or deduplicates concurrent lease creation requests having identical company, tenant name, and unit within a five second window, returning a 409 Conflict or the existing lease record.
- **AC-3**: In the lease modal, typing into the Rent Amount field automatically mirrors into Total Payable for non repeating leases by default, while still permitting manual numeric overrides.
- **AC-4**: In the lease modal, selecting Daily sets the first due date to tomorrow (one day after today) with a default thirty day lease end date; selecting Monthly sets the first due date to one month after today with a default twelve month lease end date; selecting Quarterly sets the first due date to one quarter (three months) after today with a default four quarter lease end date; selecting Annually sets the first due date to one year after today with a default three year lease end date.
- **AC-5**: In the lease modal for repeating leases, the total amount payable automatically computes as rent amount multiplied by the period count whenever rent, first due date, or lease end date change.
- **AC-6**: Tenant identification codes follow the pattern `TNT-{COMPANY_CODE}-{YYYY}-{NNN}` where `COMPANY_CODE` comes from the selected company, generated atomically on the database so that no collisions occur.
- **AC-7**: The Period filter dropdown on the main Tenant page includes All Periods, Daily, Monthly, Quarterly, and Annually, filtering both by repeat frequency and dynamic active date bounds without hardcoded date strings.
- **AC-8**: Table rows and export reports display the exact next unpaid period due date accompanied by clear period indicators such as Day 1, Month 1, Quarter 1, Year 1, or One Time.

## Options considered

### Option 1: Client side button disabling only

Disable the submit button in React state while `isSubmitting` is true.

**Pros**:
- Very simple to implement with minimal code changes.

**Cons**:
- Does not protect against slow network connections, double submissions through browser back buttons, automated scripts, or parallel tab actions.

### Option 2: Dual layer client button locking and backend idempotency guard (Chosen)

Disable the client submit button with visible loading indicator while saving, and enforce a server side time window check on identical lease submissions.

**Pros**:
- Completely eliminates duplicate lease creation from rapid clicking.
- Protects the database even if the client UI state gets bypassed or delayed.

**Cons**:
- Requires a light server side check during lease insertion.

## Decision

**Chosen option**: Option 2: Dual layer client button locking and backend idempotency guard.

We will disable the save buttons in `TenantPage.tsx` during submission, default first due dates and end dates in the modal according to repeat frequency, automatically compute total payable on rent input, enforce dynamic company scoped tenant identification with database uniqueness, and update period filtering across the tenant table.

## Feature design

**Data model sketch**:
- `tenant_leases` table keeps existing schema.
- `tenant_ref` column retains `String(30)` unique index.
- New sequence generation query uses `TNT-{COMPANY_CODE}-{YYYY}-{NNN}` with row locking or fallback retry logic.

**State transitions**:
- Form submission state: `Idle` -> `Submitting` (button disabled with spinner) -> `Success` (modal closed, list updated) or `Error` (alert banner, button re-enabled).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/tenants | POST | `LeaseCreate` (company, name, unit, rent, contract_date, due_date, repeat_mode, total_amount_payable) | `LeaseOut` (tenant_ref, id, status) | Bearer (admin, manager, staff) | 400, 409, 422 |
| /api/v1/tenants/{id} | PUT | `LeaseUpdate` | `LeaseOut` | Bearer | 400, 404, 409 |
| /api/v1/tenants | GET | `company_id` | `List[LeaseOut]` | Bearer | 401, 403 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Auto fill first due date | First due date string (YYYY-MM-DD) | Derived from today plus frequency offset (Daily: +1 day, Monthly: +1 month, Quarterly: +3 months, Annually: +12 months) |
| Auto fill lease end date | Lease end date string (YYYY-MM-DD) | Derived from first due date plus standard lease duration |
| Auto calculate total payable | Total payable float | Derived from `rent_amount * count_periods(due_date, lease_end_date, repeat)` or mirrored from `rent_amount` when repeat is None |
| Generate tenant reference | Tenant ref string | Server generated: `TNT-{COMPANY_CODE}-{YYYY}-{NNN}` atomically queried from DB |
| Display table due date | Next unpaid due date text | Derived via `getLeaseFinancials(tenant, today).nextPeriod.dueDate` with period unit label |

**Key invariants**:
- Every tenant lease must belong to a valid company.
- Tenant references must be strictly unique across all records.
- First due date cannot be earlier than contract date.
- For repeating leases, lease end date must be on or after first due date.
- Double clicking or triple clicking submit must never generate multiple records.

**Security model**:
- Creating and modifying tenant leases requires authenticated user with appropriate role (admin, finance, property manager).
- Audit role remains read only with review capabilities.

## Build plan

1. Implement `isSubmitting` state and loading spinners on the Add Tenant, Edit Tenant, and Record Payment buttons in `TenantPage.tsx`, satisfying **AC-1**.
2. Add backend short window duplicate submission check in `backend/app/services/tenant_service.py` based on company, tenant name, and unit name within 5 seconds, satisfying **AC-2**.
3. Update `rentAmount` change handler in `TenantPage.tsx` to automatically mirror rent amount to `totalAmountPayable` for non repeating leases, satisfying **AC-3**.
4. Update `RepeatSelect` change handler in `TenantPage.tsx` to compute first due date and default lease end date based on repeat mode (Daily +1 day, Monthly +1 month, Quarterly +3 months, Annually +12 months), satisfying **AC-4**.
5. Ensure `totalAmountPayable` dynamically updates in real time for repeating leases as rent amount is entered, satisfying **AC-5**.
6. Enhance `_next_ref` in `backend/app/services/tenant_service.py` to extract company code and query database with lock/retry to ensure absolute uniqueness, satisfying **AC-6**.
7. Refactor period filter dropdown in `TenantPage.tsx` to include All Periods and dynamically compute date ranges for Daily, Monthly, Quarterly, and Annually, eliminating hardcoded quarter dates, satisfying **AC-7**.
8. Verify and format due date display in tenant table and CSV/PDF export to show next active period due date and period label, satisfying **AC-8**.

## Consequences

**Positive**:
- Rapid clicking on the save button is completely safe and idempotent.
- Form inputs feel immediate, responsive, and intuitive with automated date and total calculations.
- Tenant IDs are cleanly categorized by company and guaranteed unique in the database.
- Tenant page filtering behaves predictably without hardcoded year or quarter limits.

**Negative / tradeoffs**:
- Slightly more logic in the frontend form state management when switching repeat options.

**Neutral**:
- Existing tenant leases remain compatible without database migrations.

## Critical test scenarios

- Happy path: User creates a monthly lease; first due date defaults to one month after today; user enters rent amount 25000; total payable automatically calculates for 12 months; user clicks Create Lease; button shows spinner; lease is created with unique company prefixed reference, verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**.
- Concurrency test: User triple clicks Create Lease rapidly; only one lease is created, and second/third clicks are blocked both on the client and backend, verifies **AC-1**, **AC-2**.
- Frequency filtering test: User selects Daily filter; only daily leases and today's active periods appear; user selects Quarterly; current quarter bounds calculate dynamically and display quarterly leases, verifies **AC-7**, **AC-8**.
