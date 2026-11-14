-- 0063_company_notification_settings.sqlite.sql (spec 0042)
-- Dedicated company notification alert preferences table for SQLite

CREATE TABLE IF NOT EXISTS company_notification_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE REFERENCES company(company_id) ON DELETE CASCADE,
    transaction_alerts BOOLEAN NOT NULL DEFAULT 1,
    loan_reminders BOOLEAN NOT NULL DEFAULT 1,
    daily_summary BOOLEAN NOT NULL DEFAULT 0,
    audit_alerts BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_company_notification_settings_company_id
    ON company_notification_settings (company_id);

