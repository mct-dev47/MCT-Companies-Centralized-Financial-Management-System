-- 0064_company_categories.sqlite.sql
-- Dedicated per-company, per-type (sales/expense) categories table for SQLite

CREATE TABLE IF NOT EXISTS company_categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    company_name VARCHAR(100),
    category_type VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_company_category_type_name UNIQUE (company_id, category_type, name)
);

CREATE INDEX IF NOT EXISTS ix_company_categories_company_type
    ON company_categories (company_id, category_type);

