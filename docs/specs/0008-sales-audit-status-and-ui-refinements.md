# 0008: Sales & Expense Audit Status, Particulars Status Filtering, Fast Bank Loading, and Local Created-At Timestamps

**Status:** Approved (section 2.1 audit storage in localStorage is replaced by spec 0014)  
**Date:** 2026-10-28  
**Owner:** Architect / Develop

## 1. Context & Problem Statement

Users reported connected issues and requests across the Sales (`/sales`, `/sales/add`), Expense (`/expense`, `/expense/add`), Loan (`/loan`), Petty Cash (`/petty-cash`), and Dashboard (`/`) modules:

1. **Sales and Expense records automatically show as Audited (`Verified`)**:
   - `mapBackendSaleToItem` in `frontend/src/services/salesService.ts` and `mapBackendExpenseToItem` in `frontend/src/services/expenseService.ts` previously hardcoded `auditStatus: 'Verified'`.
   - When opening a transaction in `AuditTransactionModal.tsx` or attempting to edit it, `currentAuditStatus === 'Verified'` locked the record and showed `"This transaction has already been audited and can no longer be edited."` even though no auditor had audited it.

2. **Editing category and particular status (`Paid`, `Unpaid`, `Pending`) without auto-auditing**:
   - Users must be able to edit the category and item status (for example, changing from `Pending` to `Paid` or `Unpaid`) both in the transaction modal and in `/sales/add` / `/expense/add` (edit mode).
   - Saving or updating a sale or expense must preserve `Pending Audit` status and must never automatically mark the record as `Verified` unless an auditor explicitly marks it as audited.

3. **Slow Deposit Bank loading on `/sales/add` (and `/expense/add`)**:
   - On `/sales/add`, users can fill out and save a sales record immediately while `bankService.getAccounts()` is still fetching from the backend. During that window, the dropdown shows `"No Bank Registered"` or has no selected bank account yet.

4. **Status filter (`Paid`, `Pending`, `Unpaid`) in Particulars & Yellow `Pending` color**:
   - When filtering by status (`Paid`, `Pending`, or `Unpaid`), the table and transaction detail modal must filter to show only the matching particulars (for example, only `Paid` or `Pending` particulars when that filter is active).
   - Every `Pending` badge and status selector across the UI must use a yellow color theme (`bg-yellow-100 text-yellow-800 border-yellow-300`).

5. **Correct `Created At` time in the UI (`Sales`, `Expense`, `Loan`, `Petty Cash`)**:
   - Backend `created_at` timestamps are stored in UTC (sometimes returned as naive UTC strings or raw ISO strings).
   - `AuditTransactionModal.tsx` rendered raw ISO strings, and `PettyCashPage.tsx` / `LoanPage.tsx` either omitted `Created At` or did not normalize UTC timestamps to local time.

6. **Remove overall `Payment Status` in Sales and Expense modal**:
   - In `AuditTransactionModal.tsx`, the overall `Payment Status:` row was redundant for Sales and Expense because each item already displays its own status in the Itemized Particulars section.

7. **Dynamic `Deposit` vs `Sales Record` tab in `/sales` and `Withdraw` vs `Expense Record` tab in `/expense` (except KPIs above)**:
   - In `/sales`, switching between `Deposit` and `Sales Record` tabs dynamically updates the table and chart without altering the top KPI cards (`Total Sales` and `Total Cash`).
   - In `/expense`, the sub tab label must be renamed from `"Deposit"` to `"Withdraw"` (since expenses represent cash withdrawals/disbursements, not deposits). Switching between `Withdraw` and `Expense Record` tabs dynamically updates the table and chart without altering top KPIs (`Total Expense` and `Total Cash`).

8. **Dashboard KPI Calculation for Total Cash, Total Cash Expense, and Net Income**:
   - In the main dashboard (`/`), users must see actual cash flow rather than only gross sales:
     - `Total Cash` (or `Total Cash In / Income`): sum of actual cash/deposit collected across sales (`deposit`).
     - `Total Cash Expense` (or `Total Cash Out / Expenses`): sum of actual cash disbursements/withdrawals across expenses (`withdrawal`).
     - `Net Income`: computed as `Total Cash - Total Cash Expense` (`cash income - cash expense`).

---

## 2. Decisions & Architecture

