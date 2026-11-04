BEGIN;

-- 1. Create migration history tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Alter users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Safeguard: Ensure existing production users remain ACTIVE
UPDATE users SET status = 'ACTIVE' WHERE status IS NULL OR status = 'PROVISIONED';

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 3. Create user_invitations table
CREATE TABLE IF NOT EXISTS user_invitations (
    invitation_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    CONSTRAINT chk_invitation_status CHECK (status IN ('PENDING', 'CLAIMED', 'ACCEPTED', 'EXPIRED', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token_hash, status);
CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations(user_id);

-- 4. Create invitation_outbox table
CREATE TABLE IF NOT EXISTS invitation_outbox (
    job_id BIGSERIAL PRIMARY KEY,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    invitation_id BIGINT NOT NULL REFERENCES user_invitations(invitation_id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    encrypted_payload TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ,
    claim_token VARCHAR(64),
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'CLAIMED', 'DISPATCHED_TO_PROVIDER', 'FAILED', 'DEAD_LETTER', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_fetch ON invitation_outbox(status, next_retry_at) 
WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_outbox_lease ON invitation_outbox(claim_token, lease_expires_at);

-- 5. Record migration version
INSERT INTO schema_migrations (version) VALUES ('0002_user_status_and_invitations');

COMMIT;

