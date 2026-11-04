# 0028. Refine Unpaid Sales Assignment, Receivables Controls, and Bidirectional Sync

**Date**: 2026-11-04
**Status**: In Progress

## Summary

This spec simplifies unpaid sales entry, opens up receivable editing and deleting to authorized branch writers, and keeps Sales Records and Receivables synchronized automatically. On `/sales/add`, you pick `External` or `Staff` from a dropdown instead of typing text, and the `Contact / Role` column and database fields are removed completely. Whenever you pay, edit, or delete a record on `/receivables` or `/sales`, an internal backend sync hook (an automatic server step that updates linked tables together) updates both sides in Supabase and SQLite and pushes a live WebSocket update (an instant two way browser message) unless the sale is already audited and locked as read only.

## Requirements

**User stories**:
- As a branch encoder (`Company`, `Supervisor`, or `Finance`), I want `Customer Type` on `/sales/add` to be a clean dropdown (`External` or `Staff`) with no `Contact / Role` column, so that I can assign unpaid items fast without typing extra fields.
- As a `Finance` officer or company scoped `Company` / `Supervisor` writer, I want to edit and delete both debtor rows and individual receivable orders on `/receivables` (including setting payment status directly to `Paid` or `Unpaid`), so that I can correct records within my authorized company scope.
- As a manager viewing the Sales Record tab on `/sales`, I want partial and full receivable settlements, edits, and deletions to automatically update the linked sales record, line status tags, **Total Sales**, and **Total Cash** in real time without refreshing the page.
- As an auditor, I want any sale marked `Verified` (and all of its linked receivables and payments) to become strictly read only on both `/sales` and `/receivables`, so that audited numbers cannot be altered retroactively.

**Acceptance criteria**:
- **AC-1**: On `/sales/add` in the unpaid assignment step, `Customer Type` renders as a dropdown with `External` (selected by default) and `Staff` (mapped to `Internal` on the backend for payroll deduction eligibility), replacing the text input.
- **AC-2**: All `Contact / Role` columns, subtitles, and form inputs are removed from `/sales/add`, `/receivables`, edit dialogs, and `PersonLedgerDrawer`, and a database migration drops `customer_phone` and `customer_role` from `receivables`.
- **AC-3**: Users with role `Finance` (across all companies) and `Company` or `Supervisor` writers (within their assigned company scope) can edit and delete both debtor summary rows on `/receivables` and individual receivable orders in the ledger drawer, while `Audit` and `Admin` roles cannot mutate receivables (`Audit` remains strictly read only).
- **AC-4**: Editing a receivable order allows changing `customer_name`, `customer_type`, `items_summary`, `transaction_date`, `notes`, `total_amount`, and `payment_status` (`Unpaid`, `Partial`, or `Paid`). Selecting `Paid` reveals `Payment Method` (default `Cash`) and optional `Deposit Bank` fields and creates a `ReceivablePayment` (plus bank deposit if selected) for the remaining balance; switching back to `Unpaid` reverses existing `ReceivablePayment` rows and any linked bank deposits.
- **AC-5**: When a partial payment is recorded against a receivable, the full order amount counts toward **Total Sales**, the collected `amount_paid` counts immediately toward **Total Cash** on `/sales`, and the linked line inside `sales.particulars` updates to `[Pending]` until `balance` reaches `0.00`, at which point the line updates to `[Paid]`.
- **AC-6**: Every receivable payment, payroll settlement, edit, or deletion runs an internal backend sync hook that updates (or removes) the linked line in `sales` across both Supabase and local SQLite using `sale_line_index` (with item text and amount fallback for legacy rows) and broadcasts both `RECEIVABLES_UPDATED` and `SALES_UPDATED` WebSocket events.
- **AC-7**: Editing or deleting a `Sale` on `/sales` that has linked receivables (including receivables with partial payments already recorded) bidirectionally updates or cascade deletes the linked `Receivable` rows (recomputing `total_amount`, `balance`, and `payment_status`, and adjusting or reversing excess payments if the edited total drops below `amount_paid`), guarded against recursive sync loops.
- **AC-8**: Once a `Sale` has `audit_status == "Verified"`, both the `Sale` on `/sales` and every linked `Receivable` and `ReceivablePayment` on `/receivables` render as locked and read only in the UI, and backend mutation endpoints (`PUT`, `POST` payment, `DELETE` on `/sales` and `/receivables`) reject changes with HTTP `409 Conflict` (or `403 Forbidden` for unauthorized roles).
- **AC-9**: Batch debtor endpoints (`PUT /api/v1/receivables/debtor` and `DELETE /api/v1/receivables/debtor`) update customer details or cascade delete all non verified receivables for a debtor within the caller's authorized company scope in one atomic operation, reversing linked bank deposits and syncing affected `Sale` records.
- **AC-10**: Both `SalesPage.tsx` and `ReceivablesPage.tsx` subscribe to `SALES_UPDATED` and `RECEIVABLES_UPDATED` WebSocket events and silently invalidate caches and refetch on WebSocket reconnect and window focus.

