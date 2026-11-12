# Verify: Daily Grouped Sales and Expenses with Transaction Drilldown · spec 0034 · 2026-11-06

_Steps derived from spec 0034 acceptance criteria and value sourcing rules. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Open `/sales` and observe the table toolbar → under the `Deposit` and `Sales Record` switcher, a subtab control is visible with `Daily Summary` and `All Transactions`, with `Daily Summary` selected by default → AC-3 (Value source: subtab switcher state)
- [ ] In `Daily Summary` mode on `/sales`, observe table rows across a multi day date range → network tab confirms a request to `GET /api/v1/sales/daily-summary` returning database backed daily groups, and each row represents a single date (`YYYY-MM-DD` and day of week) displaying total transaction count, total sales amount, realized cash deposit, and an audit status badge (`All Verified`, `Pending Audit`, or `Discrepancy`) → AC-1, AC-4 (Value source: backend daily summary endpoint)
- [ ] Click on a day row in `Daily Summary` on `/sales` → an accordion expands directly below the day header displaying all individual sales transactions for that day with particulars, payment status badge, amount, and row actions (View, Edit, Delete, Audit) → AC-4 (Value source: expandable accordion drilldown)
- [ ] Click the `All Transactions` subtab on `/sales` → network tab confirms standard `GET /api/v1/sales` query and the table immediately switches to the flat granular list of all individual sales records with standard columns, sorting, and pagination → AC-5 (Value source: `All Transactions` view mode)
- [ ] Switch to the `Deposit` tab on `/sales` and test both `Daily Summary` and `All Transactions` subtabs → `Daily Summary` displays daily cash deposit totals, and `All Transactions` displays individual deposit lines → AC-1, AC-3, AC-4, AC-5
- [ ] Open `/expense` and observe the table toolbar → under `Withdraw` and `Expense Record`, the identical subtab switcher (`Daily Summary` and `All Transactions`) appears, defaulting to `Daily Summary` → AC-6 (Value source: subtab switcher on `/expense`)
- [ ] In `Daily Summary` mode on `/expense`, observe table rows → network tab confirms a request to `GET /api/v1/expenses/daily-summary`, and entries are aggregated by date, displaying date, day of week, transaction count, total expenses, cash disbursed, and audit badge → AC-2, AC-7 (Value source: backend daily summary endpoint on expenses)
- [ ] Click a day row in `Daily Summary` on `/expense` → an accordion expands revealing each individual expense record for that date with category, payment status, cheque number, amount, and actions → AC-7 (Value source: expense accordion drilldown)
- [ ] Click `All Transactions` on `/expense` → the table displays the flat list of individual expenses with pagination and filters → AC-8
- [ ] Compare top level KPI cards (**Total Sales**, **Total Expense**, **Total Cash**) while toggling between `Daily Summary` and `All Transactions` on both pages → KPI amounts remain strictly identical across both subtab views → AC-9 (Value source: base filtered KPI calculations)
- [ ] Record a new sale or expense in another browser tab → realtime WebSocket broadcast triggers automatic refetch of both the daily summary and individual transactions → AC-10
- [ ] Trigger CSV and PDF export from the export menu on `/sales` and `/expense` → exports include the option or context to export the active view (daily summary or detailed transactions) → AC-11

## Commands

- [ ] `cd backend; .\venv\Scripts\python.exe -c "from app.schemas.sale import DailySalesSummaryOut; from app.schemas.expense import DailyExpenseSummaryOut; print('Schemas OK')"` → prints `Schemas OK` confirming Pydantic schemas exist and parse → AC-1, AC-2
- [ ] `cd backend; .\venv\Scripts\python.exe -m pytest tests/test_spec_0027.py` → exits `0` confirming backend integrity and zero regressions → AC-1 through AC-11
- [ ] `cd frontend; npm run build` → exits `0` with zero TypeScript or Vite bundle compilation errors across updated sales and expense modules → AC-1 through AC-11

## Acceptance-criteria coverage

- AC-1 (Backend `GET /api/v1/sales/daily-summary` endpoint) covered by network tab check, Python schema command, and sales daily summary tests
- AC-2 (Backend `GET /api/v1/expenses/daily-summary` endpoint) covered by network tab check, Python schema command, and expense daily summary tests
- AC-3 (Sales page subtab switcher between Daily Summary and All Transactions) covered by `/sales` subtab check and frontend build
- AC-4 (Sales page Daily Summary aggregation and accordion drilldown) covered by daily group row inspection and click to expand test
- AC-5 (Sales page All Transactions granular view) covered by flat table inspection and pagination check
- AC-6 (Expense page subtab switcher) covered by `/expense` subtab check and frontend build
- AC-7 (Expense page Daily Summary aggregation and accordion drilldown) covered by expense daily group row inspection and click to expand test
- AC-8 (Expense page All Transactions granular view) covered by flat table inspection on `/expense`
- AC-9 (KPI calculation independence from subtab view) covered by KPI comparison check across view toggles
- AC-10 (Realtime WebSocket invalidation for daily summary and transactions) covered by multi tab WebSocket test
- AC-11 (CSV and PDF exports reflecting active view) covered by export inspection
