# 0014. Real Audit Status for Sales and Expenses, and Funding Bank on Petty Cash

**Date**: 2026-10-30
**Status**: In Progress

## Summary

Two fixes. First, the audit status you see on the Transaction, Sales and Expense pages becomes the real one. Today a sale or expense that Audit verifies is remembered only inside that one browser, so no other user sees it and the Audit account does not see anyone else's work. After this change the status is saved on the server. Only Audit and Admin accounts can change it, and everyone reads the same value. Second, the petty cash detail window and the petty cash table show which bank funded a top up and which company owns that bank. Loans and petty cash keep their audit status tied to Audit's approval, so they are never marked audited by a separate button.

## Context

Spec 0008 (section 2.1) chose to keep the audit decision in browser `localStorage` (`mct_sales_audit_status_v1`, `mct_expense_audit_status_v1`). The backend has no audit columns on `sales` or `expenses`, and `SaleOut` and `ExpenseOut` do not return any audit field. The frontend mappers read `audit_status`, `audited_by`, `audited_at` and `audit_remarks` from the response, but those keys never arrive, so the browser copy is the only copy. This is why the Audit account does not see the real status.

Loans have a second problem. `loanService` marks a loan `Verified` only when its status is `Approved` or `Paid`, so `Partially Paid` and `Overdue` loans (already approved by Audit) show as pending.

For petty cash, spec 0012 stores the funding bank id on each top up (`petty_cash_topups.bank_account_id`), but the petty cash ledger endpoint does not return it. The detail window on `/petty-cash` therefore cannot show it.

Stack: FastAPI with SQLAlchemy on PostgreSQL (Supabase), with a local SQLite fallback, and a React and TypeScript frontend. Sales and expenses are read through the Supabase client with a SQLAlchemy fallback, and written to both.

## Requirements

**User stories**:
- As an Audit user, I want the verification I make to be saved for everyone, so the status is the same on every account and every browser.
- As a company, Finance or Admin user, I want to see the true audit status of my sales and expenses, so I know what Audit has checked.
- As a Finance or Audit user reading a petty cash top up, I want to see which bank funded it and which company owns that bank.

**Acceptance criteria**:
- **AC-1**: Sales and expenses have a saved audit status of `Pending Audit`, `Verified` or `Flagged`, with who set it, when, and an optional remark. New records start as `Pending Audit`.
- **AC-2**: Sales and expense list and detail endpoints return the audit status, auditor name, audit time and remark. The Transaction, Sales and Expense pages show that value and ignore any value kept in the browser.
- **AC-3**: Only an Audit or Admin account can change a sale or expense audit status. Any other role gets a 403 and nothing changes.
- **AC-4**: Verifying, flagging, or returning a record to `Pending Audit` is saved on the server and shows on every other account after a refresh. Returning to `Pending Audit` clears the auditor name and time.
- **AC-5**: The auditor name and time come from the server (the signed in user and the server clock), never from the browser.
- **AC-6**: If saving fails, the page shows the previous status again and tells the user it failed.
- **AC-7**: Audit statuses that were kept only in a browser are not imported. Those records show `Pending Audit` until Audit verifies them again. The old browser keys are removed.
- **AC-8**: Loans show `Audited` once Audit has approved them, which includes the statuses `Approved`, `Paid`, `Partially Paid` and `Overdue`. Before approval they show `Pending Audit`. Petty cash rows follow the same rule (Audit approval means audited). Loan and petty cash rows on the Transaction page have no Audit verify button.
- **AC-9**: The petty cash detail window shows the funding bank (bank name and account name), the company that owns that bank, and a note "Own account" when it belongs to the requesting company. When Finance has not yet chosen a bank it shows "Not assigned yet". Full account numbers are never shown.
- **AC-10**: The petty cash table on `/petty-cash` has a "Funding Bank" column showing the bank name and owning company for top ups that have one, and a dash for everything else (including expenses).

## Options considered

### Option 1: Audit columns on the `sales` and `expenses` tables

Add `audit_status`, `audited_by`, `audited_at`, `audit_remarks` to both tables and one audit endpoint on each.

