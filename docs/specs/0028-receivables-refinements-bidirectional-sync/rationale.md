# 0028. Rationale: Refine Unpaid Sales Assignment, Receivables Controls, and Bidirectional Sync

## Context

> ⚠️ Premise note: You initially asked to synchronize receivables and sales using webhooks (HTTP callbacks sent over the network between servers). Because both `sales` and `receivables` live inside the same FastAPI backend and share the same Supabase and SQLite persistence layer, routing HTTP webhooks back into the same server adds network latency, retry failure modes, and secret rotation work for no gain. Running an internal backend sync hook inside the service layer paired with the existing `ws_manager` WebSocket broadcaster achieves instant automatic updates across both tables and all open browser tabs with zero external infrastructure.

Spec `0027-unpaid-expense-sales-receivables-lifecycle.md` introduced database tables and initial screens for food receivables, yet four practical gaps surfaced during real usage. First, the unpaid assignment step on `/sales/add` renders `Customer Type` as a free text input and includes a `Contact / Role` column that slows down encoding and stores unnecessary personal metadata (`customer_phone` and `customer_role`).

Second, `/receivables` and its backend `PUT` and `DELETE` routes restrict editing and deleting strictly to the `Finance` role (`userRole === 'finance'`). Branch `Company` and `Supervisor` users who encode `/sales` for their assigned company cannot fix clerical mistakes or remove erroneous receivables on `/receivables`, and the edit modal on the main table only updates debtor profile text rather than order items, amounts, or payment status.

Third, recording a payment or updating a receivable in `ReceivablesService` updates only the `receivables` table and broadcasts `RECEIVABLES_UPDATED`. It never updates the linked `sales` row in Supabase (`client.table("sales")`), never flips the line tag in `sales.particulars` from `[Unpaid]` to `[Pending]` or `[Paid]`, and never emits `SALES_UPDATED`. On the frontend, `SalesPage.tsx` listens only to `AUDIT_UPDATED`, leaving the Sales Record view and **Total Cash** KPI stale until a manual reload or manual edit. Conversely, editing or deleting a sale on `/sales` does not reconcile its linked receivables, and neither side enforces a mutual read only lock once an auditor marks the sale `Verified`.

## Options considered

### Option 1: In Place Enhancement with Internal Domain Sync Service and WebSocket Push

Add a shared `SalesReceivablesSyncService` inside FastAPI invoked directly by `ReceivablesService` and `sales.py` mutations, mirror updates to both Supabase and local SQLite, add `sale_line_index` while dropping `customer_phone` and `customer_role`, widen `/receivables` write guards to `BusinessWriter` with company scope checks, and push `SALES_UPDATED` plus `RECEIVABLES_UPDATED` over the existing `ws_manager`.

**Pros**:
- Zero network hop or webhook delivery lag; `sales` and `receivables` update together in one request cycle.
- Reuses existing `BusinessWriter`, `check_company_access`, `BankService`, and `ws_manager` conventions already proven across the codebase.
- Easy to guard against infinite sync loops using an explicit `skip_counterpart_sync` parameter in Python.

**Cons**:
- Couples `sales` and `receivables` write paths inside the backend service layer, requiring careful transaction and Supabase error handling so partial failures do not leave one table out of date.

### Option 2: Signed Loopback HTTP Webhook Endpoint (`/api/v1/webhooks/receivables-sync`)

Have `ReceivablesService` and `sales.py` emit HMAC signed (cryptographically verified) HTTP `POST` requests to an internal FastAPI webhook endpoint that updates the counterpart record and broadcasts WebSocket events.

**Pros**:
- Provides an external HTTP entry point if third party POS systems ever need to push settlement events later.

**Cons**:
- Self calling HTTP requests inside a single Uvicorn worker pool can deadlock under load, require webhook secret configuration, and turn simple synchronous database updates into eventual consistency bugs.

### Option 3: Supabase Database Trigger Webhooks

Configure PostgreSQL row triggers on `public.receivables` and `public.sales` in Supabase `pg_net` to call FastAPI whenever a row changes, then broadcast over WebSocket.

**Pros**:
- Captures direct SQL edits made inside the Supabase dashboard outside the FastAPI app.

**Cons**:
- Breaks local SQLite fallback parity, hides critical accounting logic (particulars line parsing and bank deposit reversals) inside database triggers and webhook handlers, and makes loop prevention brittle across two tables that update each other.

## Rationale

Both `sales` and `receivables` belong to the same bounded financial ledger in a monolith FastAPI backend with dual Supabase and SQLite persistence. Earlier synchronization failed not because of missing external infrastructure, but because `ReceivablesService` wrote only to local SQLite `Sale` amounts while `sales.py` read from Supabase `sales.particulars`, and `SalesPage.tsx` never subscribed to `RECEIVABLES_UPDATED` or `SALES_UPDATED`. Centralizing bidirectional reconciliation in one Python sync helper solves both storage targets cleanly and keeps cash ledger math auditable in one place.

Aligning `/receivables` edit and delete permissions with `BusinessWriter` (`Finance` across all companies, plus `Company` and `Supervisor` scoped to their assigned company) fixes the mismatch where a branch encoder could create and edit a sale on `/sales` yet was locked out of fixing the resulting receivable on `/receivables`. Pairing that wider write access with the `Verified` audit lock protects finalized accounting periods from accidental edits on either screen.

## References

None (references not requested).

