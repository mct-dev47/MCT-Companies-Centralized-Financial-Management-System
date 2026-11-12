-- Migration 0041: Add purpose column and compound index to user_invitations (SQLite)

-- In SQLite, column inspection in migrations.py applies ALTER TABLE user_invitations ADD COLUMN purpose
-- idempotently to avoid duplicate column errors across repeated runs.
CREATE INDEX IF NOT EXISTS idx_user_invitations_user_purpose ON user_invitations(user_id, purpose, status);

