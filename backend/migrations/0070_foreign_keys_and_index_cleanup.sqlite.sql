-- 0070: Drop duplicate indexes and add composite pagination indexes (SQLite)
-- Note: SQLite ORM models declare the new ForeignKey constraints for fresh tables.
DROP INDEX IF EXISTS idx_bank_accounts_company_id;
DROP INDEX IF EXISTS idx_notifications_recipient_feed;

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
    ON audit_logs (company_id, created_at DESC, audit_log_id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_id
    ON audit_logs (created_at DESC, audit_log_id DESC);
CREATE INDEX IF NOT EXISTS idx_loans_repayments_loan_date
    ON loans_repayments (loan_id, payment_date DESC, loan_repayment_id DESC);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date_id
    ON bank_transactions (bank_account_id, transaction_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lending_tx_borrower_date
    ON lending_transactions (borrower_id, payment_date DESC, transaction_id DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_payments_lease_date
    ON tenant_lease_payments (lease_id, payment_date DESC, payment_id DESC);
