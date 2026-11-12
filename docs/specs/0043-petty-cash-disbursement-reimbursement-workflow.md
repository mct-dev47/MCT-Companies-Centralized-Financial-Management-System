# 0043. Petty Cash Disbursement Separation, Short Type Labels, Funding Breakdown Visibility, and Message Handler Optimization

**Date**: 2026-11-12
**Status**: Implemented

## Summary

This enhancement separates direct Petty Cash Disbursements from employee Reimbursements, fixes overlapping Type labels in the Petty Cash table, surfaces the full Funding Breakdown to Finance during review, and eliminates save delays caused by synchronous WebSocket message handling and remote HTTP expense queries. A direct Disbursement now immediately creates an Expense record (`payment_method = 'Petty Cash'`) and deducts from the company's unreserved Petty Cash balance without waiting for Finance endorsement, while a Reimbursement continues to route to Finance with its full Funding Breakdown visible in the review modal, details view, and table row.

## Context

In the current Petty Cash module (built across specs `0038` and `0042`), all spending workflows enter through `ReimbursementModal` and write a `PettyCashTopUp` row with `request_type = 'reimbursement'`. Even when an expense is paid purely from company Petty Cash with zero employee out of pocket spending, it stalls in `Pending Finance Endorsement` until Finance endorses, Audit approves, and Finance executes a final settlement. Staff expect a direct Petty Cash Disbursement to record a real company Expense and deduct Petty Cash immediately on save, reserving the multi stage Finance and Audit workflow for employee Reimbursements where personal money or split funding needs bank payout review.

Three additional usability and performance issues affect daily Finance operations on `/petty-cash`:
1. **Column overlap in the Petty Cash table**: The `TYPE` column uses a fixed `9%` width (`min-w-[1000px]`), while the badges render full strings `"Petty Cash Disbursement"` and `"Reimbursement"` with `whitespace-nowrap`, causing badge text to spill over into the adjacent `PARTICULARS` column.
2. **Hidden Funding Breakdown during Finance review**: Finance sees the Funding Breakdown card (`Total Expenses`, `Company Cash Paid`, `Out of Pocket`, `Pre recorded`) only inside the Transaction Details modal. The Finance Endorsement confirmation modal displays only Company, Amount, and Particulars, and the table row gives no breakdown summary.
3. **Save delay and `[Violation] 'message' handler took 202ms` browser warning**: Submitting a Petty Cash request triggers both `NOTIFICATION_RECEIVED` and `PETTY_CASH_UPDATED` WebSocket broadcasts. On the frontend, `websocketService` invokes all listeners synchronously inside `socket.onmessage`, causing `PettyCashPage.loadData()` (including a full React table state reset) and duplicate `NotificationBell` fetches to run inside the event handler alongside `onSuccess` calling `loadData()` a second time. On the backend, `create_topup`, `get_unreserved_balance`, and `list_ledger` invoke `_petty_cash_expenses`, which executes synchronous HTTP requests to Supabase inside the database transaction path instead of querying local SQL `Expense` rows.

## Requirements

**User stories**:
- As a Staff member, Supervisor, or Finance officer, I want to record a direct Petty Cash Disbursement that goes straight into Expenses and deducts Petty Cash immediately (when balance allows), separate from an employee Reimbursement that routes to Finance.
- As a Finance officer reviewing a Reimbursement, I want to see the Funding Breakdown (`Total Expenses`, `Paid from Petty Cash`, `Out of Pocket`, and any pre recorded expense link) inside the Finance Endorsement confirmation modal, Transaction Details modal, and table row so I can verify amounts before endorsing.
- As any Petty Cash user, I want the `TYPE` column badges to display short labels (`Reimburse` and `Disbursement`) that never overlap `PARTICULARS`, and I want saving to feel instantaneous without `[Violation] 'message' handler` warnings.

