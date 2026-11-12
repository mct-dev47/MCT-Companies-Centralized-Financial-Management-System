# 0035. Transaction Sheet Validation, Company Payment Methods with Service Fees, and Supervisor View Cleanups

**Date**: 2026-11-06
**Status**: Accepted

## Summary

This decision refines transaction encoding on the sales and expense add sheet and declutters supervisor screens across sales and expenses. It sets default payment methods to Cash, Cheque, and GCash while allowing each company to add custom payment methods scoped exclusively to their company. It displays an inline service fee input defaulting to 0 whenever GCash or any custom payment method is selected for sales or expenses, adding the surcharge into the total fee. It stops the particulars dropdown from opening automatically when adding a new row, enforces strict price, particulars, and category validation across front end and back end with explicit error callouts, removes redundant company columns for supervisors, and renames the inspect action button to show.

## Context

The financial management system enables staff, supervisors, and finance users to encode daily sales and expenses through a spreadsheet interface at `/sales/add`. User feedback identified several friction points during high volume encoding.

First, adding a new row moves focus to the particulars cell, which immediately pops open the autocomplete dropdown menu and blocks surrounding cells from view before the user decides to type.

Second, the current payment methods list contains hardcoded values that do not fit every business unit. Companies need default options consisting of Cash, Cheque, and GCash, but each company must also have the ability to register their own company specific payment methods (such as Maya, Panda, GrabPay, or custom credit terminals) without exposing those options to other companies.

Third, electronic and non cash transactions frequently incur merchant surcharges or cash in fees. Users currently have no dedicated place to enter this surcharge for GCash or custom payment methods, forcing manual arithmetic or unlinked rows across both sales and expenses.

Fourth, users could submit rows missing prices, particulars, or categories without descriptive feedback highlighting which cell was wrong.

Finally, supervisor and company scoped users already work within the boundary of a single assigned company. Displaying a company column across daily summaries, expandable transaction drilldowns, and the all transactions table consumes horizontal space without adding information. The button labeled inspect also created confusion, as users preferred the simpler action label show.

## Requirements

**User stories**:
- As an encoder, I want default payment options to be Cash, Cheque, and GCash, and I want the ability to add custom payment methods for my company so that our payment choices stay clean and relevant.
- As an encoder entering GCash or custom company payment transactions for sales or expenses, I want a service fee field with a default of 0 so that processing charges automatically calculate into the total fee.
- As a cashier or encoder, I want the particulars dropdown to stay closed until I click it so that adding rows does not obstruct my spreadsheet view.
- As a user submitting transactions, I want clear feedback when price, particulars, or category is missing so that I immediately know which row and field needs attention.
- As a supervisor, I want company columns hidden on my sales and expense views so that transaction details have maximum screen space.
- As a viewer on daily transaction summaries, I want the toggle button to say show so that expanding day records feels natural and clear.

**Acceptance criteria**:
- **AC-1**: When clicking Add Row on `/sales/add`, the particulars input receives keyboard focus but the suggestion dropdown remains closed until the user clicks it or begins typing.
- **AC-2**: The system provides Cash, Cheque, and GCash as default payment methods. Each company can add and save custom payment methods that are scoped exclusively to their own company name and id.
- **AC-3**: When payment method is set to GCash or any company custom payment method on any sales or expense row, an inline service fee input appears with a default value of 0. The service fee adds to the calculated total fee where total equals unit price multiplied by quantity plus service fee. For Cash and Cheque, the service fee is 0 and hidden.
- **AC-4**: Submitting transactions with empty particulars, empty category, or null or zero price is blocked on the front end for both sales and expenses. Invalid input cells display red borders with warning indicators, and a top error banner lists the exact row numbers and missing fields.
- **AC-5**: Back end schemas and API endpoints for sales and expenses validate that amount is at least 1.00, particulars is not blank, and category is not blank, returning HTTP 422 Unprocessable Entity with a clear error description if violated.
- **AC-6**: For supervisor and company scoped roles, the Company column is removed from both the Daily Summary expandable transaction drilldown table and the All Transactions table on both SalesPage and ExpensePage.
- **AC-7**: On Daily Summary rows in SalesPage and ExpensePage, the toggle button action label displays Show when collapsed and Hide when expanded instead of Inspect.
- **AC-8**: Company custom payment methods and GCash service fee charges are persisted safely in the database and preserved within itemized metadata, maintaining correct deposit math and bank synchronization.

