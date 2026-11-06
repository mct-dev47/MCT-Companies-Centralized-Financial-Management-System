# 0034. Daily Grouped Sales and Expenses with Transaction Drilldown

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This spec introduces full stack daily transaction grouping and subtab navigation connecting the frontend, FastAPI backend, and database persistence layers for both the Sales page (`/sales`) and the Expense page (`/expense`). Inside the existing view switchers (`Deposit` and `Sales Record` on `/sales`; `Withdraw` and `Expense Record` on `/expense`), users can toggle between a `Daily Summary` view and an `All Transactions` view. Dedicated backend endpoints (`/api/v1/sales/daily-summary` and `/api/v1/expenses/daily-summary`) query the database to aggregate entries by day, calculating date, day of week, transaction count, gross amounts, realized cash, and audit status badges. Clicking any day row expands an inline accordion drilldown displaying individual transaction records. The `All Transactions` subtab preserves the full granular flat table with pagination and individual record actions.

## Requirements

**User stories**:
- As a branch manager or supervisor on `/sales`, I want sales and deposits grouped by day with authoritative backend aggregated totals, so that I can quickly evaluate daily revenue without manual calculations.
- As a finance officer or cashier on `/sales`, I want a subtab toggle in both Deposit and Sales Record views so that I can easily switch between the database backed daily overview and the complete list of individual transactions.
- As an accountant on `/expense`, I want expenses and disbursements aggregated by day via backend endpoints with expandable drilldown rows, so that I can review total daily spending and inspect individual disbursement vouchers for any day.
- As an auditor reviewing accounts, I want each daily group to display an aggregate audit status badge computed by the server (such as All Verified, Pending Audit, or Discrepancy), so that I can identify unverified business days at a glance and open individual transaction audit modals directly from the day drilldown.

**Acceptance criteria**:
- **AC-1**: Dedicated backend endpoint `GET /api/v1/sales/daily-summary` accepts company, date range, search, and view type parameters, aggregates matching sales in Supabase and SQLite by date, and returns daily summary objects containing date, day of week, transaction count, gross total, realized cash, and rolled up audit status.
- **AC-2**: Dedicated backend endpoint `GET /api/v1/expenses/daily-summary` accepts company, date range, search, and view type parameters, aggregates matching expenses in Supabase and SQLite by date, and returns daily summary objects containing date, day of week, transaction count, gross total, realized cash disbursement, and rolled up audit status.
- **AC-3**: On `/sales`, within both the `Deposit` and `Sales Record` view tabs, a subtab switcher allows toggling between `Daily Summary` (default view) and `All Transactions`.
- **AC-4**: In `Daily Summary` mode on `/sales`, the table displays the backend aggregated daily summaries; clicking any day row expands an inline accordion row that lists all individual sales records for that specific date, showing particulars, payment status badge (`Paid`, `Partial`, `Unpaid`), reference number, payment method, amount, and row action buttons (View, Edit, Delete, Audit).
- **AC-5**: In `All Transactions` mode on `/sales`, the table displays the flat list of individual transactions with the existing column layout, search filter, payment status filter, sorting, and pagination.
- **AC-6**: On `/expense`, within both the `Withdraw` and `Expense Record` view tabs, the identical subtab switcher allows toggling between `Daily Summary` (default view) and `All Transactions`.
- **AC-7**: In `Daily Summary` mode on `/expense`, the table displays the backend aggregated daily expense summaries; clicking any day row expands an inline accordion row that lists all individual expense records for that specific date, showing particulars, category, payment status badge, cheque number, amount, and action buttons.
- **AC-8**: In `All Transactions` mode on `/expense`, the table displays the flat list of individual expenses with standard pagination, search query filtering, and existing action menus.
- **AC-9**: Top level KPI cards (**Total Sales**, **Total Cash**, and unpaid counters on `/sales`; **Total Expense** and **Total Cash** on `/expense`) remain calculated from base filtered transactions and stay strictly identical regardless of which subtab (`Daily Summary` or `All Transactions`) is active.
- **AC-10**: Realtime WebSocket updates (`SALES_UPDATED`, `EXPENSES_UPDATED`, `AUDIT_UPDATED`) invalidate both the daily summary cache and the detailed transaction cache, refreshing both views automatically.
- **AC-11**: CSV and PDF export menus on both pages provide options to export either the active view format (`Daily Summary` grouped totals or granular `All Transactions` list) with matching company and date headers.