### 2.1 Audit Status Lifecycle & Editability (`salesService.ts`, `expenseService.ts`, `AuditTransactionModal.tsx`, `AddTransactionSheetPage.tsx`)
- **Default State**: All newly created, updated, or backend-mapped sales and expenses default to `auditStatus: 'Pending Audit'` unless explicitly recorded as `'Verified'` or `'Flagged'` by an auditor.
- **Persistent Audit State**: Store auditor decisions (`Verified`, `Flagged`, `Pending Audit` plus `auditedBy`, `auditedAt`, `auditRemarks`) in a persistent `localStorage` map (`mct_sales_audit_status_v1` and `mct_expense_audit_status_v1`) merged into `mapBackendSaleToItem` and `mapBackendExpenseToItem`.
- **Cache Invalidation on Save/Edit**: Call `this.invalidateCache()` in `salesService.addSale`, `salesService.updateSale`, `salesService.deleteSale`, `expenseService.addExpense`, `expenseService.updateExpense`, and `expenseService.deleteExpense` so returning from `/sales/add` or `/expense/add` immediately displays updated statuses and categories.
- **Category & Status Edits**:
  - Enable category editing in `AuditTransactionModal.tsx` for both Sales (`SALES_CATEGORY_LIST`) and Expense (`EXPENSE_CATEGORIES`), as well as in `/sales/add` and `/expense/add`.
  - Allow editing item status (`Paid`, `Pending`, `Unpaid`) in `/sales/add`, `/expense/add`, and `AuditTransactionModal.tsx` while the transaction is not `Verified`, keeping `auditStatus: 'Pending Audit'`.

### 2.2 Fast Deposit Bank Loading (`bankService.ts`, `AddTransactionSheetPage.tsx`, `SalesPage.tsx`, `ExpensePage.tsx`)
- **Synchronous Cache + Stale-While-Revalidate**:
  - Add an in-memory and `sessionStorage` cache (`mct_bank_accounts_cache_v1`) in `bankService.ts` along with `getCachedAccounts(companyName?: string)`.
  - Warm the bank accounts cache on `SalesPage` and `ExpensePage` mount so navigating to `/sales/add` or `/expense/add` populates `bankAccounts` in `0ms` on the very first render.
- **Loading Guard in `AddTransactionSheetPage.tsx`**:
  - Initialize `bankAccounts` synchronously from `bankService.getCachedAccounts(company)` and auto-select the first bank account immediately.
  - Track `isLoadingBanks` so if the cache is cold on a hard refresh of `/sales/add`, the dropdown displays `"Loading bank accounts..."` and the Save button waits briefly until the default bank is selected.

### 2.3 Particulars Status Filtering & Yellow `Pending` Styling (`particularsUtils.ts`, `SalesPage.tsx`, `ExpensePage.tsx`, `AuditTransactionModal.tsx`, `AddTransactionSheetPage.tsx`)
- **Particulars Status Helpers (`particularsUtils.ts`)**:
  - `deriveRecordStatusFromParticulars(items, fallbackStatus)`: Derives record status from itemized particulars (`Paid`, `Pending`, `Unpaid`).
  - `filterParticularsByStatus(items, statusFilter, fallbackStatus)`: Returns only particulars matching `statusFilter` when `statusFilter` is `'Paid'`, `'Pending'`, or `'Unpaid'`.
  - `matchesParticularsStatusFilter(items, recordStatus, statusFilter)`: Returns `true` if a record has at least one particular matching `statusFilter`.
- **Table & Modal Filtering**:
  - When `statusFilter` is set to `'Paid'`, `'Pending'`, or `'Unpaid'`, the table row in `SalesPage` and `ExpensePage` and the open `AuditTransactionModal` display only the matching particulars and compute the displayed row amount from those matching particulars.
- **Yellow `Pending` Badge**:
  - Standardize `Pending` status badge and select styling to yellow (`bg-yellow-100 text-yellow-800 border-yellow-300`) across `SalesPage.tsx`, `ExpensePage.tsx`, `AuditTransactionModal.tsx`, and `AddTransactionSheetPage.tsx`.

