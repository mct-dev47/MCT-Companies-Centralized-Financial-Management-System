# 0007. Remove Mock Data and Integrate Dynamic Database Lookups

**Date**: 2026-10-28
**Status**: Accepted

## Summary

This specification eliminates all remaining mock data, hard coded company dictionaries, and artificial seed scripts across the financial management system. Loan services will resolve company names dynamically from the live database, the loan page company drop down will fetch active companies directly from the companies table for audit and finance users, and the sales service will return empty lists instead of static sample records. The petty cash seeder and admin database seed script will be formally retired so every entity and user is managed purely through database records and application endpoints.

## Context

During early development, several fallback structures were introduced to allow offline UI testing before all backend endpoints were fully operational. These included hard coded company lookup tables in the loan service, a static list of nine companies in the loan page drop down, hundreds of lines of fake transactions in the sales service, and standalone seed scripts that populated demo petty cash top ups and admin credentials directly in the database.

As the system transitioned to production with live Supabase database connections, these static structures began causing subtle operational issues and data desynchronization. In Supabase, company primary keys are dynamic (with IDs such as 3, 10, 14, 21, 28, and 38), yet the loan service mapped only IDs 1 through 10 to hard coded names. Any loan linked to a company outside that range defaulted to an unhelpful label such as Company 14. Furthermore, newly registered companies did not appear in the loan page filters, and temporary network delays triggered fallbacks that displayed dozens of fake sales on user dashboards. Establishing a single source of truth requires removing all mock fixtures and ensuring all components query the database.

## Requirements

**User stories**:
- As a Finance Officer or Auditor viewing company loans, I want borrower and lender names to be resolved dynamically from the database so that every company displays its correct legal name regardless of ID number.
- As an Auditor or Finance Officer filtering loans, I want the company filter drop down to populate dynamically from the active companies table so that newly registered companies appear automatically.
- As a Company Supervisor or Auditor viewing sales, I want the sales list to display only real database transactions and show an empty state when no sales exist so that no confusing placeholder transactions ever appear.
- As a System Administrator, I want all seed scripts to be retired from database operations so that records and users are managed exclusively through official endpoints and database tables.

**Acceptance criteria**:
- **AC-1**: `loanService.ts` replaces the static `CANONICAL_COMPANIES_LOOKUP` with dynamic company resolution, loading company names from the backend companies endpoint (`/api/v1/companies`) or from the central company context.
- **AC-2**: `LoanPage.tsx`, `CompanyLoansPage.tsx`, and `AdminCompanyLoansView.tsx` replace the hard coded `COMPANY_LIST` constant with dynamic options fetched from the database, correctly handling loading and error states.
- **AC-3**: `salesService.ts` removes `INITIAL_SALES` entirely; when the backend returns no sales or when a query matches no records, the service returns an empty array rather than injecting fake transactions.
- **AC-4**: `backend/seed_petty_cash.py` is retired and removed from active operations, and any residual seeded petty cash entries (`SEED-PC-`) are purged.
- **AC-5**: `backend/seed.py` is decommissioned from direct database operations, ensuring user accounts and credentials are created and updated exclusively through the authenticated user management endpoints and Supabase admin service.

## Options considered

### Option 1: Complete removal of mock fixtures with dynamic database fetching (Recommended)
Remove all hard coded company lookup tables, static company lists, and fake sales arrays. Implement dynamic API fetching for company lists with client side caching (30 second time to live) to prevent redundant queries, and delete standalone seed scripts.

**Pros**:
- Guarantees strict single source of truth matching the live PostgreSQL and Supabase database.
- Eliminates visual glitches where company names display as Company 14 or fake sales reappear after network retries.
- Newly registered companies instantly appear across all filters without code changes.

**Cons**:
- Components must handle loading and empty states cleanly when a company has zero sales or zero loans.

### Option 2: Hybrid fallback with local storage caching
Keep the static arrays as an offline fallback when network requests fail, but attempt to refresh them from the backend whenever the user navigates to the page.

**Pros**:
- Works if the user is completely disconnected from the internet.

**Cons**:
- Retains confusing fake data on screen during network blips.
- Violates the requirement that all data must originate from the database.

## Decision

**Chosen option**: Option 1: Complete removal of mock fixtures with dynamic database fetching.

All company resolutions, loan page drop downs, and sales queries will pull exclusively from live database records, with mock fixtures and seed scripts permanently retired.

**Implementation skills**: `develop` (builder skill for implementing dynamic company integration and cleaning mock services).

## Rationale

