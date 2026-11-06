-- Migration 0035: Add audit review fields to tenant_leases table
ALTER TABLE tenant_leases ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) DEFAULT 'Pending Audit';
ALTER TABLE tenant_leases ADD COLUMN IF NOT EXISTS audited_by VARCHAR(100);
ALTER TABLE tenant_leases ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE tenant_leases ADD COLUMN IF NOT EXISTS audit_remarks TEXT;

