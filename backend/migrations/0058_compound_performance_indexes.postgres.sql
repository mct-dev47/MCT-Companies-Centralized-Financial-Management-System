-- 0058_compound_performance_indexes.postgres.sql
-- Optimizes high-frequency filtered ledger queries and date-range reporting

CREATE INDEX IF NOT EXISTS idx_sales_company_transaction_date 
  ON sales (company_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_company_deposit_status 
  ON sales (company_id, deposit_status, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_company_expense_date 
  ON expenses (company_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date 
  ON bank_transactions (bank_account_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bills_company_due_date 
  ON bills (company_id, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_loan_borrower_date 
  ON loan (borrower, loan_date DESC);

CREATE INDEX IF NOT EXISTS idx_loan_lender_date 
  ON loan (lender, loan_date DESC);

