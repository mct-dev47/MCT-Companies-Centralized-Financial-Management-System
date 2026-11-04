# 0027. Unpaid Expense and Food Sales Receivables Lifecycle with Real Time Synchronization

**Date**: 2026-11-03
**Status**: Complete

## Summary

This specification defines the complete end to end lifecycle for unpaid food expenses, sales receivables, and utang management across MCT companies. When users record expenses with an unpaid status, the system routes those unpaid entries to the sales sheet to classify debtors as either internal staff or external customers. All receivables and payment remittances now persist in dedicated backend database tables with real time WebSocket broadcasts, cash ledger integration, and finance only editing and deletion controls.

## Context

MCT Kitchen Corporation and its sister hospitality entities regularly incur expenses and provide food to both internal staff members and external clients on credit. In the current application, receivables (food utang) were tracked only in browser local storage via mock records. This meant that debtor balances, payment remittances, and ledger logs did not synchronize across users, devices, or browser tabs.

Additionally, when cashiers or branch accountants entered meal expenses with an unpaid status on the expense sheet, there was no bridge to capture those unpaid line items as collectible accounts receivable on the sales side. The system treated food credit loosely, creating discrepancies between total sales volume, accrued expenses, and actual cash on hand.

A durable, centralized solution is required to replace browser storage with database persistence, connect unpaid expenses into sales receivables, enforce strict role controls (limiting edit and delete powers strictly to the Finance role), and keep all client screens synchronized via real time WebSockets.

## Requirements

**User stories**:
- As a branch cashier or accountant, I want unpaid meal expense line items to automatically transfer to the sales assignment workflow, so that I can classify them as internal staff credit or external customer debt without re-typing line item amounts.
- As a company manager, I want unpaid sales and receivables to appear in Total Sales while contributing zero to Total Cash, so that I have an accurate picture of earned revenue versus realized cash on hand.
- As a finance officer, I want to record partial or full debt payments with tender and bank selection, so that remittances immediately lower debtor balances and update company cash deposits.
- As a finance officer, I want dedicated edit and delete controls on debtor accounts and individual food orders, so that clerical mistakes can be corrected with bidirectional synchronization to source records.
- As an auditor or viewer, I want read only visibility into debtor ledgers and real time updates whenever payments or adjustments occur across any terminal.

**Acceptance criteria**:
- **AC-1**: When saving an expense on `/expense/add` where one or more line items have a status of `Unpaid` or `Pending`, the system redirects the user to `/sales/add`, prefilling the unpaid items into the unpaid assignment step.
- **AC-2**: The unpaid assignment interface on `/sales/add` requires specifying whether each debtor is `Internal` (Staff members eligible for payroll deduction) or `External` (outside diners or patrons), along with customer name and department or contact details.
- **AC-3**: On `/sales`, unpaid and pending transactions contribute to the **Total Sales** KPI card but contribute zero to the **Total Cash (Collected)** KPI card until a verified payment remittance occurs.
- **AC-4**: Receivables and payment records are persisted in dedicated backend database tables (`receivables` and `receivable_payments`) in Supabase with local SQLite fallback, fully replacing client browser local storage.
- **AC-5**: The backend provides REST API endpoints under `/api/v1/receivables` supporting list filtering by company, customer type, payment status, and date range, plus detail retrieval, creation, modification, and deletion.
- **AC-6**: When a payment remittance is recorded on `/receivables`, the user can select payment methods (Cash on Hand, GCash, Bank Transfer, or Payroll Deduction) and an optional target bank account, incrementing company cash collections.
- **AC-7**: Deleting or editing a receivable entry bidirectionally updates the linked source sale or expense record, adjusting line item particulars and gross totals to preserve bookkeeping integrity.
- **AC-8**: Modifying debtor details, editing order amounts, and deleting receivables or payment logs are restricted strictly to users with the `Finance` role; users with `Audit` role receive read only access.
- **AC-9**: Payment amounts are validated against remaining debt; payments exceeding outstanding balances are rejected with clear error feedback.
- **AC-10**: Every creation, update, deletion, and payment settlement triggers a backend `RECEIVABLES_UPDATED` WebSocket broadcast, enabling instant zero latency updates across all open browser tabs and summary KPI cards.

## Options considered

### Option 1: Dedicated Backend Tables with Bidirectional Source Sync and WebSocket Broadcast (Chosen)

