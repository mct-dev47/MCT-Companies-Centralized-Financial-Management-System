# 0037. Transaction Sheet Fee Zero Handling, Debtor Pre fill on Edit, Deposit Subtab Filtering, and Clean Particulars Start

**Date**: 2026-11-06
**Status**: Completed

## Summary

This decision refines several user experience frictions across transaction entry and transaction record views. First, it updates the service fee input in sales and expense sheets so typing immediately replaces the default zero without leaving an awkward leading zero, while still allowing a deliberate zero value. Second, when editing an unpaid transaction, it retrieves and displays the existing staff or external customer debtor name from the database instead of asking for it again with blank inputs, and preserves the link upon updating. Third, it ensures unpaid and pending transactions remain clearly visible in the All Transactions views under Sales Record and Expense Record, and are excluded only when viewing the Deposit or Withdraw subtabs. Finally, it cleans test data from the company particulars database so new companies and new users start with an empty particulars list.

## Context

The batch transaction entry interface at `/sales/add` and `/expense/add` along with the record tables on `/sales` and `/expense` are core daily workflows. Encoders and finance staff encountered four friction points:

First, when selecting GCash or a custom payment method with a service fee, the fee input displays a literal numeric zero. When typing a new fee such as 15, the field became 015 because the leading zero remained in place. Encoders want the field to default to zero, but when they begin typing, the placeholder zero should disappear cleanly.

Second, when an unpaid sale is recorded, it is assigned to a staff member or external customer in the receivables ledger. However, when navigating to edit that sale, the editor did not load the existing debtor name or type. Upon clicking save, the multi step wizard asked the encoder to enter the staff or customer name from scratch with an empty field, ignoring the record already saved in the database.

Third, in the sales and expense records, staff need to see every transaction, including unpaid and pending items, in the main All Transactions views. Unpaid transactions represent revenue commitments or pending outflows and must remain visible in the record view, disappearing only when filtering by cash deposits or disbursements in the Deposit or Withdraw tab.

Fourth, leftover test data in the company particulars table caused new users to see unexpected default particulars suggestions in the autocomplete dropdown rather than a clean, empty list ready for their own company vocabulary.

## Requirements

**User stories**:
- As an encoder on `/sales/add` or `/expense/add`, I want typing in the fee input to smoothly replace the zero so that I never have to manually delete an awkward leading zero.
- As a cashier or finance officer editing an unpaid sale, I want the system to show the staff or customer name already saved in the database so that I do not have to retype who owes the balance.
- As a manager viewing sales and expense records, I want All Transactions under Sales Record and Expense Record to display all transactions including unpaid and pending items, and filter them out only when I select the Deposit or Withdraw subtab.
- As a new company encoder, I want an empty particulars list when I start so that no unrelated default or test entries appear.

**Acceptance criteria**:
- **AC-1**: In the service fee input on `/sales/add` and `/expense/add`, the field defaults to zero without displaying a stubborn leading zero when typing. Selecting the field highlights the zero, typing any digit replaces it without leading zeros, and leaving the field blank calculates with a zero fee.
- **AC-2**: When editing an unpaid sale on `/sales/add`, the user begins on the sales sheet view. Clicking Next advances to the unpaid assignment modal view where the debtor name and customer type (`Staff` or `External`) are pre-filled with the existing values as defaults, remaining fully editable so the user can change who owes the balance.
- **AC-3**: Saving from the unpaid assignment modal in edit mode updates the existing linked receivable in the database, updating both the sales record and the receivable in memory and via WebSocket, without creating duplicate debtor rows or clearing debtor names.
- **AC-4**: In `/sales`, the All Transactions table under the Sales Record tab displays all transactions including `Paid`, `Unpaid`, and `Pending` transactions, along with their payment status badge and customer or staff debtor name.
- **AC-5**: In `/sales`, the Deposit tab excludes unpaid transactions where realized cash is zero. In `/expense`, the Withdraw tab excludes unpaid transactions where paid disbursement is zero, while the Expense Record tab displays all expenses including unpaid and pending.
- **AC-6**: Leftover test particulars in the `company_particulars` table are removed, and new companies without custom particulars display an empty autocomplete dropdown without phantom default suggestions.

## Options considered

### Option 1: Full bidirectional debtor pre fill, reactive input handling, and tab cash separation