**Acceptance criteria**:
- **AC-1**: The `Request Petty Cash` menu (and modal header/mode selector) offers distinct **Disbursement** (paid from company Petty Cash) and **Reimbursement** (employee out of pocket or mixed split) entry flows for authorized roles (`staff`, `supervisor`, `finance`, `admin`, `superadmin` for Disbursement; all business writers for Reimbursement), while keeping `Top-up Request` gated to Admin, Finance, and Supervisors.
- **AC-2**: Submitting a **Disbursement** via `POST /api/v1/petty-cash/disbursements` acquires the company wallet lock (`petty_cash_wallets`), validates `amount > 0` and `amount <= unreserved_balance` (`ledger_balance` minus active `reserved_amount` holds from pending Reimbursements), rejects insufficient unreserved balance with HTTP `422` naming the available unreserved balance and requested amount, and atomically creates one `PettyCashTopUp` record (`request_type = 'disbursement'`, `status = 'Approved'`, `company_funded_amount = amount`, `employee_out_of_pocket = 0.00`) paired with one `Expense` row (`payment_method = 'Petty Cash'`, `reference_no = 'PC-DISB-<topup_id>'`, `linked_topup_id = topup.topup_id`).
- **AC-3**: A saved **Disbursement** appears immediately in the `Expenses` module and in the Petty Cash ledger as a single `Disbursement` row (`amount_out = amount`, `running_balance` reduced immediately), and `get_balance`, `get_unreserved_balance`, and `list_summaries` reflect the deduction immediately without duplicating it or miscounting `request_type = 'disbursement'` as a top up.
- **AC-4**: **Reimbursement** submissions continue to support both pure out of pocket (`C = 0`, `O = E`) and mixed split funding (`C > 0`, `O > 0`), placing reservation holds for unrecorded `C` under spec `0038` rules and routing to Finance (`Pending Finance Endorsement`, or `Pending Audit Approval` when Finance submits directly with an own company bank).
- **AC-5**: Finance sees the **Funding Breakdown** (`Total Expenses (E)`, `Paid from Petty Cash (C)`, `Out of Pocket (O)`, and `Pre recorded #ID` badge when linked) inside the Finance Endorsement confirmation modal, inside the Transaction Details modal, and as a compact breakdown hint in the table row for Reimbursement entries.
- **AC-6**: In the Petty Cash ledger table (`PettyCashPage`), the `TYPE` column renders `"Reimburse"` for `reimbursement` / `replenishment` rows, `"Disbursement"` for `disbursement` / `replenishment_disbursement` rows, `"Expense"` for direct Expenses module petty cash rows, and `"Top-up"` for top ups. The `TYPE` column width is widened (`>= 11%` or equivalent `min-w`) and overflow clipped cleanly so badges never overlap `PARTICULARS`, and the Type filter dropdown options match (`All`, `Top-up`, `Disbursement`, `Reimburse`).
- **AC-7**: Saving a Petty Cash Disbursement, Reimbursement, or Top up triggers no duplicate `loadData()` call on the client, WebSocket `onmessage` callbacks in `websocketService` defer execution asynchronously (`queueMicrotask` or `setTimeout(..., 0)`) and coalesce rapid `PETTY_CASH_UPDATED` / `NOTIFICATION_RECEIVED` bursts so the `'message'` handler completes well under `50ms` with no `[Violation]` warning, and backend `PettyCashService._petty_cash_expenses` queries the local SQLAlchemy `Expense` table directly instead of blocking on synchronous Supabase REST calls.

## Options considered

### Option 1: Atomic Disbursement pair (`PettyCashTopUp` + `Expense`), in place UI and WebSocket coalescing, local SQL expense query
Add `POST /api/v1/petty-cash/disbursements` that atomically inserts an `Expense` row (`payment_method = 'Petty Cash'`, `reference_no = 'PC-DISB-<topup_id>'`) and a posted `PettyCashTopUp` metadata row (`request_type = 'disbursement'`, `status = 'Approved'`). Fix `get_balance` and `_build_summary` to treat only `request_type = 'topup'` as inflows, expose `unreserved_balance` on `PettyCashSummaryOut`, update `PettyCashPage` and `ReimbursementModal` in place for short labels, Disbursement mode, and Funding Breakdown visibility, defer and coalesce WebSocket listeners, and replace Supabase HTTP reads in `_petty_cash_expenses` with local SQLAlchemy queries.

**Pros**:
- Satisfies Expense module reporting and immediate Petty Cash deduction while preserving `paid_by`, `items` JSON, and lazy receipt loading (`GET /topups/{id}/receipts`) with zero schema migrations to `expenses`.
- Eliminates both the frontend synchronous WebSocket bottleneck and the backend HTTP query latency in one cohesive slice.
- Keeps full backward compatibility with historical `replenishment_disbursement`, `PC-EXP-`, and `REIMB-` rows.

