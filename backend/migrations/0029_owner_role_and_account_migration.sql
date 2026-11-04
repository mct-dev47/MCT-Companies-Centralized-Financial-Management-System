-- Spec 0029: Owner Role and Manuel Account Email Migration
-- Safe idempotent migration for Supabase PostgreSQL and SQLite

BEGIN;

-- 1. Ensure schema_migrations table exists
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Update user record for Manuel to ryuuujin.sh@gmail.com and role owner
-- Targets the account by either previous email or name pattern
UPDATE users
SET
    email = 'ryuuujin.sh@gmail.com',
    role = 'owner',
    updated_at = NOW()
WHERE
    email = 'manuel@mct.com'
    OR (LOWER(email) LIKE '%manuel%' AND role != 'owner')
    OR (LOWER(name) LIKE '%manuel%' AND role != 'owner');

-- Ensure if user is already at ryuuujin.sh@gmail.com, role is set to owner
UPDATE users
SET
    role = 'owner',
    updated_at = NOW()
WHERE
    email = 'ryuuujin.sh@gmail.com';

-- 3. If Supabase auth.users table is accessible, sync the email and metadata
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
        UPDATE auth.users
        SET
            email = 'ryuuujin.sh@gmail.com',
            raw_user_meta_data = jsonb_set(
                COALESCE(raw_user_meta_data, '{}'::jsonb),
                '{role}',
                '"owner"'
            ),
            raw_app_meta_data = jsonb_set(
                COALESCE(raw_app_meta_data, '{}'::jsonb),
                '{role}',
                '"owner"'
            ),
            updated_at = NOW()
        WHERE
            email = 'manuel@mct.com'
            OR email = 'ryuuujin.sh@gmail.com';
    END IF;
END $$;

-- 4. Record migration in schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES ('0029_owner_role_and_account_migration', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;

