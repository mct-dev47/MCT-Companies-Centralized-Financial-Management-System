-- Spec 0030: Refine Lending Page Tables and Payment Validation
-- Add nullable recorded_by column to lending_transactions

ALTER TABLE public.lending_transactions
    ADD COLUMN IF NOT EXISTS recorded_by VARCHAR(255);

