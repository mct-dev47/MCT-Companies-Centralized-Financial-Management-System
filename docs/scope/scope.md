# Project Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Food Receivables and Unpaid Expense Lifecycle | in-progress | [0027](../specs/0027-unpaid-expense-sales-receivables-lifecycle.md) |
| Receivables UI Refinements and Bidirectional Sales Sync | in-progress | [0028](../specs/0028-receivables-refinements-bidirectional-sync/index.md) |

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

