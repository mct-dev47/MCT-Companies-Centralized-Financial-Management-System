# 0013. Transaction Ledger Deposit and Withdrawal for Loans and Petty Cash

**Date**: 2026-10-29
**Status**: In Progress

## Summary

On the Transaction page, the company that receives money from an approved loan or petty cash top up now sees a **Deposit**, and the company that funds it sees a **Withdrawal**. Today every loan shows as a withdrawal for the borrower only, the lender never sees it, and petty cash top ups do not appear at all. Rows show up on both tabs as soon as Finance endorses (shown as pending) and stay after Audit approves. If a company funds its own petty cash from its own bank account, it shows one Withdrawal and no Deposit. This is a display change only, it does not move or change any money.

## Context

Specs 0011 and 0012 made loans and petty cash top ups move real bank money on Audit approval, and both record which bank funds the money. The Transaction page has not caught up. Its cash ledger tab (the "Deposit" tab) lists only paid sales and paid expenses. Its "All" tab lists sales, expenses and loans, but each loan is one row labelled with the borrower company and always shown as a withdrawal. Petty cash top ups appear in neither tab.

The result is that the borrowing company sees its loan as money going out, the lending company sees nothing, and a petty cash top up is invisible on the page finance staff use to read each company's cash movement.

Two facts about the existing data limit the design. The loans list already returns a loan to both its borrower and its lender when filtered by company, and each loan carries the lender (set from the company that owns the funding bank, spec 0011 AC-7.2). The petty cash ledger does not carry the funding bank, and it filters by the requesting company only, so the funding company cannot see its side of a top up today.

## Requirements

**User stories**:
- As a supervisor of a company that received a loan or petty cash top up, I want to see it as a Deposit on the Transaction page, so my ledger shows the money that came in.
- As a supervisor of the company that funded a loan or petty cash top up, I want to see it as a Withdrawal, so my ledger shows the money that went out.
- As Finance or an admin viewing All Companies, I want both sides of each loan or top up listed, so every company's ledger is correct and the totals balance.

**Acceptance criteria**:
- **AC-1**: For a loan in an eligible status (see AC-5), the borrower company has one row with a Deposit equal to the principal amount and no Withdrawal.
- **AC-2**: For the same loan, the lender company (the company that owns the funding bank) has one row with a Withdrawal equal to the principal amount and no Deposit. A loan with no lender shows only the borrower row.
- **AC-3**: For a petty cash top up in an eligible status whose funding bank belongs to a different company, the requesting company has one Deposit row and the funding company has one Withdrawal row, both for the top up amount.
- **AC-4**: For a petty cash top up in an eligible status whose funding bank belongs to the requesting company itself, the requesting company has one Withdrawal row and no Deposit row. A top up with no funding bank, or a funding bank that cannot be found, shows no rows.
- **AC-5**: Rows appear once Finance has endorsed (status `Pending Audit Approval`) and stay after Audit approves (`Approved`, and for loans also `Paid`, `Partially Paid`, `Overdue`). They never appear before endorsement and disappear if the record is rejected or disapproved (`Rejected by Finance`, `Disapproved by Audit`, `Rejected`). Rows still waiting for Audit are clearly marked as pending.
- **AC-6**: The new rows appear on both tabs: the cash ledger tab and the All tab. On the cash ledger tab, the Deposits and Withdrawals direction filter, the CSV export and the PDF export treat these rows by their Deposit or Withdrawal amount. On the All tab, the type filter has a Petty Cash option.
- **AC-7**: A company scoped user (and an admin who picks one company) sees only that company's side of each record. In All Companies, both sides are listed as two separate rows.
- **AC-8**: This feature only reads data. Bank balances, petty cash wallet balances, loans, sales and expenses are not changed by it.
- **AC-9**: The Audit verify action is not offered on rows that mirror another record's other side (the lender row of a loan, and all petty cash rows), so a verification is never saved against the wrong company.
- **AC-10** (added 2026-10-30): On the cash ledger tab, a sale or expense appears when any part of it is paid, and its row shows only the paid amount (a Deposit for a sale, a Withdrawal for an expense). This is the same rule the Sales page Deposit tab and the Expense page Withdraw tab already use, so the totals agree. Records with nothing paid yet do not appear. The All tab keeps showing every record at its full amount.
- **AC-11** (added 2026-10-30): Petty cash top ups that were approved before Finance started choosing a funding bank (spec 0012) have no funding bank and show no rows, as AC-4 says. They are not deleted and still count in the petty cash wallet.

## Options considered

### Option 1: Build the rows in the page from loans plus one new petty cash read endpoint

