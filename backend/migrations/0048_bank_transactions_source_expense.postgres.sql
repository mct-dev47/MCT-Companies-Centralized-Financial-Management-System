-- 0044_bank_transactions_source_expense.postgres.sql
-- Link a bank entry to the expense it came from, so the bank holds exactly the paid part of each expense.

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_expense_id INTEGER NULL;
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_expense_id ON bank_transactions (source_expense_id);
