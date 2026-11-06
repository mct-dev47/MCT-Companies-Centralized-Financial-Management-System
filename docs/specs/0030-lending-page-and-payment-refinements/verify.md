# Verify: Lending Page and Payment Refinements (spec 0030, updated 2026-11-06)

_Steps derived from spec 0030 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Open the Lending page at `/lending` and review the main portfolio table → `Date Borrowed` and `Due Date` columns are removed from screen, remaining columns fill the table width cleanly, and status text renders without borders or pill boxes → AC-1, AC-3
- [x] Open Export menu and select CSV, then repeat for PDF → exported CSV and print summary retain `Date Borrowed` and `Due Date` headers and row values intact → AC-2
- [x] View an audited loan facility row in the table when logged in with an auditor account → audit tag renders without outline borders, showing audit state and formatted auditor name on the first line (such as `Audited · V. Masiglat`) and timestamp on the second line → AC-4
- [x] Click a borrower row to display Lending Details, then review the Payment Schedule and History section → payment status indicators render as clean colored text without pill borders or colored backgrounds → AC-3
- [x] Inspect a payment history row containing a long remarks note → remarks text wraps across multiple lines with flexible row height without clipping or horizontal blowout → AC-5
- [x] Inspect the rightmost column in the Payment Schedule and History table → column header is `Created By`, populated records display the creator formatted as initial and last name (such as `P. Tayam`), and legacy records show an em dash fallback → AC-6
- [x] Click Record Payment to open the payment remittance dialog → Payment Method field displays a red asterisk indicating required status while defaulting to `Cash` → AC-7
- [x] View the Remarks field inside the payment dialog → real time character counter shows current length out of 50 (such as `0/50`) and typing beyond 50 characters is blocked by `maxLength` → AC-7
- [x] Submit a payment remittance with valid details → form submits successfully, persists the creator metadata from the active session, and immediately displays the new entry in payment history → AC-6, AC-7

## Commands

- [x] `& "C:\Users\User\AppData\Local\Programs\Python\Python313\python.exe" -m pytest backend\tests\test_lending_late_payment.py` → all 9 unit tests pass successfully → AC-6, AC-7
- [x] `cd frontend; & "C:\nvm4w\nodejs\node.exe" ./node_modules/vite/bin/vite.js build` → production bundle builds with zero errors → AC-1, AC-3, AC-4, AC-5, AC-6, AC-7

## Acceptance-criteria coverage

- AC-1 (Remove Date Borrowed and Due Date from screen table) covered by UI step 1
- AC-2 (Preserve date columns in CSV and Excel exports) covered by UI step 2
- AC-3 (Borderless status labels across tables) covered by UI steps 1 and 4
- AC-4 (Borderless two line audit tag with formatted auditor name) covered by UI step 3
- AC-5 (Flexible row height and word wrapping for remarks) covered by UI step 5
- AC-6 (Created By column with formatted creator name and fallback) covered by UI steps 6 and 9, command step 1
- AC-7 (Required payment method asterisk and 50 character limit on remarks) covered by UI steps 7, 8, and 9, command step 1