Loans already arrive with borrower, lender, amount and status, so the page expands each loan into its two sides. Petty cash gets one small read endpoint that returns eligible top ups with the funding company worked out on the server.

**Pros**:
- Smallest change. Loans need no backend work.
- The funding company is resolved once, on the server, with the same lookup spec 0012 uses.
- Rows exist from endorsement, which a bank ledger cannot provide.

**Cons**:
- The page does the loan expansion, so the rule lives in the frontend for loans and the backend for petty cash.

### Option 2: Read the bank transaction records

Show the bank's own deposit and withdrawal records.

**Pros**:
- One true source for money that actually moved.

**Cons**:
- Bank records exist only after Audit approves, so the "show from endorsement" choice cannot work.
- Own account petty cash writes no bank record, so the requested Withdrawal row would never exist.

### Option 3: One new backend endpoint that returns every ledger row for loans and petty cash

**Pros**:
- All rules in one place.

**Cons**:
- Duplicates the loans list and its access checks for no new information. A larger change than the problem needs.

## Decision

**Chosen option**: Option 1: build the rows in the page, with one new read endpoint for petty cash.

The page expands each eligible loan into a borrower Deposit row and a lender Withdrawal row. A new `GET /api/v1/petty-cash/movements` endpoint returns eligible top ups with the requesting company, the funding company and an own account flag, and the page turns them into rows by the rules in AC-3 and AC-4.

## Rationale

Option 1 fits the data already in hand (Context). The loans list already returns both sides for a company filter, so only the labelling changes. Petty cash is the only place data is missing, so that is the only place the backend grows. Option 2 fails on timing and on the own account case. Option 3 adds code without adding information. Resolving the funding company on the server keeps the ownership comparison in one place, the same comparison spec 0012 uses at approval, so the ledger and the bank cannot disagree about whose account funded a top up.

## Feature design

**Row rules**

| Record | Company | Deposit | Withdrawal |
|---|---|---|---|
| Loan | borrower | principal | none |
| Loan (lender known) | lender | none | principal |
| Petty cash, funding bank is another company's | requesting company | amount | none |
| Petty cash, funding bank is another company's | funding company | none | amount |
| Petty cash, funding bank is the requesting company's own | requesting company | none | amount |
| Petty cash, no funding bank or bank not found | no rows | no rows | no rows |

**Eligible statuses** (compared in lower case): loans `pending audit approval`, `approved`, `paid`, `partially paid`, `overdue`. Petty cash `pending audit approval`, `approved`.

**Row status shown**: `Pending Audit Approval` is shown as `Pending`, every later eligible status as `Paid`, except a loan `Overdue`, which keeps the existing `Overdue` mapping.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /petty-cash/movements | GET | company_name (optional, "All Companies" means none) | list of: topup_id, reference_no, topup_date, amount, description, status, company_id, company_name, funding_company_id, funding_company_name, is_own_account, created_at | same as the other petty cash read endpoints | 404 unknown company |

The endpoint returns only top ups in an eligible status that have a resolvable funding bank. When `company_name` is given, it returns top ups where that company is the requesting company or the funding company. It skips reference numbers that start with `SEED-`, like the rest of the petty cash service.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Expand a loan | borrower name and id | `LoanItem.borrower` and `borrowerId` from the loans list |
| Expand a loan | lender name and id | `LoanItem.lender` and `lenderId` from the loans list (company of the funding bank, spec 0011) |
| Expand a loan | amount | `LoanItem.amount` (principal) |
| Expand a loan | eligibility and pending marker | `LoanItem.status` from the loans list |
| Petty cash movements | requesting company | `petty_cash_topups.company_id` and its company name |
| Petty cash movements | funding company | `BankAccount.company_id` of `petty_cash_topups.bank_account_id`, else the company matched by `BankAccount.company_name` (same lookup as spec 0012) |
| Petty cash movements | is own account | funding company id equals the requesting company id |
| Petty cash movements | amount, date, reference, status | `petty_cash_topups.amount`, `topup_date`, `reference_no`, `status` |
| Row for the page | company shown | the side's company name, so the existing company filter works unchanged |
| Row for the page | unique row id | existing loan id for the borrower row, then a suffix: `:lender` for the loan lender row, `:in` and `:out` for petty cash rows |

**Key invariants**:
- Every record yields at most one row per company, and never two rows for the same company.
- A Deposit row is only shown for a company that actually receives the money, and an own account top up never yields a Deposit.
- The sum of Deposits equals the sum of Withdrawals across All Companies for loans and outside funded top ups. Own account top ups add a Withdrawal with no matching Deposit by design.
- Nothing here writes to the database.

