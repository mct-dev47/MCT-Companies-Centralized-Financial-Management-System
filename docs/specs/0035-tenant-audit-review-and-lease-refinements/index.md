# 0035. Tenant Audit Review and Lease Refinements

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This specification introduces a dedicated Audit Review panel to the tenant details view and tightens lease management workflows. On the tenant details page, an audit review card matching FilCap Lending displays the audit badge, auditor name, timestamp, and discrepancy notes. In the record payment modal, strict validation governs payment dates, required payment methods (with reference number remaining optional), and a 50 character limit on payment remarks. In the edit lease modal, core financial and schedule terms become read only once payment transactions exist. In the new lease modal, the payment schedule is simplified to Daily and Monthly options only, late penalty fields and repeat summary boxes are removed, date fields are realigned into a balanced two column layout, and comprehensive validation is added to all inputs. All tenant records and audit reviews persist directly in Supabase without in memory or local storage dependencies.

## Requirements

**User stories**:
- As an auditor or business reviewer, I want a dedicated Audit Review section on the tenant details page so that I can immediately view audit status, reviewer name, audit timestamp, and discrepancy remarks in one consistent place.
- As a finance officer, I want payment entry fields to be validated with sensible constraints and remarks capped at 50 characters so that payment records stay accurate, standardized, and clean.
- As a business owner or finance manager, I want the core lease terms (rent amount, total payable, payment schedule, contract date, first due date, and lease end date) locked against editing once payments exist so that historical collections cannot be corrupted.
- As a property manager creating a lease, I want a streamlined form that only asks for daily or monthly schedules, arranges dates cleanly in two columns, removes unused penalty fields and summary text, and guides me with instant field validation.
- As a business owner or supervisor, I want all lease data and audit reviews stored directly in Supabase so that data is persistent, central, and free of local storage fallbacks. The Admin role does not access this operational page.

**Acceptance criteria**:
- **AC-1**: In the Tenant Details page, a dedicated Audit Review panel is displayed in the left summary column directly below Collections and Balances and Notes, presenting the Shield icon, Audit Review header, status badge (AUDITED in emerald, DISCREPANCY in crimson, or PENDING AUDIT in slate), auditor name, formatted audit timestamp, and auditor remarks box when findings exist, mirroring the FilCap Lending card design.
- **AC-2**: In the Record Payment modal (`SharedPaymentModal.tsx`), Date Cash Received is required and cannot be a future date (must be today or earlier).
- **AC-3**: In the Record Payment modal (`SharedPaymentModal.tsx`), Payment Amount is required, must be a number greater than 0, and cannot exceed the remaining balance of the lease.
- **AC-4**: In the Record Payment modal (`SharedPaymentModal.tsx`), Payment Method is required, while Reference Number remains completely optional for all payment methods.
- **AC-5**: In the Record Payment modal (`SharedPaymentModal.tsx`), the Remarks / Notes input is capped at a maximum of 50 characters, displaying a live character counter and blocking or warning on input beyond 50 characters.
- **AC-6**: In the Edit Tenant Lease Agreement modal, when a lease has one or more recorded payment transactions (`payments.length > 0` or `amountPaid > 0`), the following fields are locked in read only mode: Rent Amount, Total Payable, Payment Schedule (Repeat), Date Contracted, First Due Date, and Lease End Date.
- **AC-7**: In both the New Tenant Lease Agreement and Edit Tenant Lease Agreement modals, the Payment Schedule dropdown provides only two options: "Daily" and "Monthly", completely removing "Does not repeat", "Quarterly", and "Annually".
- **AC-8**: In the New Tenant Lease Agreement modal, Date Contracted and Lease End Date are positioned side by side on one line (Date Contracted in the left column, Lease End Date in the right column).
- **AC-9**: In the New Tenant Lease Agreement modal, First Due Date is positioned in the left column directly below Date Contracted, and the Status dropdown is positioned beside it in the right column.
- **AC-10**: In both the New Tenant Lease Agreement and Edit Tenant Lease Agreement modals, the Late Penalty field is completely removed from the form layout.
- **AC-11**: In the New Tenant Lease Agreement modal, the gray schedule summary container card (containing the statement "Repeats daily, 30 payments" and calculation lines) is completely removed.
- **AC-12**: In the New Tenant Lease Agreement modal, every input contains field level validation (Tenant Name required 2 to 100 characters; Unit Name required 1 to 50 characters; Rent Amount required positive number; Date Contracted required valid date; First Due Date required valid date on or after Date Contracted; Lease End Date required valid date on or after First Due Date; Notes optional up to 255 characters).
- **AC-13**: In the backend database, migration `0035_tenant_leases_audit_fields.sql` and `session.py` initialization ensure `audit_status`, `audited_by`, `audited_at`, and `audit_remarks` exist on table `tenant_leases`, and `tenant_service.py` persists audit submissions to Supabase and PostgreSQL.
- **AC-14**: All data displayed on the Tenant page originates from Supabase via backend API calls (`/api/v1/tenants/leases`), removing any mock data, local storage fallback, or in memory fixtures.