**Pros**:
- Same shape that loans already use (`audit_reviewed_by`, `audit_reviewed_at`, `audit_remark`).
- Status is returned in the same read that returns the record. No extra query or join.
- The Supabase read path (`select("*")`) picks the columns up with no query change.

**Cons**:
- Two migrations, and about sixteen response builders to extend.

### Option 2: One shared `transaction_audits` table

One table keyed by record type and record id.

**Pros**:
- One place for sales, expenses and loans.

**Cons**:
- Needs a second query or a join on every list, and a way to keep it in step when a record is deleted. It is more work for no extra information.

### Option 3: Keep `localStorage`

**Cons**:
- This is the current behavior and the cause of the problem.

## Decision

**Chosen option**: Option 1: audit columns on `sales` and `expenses`.

Add the four columns, return them from every sale and expense response, add `PATCH /sales/{id}/audit` and `PATCH /expenses/{id}/audit` restricted to Audit and Admin, and make the frontend services call them. Extend the petty cash ledger with the funding bank fields and show them in the detail window and the table.

## Rationale

Option 1 matches how loans and petty cash already store their audit result, needs no join, and is read through the same paths that already serve the records. Option 2 only pays off if the three record types needed one combined audit report, which nobody asked for. Taking the auditor name from the signed in user on the server (AC-5) removes the existing trust in a browser supplied name. Not importing old browser values (AC-7) is deliberate: a value in one person's browser cannot be tied to a real Audit action, so treating it as verified would put a false "Audited" on records.

## Feature design

**Data model** (additive, nullable except the status which has a default):

| Table | Column | Type | Rules |
|---|---|---|---|
| sales | audit_status | VARCHAR(20) | not null, default `Pending Audit`, one of `Pending Audit`, `Verified`, `Flagged` |
| sales | audited_by | VARCHAR(100) | null |
| sales | audited_at | timestamp with time zone | null |
| sales | audit_remarks | TEXT | null |
| expenses | same four columns | same | same |

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /sales/{sales_id}/audit | PATCH | audit_status (required), remarks (optional) | the full sale with audit fields | Audit or Admin only | 403 other roles, 404 unknown sale, 422 bad status |
| /expenses/{expense_id}/audit | PATCH | audit_status (required), remarks (optional) | the full expense with audit fields | Audit or Admin only | 403, 404, 422 |
| /sales, /sales/{id}, /expenses, /expenses/{id} | GET | unchanged | adds audit_status, audited_by, audited_at, audit_remarks | unchanged | unchanged |
| /petty-cash/ledger | GET | unchanged | adds funding_bank_id, funding_bank_name, funding_account_name, funding_company_name, is_own_account on top up and request entries | unchanged | unchanged |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Set audit status | audit_status | request body, checked against the three allowed values |
| Set audit status | audited_by | name of the signed in user, looked up in `users` by the token's user id, falling back to the email |
| Set audit status | audited_at | server clock at the time of the request |
| Set audit status | audit_remarks | request body, optional, trimmed |
| Return to `Pending Audit` | audited_by, audited_at | set to null |
| Show audit status on a sale or expense | status, who, when, remark | the four columns on the row |
| Show audit status on a loan | Audited or Pending | loan status: `approved`, `paid`, `partially paid`, `overdue` mean Audited |
| Show audit status on petty cash | Audited or Pending | top up status: `approved` means Audited |
| Funding bank on a petty cash entry | bank name, account name | `bank_accounts` row whose id equals `petty_cash_topups.bank_account_id` |
| Funding company on a petty cash entry | company name | `BankAccount.company_id`, else the company matched by `BankAccount.company_name` (same lookup as specs 0012 and 0013) |
| Own account note | is_own_account | funding company id equals the requesting company id |
| Role check | allowed or 403 | `role` and `is_admin` on the authenticated user (`audit`, `auditor`, `admin`) |

**Key invariants**:
- A sale or expense is `Verified` only because an Audit or Admin account saved it on the server.
- `audited_by` and `audited_at` are present only when the status is `Verified` or `Flagged`.
- The audit endpoints change only the audit columns, never the amount, date, particulars or any other field.

**Security model**:
- The audit endpoints require the same sign in as the rest of the sales and expense endpoints and then an Audit or Admin role. Company scope is checked with `check_company_access` as on the other write endpoints.
- The petty cash ledger endpoint keeps its current access (no login dependency, see spec 0013 follow up). It returns the bank name, account name and owning company, but not the account number.

