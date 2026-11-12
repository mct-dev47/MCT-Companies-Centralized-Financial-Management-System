-- Migration 0038: Petty Cash Excess Reimbursements and Intercompany Funding (SQLite)

-- 1. Create intercompany_transfers table
CREATE TABLE IF NOT EXISTS intercompany_transfers (
    transfer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_company_id INTEGER NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    destination_company_id INTEGER NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
    source_bank_id VARCHAR(100) NOT NULL REFERENCES bank_accounts(id),
    destination_bank_id VARCHAR(100) NULL REFERENCES bank_accounts(id),
    source_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    destination_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    reversal_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    repayment_source_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    repayment_destination_bank_tx_id VARCHAR(100) NULL REFERENCES bank_transactions(id),
    linked_topup_id INTEGER NULL,
    amount NUMERIC(15, 2) NOT NULL,
    transfer_type VARCHAR(50) NOT NULL,
    reference_no VARCHAR(100) NOT NULL UNIQUE,
    transfer_status VARCHAR(50) NOT NULL DEFAULT 'NOT_APPLICABLE',
    settlement_status VARCHAR(50) NOT NULL DEFAULT 'UNSETTLED',
    initiated_by VARCHAR(150) NOT NULL,
    initiated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_by VARCHAR(150) NULL,
    received_at DATETIME NULL,
    settled_at DATETIME NULL,
    repaid_by VARCHAR(150) NULL,
    notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_ict_source_company ON intercompany_transfers(source_company_id);
CREATE INDEX IF NOT EXISTS idx_ict_dest_company ON intercompany_transfers(destination_company_id);
CREATE INDEX IF NOT EXISTS idx_ict_transfer_status ON intercompany_transfers(transfer_status);
CREATE INDEX IF NOT EXISTS idx_ict_settlement_status ON intercompany_transfers(settlement_status);
CREATE INDEX IF NOT EXISTS idx_ict_linked_topup ON intercompany_transfers(linked_topup_id);

-- Note: In SQLite, columns are added via programmatic inspection in migrations.py/session.py or ALTER TABLE statements

