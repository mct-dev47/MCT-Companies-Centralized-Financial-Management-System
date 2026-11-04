# 0003. Sales and Expense Cash Flow Tracking by Status

**Date**: 2026-10-27
**Status**: Accepted

## Summary

This specification introduces dual KPI cards on both the Sales and Expense overview pages to distinguish total accrued volume from settled cash flow. When creating transactions in the spreadsheet interface at `/sales/add` and `/expense/add`, line items receive a status of `Paid`, `Unpaid`, or `Pending`. 

Items marked `Paid` represent realized cash and count toward both Total Sales or Expense and Total Cash. Items marked `Unpaid` or `Pending` represent pending receivables or payables and count only toward Total Sales or Total Expense.

## Context

Businesses often generate sales invoices or commit operating expenses before actual cash moves into or out of company accounts. Previously, the Sales and Expense overview pages displayed only a single aggregated metric (Total Income or Total Expense), which combined settled cash with pending or unpaid receivables and payables. 

This led to ambiguity regarding actual cash on hand. Finance officers and company managers could not tell how much of the reported sales had actually been collected in cash versus what remained outstanding. 

By upgrading the spreadsheet row status selector and introducing twin KPI cards, users can see total accounting volume alongside actual cash collected or disbursed.

## Requirements

**User stories**:
- As a branch cashier or accountant, I want to assign a status of Paid, Unpaid, or Pending to each row in the transaction spreadsheet, so that I can accurately reflect whether cash has been exchanged.
- As a company manager, I want to see two KPI cards on the Sales page (Total Sales and Total Cash), so that I know both total sales volume and how much cash has been received.
- As a finance officer, I want to see two KPI cards on the Expense page (Total Expense and Total Cash), so that I can monitor incurred expenses against cash actually paid out.

**Acceptance criteria**:
- **AC-1**: The spreadsheet interface in [AddTransactionSheetPage.tsx](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/AddTransactionSheetPage.tsx) provides a status selector for each row with options: `Paid`, `Unpaid`, and `Pending`.
- **AC-2**: When submitting transactions, line items retain their itemized status in the stored record. If all rows are `Paid`, the overall transaction status is `Paid`. If any row is `Unpaid` or `Pending`, the transaction status reflects that pending or unpaid state.
- **AC-3**: On [SalesPage.tsx](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/SalesPage.tsx), the single Total Income card is replaced with two responsive KPI cards:
  1. **Total Sales**: Sum of all sales deposits within the filtered period regardless of status.
  2. **Total Cash (Collected)**: Sum of all sales or itemized rows marked `Paid`. Unpaid and pending sales contribute zero to this cash card.
- **AC-4**: On [ExpensePage.tsx](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/ExpensePage.tsx), the single Total Expense card is replaced with two responsive KPI cards:
  1. **Total Expense**: Sum of all expenses incurred within the filtered period regardless of status.
  2. **Total Cash (Disbursed)**: Sum of all expenses or itemized rows marked `Paid` plus any verified repayment disbursements. Unpaid and pending expenses contribute zero to this cash card.
- **AC-5**: The status dropdown filters on both Sales and Expense pages support `All`, `Paid`, `Pending`, and `Unpaid`.
- **AC-6**: Subtitle descriptions on the KPI cards clearly communicate what each number measures.

## Decision

### 1. Spreadsheet Row Status Management

In [AddTransactionSheetPage.tsx](file:///c:/Users/Shelley/Desktop/projects/python/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/AddTransactionSheetPage.tsx), the `ParticularsRow` interface and select dropdown will use:
* `Paid`: The line item has been settled in cash or verified bank transfer.
* `Unpaid`: The line item is invoiced or rendered but not yet paid.
* `Pending`: The line item is awaiting clearance or customer settlement.

A summary banner at the bottom of the spreadsheet will calculate:
* Gross Total (Sum of all rows)
* Realized Cash (Sum of Paid rows)
* Receivables or Payables (Sum of Unpaid and Pending rows)

### 2. Item Level and Transaction Level Cash Calculation

For every transaction in the filtered view:
1. If the record contains structured `items`:
   - `totalAmount` = Sum of all item totals.
   - `cashAmount` = Sum of item totals where `item.status === 'Paid'`.
2. If the record does not contain structured items (legacy record):
   - `totalAmount` = Record amount.
   - `cashAmount` = Record amount if `status === 'Paid'`, else zero.

### 3. Responsive Twin KPI Cards Layout

Both pages will replace the full width single card with a two column responsive grid:
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
  {/* Card 1: Gross Sales / Expense */}
  {/* Card 2: Realized Cash */}
</div>
```

## Consequences

- Financial reporting becomes transparent with immediate visibility into actual cash flow versus accrued accounting volume.
- Backwards compatible with existing transaction records that may lack itemized line statuses.
- Zero extra database schema changes required, as item status persists in structured item metadata and overall transaction status.
