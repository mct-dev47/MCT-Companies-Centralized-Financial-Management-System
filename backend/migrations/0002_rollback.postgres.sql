BEGIN;
-- Safeguard: Ensure no unconfirmed users remain in PROVISIONED or INVITED without tracking
UPDATE users SET status = 'ACTIVE' WHERE status IN ('PROVISIONED', 'INVITED');
DROP TABLE IF EXISTS invitation_outbox;
DROP TABLE IF EXISTS user_invitations;
ALTER TABLE users DROP COLUMN IF EXISTS status;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
DELETE FROM schema_migrations WHERE version = '0002_user_status_and_invitations';
COMMIT;