## Options considered

### Option 1: Company scoped payment method table with dynamic service fee field on non standard methods

Store custom payment methods in a dedicated database table filtered by company name, seed defaults to Cash, Cheque, and GCash, show an inline service fee input whenever GCash or any custom payment method is chosen in sales or expenses, validate required fields on front end and back end, and conditionally hide company columns for company scoped roles.

**Pros**:
- Isolates company specific payment methods so other companies are not affected.
- Standardizes service fee handling across both sales and expenses uniformly.
- Gives immediate visual and textual guidance for incomplete rows.
- Frees up significant horizontal table width for supervisors.
- Keeps database records normalized and clean.

**Cons**:
- Requires a lightweight new table and endpoint for company custom payment methods.

### Option 2: Hardcoded global payment methods list with manual service fee lines

Keep a shared global list of payment methods and instruct users to enter service fees as separate line items in the spreadsheet.

**Pros**:
- Avoids creating a new database table.

**Cons**:
- Fills payment method dropdowns with irrelevant options for companies that do not use them.
- Doubles row counts for payment fee accounting and risks data synchronization bugs when deleting or editing parent records.

## Decision

**Chosen option**: Option 1: Company scoped payment method table with dynamic service fee field on non standard methods.

Implement default payment methods Cash, Cheque, and GCash, allow companies to create company specific payment methods via a dedicated backend table and service, display the inline service fee field defaulting to 0 on GCash and custom methods across sales and expenses, enforce strict validations, hide company columns for supervisors, and rename inspect to show.

## Rationale

Option 1 keeps company isolation intact while giving each business unit the flexibility they need. Setting defaults to Cash, Cheque, and GCash removes clutter from rarely used payment channels, while allowing companies to register their own channels (such as Maya or delivery apps) ensures long term adaptability. Enforcing the service fee field on both GCash and custom payment methods covers Philippine merchant surcharge practices without manual calculations. Contextual cell highlights and role conditional column hiding improve daily usability for high volume data encoders and supervisors.

## Feature design

**Data model sketch**:
- Database table `company_payment_methods`:
  - `id`: integer primary key autoincrement
  - `company_id`: integer foreign key to company table nullable
  - `company_name`: string index nullable
  - `name`: string required
  - `created_at`: timestamp with timezone
- Front end `SpreadsheetRow` adds `serviceFee?: number | ''`.
- `ParticularItem` line item records `serviceFee?: number`.
- Backend `SaleCreate` and `ExpenseCreate` schemas enforce `particulars`, `category`, and `amount` with Pydantic field and model validators.

**State transitions**:
- Encoding row: particulars dropdown initial state is closed even when cell receives focus from Add Row action.
- Payment method change:
  - If Cash or Cheque is chosen, service fee is 0 and hidden.
  - If GCash or any company custom payment method is chosen, service fee input appears with default value 0.
- Daily summary row: clicking Show expands transactions and label flips to Hide; clicking Hide collapses and label flips to Show.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/payment-methods | GET | company_name (query) | list of custom payment methods for company | Authenticated | 401 |
| /api/v1/payment-methods | POST | company_name, name | created company payment method | Authenticated | 400, 422 |
| /api/v1/payment-methods/{id} | DELETE | id (path) | success boolean | Authenticated | 404 |
| /api/v1/sales/ | POST | particulars, category, amount >= 1.00, company | created sale record | Authenticated | 422 Unprocessable Entity |
| /api/v1/expenses/ | POST | particulars, category, amount >= 1.00, company | created expense record | Authenticated | 422 Unprocessable Entity |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Load payment options | Cash, Cheque, GCash plus company custom methods | Defaults array merged with API response from /api/v1/payment-methods |
| Add custom payment method | New payment method name | User input dialog or combobox quick add |
| Select GCash or custom method | Service fee input field with default 0 | Payment method selection compared against Cash and Cheque |
| Row total calculation | Total fee amount | Derived from (unitPrice * quantity) + (serviceFee or 0) |
| Missing field notification | Row numbers and field names | Calculated row validation scanner on submit |
| Hide company column | Boolean showCompanyColumn | Derived from user role not equal to supervisor and not company scoped |
| Summary accordion toggle | Show or Hide button text | Boolean isExpanded state on daily summary group |

