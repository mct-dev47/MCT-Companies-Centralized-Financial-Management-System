-- Migration 0068: Drop unused tables (budget, cash_inflow) and unused columns (receivables.expense_id, loan.interest_type)

DROP TABLE IF EXISTS budget CASCADE;
DROP TABLE IF EXISTS cash_inflow CASCADE;

ALTER TABLE IF EXISTS receivables DROP COLUMN IF EXISTS expense_id CASCADE;
ALTER TABLE IF EXISTS loan DROP COLUMN IF EXISTS interest_type CASCADE;
