-- Migration 0052: Update Admin Account Email (SQLite)

UPDATE users
SET
    email = 'manuelctolentino1947@gmail.com'
WHERE
    role = 'admin';
