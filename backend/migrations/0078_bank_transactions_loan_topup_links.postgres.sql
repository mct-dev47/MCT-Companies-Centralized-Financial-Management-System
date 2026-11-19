-- 0078_bank_transactions_loan_topup_links.postgres.sql
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_loan_id INTEGER;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_topup_id INTEGER;

CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_loan_id ON bank_transactions (source_loan_id);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_topup_id ON bank_transactions (source_topup_id);
