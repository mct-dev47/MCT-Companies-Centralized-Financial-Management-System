-- 0054_bank_entries_cascade.postgres.sql
-- Deleting a sale or expense (from the API or anywhere else) deletes its bank entries and re-derives the bank
-- balance, so the bank never keeps money the Transactions ledger no longer counts.
-- The runner builds this from app/db/bank_cascade.py (one source of truth with the SQLite version);
-- this file documents the result.

CREATE OR REPLACE FUNCTION purge_bank_entries_of_deleted_sales() RETURNS trigger AS $$
BEGIN
    UPDATE bank_accounts SET current_balance = starting_balance + COALESCE((SELECT SUM(COALESCE(t.deposit, 0) - COALESCE(t.withdrawal, 0)) FROM bank_transactions t WHERE t.bank_account_id = bank_accounts.id AND (t.source_sale_id IS NULL OR t.source_sale_id <> OLD.sales_id)), 0) WHERE id IN (SELECT bank_account_id FROM bank_transactions WHERE source_sale_id = OLD.sales_id); DELETE FROM bank_transactions WHERE source_sale_id = OLD.sales_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sales_bank_cascade ON sales;
CREATE TRIGGER trg_sales_bank_cascade AFTER DELETE ON sales FOR EACH ROW EXECUTE FUNCTION purge_bank_entries_of_deleted_sales();

CREATE OR REPLACE FUNCTION purge_bank_entries_of_deleted_expenses() RETURNS trigger AS $$
BEGIN
    UPDATE bank_accounts SET current_balance = starting_balance + COALESCE((SELECT SUM(COALESCE(t.deposit, 0) - COALESCE(t.withdrawal, 0)) FROM bank_transactions t WHERE t.bank_account_id = bank_accounts.id AND (t.source_expense_id IS NULL OR t.source_expense_id <> OLD.expense_id)), 0) WHERE id IN (SELECT bank_account_id FROM bank_transactions WHERE source_expense_id = OLD.expense_id); DELETE FROM bank_transactions WHERE source_expense_id = OLD.expense_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_expenses_bank_cascade ON expenses;
CREATE TRIGGER trg_expenses_bank_cascade AFTER DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION purge_bank_entries_of_deleted_expenses();
