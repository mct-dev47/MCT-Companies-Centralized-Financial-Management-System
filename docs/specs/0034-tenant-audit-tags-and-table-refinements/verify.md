# Verify: Tenant Audit Tags and Table Refinements · spec 0034 · updated 2026-11-06
_Steps derived from spec 0034 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Log in as Finance, Supervisor, Owner, or Auditor and open the Tenants page → Confirm the tenant name cell displays only the tenant name text without lease reference code or stall unit subtitle → AC-1
- [x] Inspect the main tenants table header and rows on desktop → Confirm Contract Date and Due Date columns are completely absent from the table → AC-2
- [x] Inspect status cells across leases with Paid, Unpaid, Partially Paid, Advance Paid, Missed, or Overdue → Confirm status renders as clean colored text without background pills or border containers → AC-3
- [x] View the main table as Finance or Owner role → Confirm the Audit Tag column renders directly to the right of the Status column for all rows → AC-4
- [x] Check leases with Verified status, Flagged status, and unreviewed status → Confirm Verified shows "Audited" in emerald text, Flagged shows "Discrepancy" in crimson text, and unreviewed shows a muted dash "-" → AC-5
- [x] Hover cursor over an "Audited" or "Discrepancy" tag in the main table → Confirm the native title tooltip renders auditor full name, formatted audit timestamp, and discrepancy remarks on separate lines → AC-6
- [x] Open the Tenant Details view for any lease and navigate to Payment Schedule and History → Confirm the Actions column header and Edit and Delete buttons are completely absent → AC-7
- [x] Inspect the Payment Schedule and History table → Confirm the Created By column shows compact initial and last name (e.g. J. Dela Cruz) with cursor help styling, and hovering shows the full name tooltip → AC-8
- [x] In the Payment Schedule and History table, view legacy payment entries without creator information → Confirm the Created By cell displays a muted dash "-" → AC-9
- [x] Click Download as CSV and open print preview from the Tenants page → Confirm both CSV and print reports preserve all original columns including Contract Date and Due Date → AC-11

## Commands
- [x] Send `GET /api/v1/tenants/leases` with an authenticated session token → Expect HTTP 200 with list of leases where each payment in `payments` array includes `created_by` and resolved `created_by_name` → AC-10
- [x] Send `GET /api/v1/tenants/leases/{id}` with an authenticated session token → Expect HTTP 200 with single lease where payments contain `created_by_name` matching the creator user full name → AC-10

## Acceptance-criteria coverage
- AC-1: covered by UI step 1
- AC-2: covered by UI step 2
- AC-3: covered by UI step 3
- AC-4: covered by UI step 4
- AC-5: covered by UI step 5
- AC-6: covered by UI step 6
- AC-7: covered by UI step 7
- AC-8: covered by UI step 8
- AC-9: covered by UI step 9
- AC-10: covered by command steps 1 and 2, UI step 8
- AC-11: covered by UI step 10

