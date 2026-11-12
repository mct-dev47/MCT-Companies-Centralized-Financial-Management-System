# 0038. Offline Transaction Queue for Sales and Expenses

**Date**: 2026-11-10
**Status**: In Progress

## Summary

When the internet drops, sales and expense entries you save are kept on your device instead of being lost. They wait in an "outbox" (a list stored in the browser's own built in database, called IndexedDB, which works with no internet and has nothing to do with Supabase). When the internet comes back, the app sends them to the server automatically. You can see, edit, pause, or delete waiting entries before they are sent, and every entry carries a unique ID so a retry can never create a duplicate.

## Context

Every sale and expense row is sent to the server the moment you press Save. If the connection is down, the request fails with "server unreachable" and the row only survives while the form is still on screen. Typing more than a few entries during an outage means retyping them later, or losing them if you navigate away or reload.

Retrying is also unsafe today. If a request reaches the server but the reply is lost on the way back, sending it again creates a second sale or expense. Only petty cash accepts an `Idempotency-Key` header, and it only logs it.

Sessions work against offline use too. The access token lives only in memory, lasts 5 minutes, and is refreshed through a cookie. Offline, the refresh fails and the 30 minute idle timeout can end the session. Anything waiting to sync must therefore survive a logout, a reload, and a new login.

## Requirements

**User stories**:
- As a staff member with a bad connection, I want my sales and expense entries kept when the internet drops, so that I never have to retype them.
- As a staff member, I want to see what is still waiting, and edit, pause, or delete it before it is sent, so that I stay in control of what reaches the books.
- As finance, I want retries to never create duplicates, so that the books stay correct.

**Acceptance criteria**:
- **AC-1**: `POST /api/v1/sales` and `POST /api/v1/expenses` accept an optional `client_ref` (string, up to 64 characters). Sending the same `client_ref` twice creates one record. The second call returns the existing record with HTTP 200 instead of 201.
- **AC-2**: `POST /api/v1/receivables` accepts the same optional `client_ref` with the same "create once, return existing" behaviour.
- **AC-3**: A `client_ref` that belongs to a company the caller cannot access is never returned. The caller gets the normal 403 instead.
- **AC-4**: Calls without `client_ref` behave exactly as before.
- **AC-5**: On the Add Transaction sheet, when the device is offline or a save fails with a network error, each new sale or expense row is stored in the outbox instead of failing. The success banner says how many were saved offline.
- **AC-6**: A save rejected by the server with a validation error (4xx other than 401) is never queued. It is shown as an error, as it is today.
- **AC-7**: Entries in the outbox survive leaving the page, clicking Back, reloading, closing the tab, and logging out and in again with the same account.
- **AC-8**: When the device is online, the app sends waiting entries automatically: on the `online` event, on app start, after login, and every 30 seconds while entries are waiting. It needs no particular page open.
- **AC-9**: An unpaid sale's receivable waits for its sale. The receivable is sent only after its sale syncs, using the new sale ID.
- **AC-10**: Sync results: success removes the entry. A network error keeps it waiting and retries with backoff. A 401 pauses syncing until the user logs in again. Any other 4xx marks the entry "Needs attention" with the server's message.
- **AC-11**: A header indicator shows "Offline" when there is no connection and "N waiting to sync" when entries are waiting. Clicking it opens the outbox panel.
- **AC-12**: In the outbox panel you can delete one entry, edit one entry's date, amount, particulars, and remarks, pause and resume all syncing, retry a "Needs attention" entry, and clear all entries after a confirmation.
- **AC-13**: Logging out while entries are waiting shows a warning. Logging out never deletes outbox entries.
- **AC-14**: Leaving the Add Transaction sheet with filled rows that were not saved shows a "You have unsaved rows" warning.
- **AC-15**: A network failure during a token refresh does not log the user out by itself.
- **AC-16**: Outbox entries belong to the user who created them. Another account logged in on the same browser does not see or send them.

## Options considered

### Option 1: Outbox in IndexedDB plus `client_ref` on create endpoints

A small hand written wrapper around the browser's IndexedDB stores waiting entries per user. A sync loop sends them through the existing services. The backend dedupes by a unique `client_ref` column.

**Pros**:
- Survives reloads and logouts, holds much more than localStorage, does not block the page.
- No new dependency. Reuses the existing `salesService` and `expenseService` calls.
- `client_ref` also fixes double clicks and flaky connections for everyone.

**Cons**:
- Waiting entries are not in server totals until they sync.
- Data is stored unencrypted on the device.

### Option 2: localStorage queue

Same flow, stored in localStorage.

**Pros**:
- Simplest API.

**Cons**:
- About 5MB limit, blocks the page on every read and write, and the auth code already clears keys from it on load.

### Option 3: Service worker with Background Sync

A service worker intercepts failed POSTs and replays them.

**Pros**:
- Can sync after the tab closes (Chrome only).

**Cons**:
- Background Sync is not supported in Firefox or Safari. The worker has no access to the in memory access token, so replay would fail auth. Hard to give users edit, pause, and delete controls.

## Decision

**Chosen option**: Option 1: Outbox in IndexedDB plus `client_ref` on create endpoints.

## Rationale

The real need is "never lose what I typed, never double record it". IndexedDB is the only browser storage that is durable, roomy, and untouched by the existing auth cleanup. Replaying through the existing services from the page keeps auth simple (the in memory token is right there) and keeps every business rule on the server. The `client_ref` dedupe is what makes automatic retry safe, so it ships first.

## Feature design

**Data model sketch**:
- `sales.client_ref VARCHAR(64) NULL`, unique index `ux_sales_client_ref`.
- `expenses.client_ref VARCHAR(64) NULL`, unique index `ux_expenses_client_ref`.
- `receivables.client_ref VARCHAR(64) NULL`, unique index `ux_receivables_client_ref`.
- Unique indexes allow many NULLs in both Postgres and SQLite, so old rows are unaffected.
- Browser: IndexedDB database `mct_offline`, version 1, object store `outbox` (key `id`), index `by_user` on `userId`.

Outbox entry:
```
{
  id: string            // uuid, also sent as client_ref
  userId: number
  company: string
  kind: 'sale' | 'expense' | 'receivable'
  input: object         // the exact input the service create call takes
  dependsOn?: string    // receivable: the id of its sale entry
  status: 'waiting' | 'sending' | 'needs_attention'
  attempts: number
  nextAttemptAt: number // epoch ms, backoff
  lastError?: string
  createdAt: number
}
```
Pause state is stored per user in the same database (store `meta`).

**State transitions**:
`waiting → sending → (removed)` on success.
`sending → waiting` on network error (attempts + 1, backoff 5s, 15s, 60s, then every 5 minutes).
`sending → waiting (paused)` on 401.
`sending → needs_attention` on other 4xx.
`needs_attention → waiting` when the user edits or presses Retry.
A receivable whose `dependsOn` sale entry is `needs_attention` or deleted becomes `needs_attention` with "Its sale was not saved".
Entries left in `sending` when the page closes go back to `waiting` on next start (safe because of `client_ref`).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/sales | POST | existing fields, `client_ref?: str(64)` | SaleOut, 201 new or 200 existing | bearer, business writer | 403, 422 |
| /api/v1/expenses | POST | existing fields, `client_ref?: str(64)` | ExpenseOut, 201 new or 200 existing | bearer, business writer | 403, 422 |
| /api/v1/receivables | POST | existing fields, `client_ref?: str(64)` | ReceivableOut, 201 new or 200 existing | bearer, business writer | 403, 422 |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Queue a row | `id` / `client_ref` | `crypto.randomUUID()` when the row is saved |
| Queue a row | `userId` | the logged in user from `authService` |
| Queue a row | `input` | the same object the sheet passes to `addSale` / `addExpense` today |
| Sync a receivable | `sale_id` | the ID returned when its `dependsOn` sale entry synced |
| Header indicator | online state | `navigator.onLine` plus the last sync result |
| Duplicate call | returned record | the row already holding that `client_ref` |

**Key invariants**:
- A `client_ref` maps to at most one row per table (DB unique index).
- An entry is removed from the outbox only after the server confirms it.
- The access token is never written to IndexedDB.
- A receivable is never sent before its sale.

**Security model**:
- `client_ref` lookups run the same `check_company_access` as a normal create. A matching row in another company returns 403.
- Outbox entries are scoped by `userId`. Only that user's session sends them.
- Entries are plaintext on the device. On shared computers, users should sync before leaving. Encryption is a follow up.

**Critical test scenarios**:
- Happy path: post a sale with a `client_ref`, post it again, one row exists and the second call returns 200 with the same ID, verifies **AC-1**
- Expense and receivable duplicate posts, verifies **AC-1**, **AC-2**
- A `client_ref` from company A sent by a user of company B gets 403, verifies **AC-3**
- Posting without `client_ref` still returns 201 each time, verifies **AC-4**
- Offline save of 6 rows, navigate away, reload, go online, all 6 appear once, verifies **AC-5**, **AC-7**, **AC-8**
- Unpaid sale queued with receivable, receivable is sent with the synced sale ID, verifies **AC-9**
- Server returns 422 during sync, entry shows "Needs attention", edit and retry succeeds, verifies **AC-10**, **AC-12**

## Build plan

1. Migration `0052_client_ref_idempotency` adding `client_ref` and unique indexes on `sales`, `expenses`, `receivables`, registered for Postgres and SQLite, satisfies **AC-1**, **AC-2**
2. Add `client_ref` to the ORM models and the create schemas, satisfies **AC-1**, **AC-2**, **AC-4**
3. Create once logic in the sales, expenses, and receivables create paths, with company access check on a match, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**
4. Backend tests for duplicates, cross company, and no ref, satisfies **AC-1** to **AC-4**
5. `src/services/offlineQueue.ts`: IndexedDB store, enqueue, list, update, delete, clear, pause, subscribe, satisfies **AC-7**, **AC-16**
6. `clientRef` passthrough in `salesService.addSale`, `expenseService.addExpense`, `receivablesService.createReceivable`, satisfies **AC-1**, **AC-2**
7. Sync loop (`src/services/offlineSync.ts`) with triggers, backoff, dependency handling, and result handling, started once from the app root, satisfies **AC-8**, **AC-9**, **AC-10**
8. Add Transaction sheet: queue on offline or network error, offline count in the success banner, unsaved rows warning, satisfies **AC-5**, **AC-6**, **AC-14**
9. Header indicator and outbox panel with delete, edit, pause, resume, retry, clear all, satisfies **AC-11**, **AC-12**
10. Logout warning and refresh failure handling in `authService`, satisfies **AC-13**, **AC-15**

## Consequences

- Dashboards, KPIs, and bank balances do not include waiting entries until they sync.
- Only new sales, expenses, and unpaid sale receivables work offline. Edits and deletes still need internet.
- Waiting entries are stored unencrypted on the device.
- The app must already be open when the internet drops. Opening the app with no internet needs follow up 1.
- Day remarks typed while offline are not queued yet (they fail quietly, as before). See follow up 5.
- Editing an existing record while offline still fails with "can't reach the server", as before.

## Follow up

1. Make the app open offline (`vite-plugin-pwa` for the app shell, cached dropdown data for companies, categories, particulars, bank accounts, and payment methods).
2. Show waiting entries in the Sales and Expense records with a "Not synced" tag.
3. Encrypt outbox entries with a per session key.
4. Offline edits and deletes, with conflict handling.
5. Queue day remarks the same way (the endpoint is a PUT, so it is already safe to resend).

## Build notes (2026-11-10)

- Build plan tasks 1 to 10 are implemented. Live browser verification is still owed (log in, switch DevTools Network to Offline, save rows, go back online).
- Backend: `backend/tests/test_spec_0038_client_ref_idempotency.py` (6 tests) covers **AC-1** to **AC-4**.
- Frontend: the outbox and sync logic was exercised with a throwaway harness (mocked services, fake IndexedDB), 20 checks covering **AC-7** to **AC-10**, **AC-12**, **AC-16**. There is no frontend test runner in the repo yet, so it is not committed.
- If the ORM database and the Supabase REST project are different databases, run `backend/migrations/0052_client_ref_idempotency.postgres.sql` on Supabase by hand. Until then the backend skips `client_ref` on the Supabase insert (no dedupe there, nothing breaks).

## References

- [0037](0037-sales-expense-add-and-records-refinements.md): current Add Transaction sheet behaviour
- [0027](0027-unpaid-expense-sales-receivables-lifecycle.md): unpaid sale receivable lifecycle
