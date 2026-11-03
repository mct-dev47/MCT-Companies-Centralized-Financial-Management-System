# 0021. Company Context Scoping, Realtime Expense Sync, and Loan Borrower Approval Workflow

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification fixes company context leaking across tabs, adds realtime WebSocket synchronisation for expenses, and refines the borrower loan workflow. When Finance selects a company, transaction forms now lock to that company instead of exposing other company choices. Expenses now broadcast and receive live updates through WebSockets so users do not have to refresh their browser. Finance users can choose the borrower company freely when recording loans, while supervisors stay restricted to their single assigned company, and auditors can now approve loans pending audit approval.

## Context

The centralized financial system allows users in Finance, Audit, and Supervisor roles to operate across multiple companies or within a single company scope. Several usability and authorization gaps currently disrupt daily accounting workflows.

First, when a Finance user selects a specific company from the header or tab dropdown, opening the transaction creation interface on pages such as Expense or Sales still displays a company selector containing other companies. In some cases, the form defaults to a different company entirely. This disconnect creates a risk of misallocating expenditures and sales entries to the wrong legal entity. When an operator deliberately selects a company to work in, transaction entry forms must inherit and lock to that context.

Second, the Expense interface does not synchronize in real time. When expenses are created, edited, or removed, the backend does not broadcast expense lifecycle events over WebSockets. Users viewing the expense list must manually refresh their browser window to observe updates made by colleagues or automated services.

Third, the borrower loan creation dialog on `/loan/borrower` hardcodes the borrower company to a read only display for every user. While supervisors assigned to a single branch or company should remain locked to their assigned entity, Finance managers oversee the entire corporate umbrella and must be able to select the borrower company dynamically.

Finally, in `LoanPage.tsx`, the approval authorization logic strictly excludes users with auditor roles. As a result, when loans progress to the Pending Audit Approval stage, auditors cannot see an Approve button in the view modal or in the row actions menu, preventing them from completing statutory audit sign off.

## Requirements

**User stories**:
- As a Finance officer, I want transaction creation forms to lock to my currently chosen company so that I do not accidentally post transactions to the wrong entity.
- As a Finance officer or Auditor, I want expense records to update across active browser sessions through WebSockets so that I do not need to refresh the page manually.
- As a Finance officer, I want to select the borrower company when recording a borrower loan, while ensuring supervisors assigned to only one company remain restricted to their own company.
- As an Auditor, I want to see and click an Approve button on loans that are in Pending Audit Approval status so that I can finalize audit verification.

**Acceptance criteria**:
- **AC-1**: When a user selects a specific company in the company filter, opening the add transaction page or modal locks the company field to that selected company and disables switching to other companies.
- **AC-2**: When the active company filter is set to All Companies, transaction forms permit selecting any company from the dynamic list of active companies.
- **AC-3**: Backend expense endpoints broadcast WebSocket messages with types `EXPENSE_CREATED`, `EXPENSE_UPDATED`, and `EXPENSE_DELETED` upon successful database commits.
- **AC-4**: The frontend expense page subscribes to expense WebSocket messages and triggers an automatic background data reload without requiring a full browser refresh.
- **AC-5**: The add loan dialog on `/loan/borrower` provides a dynamic company dropdown for Finance users, defaulting to the currently active company from context.
- **AC-6**: The add loan dialog preserves a locked, read only company field for supervisors who are assigned to exactly one company.
- **AC-7**: Users with an Auditor role can view and click the Approve and Disapprove actions for loans in Pending Audit Approval status within both the three dots action menu and the loan details view modal.

## Options considered

### Option 1: Fix in place with strict contextual scoping and unified WebSocket signals (Recommended)

Apply targeted enhancements to existing components. Pass the active company from `CompanyContext` into creation forms, locking the selector when a specific company is selected. Add standard WebSocket broadcast calls to backend expense endpoints and wire corresponding event listeners into `ExpensePage.tsx`. Adjust `AddLoanModal.tsx` to conditionally render a company select element based on user role and assigned company count. Update `LoanPage.tsx` to grant auditors approval rights when loan status is Pending Audit Approval.

**Pros**:
- Minimal code footprint with zero schema changes.
- Preserves existing page layouts and routing structures.
- Solves all four reported issues cleanly and immediately.

**Cons**:
- Requires touching both frontend components and backend endpoints in a single pull request.

### Option 2: Full company session rewrite and client polling fallback

Introduce a global server side session store for active company selection, and use periodic client polling instead of WebSocket signals for expenses.

**Pros**:
- Does not rely on persistent WebSocket connection stability.

**Cons**:
- Adds unnecessary network overhead and latency.
- Fails to leverage the existing WebSocket infrastructure already running in the application.

## Decision

**Chosen option**: Option 1: Fix in place with strict contextual scoping and unified WebSocket signals

Implement contextual company locking, wire live WebSocket events for expenses, make borrower company selectable for multi company Finance users, and enable the Auditor loan approval controls.

**Implementation skills**: `develop` (.agents/skills/develop/)

## Rationale

