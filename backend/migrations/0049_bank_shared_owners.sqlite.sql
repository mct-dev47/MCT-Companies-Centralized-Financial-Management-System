-- 0049_bank_shared_owners.sqlite.sql
-- A bank account can be owned by more than one company. `company_names` holds the full owner list (JSON array text);
-- `company_name` stays as the primary owner. Each bank entry records which company it belongs to.

ALTER TABLE bank_accounts ADD COLUMN company_names TEXT NULL;
ALTER TABLE bank_transactions ADD COLUMN company_name VARCHAR(255) NULL;

