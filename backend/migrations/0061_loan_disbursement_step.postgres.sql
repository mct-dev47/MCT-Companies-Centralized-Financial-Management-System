-- 0061_loan_disbursement_step.postgres.sql (spec 0046)
-- Audit approval no longer moves money. Finance disburses an Approved loan, which sets it to Disbursed.

ALTER TABLE loan ADD COLUMN IF NOT EXISTS disbursed_by VARCHAR(100) NULL;
ALTER TABLE loan ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ NULL;

-- Before this step, Audit approval moved the money, so every loan already Approved is disbursed.
UPDATE loan SET status = 'Disbursed', disbursed_at = COALESCE(disbursed_at, audit_reviewed_at) WHERE status = 'Approved';
