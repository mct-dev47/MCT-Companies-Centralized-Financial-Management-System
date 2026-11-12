# 0040. Transactions Daily Summary and Remarks Refinements

**Date**: 2026-11-09
**Status**: Implemented

## Summary

This specification refines the transaction management experience across sales, expenses, and transaction ledgers. We add a daily summary view per bank account alongside all transactions, add an editable remarks field for supervisors and finance staff, streamline table columns by removing company and type from the general transactions table, remove the clear filter buttons, eliminate the GCash fee, and ensure the deposit tab only displays records that are strictly deposited.

## Context

The current transaction workspace contains clutter that slows down daily reconciliation. Users on the transaction page see company and type columns in every row even when viewing a single company, while lacking a fast way to record operational notes. The clear filter controls in both the company picker dropdown and the toolbar are redundant and can trigger accidental resets.

In the deposit ledger, records that are pending or paid but not yet deposited create confusion because staff need the deposit tab to reflect actual money deposited into the bank. In addition, sales entries incur an unnecessary GCash fee field, and cash transactions require manual toggling to deposited status instead of defaulting to deposited.

Finally, finance and audit officers need to view daily cash flow grouped by date and separated per bank account so they can verify daily bank statements at a glance without doing manual arithmetic across multiple tabs.

## Requirements

**User stories**:
* As a finance officer or supervisor, I want to toggle between a daily summary per bank and all individual transactions, so that I can reconcile bank accounts by date without manual calculations.
* As a supervisor or finance officer, I want to add and edit operational remarks on sales, expenses, and transaction rows, so that our team can communicate context directly on each record.
* As a finance user, I want a direct button in the transaction audit modal to quickly record remarks without opening separate forms.
* As an accounting clerk, I want the deposit tab to show only transactions whose deposit status is marked deposited, so that pending, unpaid, and undeposited payments do not distort the cash ledger.
* As a cashier creating a sale, I want cash payments to default to deposited and GCash payments to have no extra fee input, so that sales logging is quick and accurate.
* As a user, I want the table in the transaction tab to hide company and type columns, and the clear filter buttons to be removed, keeping the interface clean and focused.

**Acceptance criteria**:
* **AC-1**: In `TransactionPage.tsx`, the clear filter button inside the company dropdown and the clear filters reset button in the filter toolbar are removed.
* **AC-2**: In the transactions table, the company column and type column are removed, and a new remarks column is added where supervisors and finance staff can view and edit remarks.
* **AC-3**: In `AuditTransactionModal.tsx`, an immediate remarks input button and popover or text area are added, allowing supervisors and finance officers to update remarks directly.
* **AC-4**: In `TransactionPage.tsx`, the deposit tab strictly filters rows to records where `deposit_status === 'Deposited'`. Paid but undeposited, pending, and unpaid transactions remain visible only in the all transactions view.
* **AC-5**: In sales entry modals and transaction sheets, the GCash fee input is completely removed and defaults to zero. When payment method is cash, the default deposit status is set to `Deposited`.
* **AC-6**: A dedicated remarks column is added to the database models and API schemas for `sales` and `expenses`, editable by users with supervisor, finance, or admin permissions.
* **AC-7**: In `TransactionPage.tsx`, a switch or toggle allows switching between daily summary and all transactions. The daily summary groups transactions by date and displays total deposits, total withdrawals, and daily net balance for each bank account.

## Options considered

### Option 1: Inline remarks with dedicated daily summary switch and strict deposit filtering

Add a dedicated `remarks` column to sales and expenses backend tables, display a remarks column in the transactions table with quick edit, add an immediate remarks button in the finance audit modal, provide a toggle for daily summary per bank account, and enforce strict filtering for deposited records.

**Pros**:
* Clean separation between operational remarks and auditor review notes
* Daily summary per bank account provides instant bank reconciliation
* Deposit tab reflects only true deposited cash flow

**Cons**:
* Requires a small database migration to add remarks to sales and expenses

### Option 2: Overload audit remarks and use a collapsible banner for daily summary

Store remarks in the existing `audit_remarks` column and show daily bank totals in a collapsible banner above the main table without adding new database fields.

**Pros**:
* Avoids database schema migrations

**Cons**:
* Conflates formal audit review notes with day to day operational remarks
* A top banner clutters the table view and fails to provide a dedicated daily breakdown

## Decision

**Chosen option**: Option 1: Inline remarks with dedicated daily summary switch and strict deposit filtering

We add dedicated remarks fields to sales and expenses, provide a daily summary view per bank account in transactions, remove company and type columns from the transactions table, remove clear filter buttons, remove the GCash fee, default cash sales to deposited, and restrict the deposit tab to deposited records only.

## Rationale

Operational remarks from supervisors and finance officers serve a different purpose than audit review remarks. Audit remarks track verification, discrepancies, and compliance checks, whereas operational remarks explain payment specifics, check releases, or collection arrangements. Giving remarks their own column ensures audit integrity is preserved while keeping communication fluid.

Switching between daily summary and all transactions lets users choose between high level bank reconciliation and granular transaction inspection. Filtering the deposit tab strictly by deposited status aligns the ledger with actual bank balances and prevents uncollected funds from inflating deposit totals.

## Feature design

**Data model sketch**:

