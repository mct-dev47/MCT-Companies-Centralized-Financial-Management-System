-- Migration 0051: Auth Data Retention, Token Scrubbing, and Legacy Rate Limit Removal (PostgreSQL)

-- 1. Ensure revoked_tokens table exists and index token_hash + expires_at
CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NULL,
    expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_revoked_tokens_token_hash ON revoked_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_revoked_tokens_user_id ON revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_revoked_tokens_expires_at ON revoked_tokens (expires_at);

-- 2. Add composite B-tree indexes for batched retention purge queries across auth tables
CREATE INDEX IF NOT EXISTS idx_rate_limits_retention ON rate_limits (last_attempt_at, locked_until);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_retention ON login_otp_challenges (created_at, status);
CREATE INDEX IF NOT EXISTS idx_outbox_retention ON invitation_outbox (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_created_at ON user_sessions (created_at);

-- 3. Clean up and backfill legacy NULL-expiry rows in revoked_tokens (longest session lifetime = 8 hours)
DELETE FROM revoked_tokens
WHERE expires_at IS NULL
  AND created_at < (NOW() - INTERVAL '8 hours');

UPDATE revoked_tokens
SET expires_at = created_at + INTERVAL '8 hours'
WHERE expires_at IS NULL;

-- 4. Allow NULL on login_otp_challenges.otp_hmac and scrub terminal rows
ALTER TABLE login_otp_challenges
ALTER COLUMN otp_hmac DROP NOT NULL;

UPDATE login_otp_challenges
SET otp_hmac = NULL
WHERE status IN ('used', 'expired', 'invalidated', 'delivery_failed')
  AND otp_hmac IS NOT NULL;

-- 5. Allow NULL on user_invitations.token_hash and scrub terminal rows
ALTER TABLE user_invitations
ALTER COLUMN token_hash DROP NOT NULL;

UPDATE user_invitations
SET token_hash = NULL
WHERE status IN ('ACCEPTED', 'EXPIRED', 'REVOKED')
  AND token_hash IS NOT NULL;

-- 6. Drop legacy duplicate login_rate_limits table
DROP TABLE IF EXISTS login_rate_limits;
