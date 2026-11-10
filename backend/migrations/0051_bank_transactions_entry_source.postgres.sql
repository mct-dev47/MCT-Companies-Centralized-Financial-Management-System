-- 0051_bank_transactions_entry_source.postgres.sql
-- Where a bank entry came from. 'manual' = a deposit/withdrawal typed directly in Bank Management, which has
-- no sale/expense/loan/petty-cash record behind it; the Transactions page lists those so its ledger matches the bank.

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS entry_source VARCHAR(30) NULL;
CREATE INDEX IF NOT EXISTS ix_bank_transactions_entry_source ON bank_transactions (entry_source);
