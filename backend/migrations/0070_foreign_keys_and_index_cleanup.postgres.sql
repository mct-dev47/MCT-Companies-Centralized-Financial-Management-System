-- 0070: Harden foreign keys, drop duplicate indexes, and add composite pagination indexes (PostgreSQL)

-- 1. Drop duplicate/redundant indexes
DROP INDEX IF EXISTS idx_bank_accounts_company_id;
DROP INDEX IF EXISTS idx_notifications_recipient_feed;

-- 2. Add missing foreign keys idempotently (0 orphan rows verified)
DO $$
BEGIN
    -- Core company ownership FKs (ON DELETE RESTRICT)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_company_id') THEN
        ALTER TABLE sales ADD CONSTRAINT fk_sales_company_id
            FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_expenses_company_id') THEN
        ALTER TABLE expenses ADD CONSTRAINT fk_expenses_company_id
            FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_daily_remarks_company_id') THEN
        ALTER TABLE daily_remarks ADD CONSTRAINT fk_daily_remarks_company_id
            FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loan_borrower_company') THEN
        ALTER TABLE loan ADD CONSTRAINT fk_loan_borrower_company
            FOREIGN KEY (borrower) REFERENCES company(company_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_loan_lender_company') THEN
        ALTER TABLE loan ADD CONSTRAINT fk_loan_lender_company
            FOREIGN KEY (lender) REFERENCES company(company_id) ON DELETE RESTRICT;
    END IF;

    -- Optional cross-links (ON DELETE SET NULL)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_bank_account_id') THEN
        ALTER TABLE sales ADD CONSTRAINT fk_sales_bank_account_id
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_expenses_bank_account_id') THEN
        ALTER TABLE expenses ADD CONSTRAINT fk_expenses_bank_account_id
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bill_payments_bank_account_id') THEN
        ALTER TABLE bill_payments ADD CONSTRAINT fk_bill_payments_bank_account_id
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_bill_payments_expense_id') THEN
        ALTER TABLE bill_payments ADD CONSTRAINT fk_bill_payments_expense_id
            FOREIGN KEY (expense_id) REFERENCES expenses(expense_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_borrowers_bank_account_id') THEN
        ALTER TABLE borrowers ADD CONSTRAINT fk_borrowers_bank_account_id
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_borrowers_release_expense_id') THEN
        ALTER TABLE borrowers ADD CONSTRAINT fk_borrowers_release_expense_id
            FOREIGN KEY (release_expense_id) REFERENCES expenses(expense_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lending_transactions_sale_id') THEN
        ALTER TABLE lending_transactions ADD CONSTRAINT fk_lending_transactions_sale_id
            FOREIGN KEY (sale_id) REFERENCES sales(sales_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenant_leases_bank_account_id') THEN
        ALTER TABLE tenant_leases ADD CONSTRAINT fk_tenant_leases_bank_account_id
            FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenant_lease_payments_sale_id') THEN
        ALTER TABLE tenant_lease_payments ADD CONSTRAINT fk_tenant_lease_payments_sale_id
            FOREIGN KEY (sale_id) REFERENCES sales(sales_id) ON DELETE SET NULL;
    END IF;
END $$;

-- 3. Composite indexes for deterministic pagination and sorting
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
    ON audit_logs (company_id, created_at DESC, audit_log_id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_id
    ON audit_logs (created_at DESC, audit_log_id DESC);
CREATE INDEX IF NOT EXISTS idx_loans_repayments_loan_date
    ON loans_repayments (loan_id, payment_date DESC, loan_repayment_id DESC);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date_id
    ON bank_transactions (bank_account_id, transaction_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lending_tx_borrower_date
    ON lending_transactions (borrower_id, payment_date DESC, transaction_id DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_payments_lease_date
    ON tenant_lease_payments (lease_id, payment_date DESC, payment_id DESC);