## Decision

**Chosen option**: Full Stack Daily Aggregation with Dedicated Backend Endpoints and Expandable Frontend Subtabs.

**Implementation skills**: `develop` (`.agents/skills/develop/SKILL.md`) · `architect` (`.agents/skills/architect/SKILL.md`)

We will add backend aggregation routes in `backend/app/api/v1/endpoints/sales.py` and `backend/app/api/v1/endpoints/expenses.py` backed by SQL / Supabase queries, define Pydantic schemas in `app/schemas/sale.py` and `app/schemas/expense.py`, add service methods to `salesService.ts` and `expenseService.ts`, and integrate the subtab switcher and expandable accordions in `SalesPage.tsx` and `ExpensePage.tsx`.

Internal design choices:
- **Backend calculation parity**: The server computes `realized_cash` on each day using the proven particulars status parser `compute_paid_amount_from_particulars` so cash math exactly matches the individual ledger entries.
- **Database fallback**: The daily summary endpoints query Supabase primary storage with safe SQLite fallback if Supabase pooler times out or is offline, preserving system resilience.
- **Subtab placement**: Positioned in the table toolbar directly alongside search, period filters, and export buttons, maintaining clear visual hierarchy under the primary `Deposit` / `Sales Record` or `Withdraw` / `Expense Record` view buttons.
- **Accordion state**: Keep open date keys in a local set (`expandedDates: Set<string>`), allowing multiple days to be expanded simultaneously for cross day auditing.
- **Audit badge roll up**: A day is marked `All Verified` if every transaction on that date has `audit_status == "Verified"`. If any record has `Discrepancy`, the day badge shows `Discrepancy`. Otherwise, it displays `Pending Audit`.

## Feature design

### Data model sketch

New Pydantic schemas in `backend/app/schemas/`:

```python
class DailySalesSummaryOut(BaseModel):
    date: date
    day_of_week: str
    transaction_count: int
    gross_total: Decimal
    realized_cash: Decimal
    audit_status: str

class DailyExpenseSummaryOut(BaseModel):
    date: date
    day_of_week: str
    transaction_count: int
    gross_total: Decimal
    realized_cash: Decimal
    audit_status: str
```

### State transitions

View subtab lifecycle:

