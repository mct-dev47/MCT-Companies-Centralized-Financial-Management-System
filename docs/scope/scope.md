# Project Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Food Receivables and Unpaid Expense Lifecycle | in-progress | [0027](../specs/0027-unpaid-expense-sales-receivables-lifecycle.md) |
| Receivables UI Refinements and Bidirectional Sales Sync | in-progress | [0028](../specs/0028-receivables-refinements-bidirectional-sync/index.md) |
| Owner Role and Account Migration | in-progress | [0029](../specs/0029-owner-role-and-account-migration/index.md) |
| Activity Audit Log Changes and IP Tracking | in-progress | [0030](../specs/0030-activity-audit-log-changes-and-ip-tracking.md) |
| Lending Page and Payment Refinements | in-progress | [0030](../specs/0030-lending-page-and-payment-refinements/index.md) |
| Company Amount Input Validation and User Form Reset | in-progress | [0031](../specs/0031-company-amount-validation-and-user-modal-cache-clearing.md) |
| User Form Required Fields Validation Warning | in-progress | [0032](../specs/0032-user-form-required-fields-validation-warning.md) |
| Company Deletion Cascade Cleanup and Typed Name Confirmation | in-progress | [0033](../specs/0033-company-deletion-cascade-and-typed-confirmation.md) |
| Daily Grouped Sales and Expenses with Transaction Drilldown | in-progress | [0034](../specs/0034-daily-grouped-sales-and-expenses-with-transaction-drilldown/index.md) |
| Transaction Sheet Validation, Company Payment Methods with Service Fees, and Supervisor View Cleanups | in-progress | [0035](../specs/0035-sales-validation-gcash-fee-supervisor-cleanups.md) |
| Transaction Sheet Particulars Scoping, Default Rendered Fee, Humanized Validation, and Keyboard Flow | in-progress | [0036](../specs/0036-transaction-particulars-scope-and-keyboard-flow.md) |
| Transaction Sheet Fee Zero Handling, Debtor Pre fill on Edit, Deposit Subtab Filtering, and Clean Particulars Start | completed | [0037](../specs/0037-sales-expense-add-and-records-refinements.md) |
| Lending Audit Workflow and Visibility | in-progress | [0031](../specs/0031-lending-audit-workflow-and-visibility/index.md) |
| Tenant Audit Tags and Table Refinements | in-progress | [0034](../specs/0034-tenant-audit-tags-and-table-refinements/index.md) |
| Tenant Audit Review and Lease Refinements | in-progress | [0035](../specs/0035-tenant-audit-review-and-lease-refinements/index.md) |

---

## Active Features

### Food Receivables and Unpaid Expense Lifecycle
**Status**: in-progress
**Spec**: [0027](../specs/0027-unpaid-expense-sales-receivables-lifecycle.md)
**Intent**: Route unpaid expense entries to sales assignment, persist food receivables and payments in database tables with WebSocket updates, and provide finance only edit and delete controls.
**Done when**: Unpaid expenses prefill into sales assignment, debtors are classified as Internal or External, Total Sales tracks unpaid orders while Total Cash tracks realized collections, and the Receivables page supports real time sync and Finance only editing and deletion.

- [x] Design it (spec): [0027](../specs/0027-unpaid-expense-sales-receivables-lifecycle.md)
- [x] Build it: /develop receivables-lifecycle
  - [x] Milestone 1: Backend database models, Pydantic schemas, and REST endpoints (AC-4, AC-5)
  - [x] Milestone 2: Receivables service with balance logic, payment deposits, and bidirectional sync (AC-6, AC-7, AC-9)
  - [x] Milestone 3: WebSocket RECEIVABLES_UPDATED broadcast and realtime frontend listener (AC-10)
  - [x] Milestone 4: Expense to sales unpaid transfer flow and Total Sales vs Total Cash logic (AC-1, AC-2, AC-3)
  - [x] Milestone 5: Receivables UI and ledger drawer with Finance only edit and delete dialogs (AC-8)
- [ ] Verify it: /check verify receivables-lifecycle
- [ ] Test it: /test receivables-lifecycle