### 2.4 Local `Created At` Timestamp Formatting (`dateUtils.ts`, `SalesPage.tsx`, `ExpensePage.tsx`, `LoanPage.tsx`, `PettyCashPage.tsx`, `AuditTransactionModal.tsx`, `petty_cash_service.py`)
- Add `formatCreatedAt(dateInput?: string | Date | null): string` in `frontend/src/utils/dateUtils.ts`:
  - Detects naive UTC strings (such as `"2026-10-28 07:47:55"` or `"2026-10-28T07:47:55"` without `Z` or timezone offset) and appends `'Z'` before parsing so browser `Date` converts UTC to the user's local timezone accurately.
  - Formats as `MM/DD/YY, hh:mm AM/PM` (e.g., `10/28/26, 03:47 PM`).
- Include `created_at` in `PettyCashLedgerEntry` (`backend/app/schemas/petty_cash.py` and `backend/app/services/petty_cash_service.py`) and `frontend/src/services/pettyCashService.ts`.
- Display the formatted `Created At` timestamp in the table and detail modals across Sales, Expense, Loan (`LoanPage.tsx`, `ApproveLoanModal.tsx`, `AuditReviewLoanModal.tsx`, `AuditTransactionModal.tsx`), and Petty Cash (`PettyCashPage.tsx`).

### 2.5 Remove Overall Payment Status in Sales & Expense Modal (`AuditTransactionModal.tsx`)
- Remove the overall `Payment Status:` row for Sales and Expense (`{isLoan && ...}`).
- Render the Itemized Particulars table (including the per-item `Status` badge column) whenever `parsedParticularItems.length >= 1` so even single-particular transactions clearly display their particular status badge.

### 2.6 Dynamic Tab in Sales (`Deposit` / `Sales Record`) and Expense (`Withdraw` / `Expense Record`)
- In `SalesPage.tsx`:
  - Top KPI cards (`Total Sales` and `Total Cash`) are computed from `baseFilteredSales`.
  - Tab switcher has `Deposit` and `Sales Record`.
- In `ExpensePage.tsx`:
  - Sub tab label is renamed from `'Deposit'` to `'Withdraw'` (`tableTab === 'Withdraw' ? 'Withdraw' : 'Expense Record'`).
  - Top KPI cards (`Total Expense` and `Total Cash`) are computed from `baseFilteredExpenses`.
  - When `tableTab === 'Withdraw'`, the table and chart show expenses that have cash disbursements (`getPaidDisbursementForExpense(item) > 0`).

### 2.7 Dashboard KPIs: Total Cash, Total Cash Expense, and Net Income Calculation (`DashboardPage.tsx`, `dashboardService.ts`)
- In `DashboardPage.tsx`:
  - Card 1: `Total Cash` (or `Total Cash In / Income`) = sum of all `deposit` amounts (or cash collected).
  - Card 2: `Total Cash Expense` (or `Total Cash Out`) = sum of all `withdrawal` amounts across expenses.
  - Card 3: `Net Income` = `Total Cash - Total Cash Expense`.
  - Both cards accurately reflect cash flow instead of uncollected/unpaid revenue, resolving the problem where net income did not subtract cash expenses from cash sales.

---

## 3. Acceptance Criteria
- [x] Newly created and fetched Sales and Expense records default to `Pending Audit` and remain editable until an auditor explicitly marks them as `Verified`.
- [x] Users can edit Category and item statuses (`Paid`, `Pending`, `Unpaid`) on Sales and Expenses without triggering automatic audit verification.
- [x] Deposit Bank dropdown on `/sales/add` and `/expense/add` loads immediately from cache and auto-selects a valid bank before save.
- [x] Filtering by `Paid`, `Pending`, or `Unpaid` shows only the matching particulars in both the table and the transaction modal, and `Pending` badges are yellow.
- [x] `Created At` time displays the accurate local date and time in Sales, Expense, Loan, and Petty Cash.
- [x] Overall `Payment Status` row is removed from the Sales and Expense detail modal.
- [x] Switching between `Deposit` and `Sales Record` tabs in `/sales` dynamically updates the table/chart while keeping the top KPIs constant.
- [x] In `/expense`, the sub tab is named `Withdraw` instead of `Deposit`.
- [x] In `/`, the dashboard displays `Total Cash` (Income), `Total Cash Expense` (Expenses), and `Net Income` calculated as `Total Cash - Total Cash Expense`.
