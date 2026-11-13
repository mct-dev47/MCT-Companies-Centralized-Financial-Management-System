-- 0060_income_bank_links.postgres.sql (spec 0045)
-- Tenant rent payments and borrower repayments become Sales on a chosen bank; a loan release becomes an
-- Expense on the borrower's bank. These columns hold the chosen bank and the linked sale / expense.

ALTER TABLE tenant_leases ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(100) NULL;
ALTER TABLE tenant_lease_payments ADD COLUMN IF NOT EXISTS sale_id INTEGER NULL;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS bank_account_id VARCHAR(100) NULL;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS release_expense_id INTEGER NULL;
ALTER TABLE lending_transactions ADD COLUMN IF NOT EXISTS sale_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS ix_tenant_lease_payments_sale_id ON tenant_lease_payments (sale_id);
CREATE INDEX IF NOT EXISTS ix_lending_transactions_sale_id ON lending_transactions (sale_id);
CREATE INDEX IF NOT EXISTS ix_borrowers_release_expense_id ON borrowers (release_expense_id);
