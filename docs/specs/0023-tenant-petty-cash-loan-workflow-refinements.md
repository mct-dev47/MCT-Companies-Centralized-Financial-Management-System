# 0023. Tenant, Petty Cash, and Loan Workflow Refinements

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification settles workflow refinements and bug resolutions across the tenant, petty cash, and loan modules. It automates the first due date to today when choosing daily repeat in tenant leases, enforces non negative input validation for late penalties, and explains the calculated total payable and authorization checks for JK Property accounts. It also repairs petty cash creation crashes, removes non existent company names from company filters, creates a direct auditor endorsement path for finance petty cash requests, and sets the default loan page tab to pending.

## Context

The system has several usability and workflow gaps across three active modules.

In the tenant module, operators creating daily repeating leases must manually pick the current date even though daily leases start immediately upon signing. Furthermore, the late penalty percentage input allows typing negative numbers, which can corrupt interest schedules. Users also reported confusion regarding why total amount payable becomes read only when a repeat schedule is chosen, and why creating a lease with the JK Property supervisor account triggers an access denied error. The root cause for the access error is that the tenant creation endpoint inspects the unpopulated company id field before resolving the company name, causing an authorization check failure.

In the petty cash module, both finance and supervisor users experience complete failure when submitting top up requests. The backend endpoint attempts to read an attribute named company name from the request payload, but the validation model defines this field as company. This causes an unhandled attribute error and crashes every creation request. In addition, the company dropdown filters in the finance and audit views merge hardcoded dummy names such as JK Cafe and Annex Nine that do not exist in the database. Finally, when finance users request petty cash, the user interface tells them to submit the request to finance, which requires a redundant self review step instead of directly collecting the funding bank and endorsing the request to internal audit.

In the company loan module, the page currently defaults to showing approved loans, requiring finance and audit staff to switch tabs every time they arrive on the page to review pending applications.

## Requirements

**User stories**:
- As a JK Property supervisor or finance officer, I want the first due date to automatically populate with today's date when I select daily repeat, so that I can create daily stall rentals quickly without date picker errors.
- As a JK Property supervisor, I want the late penalty field to reject negative numbers, so that leases cannot be saved with negative interest penalties.
- As a JK Property supervisor or finance officer, I want clear feedback on total payable calculations and error free lease creation under JK Property, so that my leases persist reliably.
- As a finance or audit officer, I want petty cash company filters to display only real companies from the database, so that filtering reflects actual operations.
- As a supervisor or finance user, I want petty cash top up submissions to succeed without server crashes, so that operational funds can be requested promptly.
- As a finance manager, I want requesting petty cash to directly collect my funding bank and endorsement remark and route straight to internal audit, so that I do not need to submit a request to myself.
- As a finance or audit officer, I want the loan management page to open on the pending tab by default, so that new loan requests are visible immediately upon arrival.

**Acceptance criteria**:
- **AC-1**: When the user selects Daily in the tenant lease repeat selector, the form automatically sets the first due date field to the current date in local YYYY-MM-DD format.
- **AC-2**: The late penalty input field on the tenant modal blocks negative signs and negative numbers, displaying a validation error if a negative value is supplied.
- **AC-3**: The tenant creation API endpoint resolves company names before enforcing feature access and authorization checks, allowing jkproperty@mct.com to create leases successfully.
- **AC-4**: The petty cash top up request schema and endpoint accept both company and company name fields, resolving the company correctly and returning HTTP 201 without attribute errors.
- **AC-5**: The petty cash company filters in finance and audit views render only companies fetched from the database alongside the All Companies option, omitting hardcoded legacy placeholder names.
- **AC-6**: When a finance user opens the request petty cash modal, the interface presents an endorsement workflow that gathers the requesting company, top up amount, date, funding bank account, and endorsement remark, submitting the request directly in pending audit review status.
- **AC-7**: On the loan management page, the active approval tab defaults to Pending on page load for all roles.

## Options considered

### Option 1: Fix in place across frontend and backend modules

Update the backend endpoints to resolve company models before feature validation, align schema attributes, sanitize input event handlers, and adjust default view states.

**Pros**:
- Solves all reported bugs with surgical edits.
- Maintains backwards compatibility with existing API clients.
- Introduces zero breaking changes to database schemas.

**Cons**:
- Requires coordinated frontend and backend updates.

### Option 2: Split petty cash into separate supervisor and finance endpoints

Create a dedicated endpoint for finance petty cash top ups that bypasses the supervisor request pipeline entirely.

**Pros**:
- Separates request data contracts between roles.

**Cons**:
- Duplicates audit logging and ledger insertion logic.
- Creates unnecessary maintenance overhead compared to supporting role aware submission payloads.

## Decision

