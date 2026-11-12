-- Migration 0031: Add audit review fields to borrowers table
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) DEFAULT 'Pending Audit';
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS audited_by VARCHAR(100);
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS audit_remarks TEXT;