**Cons**:
- Requires strict synchronization between `petty_cash_topups` and `expenses` so `PC-DISB-` rows are counted in balance deductions without rendering twice in `list_ledger`.
- Keeps `petty_cash_topups` serving three `request_type` variants (`topup`, `reimbursement`, `disbursement`), requiring explicit `request_type` guards in summary and ledger helpers.

### Option 2: Direct `expenses` table insert only (adding metadata columns to `expenses`)
Add `paid_by`, `items`, and `attachments` columns to `expenses` via database migration and write direct Disbursements exclusively to `expenses` without touching `petty_cash_topups`.

**Pros**:
- Single table storage for Disbursements with no cross table linking.

**Cons**:
- Requires PostgreSQL and SQLite migrations on `expenses`, duplicates lazy receipt attachment endpoints for `expenses`, and complicates `PettyCashPage` details and delete flows that operate on `topup_id`.

### Option 3: Dedicated `petty_cash_disbursements` table plus separate frontend route
Introduce a new `petty_cash_disbursements` table and merge three independent tables in `list_ledger` and `get_balance`.

**Pros**:
- Clean domain table separation at the database level.

**Cons**:
- High migration and query complexity across summaries, movements, receipts, and activity logs without solving the Expenses module visibility requirement unless an `Expense` row is still created.

## Decision

**Chosen option**: Option 1: Atomic Disbursement pair (`PettyCashTopUp` + `Expense`), in place UI and WebSocket coalescing, local SQL expense query.

We will add `POST /api/v1/petty-cash/disbursements` to atomically create an `Expense` and posted `PettyCashTopUp` pair under wallet lock, fix `TYPE` column labels (`Reimburse` and `Disbursement`) and widths, surface the Funding Breakdown in Finance endorsement and table rows, coalesce frontend WebSocket handlers asynchronously, and query local SQL `Expense` rows in `PettyCashService`.

## Rationale

Our existing architecture already stores Petty Cash deductions in `expenses` and lazy receipt/item metadata in `petty_cash_topups` (spec `0042`). Option 1 delivers immediate Expense posting and Petty Cash balance deduction without altering database tables or breaking lazy receipt loading, while fixing the root causes of both the table overlap and the `202ms` `'message'` handler violation.

Specifically, `_build_summary` and `get_balance` currently classify any `request_type != 'reimbursement'` as an approved top up inflow; fixing that guard to check `request_type == 'topup'` ensures `disbursement` rows never inflate `total_topups` and always deduct via their linked `Expense` row. On performance, moving WebSocket listener callbacks off the synchronous `onmessage` stack and removing redundant `onSuccess` reloads directly eliminates main thread stalls, while querying local SQL `Expense` rows removes per save and per ledger network round trips to Supabase REST.

## Feature design

**Data model sketch**:
- **`petty_cash_topups`** (`topup_id` PK, FK `company_id -> company.company_id`, FK `existing_expense_id`, `petty_cash_expense_id`, `reimbursement_expense_id -> expenses.expense_id`): stores `request_type` (`topup` | `reimbursement` | `disbursement`), `status` (`Approved` immediately for `disbursement`; `Pending Finance Endorsement` or `Pending Audit Approval` for `reimbursement`), `amount`, `total_expenses`, `company_funded_amount`, `employee_out_of_pocket`, `reserved_amount`, `paid_by`, `category`, `items`, `receipt_url`, `attachments`, `created_by`.
- **`expenses`** (`expense_id` PK, FK `company_id -> company.company_id`, FK `category_id -> category.category_id`, FK `linked_topup_id -> petty_cash_topups.topup_id`): stores immediate Disbursement outflows (`payment_method = 'Petty Cash'`, `reference_no = 'PC-DISB-<topup_id>'`) and settled Reimbursement outflows (`PC-EXP-<topup_id>`, `REIMB-<topup_id>`).
- **`petty_cash_wallets`** (`wallet_id` PK, unique FK `company_id -> company.company_id`): row lock anchor (`SELECT ... FOR UPDATE` on PostgreSQL) serializing Disbursement unreserved balance checks and Reimbursement reservation holds.
- **`PettyCashSummaryOut`** (API schema addition): adds `unreserved_balance: Decimal` alongside `balance` so clients and validators share the exact spendable float.