Create first class database models (`receivables` and `receivable_payments`) with REST endpoints in FastAPI, Supabase storage with SQLite fallback, and a `RECEIVABLES_UPDATED` WebSocket event. Transfer unpaid items from `/expense/add` to `/sales/add` during form submission.

**Pros**:
- Persistent, auditable, multi user financial records accessible from any workstation.
- Clean separation between food receivables and general lending or cash transactions.
- Instant synchronization across all tabs and devices through existing WebSocket infrastructure.
- Precise role enforcement where only Finance can edit or delete.

**Cons**:
- Requires creating two database tables, schema models, and corresponding backend service layers.

### Option 2: Overload Sales Table with Customer Metadata Columns

Store all receivables directly within the existing `sales` table by adding columns for customer type, debtor name, contact details, and payment balances, without separate receivable tables.

**Pros**:
- Avoids creating a new top level entity.

**Cons**:
- Pollutes the primary sales transaction ledger with multi payment installment history and staff payroll tracking.
- Makes debtor ledgers and aging reports complex to query and slow to aggregate.

### Option 3: Retain Local Storage Store with Periodic Manual Export

Continue using the in memory and browser local storage store in `receivablesStore.ts` and add import or export capabilities.

**Pros**:
- Fast to prototype with no database migrations.

**Cons**:
- Complete failure of multi user consistency; payments recorded on one computer are invisible to others.
- High risk of permanent data loss if browser cache is cleared.

## Decision

**Chosen option**: Option 1: Dedicated Backend Tables with Bidirectional Source Sync and WebSocket Broadcast.

All food receivables and payment remittances will be stored in dedicated backend tables with full REST endpoints, bidirectional synchronization to originating sales and expense sheets, real time WebSocket broadcasts, and role restrictions limiting edits and deletions strictly to Finance users.

## Rationale

Food credit and staff meals constitute a regular revenue and cost stream for MCT companies, especially MCT Kitchen Corporation. Storing these entries in browser local storage was a temporary stopgap that created risk of data loss and prevented company wide financial reconciliation.

Creating dedicated database tables gives receivables the same first class architectural treatment as loans, bank accounts, and tenant leases. Routing unpaid expenses into the sales unpaid assignment workflow ensures that staff meal allowances and customer tabs are properly categorized as accounts receivable. Restricting modification and deletion privileges exclusively to the Finance role prevents unauthorized tampering while preserving read access for Auditors and branch cashiers.

## Feature design

### Data model sketch

```text
Table: receivables
-------------------------------------------------------------------------------------
receivable_id      BigInteger      Primary Key, Autoincrement
company_id         Integer         Foreign Key -> company.company_id, Indexed, Non Null
company_name       String(255)     Indexed, Non Null
customer_name      String(255)     Indexed, Non Null
customer_type      String(50)      Non Null ('Internal' or 'External')
customer_phone     String(50)      Nullable
customer_role      String(100)     Nullable (Department or Staff Title)
sale_id            Integer         Nullable, Foreign Key -> sales.sales_id
expense_id         Integer         Nullable, Foreign Key -> expenses.expense_id
transaction_date   Date            Non Null
items_summary      Text            Non Null
total_amount       Numeric(15, 2)  Non Null
amount_paid        Numeric(15, 2)  Non Null, Default 0.00
balance            Numeric(15, 2)  Non Null (total_amount - amount_paid)
payment_status     String(50)      Non Null, Default 'Unpaid' ('Unpaid', 'Partial', 'Paid')
notes              Text            Nullable
created_at         DateTime        Server Default Now
updated_at         DateTime        Server Default Now, On Update Now

Table: receivable_payments
-------------------------------------------------------------------------------------
payment_id         BigInteger      Primary Key, Autoincrement
receivable_id      BigInteger      Foreign Key -> receivables.receivable_id (CASCADE), Indexed
payment_date       Date            Non Null
amount             Numeric(15, 2)  Non Null
payment_method     String(50)      Non Null ('Cash', 'GCash', 'Bank Transfer', 'Payroll Deduction')
bank_account_id    BigInteger      Nullable, Foreign Key -> bank_accounts.id
reference_no       String(100)     Nullable
notes              Text            Nullable
received_by        String(100)     Nullable (User Name or ID)
created_at         DateTime        Server Default Now
```

### State transitions

