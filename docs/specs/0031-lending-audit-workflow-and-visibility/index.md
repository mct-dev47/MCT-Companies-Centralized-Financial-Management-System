# 0031. Lending Audit Workflow and Role Visibility Refinements

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This specification refines the audit review experience in the lending module for both auditor and non auditor roles. The main lending table simplifies the audit badge to show plain status words without initials or timestamps, and exposes this column to all system roles. The lending details view displays the auditor name and timestamp above the auditor action buttons, while housing full audit findings inside a dedicated section of the loan agreement receipt card. Discrepancy flagging is fixed to persist remarks directly to the database through a styled full width input field.

## Requirements

**User stories**:
- As an auditor, I want to clearly view previous audit findings, edit discrepancy notes in a full width text area, and persist my findings to the database so that records remain durable across sessions.
- As an owner, supervisor, or finance officer, I want to see whether a borrower facility has been audited, when the audit occurred, and what remarks the auditor left so that I can make informed loan disbursement and repayment decisions.
- As any system user, I want a clean lending table where audit status is immediately legible without cluttered initials or timestamps.

**Acceptance criteria**:
- **AC-1**: The Audit Tag column in the main lending table is visible to all authenticated roles (Admin, Supervisor, Auditor, Owner, and Finance).
- **AC-2**: The Audit Tag table cell displays only the badge text "Audited" in emerald styling for verified facilities, "Discrepancy" in crimson styling for flagged facilities, or "-" when unreviewed, without showing auditor initials or timestamps inside the visible cell.
- **AC-3**: The Audit Tag table cell contains a title tooltip showing the auditor name, formatted audit timestamp, and any audit remarks upon hovering.
- **AC-4**: For the auditor role in the Lending Details view, the auditor full name and formatted audit timestamp are displayed directly above the "Re-Audit" and "Flag Discrepancy" action buttons.
- **AC-5**: For non auditor roles (Owner, Finance, Supervisor, or Admin) in the Lending Details view, the top right action area remains clean without audit action buttons or redundant stamps.
- **AC-6**: Inside the left Loan Agreement and Terms receipt card of the Lending Details view, a dedicated audit review panel displays the audit status badge, auditor full name, audit timestamp, and full auditor remarks.
- **AC-7**: In the Flag Audit Discrepancy modal, the textarea field spans the full width of the dialog body, features an explicit rounded border, and prepopulates existing remarks when reopening a previously flagged borrower.
- **AC-8**: Confirming a discrepancy invokes `lendingService.saveAuditReview` with status "Flagged", the trimmed remarks string, and the authenticated auditor name, saving the review to PostgreSQL and Supabase.
- **AC-9**: Confirming Mark as Audited or Re-Audit invokes `lendingService.saveAuditReview` with status "Verified", clearing previous discrepancy remarks and updating the borrower record in both databases.
- **AC-10**: Exporting table records to CSV or print view includes the audit status, auditor name, and audit date consistently across all permitted user roles.

## Decision

**Chosen option**: Option 2: Integrated audit panel inside the loan receipt card with header stamps for auditors.

We place auditor attribution above the auditor action buttons, integrate full audit remarks within the official agreement receipt card, open table audit status to all roles, and wire modal actions directly to backend database persistence.

## Feature design