### Receivables UI Refinements and Bidirectional Sales Sync
**Status**: in-progress
**Spec**: [0028](../specs/0028-receivables-refinements-bidirectional-sync/index.md)
**Intent**: Replace unpaid customer type text input with a dropdown, drop Contact / Role columns and fields, open company scoped receivable editing and deleting to BusinessWriter roles with Verified audit locks, and synchronize Sales Records and Receivables bidirectionally in real time.
**Done when**: `/sales/add` uses the `External` / `Staff` dropdown with no `Contact / Role` column, `customer_phone` and `customer_role` are dropped, `Finance` and company scoped `Company` / `Supervisor` users can edit and delete receivables and debtor rows unless audit `Verified`, and partial or full receivable payments and edits automatically update `/sales` and `/receivables` via WebSocket.

- [x] Design it (spec): [0028](../specs/0028-receivables-refinements-bidirectional-sync/index.md)
- [x] Build it: /develop receivables-refinements-bidirectional-sync (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Schema migration dropping Contact / Role columns, adding `sale_line_index`, and updating models and schemas (AC-2, AC-4, AC-8, AC-9)
  - [x] Milestone 2: `SalesReceivablesSyncService`, bidirectional API hooks, debtor batch endpoints, company scoped `BusinessWriter` auth, and `Verified` audit locks (AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9)
  - [x] Milestone 3: Unpaid sales assignment `Customer Type` dropdown and `Contact / Role` column removal on `/sales/add` (AC-1, AC-2)
  - [x] Milestone 4: Receivables UI order and debtor edit and delete controls, status settlement fields, and live WebSocket sync across `/sales` and `/receivables` (AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10)
- [ ] Verify it: /check verify receivables-refinements-bidirectional-sync
- [ ] Test it: /test receivables-refinements-bidirectional-sync

### Owner Role and Account Migration
**Status**: in-progress
**Spec**: [0029](../specs/0029-owner-role-and-account-migration/index.md)
**Intent**: Introduce an authoritative Owner role across backend and frontend systems, migrate the account for Manuel from manuel@mct.com to ryuuujin.sh@gmail.com, and enforce strict view only access across all modules without brittle email string checks.
**Done when**: Manuel account email is updated to ryuuujin.sh@gmail.com with role owner via database migration, backend blocks Owner mutations with 403 Forbidden while granting global multi company read access, frontend auth maps role to Owner with All Companies scope, and all pages suppress creation buttons, edit menus, delete options, and audit actions for Owner users.

- [x] Design it (spec): [0029](../specs/0029-owner-role-and-account-migration/index.md)
- [x] Build it: /develop owner-role-and-account-migration (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: SQL database migration updating Manuel email to ryuuujin.sh@gmail.com and role to owner (AC-1, AC-2)
  - [x] Milestone 2: Backend models, schemas, and dependencies supporting Owner role with 403 mutation guards (AC-1, AC-3)
  - [x] Milestone 3: Frontend auth service mapping Owner to All Companies scope (AC-4)
  - [x] Milestone 4: Frontend pages refactor replacing isManuel email checks with role checks and table dash placeholders (AC-5, AC-6, AC-7)
- [x] Verify it: /check verify owner-role-and-account-migration
- [ ] Test it: /test owner-role-and-account-migration

### Activity Audit Log Changes and IP Tracking
**Status**: in-progress
**Spec**: [0030](../specs/0030-activity-audit-log-changes-and-ip-tracking.md)
**Intent**: Enhance the admin activity log table at `/activity-log` with client IP address tracking and a detail drawer modal showing what exact fields changed across create, update, and delete actions.
**Done when**: Admin activity log shows a dedicated IP address column with copy button, clicking any row opens an inspection drawer showing who, when, what record, IP, user agent, and field by field old versus new values, sensitive fields are redacted, and exports contain IP and record references.

- [x] Design it (spec): [0030](../specs/0030-activity-audit-log-changes-and-ip-tracking.md)
- [x] Build it: /develop activity-audit-log-changes-and-ip-tracking (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Backend diff helper with sensitive data redaction and proxy IP extraction (AC-4, AC-5, AC-6)
  - [x] Milestone 2: Service enrichment and Pydantic/TypeScript schema extensions for IP, severity, and diffs (AC-2, AC-4)
  - [x] Milestone 3: Frontend activity log table IP column and quick copy interaction (AC-1)
  - [x] Milestone 4: Inspection side drawer modal with formatted field by field diff table and badges (AC-2, AC-3)
  - [x] Milestone 5: CSV and PDF export generators updated with IP and record references (AC-7)
- [x] Verify it: /check verify activity-audit-log-changes-and-ip-tracking
- [ ] Test it: /test activity-audit-log-changes-and-ip-tracking

### Company Amount Input Validation and User Form Reset
**Status**: in-progress
**Spec**: [0031](../specs/0031-company-amount-validation-and-user-modal-cache-clearing.md)
**Intent**: Automatically replace leading zeros in company balance and petty cash monetary fields while preserving lone 0 and decimals, and ensure Create User modal clears previous employee input and suppresses browser autofill.
**Done when**: Typing over lone 0 in Starting Balance and Petty Cash fields replaces the 0 with the typed digit without leading zeros, lone 0 and valid decimals remain permitted in company creation and editing, Create User modal resets completely on open and submit, and browser autofill is turned off on user form inputs.

- [x] Design it (spec): [0031](../specs/0031-company-amount-validation-and-user-modal-cache-clearing.md)
- [x] Build it: /develop 0031 (code in `frontend/src/`)
  - [x] Milestone 1: Reusable numeric input sanitizer helper (AC-1, AC-2, AC-3)
  - [x] Milestone 2: Starting balance and petty cash input sanitization in Create Company modal (AC-1, AC-2, AC-3)
  - [x] Milestone 3: Starting balance and petty cash input sanitization in View Company modal edit mode (AC-4)
  - [x] Milestone 4: Form and avatar state reset on open and submit in Create User modal (AC-5, AC-6)
  - [x] Milestone 5: Browser autocomplete suppression attributes on Create User form (AC-7)
- [x] Verify it: /check verify 0031
- [ ] Test it: /test 0031

### User Form Required Fields Validation Warning
**Status**: in-progress
**Spec**: [0032](../specs/0032-user-form-required-fields-validation-warning.md)
**Intent**: Render a prominent warning alert banner and red field borders when attempting to submit the Create User modal with missing required fields, auto scroll to top, and clear errors dynamically as inputs are corrected.
**Done when**: Clicking Create User with empty or invalid fields renders an alert banner listing missing fields, highlights offending inputs in red, auto scrolls smoothly to top, clears dynamically upon typing or company selection, and opens the confirmation modal when all mandatory fields are valid.

- [x] Design it (spec): [0032](../specs/0032-user-form-required-fields-validation-warning.md)
- [x] Build it: /develop 0032 (code in `frontend/src/`)
  - [x] Milestone 1: Top warning alert banner component and state in Create User modal (AC-1, AC-2)
  - [x] Milestone 2: Submission validation error handler with auto scroll to top (AC-1, AC-3, AC-4)
  - [x] Milestone 3: Assigned company validation integration into warning banner (AC-2, AC-4)
  - [x] Milestone 4: Reactive error clearing on input edit and company toggle (AC-5)
  - [x] Milestone 5: Seamless progression to confirmation modal on valid form (AC-6)
- [ ] Verify it: /check verify 0032
- [ ] Test it: /test 0032

### Company Deletion Cascade Cleanup and Typed Name Confirmation
**Status**: in-progress
**Spec**: [0033](../specs/0033-company-deletion-cascade-and-typed-confirmation.md)
**Intent**: Require typing exact company name to confirm deletion in the admin modal, and cascade company deletion across all financial ledgers, receivables, tenant leases, bank accounts, user links, and cloud storage files.
**Done when**: Admin delete company modal requires exact matching company name to unlock the delete action, closing or reopening resets input state, company deletion deletes child receivables and payments, tenant leases and payments, bank accounts and transactions, user company links, and cloud storage logo files while keeping audit log history.

- [x] Design it (spec): [0033](../specs/0033-company-deletion-cascade-and-typed-confirmation.md)
- [x] Build it: /develop 0033 (code in `frontend/src/`, `backend/app/`)
  - [x] Milestone 1: Typed company name confirmation modal with warning card and state reset (AC-1, AC-2, AC-3)
  - [x] Milestone 2: Backend cascade deletion across receivables, tenant leases, bank accounts, and user links (AC-4, AC-5, AC-6, AC-7)
  - [x] Milestone 3: Cloud storage company logo deletion with missing file tolerance (AC-8)
  - [x] Milestone 4: End to end deletion tests and audit log decoupling verification (AC-9)
- [x] Verify it: /check verify 0033
- [ ] Test it: /test 0033

### Lending Page and Payment Refinements
**Status**: in-progress
**Spec**: [0030](../specs/0030-lending-page-and-payment-refinements/index.md)
**Intent**: Optimize the Lending Page table by removing Date Borrowed and Due Date columns on screen, removing borders from status labels and audit tags, displaying compact auditor details, supporting multi line remarks wrapping, displaying transaction creator initials, and validating payment inputs.
**Done when**: Date Borrowed and Due Date are removed from the main table on screen while preserved in CSV and Excel exports, status badges and audit tags render without outline borders, auditor tag shows two line format (status label and auditor name on line one, timestamp on line two), payment history remarks wrap with expanding row height, payment history includes a CREATED BY column with creator initials and last name, Payment Method in Record Payment has a required red asterisk, and Remarks has a 50 character limit with live counter and validation.

- [x] Design it (spec): [0030](../specs/0030-lending-page-and-payment-refinements/index.md)
- [x] Build it: /develop lending-page-refinements (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Database column, lending transaction schema, and endpoint updates for `recorded_by` (AC-6)
  - [x] Milestone 2: Name formatting utility for first initial and last name pattern (AC-4, AC-6)
  - [x] Milestone 3: Main table column removal for Date Borrowed and Due Date with export retention (AC-1, AC-2)
  - [x] Milestone 4: Main table and payment schedule borderless status and compact two line audit tag (AC-3, AC-4)
  - [x] Milestone 5: Payment schedule remarks text wrapping and CREATED BY column (AC-3, AC-5, AC-6)
  - [x] Milestone 6: Record Payment modal required Payment Method and 50 character limit on Remarks (AC-7)
- [x] Verify it: /check verify lending-page-refinements
- [x] Test it: /test lending-page-refinements

### Daily Grouped Sales and Expenses with Transaction Drilldown
**Status**: in-progress
**Spec**: [0034](../specs/0034-daily-grouped-sales-and-expenses-with-transaction-drilldown/index.md)
**Intent**: Group sales and expenses by day with daily totals and aggregate audit badges, and provide subtab toggles in Deposit and Withdraw views to switch between Daily Summary and All Transactions with inline drilldown.
**Done when**: `/sales` and `/expense` provide Daily Summary and All Transactions subtabs inside both Deposit/Withdraw and Sales/Expense Record views, Daily Summary aggregates by day with expandable drilldown rows, All Transactions displays granular rows, and KPIs remain consistent across both views.

- [x] Design it (spec): [0034](../specs/0034-daily-grouped-sales-and-expenses-with-transaction-drilldown/index.md)
- [x] Build it: /develop daily-grouped-sales-and-expenses (code in `backend/app/api/v1/endpoints/{sales,expenses}.py`, `frontend/src/pages/{SalesPage,ExpensePage}.tsx`)
  - [x] Milestone 1: Reusable daily transaction aggregation utility (`dailyGroupUtils.ts`) (AC-2, AC-6, AC-9, AC-10)
  - [x] Milestone 2: Sales page subtab switcher, daily grouped table, and expandable drilldown rows (AC-1, AC-2, AC-3, AC-4, AC-9, AC-10)
  - [x] Milestone 3: Expense page subtab switcher, daily grouped table, and expandable drilldown rows (AC-5, AC-6, AC-7, AC-8, AC-9, AC-10)
  - [x] Milestone 4: Export handler alignment for daily summary and detailed transactions (AC-11)
- [ ] Verify it: /check verify daily-grouped-sales-and-expenses
- [ ] Test it: /test daily-grouped-sales-and-expenses

### Transaction Sheet Validation, Company Payment Methods with Service Fees, and Supervisor View Cleanups
**Status**: in-progress
**Spec**: [0035](../specs/0035-sales-validation-gcash-fee-supervisor-cleanups.md)
**Intent**: Default payment methods to Cash, Cheque, and GCash with company specific custom payment methods, compute inline service fees for GCash and custom methods, prevent particulars popups on add row, enforce strict row field validation, remove redundant Company columns for supervisors, and rename Inspect to Show.
**Done when**: Cash, Cheque, and GCash are default payment methods, custom company payment methods are isolated per company, GCash and custom methods show an inline service fee defaulting to 0 that adds to row total, empty price, particulars, and category trigger red outlines and a descriptive alert banner, backend enforces 422 validations, supervisor views hide company columns in daily summaries and transactions, and accordion toggle displays Show / Hide.

- [x] Design it (spec): [0035](../specs/0035-sales-validation-gcash-fee-supervisor-cleanups.md)
- [x] Build it: /develop 0035 (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Database model `CompanyPaymentMethod`, cascade deletions, and REST endpoints (AC-2, AC-8)
  - [x] Milestone 2: Frontend payment method service and custom method modal on `/sales/add` (AC-2)
  - [x] Milestone 3: Autocomplete focus without auto opening dropdown on row creation (AC-1)
  - [x] Milestone 4: Inline service fee calculation with default 0 for GCash and custom methods (AC-3, AC-8)
  - [x] Milestone 5: Pre submit row validation scanner with red cell outlines and top error banner (AC-4)
  - [x] Milestone 6: Backend schema and endpoint 422 validation for minimum amount, category, and particulars (AC-5)
  - [x] Milestone 7: Supervisor and company scoped column hiding on SalesPage and ExpensePage (AC-6)
  - [x] Milestone 8: Accordion toggle button text updated to Show / Hide (AC-7)
- [ ] Verify it: /check verify 0035
- [ ] Test it: /test 0035

### Transaction Sheet Particulars Scoping, Default Rendered Fee, Humanized Validation, and Keyboard Flow
**Status**: in-progress
**Spec**: [0036](../specs/0036-transaction-particulars-scope-and-keyboard-flow.md)
**Intent**: Separate saved company particulars and category suggestions by transaction type (Sales vs Expense), default expense rows to Rendered Fee, humanize missing field validation warnings, and sequence keyboard Enter to select and advance without premature row creation.
**Done when**: Particulars saved in Sales do not appear in Expense, categories added in Sales do not modify Expense categories, new expense rows default to Rendered Fee, missing field validation speaks in plain human sentences with red cell outlines, pressing Enter in Particulars selects the item and focuses Category, and pressing Enter in Category selects it and advances to Price before a subsequent Enter creates a new row.

- [x] Design it (spec): [0036](../specs/0036-transaction-particulars-scope-and-keyboard-flow.md)
- [x] Build it: /develop 0036
  - [x] Milestone 1: Database model, schema, and API query updates for `transaction_type` on particulars (AC-1)
  - [x] Milestone 2: Frontend particulars service transaction type scoping and cache partitioning (AC-1, AC-2)
  - [x] Milestone 3: Reorder expense categories constant so Rendered Fee is the default (AC-3)
  - [x] Milestone 4: Humanized row validation error text for particulars, category, and price (AC-4)
  - [x] Milestone 5: Refined Enter key navigation across Particulars, Category, and Row insertion (AC-5, AC-6)
- [ ] Verify it: /check verify 0036
- [ ] Test it: /test 0036

### Transaction Sheet Fee Zero Handling, Debtor Pre fill on Edit, Deposit Subtab Filtering, and Clean Particulars Start
**Status**: in-progress
**Spec**: [0037](../specs/0037-sales-expense-add-and-records-refinements.md)
**Intent**: Handle service fee zero entry cleanly without leading zeroes, load and persist debtor names and types when editing unpaid transactions, keep unpaid transactions visible in All Transactions views while filtering in Deposit/Withdraw subtabs, and clear test particulars for clean new user starts.
**Done when**: Fee inputs allow typing without stubborn leading zeroes while allowing zero default, editing an unpaid sale pre fills the debtor name and type from the database and updates the receivable, All Transactions under Sales Record and Expense Record displays all payment statuses, and new users see an empty particulars dropdown.

- [x] Design it (spec): [0037](../specs/0037-sales-expense-add-and-records-refinements.md)
- [x] Build it: /develop 0037 (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Fee input zero handling and typing replacement (AC-1)
  - [x] Milestone 2: Debtor pre fill and persistence on unpaid edit (AC-2, AC-3)
  - [x] Milestone 3: Debtor enrichment and tab cash separation on SalesPage and ExpensePage (AC-4, AC-5)
  - [x] Milestone 4: Clean company particulars test data and empty state (AC-6)
- [ ] Verify it: /check verify 0037
- [ ] Test it: /test 0037

### Lending Audit Workflow and Visibility
**Status**: in-progress
**Spec**: [0031](../specs/0031-lending-audit-workflow-and-visibility/index.md)
**Intent**: Simplify main table audit tags to clean status badges without initials or dates, open audit visibility to all system roles, display auditor attribution in the details header for auditors, integrate audit remarks into the loan receipt card, and persist discrepancy findings durably to the database via a full width bordered input.
**Done when**: The Audit Tag column is visible across all roles with clean "Audited", "Discrepancy", or "-" text and hover tooltips, Lending Details displays auditor name and timestamp above the auditor action buttons, a dedicated audit panel in the left agreement receipt card shows full status, auditor name, date, and remarks, the Flag Audit Discrepancy modal has a full width bordered textarea, and confirming audit or discrepancy actions saves directly to the database via `lendingService.saveAuditReview`.

- [x] Design it (spec): [0031](../specs/0031-lending-audit-workflow-and-visibility/index.md)
- [x] Build it: /develop lending-audit-workflow (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Main table audit column role visibility, clean text badge, and hover tooltips (AC-1, AC-2, AC-3, AC-10)
  - [x] Milestone 2: Lending details header auditor attribution above audit action buttons (AC-4, AC-5)
  - [x] Milestone 3: Dedicated audit review panel inside the left loan agreement card (AC-5, AC-6)
  - [x] Milestone 4: Flag Audit Discrepancy modal full width styling, border, and database persistence (AC-7, AC-8, AC-9)
- [ ] Verify it: /check verify lending-audit-workflow
- [ ] Test it: /test lending-audit-workflow

### Tenant Audit Tags and Table Refinements
**Status**: in-progress
**Spec**: [0034](../specs/0034-tenant-audit-tags-and-table-refinements/index.md)
**Intent**: Clean the main tenant table by removing subtitles and date columns, display status as colored text without pill backgrounds, add an Audit Tag column with multi line hover details for all permitted roles, remove actions from payment history, and display creator name attribution.
**Done when**: Tenant name cell shows only the tenant name without subtitle reference or stall units, contract date and due date columns are removed while preserved in exports, status badges render as borderless colored text, audit tag column is visible to all roles with multi line title tooltips, payment schedule actions column is removed, and payment schedule created by column displays creator initials and last name with full name hover tooltips.

- [x] Design it (spec): [0034](../specs/0034-tenant-audit-tags-and-table-refinements/index.md)
- [x] Build it: /develop tenant-audit-tags (code in `backend/app/`, `frontend/src/`)
  - [x] Milestone 1: Backend user name resolution on tenant payment responses (AC-10)
  - [x] Milestone 2: Main table column cleanup, removing subtitles and date columns (AC-1, AC-2, AC-11)
  - [x] Milestone 3: Borderless status typography and universal audit tag column with multi line hover tooltips (AC-3, AC-4, AC-5, AC-6)
  - [x] Milestone 4: Payment schedule action column removal and Created By attribution column (AC-7, AC-8, AC-9)
- [x] Verify it: /check verify tenant-audit-tags
- [ ] Test it: /test tenant-audit-tags

### Tenant Audit Review and Lease Refinements
**Status**: in-progress
**Spec**: [0035](../specs/0035-tenant-audit-review-and-lease-refinements/index.md)
**Intent**: Add a dedicated Audit Review panel to the tenant details view matching FilCap Lending, validate payment fields with 50 character remarks limit, lock core lease terms when payment transactions exist, simplify payment schedules to Daily and Monthly, remove late penalty and repeat summary boxes, realign date inputs into a balanced grid, and ensure all data originates from Supabase.
**Done when**: Audit Review panel displays in the left summary column of Tenant Details with status, reviewer, timestamp, and discrepancy remarks; Record Payment enforces date, amount, payment method, and 50 character remarks validation; Edit Lease locks rent, total payable, repeat, and date fields when payments exist; New Lease offers strictly Daily and Monthly schedules, realigns dates into a two column grid with Status, removes late penalty and calculation boxes, and validates all inputs; and backend ensures Supabase schema and audit persistence.

- [x] Design it (spec): [0035](../specs/0035-tenant-audit-review-and-lease-refinements/index.md)
- [x] Build it: /develop tenant-audit-review (code in `backend/`, `frontend/src/`)
  - [x] Milestone 1: Database migration and session startup checks for tenant lease audit columns (AC-13, AC-14)
  - [x] Milestone 2: Record Payment modal validation for dates, amounts, payment methods, and 50 char remarks (AC-2, AC-3, AC-4, AC-5)
  - [x] Milestone 3: Edit Lease modal read only locking when payments exist and penalty removal (AC-6, AC-10)
  - [x] Milestone 4: New Lease modal layout realignment, schedule simplification to Daily/Monthly, summary box removal, and field validation (AC-7, AC-8, AC-9, AC-10, AC-11, AC-12)
  - [x] Milestone 5: Tenant Details dedicated Audit Review card matching FilCap Lending (AC-1)
- [ ] Verify it: /check verify tenant-audit-review
- [ ] Test it: /test tenant-audit-review
