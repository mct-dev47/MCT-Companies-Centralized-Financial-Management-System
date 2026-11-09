-- Migration 0038: Petty Cash Excess Reimbursements and Intercompany Funding (PostgreSQL)

-- 1. Create intercompany_transfers table
CREATE TABLE IF NOT EXISTS intercompany_transfers (
    transfer_id BIGSERIAL PRIMARY KEY,
    source_company_id BIGINT NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    destination_company_id BIGINT NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    source_bank_id VARCHAR(100) NOT NULL REFERENCES bank_accounts(id),
    destination_bank_id VARCHAR(100) NULL REFERENCES bank_accounts(id),
    source_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    destination_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    reversal_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    repayment_source_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    repayment_destination_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    linked_topup_id BIGINT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    transfer_type VARCHAR(50) NOT NULL,
    reference_no VARCHAR(100) NOT NULL UNIQUE,
    transfer_status VARCHAR(50) NOT NULL DEFAULT 'NOT_APPLICABLE',
    settlement_status VARCHAR(50) NOT NULL DEFAULT 'UNSETTLED',
    initiated_by VARCHAR(150) NOT NULL,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by VARCHAR(150) NULL,
    received_at TIMESTAMPTZ NULL,
    settled_at TIMESTAMPTZ NULL,
    repaid_by VARCHAR(150) NULL,
    notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_ict_source_company ON intercompany_transfers(source_company_id);
CREATE INDEX IF NOT EXISTS idx_ict_dest_company ON intercompany_transfers(destination_company_id);
CREATE INDEX IF NOT EXISTS idx_ict_transfer_status ON intercompany_transfers(transfer_status);
CREATE INDEX IF NOT EXISTS idx_ict_settlement_status ON intercompany_transfers(settlement_status);
CREATE INDEX IF NOT EXISTS idx_ict_linked_topup ON intercompany_transfers(linked_topup_id);

-- 2. Add columns to petty_cash_topups
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS total_expenses NUMERIC(15, 2) NULL;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS company_funded_amount NUMERIC(15, 2) NULL DEFAULT 0.00;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS employee_out_of_pocket NUMERIC(15, 2) NULL DEFAULT 0.00;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC(15, 2) NULL DEFAULT 0.00;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS amount_reimbursed NUMERIC(15, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS existing_expense_id BIGINT NULL REFERENCES expenses(expense_id);
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS petty_cash_expense_id BIGINT NULL REFERENCES expenses(expense_id);
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS reimbursement_expense_id BIGINT NULL REFERENCES expenses(expense_id);
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS payment_method_option VARCHAR(50) NULL;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS destination_bank_id VARCHAR(100) NULL REFERENCES bank_accounts(id);
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS intercompany_transfer_id BIGINT NULL REFERENCES intercompany_transfers(transfer_id);
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS reimbursed_at TIMESTAMPTZ NULL;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS reimbursed_by VARCHAR(150) NULL;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS transfer_received_at TIMESTAMPTZ NULL;
ALTER TABLE petty_cash_topups ADD COLUMN IF NOT EXISTS transfer_received_by VARCHAR(150) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_existing_expense_id ON petty_cash_topups(existing_expense_id) WHERE existing_expense_id IS NOT NULL;

-- 3. Add linked_topup_id and partial unique index on expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS linked_topup_id BIGINT NULL REFERENCES petty_cash_topups(topup_id);
CREATE INDEX IF NOT EXISTS idx_expenses_linked_topup ON expenses(linked_topup_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_reference_no ON expenses(reference_no) WHERE reference_no IS NOT NULL;