## Decision

**Chosen option**: Option 1: In Place Enhancement with Internal Domain Sync Service and WebSocket Push.

We will implement a shared internal `SalesReceivablesSyncService` called directly during receivable and sale mutations, widen receivable edit and delete permissions to company scoped `BusinessWriter` accounts, enforce a mutual read only lock when `audit_status == "Verified"`, drop `customer_phone` and `customer_role`, add `sale_line_index`, and broadcast `SALES_UPDATED` and `RECEIVABLES_UPDATED` over `ws_manager`.

Internal design calls settled for the build:
- **Loop prevention**: Pass an explicit `skip_counterpart_sync: bool = False` flag into internal service methods (chosen because it is stateless and deterministic within one request; runner up was a `last_synced_at` database timestamp column, which suffers from clock skew).
- **Realtime client refresh**: Use a 250ms debounced silent cache invalidation and refetch on `SALES_UPDATED`, `RECEIVABLES_UPDATED`, WebSocket `open` reconnect, and `window` `focus` events (chosen because it matches `SalesPage.tsx` audit refresh and heals missed events automatically; runner up was patching React state directly from WebSocket payloads, which drifts on KPI aggregations).
- **Build approach**: No explicit `Approach` override is recorded in `AGENTS.md` or `docs/scope/scope.md`, so the build plan below uses **Tracer Bullet** vertical slices (standing up schema and sync plumbing end to end first, then layering debtor controls, audit locks, and UI refinements).

## Feature design

### Data model sketch

| Table | Column | Change | Type & Nullability | Notes |
|---|---|---|---|---|
| `receivables` | `customer_phone` | **Drop** | Removed | Dropped via safe migration; removed from Pydantic schemas and UI |
| `receivables` | `customer_role` | **Drop** | Removed | Dropped via safe migration; removed from Pydantic schemas and UI |
| `receivables` | `sale_line_index` | **Add** | `Integer`, Nullable | Zero based index of the originating line in `sales.particulars`; falls back to matching `items_summary` and `total_amount` when `NULL` |
| `receivables` | `sale_id` | Existing | `Integer`, Nullable, FK → `sales.sales_id` (`SET NULL`) | `1:N` from `sales` to `receivables` |
| `receivables` | `customer_type` | Existing | `String(50)`, Non Null | `'External'` (default) or `'Internal'` (UI label `'Staff'`) |
| `receivable_payments` | All columns | Unchanged | FK → `receivables.receivable_id` (`CASCADE`) | Cascade deleted with bank reversal when receivable is deleted or reset to `Unpaid` |
| `sales` | `particulars`, `amount`, `audit_status` | Unchanged | Existing columns | Each line formatted with `[Paid]`, `[Pending]`, or `[Unpaid]`; `audit_status == 'Verified'` locks both `Sale` and linked `Receivable` rows |

### State transitions

Receivable and linked `sales.particulars` line status lifecycle:

