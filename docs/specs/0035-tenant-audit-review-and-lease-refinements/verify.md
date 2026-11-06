# Verify: Tenant Audit Review and Lease Refinements (spec 0035, updated 2026-11-06)
Steps derived from spec 0035 acceptance criteria and value sourcing. /check verify runs these, and /test locks the durable ones.

## UI and manual
- [ ] Open Tenant Details for an audited lease, confirm the dedicated Audit Review card renders in the left column below Notes with Shield icon, status badge, auditor name, formatted timestamp, and discrepancy notes (AC-1)
- [ ] Open Record Payment modal, enter a future cash received date, confirm form blocks submission with validation error (AC-2)
- [ ] Open Record Payment modal, enter zero or negative payment amount, confirm validation blocks submission (AC-3)
- [ ] Open Record Payment modal, enter payment amount exceeding remaining balance, confirm validation blocks submission (AC-3)
- [ ] Open Record Payment modal, submit without payment method, confirm validation blocks submission (AC-4)
- [ ] Open Record Payment modal, verify reference number remains optional (AC-4)
- [ ] Open Record Payment modal, enter remarks, confirm live character counter reflects length and restricts input to 50 characters (AC-5)
- [ ] Open Edit Tenant Lease modal for a lease with payments, confirm Rent Amount, Total Payable, Payment Schedule, Date Contracted, First Due Date, and Lease End Date are locked in read only mode (AC-6)
- [ ] Open New Tenant Lease modal, confirm Payment Schedule select offers strictly Daily and Monthly (AC-7)
- [ ] Open Edit Tenant Lease modal, confirm Payment Schedule select offers strictly Daily and Monthly (AC-7)
- [ ] Open New Tenant Lease modal, confirm Date Contracted and Lease End Date are positioned side by side on row one (AC-8)
- [ ] Open New Tenant Lease modal, confirm First Due Date and Status are positioned side by side on row two (AC-9)
- [ ] Open New Tenant Lease and Edit Tenant Lease modals, confirm late penalty field is completely removed (AC-10)
- [ ] Open New Tenant Lease modal, confirm the gray schedule summary container card is completely removed (AC-11)
- [ ] Submit New Tenant Lease with empty fields, short name, or end date before first due date, confirm field level validation displays descriptive errors (AC-12)
- [ ] Submit an audit review for a lease, reload the page from Supabase, confirm auditor name, audit timestamp, and discrepancy notes persist accurately (AC-13, AC-14)

## Commands
- [x] `Get-Content backend\migrations\0035_tenant_leases_audit_fields.sql` confirms SQL migration for audit fields exists (AC-13)
- [x] `$env:PYTHONPATH = "backend"; .\.venv\Scripts\python.exe -c "import py_compile; py_compile.compile('backend/app/db/session.py', doraise=True); print('OK')"` verifies session startup check compiles cleanly (AC-13)

## Acceptance criteria coverage
- AC-1 covered by Audit Review card in left summary column
- AC-2 covered by cash received date validation
- AC-3 covered by positive amount and remaining balance checks
- AC-4 covered by required payment method and optional reference number
- AC-5 covered by remarks live counter and 50 character cap
- AC-6 covered by read only locking on core lease terms when payments exist
- AC-7 covered by Daily and Monthly options in Payment Schedule
- AC-8 covered by row one date alignment
- AC-9 covered by row two date and status alignment
- AC-10 covered by complete removal of late penalty field
- AC-11 covered by complete removal of schedule summary container card
- AC-12 covered by input validation rules across all fields
- AC-13 covered by migration 0035 and session database column checks
- AC-14 covered by Supabase API data persistence

