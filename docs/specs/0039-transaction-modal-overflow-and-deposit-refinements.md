# 0039. Transaction Modal Overflow and Deposit Refinements

**Date**: 2026-11-08
**Status**: Accepted

## Summary

This specification refines transaction entry and modal inspection across Sales, Expenses, and general Transactions. It prevents modal dialogs from breaking when users input long continuous words or large numbers, sets the deposit status to read only when a transaction is Unpaid or Pending, removes the awkward inline save button inside the particulars input, and removes the misleading No Debtor label on Unpaid sales.

## Context

Users entering data on the Sales, Expense, and Transaction pages experienced layout breakage when entering long strings of letters or numbers without whitespace. The modal dialog boxes would stretch horizontally beyond the viewport because default word breaking rules only break text at spaces and hyphens.

Additionally, users could click and change the deposit status dropdown even when a record was Unpaid or Pending, causing confusion or error popups. In the transaction sheet, an inline red Save button inside the particulars text box looked cluttered and crowded. Finally, Unpaid sales without an assigned debtor displayed an unnecessary bright red No Debtor label that added noise to the table.

## Requirements

**User stories**:
* As a user, I want modal dialogs and transaction tables to stay neatly within the screen when I enter long particulars or numbers, so that the user interface never breaks.
* As a cashier or finance officer, I want deposit status to be read only whenever a payment is Unpaid or Pending, so that I cannot accidentally set an uncollected sale as deposited.
* As a user entering transaction rows, I want the particulars input box to be clean without an awkward inline button, so that typing is smooth and distraction free.
* As a sales manager, I want Unpaid sales without an assigned debtor to display cleanly without an intrusive No Debtor badge, so that the status column is simple to read.

**Acceptance criteria**:
* **AC-1**: Modal dialogs in Sales, Expense, and Transaction pages (`AuditTransactionModal`, `AddSalesModal`, `AddExpenseModal`, and `ConfirmModal`) enforce word wrapping using `[overflow-wrap:anywhere]`, `break-words`, and `break-all` for monospace codes, preventing horizontal blowout from long continuous strings.
* **AC-2**: Input text fields and numbers enforce sensible character length limits (`maxLength={255}` for particulars and descriptions, `maxLength={50}` for reference codes and cheque numbers), and container elements enforce `min-w-0` and `overflow-x-hidden`.
* **AC-3**: In `SalesPage.tsx` and `AddTransactionSheetPage.tsx`, when payment status is `Unpaid` or `Pending` (unless payment method is Cheque awaiting clearance), the deposit status control is rendered as a read only badge or a disabled selector locked to `Not Deposited` with a helpful tooltip.
* **AC-4**: In `AddTransactionSheetPage.tsx`, the inline red Save button inside the particulars text input is removed. Typed particulars are preserved and saved normally with the row.
* **AC-5**: In `AddTransactionSheetPage.tsx`, when a sales row has payment status `Unpaid` and no debtor is assigned, the red `No Debtor` badge is removed.

## Decision

We update the frontend components to handle long unbroken text, lock the deposit status selector for non paid items, streamline the particulars combobox input, and hide the placeholder debtor tag.

## Build plan

1. Update `AuditTransactionModal.tsx`, `AddSalesModal.tsx`, and `AddExpenseModal.tsx` with container overflow guards, `[overflow-wrap:anywhere]`, `break-words`, `break-all`, and input length constraints.
2. Update `SalesPage.tsx` and `AddTransactionSheetPage.tsx` to render deposit status as disabled or read only when payment status is `Unpaid` or `Pending`.
3. Remove the inline Save button in `ParticularsCombobox` inside `AddTransactionSheetPage.tsx`.
4. Remove the `No Debtor` badge in `AddTransactionSheetPage.tsx` for Unpaid sales rows.
