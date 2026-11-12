-- 0050_receivables_sale_cascade.postgres.sql
-- Deleting a sale must delete the receivables created from it. The old FK was ON DELETE SET NULL, which turned
-- them into orphan "standalone" receivables whenever a sale was removed outside the API (e.g. a table clear).
-- Receivables with no sale (sale_id IS NULL) are untouched. receivable_payments already cascade from receivables.

DO $$
DECLARE c text;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'receivables'::regclass AND contype = 'f' AND confrelid = 'sales'::regclass
    LOOP
        EXECUTE 'ALTER TABLE receivables DROP CONSTRAINT ' || quote_ident(c);
    END LOOP;
    ALTER TABLE receivables
        ADD CONSTRAINT receivables_sale_id_fkey
        FOREIGN KEY (sale_id) REFERENCES sales (sales_id) ON DELETE CASCADE;
END $$;
