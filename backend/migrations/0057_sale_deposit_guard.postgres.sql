-- 0055_sale_deposit_guard.postgres.sql
-- A sale's deposit status may only change together with a matching deposit date (Deposited has one,
-- Not Deposited has none). Every API path changes both together; the old startup backfill (still on any
-- checkout older than this fix) flipped only the status, so the ledger and bank stopped matching.
-- An inconsistent status change is skipped. Built by the runner from app/db/sale_status_guard.py.

CREATE OR REPLACE FUNCTION guard_sale_deposit_status() RETURNS trigger AS $$
BEGIN
    IF NEW.deposit_status IS DISTINCT FROM OLD.deposit_status AND ((NEW.deposit_status = 'Deposited' AND NEW.deposit_date IS NULL) OR (NEW.deposit_status <> 'Deposited' AND NEW.deposit_date IS NOT NULL)) THEN
        RAISE WARNING USING MESSAGE = 'Skipped deposit status change on sale ' || OLD.sales_id || ' (no matching deposit date)';
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sales_deposit_guard ON sales;
CREATE TRIGGER trg_sales_deposit_guard BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION guard_sale_deposit_status();
