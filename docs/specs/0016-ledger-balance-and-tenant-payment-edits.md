# 0016 · Ledger balance, deposit visibility, and tenant payment edits

**Status**: Assumed
**Date**: 2026-10-30
**Authorized by**: Engineer, during /develop (asked to continue building with the recommended answers)

## Owed decision

Three requests changed rules that specs 0013 (Transaction page) and 0015 (Tenant lease schedule) already settle, and left two terms undefined:

1. What the Deposit tab hides. Spec 0013 AC-5 shows loans and petty cash top ups from Finance endorsement (marked pending), and AC-10 shows any part paid sale or expense. The request is that pending and unpaid records show only on the All tab.
2. What "balance" (Deposit tab) and "net amount" (All tab) mean.
3. How a tenant payment can be corrected to "paid" or "unpaid". Spec 0015 AC-11 says a period's status is worked out, never typed.

## Assumption built on

1. **Deposit tab visibility.** Loans and petty cash top ups still waiting for Audit approval (`awaitingAudit`) are hidden from the Deposit tab and stay on the All tab. A sale or expense that is partly paid still shows on the Deposit tab with its paid part only (AC-10 stays). Records with nothing paid already do not show.
2. **Balance and net amount.**
   - Deposit tab gets a BALANCE column: a running total of deposits minus withdrawals in date order, kept separately for each company, so a company's balance is never mixed with another's. It is worked out over all of the company's cash ledger rows before the search, direction and date filters, so it does not restart when a filter is used. It is shown for every row, whatever the sort order.
   - All tab gets a NET AMOUNT column (signed: deposit minus withdrawal for that row, in red when negative).
   - Both tabs get a summary line under the table: Total Deposits, Total Withdrawals and Net Amount of the rows that match the current filters.
   - The balance is a ledger total, not the bank account's real balance. Opening balances are not included.
3. **Tenant payment edits.** Status stays worked out from the payments. To change it, a user edits or deletes payments:
   - Each recorded payment in the Payment History gets Edit and Delete (not shown to the Audit role). Edit can change date, amount, method, reference, notes, the starting period (repeating leases), and Paid or Missed (non repeating and Daily leases only).
   - A repeating lease's Payment Schedule row that still owes money gets **Mark as Paid**, which opens Record Payment for that period with what it still owes.
   - A schedule row with money paid directly against it gets **Mark as Unpaid**, which deletes the payments that started at that period after a confirm that names every period the removal reduces (advance credit that flowed forward is removed too). A period covered only by advance credit cannot be marked unpaid on its own.
   - Totals and the Completed status are recalculated. A lease that was Completed and now owes money goes back to Active.
   - If the lease had been marked Audited or Flagged, any payment change clears that mark so it shows as pending audit again.

## Code area

- `frontend/src/pages/TransactionPage.tsx` (Deposit tab filter, BALANCE and NET AMOUNT columns, summary line, CSV and PDF)
- `frontend/src/pages/TenantPage.tsx` (payment edit and delete, Mark as Paid, Mark as Unpaid, audit reset)
- `frontend/src/services/tenantScheduleService.ts` (checks for edited payments)

## Requirements

- **AC-1**: The Deposit tab never lists a loan or petty cash row that is waiting for Audit. The All tab still lists it, marked pending.
- **AC-2**: The Deposit tab has a BALANCE column with a per company running total (deposits minus withdrawals). The value does not change when the search, direction or date filter changes.
- **AC-3**: The All tab has a signed NET AMOUNT column. Both tabs show Total Deposits, Total Withdrawals and Net Amount for the filtered rows. CSV and PDF include the new columns.
- **AC-4**: Saving an audit review of a sale or expense sends a websocket message that reloads the Transaction, Sales and Expense screens for every connected user, without waiting for the 30 second cache. (Built before this spec was written, no decision was owed.)
- **AC-5**: A tenant payment can be edited or deleted from the lease details page, and a schedule period can be marked paid or unpaid as described above. Edits that would put more money on the lease than it owes are refused with a message.
- **AC-6**: Any payment change on a lease clears its Audited or Flagged mark.

## Ratify

This decision was recorded by /develop, not deliberated. Run `/architect tenant and transaction ledger: ratify the assumed decisions in 0016, and update 0013 AC-5 and AC-10 and 0015 AC-11` to deliberate and ratify it. Until then it stays flagged as an owed decision; it does not block marking the feature `done`.