**Key invariants**:
- Default payment methods must always include Cash, Cheque, and GCash.
- Custom payment methods must only be visible to the company that created them.
- Service fee must only trigger for GCash and company custom payment methods; Cash and Cheque must never show a service fee.
- Total amount for any transaction must equal unit price multiplied by quantity plus service fee.
- Price, particulars, and category must never be null, undefined, or whitespace only strings.
- Company columns must never appear for supervisor or company scoped accounts in sales and expense record views.

**Security model**:
- Role based UI rendering: supervisors and company scoped roles see only transactions and custom payment methods for their assigned company.
- Finance and admin roles can view and manage custom payment methods across all companies.

**Critical test scenarios**:
- Payment method defaults and custom additions: Load `/sales/add` for Company A, verify default options are Cash, Cheque, and GCash. Add custom method Maya for Company A, switch to Company B, verify Maya is not present for Company B, verifies **AC-2**.
- GCash and custom payment service fee in sales and expenses: Select GCash, verify service fee input displays 0. Enter price 500, quantity 1, service fee 25, verify total displays 525.00. Test same behavior for an expense row and a custom payment method, verifies **AC-3**, **AC-8**.
- Particulars focus check: Click Add Row, verify particulars input is focused but dropdown is closed until clicked, verifies **AC-1**.
- Validation failure case: Click submit with empty particulars, empty category, or zero price, verify red borders appear on offending cells and top banner lists exact row errors, verifies **AC-4**, **AC-5**.
- Supervisor view check: Log in as supervisor, open sales and expense tabs, verify Company column is absent from Daily Summary drilldown table and All Transactions table, verifies **AC-6**.
- Label toggle check: On Daily Summary, verify button reads Show, click it, verify it reads Hide, verifies **AC-7**.

## Build plan

1. [x] Create database model `CompanyPaymentMethod`, Alembic migration or table creation, and REST endpoints in `backend/app/api/v1/endpoints/payment_methods.py` to retrieve, add, and remove company custom payment methods, satisfies **AC-2**, **AC-8**.
2. [x] Create frontend `paymentMethodService.ts` to manage company payment methods and update `AddTransactionSheetPage.tsx` payment options to default to Cash, Cheque, and GCash plus company specific custom methods, satisfies **AC-2**.
3. [x] Update `ParticularsCombobox` in `AddTransactionSheetPage.tsx` so the dropdown opens strictly on click or character change, keeping it closed during programmatic focus from `handleAddRow`, satisfies **AC-1**.
4. [x] Add `serviceFee` state (defaulting to 0) and inline numeric input to `SpreadsheetRow` whenever `paymentMethod` is GCash or a custom payment method for both Sales and Expense sheets, factoring service fee into `rowTotal`, grand total, payment breakdown, and submit payloads, satisfies **AC-3**, **AC-8**.
5. [x] Implement front end row validation scanner in `AddTransactionSheetPage.tsx` checking for missing particulars, missing category, and null or non positive price, applying red cell outlines and displaying an alert banner with offending row numbers, satisfies **AC-4**.
6. [x] Update `SaleCreate`, `SaleUpdate`, `ExpenseCreate`, and `ExpenseUpdate` in `backend/app/schemas/sale.py` and `backend/app/schemas/expense.py` to strictly validate required category, particulars, and minimum amount, satisfies **AC-5**.
7. [x] Update `SalesPage.tsx` and `ExpensePage.tsx` to conditionally hide the Company column in both Daily Summary drilldowns and All Transactions tables when `isCompanyScoped` or `userRole === 'supervisor'`, satisfies **AC-6**.
8. [x] Update Daily Summary table rows in `SalesPage.tsx` and `ExpensePage.tsx` to display Show instead of Inspect on the accordion toggle button, satisfies **AC-7**.

## Consequences

**Positive**:
- Clean default payment choices with company autonomy to add custom payment channels.
- Automatic service fee calculation with default 0 across both sales and expenses for GCash and custom payment methods.
- Streamlined row addition workflow without annoying dropdown popups covering adjacent fields.
- Clear error guidance that prevents wasted time debugging submission rejections.
- Better table readability and clean layout for company supervisors.
- Intuitive action button wording.

**Negative**:
- Adds one lightweight database table to persist company specific payment methods.

## Follow-up

- [x] Run `/develop 0035` to implement the company payment methods, service fee calculations, validations, and supervisor view updates.
- [ ] Run `/check verify 0035` to confirm acceptance criteria across front end and back end.