**State transitions**:
- **Disbursement**: `Created (POST /disbursements)` -> immediately `Approved` (`PettyCashTopUp`) + `Expense` (`PC-DISB-<topup_id>`) in one DB transaction. No Finance endorsement step.
- **Reimbursement**: `Pending Finance Endorsement` -> `Pending Audit Approval` (Finance chooses own company bank, sees Funding Breakdown) -> `Approved` (Audit) -> `Settled` (zero excess) or `Reimbursed` (bank payout, `REIMB-<topup_id>` and optional `PC-EXP-<topup_id>`). When Finance submits directly with a funding bank, starts at `Pending Audit Approval`.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/petty-cash/disbursements` | POST | `company_id`/`company_name`, `amount`, `topup_date`, `paid_by`, `category`, `description`, `items` (opt), `receipt_url`/`attachments` (opt) | `PettyCashTopUpOut` (`request_type='disbursement'`, `status='Approved'`, `petty_cash_expense_id`) | BusinessWriter + company access | 403, 422 (insufficient unreserved balance or invalid fields) |
| `/api/v1/petty-cash/summaries` & `/summary` | GET | `company_id`/`company_name`, `start_date`, `end_date` | `PettyCashSummaryOut` including `balance` and `unreserved_balance` | BusinessReader + company access | 403, 404 |
| `/api/v1/petty-cash/ledger` | GET | `company_id`/`company_name`, `start_date`, `end_date` | `List[PettyCashLedgerEntry]` with `disbursement` rows (`amount_out` populated) and no duplicate `PC-DISB-` expense rows | BusinessReader + company access | 403, 404 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Record Disbursement | `unreserved_balance` check & UI available hint | Computed server side under wallet lock as `balance - sum(reserved_amount)` of active pending claims; returned in `PettyCashSummaryOut.unreserved_balance` |
| Record Disbursement | Linked `Expense` (`company_id`, `category_id`, `expense_date`, `amount`, `description`, `payment_method`, `reference_no`, `created_by`) | `company_id` from `resolve_company`; `category_id` looked up by `category` name in `category` table; `expense_date`, `amount`, `description` from request body; `payment_method = 'Petty Cash'`; `reference_no = 'PC-DISB-<topup_id>'`; `created_by` from `current_user.user_id` |
| Render Table `TYPE` badge | `"Reimburse"` · `"Disbursement"` · `"Top-up"` · `"Expense"` | Derived from `entry.requestType` (`reimbursement` / `replenishment` -> `Reimburse`; `disbursement` / `replenishment_disbursement` -> `Disbursement`; `topup` -> `Top-up`; `entry.type === 'expense'` -> `Expense`) |
| Render Funding Breakdown (Finance Review, Details, Row Hint) | `Total (E)`, `Petty Cash (C)`, `Out of Pocket (O)`, `Pre recorded #ID` | `petty_cash_topups.total_expenses`, `company_funded_amount`, `employee_out_of_pocket`, and `existing_expense_id` returned in `PettyCashLedgerEntry` |
| Optimize `list_ledger` / `get_balance` | Petty cash expense rows | Direct local SQLAlchemy query on `Expense` joined with `Category` (eliminating Supabase HTTP client calls) |
| Optimize WebSocket save flow | Coalesced single table/bell refresh off `onmessage` | `websocketService` defers listener dispatch via `setTimeout(..., 0)` / microtask and coalesces duplicate `PETTY_CASH_UPDATED` / `NOTIFICATION_RECEIVED` triggers |

**Key invariants**:
- `_build_summary` and `get_balance` count ONLY `request_type == 'topup'` (with `status == 'Approved'`) as `topped_up` inflows; `disbursement` rows MUST NEVER be added to `topped_up`.
- `_petty_cash_expenses` (used by `get_balance` and `_build_summary`) includes `PC-DISB-` and `PC-EXP-` `Expense` rows when computing `total_spent`, while `list_ledger` excludes `PC-DISB-` and `PC-EXP-` from its raw `expenses` loop because those rows are already represented cleanly by their `PettyCashTopUp` entries (preventing double rows or double balance deduction).
- Under `PettyCashWallet` row lock, `disbursement_amount <= get_unreserved_balance(company_id)` must hold before committing both rows in a single transaction (`self.db.flush()` on `PettyCashTopUp` -> create `Expense` with `linked_topup_id` -> set `petty_cash_expense_id` -> `self.db.commit()`).
- A WebSocket `onmessage` event handler must never perform synchronous heavy state transitions or duplicate HTTP reloads on the event callback stack; listeners are scheduled asynchronously and deduplicated across `onSuccess` and `PETTY_CASH_UPDATED`.

