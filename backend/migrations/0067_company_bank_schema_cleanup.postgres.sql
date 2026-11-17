-- Migration 0067: Drop unused company & bank_accounts columns and link bank_accounts.company_id -> company(company_id)

ALTER TABLE company DROP COLUMN IF EXISTS contact_person CASCADE;
ALTER TABLE company DROP COLUMN IF EXISTS email CASCADE;
ALTER TABLE company DROP COLUMN IF EXISTS current_balance CASCADE;
ALTER TABLE company DROP COLUMN IF EXISTS starting_balance CASCADE;

ALTER TABLE bank_accounts DROP COLUMN IF EXISTS account_number CASCADE;
ALTER TABLE bank_accounts DROP COLUMN IF EXISTS notes CASCADE;

UPDATE bank_accounts
SET company_id = NULL
WHERE company_id IS NOT NULL
  AND company_id NOT IN (SELECT company_id FROM company);

ALTER TABLE bank_accounts ALTER COLUMN company_id TYPE BIGINT;

ALTER TABLE bank_accounts DROP CONSTRAINT IF EXISTS fk_bank_accounts_company_id;
ALTER TABLE bank_accounts
    ADD CONSTRAINT fk_bank_accounts_company_id
    FOREIGN KEY (company_id)
    REFERENCES company(company_id)
    ON DELETE SET NULL;
