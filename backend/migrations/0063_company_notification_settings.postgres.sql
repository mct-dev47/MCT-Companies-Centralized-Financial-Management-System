-- 0063_company_notification_settings.postgres.sql (spec 0042)
-- Dedicated company notification alert preferences table with cascade deletion

CREATE TABLE IF NOT EXISTS company_notification_settings (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL UNIQUE REFERENCES company(company_id) ON DELETE CASCADE,
    transaction_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    loan_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    daily_summary BOOLEAN NOT NULL DEFAULT FALSE,
    audit_alerts BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

