# 0006 · Company Deposit Bank Scoping and Authorization Fix

**Status**: Accepted
**Date**: 2026-10-28
**Author**: Antigravity Assistant

## Summary
This specification documents the resolution of company bank account visibility and authorization failures in sales and expense recording. Company users must only view and select deposit banks assigned to their specific operating entity. Company authorization checks in sales and expenses must accurately match company identity against real database company keys rather than outdated placeholder mappings.

## Requirements
- AC-1: When a company supervisor or user views the transaction sheet, the Deposit Bank and Withdraw Bank dropdown lists only bank accounts belonging to their assigned company.
- AC-2: If a company has no registered bank account, the dropdown indicates that no bank is registered, and never displays bank accounts from other operating companies.
- AC-3: Saving sales transactions succeeds without 403 Forbidden errors when authenticated as a company supervisor.
- AC-4: Saving expense transactions succeeds without company assignment authorization errors when authenticated as a company supervisor.
- AC-5: In the bank management page, company scoped users only see their own company bank accounts, and fallback logic never leaks first accounts from other entities.
- AC-6: The backend bank accounts endpoint scopes returned accounts to the caller company identity when called by company users without central administrative privileges.

## Decision
1. Unify company resolution logic into a single shared helper, `backend/app/core/company_resolver.py`. This helper resolves shorthand and trade names (such as MCT Kitchen) to exact database registered company entities (such as MyCity.Kitchen Corporation with primary key 28).
2. Eliminate hardcoded placeholder mappings that incorrectly routed MCT Kitchen to company identifier 2. Map legacy identifiers 1 and 2 directly to active company identifier 28.
3. Update `dependencies.py` to map company identifiers cleanly, normalize known email aliases for test and seeded supervisor accounts, and grant central visibility to administrative, finance, and audit roles.
4. Update `sales.py` and `expenses.py` to use `resolve_company` so sales and expense inserts target the valid company identifier matching user permissions.
5. In `frontend/src/pages/AddTransactionSheetPage.tsx`, use `isCompanyMatch` to evaluate bank account ownership. Remove fallback to all accounts, guaranteeing company isolation.
6. In `frontend/src/pages/BankManagementPage.tsx`, ensure `activeAccount` never defaults to `accounts[0]` for company scoped roles.

## Build Plan
1. Create `backend/app/core/company_resolver.py` with alias maps, legacy identifier mapping, and database resolution helpers.
2. Update `backend/app/core/dependencies.py` with normalized email alias handling and legacy company mapping in `check_company_access`.
3. Update `backend/app/api/v1/endpoints/sales.py` and `backend/app/api/v1/endpoints/expenses.py` to use `resolve_company`.
4. Update `backend/app/api/v1/endpoints/bank_accounts.py` to enforce company scoping on list requests.
5. Update `frontend/src/pages/AddTransactionSheetPage.tsx` and `frontend/src/pages/BankManagementPage.tsx` for strict company bank filtering.
6. Verify and test the complete workflow using reproduction scripts and frontend build validation.
