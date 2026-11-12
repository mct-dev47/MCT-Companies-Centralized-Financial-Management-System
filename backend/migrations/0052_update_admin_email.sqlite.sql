-- Migration 0052: Synchronize Admin Role & is_admin Flag (SQLite)

UPDATE users
SET
    is_admin = 1,
    role = 'admin'
WHERE
    is_admin = 1
    OR LOWER(COALESCE(role, '')) = 'admin';
