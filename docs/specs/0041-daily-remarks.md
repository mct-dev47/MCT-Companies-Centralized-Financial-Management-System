# 0041 · Daily Remarks

**Status**: Assumed
**Date**: 2026-11-09
**Authorized by**: Shelley, during /develop

## Owed decision
Spec 0040 added a remark to each sales and expense record. This feature adds one remark for a whole day. The open choice was what a "day" belongs to.

## Assumption built on
One remark per company, per date, per kind (`sales` or `expense`). Sales and Expense do not share a remark. The user confirmed this choice.

- Stored in a new `daily_remarks` table, unique on `(company_id, remark_date, kind)`.
- `GET /api/v1/daily-remarks?company_id&kind&date_from&date_to` lists remarks. Any business reader of that company can read.
- `PUT /api/v1/daily-remarks` saves, updates, or clears one day. Empty text deletes the row. Supervisor and Finance can write. Owner, Auditor and Admin cannot (same rule as `require_business_writer`).
- Sales and Expense Daily Summary tables get a Day Remark column. A day that mixes several companies shows "Multiple companies" and cannot be edited, because the remark belongs to one company.
- The finance transaction modal (`AuditTransactionModal`) shows the day remark for the record's company and date, separate from the record's own remark.
- Transactions page daily summary (per bank account) is out of scope.

## Code area
- `backend/app/models/daily_remark.py`, `backend/app/schemas/daily_remark.py`, `backend/app/api/v1/endpoints/daily_remarks.py`
- `backend/migrations/0041_daily_remarks.*.sql`, `backend/app/db/migrations.py`
- `frontend/src/services/dailyRemarksService.ts`, `frontend/src/hooks/useDailyRemarks.ts`, `frontend/src/components/dashboard/DayRemark.tsx`
- `frontend/src/pages/{SalesPage,ExpensePage}.tsx`, `frontend/src/components/dashboard/AuditTransactionModal.tsx`

## Requirements
- AC-1: Sales Daily Summary has a Day Remark column that Supervisor and Finance can add, edit, and clear.
- AC-2: Expense Daily Summary has the same column, with its own remark per day.
- AC-3: The finance transaction modal shows and edits the day remark for that record's company and date.
- AC-4: A remark saved on Sales for a date does not appear on Expense for the same date, and does not appear for another company.
- AC-5: Remarks persist across reloads.

## Ratify
This decision was recorded by /develop, not deliberated. Run `/architect daily-remarks`
to deliberate and ratify it. Until then it stays flagged as an owed decision; it does not block marking the feature `done`.
