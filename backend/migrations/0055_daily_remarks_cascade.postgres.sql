-- 0053_daily_remarks_cascade.postgres.sql
-- A day remark belongs to a company's sales (or expenses) on that day. When the last sale/expense of the day is
-- deleted (or moved to another day/company), its remark is deleted too. A trigger covers deletes made outside the
-- API. Existing orphan remarks are cleaned once; that cleanup only runs when the table holds rows, so a database
-- whose sales live elsewhere does not lose its remarks.

CREATE OR REPLACE FUNCTION purge_orphan_sales_daily_remark() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sales WHERE company_id = OLD.company_id AND transaction_date = OLD.transaction_date
    ) THEN
        DELETE FROM daily_remarks
        WHERE company_id = OLD.company_id AND remark_date = OLD.transaction_date AND kind = 'sales';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION purge_orphan_expense_daily_remark() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM expenses WHERE company_id = OLD.company_id AND expense_date = OLD.expense_date
    ) THEN
        DELETE FROM daily_remarks
        WHERE company_id = OLD.company_id AND remark_date = OLD.expense_date AND kind = 'expense';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_daily_remark_cascade ON sales;
CREATE TRIGGER trg_sales_daily_remark_cascade
    AFTER DELETE OR UPDATE OF transaction_date, company_id ON sales
    FOR EACH ROW EXECUTE FUNCTION purge_orphan_sales_daily_remark();

DROP TRIGGER IF EXISTS trg_expenses_daily_remark_cascade ON expenses;
CREATE TRIGGER trg_expenses_daily_remark_cascade
    AFTER DELETE OR UPDATE OF expense_date, company_id ON expenses
    FOR EACH ROW EXECUTE FUNCTION purge_orphan_expense_daily_remark();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM sales) THEN
        DELETE FROM daily_remarks dr
        WHERE dr.kind = 'sales'
          AND NOT EXISTS (
              SELECT 1 FROM sales s WHERE s.company_id = dr.company_id AND s.transaction_date = dr.remark_date
          );
    END IF;
    IF EXISTS (SELECT 1 FROM expenses) THEN
        DELETE FROM daily_remarks dr
        WHERE dr.kind = 'expense'
          AND NOT EXISTS (
              SELECT 1 FROM expenses e WHERE e.company_id = dr.company_id AND e.expense_date = dr.remark_date
          );
    END IF;
END $$;
