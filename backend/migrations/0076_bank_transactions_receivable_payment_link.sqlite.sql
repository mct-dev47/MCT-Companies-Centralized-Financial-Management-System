-- 0076_bank_transactions_receivable_payment_link.sqlite.sql
-- In SQLite, ALTER TABLE column checks and index creation are executed idempotently in app/db/migrations.py (_run_sqlite_migrations) and app/db/session.py (init_db).
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_receivable_payment_id ON bank_transactions (source_receivable_payment_id);
