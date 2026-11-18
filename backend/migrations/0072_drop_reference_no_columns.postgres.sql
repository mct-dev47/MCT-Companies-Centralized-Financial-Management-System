-- Migration 0072: Drop system-generated reference_no columns and unique index from expenses, petty_cash_topups, and sales
DROP INDEX IF EXISTS idx_expenses_reference_no;

ALTER TABLE IF EXISTS expenses DROP COLUMN IF EXISTS reference_no CASCADE;
ALTER TABLE IF EXISTS petty_cash_topups DROP COLUMN IF EXISTS reference_no CASCADE;
ALTER TABLE IF EXISTS sales DROP COLUMN IF EXISTS reference_no CASCADE;
