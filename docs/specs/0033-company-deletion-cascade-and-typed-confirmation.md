# 0033. Company Deletion Cascade Cleanup and Typed Name Confirmation

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This enhancement strengthens company deletion safety and data integrity across the system. Admins must type the exact company name before the delete button unlocks, preventing accidental data loss. On the server side, company deletion cascades completely across all remaining child tables including receivables, tenant leases, bank accounts, user company links, and uploaded logo files in cloud storage.

## Context

Company deletion in the employee management view previously used a simple confirmation dialog. Because deleting a company wipes out all financial history, a single mistaken click could destroy vital records. In addition, several newer tables such as receivables, tenant leases, and bank accounts were not explicitly cleaned up in the company deletion service. Company logo images in cloud storage also remained orphaned after database deletion.

Administrators require a clear safeguard matching industry standards such as GitHub repository deletion. The confirmation modal must require typing the exact company name to activate the deletion action. On the database layer, the deletion routine must ensure clean removal of all dependent records, preventing orphan rows or dangling foreign keys.

## Requirements

**User stories**:
- As an Admin, I want to confirm company deletion by typing the exact company name so that I never delete a business entity by accident.
- As a System Architect, I want company deletion to clean up all related financial ledgers, tenant records, bank accounts, and cloud storage files so that no orphaned records remain.

**Acceptance criteria**:
- **AC-1**: The delete confirmation modal renders an input field requiring the administrator to type the exact company name.
- **AC-2**: The confirmation button remains disabled until the trimmed input string matches the target company name with case sensitive precision.
- **AC-3**: Closing or reopening the deletion modal resets the typed input state and error banners.
- **AC-4**: Deleting a company cascades and deletes all related receivables and their payment remittances.
- **AC-5**: Deleting a company cascades and deletes all related tenant leases and their lease payment records.
- **AC-6**: Deleting a company cascades and deletes all linked bank accounts and their bank transaction ledgers.
- **AC-7**: Deleting a company removes all user company assignments in the user companies join table and clears user primary company references.
- **AC-8**: Deleting a company deletes the company logo image from the cloud storage bucket, continuing gracefully if the file is absent.
- **AC-9**: The existing audit log entry preserves the deletion event with company identifier set to null so history is never lost.

## Options considered

### Option 1: Inline typed validation modal with comprehensive backend cascade

Enhance the deletion confirmation dialog in the employee management view with a required input matching the exact company name. Update the company service deletion method to execute sequential removal of all child records, followed by cloud storage cleanup.

**Pros**:
- High safety against accidental clicks with zero extra external dependencies.
- Complete database hygiene with no orphan records across receivables, leases, or banks.
- Clean storage bucket usage without lingering files.

**Cons**:
- Requires minor UI expansion in the confirmation dialog.

### Option 2: Soft delete status flag instead of hard cascade delete

Change company deletion to mark a status column as inactive, hiding the company from regular dropdowns while preserving all rows in place.

**Pros**:
- Allows recovery of deleted companies.
- Keeps all past transaction records intact.

**Cons**:
- Inconsistent with the rest of the application which already performs hard cascade deletes across sales, expenses, and loans.
- Leaves inactive companies in database uniqueness constraints unless schemas are altered.

## Decision

**Chosen option**: Option 1: Inline typed validation modal with comprehensive backend cascade

Implement GitHub style typed name validation on the company view modal and complete the cascade cleanup inside the company service for receivables, tenant leases, bank accounts, user company links, and cloud storage logos.

## Feature design

**Data model sketch**:
No new database tables are created. The cascade sequence deletes child rows in dependent order before deleting the company parent record:
- `payment_remittances` where `receivable_id` belongs to the target company
- `receivables` where `company_id = :id`
- `tenant_lease_payments` where `lease_id` belongs to the target company
- `tenant_leases` where `company_id = :id`
- `bank_transactions` where `bank_account_id` belongs to the target company
- `bank_accounts` where `company_id = :id`
- `user_companies` where `company_id = :id`
- `notifications` and `notification_preferences` where `company_id = :id`
- Existing cascades: `petty_cash_topups`, `petty_cash_wallets`, `bill_payments`, `bills`, `expenses`, `sales`, `cash_inflow`, `budget`, `loans_repayments`, `loan`, `staff_credits`
- Preserve history: `UPDATE users SET company_id = NULL`, `UPDATE audit_logs SET company_id = NULL`

**UI surface**:
- Inside `ViewCompanyModal.tsx`, the delete confirmation presents an explicit warning card detailing what will be destroyed.
- An input element accepts the typed confirmation.
- Helper text displays: `Please type "${company.name}" to confirm.`
- The confirm button label shows `Yes, Delete Company` and stays disabled until `typedName.trim() === company.name.trim()`.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/companies/{company_id} | DELETE | company_id path parameter | 204 No Content | Admin role | 401, 403, 404, 500 |

**Value sourcing**:
| Action | Value produced or displayed | Source |
|---|---|---|
| Display delete warning modal | Target company name | Selected company record in modal state |
| Validate confirmation input | Match boolean flag | Comparison of user typed string with company name prop |
| Clean cloud storage | Storage file path | Stored company logo URL or company folder pattern |
| Clean child records | Deleted row counts | SQL execution parameterized by company identifier |

**Key invariants**:
- The delete action button must never be clickable when the input text does not match the company name.
- Database cascade execution must run inside a single transaction so partial failures roll back cleanly.
- Storage file deletion errors must not rollback database deletion if the file was already missing.

**Security model**:
- Deleting a company remains restricted strictly to users with the Admin role.
- Token authentication and role verification are enforced on the backend endpoint.

**Critical test scenarios**:
- Happy path: Admin opens delete confirmation, types exact company name, confirms, and the company plus all financial and tenant child records are removed, verifying **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-8**.
- Incomplete input failure case: Admin types partial name or lowercase variant, verifying confirm button remains disabled, verifying **AC-2**.
- Modal close reset: Admin types into the input, cancels dialog, and reopens, verifying input field is empty, verifying **AC-3**.
- Storage resilience: Admin deletes a company whose logo was deleted manually from cloud storage, verifying the API succeeds without crashing, verifying **AC-8**.

## Build plan

- [x] 1. Update `ViewCompanyModal.tsx` to add typed confirmation state, warning details, input control, and match verification before unlocking deletion, satisfies **AC-1**, **AC-2**, **AC-3**.
- [x] 2. Update `company_service.py` `delete_company` method to cascade delete `receivables`, `payment_remittances`, `tenant_leases`, `tenant_lease_payments`, `bank_accounts`, `bank_transactions`, and `user_companies`, satisfies **AC-4**, **AC-5**, **AC-6**, **AC-7**.
- [x] 3. Add cloud storage cleanup inside `company_service.py` to remove logo files from the storage bucket during company deletion, satisfies **AC-8**.
- [x] 4. Verify end to end deletion behavior with unit tests and live execution checks, satisfies **AC-9**.

## Consequences

**Positive**:
- Eliminates catastrophic accidental deletion through typed verification.
- Completely purges all orphaned records across accounting, banking, leases, and storage.
- Preserves audit trails by detaching user and log records cleanly.

**Negative or Tradeoffs**:
- Deleting a company requires slightly more effort from the admin, which is intentional for safety.