```text
[ Unpaid Order ] 
       │
       ├──> Partial Payment Recorded ───> [ Partial ] (Balance > 0)
       │                                     │
       │                                     └──> Balance Paid in Full ───> [ Paid ] (Balance = 0)
       │
       └──> Full Settlement Recorded ────────────────────────────────────> [ Paid ] (Balance = 0)
```

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/receivables` | `GET` | `company_id`, `customer_type`, `status`, `start_date`, `end_date`, `search` | `List[ReceivableOut]` | Authenticated Reader | 401, 403 |
| `/api/v1/receivables/summary` | `GET` | `company_id`, `company_name` | `ReceivablesKPIsOut` | Authenticated Reader | 401, 403 |
| `/api/v1/receivables` | `POST` | `company_id`, `customer_name`, `customer_type`, `total_amount`, `items_summary`, `date` | `ReceivableOut` | Business Writer | 400, 401, 422 |
| `/api/v1/receivables/{id}` | `GET` | `id` | `ReceivableDetailOut` (includes payments) | Authenticated Reader | 401, 404 |
| `/api/v1/receivables/{id}` | `PUT` | `id`, `customer_name`, `customer_type`, `items_summary`, `total_amount`, `notes` | `ReceivableOut` | Finance Only | 401, 403, 404 |
| `/api/v1/receivables/{id}` | `DELETE` | `id` | `{ "detail": "Receivable deleted" }` | Finance Only | 401, 403, 404 |
| `/api/v1/receivables/{id}/payments` | `POST` | `id`, `amount`, `payment_date`, `payment_method`, `bank_account_id`, `notes` | `ReceivablePaymentOut` | Business Writer | 400, 404, 422 |
| `/api/v1/receivables/payments/{payment_id}` | `DELETE` | `payment_id` | `{ "detail": "Payment reversed" }` | Finance Only | 401, 403, 404 |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Transfer unpaid expense | Pre filled particulars, quantity, price, and total | Row data from `/expense/add` calculated rows with status `Unpaid` |
| Assign debtor type | `customer_type` (`Internal` or `External`) | Selected by user in `/sales/add` assignment table |
| Calculate Total Sales KPI | Total accrued sales volume | Sum of all sales deposits including unpaid receivables |
| Calculate Total Cash KPI | Realized cash inflow | Sum of sales marked `Paid` plus verified receivable payments |
| Calculate balance | Outstanding debtor debt | `total_amount - amount_paid` computed automatically |
| Compute debtor aging | Days overdue and aging bucket (`0-7`, `8-30`, `30+`) | Difference between today and `transaction_date` on unpaid balances |
| Record payment | Realized cash addition to company bank account | `bank_service.record_deposit_by_account_id` when `bank_account_id` provided |
| Reconcile deletion | Removal or adjustment of source line item | Source `sale_id` or `expense_id` lookup and itemized row removal |

### Key invariants

- `amount_paid` must always be between `0.00` and `total_amount`.
- `balance` must always strictly equal `total_amount - amount_paid`.
- When `balance == 0.00`, `payment_status` must automatically transition to `Paid`.
- When `0.00 < balance < total_amount`, `payment_status` must transition to `Partial`.
- When `balance == total_amount`, `payment_status` must be `Unpaid`.
- Only users with role `Finance` may execute `PUT` or `DELETE` requests on receivables and payment records.
- Deleting a receivable with existing payments cascade deletes or reverses associated payment entries with an audit log entry.

### Security model

- Reading receivables (`GET`) is permitted for authenticated users with reader permissions within their assigned company scope. Finance and Audit roles have cross company read access.
- Creating receivables and recording payments (`POST`) is permitted for branch cashiers, supervisors, and Finance writers.
- Modifying customer profiles, altering transaction amounts, and deleting records (`PUT`, `DELETE`) is restricted exclusively to the `Finance` role.
- Audit role accounts have read only access and cannot create, modify, or delete receivables.

### Critical test scenarios

- **Happy path: Unpaid expense transfer to sales and receivables**: Create an expense with two paid items and one unpaid meal item on `/expense/add`. Submitting transfers the unpaid item to `/sales/add`. User assigns it as `Internal (Staff)` to Maria Santos. The record appears on `/receivables` with status `Unpaid`, verified by **AC-1**, **AC-2**, **AC-4**.
- **Happy path: Partial and full payment remittance**: Record a partial payment of 500 PHP on a 1450 PHP tab. Outstanding balance updates to 950 PHP with status `Partial`. Record a second payment of 950 PHP with GCash. Status transitions to `Paid` with 0.00 balance, verified by **AC-6**, **AC-9**.
- **Happy path: Total Sales vs Total Cash verification**: Confirm that the 1450 PHP unpaid tab increases Total Sales by 1450 PHP but leaves Total Cash unchanged. Once 500 PHP is remitted, Total Cash increases by exactly 500 PHP, verified by **AC-3**.
- **Security test: Finance only edit and delete enforcement**: Attempt to edit or delete a receivable as an Audit or branch cashier user; verify the request returns HTTP 403 Forbidden. Perform the same action as a Finance user; verify HTTP 200 Success and bidirectional source update, verified by **AC-7**, **AC-8**.
- **Failure test: Payment amount exceeds balance**: Attempt to record a 1000 PHP payment against a 600 PHP balance; verify the server rejects the request with HTTP 400 and an explanatory validation error, verified by **AC-9**.
- **Real time test: WebSocket multi tab synchronization**: Open two browser windows on `/receivables`. Record a payment in window A; verify window B updates balances and KPI counters within 300ms without manual page refresh, verified by **AC-10**.

## Build plan

- [x] 1. Create backend SQLAlchemy database models `Receivable` and `ReceivablePayment` in `backend/app/models/receivable.py`, satisfies **AC-4**.
- [x] 2. Create Pydantic validation schemas in `backend/app/schemas/receivable.py` for create, update, payment, and summary responses, satisfies **AC-4**, **AC-5**.
- [x] 3. Implement `ReceivablesService` in `backend/app/services/receivables_service.py` with balance calculation, payment settlement, bank deposit integration, and bidirectional source reconciliation, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-9**.
- [x] 4. Implement REST API endpoints in `backend/app/api/v1/endpoints/receivables.py` with strict role guards restricting edit and delete to Finance, satisfies **AC-5**, **AC-8**.
- [x] 5. Register the receivables router in `backend/app/api/v1/router.py` and add `RECEIVABLES_UPDATED` WebSocket event broadcast on all mutations, satisfies **AC-5**, **AC-10**.
- [x] 6. Update `frontend/src/services/websocketService.ts` to recognize `RECEIVABLES_UPDATED` and register event handlers, satisfies **AC-10**.
- [x] 7. Create frontend `receivablesService.ts` API client to replace local storage calls with real backend HTTP endpoints and optimistic caching, satisfies **AC-4**, **AC-5**.
- [x] 8. Update `frontend/src/pages/AddTransactionSheetPage.tsx` so that saving an expense with unpaid line items carries those rows directly to `/sales/add` into the unpaid assignment flow, satisfies **AC-1**, **AC-2**.
- [x] 9. Update `frontend/src/pages/SalesPage.tsx` and cash calculation utilities so that unpaid sales count toward Total Sales but zero toward Total Cash until paid, satisfies **AC-3**.
- [x] 10. Update `frontend/src/pages/ReceivablesPage.tsx` to add Edit and Delete action buttons restricted to Finance users, wired to modal dialogs with confirmation and toast feedback, satisfies **AC-8**.
- [x] 11. Update `frontend/src/components/receivables/PersonLedgerDrawer.tsx` to support editing and deleting individual orders and payments for Finance users, satisfies **AC-7**, **AC-8**.

## Consequences

**Positive**:
- Eliminates client local storage data loss and discrepancies across branch terminals.
- Unpaid expenses are systematically tracked and collected rather than lost in operating expense buckets.
- Immediate real time visibility across all branches through WebSockets.
- Strong audit trail and financial safety with Finance only editing and deletion privileges.

**Negative / tradeoffs**:
- Requires running a database migration on both Supabase and SQLite.
- Editing or deleting receivables requires care to keep originating sales and expense records synchronized.

**Neutral**:
- Initial migration can seed existing mock debtor accounts into the database so current users do not lose sample records.

## Migration plan

**Strategy**: Strangler migration with safe seed backfill.
**Phases**:
1. Phase 1: Deploy database tables and backend API endpoints with WebSocket support alongside existing frontend mock store.
2. Phase 2: Seed initial standard debtors into the database so existing data remains familiar.
3. Phase 3: Update frontend `receivablesService.ts` to point to backend endpoints, retiring client local storage.
4. Phase 4: Deploy `/expense/add` transfer workflow and Finance edit and delete UI controls.

**Rollback**: If backend persistence fails, the frontend service can temporarily fall back to browser local storage via feature flag or service toggle.

**Risks**: Transient network disconnections during WebSocket broadcasts; mitigated by client side reconnection logic and silent background refetches.

## Follow-up

- [ ] Run database migration on production Supabase environment to create `receivables` and `receivable_payments` tables.
- [ ] Verify that payroll deductions for internal staff accurately export to CSV for month end payroll processing.