**Security model**:
- `POST /api/v1/petty-cash/disbursements` requires `require_business_writer` and enforces `check_company_access(current_user, company.company_id)` so Staff and Supervisors can only disburse from their assigned company's Petty Cash, while Finance/Admin can select any company. Auditor and Owner roles remain read only (`403`).
- `POST /api/v1/petty-cash/topups/{id}/endorse` remains strictly gated to `require_finance_user`.
- Receipt attachment validation continues to enforce strict MIME and safe URL checks (`_validate_receipt_or_data_url` / `_validate_attachments_json` from spec `0042`).

**Critical test scenarios**:
- Happy path (Disbursement): Recording a ₱500.00 Disbursement when unreserved balance is ₱2,000.00 creates a posted `disbursement` row (`Approved`) and an `Expense` row (`payment_method='Petty Cash'`, `reference_no='PC-DISB-...'`), immediately drops `balance` and `unreserved_balance` to ₱1,500.00, and renders `"Disbursement"` in the ledger without going to Finance, verifies **AC-1**, **AC-2**, **AC-3**, **AC-6**.
- Failure case (Insufficient unreserved float): When ledger balance is ₱2,000.00 but ₱1,600.00 is reserved by a pending Reimbursement, attempting a ₱500.00 Disbursement returns HTTP `422` (`Available unreserved balance: ₱400.00`) and creates neither `PettyCashTopUp` nor `Expense`, verifies **AC-2**, **AC-4**.
- Happy path (Reimbursement & Funding Breakdown): Submitting a mixed Reimbursement (`E=8000`, `C=5000`, `O=3000`) routes to `Pending Finance Endorsement`, displays the Funding Breakdown (`E`, `C`, `O`) in the Finance Endorsement modal, Details modal, and row hint, and labels the badge `"Reimburse"`, verifies **AC-4**, **AC-5**, **AC-6**.
- Performance & single refresh: `websocketService` dispatches `PETTY_CASH_UPDATED` asynchronously without blocking `onmessage`, `PettyCashPage` + `NotificationBell` coalesce rapid `PETTY_CASH_UPDATED` + `NOTIFICATION_RECEIVED` events into one fetch, and `_petty_cash_expenses` executes local SQL without calling `get_supabase_admin_client`, verifies **AC-7**.

## Build plan

*Build approach assumption: Tracer Bullet (no project wide approach was recorded in `AGENTS.md` or `docs/scope/scope.md`, so tasks are ordered as thin vertical end to end slices).*

1. **Slice 1 (Backend Disbursement flow, local SQL optimization, and unreserved balance)**: Add `PettyCashDisbursementCreate` schema and `unreserved_balance` on `PettyCashSummaryOut`; implement `PettyCashService.create_disbursement` and `POST /api/v1/petty-cash/disbursements` with wallet lock validation and atomic `PettyCashTopUp` + `Expense` creation; fix `_build_summary`, `get_balance`, `list_ledger`, and `_petty_cash_expenses` to use local SQL `Expense` queries and handle `disbursement` / `PC-DISB-` accurately without double counting, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-7**.
2. **Slice 2 (Frontend Disbursement vs Reimbursement entry and Funding Breakdown visibility)**: Update `pettyCashService.ts` (`createDisbursement`, `unreservedBalance` mapping); add distinct Disbursement vs Reimbursement option and mode handling in `PettyCashPage.tsx` and `ReimbursementModal.tsx` (hiding bank selection and out of pocket split in Disbursement mode, showing available unreserved balance); render the Funding Breakdown card inside `PettyCashPage.tsx`'s Finance Endorsement modal and a compact breakdown hint in the table row, satisfies **AC-1**, **AC-4**, **AC-5**.
3. **Slice 3 (Table Type labels, column width fix, and WebSocket message handler optimization)**: Rename table badges to `"Reimburse"` and `"Disbursement"`, update `TYPE` column width (`11%`) and Type filter dropdown labels (`All`, `Top-up`, `Disbursement`, `Reimburse`) in `PettyCashPage.tsx`; defer and coalesce WebSocket listener execution in `websocketService.ts`, `NotificationBell.tsx`, and `PettyCashPage.tsx`, and remove redundant `loadData()` when WebSocket refresh handles the post save update, satisfies **AC-6**, **AC-7**.
4. **Slice 4 (Automated tests and regression checks)**: Add pytest unit/integration coverage in `backend/tests/` for Disbursement immediate deduction, `Expense` creation, `unreserved_balance` lock rejection (`422`), mixed Reimbursement Funding Breakdown fields, and local SQL `_petty_cash_expenses`; verify frontend TypeScript build (`npm run build`) and Vitest/unit checks, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**.

