-- 0073_bank_transactions_audit_fields.postgres.sql
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) DEFAULT 'Pending Audit';
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS audited_by VARCHAR(100);
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS audit_remarks TEXT;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS remarks TEXT;

CREATE INDEX IF NOT EXISTS ix_bank_transactions_audit_status ON bank_transactions (audit_status);
