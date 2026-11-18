-- Migration 0072: Drop system-generated reference_no columns and unique index from expenses, petty_cash_topups, and sales
DROP INDEX IF EXISTS idx_expenses_reference_no;
