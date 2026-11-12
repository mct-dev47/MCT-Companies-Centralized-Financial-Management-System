-- Migration 0040: Add token_version to users table for session revocation (PostgreSQL)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'token_version'
    ) THEN
        ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;
    END IF;
END $$;

