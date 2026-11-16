-- 0066_company_categories_dashboard_indexes.sqlite.sql
-- Composite and lookup indexes for company_categories, category, and sales dashboard aggregations (SQLite)

CREATE INDEX IF NOT EXISTS idx_company_categories_company_type_name
  ON company_categories (company_id, category_type, name);

CREATE INDEX IF NOT EXISTS idx_category_name
  ON category (name);

CREATE INDEX IF NOT EXISTS idx_sales_company_category_date
  ON sales (company_id, category_id, transaction_date DESC);
