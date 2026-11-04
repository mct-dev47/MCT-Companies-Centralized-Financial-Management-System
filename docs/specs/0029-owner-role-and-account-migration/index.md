# 0029. Owner Role and Manuel Account Email Migration

**Date**: 2026-11-04
**Status**: In Progress

## Summary

This specification introduces a dedicated Owner role across backend and frontend systems, replacing temporary email string checks with clean role based permissions. It migrates the account for Manuel from manuel@mct.com to ryuuujin.sh@gmail.com and assigns the Owner role. The Owner role provides global view only visibility across all companies and modules without permission to add, edit, delete, or audit transactions.

## Requirements

**User stories**:
- As Manuel or an executive stakeholder with the Owner role, I want to sign in with ryuuujin.sh@gmail.com and inspect financial records across all companies so that I have complete oversight of our operations.
- As an Owner user, I want all record creation, modification, deletion, and audit verification actions suppressed so that my account remains strictly view only.
- As a software engineer, I want role checks based on the formal Owner role rather than hardcoded email strings so that the permission model remains maintainable and secure.

**Acceptance criteria**:
- **AC-1**: The backend database schema and user models recognize owner as a valid role alongside admin, audit, finance, and supervisor.
- **AC-2**: A database migration updates the user record for Manuel to email ryuuujin.sh@gmail.com and role owner.
- **AC-3**: Backend permission dependencies permit the Owner role to read all company data while strictly forbidding business mutations and audit approvals with a 403 Forbidden error.
- **AC-4**: The frontend user session model and authentication mapping map the owner role to Owner and assign All Companies scope.
- **AC-5**: All frontend screens replace isManuel string checks with role checks for Owner, hiding all add buttons, edit menus, delete options, and audit action triggers.
- **AC-6**: Action columns in data tables display a clean placeholder dash without interactive popovers when accessed by an Owner user.
- **AC-7**: The LoanPage action menu defines canAuditActions properly, preventing runtime reference errors and suppressing audit actions for Owner users.

## Decision

**Chosen option**: Option 1: First class Owner role with database migration.

The application will implement a formal Owner role across the backend and frontend, update Manuel's account email to ryuuujin.sh@gmail.com via SQL migration, and enforce view only access without any email string matching. Full deliberation and options analysis are recorded in [rationale.md](./rationale.md).

## Migration plan

**Strategy**: Direct database migration with atomic frontend and backend deployment.

**Phases**:
1. Execute backend SQL migration to update the users table: set email to ryuuujin.sh@gmail.com and role to owner for the account previously associated with Manuel.
2. Deploy backend updates supporting the owner role in User models, Pydantic schemas, and permission dependencies.
3. Deploy frontend updates adding Owner to UserRole and replacing isManuel checks with userRole equals owner checks.

**Rollback**:
If unforeseen regressions occur, revert the commit and run an SQL statement reverting the role to audit and the email to manuel@mct.com.

**Risks**:
If an active session token exists with the old email or role, the user may need to log in again with ryuuujin.sh@gmail.com to refresh their session token claims.

## Feature design

**Data model sketch**:
- Table `users`:
  - `role`: String(50), permitted values now include "owner" (existing: "admin", "audit", "finance", "supervisor", "company").
  - `email`: unique index, updated to "ryuuujin.sh@gmail.com" for Manuel's record.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/auth/me | GET | None (Bearer header) | UserResponse with role "owner", email "ryuuujin.sh@gmail.com", company_names | Bearer token | 401 Unauthorized |
| /api/v1/users/{id} | PUT | UserUpdate (role: "owner") | UserResponse | Admin Bearer | 400 Bad Request, 403 Forbidden |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Hydrate user profile | User role Owner | Supabase users table role column |
| Hydrate user email | Email ryuuujin.sh@gmail.com | Supabase users table email column |
| Resolve company scoping | Scope All Companies | authService mapUser when role is Owner |
| Suppress action menus | Static dash placeholder | Component render logic when role is Owner |
| Enforce backend mutation block | 403 Forbidden | require_business_writer dependency when role is Owner |

**Key invariants**:
- The Owner role has complete view visibility across all company records.
- The Owner role cannot create, update, delete, or audit any business records.
- No frontend logic may use email string containment to deduce view only privileges.

**Security model**:
- `require_business_writer` rejects Owner accounts with 403 Forbidden.
- `require_finance_or_admin_user` rejects Owner accounts with 403 Forbidden.
- `require_business_reader` permits Owner accounts to read records across companies.
- `check_company_access` permits Owner accounts global multi company read access.

**Critical test scenarios**:
- Happy path: User signs in as ryuuujin.sh@gmail.com, receives role Owner, and views dashboard, loans, bills, and tenants across all companies, verifies **AC-2**, **AC-4**.
- Mutation block: Owner user sends a POST or PUT request to create or edit an expense, and backend returns 403 Forbidden, verifies **AC-3**.
- UI action suppression: Owner views Bills, Expenses, Petty Cash, Sales, Lending, and Tenants pages; all Add buttons are hidden and action columns display static dashes without interactive menus, verifies **AC-5**, **AC-6**.
- Loan page runtime safety: Owner views LoanPage without JavaScript errors, with canAuditActions evaluating to false, verifies **AC-7**.

## Build plan

- [x] 1. Create SQL migration script to update Manuel account email to ryuuujin.sh@gmail.com and role to owner, satisfies **AC-1**, **AC-2**.
- [x] 2. Update backend `app/models/user.py` and `app/schemas/user.py` to allow the owner role, satisfies **AC-1**.
- [x] 3. Update backend `app/core/dependencies.py` to recognize owner in `check_company_access` and reject owner in `require_business_writer`, satisfies **AC-3**.
- [x] 4. Update frontend `authService.ts` UserRole union to include Owner and update `mapUser` to assign All Companies, satisfies **AC-4**.
- [x] 5. Refactor frontend pages (`BillsPage.tsx`, `ExpensePage.tsx`, `LendingPage.tsx`, `PettyCashPage.tsx`, `SalesPage.tsx`, `TenantPage.tsx`, `AuditTransactionModal.tsx`) to replace isManuel with role checks, satisfies **AC-5**, **AC-6**.
- [x] 6. Fix `LoanPage.tsx` to properly define canAuditActions and suppress action popovers for Owner, satisfies **AC-5**, **AC-7**.

## Consequences

**Positive**:
- Eliminates brittle email matching logic throughout the codebase.
- Provides a clean, reusable Owner role for executives who need view only oversight.
- Enforces authorization guarantees on both backend endpoints and user interface views.

**Negative / tradeoffs**:
- Requires updating the users table and invalidating stale session caches for Manuel.

**Neutral**:
- Future read only executive accounts can simply be assigned the Owner role without writing new code.

## Follow-up

- [x] Run the SQL migration script against the production Supabase database.
- [ ] Inform the user to sign in using ryuuujin.sh@gmail.com and verify their view only access.

