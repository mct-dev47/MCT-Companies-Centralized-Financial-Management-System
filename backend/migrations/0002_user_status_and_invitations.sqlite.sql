-- SQLite Schema Migration 0002
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_invitations (
    invitation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at DATETIME NOT NULL,
    claimed_at DATETIME,
    accepted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    CHECK (status IN ('PENDING', 'CLAIMED', 'ACCEPTED', 'EXPIRED', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token_hash, status);
CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations(user_id);

CREATE TABLE IF NOT EXISTS invitation_outbox (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    invitation_id INTEGER NOT NULL REFERENCES user_invitations(invitation_id) ON DELETE CASCADE,
    recipient_email VARCHAR(255) NOT NULL,
    encrypted_payload TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at DATETIME,
    claim_token VARCHAR(64),
    lease_expires_at DATETIME,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('PENDING', 'CLAIMED', 'DISPATCHED_TO_PROVIDER', 'FAILED', 'DEAD_LETTER', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_fetch ON invitation_outbox(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_outbox_lease ON invitation_outbox(claim_token, lease_expires_at);

INSERT INTO schema_migrations (version) VALUES ('0002_user_status_and_invitations');

