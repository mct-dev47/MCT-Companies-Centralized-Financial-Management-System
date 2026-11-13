# 0046 — Loan Disbursement Step (Finance Disburses After Audit)

**Status:** Implemented

## Goal

Company loans now follow the same order as petty cash. Audit approval no longer moves money. Finance releases the money as a separate, final step.

```
Supervisor requests ─► Finance endorses (picks bank) ─► Audit approves ─► Finance disburses
Pending Finance        Pending Audit Approval           Approved          Disbursed
```

## Statuses and colors

| Status | Label | Color |
|---|---|---|
| Pending Finance Endorsement | Pending Finance | Gray |
| Pending Audit Approval | Endorsed · Pending Audit | Yellow |
| Approved | Approved · To Disburse | Indigo |
| Disbursed | Disbursed | **Green** |
| Paid | Paid | Green |
| Partially Paid | Partially Paid | Blue |
| Rejected by Finance / Disapproved by Audit / Overdue | Rejected / Disapproved / Overdue | Red |

The "Approved" state uses indigo instead of blue so it doesn't look like "Partially Paid", which is already blue. All styles live in `frontend/src/components/dashboard/loanStatusStyle.ts`.

## Behaviour

- `POST /loans/{id}/audit-review` with `approve` sets **Approved** only. No bank entries are made.
- `POST /loans/{id}/disburse` (Finance only):
  - The loan must be **Approved**; otherwise it returns `409`.
  - The funding bank must hold the principal; otherwise it returns `400`.
  - It withdraws from the funding bank, deposits to the borrower's bank, and sets the status to **Disbursed** with `disbursed_by` and `disbursed_at`.
  - A second disburse is refused.
- Repayments can only be recorded once the loan is Disbursed (or Paid, Partially Paid, or Overdue).
- The company loan list and totals count only loans whose money moved: Disbursed, Paid, Partially Paid and Overdue.
- Notifications:
  - Finance gets "Loan Ready to Disburse" for each Approved loan.
  - The supervisor gets "Approved, waiting for Finance to disburse", then "Loan Disbursed".
- UI:
  - A **Disburse** action appears in the row menu and a **Disburse Loan** button in the loan detail view. Both are Finance only and appear only for Approved loans.
  - Both open a confirmation that shows the lender, borrower and amount.

## Data (migration `0061_loan_disbursement_step`)

- Adds `loan.disbursed_by` and `loan.disbursed_at`.
- Existing **Approved** loans become **Disbursed**, because their money was already moved under the old flow. `disbursed_at` is set to the audit approval time.

## Tests

`backend/tests/test_loan_disbursement_step.py`