Implement auto select and leading zero stripping on fee inputs, pre fill debtor details from `receivablesStore` and `receivablesService` during edit pre fill, link updates to the existing receivable id, enrich `combinedSales` with debtor details for database backed sales, and purge test rows from `company_particulars`.

**Pros**:
- Directly addresses all four user pain points across sales, expenses, and receivables.
- Smooth typing experience without extra key presses.
- Guarantees debtor continuity during record edits without orphaned receivables.
- Clean separation between accounting sales records and realized cash deposits.

**Cons**:
- Touches both frontend spreadsheet page, sales page, and backend cleanup.

### Option 2: Frontend only visual overrides without editing receivables sync

Apply frontend number formatting and display mock debtor names without updating the underlying receivable during edit saves.

**Pros**:
- Smaller code change.

**Cons**:
- Fails when an encoder edits an unpaid amount or customer name because the database receivable would remain stale.

## Decision

**Chosen option**: Option 1: Full bidirectional debtor pre fill, reactive input handling, and tab cash separation.

The system will update fee input behavior to handle zero seamlessly, link and pre fill debtor names from the database when editing sales, ensure All Transactions shows all payment statuses while Deposit views filter by realized cash, and purge test data from company particulars.

## Rationale

This approach preserves accounting integrity by keeping the sales ledger and the receivables ledger strictly synchronized. Pre filling the debtor name honors work already recorded in the database, saving encoders time and preventing data divergence. Refining the number input behavior removes friction from high volume data entry.

## Feature design

**Value sourcing**:
| Action | Value produced or displayed | Source |
|---|---|---|
| Fee input default | `0` or `0.00` placeholder | `SpreadsheetRow.serviceFee` |
| Fee input typing | Clean number without leading `0` | Strips leading zeroes on change, selects on focus |
| Edit unpaid sale debtor | Debtor name and type | `receivablesStore.getSales()` or `receivablesService` matching `sale_id` |
| Edit unpaid sale save | Updated receivable | `PUT /api/v1/receivables/{id}` |
| Sales Record All Transactions | Shows Paid, Unpaid, Pending | `baseFilteredSales` where status filter is `All` |
| Deposit Tab | Shows realized cash > 0 only | `filteredSales` filtering `getRealizedCash(sale) > 0` |
| Particulars autocomplete | Empty list for new companies | `GET /api/v1/particulars` after purging test data |

## Build plan

1. **Step 1: Fee input zero handling**
   - In `frontend/src/pages/AddTransactionSheetPage.tsx`, update the fee input value binding, `onFocus` text selection, and `onChange` sanitization to eliminate stubborn leading zeros while preserving zero as the default calculation.
2. **Step 2: Debtor pre fill and persistence on edit**
   - In `frontend/src/pages/AddTransactionSheetPage.tsx`, when `editItem` is detected, look up the existing receivable for `editItem.id` and pre fill `unpaidAssignments` with the existing `customerName` and `customerType`.
   - In `handleSave`, when in edit mode with an unpaid row, call `receivablesService.updateReceivable` using the existing receivable id, ensuring the staff or customer name remains durable in the database.
3. **Step 3: Debtor enrichment and tab filtering on SalesPage and ExpensePage**
   - In `frontend/src/pages/SalesPage.tsx`, merge linked receivable information into database sales in `combinedSales` so that `customer_name`, `customer_type`, `balance`, and `payment_status` render in the All Transactions table.
   - Confirm that `filteredSales` in Sales Record view keeps unpaid and pending items visible, and that only the Deposit tab isolates realized cash entries.
   - Confirm the same behavior in `frontend/src/pages/ExpensePage.tsx` where Expense Record displays all expenses and Withdraw isolates paid disbursements.
4. **Step 4: Clean company particulars test data**
   - Remove test rows from `company_particulars` in Supabase and local databases, and ensure test suites mock the client or clean up after runs.

## Consequences

- Encoders experience fast, natural fee entry without awkward zeros.
- Editing an unpaid sale preserves debtor identity and updates receivables consistently.
- Sales Record and Expense Record provide complete accounting transaction visibility.
- New users and companies start with clean, empty particulars.

## Follow-up

- Monitor encoder feedback during daily sales entry.

## References

- Spec 0027: Food receivables and unpaid expense lifecycle
- Spec 0028: Receivables refinements and bidirectional sales sync
- Spec 0035: Sales validation, custom payment methods, and service fees
- Spec 0036: Transaction particulars scoping and keyboard flow

