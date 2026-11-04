# Verify: Owner Role and Account Migration · spec 0029 · updated 2026-11-04
_Steps derived from spec 0029 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Sign in with ryuuujin.sh@gmail.com → user profile reflects role Owner with All Companies access → AC-2, AC-4, Value sourcing row 1, 2, 3
- [x] Navigate to Bills page (`/bills`) → Add Bill button is hidden and action column shows a static dash placeholder without interactive menu → AC-5, AC-6, Value sourcing row 4
- [x] Navigate to Expenses page (`/expense`) → Add Expense button is hidden and action column displays static dash without edit or audit menu → AC-5, AC-6, Value sourcing row 4
- [x] Navigate to Lending page (`/lending`) → New Borrower button is hidden and action column shows static dash without popover → AC-5, AC-6, Value sourcing row 4
- [x] Navigate to Company Loans page (`/loan`) → Add Loan button is hidden, page loads without reference errors, and action column shows static dash → AC-5, AC-6, AC-7, Value sourcing row 4
- [x] Navigate to Petty Cash page (`/petty-cash`) → Request Petty Cash button is hidden and action column displays static dash → AC-5, AC-6, Value sourcing row 4
- [x] Navigate to Sales Records page (`/sales`) → Add Sale button is hidden and action column displays static dash → AC-5, AC-6, Value sourcing row 4
- [x] Navigate to Tenant Leases page (`/tenants`) → New Tenant Lease button is hidden and action column displays static dash → AC-5, AC-6, Value sourcing row 4
- [x] Open audit review modal on any transaction → Edit in Sheet and audit status buttons are suppressed for Owner → AC-5, Value sourcing row 4

## Commands

- [x] `.\.venv\Scripts\python.exe -m unittest backend.tests.test_owner_role` → All tests pass verifying Owner role schemas, 403 Forbidden mutation guards, global company reading, and migration execution → AC-1, AC-3, Value sourcing row 5
- [x] Execute migration script `backend/migrations/0029_owner_role_and_account_migration.sql` → Target Manuel record is updated with email ryuuujin.sh@gmail.com and role owner → AC-1, AC-2

## Acceptance-criteria coverage

- AC-1 (User model and schemas accept owner role) covered by `.\.venv\Scripts\python.exe -m unittest backend.tests.test_owner_role`
- AC-2 (Migration updates Manuel email and role) covered by migration test and sign in verify step
- AC-3 (Backend blocks Owner mutations with 403 Forbidden) covered by `test_require_business_writer_blocks_owner`
- AC-4 (Frontend maps Owner role with All Companies scope) covered by profile inspection on sign in
- AC-5 (All pages suppress creation, edit, and audit buttons) covered by UI verify steps on Bills, Expenses, Lending, Loan, Petty Cash, Sales, Tenants, and Audit modal
- AC-6 (Action columns display clean dash placeholder) covered by UI table inspection across all financial pages
- AC-7 (LoanPage defines canAuditActions safely) covered by LoanPage UI test without console errors

