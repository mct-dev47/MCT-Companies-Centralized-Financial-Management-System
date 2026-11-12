-- Migration 0051: Auth Data Retention, Token Scrubbing, and Legacy Rate Limit Removal (SQLite)

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NULL,
    expires_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_revoked_tokens_token_hash ON revoked_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_revoked_tokens_user_id ON revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_revoked_tokens_expires_at ON revoked_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_rate_limits_retention ON rate_limits (last_attempt_at, locked_until);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_retention ON login_otp_challenges (created_at, status);
CREATE INDEX IF NOT EXISTS idx_outbox_retention ON invitation_outbox (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_created_at ON user_sessions (created_at);

DELETE FROM revoked_tokens
WHERE expires_at IS NULL
  AND datetime(created_at) < datetime('now', '-8 hours');

UPDATE revoked_tokens
SET expires_at = datetime(created_at, '+8 hours')
WHERE expires_at IS NULL;

DROP TABLE IF EXISTS login_rate_limits;
