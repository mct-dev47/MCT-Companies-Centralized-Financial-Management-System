-- 0074_loan_repayment_links.sqlite.sql
-- In SQLite, ALTER TABLE column checks and index creation are executed idempotently in app/db/migrations.py (_run_sqlite_migrations) and app/db/session.py (init_db).
CREATE INDEX IF NOT EXISTS ix_loans_repayments_expense_id ON loans_repayments (expense_id);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_loan_repayment_id ON bank_transactions (source_loan_repayment_id);