Table: `sales`
* `sales_id`: Integer, primary key
* `company_id`: Integer, foreign key to company
* `payment_method`: String(100)
* `payment_status`: String(50)
* `deposit_status`: String(50), default `Deposited` when payment method is `Cash`, otherwise `Not Deposited`
* `transaction_date`: Date
* `cheque_no`: String(100), nullable
* `amount`: Numeric(15,2)
* `particulars`: Text
* `remarks`: Text, nullable, operational notes for supervisor and finance
* `audit_status`: String(20), default `Pending Audit`
* `audit_remarks`: Text, nullable

Table: `expenses`
* `expense_id`: Integer, primary key
* `company_id`: Integer, foreign key to company
* `payment_method`: String(100)
* `expense_date`: Date
* `amount`: Numeric(15,2)
* `particulars`: Text
* `remarks`: Text, nullable, operational notes for supervisor and finance
* `audit_status`: String(20), default `Pending Audit`
* `audit_remarks`: Text, nullable

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/sales/{id}/remarks | PATCH | remarks: string | updated sale record | supervisor, finance, admin | 400, 404, 403 |
| /api/v1/expenses/{id}/remarks | PATCH | remarks: string | updated expense record | supervisor, finance, admin | 400, 404, 403 |
| /api/v1/sales | POST | amount, date, particulars, remarks, deposit_status | created sale | supervisor, finance, admin | 400, 422 |
| /api/v1/expenses | POST | amount, date, particulars, remarks | created expense | supervisor, finance, admin | 400, 422 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| View transactions | Remarks | Database column `sales.remarks` or `expenses.remarks` |
| Edit remarks | Updated remarks string | User input via table row popover or modal button |
| Daily summary view | Date and bank breakdown | Derived by grouping transactions by date and `bankAccountId` |
| View deposit tab | Deposited rows only | Filtered where `deposit_status === 'Deposited'` |
| Create cash sale | Default deposit status | Hardcoded default `Deposited` when payment method is `Cash` |

**Key invariants**:
* The deposit tab only displays records that have `deposit_status === 'Deposited'`.
* Cash sales default to `deposit_status = 'Deposited'`.
* GCash sales have no service fee deducted or input.
* Supervisor and finance roles can modify the remarks column at any time without resetting the audit status.

**Security model**:
* Only authenticated users with roles `supervisor`, `finance`, `owner`, or `admin` may update record remarks.
* Audit officers can view remarks alongside audit remarks.

**Critical test scenarios**:
* Happy path: User creates a cash sale and verifies that deposit status defaults to `Deposited`, satisfies **AC-5**.
* Happy path: User selects GCash in sales modal and verifies no fee input is displayed and fee calculation is omitted, satisfies **AC-5**.
* Happy path: User opens deposit tab and verifies that only records with deposit status `Deposited` appear, while pending and undeposited records remain in all transactions, verifies **AC-4**.
* Happy path: User switches to daily summary view and sees records grouped by date with per bank account deposit and withdrawal totals, verifies **AC-7**.
* Happy path: Supervisor updates remarks via the table column or modal button and sees the note persist across reloads, verifies **AC-2**, **AC-3**, **AC-6**.
* Filter cleanup: User inspects the company dropdown and toolbar and verifies clear filter buttons are gone, verifies **AC-1**.

## Build plan

1. Backend database migration: add nullable `remarks` column to `sales` and `expenses` tables, satisfies **AC-6**.
2. Backend API endpoints: update sale and expense schemas to accept `remarks` and create PATCH endpoints for quick remarks updates, satisfies **AC-6**.
3. Frontend service updates: update `salesService.ts`, `expenseService.ts`, and `dashboardService.ts` to include `remarks` and support remarks updates, satisfies **AC-6**.
4. Sales modals update: in `AddSalesModal.tsx`, `EditSalesModal.tsx`, and `AddTransactionSheetPage.tsx`, remove GCash fee input, default Cash sales to `Deposited`, and add `remarks` field, satisfies **AC-5**, **AC-6**.
5. Transactions table refinements: in `TransactionPage.tsx`, remove company and type columns, add remarks column with quick edit popover, satisfies **AC-2**.
6. Audit modal enhancement: in `AuditTransactionModal.tsx`, add immediate remarks input button and form for supervisor and finance, satisfies **AC-3**.
7. Deposit tab filtering: in `TransactionPage.tsx`, restrict deposit ledger to items where `deposit_status === 'Deposited'`, satisfies **AC-4**.
8. Daily summary per bank: in `TransactionPage.tsx`, add a view switcher for daily summary and render grouped date cards with bank breakdown, satisfies **AC-7**.
9. Filter cleanup: in `TransactionPage.tsx`, remove the clear filter button from the company dropdown and toolbar, satisfies **AC-1**.

## Consequences

**Positive**:
* Quick bank reconciliation through the daily summary view per bank account.
* Cleaner transaction tables without redundant company and type columns.
* Accurate deposit ledger reflecting only deposited money.
* Fast communication via dedicated operational remarks.

**Negative / tradeoffs**:
* Requires running a lightweight database schema migration to add remarks columns.

**Neutral**:
* Existing sales and expense records will have null remarks until updated.

## Migration plan

**Strategy**: Strangler pattern with backwards compatible nullable columns
**Phases**:
1. Run database migration adding nullable `remarks` column to `sales` and `expenses`.
2. Deploy backend schemas and patch endpoints supporting `remarks`.
3. Deploy frontend UI updates for transactions table, modals, daily summary, and filter cleanups.
**Rollback**: The `remarks` columns are nullable and can remain untouched if frontend changes are reverted.
**Risks**: None. All changes preserve existing financial totals and audit logs.

