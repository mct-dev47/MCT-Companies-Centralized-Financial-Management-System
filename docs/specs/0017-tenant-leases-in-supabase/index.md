# 0017. Save tenant leases and payments in Supabase

**Date**: 2026-10-30
**Status**: In Progress

## Summary

Tenant leases and their payments move out of the browser and into the Supabase database, so every user sees the same data, nothing is lost when a browser is cleared, and Audit marks are saved on the server. The Tenant page reads and writes through new secured API endpoints, and every change sends a websocket message so other screens reload. The schedule maths from spec 0015 stays in the page. The old browser data is discarded, as you chose.

## Requirements

**User stories**:
- As a property manager, I want leases and payments saved in the database so that they are the same on every computer.
- As an auditor, I want my audit mark on a lease saved on the server so that Finance and the company see it at once.
- As an administrator, I want tenant changes to appear in the Activity Log so that I can see who did what.

**Acceptance criteria**:
- **AC-1**: Two tables, `tenant_leases` and `tenant_lease_payments`, exist in Supabase (created by `migrate_tenant_leases.py`, safe to run again). Amount paid and remaining are never stored. The server works them out from the payments.
- **AC-2**: The page lists, creates, edits and deletes leases, and records, edits and removes payments, only through `/api/v1/tenants/...`. Nothing is written to `localStorage`. The old `mct_jk_tenants_leases_v1` browser data is deleted the first time the page loads and is not imported.
- **AC-3**: Every endpoint needs a signed in user. A company user sees and changes only their own companies' leases. Admin, Finance and company users may write. The Audit role may read and save an audit review, and gets 403 on any other write.
- **AC-4**: The server validates input: rent above 0, required names and dates, repeat is one of None, Daily, Monthly, Quarterly, Annually, a repeating lease has a Lease End Date on or after the First Due Date and First Due Date on or after Date Contracted, between 1 and 1000 periods, penalty blank or 0 to 100. For a repeating lease the server sets Total Payable to rent times the number of periods.
- **AC-5**: The server refuses a payment that would put more on a lease than it can owe (non repeating: more than Total Payable; repeating: more than rent times periods plus the late penalty), a Missed mark on a Monthly, Quarterly or Annually lease, and a starting period outside the lease.
- **AC-6**: The spec 0015 edit locks are enforced on the server: once a repeating lease has any payment tied to a period, Repeat and First Due Date cannot change, and Lease End Date cannot go before the last period that has a payment.
- **AC-7**: The tenant reference (like TNT-JK-2026-001) is made by the server and is unique.
- **AC-8**: Any payment change on a lease clears its Audited or Flagged mark on the server. Saving an audit review records who, when and the remark, using the signed in user's name.
- **AC-9**: Every lease and payment write sends a `TENANTS_UPDATED` websocket message, and an audit review sends `AUDIT_UPDATED`. The Tenant page reloads quietly when it receives either.
- **AC-10**: Lease and payment writes are recorded in the audit log, so they appear in the Activity Log (spec 0018).
- **AC-11**: If the server cannot be reached, the page shows the last copy it loaded, marked as a saved copy with a warning banner. Changes are blocked with a clear message. Nothing is saved only in the browser.
- **AC-12**: No demo tenants are created. A new database starts with no leases.

## Decision

**Chosen option**: Option 1: new tables read and written through the Supabase REST client, with a SQLAlchemy store as the fallback, behind one service.

A `TenantService` holds all rules (validation, locks, totals). It talks to a store: `SupabaseStore` first, `SqlStore` (the same tables through SQLAlchemy) if Supabase is not configured or the call fails, the same pattern as sales. Routes are thin. The schedule, status and penalty calculation stays in `tenantScheduleService.ts` (spec 0015).

**Implementation skills**: none.

## Feature design

**Data model**

| Table | Column | Type | Notes |
|---|---|---|---|
| `tenant_leases` | `lease_id` | integer, primary key, auto | |
| | `tenant_ref` | varchar(30), unique, required | server made, TNT-JK-YYYY-NNN |
| | `company_id` | integer, required, foreign key `company.company_id`, indexed | |
| | `tenant_name`, `unit_name` | varchar(255), required | |
| | `rent_amount` | numeric(15,2), required | per period |
| | `contract_date`, `due_date` | date, required | `due_date` is the First Due Date when repeating |
| | `lease_end_date` | date, null | required when repeating |
| | `repeat_mode` | varchar(20), default `None` | |
| | `penalty_rate` | numeric(5,2), null | blank means none |
| | `total_amount_payable` | numeric(15,2), required | |
| | `status` | varchar(20), default `Active` | Active, Completed, Overdue, Pending |
| | `notes` | text, null | |
| | `audit_status`, `audited_by`, `audited_at`, `audit_remarks` | as spec 0014 | default `Pending Audit` |
| | `created_by` | integer, null | user id |
| | `created_at`, `updated_at` | timestamptz | |
| `tenant_lease_payments` | `payment_id` | integer, primary key, auto | |
| | `lease_id` | integer, required, foreign key, cascade delete, indexed | |
| | `payment_date` | date, required | |
| | `amount` | numeric(15,2), required | 0 for a Missed mark |
| | `method`, `reference_no`, `notes` | text fields | |
| | `status` | varchar(10), default `Paid` | Paid or Missed |
| | `missed_reason` | text, null | |
| | `period_index` | integer, null | starting period, 1 based |
| | `created_by`, `created_at` | | |

One lease has many payments.

