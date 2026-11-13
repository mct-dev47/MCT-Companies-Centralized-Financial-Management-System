-- 0059_bill_payment_funding.postgres.sql
-- A bill payment records where the money came from (a company bank account or petty cash) and the
-- paid expense that moves that money (bank entry / petty cash balance) and shows it in Transactions.

ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS funding_source VARCHAR(20) NULL;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(100) NULL;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS expense_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS ix_bill_payments_bank_account_id ON bill_payments (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_bill_payments_expense_id ON bill_payments (expense_id);
