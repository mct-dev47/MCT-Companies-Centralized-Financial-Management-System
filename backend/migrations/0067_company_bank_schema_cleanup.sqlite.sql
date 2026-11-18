-- Migration 0067 (SQLite): Drop unused company & bank_accounts columns
-- Note: SQLite column drops and FK checks are handled idempotently in app/db/migrations.py
SELECT 1;
