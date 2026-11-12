# 0036. Transaction Sheet Particulars Scoping, Default Rendered Fee, Humanized Validation, and Keyboard Flow

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This decision separates saved particulars and category suggestions between sales and expenses so that sales items do not appear in expense sheets. It updates the default expense category to Rendered Fee across all new expense transaction rows. It simplifies and humanizes validation alerts to clean sentences such as The particulars couldn't be empty. Finally, it refines the keyboard Enter key flow in the spreadsheet so pressing Enter selects a suggestion and advances to category rather than immediately creating an unwanted new row.

## Context

The financial management system provides a spreadsheet interface at `/sales/add` and `/expense/add` for batch recording daily transactions. High volume encoders noted several points of confusion and friction during daily operations.

First, company particulars were stored and retrieved as a single shared list per company without distinguishing between sales revenue and operational expenses. An encoder entering custom sales descriptions would see those items suggested when recording expenses, cluttering dropdowns and mixing distinct accounting lines.

Second, the initial category on new expense rows defaulted to Petty Cash instead of the standard operational line Rendered Fee, requiring encoders to manually change the category dropdown on nearly every row.

Third, front end validation error messages used mechanical system wording listing comma separated missing fields. Encoders asked for simple, natural language phrasing that directly explains what is wrong.

Finally, keyboard navigation in the particulars and category comboboxes was aggressive. Pressing Enter while typing in particulars would trigger the table level row creation handler, inserting an extra empty row instead of selecting the highlighted suggestion and moving smoothly to the category column.

## Requirements

**User stories**:
- As an encoder on `/expense/add`, I want particulars and categories to reflect expense records only so that sales items do not clutter my expense choices.
- As an expense encoder, I want new expense rows to default to Rendered Fee so that I do not have to select it manually for standard fees.
- As a cashier or encoder, I want validation error banners to speak in plain human words so that I can fix errors without deciphering technical phrasing.
- As a keyboard encoder, I want pressing Enter in particulars to confirm my selection and move focus to category, and pressing Enter in category to confirm and advance, with an extra Enter creating a new row only when desired.

**Acceptance criteria**:
- **AC-1**: Saved company particulars are scoped by transaction type (`Sales` vs `Expense`). Particulars saved on sales sheets never appear in expense autocomplete lists, and particulars saved on expense sheets never appear in sales autocomplete lists.
- **AC-2**: Categories are separated by transaction type. Entering or saving a category in the sales sheet does not modify or inject items into the expense category list.
- **AC-3**: On `/expense/add`, the default preselected category for all newly added expense rows is `Rendered Fee`.
- **AC-4**: When row validation fails, the error banner displays humanized message text stating `Row X: The particulars couldn't be empty`, `Row X: The category couldn't be empty`, and `Row X: The price couldn't be empty`, accompanied by red borders on offending cells.
- **AC-5**: In `ParticularsCombobox`, pressing Enter while suggestions are open selects the highlighted or typed suggestion and advances keyboard focus directly to the `CategoryCombobox` cell of that same row without adding a new row.
- **AC-6**: In `CategoryCombobox`, pressing Enter selects the category and moves focus forward to the price cell. When pressed on an already confirmed category or subsequent cell, a second Enter inserts a new row and focuses its particulars input.

## Options considered

### Option 1: Transaction type column on particulars with step by step Enter navigation

Add a `transaction_type` column to the `company_particulars` table and frontend service filters, set the default category constant to Rendered Fee, update validation alert text strings to human phrasing, and adjust combobox keydown handlers to advance focus across columns before creating rows.

**Pros**:
- Completely isolates sales vocabulary from expense vocabulary in the database and UI.
- Makes data entry effortless by pre filling the most common expense category.
- Provides clear, friendly error guidance.
- Eliminates accidental blank row creation during fast typing.

**Cons**:
- Requires updating the backend model, database schema, and frontend particulars service with a transaction type parameter.

### Option 2: Frontend only filtering of particulars without database column

Filter existing particulars on the client side based on heuristics or separate local storage keys while leaving the backend model untouched.

**Pros**:
- Avoids modifying backend database schemas.

**Cons**:
- Fragile across devices and browsers because custom particulars saved on one workstation would not isolate cleanly on another.
- Cannot reliably determine whether a past saved particular belonged to sales or expenses.

## Decision

**Chosen option**: Option 1: Transaction type column on particulars with step by step Enter navigation.

The system will isolate particulars by transaction type in the database and frontend, set Rendered Fee as the default expense category, humanize validation messages, and sequence Enter key actions to select and advance before appending rows.

## Rationale

Separating sales and expenses at the database level guarantees durable isolation across all devices and encoders. Adding an optional `transaction_type` column with backward compatibility ensures existing records remain safe while new records stay neatly divided. Setting Rendered Fee as the first default category saves hundreds of repetitive clicks every day. Sequencing Enter key presses to first select suggestions and advance focus matches standard spreadsheet behavior in Excel and Google Sheets, eliminating unwanted phantom rows.

## Feature design

