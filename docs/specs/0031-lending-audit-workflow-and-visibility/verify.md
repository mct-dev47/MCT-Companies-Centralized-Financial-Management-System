# Verify: Lending Audit Workflow and Visibility · spec 0031 · updated 2026-11-06
_Steps derived from spec 0031 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Log in as non auditor role (Finance, Supervisor, Owner, or Admin) and open Lending page → Verify Audit Tag column renders for all rows with "Audited", "Discrepancy", or "-" without initials or timestamps → AC-1, AC-2
- [ ] Hover cursor over an "Audited" or "Discrepancy" badge in the main table → Verify title tooltip displays auditor name, audit timestamp, and remarks → AC-3
- [ ] Log in as Auditor and open Lending details view for any borrower → Verify auditor name and formatted audit timestamp appear directly above "Re-Audit" and "Flag Discrepancy" action buttons → AC-4
- [ ] Log in as non auditor role (Finance, Supervisor, Owner, or Admin) and open Lending details view → Verify top right header area has no audit action buttons or redundant stamps → AC-5
- [ ] In Lending details view under any user role, inspect the left Loan Agreement and Terms receipt card → Verify dedicated Audit Review panel displays status badge, auditor full name, audit timestamp, and full auditor remarks → AC-6
- [ ] As Auditor in Lending details view, click "Flag Discrepancy" button or select "Mark as Discrepancy" from table actions menu → Verify modal textarea spans full dialog width, has rounded border with focus ring, and prepopulates previous remarks if previously flagged → AC-7
- [ ] Enter discrepancy notes in Flag Audit Discrepancy modal and confirm → Verify modal saves to database, borrower status updates to "Discrepancy" in UI and backend, and findings persist across full page refresh → AC-8
- [ ] As Auditor in Lending details view, click "Mark as Audited" or "Re-Audit" and confirm → Verify status updates to "Audited" in UI and database, previous discrepancy remarks are cleared, and record persists across full page refresh → AC-9
- [ ] Click Export and download as CSV or open print view as any authenticated user role → Verify export includes Audit Status, Audited By, and Audit Date columns → AC-10

## Commands
- [ ] Attempt `PATCH /api/v1/lending/borrowers/{id}/audit` with an Admin or Finance token → Expect HTTP 403 Forbidden with error indicating only Auditor accounts can perform audit reviews → AC-4, AC-8
- [ ] Send `PATCH /api/v1/lending/borrowers/{id}/audit` with an Auditor token and status "Verified" → Expect HTTP 200 with `audit_status: "Verified"` and `audit_remarks: null` → AC-9
- [ ] Send `PATCH /api/v1/lending/borrowers/{id}/audit` with an Auditor token and status "Flagged" with remarks → Expect HTTP 200 with `audit_status: "Flagged"` and remarks persisted → AC-8

## Acceptance criteria coverage
- AC-1: covered by step 1
- AC-2: covered by step 1
- AC-3: covered by step 2
- AC-4: covered by step 3, command step 1
- AC-5: covered by step 4
- AC-6: covered by step 5
- AC-7: covered by step 6
- AC-8: covered by step 7, command step 3
- AC-9: covered by step 8, command step 2
- AC-10: covered by step 9

