-- 0043_sales_deposit_date.postgres.sql
-- Track the day a sale's money reached the bank separately from the day the sale happened.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_date DATE NULL;

-- Historical deposited sales: assume the money arrived on the sale date
UPDATE sales SET deposit_date = transaction_date
WHERE deposit_status = 'Deposited' AND deposit_date IS NULL;
