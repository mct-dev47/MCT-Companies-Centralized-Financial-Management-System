# 0034. Tenant Audit Tags and Table Refinements

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This specification refines the tenant commercial lease table and tenant details views. In the main tenants table, the lease reference and stall subtitle under the tenant name are removed, the contract date and due date columns are taken out, the status badges lose their background pills in favor of clean colored text, and a dedicated audit tag column is added beside status for all operational roles. In the tenant details page, the payment schedule and history table removes the action column to serve as an immutable payment ledger, while introducing a created by column with compact name formatting and full attribution on hover.

## Requirements

**User stories**:
- As a finance officer, supervisor, owner, or auditor, I want to see whether a tenant lease is audited or flagged directly on the main table without bulky backgrounds so that I can immediately evaluate collection risk.
- As any role permitted on the page (Owner, Supervisor, Finance, or Auditor), I want to hover over an audit tag and see who audited the record, the exact timestamp, and any findings on separate lines so that review history is instantly transparent.
- As a business owner or finance manager, I want the tenant name cell to stay clean and uncluttered without subtitle reference tags or stall names, reserving those details for the receipt view.
- As any role permitted on the page (Owner, Supervisor, Finance, or Auditor) viewing tenant payment history, I want an immutable payment log with a created by column showing compact staff names and full name tooltips so that payment entries maintain complete audit trails.

**Acceptance criteria**:
- **AC-1**: In the main tenants table, the tenant name cell renders only the primary tenant name text, completely removing the subtitle showing lease reference code and stall unit.
- **AC-2**: The Contract Date and Due Date columns are completely removed from the main tenants table header, row cells, colgroups, and skeleton loaders.
- **AC-3**: The Status table cell displays clean colored text for Unpaid, Paid, Partially Paid, Advance Paid, Missed, and Overdue without any background pill, border, or rounded container styling.
- **AC-4**: The Audit Tag column is positioned directly to the right of the Status column and is visible to all authenticated roles reaching the page (Owner, Supervisor, Finance, and Auditor).
- **AC-5**: The Audit Tag cell displays "Audited" in emerald colored text for verified leases, "Discrepancy" in crimson colored text for flagged leases, or a muted dash "-" when unreviewed.
- **AC-6**: Hovering over an Audited or Discrepancy tag renders a native browser title tooltip with formatted line breaks containing the auditor full name, the formatted audit timestamp, and any discrepancy remarks on separate lines.
- **AC-7**: In the Tenant Details view under Payment Schedule and History, the Actions column header and row action buttons (Edit and Delete) are completely removed, establishing an immutable transaction history.
- **AC-8**: In the Payment Schedule and History table, a new Created By column is added, displaying the creator in compact initial and last name format (for example J. Dela Cruz) with cursor help styling, and rendering the creator full name on hover via a title tooltip.
- **AC-9**: For legacy payment entries without creator information, the Created By cell displays a muted dash "-".
- **AC-10**: The backend tenant service resolves the creator user ID of each payment to the user full name when returning leases and payments, exposing created by name metadata in the payment response.
- **AC-11**: The CSV export and Print report features on the Tenants page remain completely unchanged, preserving all historical fields including contract dates and due dates.

## Decision

**Chosen option**: Option 2: Unified full stack refinement matching lending conventions.

We streamline the tenant table by removing subtitle tags and dates, introduce the universal audit tag column with multi line hover details, clean status pills into text labels, lock payment history by removing actions, and resolve payment creator names from the database.

## Feature design

**Data model sketch**:
The underlying database schema already possesses the required fields on `tenant_leases` and `tenant_lease_payments`:
- `tenant_leases.audit_status`: VARCHAR(20) DEFAULT 'Pending Audit' (values: 'Verified', 'Flagged', 'Pending Audit')
- `tenant_leases.audited_by`: VARCHAR(100) NULL (auditor full name)
- `tenant_leases.audited_at`: TIMESTAMP WITH TIME ZONE NULL (audit timestamp)
- `tenant_leases.audit_remarks`: TEXT NULL (discrepancy findings)
- `tenant_lease_payments.created_by`: INTEGER NULL (user ID of staff member who entered the payment)
- `tenant_lease_payments.created_at`: TIMESTAMP WITH TIME ZONE DEFAULT NOW()

