-- 0074_loan_repayment_links.sqlite.sql
-- In SQLite, columns are added via Python migration checks in app/db/session.py if missing
-- ALTER TABLE loans_repayments ADD COLUMN expense_id INTEGER REFERENCES expenses(expense_id) ON DELETE SET NULL;
-- ALTER TABLE loans_repayments ADD COLUMN bank_account_id VARCHAR(100);
-- ALTER TABLE bank_transactions ADD COLUMN source_loan_repayment_id INTEGER;
CREATE INDEX IF NOT EXISTS ix_loans_repayments_expense_id ON loans_repayments (expense_id);
CREATE INDEX IF NOT EXISTS ix_bank_transactions_source_loan_repayment_id ON bank_transactions (source_loan_repayment_id);