The system is connected to a production Supabase instance where actual company entities, sales, and user accounts exist. Retaining mock data introduces confusion for financial stakeholders because numbers in reports must represent actual corporate transactions. Eliminating static lookups ensures that database operations remain transparent, predictable, and fully synchronized across all companies.

## Feature design

**Data model sketch**:
No database schema changes are required. The existing tables will be used directly:
- `company`: `company_id` (bigint PK), `company_name` (varchar), `location` (varchar), `starting_balance` (numeric)
- `sales`: `sales_id` (bigint PK), `company_id` (bigint FK), `amount` (numeric), `transaction_date` (date)
- `loan`: `loan_id` (bigint PK), `borrower` (bigint FK to company), `lender` (bigint FK to company)

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/companies` | GET | none | List of active company objects (`company_id`, `company_name`) | Bearer token | 401 Unauthorized |
| `/api/v1/sales` | GET | `company_id`, `company_name` | List of real sale records | Bearer token | 401 Unauthorized |
| `/api/v1/loans` | GET | `company_id`, `loan_type` | List of real loan records with borrower and lender IDs | Bearer token | 401 Unauthorized |

**UX surface**:
- In the Loan Page, the company filter drop down displays an initial loading state, followed by the live list of companies fetched from `/api/v1/companies`, with All Companies as the top item.
- In the Sales Page, if a company has no sales recorded, a clean empty state card displays with the message No sales transactions found rather than showing sample catering records.

## Build plan

### Slice 1: Loan service company resolution and dynamic drop downs (satisfies AC-1, AC-2)
1. In `frontend/src/services/loanService.ts`, remove `CANONICAL_COMPANIES_LOOKUP`. Integrate `companyService.getCompanies()` or `/api/v1/companies` to map borrower and lender company IDs to their true database names.
2. In `frontend/src/pages/LoanPage.tsx`, remove the hard coded `COMPANY_LIST` constant. Use the existing `dbCompanies` state (populated via `loanService.getCompanyOptions()`) to render the filter options for Audit and Finance roles.
3. Update `frontend/src/components/dashboard/AdminCompanyLoansView.tsx` to source its company selections dynamically from the database.

### Slice 2: Sales service mock removal (satisfies AC-3)
1. In `frontend/src/services/salesService.ts`, delete the `INITIAL_SALES` mock array.
2. Update `getSales()` to return an empty array `[]` when the backend fetch encounters an empty list or error, preventing fake sales from being displayed.

### Slice 3: Retire seed scripts (satisfies AC-4, AC-5)
1. Delete or archive `backend/seed_petty_cash.py` and ensure no `SEED-PC-` sample records remain in the database.
2. Deprecate `backend/seed.py` from regular database usage, documenting that all user management is performed via the authenticated user administration interface.

## Migration plan

**Strategy**: Big bang code cleanup without schema migration (zero downtime).
**Phases**:
1. Update `loanService.ts` and `LoanPage.tsx` to dynamic company fetching.
2. Clean `salesService.ts` to remove static mock arrays.
3. Remove `seed_petty_cash.py` and `seed.py`.
**Rollback**: Revert git commits.
**Risks**: If `/api/v1/companies` is temporarily unreachable, the company drop down should show an empty or retry indicator.

## Consequences

**Positive**:
- Company names in loans always match actual database records.
- Newly added companies appear immediately in the loan page filter without code edits.
- The sales page accurately reflects live corporate income without misleading mock data.
- The database is protected from accidental re seeding of dummy top ups or user resets.

**Negative**:
- Local offline development without a database connection will display empty states.

**Neutral**:
- A small client side cache (30 seconds) will be maintained for company lists to minimize network round trips.

## Critical test scenarios

- **Scenario 1 (Dynamic company names in loans)**: Create a loan between two companies with high ID numbers (for example company 28 and company 38). Confirm that the loan table displays the actual names rather than Company 28 or Company 38 (maps to AC-1).
- **Scenario 2 (Dynamic company filter in loan page)**: Log in as Auditor or Finance Officer. Confirm that the company drop down contains all active companies from the database and updates when a new company is registered (maps to AC-2).
- **Scenario 3 (Zero sales empty state)**: View sales for a company with no recorded transactions. Confirm that the UI displays zero entries and no mock transactions (maps to AC-3).
- **Scenario 4 (Clean database state)**: Verify that no `SEED-PC-` records exist in the database and that `seed_petty_cash.py` is eliminated (maps to AC-4, AC-5).

## Follow up

- Update project context documentation in `AGENTS.md` during the next synchronization pass to note that all mock services have been eliminated.