No database migration is required. The backend service joins or looks up `users.name` by `tenant_lease_payments.created_by` and includes `created_by_name` in the payment payload.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/tenants/leases` | GET | `company_id` (optional), `company_name` (optional) | List of `LeaseOut` objects containing `payments` with `created_by` and `created_by_name` | Bearer token (Business reader) | 401, 500 |
| `/api/v1/tenants/leases/{id}` | GET | `lease_id`: integer path parameter | Single `LeaseOut` object with resolved `payments` and audit fields | Bearer token (Business reader) | 401, 404, 500 |
| `/api/v1/tenants/leases/{id}/payments` | POST | `PaymentIn` payload | Updated `LeaseOut` object with recorded payment and author metadata | Bearer token (Business writer) | 400, 401, 403, 500 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Main table tenant name cell | Tenant Name string only | `tenant.tenantName` |
| Main table status cell | Colored status text | `fin.status` |
| Main table audit tag | "Audited", "Discrepancy", or "-" | `tenant.auditStatus` |
| Main table audit hover | Multi line text: Auditor, Date, Remarks | `tenant.auditedBy`, `tenant.auditDate`, `tenant.auditRemarks` |
| Payment history created by cell | Initial and last name (e.g. J. Dela Cruz) | Derived via `formatPersonInitialAndLastName` from `record.createdByName` |
| Payment history created by hover | Full staff name (e.g. Juan Dela Cruz) | `record.createdByName` |

**Key invariants**:
- The Audit Tag column is shown to all authenticated tenant page roles (Owner, Supervisor, Finance, Auditor).
- The Status column must not render any background color or border pill styling, displaying only bold colored text.
- The main table tenant name cell must not show reference codes, bullet points, or unit stall tags.
- The Payment Schedule and History table must not display any Action column or edit or delete icons.
- If a payment record has no creator information, it displays a muted dash "-" without breaking layout.
- Main table CSV export and Print report retain their existing columns and data structures without regression.

**Security model**:
- Reading leases and payment history remains available to all business reader roles (Owner, Supervisor, Finance, Auditor). Admin accounts do not access this operational page.
- Audit status modifications remain strictly restricted to Auditor accounts.
- Recording new payments remains restricted to business writer roles (Finance, Supervisor).

**Critical test scenarios**:
- Main table layout cleanup: Open Tenants page, verify tenant name cell has no Ref or Stall subtitle, and verify Contract Date and Due Date columns are absent, verifies **AC-1**, **AC-2**.
- Status text styling: Verify status values (Paid, Unpaid, Overdue, Partially Paid) render as plain colored typography without pill backgrounds or borders, verifies **AC-3**.
- Universal audit tag visibility: Log in as Finance or Owner, navigate to Tenants page, verify Audit Tag column is visible beside Status, showing Audited in emerald, Discrepancy in crimson, or dash for unreviewed, verifies **AC-4**, **AC-5**.
- Multi line audit hover tooltip: Hover cursor over an Audited tag or Discrepancy tag, verify native browser title displays auditor name, date, and findings separated by line breaks, verifies **AC-6**.
- Payment schedule table action removal: Open Tenant Details page, inspect Payment Schedule and History table, verify Actions column header and edit and delete buttons are completely absent, verifies **AC-7**.
- Created by column and name tooltip: In Payment Schedule and History table, verify Created By column shows compact initial and last name, and hovering shows the full name, verifies **AC-8**, **AC-10**.
- Legacy payment fallback: View a payment entry with null creator, verify cell displays a clean muted dash "-", verifies **AC-9**.
- Export preservation: Trigger CSV download and browser print preview, verify both formats contain Contract Date and Due Date columns, verifies **AC-11**.

## Build plan

- [x] 1. Update backend `backend/app/schemas/tenant.py` and `backend/app/services/tenant_service.py` to resolve `created_by` user IDs against the `users` table into `created_by_name`, populating this field in payment outputs, satisfies **AC-10**.
- [x] 2. Update frontend `frontend/src/services/tenantService.ts` to add `createdBy` and `createdByName` to `DailyRentRecord` interface and map them from backend responses, satisfies **AC-8**, **AC-10**.
- [x] 3. In `frontend/src/pages/TenantPage.tsx`, simplify the tenant name cell to show only the tenant name, removing reference code and stall unit subtitles, satisfies **AC-1**.
- [x] 4. In `frontend/src/pages/TenantPage.tsx`, remove the CONTRACT DATE and DUE DATE columns from table headers, row cells, colgroups, and skeleton loaders, adjusting column widths for balanced spacing, satisfies **AC-2**.
- [x] 5. In `frontend/src/pages/TenantPage.tsx`, update the Status column styling to remove background pills and borders, rendering clean colored text for all status states, satisfies **AC-3**.
- [x] 6. In `frontend/src/pages/TenantPage.tsx`, expose the Audit Tag column to all roles directly beside Status, rendering Audited in emerald, Discrepancy in crimson, or a muted dash for unreviewed, satisfies **AC-4**, **AC-5**.
- [x] 7. In `frontend/src/pages/TenantPage.tsx`, attach a multi line title tooltip with line breaks to the Audit Tag cell displaying auditor name, date, and discrepancy remarks on separate lines, satisfies **AC-6**.
- [x] 8. In `frontend/src/pages/TenantPage.tsx`, remove the Actions column header and action buttons from the Payment Schedule and History table in the tenant details view, satisfies **AC-7**.
- [x] 9. In `frontend/src/pages/TenantPage.tsx`, add the Created By column to the Payment Schedule and History table with compact initial and last name formatting, full name hover tooltips, and dash fallbacks for legacy records, satisfies **AC-8**, **AC-9**.
- [x] 10. Verify that CSV export and Print report functions in `frontend/src/pages/TenantPage.tsx` maintain their original column structure with contract and due dates preserved, satisfies **AC-11**.

## Consequences

**Positive**:
- Main tenant table readability improves dramatically with less cluttered name cells and wider room for financial figures.
- Universal audit tag visibility lets finance officers, supervisors, and owners confirm audit checks without switching accounts.
- Payment history functions safely as a tamper resistant audit trail with explicit staff attribution.
- Status values look modern and clean without heavy rounded pill containers.

**Negative and tradeoffs**:
- Staff cannot delete or edit payments directly from the tenant details table, requiring administrative intervention or adjustment entries if an erroneous payment is entered.

**Neutral**:
- No database migrations are required because all needed columns already exist in PostgreSQL and Supabase.

