# 0022. Fast Company Lookup, Bank Supervisor Loan Particulars, Multi Company Bank View, and Real Time Transaction Sync

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification speeds up company loading on the borrower loan page, preserves supervisor loan particulars in bank records, unlocks multi company views for Finance users in Bank Management, and connects live WebSocket updates to the transactions page. A lightweight company lookup endpoint stops the system from running heavy revenue calculations just to populate company selector dropdowns. When loans get approved, bank transaction descriptions now include the exact reason written by the supervisor. Finance users selecting All Companies can now inspect every bank account and all cash transactions together, and the cash ledger updates live without manual page refreshes.

## Context

Four operational and performance friction points currently affect daily accounting and loan oversight.

First, users opening `/loan/borrower` experience sluggish page loading when populating the borrower company and lender company selector menus. Investigation of the request waterfall revealed that `loanService.getCompanies()`, `loanService.getLoans()`, and `AddLoanModal.tsx` all invoke `GET /api/v1/companies`. In `company_service.py`, that endpoint calculates total revenue, total expenses, and net profit by aggregating every historical sale, expense, and cash inflow across the entire database for every company. Calculating comprehensive income statements just to show a list of company names causes noticeable latency and wastes server processing time.

Second, when a supervisor submits a borrower loan with a specific business purpose (such as kitchen equipment upgrades or bakery ingredients restock), that narrative is stored in the loan description. However, when the loan reaches approval in `backend/app/api/v1/endpoints/loans.py`, the system creates bank transactions with generic descriptions such as "Loan Disbursement to MCT Kitchen (Ref: LN-20261103-1001)". The supervisor's original business justification is dropped from the bank ledger, making audit reconciliation between the bank statement and the physical loan request difficult.

Third, in Bank Management, Finance officers need a high level view of all group liquidity across legal entities. However, `CompanyContext.tsx` restricts users with single company assignments even when their role is Finance, hiding other companies from dropdown options. Furthermore, when selecting All Companies in `BankManagementPage.tsx`, the interface only displays transactions for one arbitrarily chosen active account rather than aggregating all bank accounts and movements across the corporate group.

Fourth, while the Expense page now receives live WebSocket updates via spec 0021, `TransactionPage.tsx` does not listen to `EXPENSE_CREATED`, `EXPENSE_UPDATED`, `EXPENSE_DELETED`, `SALES_UPDATED`, or `BANK_UPDATED`. When colleagues record new sales, create expenses, or disburse bank transfers in other browser tabs or windows, the cash ledger remains out of date until the user presses a manual reload button or reloads the browser tab.

## Requirements

**User stories**:
- As a loan officer or supervisor on `/loan/borrower`, I want company dropdown options to populate instantly so that I can draft and submit loan requests without page hesitation.
- As an auditor or Finance manager reviewing corporate bank records, I want loan disbursement bank transactions to clearly state the supervisor's requested purpose so that I can verify the business legitimacy of each cash movement.
- As a Finance officer in Bank Management, I want to select All Companies to see all group bank accounts and an aggregated list of all transactions across all companies.
- As a Finance officer or Auditor viewing the Transactions page, I want the ledger to refresh automatically via WebSockets whenever sales, expenses, bank movements, loans, or petty cash top ups change.

**Acceptance criteria**:
- **AC-1**: The backend provides a fast lightweight lookup endpoint at `/api/v1/companies/lookup` returning only company IDs and company names without triggering financial revenue or profit aggregations.
- **AC-2**: The borrower loan page and loan creation modal query the lightweight lookup endpoint and leverage cached company lists from `CompanyContext`, loading company choices in under 100 milliseconds.
- **AC-3**: When a borrower loan is approved, the created bank withdrawal and deposit transactions include the supervisor's requested particulars formatted as `Loan: [supervisor particular] (to/from [company name])`.
- **AC-4**: In `CompanyContext.tsx`, users with the Finance role are recognized as multi company administrators, providing access to all dynamic companies regardless of profile assignment fields.
- **AC-5**: In `BankManagementPage.tsx`, selecting All Companies displays all registered corporate bank accounts and renders an aggregated transaction feed across all accounts, with the company name identified for each transaction row.
- **AC-6**: `TransactionPage.tsx` subscribes to `EXPENSE_CREATED`, `EXPENSE_UPDATED`, `EXPENSE_DELETED`, `SALES_UPDATED`, `BANK_UPDATED`, `LOANS_UPDATED`, `PETTY_CASH_UPDATED`, and `AUDIT_UPDATED` WebSocket events.
- **AC-7**: Receiving any transaction related WebSocket event silently invalidates cached client records and reloads the unified transaction ledger within 300 milliseconds without triggering a full page reload or flashing loading skeletons.

