-- Migration 0036: Expand tenant_lease_payments status column to VARCHAR(20) to support 'Partially Paid'
ALTER TABLE tenant_lease_payments ALTER COLUMN status TYPE VARCHAR(20);

