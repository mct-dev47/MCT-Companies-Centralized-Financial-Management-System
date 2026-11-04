# 0006. Lending Page Layout and Modal Enhancements

**Date**: 2026-10-28
**Status**: Accepted

## Summary

This specification refines the Lending page user experience for FilCap Prime Holdings Corp. It removes the loan identifier column from the main table to prevent column cramping and removes the solitary Total Capital Lent card. It introduces payment frequency selection in the facility creation modal and restructures the complete information modal into a balanced two column layout with dedicated payment history search and repositioned controls.

## Context

The Lending page currently presents a dense table with ten columns including a Loan ID column. Because loan IDs are alphanumeric codes, they consume significant horizontal real estate, causing borrower names, dates, amounts, and statuses to sit too close together or wrap awkwardly. 

Additionally, the single Total Capital Lent KPI card above the table occupies vertical space without offering comparative insight, since the primary focus is the facility ledger below it.

Finally, the Lending Information modal currently stacks all loan details vertically on top of payment records. This forces users with longer payment histories to scroll repeatedly. Placing the loan terms on the left and payment history with a search bar on the right inside an expanded modal provides immediate operational clarity.

## Requirements

**User stories**:
- As a lending officer, I want the lending facilities table to display core financial terms cleanly without cramped or overlapping text so that I can inspect loans comfortably on desktop and laptop displays.
- As a credit administrator, I want to define whether a loan requires daily, monthly, quarterly, or annual payments when adding a new lending facility so that repayment expectations are recorded accurately.
- As an auditor or loan manager, I want the loan details modal to present loan terms and payment records side by side in a wider dialog with date and remarks search so that I can audit remittances rapidly without excessive scrolling.

**Acceptance criteria**:
- **AC-1**: The main lending table no longer renders the Loan ID column. Table column widths are reallocated across borrower name, loan amount, date borrowed, due date, total payable, amount paid, remaining balance, status, and actions with zero text overlapping.
- **AC-2**: The Total Capital Lent KPI card is completely removed from the page layout.
- **AC-3**: The Add Lending Facility modal contains a payment frequency selector with Daily, Monthly, Quarterly, and Annually options, saving the chosen frequency to the facility record.
- **AC-4**: In the Lending Information modal, the collection progress indicator is placed directly above the progress bar rather than inside the metric grid.
- **AC-5**: The Lending Information modal uses a wider dialog container with a two column layout, showing loan terms and progress on the left, and payment history on the right.
- **AC-6**: The modal footer removes the redundant Close button, and the Edit Terms button is positioned on the bottom right.
- **AC-7**: The payment history section includes a responsive search input that filters payments in real time by payment date or remarks.

## Options considered

### Option 1: Inline layout adjustments and two column modal reorganization

Remove the Loan ID column and KPI card directly in `LendingPage.tsx`, expand the dialog width to maximum width 5xl, and split modal body into a responsive two column grid. Add payment frequency to facility models and add search state to the payment history table.

**Pros**:
- Solves all layout cramping and information density issues in a single unified component file.
- Preserves existing search, pagination, and localStorage synchronization without breaking persistence.
- Provides immediate visual parity with modern widescreen dashboards.

**Cons**:
- Slightly increases `LendingPage.tsx` state by introducing a payment history search term.

### Option 2: Extracting lending modals into separate standalone components

Refactor Add Facility, Edit Facility, and Lending Information into separate `.tsx` files in a new `components/lending/` folder while making the layout adjustments.

**Pros**:
- Reduces total line count in `LendingPage.tsx`.

**Cons**:
- Touches multiple new files and risks regression in existing portal menus and localStorage state bindings.
- Exceeds the scope of targeted layout and field revisions.

## Decision

**Chosen option**: Option 1: Inline layout adjustments and two column modal reorganization

We apply the revisions directly within `frontend/src/pages/LendingPage.tsx` while maintaining strict TypeScript typing and CSS styling tokens.

## Rationale

Option 1 directly fulfills the user requirements without introducing unnecessary file sprawl or breaking state connections with the existing action menu portals and audit indicators. The two column modal layout leverages standard Tailwind CSS grid utilities that collapse gracefully on small screens while delivering ample room on standard monitors.

## Feature design

**Data model sketch**:
The `LendingFacility` interface gains an optional property:
```ts
paymentFrequency?: 'Daily' | 'Monthly' | 'Quarterly' | 'Annually'
```

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Facility table render | Borrower, Amounts, Dates, Status, Actions | `LendingFacility` record fields |
| Add Facility submission | New facility with payment schedule | `formData.paymentFrequency` (defaults to 'Daily') |
| Payment history filter | Filtered daily payment rows | Case insensitive match on `p.date` or `p.notes` |

**Key invariants**:
- Removing Loan ID from the table does not delete the `loanId` property, as it is still used in search queries, details modal titles, and CSV exports.
- Payment history search must handle null or empty notes gracefully without throwing runtime errors.
- Table columns must specify explicit percentage or min widths to prevent table cell overflow.

**Security model**:
Role based checks continue to hide the Add Facility and Edit Terms buttons for users with audit roles.

**Critical test scenarios**:
- Table render: table displays exactly nine headers with no horizontal collision, verifying **AC-1**.
- KPI verification: no Total Capital Lent card exists in DOM, verifying **AC-2**.
- Creation flow: adding a facility with Monthly frequency persists the frequency, verifying **AC-3**.
- Modal inspection: opening a facility shows collection progress above the green progress bar on the left, and searchable payment history on the right, verifying **AC-4**, **AC-5**, **AC-7**.
- Button placement: footer displays Edit Terms on the bottom right and no Close button, verifying **AC-6**.

## Build plan

1. Update `LendingFacility` interface and form states with `paymentFrequency`, satisfies **AC-3**.
2. Remove the Total Capital Lent card from `LendingPage.tsx`, satisfies **AC-2**.
3. Remove the Loan ID column from the table header and rows, recalculating colgroup widths and ensuring cell padding prevents overlaps, satisfies **AC-1**.
4. Add the Payment Frequency field to Add Lending Facility Modal and Edit Modal, satisfies **AC-3**.
5. Reorganize the Lending Information Modal to use a wider container (`sm:max-w-4xl lg:max-w-5xl`), place collection progress above the progress bar, arrange lend details in the left column, and payment history in the right column, satisfies **AC-4**, **AC-5**.
6. Implement payment history search input filtering by date or remarks, satisfies **AC-7**.
7. Reposition Edit Terms button to the bottom right and remove Close button, satisfies **AC-6**.

## Consequences

**Positive**:
- The main table has significantly more horizontal space, allowing borrower names and currencies to display clearly without truncation or clipping.
- The Lending Information modal is much easier to read and audit because users can view terms and transactions side by side.
- Users can quickly find specific payment dates or remarks using the dedicated search input.

**Negative / tradeoffs**:
- Modals on screens narrower than 1024px will stack the two columns vertically to ensure mobile usability.

**Neutral**:
- Existing facilities without an explicit `paymentFrequency` will default to Daily.