## Options considered

### Option 1: Lightweight lookup endpoint, enriched loan bank particulars, unified multi company bank ledger, and comprehensive WebSocket event wiring (Recommended)

Add a dedicated `/api/v1/companies/lookup` endpoint that queries only `company_id` and `company_name` directly from the database table. Update `loanService.ts` and `AddLoanModal.tsx` to read from this endpoint and reuse `CompanyContext`. Modify `loans.py` approval logic so the bank request description prefixes the supervisor's original particulars. Adjust `CompanyContext.tsx` to ensure Finance users never get single company scoped, and adapt `BankManagementPage.tsx` to aggregate transactions across all accounts when All Companies is chosen. Finally, add the missing WebSocket event listeners to `TransactionPage.tsx`.

**Pros**:
- Solves the slow company loading issue at the database layer without computing complex financial metrics.
- Preserves full audit trail traceability by carrying supervisor loan particulars straight into bank statements.
- Gives Finance officers true cross company financial visibility without switching accounts one by one.
- Guarantees immediate multi tab and multi user consistency across the entire cash ledger.

**Cons**:
- Touches both backend endpoints and multiple frontend page components.

### Option 2: Frontend client side caching only with in place polling fallback

Retain the existing `/api/v1/companies` endpoint but cache its heavy response indefinitely in frontend local storage, keep existing bank description strings, and use 5 second client polling on `TransactionPage.tsx` instead of WebSockets.

**Pros**:
- Requires fewer modifications to backend routing.

**Cons**:
- First page load remains slow whenever local storage expires or clears.
- Fails to solve the audit traceability gap for loan particulars in bank records.
- Continuous polling introduces unnecessary network chatter and server load.

## Decision

**Chosen option**: Option 1: Lightweight lookup endpoint, enriched loan bank particulars, unified multi company bank ledger, and comprehensive WebSocket event wiring

Implement a fast company lookup endpoint, enrich loan disbursement bank particulars with the supervisor request narrative, enable full group visibility for Finance in Bank Management, and wire all core transaction signals into the transactions page.

**Implementation skills**: `develop` (.agents/skills/develop/)

## Rationale

Calculating full historical sales, expenses, and net margins for every company just to display an HTML select dropdown is an architectural mismatch. A lightweight lookup endpoint querying two columns (`company_id` and `company_name`) resolves in single digit milliseconds. Carrying the supervisor's requested loan particulars into bank transaction records solves a recurring operational friction where finance staff had to open separate tabs to cross check why money moved. Allowing Finance users to see all companies and an aggregated transaction ledger in Bank Management matches the centralized treasury design of the platform. Adding the missing WebSocket event listeners to `TransactionPage.tsx` completes the real time synchronization loop started in spec 0021.

## Feature design

**Data model sketch**:
No new database tables or columns are required. All necessary fields (`description`, `particulars`, `company_id`, `company_name`) already exist in the PostgreSQL schema.

**State transitions**:
- Loan approval to bank creation:
  1. Supervisor creates loan with `particulars = "Kitchen Renovation"` and `amount = 50000.00`.
  2. Finance endorses and Auditor approves loan request.
  3. Backend creates lender bank withdrawal: `particulars = "Loan: Kitchen Renovation (to MCT Kitchen)"`.
  4. Backend creates borrower bank deposit: `particulars = "Loan: Kitchen Renovation (from Corporate Treasury)"`.
  5. Backend broadcasts `BANK_UPDATED` and `LOANS_UPDATED` over WebSockets.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/companies/lookup | GET | none | list of `{ company_id, company_name }` | Authenticated | 401 |
