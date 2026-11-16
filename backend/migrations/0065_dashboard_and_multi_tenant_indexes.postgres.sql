-- 0065_dashboard_and_multi_tenant_indexes.postgres.sql
-- High-performance composite indexes for multi-tenant company isolation and dashboard aggregations

CREATE INDEX IF NOT EXISTS idx_sales_company_paid_status_date
  ON sales (company_id, payment_status, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_company_deposit_date
  ON sales (company_id, deposit_status, deposit_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_company_category_date
  ON expenses (company_id, category_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_petty_cash_topups_company_date
  ON petty_cash_topups (company_id, topup_date DESC);

CREATE INDEX IF NOT EXISTS idx_bills_company_status_due_date
  ON bills (company_id, status, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_loan_borrower_status_date
  ON loan (borrower, status, loan_date DESC);

CREATE INDEX IF NOT EXISTS idx_loan_lender_status_date
  ON loan (lender, status, loan_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_company_id
  ON bank_accounts (company_id);

CREATE INDEX IF NOT EXISTS idx_receivables_company_payment_status
  ON receivables (company_id, payment_status);