**Data model sketch**:
- Entity: `CompanyParticular` (`company_particulars` table)
  - `id`: Integer, primary key, autoincrement
  - `company_id`: Integer, nullable foreign key to `company.company_id`
  - `company_name`: String(100), nullable
  - `name`: String(255), not null
  - `transaction_type`: String(20), nullable (values: `'Sales'`, `'Expense'`, default `'Sales'`)
  - `created_at`: DateTime, server default now

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/particulars` | GET | `company_name: str`, `company_id: int`, `transaction_type: str` | `List[CompanyParticularOut]` | Bearer | 401, 403 |
| `/api/v1/particulars` | POST | `name: str`, `company_name: str`, `company_id: int`, `transaction_type: str` | `CompanyParticularOut` | Bearer | 400, 401, 403 |
| `/api/v1/particulars/{id}` | DELETE | `id: int` | `{"status": "success", "id": int}` | Bearer | 401, 403, 404 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Load particulars on `/sales/add` | Autocomplete sales suggestions | `GET /api/v1/particulars?transaction_type=Sales` |
| Load particulars on `/expense/add` | Autocomplete expense suggestions | `GET /api/v1/particulars?transaction_type=Expense` |
| Pre fill expense row category | `'Rendered Fee'` | `DEFAULT_EXPENSE_CATEGORIES[0]` constant in `AddTransactionSheetPage.tsx` |
| Validate empty row fields | `"Row X: The particulars couldn't be empty"` | Derived by row validation scanner in `AddTransactionSheetPage.tsx` |
| Enter in particulars combobox | Move focus to category cell | `cellRefs.current[`${rowIndex}-2`]?.focus()` |
| Enter in category combobox | Move focus to price cell | `cellRefs.current[`${rowIndex}-5`]?.focus()` |

**Key invariants**:
- Sales particulars must never be returned when `transaction_type=Expense` is queried.
- Expense particulars must never be returned when `transaction_type=Sales` is queried.
- New expense rows must always initialize with category set to `Rendered Fee`.
- Empty particulars or categories must display humanized sentences without raw technical identifiers.
- Enter key inside comboboxes must first close suggestions and advance focus before triggering row insertion.

**Security model**:
- Role based access enforced via `require_business_reader` on GET and `require_business_writer` on POST and DELETE.
- Multi tenant company boundary verified via `check_company_access` on target company ids.

**Critical test scenarios**:
- Particulars scoping: Add particular "Delivery Fee" on `/sales/add` for Company A. Navigate to `/expense/add` for Company A and verify "Delivery Fee" does not appear in particulars suggestions, verifies **AC-1**, **AC-2**.
- Default category: Open `/expense/add`, click Add Row, verify the category column displays "Rendered Fee", verifies **AC-3**.
- Humanized validation: Click Submit with empty particulars, empty category, and zero price. Verify alert banner reads `Row 1: The particulars couldn't be empty`, `Row 1: The category couldn't be empty`, `Row 1: The price couldn't be empty`, verifies **AC-4**.
- Keyboard flow: Focus particulars cell, type part of a name, press Enter. Verify the selection is confirmed and focus advances to category cell. Press Enter in category cell and verify focus moves forward without creating a blank row, verifies **AC-5**, **AC-6**.

## Build plan

- [x] 1. Add `transaction_type` column to `CompanyParticular` model in `backend/app/models/particular.py` and update schemas in `backend/app/schemas/particular.py`, satisfies **AC-1**.
- [x] 2. Update `backend/app/api/v1/endpoints/particulars.py` to filter and persist by `transaction_type` (`Sales` or `Expense`), satisfies **AC-1**.
- [x] 3. Update `frontend/src/services/particularsService.ts` to accept `transactionType` parameter and cache lists independently per company and type, satisfies **AC-1**.
- [x] 4. Reorder `DEFAULT_EXPENSE_CATEGORIES` in `frontend/src/pages/AddTransactionSheetPage.tsx` so `Rendered Fee` is the first element and default category for expenses, satisfies **AC-3**.
- [x] 5. Update `AddTransactionSheetPage.tsx` row validation error banner messages to humanized phrasing (`The particulars couldn't be empty`, `The category couldn't be empty`, `The price couldn't be empty`), satisfies **AC-4**.
- [x] 6. Refine `ParticularsCombobox` and `CategoryCombobox` keydown handling in `AddTransactionSheetPage.tsx` so Enter selects and advances focus across cells, with row addition occurring on subsequent Enter, satisfies **AC-5**, **AC-6**.
- [x] 7. Ensure sales category additions and expense category additions remain completely separate in local state and API queries, satisfies **AC-2**.

## Consequences

**Positive**:
- Clear separation of business language between revenue and expense tracking.
- Dramatically reduced repetitive clicking when recording standard rendered fee expenses.
- Polished, user friendly error notifications.
- Smooth spreadsheet keyboard navigation that mirrors standard desktop spreadsheet applications.

**Negative / tradeoffs**:
- Adds one nullable column to `company_particulars` table.

## Migration plan

**Strategy**: feature-flagged or nullable schema extension (no breaking changes).
**Phases**:
1. Add `transaction_type` as nullable column with default `'Sales'` for existing records in SQLite and Supabase.
2. Deploy backend endpoint updates that support optional `transaction_type` query and payload parameters.
3. Deploy frontend UI updates with transaction type scoping, Rendered Fee defaults, and revised keyboard navigation.
**Rollback**:
- Revert frontend and backend commits. Existing particulars remain valid with or without the `transaction_type` column.
**Risks**:
- Existing particulars created prior to this update have null `transaction_type`; query filters will treat null as matching both types or defaulting to sales until backfilled.

## Follow-up

- [ ] Run `/develop 0036` to implement the particulars scoping, default Rendered Fee, humanized validation, and Enter key navigation.
- [ ] Run `/check verify 0036` to confirm all acceptance criteria in the browser.

