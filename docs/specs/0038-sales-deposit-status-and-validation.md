# 0038. Sales Deposit Status and Payment Validation Rules

**Date**: 2026-11-08
**Status**: Accepted

## Summary

This specification introduces a deposit status column for sales records and strictly enforces valid state combinations between payment status and deposit status. Paid sales can be marked as Deposited or Not Deposited, Unpaid sales are locked to Not Deposited, and Pending sales permit Deposited only when the payment method is Cheque and physically deposited awaiting clearance. Both the FastAPI backend and React frontend enforce these business rules with human friendly error messages, preventing out of sync or invalid banking states.

## Context

Sales transactions track revenue across cash, cheques, bank transfers, and digital payment methods. While the system captures whether a transaction is Paid, Pending, or Unpaid, it previously lacked a dedicated deposit status attribute to track whether received funds were physically banked. 

Without this attribute and its accompanying business rules, transactions could be marked as banked when payment had not actually been collected. Marking an unpaid or general pending invoice as deposited distorts bank reconciliation and cash position reports. Furthermore, trusting frontend form logic alone leaves APIs open to accidental or unauthorized bypass. Enforcing business invariants in both backend schemas and user interface controls provides data integrity and audit readiness.

## Requirements

**User stories**:
* As a finance officer, I want to track whether sales collections have been deposited into company bank accounts, so that our cash reconciliations stay accurate.
* As an auditor, I want invalid combinations of payment status and deposit status rejected by the server, so that transactions cannot falsely claim to be deposited before payment is realized.
* As a cashier or sales recorder, I want clear validation messages and responsive form controls, so that I understand why an invalid combination is rejected and what step to take next.

**Acceptance criteria**:
* **AC-1**: The sales schema and database persist a new deposit status column with allowed values 'Deposited' and 'Not Deposited', defaulting to 'Deposited' for cash or digital payments marked Paid, and 'Not Deposited' for unpaid or pending entries.
* **AC-2**: When payment status is 'Paid', users may freely set deposit status to either 'Deposited' or 'Not Deposited'.
* **AC-3**: When payment status is 'Unpaid', deposit status must strictly be 'Not Deposited'. Any attempt to create or update an Unpaid sale as 'Deposited' must be rejected with HTTP 422 and detail message: "Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first."
* **AC-4**: When payment status is 'Pending', deposit status is restricted to 'Not Deposited' unless the payment method is 'Cheque' with a valid cheque number and marked physically deposited awaiting clearance. Any other Pending transaction attempting 'Deposited' must be rejected with HTTP 422 and detail message: "Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance."
* **AC-5**: If a previously Paid or deposited sale is modified so that its payment status reverts to 'Unpaid' or non cheque 'Pending', the system automatically resets deposit status to 'Not Deposited' and informs the user.
* **AC-6**: The sales table (both Daily Summary drilldown rows and All Transactions view) displays a Deposit Status column with inline dropdown editing for authorized roles, and the Add Transaction sheet and edit modal provide synchronized deposit status selection.
* **AC-7**: Existing historical records in the database receive a safe backfill: past sales marked Paid are initialized to 'Deposited', while past sales marked Unpaid or Pending are initialized to 'Not Deposited'.

## Options considered

### Option 1: Full stack validation with dedicated database column (Recommended)

Add a deposit status column to the sales table in PostgreSQL / Supabase and local SQLite storage. Enforce validation invariants using Pydantic model validators in backend schemas, route handlers in `sales.py`, sync handlers in `SalesReceivablesSyncService`, and dynamic dropdown filtering in React components.

**Pros**:
* Protects database integrity against direct API requests, script updates, and UI actions.
* Provides immediate feedback in the user interface and definitive enforcement in the service layer.
* Integrates cleanly with existing sales and receivables synchronization.

**Cons**:
* Requires updating both backend schemas and frontend form state handlers.

### Option 2: Frontend only dropdown logic

Add deposit status purely to the frontend interface and derive or restrict options in React components without backend database or schema enforcement.

**Pros**:
* Fast to code with no backend database migration.