**Configuration required**: run `backend/migrate_audit_status.py` once on the database (it is safe to run again). It also asks the Supabase API to reload its schema cache.

**Critical test scenarios**:
- Audit verifies a sale on one browser, a company user on another browser sees `Audited` (AC-2, AC-4).
- A company or Finance account calls the audit endpoint and gets 403 with no change (AC-3).
- Audit unmarks a record, the auditor name and time clear (AC-4).
- The server rejects a request that has an unknown status (AC-1).
- The save fails (server stopped), the row goes back to its old status with a message (AC-6).
- A `Partially Paid` loan shows Audited, a loan awaiting Audit shows Pending, loan and petty cash rows have no verify button (AC-8).
- Petty cash window with an outside bank, with the company's own bank, and before endorsement (AC-9). Table column for all three (AC-10).

## Build plan

1. Migration `backend/migrate_audit_status.py` adds the four columns to `sales` and `expenses` on PostgreSQL and in the SQLite file, then reloads the Supabase schema cache. Satisfies **AC-1**.
2. Add the columns to `Sale` and `Expense` in `backend/app/models/finance.py`. Satisfies **AC-1**.
3. Add the audit fields to `SaleOut` and `ExpenseOut`, a small `AuditReviewIn` schema, and a helper that reads the four fields from either a Supabase row or a model object. Add them to every place that builds `SaleOut` and `ExpenseOut`. Satisfies **AC-2**.
4. Add `require_audit_or_admin_user` to `backend/app/core/dependencies.py`, and the two `PATCH .../audit` endpoints that write to Supabase and the local table. Satisfies **AC-3, AC-4, AC-5**.
5. Frontend `salesService.ts` and `expenseService.ts`: read the audit fields from the response, remove the `localStorage` audit map and its override, delete the two old browser keys, and make `updateSaleAuditStatus` and `updateExpenseAuditStatus` call the new endpoints and throw on failure. Satisfies **AC-2, AC-4, AC-7**.
6. Update the callers (`TransactionPage`, `SalesPage`, `ExpensePage`, `AuditTransactionModal`) to restore the previous status and show a message when the save fails. Satisfies **AC-6**.
7. `loanService.ts`: map `Partially Paid` and `Overdue` as audited. `TransactionPage.tsx`: no verify button on loan rows (the status badge stays). Satisfies **AC-8**.
8. Backend petty cash: add the funding fields to `PettyCashLedgerEntry`, share one funding bank lookup between `list_ledger` and `list_movements`. Satisfies **AC-9, AC-10**.
9. Frontend petty cash: map the new fields in `pettyCashService.ts`, add the "Funding Bank" block to the detail window and the column to the table in `PettyCashPage.tsx`. Satisfies **AC-9, AC-10**.
10. Verify end to end with an Audit account and a company account (two sessions), and with the petty cash cases. Satisfies **AC-1 to AC-10**.

## Migration plan

**Strategy**: additive migration, no data transform.
**Phases**:
1. Run the migration (columns appear with the default `Pending Audit`). Existing rows become `Pending Audit`.
2. Deploy the backend and frontend that read and write the columns.
**Rollback**: revert the code. The extra columns are harmless and can stay.
**Risks**: the backend model includes the new columns, so the migration must run before the backend restarts. Every sale and expense that was verified in a browser shows `Pending Audit` until Audit verifies it again (AC-7).

## Consequences

**Positive**:
- One audit status for every account and browser.
- Audit actions have a real, server stamped name and time.

**Negative / tradeoffs**:
- Records that Audit verified before this change need to be verified again.
- About sixteen response builders change, so a missed one would show the default status. The Transaction, Sales and Expense pages are tested against this.

**Neutral**:
- Editing an already audited record on the server does not reset its audit status. The screen locks audited records, as before.

## Follow-up

- [ ] Decide whether the server should refuse to edit, or reset the status of, a record that is already `Verified`. Today only the screen locks it.
- [ ] Spec 0008 section 2.1 (`localStorage` audit map) is replaced by this spec.
- [ ] The petty cash read endpoints have no login check (also listed in spec 0013).
