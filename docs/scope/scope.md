# Project Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Food Receivables and Unpaid Expense Lifecycle | in-progress | [0027](../specs/0027-unpaid-expense-sales-receivables-lifecycle.md) |
| Receivables UI Refinements and Bidirectional Sales Sync | in-progress | [0028](../specs/0028-receivables-refinements-bidirectional-sync/index.md) |
| Owner Role and Account Migration | in-progress | [0029](../specs/0029-owner-role-and-account-migration/index.md) |
| Lending Page and Payment Refinements | in-progress | [0030](../specs/0030-lending-page-and-payment-refinements/index.md) |

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