The project already possesses a functioning WebSocket manager in `backend/app/core/websocket.py` and a client listener in `frontend/src/services/websocketService.ts`. Reusing this established infrastructure for expenses ensures real time consistency without inventing new communication channels. Similarly, `CompanyContext` already tracks `activeCompany` and `isCompanyScoped`. Reusing these existing hooks in `AddTransactionSheetPage.tsx` and `AddLoanModal.tsx` provides predictable company scoping while respecting multi company Finance permissions. Enabling auditor loan approval resolves a clear authorization oversight where auditors were explicitly excluded from approving loans awaiting their audit sign off.

## Feature design

**Data model sketch**:
No new database tables or columns are required. Existing schemas for `expenses` and `loans` fully support the required fields.

**State transitions**:
- Loan status workflow:
  1. Supervisor creates loan: initial status is `Pending Finance Endorsement`.
  2. Finance approves: status becomes `Pending Audit Approval`.
  3. Auditor approves: status becomes `Approved`.
  4. Auditor disapproves: status becomes `Disapproved by Audit`.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/expenses/ | POST | expense payload, company | created expense record | Finance, Admin, Supervisor | 400, 401, 403 |
| /api/v1/expenses/{id} | PUT | expense updates | updated expense record | Finance, Admin | 400, 404 |
| /api/v1/expenses/{id} | DELETE | none | confirmation message | Finance, Admin | 400, 404 |
| /api/v1/loans/{id}/audit-review | POST | action (`approve`, `disapprove`), remark | updated loan item | Auditor, Admin | 400, 403, 404 |
| /ws | GET (WebSocket) | token | streaming event messages | Authenticated | 4001, 4003 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Lock transaction company | Company name | `activeCompany` from `CompanyContext` or route location state |
| Realtime expense sync | Live updated expense table | WebSocket message event payload triggering background fetch |
| Select borrower company | Borrower company name | `loanService.getCompanies()` options selected by Finance user |
| Auditor loan approval | Approved status and audit timestamp | Current session user identity, system clock, and status transition |

**Key invariants**:
- When an active company is selected, forms cannot record transactions under a different company name unless the user explicitly switches the global filter back to All Companies.
- Single company supervisors can never change the borrower company away from their assigned company.
- Auditors can only approve or disapprove loans that are currently in Pending Audit Approval status.

**Security model**:
- Role check: Finance and Admin users can create loans and assign borrower companies.
- Role check: Auditor users can execute audit approval on loans in Pending Audit Approval status.
- Scoping rule: Supervisors with a single assigned company are restricted to their assigned entity on all write actions.

**Critical test scenarios**:
- Happy path: A Finance user selects MCT Bar, clicks Add Expense, confirms the company field is locked to MCT Bar, submits the expense, and observes the expense list updating in real time via WebSocket without page refresh, verifies **AC-1**, **AC-3**, **AC-4**.
- Failure and edge case: A user with All Companies selected opens the add transaction sheet, confirms the company dropdown is enabled and selectable, and can pick any active company, verifies **AC-2**.
- Role scoping: A supervisor assigned to MCT Kitchen opens the add loan modal and sees the borrower company locked as read only, whereas a Finance user sees an editable dropdown, verifies **AC-5**, **AC-6**.
- Auditor verification: An auditor navigates to `/loan/borrower`, selects a loan in Pending Audit Approval status, sees the Approve button, submits approval, and verifies the loan moves to Approved status, verifies **AC-7**.

## Build plan

1. Update `CompanyContext.tsx` and `AddTransactionSheetPage.tsx` so that forms inspect `activeCompany` and lock company selection when a specific company is selected, satisfies **AC-1**, **AC-2**.
2. Add WebSocket broadcast calls with types `EXPENSE_CREATED`, `EXPENSE_UPDATED`, and `EXPENSE_DELETED` into `backend/app/api/v1/endpoints/expenses.py`, satisfies **AC-3**.
3. Update `frontend/src/pages/ExpensePage.tsx` to subscribe to expense WebSocket events and trigger background reloads upon event receipt, satisfies **AC-4**.
4. Update `frontend/src/components/dashboard/AddLoanModal.tsx` so that Finance users receive a borrower company dropdown while single company supervisors retain a locked read only display, satisfies **AC-5**, **AC-6**.
5. Update `frontend/src/pages/LoanPage.tsx` to display Approve and Disapprove actions to Auditors for loans in Pending Audit Approval status in both the three dots menu and the view details modal, satisfies **AC-7**.

## Consequences

**Positive**:
- Eliminates transaction data entry errors caused by defaulting to the wrong company.
- Removes the need for manual browser refreshes on the expense page.
- Empowers Finance to record loans across companies without restriction while safeguarding supervisor scoping.
- Restores the missing audit approval step for loans.

**Negative / tradeoffs**:
- Finance users working across multiple companies must set their company filter to All Companies if they intend to switch companies frequently inside the transaction creation sheet.

**Neutral**:
- No database migrations or schema adjustments are required.

## Migration plan

**Strategy**: no migration needed
**Phases**:
1. Deploy frontend and backend code changes in a single standard release.
**Rollback**: Revert git commits if unexpected regression occurs.
**Risks**: Low risk because existing endpoints and models remain intact.
