# 0018. Dashboard and Activity Log use real database data

**Date**: 2026-10-30
**Status**: In Progress

## Summary

The Dashboard and the Activity Log now read only real data. The Activity Log shows the audit log rows kept in the database, with the user, company, a plain description and the record, instead of a fixed list. The Dashboard drops its hardcoded sample charts and fake in memory transactions and reloads by itself when other users change data. Its figures already came from real sales and expenses.

## Context

`ActivityLogPage` calls `employeeService.getActivityLogs`, which returns a hardcoded list. The backend already stores every important action in the `audit_logs` table (spec of `audit_service`) and has an admin only `GET /api/v1/audit-logs` that returns raw ids and codes (user id, company id, action code, JSON details).

`dashboardService` builds the Dashboard from real sales and expenses, but its data object still carries three hardcoded lists (weekly sales, expense breakdown, company income), a totals object the page does not use, about 600 lines of in memory sample transactions with fake audit updates, and a random sample generator. None of those are shown, but they are fake data inside the real service. The page also never reloads when other users change data.

`audit_service.log_action` uses `threading.Thread` for background writes but never imports `threading`, so login flows that log without a database session raise an error instead of logging.

## Requirements

**User stories**:
- As an administrator, I want the Activity Log to show what really happened, who did it and in which company.
- As any dashboard user, I want the numbers to be the database's numbers and to update when someone else changes data.

**Acceptance criteria**:
- **AC-1**: `GET /api/v1/audit-logs` also returns, for each row, the user's name, the company's name, a plain description of the action, the module, and the record reference, all worked out on the server. Existing fields and filters are unchanged, and it stays Admin only.
- **AC-2**: The Activity Log page loads from that endpoint (up to the 1000 newest rows, newest first). It shows company, action, module, target and time. A row with no company shows "System". Search and the date range filter work on the real rows. An empty database shows the empty state.
- **AC-3**: The Activity Log CSV and PDF exports use the real rows. The hardcoded list is deleted.
- **AC-4**: Tenant lease and payment changes, audit reviews of tenants, sales and expenses, and loan audit reviews each write an audit log row, so they appear in the Activity Log.
- **AC-5**: `audit_service` imports `threading`, so background logging works.
- **AC-6**: The Dashboard data object contains only real values. The hardcoded weekly sales, expense and company income lists, the unused totals object, the in memory sample transactions, the fake audit and category update functions, and `dashboardDummyData.ts` are removed.
- **AC-7**: The Dashboard reloads quietly when it receives `AUDIT_UPDATED`, `LOANS_UPDATED`, `PETTY_CASH_UPDATED`, `BANK_UPDATED` or `TENANTS_UPDATED`, clearing its 20 second cache first.
- **AC-8**: If reading the dashboard data fails, it shows an error message instead of zeros that look real. (The Sales and Expense services still fall back to a saved copy when the API is down instead of failing. That is a known gap, see Follow-up.)

## Decision

**Chosen option**: build the Activity Log rows on the server from `audit_logs`, and clean the Dashboard service in place.

The endpoint adds fields and the page maps them. Dashboard figures keep coming from `salesService` and `expenseService`, as now.

**Implementation skills**: none.

## Feature design

**Server fields added to each `AuditLogOut`**: `user_name`, `company_name`, `description`, `module`, `target`.

**Value sourcing**
| Value | Source |
|---|---|
| `user_name` | `users.name` for `user_id`, else the email in `details` if present, else "System" |
| `company_name` | `company.company_name` for `company_id`, else "System" |
| `description` | the action's text from `_ACTION_DESCRIPTION_MAP`, else the action code with underscores as spaces |
| `module` | by action prefix: SALE is Sales, EXPENSE is Expense, LOAN is Loan, PETTY_CASH is Petty Cash, TENANT is Tenant, USER is User, COMPANY is Company, LOGIN, LOGOUT, PASSWORD, SESSION and ACCOUNT are Auth, otherwise the category name in words |
| `target` | `details.record_id` with `details.record_type` if present, else the email in `details`, else "-" |
| page `time` | `created_at`, shown as `YYYY-MM-DD HH:mm` in the browser's time |

**Key invariants**: audit rows are only read here, never changed. The endpoint never returns a password, token or OTP, because `details` only ever holds ids, emails and reasons.

**Security model**: Admin only, unchanged. The Activity Log route stays under `AdminOnlyRoute`.

**Critical test scenarios**
- Create a tenant lease, then open the Activity Log: a "Tenant" row with the lease reference, the user and the company. Verifies **AC-1**, **AC-2**, **AC-4**.
- Empty `audit_logs`: empty state. Verifies **AC-2**.
- Log in with a fresh session: no `NameError`, a login row appears. Verifies **AC-5**.
- Change a loan as Audit in one browser: a Dashboard open in another browser reloads. Verifies **AC-7**.
- Stop the backend: the Dashboard shows an error. Verifies **AC-8**.

## Build plan

1. Add `import threading` to `audit_service.py`, and new tenant audit actions, satisfies **AC-4**, **AC-5**
2. Extend `GET /audit-logs` with the added fields and the lookups, satisfies **AC-1**
3. Write audit log rows from the tenant routes and the sales, expense and loan audit review routes, satisfies **AC-4**
4. Replace `employeeService.getActivityLogs` with the real call and delete the hardcoded list, satisfies **AC-2**, **AC-3**
5. Remove the fake data from `dashboardService.ts`, delete `dashboardDummyData.ts`, add the websocket reload and an error state, satisfies **AC-6**, **AC-7**, **AC-8**

## Consequences

**Positive**:
- The Activity Log is the real record. The Dashboard has no fake data left in it.

**Negative / tradeoffs**:
- The Activity Log only shows actions that already write audit rows. Bills, Lending and Budgets do not write them yet.
- Reading 1000 rows and looking up names on each call is fine today. A larger log would need paging in the page.

**Neutral**:
- The Dashboard's "Overdue / Due Soon" card still counts sales and expense records by their status and audit flag, as before. Whether it should count loans and bills instead is a business rule left for you to decide.

## Follow-up

- [ ] Decide what "Overdue / Due Soon" should count on the Dashboard (loans, bills, tenant payments).
- [ ] Add audit log rows to Bills, Lending and Budgets.
- [ ] Make the Sales and Expense services fail loudly instead of falling back to a saved copy, so the Dashboard error message (AC-8) also covers a down API.
- [ ] `audit_service` says logs are saved to Supabase as well as the local database, but it only writes through SQLAlchemy. That is the same Supabase Postgres when `DATABASE_URL` points at it, so nothing is lost today.