| /api/v1/loans/{id}/audit-review | POST | action, remark | updated loan item | Auditor, Admin | 400, 403, 404 |
| /api/v1/bank-accounts | GET | `company_name` (optional) | list of bank accounts with transactions | Finance, Admin, Supervisor | 401, 403 |
| /ws | GET (WebSocket) | token | streaming event messages | Authenticated | 4001, 4003 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Company lookup dropdown | List of company names and IDs | `/api/v1/companies/lookup` table query |
| Bank disbursement description | `Loan: [particular] (to [company])` | Loan `description` or `particulars` submitted by supervisor |
| Bank proceeds description | `Loan: [particular] (from [company])` | Loan `description` or `particulars` submitted by supervisor |
| Aggregated bank transactions | Combined transaction list | Merge of all `account.transactions` across `accounts` list |
| Live ledger synchronization | Updated transactions list | WebSocket event triggers `fetchAllTransactions` silently |

**Key invariants**:
- The `/api/v1/companies/lookup` endpoint must never execute financial summary calculations or aggregate sales and expenses.
- Bank transactions created from loan approvals must always reflect the supervisor's original particulars prefixed with `Loan: `.
- Users with the Finance or Admin role must never be restricted to a single company scope in Bank Management.
- Transactions page live updates must debounce rapid bursts of WebSocket events into a single ledger fetch.

**Security model**:
- `/api/v1/companies/lookup` requires a valid authenticated user session token.
- Supervisors remain strictly locked to their single assigned company in Bank Management and Loan creation.
- Finance and Admin users can access all companies and aggregate group views.

**Critical test scenarios**:
- Happy path: Opening `/loan/borrower` loads borrower and lender company options in under 100 milliseconds, verifies **AC-1**, **AC-2**.
- Loan approval bank sync: Approving a loan creates withdrawal and deposit bank records displaying `Loan: [supervisor particular]`, verifies **AC-3**.
- Multi company bank view: Selecting All Companies as Finance lists all accounts and combines their transactions into one view, verifies **AC-4**, **AC-5**.
- Real time transaction update: Creating an expense or sale in another window immediately updates the cash ledger on `TransactionPage.tsx`, verifies **AC-6**, **AC-7**.

## Build plan

1. [x] Create the lightweight `/api/v1/companies/lookup` endpoint in `backend/app/api/v1/endpoints/companies.py` and service method in `company_service.py`, satisfies **AC-1**.
2. [x] Update `frontend/src/services/loanService.ts` and `frontend/src/components/dashboard/AddLoanModal.tsx` to use the lookup endpoint and `CompanyContext` cache, satisfies **AC-2**.
3. [x] Update loan approval logic in `backend/app/api/v1/endpoints/loans.py` to format bank transaction particulars with the supervisor loan narrative, satisfies **AC-3**.
4. [x] Adjust `CompanyContext.tsx` so Finance users are not locked to a single company when an assigned company string exists, satisfies **AC-4**.
5. [x] Update `BankManagementPage.tsx` to show all accounts and aggregate transactions across all accounts when All Companies is selected, satisfies **AC-5**.
6. [x] Wire WebSocket subscriptions for `EXPENSE_CREATED`, `EXPENSE_UPDATED`, `EXPENSE_DELETED`, `SALES_UPDATED`, and `BANK_UPDATED` into `TransactionPage.tsx`, satisfies **AC-6**, **AC-7**.

## Consequences

**Positive**:
- Near instantaneous company dropdown loading on `/loan/borrower` and throughout transaction modals.
- Enhanced financial clarity and auditability because bank records explain the real operational purpose of each loan.
- Comprehensive treasury visibility for Finance managers without tedious account toggling.
- Reliable real time synchronization across expenses, sales, bank entries, and the central transaction ledger.

**Negative / tradeoffs**:
- Merging transactions from all bank accounts when All Companies is selected requires client side sorting of transactions by date.

**Neutral**:
- No database migrations or schema alterations are needed.

## Follow-up

- [ ] Consider pointing `/api/v1/companies/authorized` to use the same lightweight query path when financial totals are not displayed.

## Migration plan

**Strategy**: Strangler pattern with zero downtime rollout
**Phases**:
1. Deploy the new `/api/v1/companies/lookup` backend endpoint alongside existing company endpoints.
2. Update frontend components and loan approval logic to use the new endpoint and enriched particulars format.
3. Validate multi account aggregation and WebSocket signal reception in browser sessions.
**Rollback**: Revert to querying `/api/v1/companies` and previous static bank particular formats with a single commit.
**Risks**: Ensure sorting logic for aggregated bank transactions handles missing date formats cleanly.
