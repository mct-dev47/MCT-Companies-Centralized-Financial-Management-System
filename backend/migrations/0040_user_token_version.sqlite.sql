-- Migration 0040: Add token_version to users table for session revocation (SQLite)

-- In SQLite, column inspection in migrations.py applies ALTER TABLE users ADD COLUMN token_version
-- idempotently to avoid duplicate column errors across repeated runs.

