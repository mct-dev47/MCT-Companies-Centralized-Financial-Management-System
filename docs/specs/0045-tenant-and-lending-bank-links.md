# 0045 — Tenant and Lending Money Through a Chosen Bank

**Status:** Implemented
**Companies:** JK Property and Ventures (Tenants), FILCAP Prime Holdings Corp. (Lending)

## Goal

Money that tenants and borrowers move must show in Sales/Expenses and in the bank balance automatically.

| Event | Record created | Bank effect |
|---|---|---|
| Tenant rent payment (Paid / Partially Paid) | **Sale** (category *Rental Income*), Deposited on the payment date | Credit to the lease's bank |
| Loan release (new borrower) | **Expense** (category *Loan Release*), paid | Debit from the borrower's bank |
| Borrower repayment | **Sale** (category *Loan Repayment*), amount = payment + penalty, Deposited | Credit to the borrower's bank |

Missed marks and ₱0 payments create nothing.

## Where the bank is chosen

One bank per lease or borrower, picked in its modal (`CompanyBankSelect`):

- **Tenant modal:** "Bank Account (Rent Deposits)". Required on new leases. Older leases without a bank create no sales until a bank is set.
- **Borrower modal:** "Release From / Deposit To Bank". Required on new borrowers. The release can't exceed the bank's current balance.

Changing the bank later:

- **Lease:** new payments go to the new bank. Recorded payments keep their sale and bank.
- **Borrower:** the release expense moves to the new bank. New repayments go to the new bank; recorded repayments keep theirs. Borrowers created before this spec have no release expense, and adding a bank to them only sets where repayments go (no retroactive release).

## Edits and deletes

The linked sale/expense follows the source record: edit → updated, delete → removed (money reversed and the bank entries purged). This covers:

- Payment edits and deletes
- Lease and borrower deletes
- Principal or date changes on a loan

**Audit lock:** once an Auditor marks the linked sale or expense **Verified**, the source record is locked. Editing or deleting it returns `409` and nothing changes. A borrower delete is all-or-nothing: it's blocked if the release or any repayment is Verified.

## Data (migration `0060_income_bank_links`)

- `tenant_leases.bank_account_id`, `tenant_lease_payments.sale_id`
- `borrowers.bank_account_id`, `borrowers.release_expense_id`
- `lending_transactions.sale_id`

## Code

- `backend/app/services/income_bank_links.py`: shared helpers. They validate the bank (it must belong to the company), check the balance, create/update/remove the sale or expense, and reconcile the bank through `reconcile_sale_bank` / `reconcile_expense_bank`.
- `tenant_service.py`, `lending_service.py`: call the helpers.
- `frontend/src/components/common/CompanyBankSelect.tsx`: bank dropdown with balances.
- Tests: `backend/tests/test_income_bank_links.py`.

## Known limits

- Sales and expenses are written through SQLAlchemy, like bill-payment funding (spec 0059 migration). This assumes the API database is the Supabase Postgres, as in production.