**Security model**:
- Loans keep the existing access checks of `GET /loans` (a company user only gets loans where their company is a party). The new petty cash endpoint follows the existing petty cash read endpoints, which have no login dependency and rely on the page scoping the request to the user's company. See Follow-up.

**Configuration required**: none.

**Critical test scenarios**:
- Loan: borrower sees a Deposit, lender sees a Withdrawal, both for the principal, verifies **AC-1, AC-2, AC-7**.
- Outside funded top up: requesting company Deposit and funding company Withdrawal, verifies **AC-3, AC-7**.
- Own account top up: one Withdrawal, no Deposit, verifies **AC-4**.
- Endorsed but not approved: rows appear marked pending. Then Audit disapproves and the rows disappear, verifies **AC-5**.
- Not yet endorsed, or no funding bank: no rows, verifies **AC-4, AC-5**.
- Direction filter, CSV and PDF export use the Deposit and Withdrawal amounts on both tabs, verifies **AC-6**.
- A loan lender row and a petty cash row show no Audit verify action, verifies **AC-9**.

## Build plan

1. Backend: add `PettyCashMovementOut` to `backend/app/schemas/petty_cash.py` and a `list_movements(company)` method to `PettyCashService` that returns eligible top ups with the requesting company, the funding company (reusing the bank lookup used for spec 0012) and `is_own_account`. Satisfies **AC-3, AC-4, AC-5**.
2. Backend: add `GET /petty-cash/movements` in `backend/app/api/v1/endpoints/petty_cash.py`, placed before any `/{id}` style route. Satisfies **AC-3, AC-4, AC-7**.
3. Frontend service: add `getMovements(company?)` and its type to `frontend/src/services/pettyCashService.ts`. Satisfies **AC-3, AC-4**.
4. Frontend type: add `'Petty Cash'` to `DashboardTransactionItem.type` in `dashboardService.ts` and fix any place that switches on that type. Satisfies **AC-6**.
5. `TransactionPage.tsx`: replace the single loan row with the borrower Deposit row and the lender Withdrawal row, applying the eligible status filter and the row status mapping. Satisfies **AC-1, AC-2, AC-5**.
6. `TransactionPage.tsx`: fetch petty cash movements with the company filter and turn them into rows by the row rules table. Satisfies **AC-3, AC-4, AC-7**.
7. `TransactionPage.tsx`: let the cash ledger tab include these rows (today it keeps only paid sales and paid expenses), change its direction filter to use the Deposit and Withdrawal amount instead of the record type, add a Petty Cash option to the All tab type filter, and add a small "Pending Audit" tag on pending rows in the cash ledger tab. Correct the stale comment that says loans are recorded as expenses. Satisfies **AC-5, AC-6**.
7a. (added 2026-10-30) Move the paid amount rule out of `SalesPage.tsx` (`getPaidDepositForSale`) and `ExpensePage.tsx` (`getPaidDisbursementForExpense`) into one shared helper. `TransactionPage.tsx` uses it so the cash ledger tab lists any sale or expense with a paid part, showing the paid amount. Satisfies **AC-10**.
8. `TransactionPage.tsx`: hide the Audit verify action and make row click read only for lender loan rows and petty cash rows, and make sure the verify handler cannot receive a suffixed id. Satisfies **AC-9**.
9. Verify end to end with one outside funded loan, one outside funded top up, one own account top up, and one rejected record, in both a single company view and All Companies. Satisfies **AC-1 to AC-9**.

## Consequences

**Positive**:
- Each company's ledger shows its own side of loans and petty cash, and All Companies totals balance.
- Loans need no backend change, and the one new endpoint is small and read only.

**Negative / tradeoffs**:
- Pending rows appear in a ledger people read as cash that has moved. They are marked pending, but they are not settled money until Audit approves.
- An own account top up shows a Withdrawal while the bank balance does not change (spec 0012 AC-3), so the ledger and the bank card can differ for that case.
- The new petty cash endpoint has no login check, matching its neighbours.

**Neutral**:
- Loan repayments are not part of this change, and the loan row keeps its current id for the borrower side so existing audit actions still work.

## Follow-up

- [ ] Decide whether an own account petty cash top up should also deduct the company's bank (a withdrawal from its own account). That would make the new Withdrawal row match the bank card. It changes spec 0012 AC-3, so it needs its own decision.
- [ ] The petty cash read endpoints have no login or role dependency. Consider adding the same company access check that `GET /loans` uses, for all of them together.
- [ ] Show loan repayments as Deposit and Withdrawal rows later if finance wants the full cash picture.
