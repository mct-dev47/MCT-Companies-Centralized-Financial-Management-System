# 0024. Finance Loan Details Redirect and Petty Cash Refinements

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification settles three user experience and reliability refinements across the loan and petty cash modules. When a finance user records or requests an inter-company loan, the interface immediately redirects to the loan details modal so the finance officer can review and endorse the loan to internal audit in one continuous action. In the petty cash replenishment modal, the funding bank account selector omits the raw account number to protect account privacy and reduce clutter. In the petty cash backend service and database schema, the petty cash wallet definition ensures the balance column is safely present and handled, resolving an internal server error that prevented newly submitted and endorsed requests from appearing in the ledger.

## Context

During daily financial operations, finance officers encounter workflow friction and runtime issues in two core modules.

In the company loan module, finance officers submitting a loan request on behalf of a company or operational unit are returned to the table view. To endorse the loan to internal audit, they have to manually find the newly created loan row in the table, open its action menu, and select view or endorse. Directing finance immediately to the loan details modal after submission allows them to inspect the created terms and click endorse right away.

In the petty cash module, the top up modal presents a list of funding bank accounts for finance endorsement. The options displayed the internal bank account number alongside the bank name and owning company. Displaying raw account numbers in dropdown selectors is unnecessary for operational identification and exposes account numbers across shared screens.

Additionally, when finance submitted a petty cash top up with direct endorsement to internal audit, the page failed to show the transaction. Instead, the browser console reported an HTTP 500 error from `GET /api/v1/petty-cash/summaries` originating in `PettyCashPage.tsx:233`. Investigation localized the root cause to `PettyCashWallet`: the SQLAlchemy model included a `balance` column, but the PostgreSQL database table `petty_cash_wallets` was provisioned without it. Whenever the backend calculated company wallet thresholds, SQLAlchemy queried `petty_cash_wallets.balance`, triggering a database column missing exception that aborted summaries and blocked ledger updates.

## Requirements

**User stories**:
- As a finance officer, I want requesting an inter-company loan to automatically open its loan details modal, so that I can endorse it to internal audit immediately without searching through the table.
- As a finance officer, I want the funding bank account selector in the petty cash top up modal to show the bank name and company name without the raw account number, so that banking identifiers stay clean and confidential.
- As a finance officer, I want petty cash top up submissions to load smoothly without HTTP 500 crashes, so that my endorsed top up request appears in the petty cash ledger immediately.

**Acceptance criteria**:
- **AC-1**: When a user with finance or admin privileges successfully submits a loan request in the add loan modal, the application sets the pending tab active, navigates to borrower scope if needed, and opens the loan details modal for the newly created loan.
- **AC-2**: The loan details modal presents an Endorse button for pending finance requests, opening the endorsement dialog to select the funding bank, confirm interest and due date, and submit to internal audit.
- **AC-3**: The funding bank account selector in the petty cash top up modal renders each option formatted as bank name, account name, and company name, omitting any account number string.
- **AC-4**: The `petty_cash_wallets` database table has the balance column safely ensured, preventing undefined column programming errors in all environments.
- **AC-5**: Database initialization routines in `backend/app/db/session.py` automatically guarantee the presence of the `balance` column in `petty_cash_wallets` on startup.
- **AC-6**: In `PettyCashPage.tsx`, summary and ledger data loading uses resilient handling so that transactions load and display promptly after top up creation.

## Options considered

### Option 1: Inline modal transition and resilient schema alignment

1. In `LoanPage.tsx`, update `handleLoanAdded` to set `viewLoanItem` to the newly created loan when `canApprove` is true. Ensure the view type is set to Borrower so the record is visible behind the modal.
2. In `TopUpPettyCashModal.tsx`, format bank selector options as `{bankName} - {accountName} ({companyName})`.
3. In `backend/app/db/session.py`, ensure `ALTER TABLE petty_cash_wallets ADD COLUMN IF NOT EXISTS balance NUMERIC(15, 2) DEFAULT 0.00` executes during startup.
4. In `PettyCashPage.tsx`, load summaries and ledger with resilient error isolation and display accurate endorsement feedback.

**Pros**:
- Preserves the existing modal architecture while removing unnecessary clicks.
- Eliminates the 500 server crash at the database schema level.
- Keeps sensitive bank account numbers off the user interface.

**Cons**:
- None identified.

### Option 2: Combine Add Loan and Endorse into a single multi step modal

Replace `AddLoanModal` with a combined wizard that records the loan and collects endorsement inputs before saving.

**Pros**:
- Reduces total modal instances from two to one.

**Cons**:
- Increases modal complexity and couples loan creation with immediate funding approval.
- Breaks supervisor loan submission where endorsement must happen separately.

## Decision

**Chosen option**: Option 1: Inline modal transition and resilient schema alignment.

We redirect finance officers directly to the loan details modal upon loan creation, strip bank account numbers from petty cash funding selectors, ensure the database column exists on startup, and protect ledger data loading against unhandled errors.

**Implementation skills**: `develop` (`antigravity/develop`, `.agents/skills/develop/`)

## Rationale

Redirecting directly to the loan details modal reuses the tested `viewLoanItem` component and its existing `Endorse` action. Stripping bank account numbers from the selector keeps the label uncluttered while retaining the institution and owning company. Ensuring the `balance` column exists in `petty_cash_wallets` on database initialization eliminates the undefined column error permanently across PostgreSQL and SQLite test environments.

## Feature design

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Loan submission as Finance | Open `viewLoanItem` modal | Returned `LoanItem` from `loanService.addLoan` |
| Endorse click | Open `approveLoanItem` dialog | Existing `ApproveLoanModal` workflow |
| Funding bank selection | Bank label text | `{bankName} - {accountName} ({companyName})` |
| Petty cash summary query | Safe threshold and balance | `petty_cash_wallets` with guaranteed balance column |

**Key invariants**:
- Only finance and admin roles are redirected to endorse upon loan creation; regular company users remain on the confirmation view.
- Funding bank accounts must never display the raw account number in the petty cash request selector.
- The `petty_cash_wallets` table must support both dynamic calculation and physical column reads without raising database errors.

## Build plan

1. Update `frontend/src/components/dashboard/TopUpPettyCashModal.tsx` to remove account numbers from the bank selector.
2. Ensure database column migration in `backend/app/db/session.py` on startup and create a standalone migration script.
3. Update `frontend/src/pages/PettyCashPage.tsx` to handle summaries and ledger loading with resilient error isolation and role aware feedback.
4. Update `frontend/src/pages/LoanPage.tsx` to automatically redirect finance and admin users to `viewLoanItem` on successful loan creation.
5. Verify changes with automated tests and end to end validation.

