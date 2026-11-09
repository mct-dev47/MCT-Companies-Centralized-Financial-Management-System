-- Migration 0041: Add purpose column and compound index to user_invitations (PostgreSQL)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_invitations' AND column_name = 'purpose'
    ) THEN
        ALTER TABLE user_invitations 
        ADD COLUMN purpose VARCHAR(30) NOT NULL DEFAULT 'initial_password_setup';

        ALTER TABLE user_invitations 
        ADD CONSTRAINT chk_invitation_purpose 
        CHECK (purpose IN ('initial_password_setup', 'password_reset'));

        CREATE INDEX IF NOT EXISTS idx_user_invitations_user_purpose 
        ON user_invitations(user_id, purpose, status);
    END IF;
END $$;

