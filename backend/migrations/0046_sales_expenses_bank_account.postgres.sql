-- 0042_sales_expenses_bank_account.postgres.sql
-- Store which bank account a sale or expense belongs to, so Sales, Expense and Transactions
-- can be viewed per bank.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(100) NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(100) NULL;

CREATE INDEX IF NOT EXISTS ix_sales_bank_account_id ON sales (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_expenses_bank_account_id ON expenses (bank_account_id);

-- Backfill sales from the bank ledger entry that already points at them
UPDATE sales s
SET bank_account_id = bt.bank_account_id
FROM (
    SELECT DISTINCT ON (source_sale_id) source_sale_id, bank_account_id
    FROM bank_transactions
    WHERE source_sale_id IS NOT NULL
    ORDER BY source_sale_id, created_at
) bt
WHERE s.sales_id = bt.source_sale_id AND s.bank_account_id IS NULL;
