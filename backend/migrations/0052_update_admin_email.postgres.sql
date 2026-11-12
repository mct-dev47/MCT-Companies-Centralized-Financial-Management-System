-- Migration 0052: Update Admin Account Email (PostgreSQL)

UPDATE users
SET
    email = 'manuelctolentino1947@gmail.com',
    updated_at = NOW()
WHERE
    role = 'admin';

-- Sync Supabase auth.users if available
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
        UPDATE auth.users
        SET
            email = 'manuelctolentino1947@gmail.com',
            updated_at = NOW()
        WHERE
            (raw_user_meta_data->>'is_admin')::boolean IS TRUE
            OR raw_user_meta_data->>'role' = 'admin';
    END IF;
END $$;