## Decision

**Chosen option**: Option 2: Full stack alignment with FilCap audit cards, strict input validation, and tamper proof lease locking.

Reasoning and options: see rationale.md.

**Implementation skills**: none.

## Feature design

**Data model sketch**:
The `tenant_leases` table in PostgreSQL and Supabase includes the audit review columns:
- `lease_id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `tenant_ref`: VARCHAR(30) UNIQUE NOT NULL
- `company_id`: INTEGER NOT NULL REFERENCES company(company_id)
- `tenant_name`: VARCHAR(255) NOT NULL
- `unit_name`: VARCHAR(255) NOT NULL
- `rent_amount`: NUMERIC(15, 2) NOT NULL
- `contract_date`: DATE NOT NULL
- `due_date`: DATE NOT NULL (serves as First Due Date)
- `lease_end_date`: DATE NOT NULL
- `repeat_mode`: VARCHAR(20) NOT NULL DEFAULT 'Daily' (restricted to 'Daily' or 'Monthly')
- `penalty_rate`: NUMERIC(5, 2) NULL (omitted from new form inputs)
- `total_amount_payable`: NUMERIC(15, 2) NOT NULL
- `status`: VARCHAR(20) NOT NULL DEFAULT 'Active'
- `notes`: TEXT NULL
- `audit_status`: VARCHAR(20) NOT NULL DEFAULT 'Pending Audit' ('Pending Audit', 'Verified', 'Flagged')
- `audited_by`: VARCHAR(100) NULL
- `audited_at`: TIMESTAMP WITH TIME ZONE NULL
- `audit_remarks`: TEXT NULL

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/tenants/leases` | GET | `company_name`: string (optional) | Array of `LeaseOut` objects with payments and audit fields | Bearer token (Business reader) | 401, 500 |
| `/api/v1/tenants/leases` | POST | `LeaseCreate` payload (Daily or Monthly repeat mode, validated dates) | Created `LeaseOut` object | Bearer token (Business writer) | 400, 401, 403, 500 |
| `/api/v1/tenants/leases/{id}` | PATCH | `LeaseUpdate` payload | Updated `LeaseOut` object | Bearer token (Business writer) | 400, 401, 403, 404, 409 |
| `/api/v1/tenants/leases/{id}/payments` | POST | `PaymentIn` payload (date, amount, method, reference_no, notes) | Updated `LeaseOut` object with new payment entry | Bearer token (Business writer) | 400, 401, 403, 500 |
| `/api/v1/tenants/leases/{id}/audit` | PATCH | `AuditReviewIn` payload (`audit_status`, `remarks`) | Updated `LeaseOut` object with audited_by and audited_at | Bearer token (Auditor only) | 400, 401, 403, 404, 500 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Tenant details audit review card | Shield icon, audit title, status badge | `activeTenant.auditStatus` defaulting to 'Pending Audit' |
| Tenant details audit review card | Auditor name text | `activeTenant.auditedBy` from database column |
| Tenant details audit review card | Formatted audit timestamp | `activeTenant.auditDate` derived from `audited_at` |
| Tenant details audit review card | Discrepancy findings text | `activeTenant.auditRemarks` from database column |
| Record payment date validation | Error if future date entered | Comparison with `new Date()` formatted as YYYY-MM-DD |
| Record payment method validation | Error if empty | `paymentForm.method` state selection |
| Record payment method validation | Error if not selected | `paymentForm.method` selection check |
| Record payment remarks length | Current count / 50 text and restriction | `paymentForm.notes.length` <= 50 |
| Edit lease field locked state | Read only disabled styling | `hasPayments = (activeTenant.dailyPayments?.length || 0) > 0 || (activeTenant.amountPaid || 0) > 0` |
| New lease payment schedule | Select options | Strict array `['Daily', 'Monthly']` |
| New lease date arrangement | Grid positions | First row: `contractDate` (col 1), `leaseEndDate` (col 2); Second row: `dueDate` (col 1), `status` (col 2) |
| New lease total payable | Auto calculated numeric total | Rent amount multiplied by calculated period count between `dueDate` and `leaseEndDate` |

**Key invariants**:
- When a lease has at least one recorded payment transaction, Rent Amount, Total Payable, Payment Schedule, Date Contracted, First Due Date, and Lease End Date cannot be edited under any circumstance.
- The Payment Schedule options in the user interface are strictly limited to Daily and Monthly.
- Payment remarks cannot exceed 50 characters in the UI or backend.
- Date Cash Received cannot be set in the future.
- Saving an audit review stamps the authenticated auditor name and current UTC timestamp on the server.
- The Tenant Details page renders the dedicated Audit Review card for all permitted operational roles (Owner, Supervisor, Finance, and Auditor). The Admin role has no access to this operational page.
- No dummy or mock data is returned or displayed when database records are loaded.