- `Unpaid` (`amount_paid == 0`, `balance == total_amount`, sales line `[Unpaid]`) → partial payment recorded → `Partial` (`0 < amount_paid < total_amount`, sales line `[Pending]`, `amount_paid` added to **Total Cash**)
- `Partial` → remaining balance paid or edited to `Paid` → `Paid` (`amount_paid == total_amount`, `balance == 0`, sales line `[Paid]`)
- `Unpaid` → paid in full, payroll settled, or edited directly to `Paid` → `Paid` (`amount_paid == total_amount`, `balance == 0`, sales line `[Paid]`)
- `Paid` or `Partial` → payment reversed or status edited to `Unpaid` (while `audit_status != 'Verified'`) → `Unpaid` (existing payments and bank deposits reversed, `amount_paid = 0`, sales line `[Unpaid]`)
- Any state → linked `Sale.audit_status` set to `Verified` → **Locked Read Only** (all edits, payments, reversals, and deletions blocked on both `/sales` and `/receivables`)

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/receivables` | `GET` | `company_id`, `company_name`, `customer_type`, `status`, `start_date`, `end_date`, `search` | `List[ReceivableOut]` (includes `is_locked` derived from linked `Sale.audit_status`) | `BusinessReader` (company scoped) | `401`, `403` |
| `/api/v1/receivables` | `POST` | `company_id`, `customer_name`, `customer_type`, `sale_id`, `sale_line_index`, `items_summary`, `total_amount`, `transaction_date` | `ReceivableOut` | `BusinessWriter` (company scoped) | `400`, `401`, `403`, `422` |
| `/api/v1/receivables/{id}` | `PUT` | `customer_name`, `customer_type`, `items_summary`, `transaction_date`, `total_amount`, `payment_status`, `payment_method`, `bank_account_id`, `notes` | `ReceivableOut` | `BusinessWriter` (company scoped) | `400`, `403`, `404`, `409` (audit locked) |
| `/api/v1/receivables/{id}` | `DELETE` | `id` | `{ "detail": "Receivable deleted successfully" }` | `BusinessWriter` (company scoped) | `403`, `404`, `409` (audit locked) |
| `/api/v1/receivables/debtor` | `PUT` | `current_customer_name`, `company_id` / `company_name`, `new_customer_name`, `customer_type` | `{ "updated_count": int }` | `BusinessWriter` (company scoped) | `400`, `403`, `404`, `409` (if all rows audit locked) |
| `/api/v1/receivables/debtor` | `DELETE` | `customer_name`, `company_id` / `company_name` | `{ "deleted_count": int }` | `BusinessWriter` (company scoped) | `403`, `404`, `409` (if any row audit locked) |
| `/api/v1/receivables/{id}/payments` | `POST` | `amount`, `payment_date`, `payment_method`, `bank_account_id`, `reference_no`, `notes` | `ReceivablePaymentOut` | `BusinessWriter` (company scoped) | `400`, `403`, `404`, `409` (audit locked) |
| `/api/v1/receivables/payments/{payment_id}` | `DELETE` | `payment_id` | `{ "detail": "Payment reversed successfully" }` | `BusinessWriter` (company scoped) | `403`, `404`, `409` (audit locked) |
| `/api/v1/sales/{sales_id}` | `PUT` / `PATCH` / `DELETE` | Existing `SaleUpdate` fields | `SaleOut` / `204` (triggers sync to linked `Receivable` rows) | `BusinessWriter` (company scoped) | `400`, `403`, `404`, `409` (audit locked) |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Assign unpaid row on `/sales/add` | `customer_type` (`Internal` or `External`) | Selected from `Customer Type` dropdown (`External` default → `'External'`, `Staff` → `'Internal'`) |
| Link receivable to sale line | `sale_line_index` | Zero based line index emitted by `/sales/add` when formatting `sales.particulars` lines |
| Edit receivable status to `Paid` | Settlement `ReceivablePayment` fields (`amount`, `payment_method`, `bank_account_id`, `payment_date`) | `amount` = remaining `receivable.balance`; `payment_method` (default `'Cash'`) and optional `bank_account_id` from Edit dialog inputs; `payment_date` = `date.today()` |
| Edit receivable status to `Unpaid` | Reversal withdrawal amount and account | Each existing `ReceivablePayment.amount` and `ReceivablePayment.bank_account_id` on that receivable |
| Sync Receivable → Sale | Updated `sales.particulars` line tag and `sales.amount` | Line located by `receivable.sale_line_index` (fallback: normalized `items_summary` + prior `total_amount`); status tag derived as `Paid` → `[Paid]`, `Partial` → `[Pending]`, `Unpaid` → `[Unpaid]`; `sales.amount` = sum of all remaining lines on that `Sale` |
| Sync Sale → Receivable | Updated `receivable.total_amount`, `items_summary`, `amount_paid`, `balance`, `payment_status` | Parsed line from updated `sales.particulars` matched by `sale_line_index` (or fallback); if line tag changed to `[Paid]` and `balance > 0`, auto settle remaining balance using `sale.payment_method` or `'Cash'`; if `new_total < amount_paid`, reverse or cap excess payment by `amount_paid - new_total` |
| Compute **Total Sales** KPI on `/sales` | Gross accrued sales for selected company and date range | Sum of `sales.amount` across all matching `Sale` records (paid, pending, and unpaid lines included) |
| Compute **Total Cash** KPI on `/sales` | Realized cash collected for selected company and date range | Sum of `[Paid]` non receivable lines on `sales` plus `receivables.amount_paid` (which includes partial and full receivable collections) for linked receivables |
| Determine read only lock (`is_locked`) | Lock badge and disabled edit / delete / pay buttons on `/receivables` and `/sales` | Derived boolean: `True` when linked `Sale.audit_status == 'Verified'`, else `False` |
| Resolve company write scope | Authorized `company_id` list | `check_company_access(current_user, receivable.company_id)`: `Finance` allowed across all companies; `Supervisor` / `Company` allowed only when `company_id` is in `current_user["company_ids"]` |

### Key invariants

- `receivables` must never store `customer_phone` or `customer_role`; `customer_type` is strictly `'External'` or `'Internal'`.
- `0.00 <= amount_paid <= total_amount` and `balance == total_amount - amount_paid` must hold after every create, payment, reversal, or bidirectional edit.
- Whenever a receivable's `balance == 0.00` (and `total_amount > 0`), `payment_status` is `'Paid'` and its linked line in `sales.particulars` carries `[Paid]`.
- Whenever `0.00 < amount_paid < total_amount`, `payment_status` is `'Partial'`, its linked line in `sales.particulars` carries `[Pending]`, and `amount_paid` contributes to **Total Cash**.
- Whenever `amount_paid == 0.00`, `payment_status` is `'Unpaid'` and its linked line in `sales.particulars` carries `[Unpaid]`.
- Deleting the only (or last remaining) line of a `Sale` via `/receivables` deletes the parent `Sale` in both Supabase and SQLite; deleting one line of a multi line `Sale` removes only that line, decrements `sales.amount`, and reindexes sibling `sale_line_index` values.
- Any `Sale` with `audit_status == 'Verified'` and all of its linked `Receivable` and `ReceivablePayment` rows are immutable (`HTTP 409 Conflict` on any mutation attempt).
- Bidirectional sync must never re enter itself within the same transaction (`skip_counterpart_sync=True` on the secondary side).

### Security model

- **Read access (`GET`)**: `Finance` and `Audit` can read receivables across all companies; `Company` and `Supervisor` users can read only receivables matching their assigned `company_ids`; `Admin` is blocked from business ledger operations per `BusinessReader`.
- **Write, edit, payment, and delete access (`POST`, `PUT`, `DELETE`)**: Permitted for `Finance` across all companies and for `Company` / `Supervisor` (`BusinessWriter`) strictly within their assigned `company_ids` (verified server side via `check_company_access` on every single order and debtor batch operation).
- **Audit role**: Strictly read only (`403 Forbidden` on all write, edit, payment, and delete endpoints; UI hides mutation controls).
- **Verified audit lock**: Even authorized `Finance` and `Supervisor` writers cannot edit, pay, reverse, or delete a `Sale` or linked `Receivable` once `Sale.audit_status == 'Verified'`.

### Critical test scenarios

- **Happy path: Unpaid assignment dropdown and Contact / Role removal**: Encode a sale on `/sales/add` with two unpaid items, verify `Contact / Role` is absent, pick `External` (default) on row 1 and `Staff` on row 2, submit, and confirm row 1 saves as `External` and row 2 saves as `Internal` with `sale_line_index` populated, verifies **AC-1**, **AC-2**.
- **Happy path: Partial payment then full settlement syncs to Sales Record and Total Cash**: Record a ₱400 partial payment on a ₱1,000 receivable; verify **Total Sales** shows ₱1,000, **Total Cash** increases by ₱400, the linked `Sale` line in Supabase and SQLite updates to `[Pending]`, and an open `/sales` tab updates via WebSocket without reload. Pay the remaining ₱600 and verify the `Sale` line flips to `[Paid]` and **Total Cash** reaches ₱1,000, verifies **AC-5**, **AC-6**, **AC-10**.
- **Happy path: Direct status toggle and order / debtor edit and delete on `/receivables`**: As a company scoped `Supervisor`, edit an unpaid receivable on `/receivables` and set status to `Paid` with `GCash` and a company bank account; verify a `ReceivablePayment` and bank deposit are created and the linked `Sale` becomes `[Paid]`. Delete a debtor row via batch delete and confirm linked bank deposits reverse and linked `Sale` lines update or delete, verifies **AC-3**, **AC-4**, **AC-9**.
- **Happy path: Bidirectional edit from `/sales` to `/receivables` with partial payment**: Edit a non audited `Sale` on `/sales` whose receivable has ₱300 paid out of ₱800, changing the line total to ₱1,000; verify the linked `Receivable` updates to `total_amount = 1000`, `amount_paid = 300`, `balance = 700`, `payment_status = 'Partial'` with no recursive loop, verifies **AC-7**.
- **Failure / lock case: Audited sale blocks mutations on both screens**: Mark a `Sale` as `Verified` using an `Audit` account; attempt `PUT` and `DELETE` on `/api/v1/sales/{id}` and `/api/v1/receivables/{id}` as `Finance`; verify both return `409 Conflict` and UI buttons show locked state, verifies **AC-8**.
- **Auth / permission boundary**: Attempt to edit or delete Company B's receivable as Company A's `Supervisor` (returns `403`), and attempt to edit or delete any receivable as `Audit` (returns `403`), verifies **AC-3**.
- **Recovery case: Missed WebSocket update while disconnected**: Disconnect WebSocket on `/sales`, settle a receivable in another session, restore connection or focus the `/sales` window, and verify cache invalidation reloads the `[Paid]` status automatically, verifies **AC-10**.

## Build plan

- [x] 1. Add a safe startup and Supabase SQL migration that adds nullable `sale_line_index` (`Integer`) to `receivables`, drops `customer_phone` and `customer_role` from `receivables`, and updates SQLAlchemy model `Receivable` plus Pydantic schemas in `backend/app/models/receivable.py` and `backend/app/schemas/receivable.py` (including `is_locked`, `payment_status`, `payment_method`, and `bank_account_id` on `ReceivableUpdate`, plus debtor batch schemas), satisfies **AC-2**, **AC-4**, **AC-8**, **AC-9**.
- [x] 2. Implement `SalesReceivablesSyncService` (in `backend/app/services/sales_receivables_sync.py`) to parse and rewrite `sales.particulars` lines across both Supabase (`client.table("sales")`) and local SQLite (`Sale`), sync Receivable → Sale on payment / edit / delete, sync Sale → Receivable on sale edit / delete (handling partial payments and line reindexing), enforce `audit_status == 'Verified'` locks (`409 Conflict`), guard with `skip_counterpart_sync`, and broadcast `SALES_UPDATED` and `RECEIVABLES_UPDATED`, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**.
- [x] 3. Update `ReceivablesService` (`backend/app/services/receivables_service.py`), `receivables.py` endpoints (`backend/app/api/v1/endpoints/receivables.py`), and `sales.py` endpoints (`backend/app/api/v1/endpoints/sales.py`) to wire `SalesReceivablesSyncService`, support direct `Paid` / `Unpaid` status transitions with payment and bank deposit creation or reversal, add `PUT` and `DELETE /api/v1/receivables/debtor`, and replace `FinanceUser` guards on receivable mutations with company scoped `BusinessWriter` + `check_company_access`, satisfies **AC-3**, **AC-4**, **AC-6**, **AC-7**, **AC-8**, **AC-9**.
- [x] 4. Update `frontend/src/pages/AddTransactionSheetPage.tsx` to replace the `Customer Type` text input with a styled dropdown (`External` default, `Staff` option), remove the `Contact / Role` column and state fields, and pass `sale_line_index` when creating receivables from unpaid sales lines, satisfies **AC-1**, **AC-2**.
- [x] 5. Update `frontend/src/services/receivablesService.ts`, `frontend/src/services/receivablesStore.ts`, `frontend/src/hooks/useReceivables.ts`, `frontend/src/pages/ReceivablesPage.tsx`, and `frontend/src/components/receivables/PersonLedgerDrawer.tsx` to remove all phone and role UI fields, enable Edit and Delete buttons for `Finance` and company scoped `Company` / `Supervisor` writers, support editing order items, amounts, and `Paid` / `Unpaid` status (with `Payment Method` and `Deposit Bank` inputs), wire batch debtor edit and delete endpoints, and disable mutations when `is_locked` is true, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-8**, **AC-9**.
- [x] 6. Update `frontend/src/pages/SalesPage.tsx`, `frontend/src/utils/cashLedgerUtils.ts`, and `frontend/src/services/websocketService.ts` so **Total Cash** includes partial and full receivable `amount_paid` without double counting `[Paid]` lines, `SalesPage` and `ReceivablesPage` subscribe to both `SALES_UPDATED` and `RECEIVABLES_UPDATED`, and both screens invalidate caches and silently refetch on WebSocket reconnect and window focus, satisfies **AC-5**, **AC-6**, **AC-10**.

## Consequences

**Positive**:
- Unpaid sales encoding is faster and cleaner with a two option `Customer Type` dropdown and no redundant `Contact / Role` column.
- Branch `Company` and `Supervisor` writers can maintain their own company's receivables without waiting on central `Finance`, while cross company isolation and `Audit` read only rules remain intact.
- Sales Records, Deposit views, **Total Cash**, and Receivables stay consistent across Supabase, SQLite, and all open browser tabs automatically.
- Audited sales (`Verified`) are protected end to end so backdoor receivable edits cannot silently alter verified revenue.

**Negative / tradeoffs**:
- Dropping `customer_phone` and `customer_role` permanently deletes any phone numbers or job titles previously saved in `receivables`.
- Synchronizing structured text lines inside `sales.particulars` requires careful index tracking when lines are deleted from multi item sales.

**Neutral**:
- Legacy receivable rows created before `sale_line_index` existed will use normalized item description and amount matching until next edited.

## Migration plan

**Strategy**: Safe phased schema update across Supabase PostgreSQL and local SQLite.
**Phases**:
1. Add nullable `sale_line_index INTEGER` to `receivables` in Supabase and local SQLite startup migration so existing queries continue running without interruption.
2. Deploy updated backend models, `SalesReceivablesSyncService`, and frontend UI that no longer read or write `customer_phone` or `customer_role`.
3. Execute `ALTER TABLE receivables DROP COLUMN IF EXISTS customer_phone, DROP COLUMN IF EXISTS customer_role` on Supabase (and table rebuild / `DROP COLUMN` on SQLite >= 3.35).
**Rollback**: Re add nullable `customer_phone VARCHAR(50)` and `customer_role VARCHAR(100)` columns and revert the application commit; `sale_line_index` is nullable and harmless if left in place.
**Risks**: SQLite versions older than 3.35.0 do not support `ALTER TABLE DROP COLUMN` when indexes or foreign keys reference the dropped columns; neither `customer_phone` nor `customer_role` has an index or foreign key, and Python 3.11+ bundles SQLite 3.39+, keeping local migration safe.

## Follow-up

- [ ] Apply the Supabase SQL migration (`ADD COLUMN IF NOT EXISTS sale_line_index INTEGER` and `DROP COLUMN IF EXISTS customer_phone, DROP COLUMN IF EXISTS customer_role`) on the hosted Supabase database during deployment.
- [ ] Note that `docs/specs/0027-unpaid-expense-sales-receivables-lifecycle.md` (`AC-2` and `AC-8`) is refined by this spec regarding `Contact / Role` removal and company scoped `BusinessWriter` edit and delete permissions.

