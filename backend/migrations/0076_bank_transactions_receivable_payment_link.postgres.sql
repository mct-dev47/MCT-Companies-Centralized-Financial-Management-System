-- 0076_bank_transactions_receivable_payment_link.postgres.sql
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_receivable_payment_id INTEGER;

CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_receivable_payment_id ON bank_transactions (source_receivable_payment_id);
