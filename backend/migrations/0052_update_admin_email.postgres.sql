-- Migration 0052: Dynamically Synchronize Admin Role & Email from Supabase is_admin (PostgreSQL)
-- Ensures public.users and auth.users stay aligned using the `is_admin` flag without hardcoded emails.

DO $$
DECLARE
    supa_admin_email TEXT;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    ) THEN
        UPDATE public.users
        SET
            is_admin = TRUE,
            role = 'admin',
            updated_at = NOW()
        WHERE
            is_admin IS TRUE
            OR LOWER(COALESCE(role, '')) = 'admin';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'users'
    ) THEN
        -- Ensure auth.users records flagged with is_admin have consistent role metadata
        UPDATE auth.users
        SET
            raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true, "role": "admin"}'::jsonb,
            updated_at = NOW()
        WHERE
            (raw_user_meta_data->>'is_admin')::boolean IS TRUE
            OR (raw_app_meta_data->>'is_admin')::boolean IS TRUE
            OR LOWER(COALESCE(raw_user_meta_data->>'role', '')) = 'admin'
            OR LOWER(COALESCE(raw_app_meta_data->>'role', '')) = 'admin';

        -- Sync email from Supabase auth.users where is_admin is true into public.users if a single admin exists
        SELECT email INTO supa_admin_email
        FROM auth.users
        WHERE
            (raw_user_meta_data->>'is_admin')::boolean IS TRUE
            OR (raw_app_meta_data->>'is_admin')::boolean IS TRUE
            OR LOWER(COALESCE(raw_user_meta_data->>'role', '')) = 'admin'
            OR LOWER(COALESCE(raw_app_meta_data->>'role', '')) = 'admin'
        ORDER BY created_at ASC
        LIMIT 1;

        IF supa_admin_email IS NOT NULL AND supa_admin_email <> '' THEN
            UPDATE public.users
            SET
                email = supa_admin_email,
                is_admin = TRUE,
                role = 'admin',
                updated_at = NOW()
            WHERE
                (is_admin IS TRUE OR LOWER(COALESCE(role, '')) = 'admin')
                AND (SELECT COUNT(*) FROM public.users WHERE is_admin IS TRUE OR LOWER(COALESCE(role, '')) = 'admin') = 1
                AND NOT EXISTS (
                    SELECT 1 FROM public.users u2
                    WHERE LOWER(u2.email) = LOWER(supa_admin_email)
                      AND NOT (u2.is_admin IS TRUE OR LOWER(COALESCE(u2.role, '')) = 'admin')
                );
        END IF;
    END IF;
END $$;
