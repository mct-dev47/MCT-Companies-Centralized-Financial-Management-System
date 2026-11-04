# 0014. Borrower Ledger Balances and Penalty Database Persistence in Supabase

**Date**: 2026-10-29
**Status**: Accepted

## Summary

This specification defines the database persistence for lending borrower balances, interest amounts, penalty fees, payments, and remaining balances in Supabase. Previously, the `borrowers` table stored the initial principal, interest rate, and base contract payable amount, while running totals like accumulated penalties, total collections, and current remaining balance were computed on the fly in memory or recorded only on individual transaction rows. Under this architecture, the `borrowers` table in Supabase PostgreSQL is enhanced with dedicated persistent balance columns: `total_penalties`, `amount_paid`, and `remaining_balance`. When payments are made or daily ledger evaluations update accrued penalties, the system synchronizes these values directly into the `borrowers` table row in Supabase so that database queries, Supabase dashboard views, and external audits reflect exact balances at all times.

## Context

Micro lending operations rely on database integrity to prevent discrepancies between ledger logs and borrower profiles. When loan officers and managers inspect the database in Supabase, they need to view the complete financial picture for each loan directly in the `borrowers` record:
1. Principal Amount (disbursed loan capital)
2. Interest Rate and contractual interest
3. Accrued Penalty Fees (accumulated overdue late payment charges)
4. Total Amount Payable (gross debt obligation including assessed penalties)
5. Total Amount Paid (cumulative remittances collected from borrower)
6. Remaining Balance (outstanding debt required to fully settle the facility)

Prior to this update, when penalties accrued or cash collections were recorded, the backend updated `lending_transactions` rows and calculated borrower remaining balances dynamically in Python. While the frontend receipt displayed the correct figures, querying `SELECT * FROM borrowers` in Supabase showed only the static initial contract values. If an administrator inspected the table directly, `total_penalties` and current `remaining_balance` were absent.

By adding `total_penalties`, `amount_paid`, and `remaining_balance` columns to the `borrowers` table and maintaining them inside every payment remittance and balance refresh, the database becomes the authoritative single source of truth.

## Requirements

**User stories**:
- As a finance manager inspecting Supabase, I want the `borrowers` table to store current `amount_paid`, `total_penalties`, `remaining_balance`, and `total_payable` so that I can see accurate financial totals directly in table views without writing custom aggregation queries.
- As an auditor, I want every recorded payment in Supabase to update the borrower remaining balance and total paid atomically so that no transaction is detached from the facility balance.
- As a loan officer, I want my borrower overview and receipt figures to match the exact persisted values stored in Supabase PostgreSQL.

**Acceptance criteria**:
- **AC-1**: The `borrowers` table in Supabase PostgreSQL contains `total_penalties NUMERIC(15, 2)`, `amount_paid NUMERIC(15, 2)`, and `remaining_balance NUMERIC(15, 2)` columns, with default values of `0.00`.
- **AC-2**: When creating a new borrower facility, `amount_paid` initializes to `0.00`, `total_penalties` initializes to `0.00`, `total_payable` initializes to principal plus interest, and `remaining_balance` initializes to equal `total_payable`.
- **AC-3**: When a payment transaction is recorded, the backend atomically persists the new transaction row in `lending_transactions` and updates the `borrowers` row in Supabase with the new `amount_paid`, `total_penalties`, `total_payable` (base payable plus total penalties), and `remaining_balance`.
- **AC-4**: When borrower lists or details are evaluated by `LendingService`, any accrued late penalties derived from missed daily cycles are synchronized back into `borrowers.total_penalties`, `borrowers.total_payable`, and `borrowers.remaining_balance` in Supabase.
- **AC-5**: For existing records (such as Borrower 5, Park Jihyo), running the database migration immediately calculates and saves: Principal ₱30,000.00, Interest Rate 20% (₱6,000.00 interest), Penalty Fees ₱1,620.00, Total Payable ₱37,620.00, Amount Paid ₱2,000.00, and Remaining Balance ₱35,620.00 directly into Supabase.

## Decision

We update the database schema for the `borrowers` table in both Supabase PostgreSQL and the local SQLite development environment, update the SQLAlchemy ORM models, and enhance `LendingService` to guarantee atomic database updates on every loan lifecycle event.

### Database Schema Updates
Add the following columns to `borrowers`:
```sql
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS total_penalties NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(15, 2) DEFAULT 0.00;
```

### Consistency and Synchronization Strategy
1. **On Payment Remittance**: Inside `record_payment()`, within the same database transaction that commits the new `LendingTransaction`, update the parent `Borrower`:
   - `b.amount_paid = total_paid`
   - `b.total_penalties = total_penalties`
   - `b.total_payable = base_total_payable + total_penalties`
   - `b.remaining_balance = remaining_balance`
   - `b.status = 'Completed'` if `remaining_balance <= 0` else `b.status`
2. **On Retrieval & Daily Ledger Refresh**: When `get_borrowers()` processes ledger evaluations for active facilities and derives updated late penalties, it commits the calculated `total_penalties`, `total_payable`, and `remaining_balance` into the `borrowers` table row in Supabase if values differ, ensuring Supabase stays current even before new cash is recorded.

## Build Plan

1. Create and execute database migration script `backend/migrate_borrower_balances.py` with bypass sandbox mode to connect to Supabase PostgreSQL and add the columns and populate existing values.
2. Update SQLAlchemy model in `backend/app/models/lending.py` to include `total_penalties`, `amount_paid`, and `remaining_balance`.
3. Update Pydantic schemas in `backend/app/schemas/lending.py` to include these fields in borrower response payloads.
4. Update `backend/app/services/lending_service.py` to persist updated balance totals to the `Borrower` model in `record_payment()`, `create_borrower()`, and `get_borrowers()`. Fix the legacy fallback query where `company_id` was undefined.
5. Verify persistence in Supabase PostgreSQL by querying database records directly.