**Cons**:
* Violates the core requirement to enforce business rules in the backend.
* Leaves the database vulnerable to corrupted states from API calls or concurrent background updates.

## Decision

**Chosen option**: Option 1: Full stack validation with dedicated database column.

We will add the deposit status column to the sales schema, enforce validation rules in backend Pydantic models and API endpoints, and reflect interactive controls with clear validation warnings in the frontend sales views.

## Rationale

Financial records require strict data consistency. Because banking reconciliation relies on verified cash inflow, allowing uncollected revenue to appear as deposited creates immediate discrepancy in company ledgers. Enforcing the rules in Pydantic validators guarantees that even automated syncs, batch imports, or direct HTTP calls adhere to the business rules. Combining backend enforcement with responsive client side validation ensures high data quality without sacrificing user experience.

## Feature design

**Data model sketch**:

Table: `sales`
* `sales_id`: INTEGER, Primary Key, autoincrement
* `company_id`: INTEGER, Foreign Key to `company.company_id`, not null
* `category_id`: INTEGER, Foreign Key to `category.category_id`, nullable
* `payment_method`: VARCHAR(100), nullable (e.g. 'Cash', 'GCash', 'Cheque', 'Bank Transfer')
* `payment_status`: VARCHAR(50), not null, default 'Paid' (values: 'Paid', 'Pending', 'Unpaid')
* `deposit_status`: VARCHAR(50), not null, default 'Not Deposited' (values: 'Deposited', 'Not Deposited')
* `transaction_date`: DATE, not null
* `cheque_number`: VARCHAR(100), nullable
* `amount`: NUMERIC(15, 2), not null
* `particulars`: TEXT, not null
* `audit_status`: VARCHAR(20), not null, default 'Pending Audit'

**State transitions**:

| Payment Status | Payment Method | Allowed Deposit Status | Transition Behavior |
|---|---|---|---|
| Paid | Any (Cash, GCash, Transfer, Cheque) | Deposited, Not Deposited | Free toggle permitted by authorized users |
| Pending | Cheque (with cheque number) | Deposited, Not Deposited | Permitted if cheque is physically deposited awaiting bank clearance |
| Pending | Non cheque (Cash, Transfer, etc.) | Not Deposited | Attempting 'Deposited' throws HTTP 422 error |
| Unpaid | Any | Not Deposited | Attempting 'Deposited' throws HTTP 422 error |

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/sales` | GET | `company_id`, `start_date`, `end_date`, `status` | List of `SaleOut` including `deposit_status` | BusinessReader | 401, 403 |
| `/api/v1/sales` | POST | `SaleCreate` (`payment_status`, `deposit_status`, `payment_method`, `cheque_no`, etc.) | `SaleOut` | BusinessWriter | 400, 422 (invalid status combination) |
| `/api/v1/sales/{sales_id}` | PUT | `SaleUpdate` (`deposit_status`, `payment_status`, etc.) | `SaleOut` | BusinessWriter | 404, 409 (locked if Verified), 422 (invalid status combination) |
| `/api/v1/sales/{sales_id}/deposit-status` | PATCH | `deposit_status`: str ('Deposited' or 'Not Deposited') | `SaleOut` | BusinessWriter | 404, 409 (locked if Verified), 422 (disallowed by payment status) |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Create sale | `deposit_status` | Defaults to 'Deposited' for Paid Cash/GCash, or user input validated by backend |
| View sales table | `Deposit Status` badge / select | Read from `sales.deposit_status` |
| Quick deposit toggle | Updated `deposit_status` | User action sent to PATCH `/api/v1/sales/{id}/deposit-status` |
| Validation error toast | Human readable message | Returned by backend HTTP 422 response detail or client pre validation check |

**Key invariants**:
* An Unpaid sale cannot have `deposit_status == 'Deposited'` under any circumstances.
* A Pending sale cannot have `deposit_status == 'Deposited'` unless `payment_method` is 'Cheque' and `cheque_number` is present.
* If a sale is marked 'Verified' in `audit_status`, its `deposit_status` cannot be changed unless unlocked by an Auditor role.

**Security model**:
* BusinessWriter roles (Finance, Admin, Company Supervisor within assigned company scope) can change deposit status.
* Auditor roles can review and verify transactions.
* Verified transactions remain locked against unauthorized edits.

**Configuration required**:
* None. Uses existing Supabase and SQLite database connections.

**Critical test scenarios**:
* Happy path: Create a Paid Cash sale, observe default 'Deposited', switch to 'Not Deposited' and back, verifies **AC-1**, **AC-2**.
* Happy path cheque: Create a Pending Cheque sale with a cheque number, mark as 'Deposited', verifies **AC-4**.
* Failure case unpaid: Attempt to create or update an Unpaid sale with 'Deposited', verify HTTP 422 and exact error detail, verifies **AC-3**.
* Failure case pending non cheque: Attempt to mark a Pending Cash or Transfer sale as 'Deposited', verify HTTP 422 and exact error detail, verifies **AC-4**.
* State cascade: Change an existing Deposited sale to Unpaid, verify backend automatically sets deposit status to 'Not Deposited', verifies **AC-5**.
* Audit lock: Attempt to update deposit status on a Verified sale, verify HTTP 409 conflict error, verifies **AC-6**.

## Build plan

1. Add `deposit_status` and `payment_status` columns to `Sale` model in `backend/app/models/finance.py` and create migration script with safe defaults, satisfies **AC-1**, **AC-7**.
2. Update Pydantic schemas in `backend/app/schemas/sale.py` (`SaleBase`, `SaleCreate`, `SaleUpdate`, `SaleOut`) with validators enforcing deposit status rules against payment status and cheque details, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**.
3. Implement backend route logic and dedicated PATCH endpoint in `backend/app/api/v1/endpoints/sales.py` with company scoping and audit verification checks, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-6**.
4. Update `SalesReceivablesSyncService` in `backend/app/services/sales_receivables_sync.py` to preserve deposit status invariants when receivables sync events occur, satisfies **AC-3**, **AC-5**.
5. Update frontend `salesService.ts` and types in `frontend/src/types/` to support `deposit_status` on sales payloads and map responses, satisfies **AC-1**, **AC-6**.
6. Enhance `frontend/src/pages/SalesPage.tsx` to add Deposit Status column in Daily Summary drilldown table and All Transactions view with inline selector and badges, satisfies **AC-6**.
7. Update `frontend/src/pages/AddTransactionSheetPage.tsx` and sale edit modals to include deposit status selector with dynamic options and human friendly validation messages, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-6**.
8. Create comprehensive automated backend tests in `backend/tests/test_sales_deposit_status.py` verifying all valid and invalid status matrix combinations, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**.

## Consequences

**Positive**:
* Banking reconciliations and cash position reports now accurately distinguish between realized cash and pending deposits.
* Prevents data corruption where uncollected or pending money is reported as deposited.
* Clear error feedback prevents user confusion when invalid options are attempted.

**Negative / tradeoffs**:
* Adds another column to the Sales table, requiring responsive layout tuning on narrow viewports.
* Sales recording staff must understand the distinction between payment status and deposit status.

**Neutral**:
* Historical paid sales are initialized to 'Deposited', so existing reports do not display empty statuses.

## Migration plan

**Strategy**: Safe phased rollout with backward compatible database default.
**Phases**:
1. Run SQL migration adding `deposit_status` VARCHAR(50) DEFAULT 'Not Deposited' to `sales` table in Supabase and local SQLite.
2. Backfill existing records: update `sales` set `deposit_status = 'Deposited'` where `payment_status = 'Paid'` (or no linked unpaid receivable exists).
3. Deploy backend code with Pydantic model validation and endpoints.
4. Deploy frontend UI with Deposit Status column and interactive controls.
**Rollback**: The column is nullable or defaults to 'Not Deposited'. If rolled back, existing queries continue working normally.
**Risks**: Minor risk of temporary UI layout overflow on smaller screens, mitigated by responsive column styling.
