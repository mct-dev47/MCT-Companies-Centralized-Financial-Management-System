# Build Spec 0005: Bills Payment History and Schema Cleanup

## Summary
This specification documents the consolidation of bill actions, relocation of payment history into bill details, introduction of paginated payment history, redesign of the bill details schedule calendar matching the payment modal, and removal of category and account reference number columns from the database and user interfaces.

## Requirements and Intent
1. In the Bills table row actions menu:
   - Remove the Payment History and Record Payment menu items.
   - Retain Edit, Delete, and View Details options.
2. In the View Bill Details modal:
   - Relocate the Payment History section for the selected bill directly into the details modal.
   - Provide client side pagination for payment history records with record count and page controls.
   - Revise the Payment Schedule section to adopt the monthly calendar matrix layout from the Record Bill Payment modal.
   - Include a year navigator clamped to a minimum year of 2025.
   - Clearly differentiate between fully paid, partially paid, overdue, due soon, and upcoming months.
   - For any month that is partially paid, clearly display the amount already paid and the remaining amount left to pay.
   - Remove category and account reference number fields from the details grid.
3. In the Update Bill modal:
   - Remove category selection and account or reference number input controls.
4. In the database and backend:
   - Drop the category and account number columns from the bills table.
   - Update the database schema definition and provide a standalone migration script.
   - Update backend SQLAlchemy models, Pydantic schemas, and service serialization to eliminate category and account number fields.
   - Update frontend bill TypeScript interfaces to remove category and account number.

## Data Model Changes
- Database table `bills`:
  - Drop column `category`.
  - Drop column `account_no`.
- SQLAlchemy model `Bill` in `backend/app/models/bills.py`:
  - Remove attributes `category` and `account_no`.
- Pydantic schemas in `backend/app/schemas/bills.py`:
  - Remove `category` and `account_no` from `BillBase`, `BillCreate`, `BillUpdate`, and `BillOut`.
- Frontend model in `frontend/src/services/billsService.ts`:
  - Remove `category` and `accountNo` from `BillItem`, `NewBillInput`, and `UpdateBillInput`.

## User Interface Design

### Bills Table Actions Menu
- Menu options simplified to View Details, Edit, and Delete.
- Record Payment is initiated directly from the View Bill Details modal via the Pay Bill button or by row click.

### View Bill Details Modal
- Top details grid displays Entity and Billing Cycle cleanly without empty category and account number cards.
- Redesigned Payment Schedule Calendar:
  - Header displays calendar icon, cycle name, and year navigator with previous and next buttons.
  - Previous year button is disabled when the selected year is 2025 or lower.
  - Twelve month grid renders month name, due date, status badge, and payment date tag.
  - Fully paid cards show emerald styling with check icon and paid date.
  - Partially paid cards show amber styling with clock icon, amount paid versus total amount, and remaining balance tag.
  - Overdue cards show rose styling with alert icon.
  - Due soon cards show blue styling with clock icon.
  - Upcoming cards show clean neutral styling.
- Embedded Payment History Section:
  - Displays list of payments recorded for the bill.
  - Each item shows period key or label, payment date, formatted amount, payment method, reference number, and notes.
  - Displays pagination controls with page indicators and previous or next buttons when payments exceed the page limit (e.g. 5 records per page).
  - Empty state displays clear placeholder when no payment records exist.

### Update Bill Modal
- Form layout adjusted to remove category dropdown and account number input, matching the simplified Add Bill modal structure.

## Acceptance Criteria
- AC 1: Bills table row action menu contains no Record Payment or Payment History options.
- AC 2: View Bill Details modal displays an embedded Payment History list for the bill.
- AC 3: Payment History in View Bill Details has functional pagination when multiple payment records exist.
- AC 4: Payment Schedule in View Bill Details matches the monthly calendar grid from the payment modal.
- AC 5: Calendar distinguishes fully paid, partially paid, overdue, due soon, and upcoming months.
- AC 6: Partially paid months in the calendar show both paid amount and remaining balance left to pay.
- AC 7: Update Bill modal contains no category or account reference number inputs.
- AC 8: The category and account number columns are dropped from the bills table across database engines.
- AC 9: Frontend and backend TypeScript and Python code compiles cleanly without references to the dropped fields.