```
[User Navigates to /sales or /expense]
  ↓
[Primary Tab: Deposit/Sales Record OR Withdraw/Expense Record]
  ↓
[Subtab Switcher]
  ├─→ [Daily Summary (Default)]
  │     ├─→ Fetches GET /api/v1/{sales|expenses}/daily-summary from Database
  │     ├─→ Collapsed Day Row (date, day of week, count, daily total, cash, audit badge)
  │     └─→ Click Row / Chevron → Expand Accordion (loads and renders individual transactions)
  │
  └─→ [All Transactions]
        ├─→ Fetches GET /api/v1/{sales|expenses} from Database
        └─→ Flat granular transaction table (original view with all columns and pagination)
```

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/sales/daily-summary` | `GET` | `company_id`, `company_name`, `start_date`, `end_date`, `status`, `view_type` | `List[DailySalesSummaryOut]` | `BusinessReader` (company scoped) | `401`, `403` |
| `/api/v1/expenses/daily-summary` | `GET` | `company_id`, `company_name`, `start_date`, `end_date`, `status`, `view_type` | `List[DailyExpenseSummaryOut]` | `BusinessReader` (company scoped) | `401`, `403` |
| `/api/v1/sales` | `GET` | Existing query parameters | `List[SaleOut]` | `BusinessReader` (company scoped) | `401`, `403` |
| `/api/v1/expenses` | `GET` | Existing query parameters | `List[ExpenseOut]` | `BusinessReader` (company scoped) | `401`, `403` |

### Value sourcing

| Value | Source | Calculation |
|---|---|---|
| `DailySalesSummaryOut.date` | `sales.transaction_date` / `sales.date` | Normalized ISO date `YYYY-MM-DD` |
| `DailySalesSummaryOut.gross_total` | `sales.amount` / `sales.deposit` | Sum of amounts for matching transactions on this date |
| `DailySalesSummaryOut.realized_cash` | `compute_paid_amount_from_particulars(sale.particulars, sale.amount)` | Sum of realized cash for matching transactions on this date |
| `DailySalesSummaryOut.transaction_count` | `COUNT(sales.id)` | Count of records for this date |
| `DailySalesSummaryOut.audit_status` | `sales.audit_status` | `Discrepancy` if any record has discrepancy, else `Pending Audit` if any is unverified, else `Verified` |
| `DailyExpenseSummaryOut.gross_total` | `expenses.amount` / `expenses.withdrawal` | Sum of amounts for matching expenses on this date |
| `DailyExpenseSummaryOut.realized_cash` | `getPaidDisbursementForExpense(expense)` | Sum of paid cash disbursements for this date |

### Key invariants

- Selecting `Daily Summary` or `All Transactions` must never modify or recalculate the top KPI summary cards (**Total Sales**, **Total Expense**, **Total Cash**).
- Expanding an accordion row in `Daily Summary` must expose full transaction functionality (View details modal, Edit modal for authorized non verified rows, Delete for authorized roles, Audit modal for auditors).
- If a user filters by search term or status, daily backend summary totals must reflect only the filtered transactions and omit empty dates.
- Realtime WebSocket updates must re fetch daily summaries and individual records automatically.

### Security model

- `BusinessReader` dependency enforces company scoped authorization on both daily summary endpoints:
  - `Finance` and `Audit` can query summaries across all companies.
  - `Company` and `Supervisor` users can query summaries strictly within their assigned `company_ids`.
  - `Admin` is blocked from business ledger endpoints.
  - Locked transactions (`audit_status == "Verified"`) retain read only protection across both daily summary drilldowns and granular flat views.

## Build plan

1. **Backend Schemas and Endpoints (`backend/app/`)**:
   - In `app/schemas/sale.py` and `app/schemas/expense.py`, add `DailySalesSummaryOut` and `DailyExpenseSummaryOut`.
   - In `backend/app/api/v1/endpoints/sales.py`, add `GET /api/v1/sales/daily-summary` with Supabase query and SQLite fallback, computing gross amount, realized cash, transaction count, and audit roll up.
   - In `backend/app/api/v1/endpoints/expenses.py`, add `GET /api/v1/expenses/daily-summary` with Supabase query and SQLite fallback.
2. **Frontend API Services (`frontend/src/services/`)**:
   - In `salesService.ts`, add `getDailySummary(params)` calling `/api/v1/sales/daily-summary`.
   - In `expenseService.ts`, add `getDailySummary(params)` calling `/api/v1/expenses/daily-summary`.
3. **Sales Page Subtab Switcher and Grouped Table (`SalesPage.tsx`)**:
   - Add `subTab` state (`'Daily Summary' | 'All Transactions'`, defaulting to `'Daily Summary'`).
   - Add subtab toggle buttons into the table header bar below the primary `Deposit` / `Sales Record` switcher.
   - Render the daily grouped table with expandable accordions when `Daily Summary` is active.
   - Render the existing flat table when `All Transactions` is active.
4. **Expense Page Subtab Switcher and Grouped Table (`ExpensePage.tsx`)**:
   - Add `subTab` state (`'Daily Summary' | 'All Transactions'`, defaulting to `'Daily Summary'`).
   - Add subtab toggle buttons into the table header bar below the primary `Withdraw` / `Expense Record` switcher.
   - Render the daily grouped table with expandable accordions when `Daily Summary` is active.
   - Render the existing flat table when `All Transactions` is active.
5. **Export Enhancements**:
   - Update export handlers in both pages to export the active subtab format (daily summary or detailed items).
6. **Verification and Testing**:
   - Verify day group totals against KPI cards, drill down interactions, search filtering, and audit roll up behavior.
