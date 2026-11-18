-- 0074_loan_repayment_links.postgres.sql
ALTER TABLE loans_repayments ADD COLUMN IF NOT EXISTS expense_id INTEGER REFERENCES expenses(expense_id) ON DELETE SET NULL;
ALTER TABLE loans_repayments ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(100);
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS source_loan_repayment_id INTEGER;

CREATE INDEX IF NOT EXISTS ix_loans_repayments_expense_id ON loans_repayments (expense_id);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_loan_repayment_id ON bank_transactions (source_loan_repayment_id);
