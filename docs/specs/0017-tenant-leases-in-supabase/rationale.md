# 0017. Rationale: Save tenant leases and payments in Supabase

## Context

Tenant leases and payments lived only in the browser (`localStorage`, key `mct_jk_tenants_leases_v1`). The backend has no tenant model, route or table. That means other computers and other roles cannot see them, clearing site data deletes them, and Audit marks on tenants are not real. The Transaction, Sales and Expense pages already save to Supabase, and audit marks for sales and expenses were moved to the server by spec 0014.

Stack: FastAPI with SQLAlchemy on the Supabase Postgres connection, the Supabase REST client for reads and writes on sales and expenses, tables created from models plus a `migrate_*.py` script, and a websocket channel (`ws_manager`) that screens subscribe to.

## Options considered

### Option 1: New tables through the Supabase REST client, with a SQLAlchemy fallback (chosen)
Same pattern as sales. Pros: matches how sales and expenses work, and the fallback keeps local development working without Supabase. Cons: two stores to keep consistent.

### Option 2: SQLAlchemy only
The `DATABASE_URL` already points at Supabase Postgres, so this would also land in Supabase. Pros: one code path, real transactions for a lease and its payments. Cons: not the REST pattern you chose.

### Option 3: Keep it in the browser and add sync later
Pros: no backend work. Cons: it does not solve the problem.

## Rationale

You chose the REST client so tenants behave like sales. A thin store interface keeps the rules in one `TenantService`, so the two stores only differ in how they read and write rows. The schedule maths stays in the page because spec 0015 already defines and tests it there, and Audit marks follow spec 0014. Totals are not stored, so a payment edit can never leave a stale total.

## Audit of other pages: what is not connected to the database (2026-10-30)

| Page or feature | What it does | Gap | Action |
|---|---|---|---|
| Tenants | `localStorage` only | no database | fixed by this spec |
| Lending | page starts from `localStorage`, saves edits and audit marks there; backend routes exist and are not called with a login token | mostly browser data; routes need no login | follow up |
| Bills | backend plus `localStorage` fallback; audit marks in `localStorage`; routes need no login | silent local only records; unprotected API | follow up |
| Expenses, Loans | backend plus a `localStorage` copy used when the API fails | silent local only records | follow up |
| Dashboard | visible figures come from real sales and expenses; the data object also carried hardcoded weekly sales, expense and company income lists and a large in memory transaction list with fake audit updates | dead fake data | fixed by spec 0018 |
| Activity Log | returned a hardcoded list; `/audit-logs` exists and was unused | no real data | fixed by spec 0018 |
| Budgets, Staff Credits, Cash Inflows | backend routes with no login and no page | unused, unprotected | follow up |
| Audit logging | `audit_service.log_action` uses `threading` without importing it, so background logging for login flows fails | bug | fixed by spec 0018 |

The routes without login checks (bills, lending, cash inflows, budgets, staff credits, categories) are the most serious finding, because anyone who can reach the API can read and change that data.

## References

None (references not requested).
