-- 0040_sales_expenses_remarks.postgres.sql
-- Add operational remarks column to sales and expenses

ALTER TABLE sales ADD COLUMN IF NOT EXISTS remarks TEXT NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS remarks TEXT NULL;

