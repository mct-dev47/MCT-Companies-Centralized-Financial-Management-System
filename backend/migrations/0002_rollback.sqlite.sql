-- SQLite Rollback 0002
DROP TABLE IF EXISTS invitation_outbox;
DROP TABLE IF EXISTS user_invitations;
DELETE FROM schema_migrations WHERE version = '0002_user_status_and_invitations';

