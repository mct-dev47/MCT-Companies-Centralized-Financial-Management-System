-- Migration 0039: Configurable Petty Cash Categories per Company (SQLite)

CREATE TABLE IF NOT EXISTS petty_cash_categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_petty_cash_categories_company_name UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_categories_company_id ON petty_cash_categories(company_id);

