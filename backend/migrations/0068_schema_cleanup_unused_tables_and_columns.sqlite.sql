-- Migration 0068 (SQLite): Drop unused tables (budget, cash_inflow) and unused columns (receivables.expense_id, loan.interest_type)
-- Note: SQLite table/column drops are handled idempotently in app/db/migrations.py
SELECT 1;
