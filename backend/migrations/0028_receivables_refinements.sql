-- Spec 0028: Refine Unpaid Sales Assignment, Receivables Controls, and Bidirectional Sync
-- Safe phased migration for Supabase PostgreSQL

-- Phase 1: Add nullable sale_line_index to link each receivable to its originating line in sales.particulars
ALTER TABLE public.receivables
    ADD COLUMN IF NOT EXISTS sale_line_index INTEGER;

-- Phase 2: Drop obsolete Contact / Role personal metadata columns
ALTER TABLE public.receivables
    DROP COLUMN IF EXISTS customer_phone,
    DROP COLUMN IF EXISTS customer_role;

