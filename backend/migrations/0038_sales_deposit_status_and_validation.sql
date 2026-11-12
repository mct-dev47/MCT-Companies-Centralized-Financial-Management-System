-- Migration 0038: Sales Deposit Status and Payment Validation Rules
-- Date: 2026-11-08

ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'Paid';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS deposit_status VARCHAR(50) DEFAULT 'Not Deposited';

-- Safe backfill (AC-7)
UPDATE sales SET payment_status = 'Paid' WHERE payment_status IS NULL OR payment_status = '';
UPDATE sales SET deposit_status = 'Deposited' WHERE payment_status = 'Paid' AND (deposit_status IS NULL OR deposit_status = '' OR deposit_status = 'Not Deposited');
UPDATE sales SET deposit_status = 'Not Deposited' WHERE payment_status IN ('Unpaid', 'Pending');