**Chosen option**: Option 1: Fix in place across frontend and backend modules.

We resolve company records prior to permission checks in tenant endpoints, align petty cash payload fields, provide a direct auditor endorsement path for finance petty cash requests, sanitize penalty inputs, filter companies strictly by database records, and set the default loan tab to pending.

**Implementation skills**: `develop` (`antigravity/develop`, `.agents/skills/develop/`)

## Rationale

Fixing the validation and resolution pipelines in place addresses the root issues directly. The tenant access denied bug occurred because the feature gatekeeper evaluated an empty company identifier before the resolver translated the company name to company id 5. Sourcing petty cash companies dynamically eliminates ghost companies from the interface. Correcting the Pydantic schema in the petty cash service prevents internal server errors, while streamlining the finance request avoids a confusing two step self approval loop. Setting the loan tab to pending improves daily operational throughput for auditors and finance officers.

## Feature design

**Data model sketch**:
No new database tables are needed. The existing `tenant_leases`, `petty_cash_topups`, and `company_loans` tables fulfill all requirements.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/tenants/leases | POST | company name or id, tenant details, repeat mode, penalty rate | LeaseOut | Bearer writer | 400, 403, 422 |
| /api/v1/petty-cash/topups | POST | company or company name, amount, topup date, optional bank account id, optional remark | PettyCashTopUpOut | Bearer writer | 400, 403, 422 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Selecting Daily repeat | First due date | Browser current date in YYYY-MM-DD |
| Validating tenant penalty | Sanitized rate | Numeric input clamped at 0 to 100 |
| Resolving tenant company | Authorized company id 5 | Company table lookup via company resolver |
| Endorsing petty cash as Finance | Initial status Pending Audit Approval | Submitted role state in petty cash service |
| Defaulting loan view | Selected tab Pending | Initial component state in LoanPage |

**Key invariants**:
- Late penalty rate must be between 0 and 100 percent or left blank.
- Daily repeating leases must not allow a first due date earlier than the contract signing date.
- Tenant creation must always resolve to JK Property and Ventures Corporation (id 5).
- Petty cash top up amounts must be at least 1.00 Philippine Peso.

**Security model**:
- Supervisors can only create requests and leases for their assigned companies.
- Finance users can endorse petty cash and create tenant leases for JK Property.
- Audit users can review and approve endorsed petty cash and loan requests.

**Critical test scenarios**:
- Happy path: Selecting Daily repeat in tenant modal sets first due date to today, verifies **AC-1**
- Validation case: Typing a negative number in the late penalty field is blocked, verifies **AC-2**
- Permission check: Calling POST /api/v1/tenants/leases as jkproperty@mct.com creates a lease without access denied error, verifies **AC-3**
- Creation flow: Calling POST /api/v1/petty-cash/topups succeeds with HTTP 201 for both supervisor and finance, verifies **AC-4**
- Dropdown check: Petty cash company filter renders only valid database companies, verifies **AC-5**
- Finance workflow: Finance user submits petty cash request with funding bank, appearing immediately under pending audit review, verifies **AC-6**
- Loan view check: Loading the loans page defaults to the pending tab, verifies **AC-7**

## Build plan

1. Update `backend/app/api/v1/endpoints/tenants.py` to resolve company by name or id before checking company feature access, satisfies **AC-3**.
2. Update `backend/app/schemas/petty_cash.py` and `backend/app/api/v1/endpoints/petty_cash.py` so that `PettyCashTopUpCreate` accepts `company_name` alongside `company`, satisfies **AC-4**.
3. Enhance `frontend/src/pages/TenantPage.tsx` and `frontend/src/components/tenant/LeaseRepeatFields.tsx` to set the first due date to today on Daily repeat selection and prevent negative penalty inputs, satisfies **AC-1**, **AC-2**.
4. Clean up `frontend/src/pages/PettyCashPage.tsx` company filter state to populate exclusively from database company queries, satisfies **AC-5**.
5. Update `frontend/src/components/dashboard/TopUpPettyCashModal.tsx` and `frontend/src/pages/PettyCashPage.tsx` to offer direct auditor endorsement when requested by finance, satisfies **AC-6**.
6. Set `approvalTab` default state to Pending in `frontend/src/pages/LoanPage.tsx`, satisfies **AC-7**.

## Consequences

**Positive**:
- Eliminates recurring 403 and 500 errors during tenant and petty cash operations.
- Enhances data integrity by preventing negative interest rates.
- Reduces friction for finance staff managing petty cash and loans.

**Negative / tradeoffs**:
- Finance users creating petty cash must select a funding bank account at request time instead of deferring it.

**Neutral**:
- No schema migrations required.

## Follow-up

- [x] Run test suite across tenants, petty cash, and loan permissions to confirm regression free execution.
