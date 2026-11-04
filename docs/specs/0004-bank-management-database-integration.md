# 0004. Corporate Bank Management Database Integration and Cash Routing

**Date**: 2026-10-27
**Status**: Accepted

## Summary

This specification upgrades corporate bank management from browser local storage to persistent database storage. It eliminates all hardcoded dummy accounts, mock transactions, and fake balances, ensuring that bank data originates strictly from the central database. It adds an Others option when adding bank accounts so custom bank names can be specified. It restricts bank account creation, deposits, and withdrawals to Finance and Admin users only. It routes cash collections from Sales and cash disbursements from Expenses directly into company bank accounts, and broadcasts real time updates via WebSocket so all open tabs synchronize instantly without manual page refreshes.

## Context

Previously, the bank management page stored mock accounts and fake transactions inside browser local storage with pre-seeded fake balances (such as ₱1,000,000 or ₱3,650,000) and dummy line items. Bank accounts were not synchronized with actual sales cash collections or expense disbursements.

By moving bank management entirely to the database, removing all mock fixtures and fake balances, and subscribing to the central WebSocket manager, every company bank account reflects true live balances that update across all connected clients in real time.

## Requirements

**User stories**:
- As a Finance officer or Admin, I want to create corporate bank accounts with standard banks or an Others option, so that I can register any commercial or digital bank facility.
- As a Finance officer or Admin, I want to record manual deposits and withdrawals on bank accounts, so that I can log direct bank adjustments, wire transfers, and settlements.
- As an Auditor or Company user, I want to view bank accounts and ledgers in read only mode without modification buttons, so that data integrity is protected while maintaining visibility.
- As an accountant, when I record a paid cash sale, I want the system to route the cash deposit directly to the company bank account.
- As an accountant, when I record a paid expense, I want the system to record the cash withdrawal directly against the company bank account.
- As any active user, I want bank balances and ledgers to update automatically across tabs via WebSocket without having to refresh the page.

**Acceptance criteria**:
1. All hardcoded mock accounts, fake balances, and dummy transactions are completely removed from the frontend and database.
2. No automated accounts are seeded. The database starts with zero accounts, displaying a clean empty state until an authorized user creates an account.
3. Database models `BankAccount` and `BankTransaction` are implemented with SQLAlchemy.
4. API endpoints exist under `/api/v1/bank-accounts` for listing, creating, depositing, and withdrawing.
5. Only users with role `Admin` or `Finance` can create bank accounts or make deposits and withdrawals.
6. In the Add Bank Account modal, selecting `Others` reveals a text input for custom bank name.
7. Cash sales and cash expenses with status `Paid` automatically record corresponding deposit and withdrawal entries in the designated company bank account.
8. Real time WebSocket synchronization via event `BANK_UPDATED` updates all clients and tabs immediately when accounts or transactions change.
9. Companies in bank management are loaded dynamically from `/api/v1/companies`.
10. Sales and Expense forms provide a Bank Account selector dropdown, allowing users to designate the specific bank account for cash deposits and withdrawals when companies own multiple bank accounts.
11. Modal submission buttons are disabled while an operation is in progress, preventing duplicate bank account records from rapid or repeated clicks on Save.
12. Bank filtering by company employs alias matching, ensuring accounts for entities like MyCity.Kitchen Corporation match user filters for MCT Kitchen without disappearing.
13. Card decks display all accounts dynamically without a hard cutoff, ensuring every registered account remains selectable.
14. Backend account creation includes an idempotency guard that detects duplicate requests within a short window, safeguarding database integrity.

## Technical Design

### Backend Data Model
- `bank_accounts` table:
  - `id`: Primary key string (e.g. `bnk-cb-001` or uuid)
  - `bank_name`: Bank institution name
  - `account_name`: Account holder title
  - `account_number`: Masked or full account number
  - `company_name`: Corporate entity name
  - `company_id`: Optional company identifier
  - `card_label`: Display label for card and tabs
  - `account_type`: Checking, Savings, Payroll, or Time Deposit
  - `branch`: Branch location
  - `starting_balance`: Decimal initial balance
  - `current_balance`: Decimal live balance
  - `color_theme`: Red or grey
  - `notes`: Optional description
  - `created_at`: Creation date
  - `updated_at`: Modification date

- `bank_transactions` table:
  - `id`: Transaction identifier
  - `bank_account_id`: Foreign key reference to `bank_accounts.id`
  - `transaction_date`: Date string or Date object
  - `cheque_no`: Optional cheque number
  - `particulars`: Description of transaction
  - `deposit`: Optional deposit amount
  - `withdrawal`: Optional withdrawal amount
  - `category`: Transfer category
  - `net_amount`: Signed or absolute amount
  - `created_at`: Timestamp

### Security and Permissions
- Backend routes check `current_user.role in ['Admin', 'Finance']`. Auditor and Company roles receive HTTP 403 Forbidden on write operations.
- Frontend hides creation modals and action buttons for Auditor and Company roles.

## Build Plan

1. Create backend model `backend/app/models/bank.py` and register in `backend/app/db/session.py`.
2. Create schemas in `backend/app/schemas/bank.py`.
3. Create API endpoints in `backend/app/api/v1/endpoints/bank_accounts.py` and register in `backend/app/api/v1/router.py`.
4. Create frontend API service `frontend/src/services/bankService.ts`.
5. Update `frontend/src/pages/BankManagementPage.tsx` to load from and save to backend API, add the Others option to the bank dropdown, and guard action buttons for Finance and Admin.
6. Connect cash sales and expenses to record corresponding bank transactions automatically.
