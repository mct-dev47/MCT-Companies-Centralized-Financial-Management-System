-- 0078_bank_transactions_loan_topup_links.sqlite.sql
-- In SQLite, ALTER TABLE column checks and index creation are executed idempotently in app/db/migrations.py (_run_sqlite_migrations) and app/db/session.py (init_db).
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_loan_id ON bank_transactions (source_loan_id);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_topup_id ON bank_transactions (source_topup_id);