## Consequences

**Positive**:
- Direct Petty Cash Disbursements immediately reflect in both Company Expenses and Petty Cash balance without Finance queue friction.
- Finance receives complete Funding Breakdown context right at the endorsement decision point instead of hunting through the Details modal.
- Table Type badges fit cleanly without overlapping Particulars, and saves complete rapidly without `202ms` `'message'` handler browser violations.

**Negative / tradeoffs**:
- `petty_cash_topups` now represents three distinct workflows (`topup`, `reimbursement`, `disbursement`), requiring disciplined `request_type` filtering across summary, movement, and ledger endpoints.
- Bypassing Supabase REST in `_petty_cash_expenses` assumes `Expense` writes from all modules persist to the primary SQLAlchemy database (`expenses` table), which holds for the current FastAPI backend.

**Neutral**:
- Existing `replenishment_disbursement` rows from mixed Reimbursements remain supported and display the `"Disbursement"` badge alongside new `disbursement` records.

## Follow-up

- [ ] Reconcile `docs/specs/0042-petty-cash-company-bank-scoping-and-optimization.md` uncommitted changes on `dev` before starting `/develop 0043` so both specs stay cleanly separated.
- [x] Verify whether `PC-EXP-` rows in `_petty_cash_expenses` (from settled pre-0043 mixed Reimbursements) also need the same `get_balance` inclusion rule as `PC-DISB-` during Slice 1 implementation.

## Revision Note (Immediate Disbursement Deduction, Blank Status & Audit Status Column)

- **Removed `Disbursement` creation UI**: Direct petty cash expenses are recorded through the Expenses module (`Payment Method = Petty Cash`) or inside `Request Reimbursement` (`Paid from company petty cash`). `PettyCashPage` `Request Petty Cash` now offers `Top-up Request` and `Request Reimbursement`, and `ReimbursementModal` no longer shows the `Disbursement | Reimbursement` tab switcher.
- **Immediate company float deduction**: Submitting `Request Reimbursement` with unrecorded `company_funded_amount > 0` deducts petty cash immediately by creating the `Expense` row (`PC-EXP-<id>`, `reserved_amount = 0.00`). Only `employee_out_of_pocket > 0` routes to `Pending Finance Endorsement` / `Pending Audit Approval` and triggers workflow notifications; `employee_out_of_pocket == 0` settles immediately (`status = 'Settled'`) without bank selection.
- **Blank `STATUS` & real `AUDIT STATUS` column**: `Disbursement` (`disbursement`, `replenishment_disbursement`) and `Expense` (`expense`) rows render blank workflow `STATUS` (`""`) and never appear under workflow status filters (`Pending Finance`, `Pending Audit`, `Approved`, `Rejected / Disapproved`). Their `AUDIT STATUS` reflects `Expense.audit_status` (`Pending Audit`, `Audited` [`Verified`], `Discrepancy` [`Flagged`]) persisted via `PATCH /api/v1/expenses/{expense_id}/audit`. `Top-up` and `Reimburse` rows show workflow-derived `AUDIT STATUS` (`blank` before Finance endorsement/on Finance rejection, `Pending Audit` during `Pending Audit Approval`, `Audited` once `Approved`/`Reimbursed`/`Settled`, `Discrepancy` on `Disapproved by Audit`).
