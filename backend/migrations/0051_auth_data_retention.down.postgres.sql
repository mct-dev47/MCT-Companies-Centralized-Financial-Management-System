-- Rollback Migration 0051: Restore login_rate_limits and drop 0051 retention indexes (PostgreSQL)

CREATE TABLE IF NOT EXISTS login_rate_limits (
    ip_address VARCHAR(45) PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_login_rate_limits_ip_address ON login_rate_limits (ip_address);

DROP INDEX IF EXISTS ix_revoked_tokens_expires_at;
DROP INDEX IF EXISTS idx_rate_limits_retention;
DROP INDEX IF EXISTS idx_outbox_retention;
DROP INDEX IF EXISTS idx_user_sessions_created_at;

DELETE FROM schema_migrations WHERE version = '0051_auth_data_retention';
