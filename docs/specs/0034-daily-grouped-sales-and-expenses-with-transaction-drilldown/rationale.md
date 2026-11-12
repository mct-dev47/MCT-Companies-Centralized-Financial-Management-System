# 0034. Rationale: Daily Grouped Sales and Expenses with Transaction Drilldown

## Context

On both the Sales page (`/sales`) and the Expense page (`/expense`), transactions are rendered as a continuous, flat list of individual records. When reviewing weeks or months of operations, this creates cognitive fatigue because users must manually scan dozens of itemized rows to determine what happened on a specific day.

Furthermore, management and finance teams routinely balance books on a day to day basis. While the high level KPI cards summarize the entire period and individual table rows show single receipts, there was no intermediate daily summary view. Users requested grouping sales and expenses by day, while preserving a quick toggle or subtab inside the deposit and withdraw views to see every individual transaction, connected end to end to the backend and database.

## Options considered

### Option 1: Full Stack Dedicated Backend Daily Summary Endpoints with Database Aggregation

Add dedicated backend routes in FastAPI (`GET /api/v1/sales/daily-summary` and `GET /api/v1/expenses/daily-summary`) querying Supabase and local SQLite with date grouping and cash calculations. In the frontend, provide a two option subtab switcher (`Daily Summary` and `All Transactions`) inside both `Deposit` / `Sales Record` and `Withdraw` / `Expense Record` views. In `Daily Summary`, render day level rows with date, day name, transaction count, daily gross amount, daily realized cash, and audit health badge, with click to expand accordions revealing individual records.

**Pros**:
- Authoritative database backed daily aggregates ensuring multi user consistency.
- Efficient network utilization over large multi month datasets where clients only need day level totals until drilling down.
- Reuses existing `BusinessReader` auth, company scopes, and Supabase SQLite fallback patterns.
- Delivers the exact user requested experience: day by day grouped view by default, plus instant expandable drill down or a complete flat transaction view whenever needed.

**Cons**:
- Requires creating new backend endpoints, Pydantic schemas, and frontend service methods.

### Option 2: Client Side Only Grouping

Perform all grouping purely on the client side in memory without backend endpoints.

**Pros**:
- Avoids writing new backend endpoints.

**Cons**:
- Transfers all raw transactions even when the user only wants daily summary totals.
- Does not connect to the backend or database for day level aggregation, which conflicts with explicit requirements.

### Option 3: Separate Routes (`/sales/daily`, `/expense/daily`)

Keep daily summaries on separate dedicated routes instead of subtab toggles within the existing pages.

**Pros**:
- Keeps individual page components smaller.

**Cons**:
- Breaks the unified page experience where users already have their company, date range, and export controls configured.
- Forces full page reloads and context switches between reviewing daily numbers and inspecting transactions.

## Rationale

Option 1 is selected because it establishes authoritative backend database queries for daily aggregations while delivering a fast and clean user experience with subtabs and accordions. Connecting to the backend ensures proper aggregation across both Supabase and SQLite, leverages existing particulars status helpers, and respects role based company access controls.

## References

None (references not requested).