**Data model sketch**:
The underlying borrower schema already contains the necessary audit fields on table `borrowers`:
- `audit_status`: VARCHAR(20) DEFAULT 'Pending Audit' (values: 'Verified', 'Flagged', 'Pending Audit')
- `audited_by`: VARCHAR(100) NULL (stores auditor full name)
- `audited_at`: TIMESTAMP WITH TIME ZONE NULL (stores audit review timestamp)
- `audit_remarks`: TEXT NULL (stores auditor findings or discrepancy description)

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/lending/borrowers` | GET | `company_id` (optional query param) | List of `BorrowerOut` records including `audit_status`, `audited_by`, `audited_at`, `audit_remarks` | Bearer token (All roles) | 401, 500 |
| `/api/v1/lending/borrowers/{id}/audit` | PATCH | `audit_status`: string, `remarks`: optional string, `auditor_name`: optional string | Updated `BorrowerOut` record | Bearer token (Auditor only) | 401, 403, 404, 500 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Main table audit column | "Audited", "Discrepancy", or "-" | `facility.auditStatus` or `facility.audit_status` |
| Main table hover tooltip | Auditor name, date, remarks | `facility.auditedBy`, `facility.auditDate`, `facility.auditRemarks` |
| Details header auditor stamp | Auditor full name and formatted date | `activeFacility.auditedBy`, `activeFacility.auditDate` |
| Left card audit panel | Audit status, auditor name, date, remarks | `activeFacility.auditStatus`, `activeFacility.auditedBy`, `activeFacility.auditDate`, `activeFacility.auditRemarks` |
| Discrepancy modal textarea | Existing findings text | `activeFacility.auditRemarks` |
| Audit review submission | Persisted audit record | `lendingService.saveAuditReview` payload |

**Key invariants**:
- Non auditor roles can view audit statuses and remarks, but cannot trigger audit review or discrepancy actions.
- When an auditor marks a facility as Audited (Verified), any previous discrepancy remarks are cleared in the database.
- The discrepancy text area in the modal must not submit if empty or containing only whitespace.
- Submissions must update local facilities state and the active facility state synchronously upon successful API response.

**Security model**:
- Reading borrowers and their audit statuses is accessible to all authenticated lending roles (Admin, Supervisor, Auditor, Owner, and Finance).
- Modifying audit reviews is strictly guarded by backend dependency `require_auditor_user`. Only Auditor accounts can change the audit review status; Admin, Owner, Supervisor, and Finance accounts receive a 403 Forbidden response.

**Critical test scenarios**:
- Happy path table visibility: Log in as Finance, Supervisor, or Owner, navigate to Lending Page, verify the Audit Tag column renders with badges and tooltips, verifies **AC-1**, **AC-2**, **AC-3**.
- Happy path auditor header: Log in as Auditor, open borrower details, verify auditor name and date appear above Re-Audit and Flag Discrepancy buttons, verifies **AC-4**.
- Non auditor details view: Log in as Admin, Owner, Finance, or Supervisor, open borrower details, verify top header has no audit action buttons and the left agreement card renders the audit review panel, verifies **AC-5**, **AC-6**.
- Admin forbidden on audit mutation: Log in as Admin or send PATCH request to `/api/v1/lending/borrowers/{id}/audit`, verify 403 Forbidden response returned, verifies **AC-4**, **AC-8**.
- Flag discrepancy submission: Open Flag Audit Discrepancy modal, verify full width textarea with border, enter remarks, submit, verify successful PATCH call and updated remarks on screen and upon page refresh, verifies **AC-7**, **AC-8**.
- Mark as audited transition: Re-audit a flagged borrower, confirm verification, verify remarks are cleared and status switches to Audited in database and user interface, verifies **AC-9**.
- Table export: Trigger CSV export and print view, verify audit fields are present, verifies **AC-10**.

## Build plan

- [x] 1. Update `frontend/src/pages/LendingPage.tsx` table headers and rows to remove the `isAudit` conditional guard, showing the Audit Tag column to all roles with clean badge labels and hover tooltips, satisfies **AC-1**, **AC-2**, **AC-3**.
- [x] 2. Restrict `canAuditActions` in `frontend/src/pages/LendingPage.tsx` strictly to Auditor accounts (excluding Admin), and render the auditor attribution stamp directly above the audit buttons when audit information exists, satisfies **AC-4**, **AC-5**.
- [x] 3. Implement the dedicated audit panel component within the left Loan Agreement and Terms card in `LendingPage.tsx`, displaying status, auditor name, timestamp, and audit remarks for all roles, satisfies **AC-6**.
- [x] 4. Refactor the Flag Audit Discrepancy modal textarea in `LendingPage.tsx` with full width styling, explicit borders, rounded corners, and proper focus rings, satisfies **AC-7**.
- [x] 5. Update backend endpoint `PATCH /api/v1/lending/borrowers/{id}/audit` to use `require_auditor_user` ensuring Admin and non auditor roles are blocked with 403 Forbidden, and update `handleConfirmDiscrepancy` and `handleConfirmAudit` in `LendingPage.tsx` to asynchronously call `lendingService.saveAuditReview`, handle loading indicators, surface friendly error alerts on failure, and update local and active facility state upon success, satisfies **AC-4**, **AC-8**, **AC-9**.
- [x] 6. Update table export logic in `LendingPage.tsx` to include audit columns for all permitted roles, satisfies **AC-10**.

## Consequences

**Positive**:
- Full audit transparency across the organization allows finance officers, supervisors, and owners to confirm audit validity before transactions.
- Discrepancy notes and audit verifications now persist durably in PostgreSQL and Supabase.
- Main table rows become cleaner and easier to read without wrapped initial stamps.
- The discrepancy modal provides a comfortable, responsive text input experience.

**Negative and tradeoffs**:
- Adding one extra column to the main table for all roles requires slight adjustments to column percentage widths to prevent horizontal overflow on smaller laptops.

**Neutral**:
- No database migrations are required because migration `0031_borrowers_audit_fields.sql` already provisioned the audit columns on table `borrowers`.

## Follow up

- [ ] Run verification tests against both auditor and non auditor user sessions.

