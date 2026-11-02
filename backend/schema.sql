-- MCT Centralized Financial Management System Database Schema
-- Execute this SQL script in Supabase SQL Editor

-- 1. Company Table
CREATE TABLE IF NOT EXISTS company (
    company_id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL,
    contact_number VARCHAR(11),
    phone VARCHAR(8),
    starting_balance NUMERIC(15, 2) NOT NULL,
    petty_cash NUMERIC(15, 2) DEFAULT 0.00,
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT REFERENCES company(company_id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'company',
    photo_url TEXT,
    last_login_at TIMESTAMPTZ,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.1 User Companies (Many-to-Many Assignment)
CREATE TABLE IF NOT EXISTS user_companies (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id BIGINT NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_company UNIQUE (user_id, company_id)
);


-- 4. Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    audit_log_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT REFERENCES company(company_id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Category Table
CREATE TABLE IF NOT EXISTS category (
    category_id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Cash Inflow Table
CREATE TABLE IF NOT EXISTS cash_inflow (
    cash_transaction_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    transaction_date DATE NOT NULL,
    transaction_type VARCHAR(100) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    reference_no VARCHAR(100),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Sales Table
CREATE TABLE IF NOT EXISTS sales (
    sales_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    category_id BIGINT REFERENCES category(category_id) ON DELETE SET NULL,
    transaction_date DATE NOT NULL,
    cheque_no VARCHAR(100),
    payment_method VARCHAR(100),
    amount NUMERIC(15, 2) NOT NULL,
    particulars TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
    expense_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    category_id BIGINT REFERENCES category(category_id) ON DELETE SET NULL,
    created_by BIGINT,
    payment_method VARCHAR(100),
    expense_date DATE NOT NULL,
    reference_no VARCHAR(100),
    amount NUMERIC(15, 2) NOT NULL,
    amount_paid NUMERIC(15, 2) DEFAULT 0.00,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Budget Table
CREATE TABLE IF NOT EXISTS budget (
    budget_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    category_id BIGINT REFERENCES category(category_id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    period_type VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Loan Table
CREATE TABLE IF NOT EXISTS loan (
    loan_id BIGSERIAL PRIMARY KEY,
    borrower BIGINT NOT NULL,
    lender BIGINT NOT NULL,
    loan_ref_no VARCHAR(100) UNIQUE,
    principal_amount NUMERIC(15, 2) NOT NULL,
    interest_rate NUMERIC(5, 2) DEFAULT 0.00,
    interest_type VARCHAR(50) DEFAULT 'simple',
    loan_date DATE NOT NULL,
    due_date DATE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Loans Repayments Table
CREATE TABLE IF NOT EXISTS loans_repayments (
    loan_repayment_id BIGSERIAL PRIMARY KEY,
    loan_id BIGINT REFERENCES loan(loan_id) ON DELETE CASCADE,
    recorded_by BIGINT,
    payment_date DATE NOT NULL,
    due_date DATE,
    remaining_balance NUMERIC(15, 2) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    reference_no VARCHAR(100),
    status VARCHAR(50) DEFAULT 'completed',
    received_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Staff Credits Table
CREATE TABLE IF NOT EXISTS staff_credits (
    staff_credit_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    credit_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(50) DEFAULT 'active',
    purpose TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Staff Credits Repayment Table
CREATE TABLE IF NOT EXISTS staff_credits_repayment (
    repayment_id BIGSERIAL PRIMARY KEY,
    staff_credit_id BIGINT REFERENCES staff_credits(staff_credit_id) ON DELETE CASCADE,
    payment_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    payment_method VARCHAR(50),
    reference_no VARCHAR(100),
    status VARCHAR(50) DEFAULT 'completed',
    received_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Bills Table
CREATE TABLE IF NOT EXISTS bills (
    bill_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    bill_name VARCHAR(255) NOT NULL,
    amount NUMERIC(15, 2) DEFAULT 0.00,
    recurring VARCHAR(50) NOT NULL DEFAULT 'monthly',
    due_date DATE NOT NULL,
    due_date_reminder INTEGER NOT NULL DEFAULT 3,
    notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bills_due_date_reminder_nonnegative CHECK (due_date_reminder >= 0)
);

-- 15. Bill Payments Table
CREATE TABLE IF NOT EXISTS bill_payments (
    bill_payment_id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(bill_id) ON DELETE CASCADE,
    period_key VARCHAR(20) NOT NULL,
    payment_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    billed_amount NUMERIC(15, 2),
    payment_method VARCHAR(50) NOT NULL,
    reference_no VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bill_payments_amount_positive CHECK (amount > 0)
);

-- 16. Petty Cash Top-ups (sales cash moved into a company's petty cash wallet)
CREATE TABLE IF NOT EXISTS petty_cash_topups (
    topup_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    topup_date DATE NOT NULL,
    reference_no VARCHAR(100),
    description TEXT,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT petty_cash_topups_amount_positive CHECK (amount > 0)
);

-- 17. Petty Cash Wallets (per-company settings; balance is computed from top-ups and petty cash expenses)
CREATE TABLE IF NOT EXISTS petty_cash_wallets (
    wallet_id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL UNIQUE REFERENCES company(company_id) ON DELETE CASCADE,
    low_balance_threshold NUMERIC(15, 2) NOT NULL DEFAULT 1000,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
