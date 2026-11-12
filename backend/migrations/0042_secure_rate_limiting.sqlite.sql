-- Migration 0042: Secure Rate Limiting and OTP Challenges (SQLite)

CREATE TABLE IF NOT EXISTS rate_limits (
    key VARCHAR(190) PRIMARY KEY,
    rate_type VARCHAR(50) NOT NULL,
    identifier VARCHAR(120) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start DATETIME NOT NULL,
    locked_until DATETIME NULL,
    last_attempt_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_type_id ON rate_limits (rate_type, identifier);
CREATE INDEX IF NOT EXISTS idx_rate_limits_locked_until ON rate_limits (locked_until);
CREATE INDEX IF NOT EXISTS idx_rate_limits_last_attempt ON rate_limits (last_attempt_at);

CREATE TABLE IF NOT EXISTS login_otp_challenges (
    otp_id VARCHAR(36) PRIMARY KEY,
    challenge_id VARCHAR(36) NOT NULL,
    user_id INTEGER NULL,
    email VARCHAR(255) NOT NULL,
    purpose VARCHAR(50) NOT NULL DEFAULT 'login_2fa',
    ip_address VARCHAR(45) NOT NULL,
    otp_hmac VARCHAR(64) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_delivery',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    resend_count INTEGER NOT NULL DEFAULT 0,
    last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    invalidated_at DATETIME NULL,
    invalidation_reason VARCHAR(100) NULL,
    delivery_outcome VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_challenges_session ON login_otp_challenges (challenge_id, status);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_email_ip ON login_otp_challenges (email, ip_address);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires ON login_otp_challenges (expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_retention ON login_otp_challenges (created_at, status);