**Security model**:
- Reading leases and audit review details is accessible to Owner, Supervisor, Finance, and Auditor roles. Admin accounts do not access this operational page.
- Recording payments and creating or editing leases is restricted to Business Writers (Finance and Supervisor).
- Submitting an audit review is strictly restricted to Auditor users via `/api/v1/tenants/leases/{id}/audit`.
- All database operations enforce company scoping.

**Critical test scenarios**:
- Dedicated Audit Review Card: Open Tenant Details for an audited lease, verify the audit review card displays in the left summary column below Collections and Balances showing status, auditor name, date, and remarks, verifies **AC-1**.
- Record Payment Date Validation: Open Record Payment modal, select a future date, verify form blocks submission with clear validation error, verifies **AC-2**.
- Record Payment Amount Validation: Enter zero or negative amount, or an amount exceeding remaining balance, verify validation errors trigger, verifies **AC-3**.
- Record Payment Method Rule: Attempt to submit payment without selecting a Payment Method, verify validation error blocks submission; verify Reference Number remains optional for all payment methods, verifies **AC-4**.
- Record Payment Remarks 50 Character Limit: Type 51 characters in Remarks, verify character counter displays limit and extra characters are disallowed, verifies **AC-5**.
- Edit Lease Locking When Payments Exist: Open Edit Lease for a tenant with recorded payments, verify Rent Amount, Total Payable, Repeat, Date Contracted, First Due Date, and Lease End Date are disabled and read only, verifies **AC-6**.
- Payment Schedule Options: Open New Lease and Edit Lease modals, verify Payment Schedule dropdown contains only Daily and Monthly, verifies **AC-7**.
- New Lease Layout: Open New Lease modal, verify Date Contracted is on the left with Lease End Date on the right, and First Due Date is below Date Contracted with Status beside it, verifies **AC-8**, **AC-9**.
- Late Penalty Removal: Inspect New Lease and Edit Lease modals, verify Late Penalty field is completely absent, verifies **AC-10**.
- Schedule Summary Removal: Inspect New Lease modal, verify the gray summary card with "Repeats daily, 30 payments" is absent, verifies **AC-11**.
- Input Validation on New Lease: Attempt to submit New Lease with blank fields or invalid dates (such as end date before first due date), verify descriptive validation messages appear, verifies **AC-12**.
- Database Persistence: Submit an audit review, reload the page from Supabase, verify auditor name, timestamp, and remarks persist accurately, verifies **AC-13**, **AC-14**.

## Build plan

- [x] 1. Create database migration `backend/migrations/0035_tenant_leases_audit_fields.sql` and update `backend/app/db/session.py` to ensure `tenant_leases` table audit columns are verified on startup, satisfies **AC-13**.
- [x] 2. Update `frontend/src/components/common/SharedPaymentModal.tsx` to add validation preventing future dates for Date Cash Received, requiring Payment Amount greater than 0 up to remaining balance, requiring Payment Method while keeping Reference Number optional, and enforcing a 50 character limit on Remarks with live character counter, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**.
- [x] 3. Update `frontend/src/components/tenant/LeaseRepeatFields.tsx` to restrict `REPEAT_OPTIONS` to Daily and Monthly only, and remove the gray schedule summary container box ("Repeats daily, 30 payments"), satisfies **AC-7**, **AC-11**.
- [x] 4. In `frontend/src/pages/TenantPage.tsx`, update the Edit Tenant Lease Agreement modal to disable Rent Amount, Total Payable, Repeat, Date Contracted, First Due Date, and Lease End Date when payment transactions exist, and remove the Late Penalty field, satisfies **AC-6**, **AC-7**, **AC-10**.
- [x] 5. In `frontend/src/pages/TenantPage.tsx`, update the New Tenant Lease Agreement modal layout so Date Contracted and Lease End Date are on one line, First Due Date and Status sit directly below them, the Late Penalty field is removed, and comprehensive field validation is applied to all inputs, satisfies **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-12**.
- [x] 6. In `frontend/src/pages/TenantPage.tsx`, insert the dedicated Audit Review card into the left summary column of the Tenant Details view right below Collections and Balances and Notes, rendering the Shield icon, audit status badge, auditor name, formatted timestamp, and discrepancy remarks, satisfies **AC-1**.
- [x] 7. Verify that all tenant data displayed on screen is fetched directly from Supabase with no mock data, local storage fallback, or in memory fixtures, satisfies **AC-14**.

## Consequences

**Positive**:
- Audit reviews for tenants gain visual parity with FilCap Lending, making audit findings prominent and instantly readable.
- Financial integrity is protected by locking commercial lease terms once payments have been recorded against them.
- Payment records gain high consistency through strict validation on dates, amounts, required payment methods, and concise remarks.
- The lease creation form becomes much cleaner, focusing exclusively on active commercial patterns (daily and monthly).

**Negative and tradeoffs**:
- Any genuine correction to a contracted date or rent amount after a payment is entered requires supervisor adjustment or recorded correction entries rather than inline editing.

**Neutral**:
- Legacy leases with other frequencies are safely edited under daily or monthly terms.

## Follow-up

- [ ] Run automated tests and verify that the backend and frontend tests pass cleanly with the new validation rules.

