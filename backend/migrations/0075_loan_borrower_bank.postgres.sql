-- Store the borrower's chosen receiving bank account on loan requests.
ALTER TABLE loan ADD COLUMN IF NOT EXISTS borrower_bank_account_id VARCHAR(100) NULL;
