-- 0052_client_ref_idempotency.postgres.sql
-- A unique ID the browser attaches to each new sale, expense, or receivable (spec 0038).
-- Sending the same client_ref twice returns the existing row, so offline retries never create duplicates.
-- Unique indexes allow many NULLs, so existing rows and callers that send no client_ref are unaffected.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_client_ref ON sales (client_ref);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_expenses_client_ref ON expenses (client_ref);

ALTER TABLE receivables ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_receivables_client_ref ON receivables (client_ref);
