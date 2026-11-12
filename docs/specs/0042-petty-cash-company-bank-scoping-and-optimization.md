# 0042. Petty Cash Company Bank Scoping, Lazy Receipt Loading, and Eligible Expense Picker

**Date**: 2026-11-12
**Status**: In Progress

## Summary

This enhancement restricts Petty Cash funding and endorsement bank selection strictly to bank accounts owned by the requesting company across both the web interface and the backend service, superseding the cross company affiliate funding workflow from spec `0038` for all new requests. It also eliminates multi megabyte receipt image data from ledger list responses by loading attachments on demand when viewing details, and replaces the manual numeric expense ID input with a searchable company scoped expense picker. Together these changes prevent accidental cross company bank selection, stop duplicate or mistyped expense links, and keep ledger loading fast as transaction history grows.

## Context

In the current Petty Cash module, spec `0038` introduced cross company affiliate funding (allowing Finance to pick another company's bank and choose between direct payout or transfer first methods). In daily operations, however, selecting another company's bank account during top ups, reimbursement submission, or Finance endorsement creates reconciliation confusion and unintended intercompany liabilities. Users need strict isolation so every company funds and reimburses Petty Cash exclusively through its own registered bank accounts, while existing historical intercompany transfer records remain settleable without disrupting historical accounting.

At the same time, Petty Cash workflows suffer from two major usability and performance bottlenecks in the live FastAPI and React codebase. First, receipt uploads from `/api/v1/petty-cash/receipts` are encoded as base64 data URIs (inline text encoded files) and stored directly in text columns. When `GET /api/v1/petty-cash/ledger` returns full history for all companies, every ledger row embeds those multi megabyte base64 strings inline even when the table only renders summary rows, alongside an extra per row bank query (`N+1` lookup pattern) inside `PettyCashService.list_ledger`. Second, linking a pre recorded Petty Cash expense in `ReimbursementModal` currently forces staff and Finance to type a raw numeric `existing_expense_id` from memory, causing lookup friction and preventable errors.

## Requirements

**User stories**:
- As a Finance officer, I want bank dropdowns and backend validation in Petty Cash to permit only bank accounts belonging to the requesting company so that funds are never disbursed from an unrelated company's bank.
- As a Supervisor or Finance reviewer, I want the Petty Cash ledger table to load rapidly without downloading megabytes of embedded receipt images up front so that switching companies and filtering records feels instantaneous.
- As a requester filing a reimbursement for a previously recorded Petty Cash expense, I want a searchable dropdown of eligible unclaimed Petty Cash expenses for that company so that I do not have to look up and type a raw expense ID.

**Acceptance criteria**:
- **AC-1**: `PettyCashService.create_topup` and `PettyCashService.endorse_topup` validate that any supplied `bank_account_id` belongs to the requesting company (`_is_bank_owned_by_company`), rejecting cross company bank selections with HTTP `422` (`"Funding bank account must belong to the requesting company."`), and all Finance UI selectors (`ReimbursementModal`, `TopUpPettyCashModal`, and `PettyCashPage` endorsement modal) list only own company banks with the affiliate funding method panel removed.
- **AC-2**: Historical `IntercompanyTransfer` records created before this change remain readable in the ledger and completable via existing transfer confirmation, cancellation, reversal, and repayment settlement endpoints without data migration errors or broken foreign keys.
- **AC-3**: `GET /api/v1/petty-cash/ledger` omits heavy receipt payloads (`receipt_url` and `attachments` returned as `null`) and instead includes `has_receipt` (boolean) and `attachment_count` (integer), while eliminating per row `BankAccount` queries in `PettyCashService.list_ledger` via batch dictionary lookup and eager relationship loading.
- **AC-4**: A dedicated endpoint `GET /api/v1/petty-cash/topups/{topup_id}/receipts` returns `{ topup_id, receipt_url, attachments }` for authorized viewers when opening a ledger entry's Details modal (cached client side per `topup_id` once fetched), enforces company scoping for restricted roles (HTTP `403` across companies, HTTP `404` for missing records), and displays loading, empty, and retry states in `PettyCashPage`.
- **AC-5**: `GET /api/v1/petty-cash/eligible-expenses` returns unclaimed expenses for the requested company where `payment_method` is `Petty Cash`, `linked_topup_id IS NULL`, and no active `PettyCashTopUp` claims `existing_expense_id`, supporting optional substring search (`q`) over `particulars`, `category`, and `reference_no`, while enforcing company scoping (`403` across companies for scoped roles).
- **AC-6**: `ReimbursementModal` replaces the manual numeric Expense ID text input with a searchable dropdown populated from `/api/v1/petty-cash/eligible-expenses`, auto filling `companyFundedAmount` with the chosen expense's amount and handling concurrent claim conflicts cleanly (`422` message plus refreshing the dropdown list).
- **AC-7**: Submission schemas (`PettyCashTopUpCreate` and `PettyCashTopUpUpdate`) validate both safe HTTPS/relative URLs and strict image/PDF base64 data URIs (`png`, `jpeg`, `jpg`, `webp`, `gif`, `pdf`) while rejecting dangerous `data:text/html`, `data:image/svg+xml`, or metadata SSRF URLs with HTTP `422`, and `create_topup` derives `receipt_url` from `attachments[0]` when omitted so HTTP clients do not duplicate large base64 bodies twice.

## Options considered

### Option 1: Strangler enhancement in place (backend own bank enforcement, lean ledger with lazy receipt endpoint, SQL filtered eligible expense picker)
Keep the existing relational schema (`petty_cash_topups`, `intercompany_transfers`, `expenses`) intact for zero downtime compatibility with historical records, enforce strict own company bank validation on new `create_topup` and `endorse_topup` calls, add two focused read endpoints (`/topups/{id}/receipts` and `/eligible-expenses`), and optimize `list_ledger` in place by stripping receipt blobs and replacing per row DB queries with batch lookups.

**Pros**:
- Zero destructive database migrations and full preservation of in flight or unsettled historical intercompany transfers.
- Immediately removes multi megabyte base64 bloat from `/ledger` responses and eliminates `N+1` queries with minimal blast radius.
- Uses existing React modal state and FastAPI service patterns, keeping delivery self contained and easy to verify.

**Cons**:
- Unused legacy columns (`payment_method_option`, `destination_bank_id`) remain nullable on `petty_cash_topups` for historical rows until a later cleanup.
- Existing Spec `0038` unit tests for new cross company creation flows must be updated to assert `422` rejection (while seeding historical records directly for settlement tests).

### Option 2: External object storage migration (S3 / Supabase Storage buckets) for all receipt uploads
Rewrite `/api/v1/petty-cash/receipts` to upload binaries to an external storage bucket, store signed or public object URLs in `receipt_url`, and run a backfill migration converting all legacy base64 rows in production PostgreSQL.

**Pros**:
- Shrinks PostgreSQL table storage for attachments over the long term and offloads file delivery to CDN signed URLs.

**Cons**:
- Requires new bucket provisioning, CORS/ACL configuration, signed URL expiry handling, and a multi phase production backfill script for legacy rows.
- Introduces external storage failure modes and operational setup beyond the scope of an immediate Petty Cash enhancement.

### Option 3: Frontend only bank filtering plus full client side ledger caching
Keep backend validation accepting cross company banks, cache full base64 ledger payloads aggressively in browser storage, and fetch all company expenses on page load to filter client side.

**Pros**:
- Requires fewer backend route additions.

**Cons**:
- Direct API callers or stale clients can still create unintended cross company obligations that conflict with company accounting rules.
- Initial ledger fetch and browser memory still suffer under large receipt payloads and growing company expense tables.

## Decision

**Chosen option**: Option 1: Strangler enhancement in place (backend own bank enforcement, lean ledger with lazy receipt endpoint, SQL filtered eligible expense picker).

This path enforces strict company isolation at both UI and API boundaries, eliminates ledger payload bloat without introducing new storage infrastructure, and preserves historical `IntercompanyTransfer` auditability.

## Rationale

The project already runs a clean FastAPI service layer (`PettyCashService`) backed by PostgreSQL/Supabase and SQLAlchemy models with `Text` storage for receipts and foreign key links to `expenses` and `intercompany_transfers`. Choosing an in place strangler enhancement satisfies all operational goals directly: backend validation prevents API bypasses of the company bank rule while keeping legacy rows settleable; lazy loading receipts by `topup_id` removes the dominant network and serialization cost from `/ledger` without risking broken legacy attachments during a storage migration; and a dedicated `/eligible-expenses` query leverages the existing partial unique index on `petty_cash_topups(existing_expense_id)` without shipping full expense history to the client. Option 2 remains a clean future follow up if attachment storage volume later warrants bucket offloading, whereas Option 3 leaves authorization gaps and fails to solve large list payloads.

## Feature design

**Data model sketch**:
- No schema migration is required for this enhancement. Existing columns remain:
  - `petty_cash_topups`: `bank_account_id` (String, FK/ref to `bank_accounts.id`), `receipt_url` (Text, nullable), `attachments` (Text JSON array, nullable), `existing_expense_id` (Integer, nullable, partial unique index for active claims), `payment_method_option` (nullable legacy), `destination_bank_id` (nullable legacy), `intercompany_transfer_id` (nullable FK -> `intercompany_transfers.transfer_id`).
  - `expenses`: `expense_id` (PK), `company_id` (FK), `payment_method` (String), `amount` (Numeric 12,2), `linked_topup_id` (nullable FK -> `petty_cash_topups.topup_id`).
- Schema output additions in `PettyCashLedgerOut`: `has_receipt: bool = False` and `attachment_count: int = 0` (`receipt_url` and `attachments` returned as `None` on ledger list rows).

**State transitions**:
- Top up & reimbursement request lifecycle unchanged (`Pending Finance Endorsement` / `Pending Finance Approval` -> `Pending Audit Approval` -> `Approved` / `Settled` / `Reimbursed` / `Rejected`), except new requests can no longer enter `Transfer In Transit` or `Return Pending`.
- Legacy existing `IntercompanyTransfer` rows retain existing transitions (`IN_TRANSIT` -> `RECEIVED` / `RETURN_PENDING` -> `RETURNED`, `UNSETTLED` -> `SETTLED`).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/petty-cash/topups` | POST | `PettyCashTopUpCreate` (own `bank_account_id`, validated receipts) | `PettyCashTopUpOut` | Bearer (`supervisor`, `finance`, `admin`, `owner`) | `403`, `422` cross company bank or bad receipt URL |
| `/api/v1/petty-cash/topups/{topup_id}/endorse` | POST | `PettyCashEndorseIn` (`action`, `remark`, `bank_account_id`) | `PettyCashTopUpOut` | Bearer (`finance`, `admin`, `owner`) | `403`, `404`, `422` cross company bank |
| `/api/v1/petty-cash/ledger` | GET | `company_name`, `start_date`, `end_date` | `List[PettyCashLedgerOut]` (lean, with `has_receipt`, `attachment_count`) | Bearer (`audit`, `finance`, `owner`, scoped `supervisor`) | `403` |
| `/api/v1/petty-cash/topups/{topup_id}/receipts` | GET | `topup_id: int` | `{ topup_id, receipt_url, attachments }` | Bearer (same company scope as ledger) | `403`, `404` |
| `/api/v1/petty-cash/eligible-expenses` | GET | `company_name`, optional `q`, `limit` (1 to 100) | `List[EligibleExpenseOut]` (`expense_id`, `expense_date`, `particulars`, `category`, `amount`, `reference_no`) | Bearer (company scoped for restricted roles) | `403`, `404`, `422` |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Submit reimbursement / endorse topup | Allowed funding banks | `GET /api/v1/bank-accounts` filtered on frontend & verified on backend via `PettyCashService._is_bank_owned_by_company` |
| View ledger table row | Receipt indicator (`has_receipt`, `attachment_count`) | Computed in `PettyCashService.list_ledger` from non empty `t.receipt_url` and parsed JSON length of `t.attachments` without sending file payload bytes |
| View ledger table row | `destination_bank_name` (historical legacy rows) | Resolved from preloaded `banks_by_id` dictionary in `PettyCashService.list_ledger` (replacing per row SQL query) |
| Open Details modal | Receipt preview URL and attachment list | Lazy fetched once per entry from `GET /api/v1/petty-cash/topups/{topup_id}/receipts` when `has_receipt === true` |
| Pick pre recorded expense | Searchable dropdown options & auto filled `companyFundedAmount` | `GET /api/v1/petty-cash/eligible-expenses` (`expenses.amount`, `expenses.expense_id`) for selected `requestingCompany` |
| Submit with receipt upload | `topup.receipt_url` & `topup.attachments` | `attachments` JSON array sent once in request; backend derives `receipt_url` from `attachments[0].file_url` when `receipt_url` is omitted |

**Key invariants**:
- Every newly created or Finance endorsed `PettyCashTopUp` with a non null `bank_account_id` must satisfy `_is_bank_owned_by_company(bank, company_id, company_name)`.
- `GET /petty-cash/ledger` never serializes inline `data:` base64 payloads across list rows.
- An `Expense` listed by `/eligible-expenses` has `linked_topup_id IS NULL` and no active `PettyCashTopUp` referencing its `expense_id`, backed by atomic lock verification in `create_topup`.
- Only validated safe HTTPS/relative URLs or strict raster/PDF base64 data URIs (`png`, `jpeg`, `jpg`, `webp`, `gif`, `pdf`) may be stored in `receipt_url` or `attachments`.

**Security model**:
- Role and company scoping match existing Petty Cash access rules: company scoped users (`supervisor`, `employee`) attempting to call `/topups/{id}/receipts` or `/eligible-expenses` for a different company receive HTTP `403`.
- Cross site scripting via uploaded receipts is prevented by rejecting `data:text/html`, `data:image/svg+xml`, `javascript:`, and private network/metadata SSRF hosts in `_validate_receipt_or_data_url` and `_validate_attachments_json`.

**Critical test scenarios**:
- Happy path: Finance submits or endorses a reimbursement choosing the requesting company's own bank, uploads PNG/PDF base64 receipts, links an expense chosen from `/eligible-expenses`, and lazily loads the receipt via `/topups/{id}/receipts`; verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**.
- Failure case (cross company bank): Finance or API caller submits `POST /topups` or `POST /topups/{id}/endorse` with another company's `bank_account_id` and receives HTTP `422` without modifying bank or wallet state; verifies **AC-1**.
- Historical compatibility case: Seeding an in flight `IntercompanyTransfer` row under a legacy `PettyCashTopUp` still permits `confirm_transfer` and `settle_intercompany_transfer` cleanly while showing status in `/ledger`; verifies **AC-2**.
- Failure case (unsafe receipt & N+1 regression): Submitting `data:text/html` or `data:image/svg+xml` fails `422`; listing 25 ledger entries executes bounded constant query count without emitting per row `BankAccount` queries or returning base64 bytes; verifies **AC-3**, **AC-7**.
- Auth/permission case: A company scoped user requesting `/topups/{other_company_id}/receipts` or `/eligible-expenses?company_name=OtherCo` receives HTTP `403`; verifies **AC-4**, **AC-5**.
- Concurrency/conflict case: Two requests claiming the same pre recorded `existing_expense_id` result in one success and one HTTP `422`, and subsequent `/eligible-expenses` calls exclude the claimed expense; verifies **AC-5**, **AC-6**.

## Build plan

1. Enforce strict own company bank ownership validation (`422`) in `PettyCashService.create_topup` and `PettyCashService.endorse_topup` and remove new request affiliate Method A / Method B routing while keeping legacy `IntercompanyTransfer` completion/settlement endpoints functional, satisfies **AC-1**, **AC-2**.
2. Update Spec `0038` test fixtures/assertions in `backend/tests/test_petty_cash_excess_reimbursements.py` and `test_petty_cash_finance_fixes.py` so new cross company submissions expect `422` and legacy settlement tests seed historical records directly, satisfies **AC-1**, **AC-2**.
3. Optimize `PettyCashService.list_ledger` and `PettyCashLedgerOut` (`backend/app/schemas/petty_cash.py`, `petty_cash_service.py`) to batch load `banks_by_id` and `intercompany_transfer`, omit full `receipt_url` / `attachments` blobs from list rows, and compute `has_receipt` and `attachment_count`, satisfies **AC-3**.
4. Implement `GET /api/v1/petty-cash/topups/{topup_id}/receipts` and update `PettyCashPage.tsx` (`pettyCashService.ts`) to lazy fetch receipts on Details modal open with loading, retry, and client cache support, satisfies **AC-4**, **AC-7**.
5. Implement `GET /api/v1/petty-cash/eligible-expenses` with company scoping and search filter `q`, plus replace the raw `existing_expense_id` numeric input in `ReimbursementModal.tsx` with a searchable expense dropdown that auto populates `companyFundedAmount` and refreshes on conflict, satisfies **AC-5**, **AC-6**.
6. Add comprehensive backend pytest and frontend verification covering cross company `422` rejection, `403` scoping on new endpoints, lean ledger payload verification, receipt scheme security, and eligible expense exclusion, satisfies **AC-1** through **AC-7**.

## Migration plan

**Strategy**: Strangler in place (no destructive database migration required).
**Phases**:
1. Deploy UI company bank filtering, Affiliate Funding Method UI removal, `"Request Reimbursement"` copy updates, and base64 receipt schema fixes cleanly first (reversible independently, compatible with existing backend and historical rows).
2. Add lean ledger fields (`has_receipt`, `attachment_count`), `/topups/{id}/receipts`, and `/eligible-expenses` backend endpoints alongside `list_ledger` N+1 cleanup, followed by frontend lazy receipt fetching and searchable expense dropdown cutover, then enable backend `422` cross company bank rejection on `create_topup` and `endorse_topup`.
**Rollback**: Reverting the application commit restores previous endpoints and UI behavior immediately with zero schema rollback needed, since no database columns are dropped or altered.
**Risks**: Any automated caller or bookmark relying on `POST /topups` with an affiliate `bank_account_id` or expecting `receipt_url` populated inside `/ledger` list items would fail after Phase 2; mitigate by updating all frontend callers and test suites in the same release.

## Consequences

**Positive**:
- Eliminates accidental cross company bank payouts and removes complex Method A / Method B selection from everyday Petty Cash workflows.
- Reduces `/api/v1/petty-cash/ledger` payload size from multi megabytes of base64 blobs down to kilobytes of structured metadata while eliminating per row bank queries.
- Prevents human error when linking pre recorded Petty Cash expenses through a company scoped searchable picker.

**Negative / tradeoffs**:
- Viewing an attached receipt in the Details modal requires one lightweight follow up network request (`GET /topups/{id}/receipts`) on first open for that row.
- Cross company Petty Cash funding is no longer initiated inside the Petty Cash flow; genuine intercompany fund movements must be recorded explicitly through bank transfers outside Petty Cash.

**Neutral**:
- Legacy columns (`payment_method_option`, `destination_bank_id`) and historical `IntercompanyTransfer` records stay in the database schema for audit history and ongoing repayment settlement of prior transactions.

## Follow-up

- [ ] Add a `Superseded partially by 0042` cross reference header on `docs/specs/0038-petty-cash-excess-reimbursements.md` once Spec `0042` is accepted.
- [ ] Run `/develop` to implement Build Plan tasks 1 through 6 (backend own company enforcement, `/topups/{id}/receipts`, `list_ledger` optimization, and `/eligible-expenses` picker).
- [ ] Evaluate moving binary receipt storage from base64 `Text` columns to object storage buckets if database attachment volume grows significantly.