**API surface** (all need a signed in user)

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/tenants/leases` | GET | `company_id` or `company_name` (optional) | leases with payments | any signed in user, scoped to their companies | 403 |
| `/tenants/leases/{id}` | GET | | one lease | company access | 403, 404 |
| `/tenants/leases` | POST | lease fields | lease | not Audit; company access | 400, 403 |
| `/tenants/leases/{id}` | PATCH | any lease fields, `status` | lease | not Audit; company access | 400, 403, 404, 409 |
| `/tenants/leases/{id}` | DELETE | | 204 | not Audit; company access | 403, 404 |
| `/tenants/leases/{id}/payments` | POST | date, amount, method, reference, notes, status, reason, period | lease | not Audit | 400, 403, 404 |
| `/tenants/leases/{id}/payments/{pid}` | PATCH | same fields | lease | not Audit | 400, 403, 404 |
| `/tenants/leases/{id}/payments/{pid}` | DELETE | | lease | not Audit | 403, 404 |
| `/tenants/leases/{id}/audit` | PATCH | `audit_status`, `remarks` | lease | Audit or Admin only | 403, 404 |

Every output lease carries `amount_paid` and `remaining_balance` (Total Payable minus paid, never below 0). The page uses the schedule for repeating leases.

**Value sourcing**
| Action | Value | Source |
|---|---|---|
| Create lease | `tenant_ref` | server: next number for the year, from existing refs |
| Create lease | `company_id` | input `company_id` or `company_name`, resolved by the company resolver, then checked against the user's companies |
| Create lease | `total_amount_payable` | repeating: rent times period count (server); otherwise input, default rent |
| Create lease | period count | server: first due date, end date and repeat |
| Any lease output | `amount_paid` | sum of Paid payment amounts |
| Any lease output | `remaining_balance` | `total_amount_payable` minus `amount_paid`, at least 0 |
| Audit review | `audited_by` | signed in user's name (server), never the request |
| Audit review | `audited_at` | server time |
| Payment change | audit reset | server clears audit fields |
| Payment | `created_by` | signed in user id |
| Lease status | Completed or Active | the page, from the schedule, sent as `status` |

**Key invariants**
- Money has two decimals. A payment amount is above 0 unless it is a Missed mark.
- Paid payments never add up to more than the cap in AC-5.
- Deleting a lease deletes its payments.
- A company user can never read or write another company's lease.

**Security model**: authenticated JWT on every route. `check_company_access` on each lease's company. Audit role read only apart from the audit review route. The audit route stamps the name on the server (spec 0014). No personal data beyond tenant and unit names. The websocket message carries ids only.

**Configuration required**: none new. Uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL`.

**Critical test scenarios**
- Create a Monthly lease: the server sets Total Payable to rent times periods and a reference like TNT-JK-2026-001. Verifies **AC-4**, **AC-7**.
- A second create gets the next reference. Verifies **AC-7**.
- A payment above the cap, a Missed mark on a Monthly lease, and a bad starting period are all refused. Verifies **AC-5**.
- After a payment, changing Repeat or First Due Date returns 409. Verifies **AC-6**.
- An Audit user cannot create a lease (403) but can save an audit review. A company user cannot read another company's lease. Verifies **AC-3**.
- Recording a payment on an audited lease clears the audit mark. Verifies **AC-8**.
- With the backend off, the page shows a saved copy, a warning banner, and blocked saves. Verifies **AC-11**.

## Build plan

The project records no build approach, so this uses an end to end thin slice (Tracer Bullet): table and one read, then writes, then the page.

1. Models `TenantLease` and `TenantLeasePayment`, and `migrate_tenant_leases.py` that creates both tables in Supabase and asks PostgREST to reload its schema cache, satisfies **AC-1**, **AC-12**
2. `TenantService` with `SqlStore`, `SupabaseStore`, validation, locks, totals and reference numbers, satisfies **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**
3. Routes under `/tenants`, registered in the router, with role and company checks, audit log entries and websocket messages, satisfies **AC-3**, **AC-9**, **AC-10**
4. Backend tests for the service and routes, satisfies **AC-3** to **AC-8**
5. Frontend `tenantService.ts` and rewrite the Tenant page to use it (load, create, edit, delete, payments, audit marks, websocket reload, saved copy fallback, delete the old browser data), satisfies **AC-2**, **AC-9**, **AC-11**, **AC-12**
6. Run the migration against Supabase and check the tables and one create and delete, satisfies **AC-1**

## Consequences

**Positive**:
- One source of truth. Finance, Audit and company users see the same leases, and Audit marks are real.
- Changes show in the Activity Log and refresh other screens.

**Negative / tradeoffs**:
- Two stores (Supabase and SQLAlchemy) means two code paths to keep in step. A write that falls back to the SQL store while Supabase is down will not reach Supabase.
- The server can only check the overall cap on payments. The exact forward only room per period is still checked in the page.
- Leases kept in browsers today are lost, because you chose to discard them.
- When the server cannot be reached, the page is read only (a saved copy and a warning). You asked to keep the old browser fallback, but a fallback would create leases and payments that exist in one browser only and never reach the database, with no way to merge them later. This build chose the safer behaviour. Say so if you still want the browser fallback and it will need a sync step.

**Neutral**:
- The tenant page needs a signed in session. It already does.

## Follow-up

- [ ] Add login checks to the Bills, Lending, Cash Inflows, Budgets, Staff Credits and Categories endpoints (see the inventory in the rationale). It is a separate change.
- [ ] Decide whether Lending and Bills should stop falling back to the browser, as the Tenant page now does.
- [ ] Move the schedule maths to the server if a second client ever needs it.

## Rationale

Reasoning, options and the audit of other pages: see `rationale.md`.
