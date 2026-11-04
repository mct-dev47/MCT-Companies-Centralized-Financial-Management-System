# 0011 · Sales Companies, Current Month Calendar, Role Notifications, Loan Bank Disbursement, Bank Card Details, and Audit Loan Status

**Status**: Accepted
**Date**: 2026-10-29

## Summary

This build spec covers six coordinated enhancements across the centralized financial platform.
First, the admin company dropdown on the Sales page dynamically shows all registered companies from the database.
Second, all calendar controls, date pickers, and date range filters across the system default to and start within the current month instead of September.
Third, in-app notifications deliver real time alerts to Finance for new loan and petty cash requests, to Audit for compliance approvals, and to Supervisors for approved deposits, loans, and petty cash top ups.
Fourth, the Finance Review and Endorse modal on borrower loans allows selecting a source corporate bank account; upon Audit approval, the loan amount is automatically deducted from that bank with an official bank transaction record and credited to the supervisor company account.
Fifth, the Bank Management view displays the bank account name and the owning company name alongside the bank brand across all selectors, card decks, and card faces.
Sixth, Internal Audit users visiting the borrower loans view see clear status badges such as Approved, Disapproved, and Pending Audit, matching the experience of Finance users.
Seventh (update 2026-10-29), Finance endorses a loan by choosing a funding bank only. The lending company is no longer a separate required choice; it comes from the chosen bank.
Eighth (update 2026-10-29), Internal Audit users cannot edit loans. They can still review, approve, or disapprove.

## Context

Users across several roles noted gaps in workflow handoffs, visibility, and filtering defaults.
Administrators filtering sales records needed a company dropdown loaded directly from the database rather than static lists.
Several date pickers previously initialized to September dates or hardcoded fallback strings from earlier mock runs instead of opening to the active current month.
The notification bell only computed loan due dates and repayments, omitting approval alerts for Finance, Audit, and Supervisors.
Borrower loans required bank funding selection during Finance endorsement and automatic bank ledger deduction upon Audit approval.
Bank Management cards showed only the bank name, making it hard to identify which subsidiary or account purpose a card represented.
Finally, Auditors reviewing borrower loans only saw a three dot icon without visible status badges.

## Requirements

1. **Admin Sales Company Dropdown**:
   - The company selector in `SalesPage.tsx` must load all companies registered in the database.
   - Synchronize with the central company context and backend `GET /api/v1/companies`.
   - Never fall back to outdated static lists.

2. **Calendar Dropdowns Default to Current Month**:
   - All date range pickers and calendar selectors across `DateRangePicker.tsx`, `LendingPage.tsx`, `SalesPage.tsx`, `ExpensePage.tsx`, `LoanPage.tsx`, and `BankManagementPage.tsx` must initialize to the current month using the active date rather than hardcoded dates or September.
   - In `LendingPage.tsx`, the payment calendar modal must open directly on the current calendar month.

3. **Role Specific In-App Notifications**:
   - Finance users must receive notifications for pending loan requests and pending petty cash top up requests.
   - Internal Audit users must receive notifications for loans and petty cash top ups endorsed by Finance that await audit compliance approval.
   - Supervisors must receive notifications when Finance or Audit approves or rejects their deposit, loan request, or petty cash top up.
   - The notification bell dropdown must provide distinct icons and direct navigation links for each alert type.

4. **Loan Endorsement Bank Selection and Automatic Deduction**:
   - The "Finance Review & Endorse Loan" modal must present a "Choose Bank" selector displaying corporate bank accounts with their bank name, account name, account number, company name, and available balance.
   - Finance assigns the funding bank account upon endorsement.
   - When Internal Audit approves the loan, the backend must deduct the principal amount from the selected bank account, write a BankTransaction record with category `Loan Disbursement`, and credit the borrower supervisor company.

5. **Bank Account Name and Company Visibility in Bank Management**:
   - Display the bank name, account name, and company name together in the bank selector dropdown, switcher pill bar, and stacked deck headers.
   - Display the account name and owning company name on the bank card face so users immediately know the company and purpose of each account.

6. **Audit View Status Badges in Borrower Loans**:
   - In `LoanPage.tsx` under the borrower view, Audit users must see clear status badges (`Pending Audit Approval`, `Approved`, `Disapproved by Audit`, `Paid`, `Partially Paid`) just like Finance users do, alongside the audit review action.

7. **Endorsement Needs a Bank, Not a Lender Choice** (update 2026-10-29):
   - AC-7.1: Finance can endorse a loan as long as a funding bank account is chosen. No message about selecting a lending company is shown or returned.
   - AC-7.2: The lending company stored on the loan is the company that owns the chosen bank account.
   - AC-7.3: If no bank is chosen, endorsement is refused with the message "Please choose a bank account to disburse this loan."
   - AC-7.4: If the chosen bank belongs to the borrower company, endorsement is still refused (a company cannot lend to itself).
   - AC-7.5: Rejecting a loan still needs only a remark.

8. **Audit Cannot Edit Loans** (update 2026-10-29):
   - AC-8.1: On the borrower and lender loan views, an Audit user sees no edit, delete, or record payment control, and clicking a row never opens the edit or record payment dialogs.
   - AC-8.2: Audit keeps its review actions: audit review (approve or disapprove), mark verified, and mark flagged.
   - AC-8.3: The backend refuses loan update, loan delete, and loan repayment requests from Audit users with a 403, so the rule holds even without the screen.

## Decision

1. **Company Loading Architecture**:
   - Refresh dynamic company fetching in `CompanyContext.tsx` on session updates and expose the live company names list.
   - Ensure `SalesPage.tsx` reads this dynamic list and falls back only to database companies.

2. **Date Utility and Initialization Architecture**:
   - Standardize default date ranges to derive `${year}-${month}-01` and `${year}-${month}-${lastDay}` using `new Date()`.
   - Remove hardcoded `'2026-10-01'` and `'2026-09-01'` initializers.

3. **Notification Engine Expansion**:
   - Expand `backend/app/services/notification_service.py` to examine `PettyCashTopUp` records, pending and approved `Loan` records, and verified `Sale` records.
   - Provide role awareness in `backend/app/api/v1/endpoints/notifications.py` so Finance and Audit receive multi company alerts while Supervisors receive alerts scoped to their company.
   - Update `NotificationBell.tsx` with friendly icons and routes.

4. **Bank Loan Funding Workflow**:
   - Add `bank_account_id` to `LoanEndorseRequest` in `backend/app/schemas/loan.py` and store it in `Loan` metadata.
   - Update `backend/app/api/v1/endpoints/loans.py` to execute a withdrawal on the funding bank account using `BankService(db).withdraw()` when `action == "approve"` in `audit_review_loan`.
   - Update `ApproveLoanModal.tsx` to load available corporate bank accounts and submit `bank_account_id`.

5. **Bank Card Display Architecture**:
   - Update `getAccountCardLabel` in `BankManagementPage.tsx` to return `Bank • Account Name (Company)`.
   - Render the account name and company name on the ATM card face and hero card layout.

6. **Audit Loan Table Rendering**:
   - Refactor the action column in `LoanPage.tsx` to render the appropriate status badge for all users, including Audit, before showing audit action buttons.

## Build Plan

1. Update `CompanyContext.tsx` and `SalesPage.tsx` for dynamic database company loading.
2. Update `DateRangePicker.tsx`, `LendingPage.tsx`, and all pages to start on current month.
3. Update `backend/app/services/notification_service.py` and `backend/app/api/v1/endpoints/notifications.py` to generate notifications for loan requests, petty cash requests, and supervisor approvals. Update `NotificationBell.tsx` with UI badges.
4. Update `LoanEndorseRequest` in backend schemas and `loans.py` to deduct from bank upon audit approval. Update `ApproveLoanModal.tsx` to choose bank account.
5. Update `BankManagementPage.tsx` to display account name and company name on selectors and card faces.
6. Update `LoanPage.tsx` to display status badges in the audit view.
7. Verify all changes and test end to end.
8. (AC-7.1 to AC-7.5) In `endorse_loan` in `backend/app/api/v1/endpoints/loans.py`, require the funding bank, derive the lender from it, and remove the lending company required error. The modal in `ApproveLoanModal.tsx` already asks only for a bank.
9. (AC-8.1, AC-8.2) In `LoanPage.tsx`, stop Audit from opening the edit and record payment dialogs from a row click, and make the row not look clickable for those cases.
10. (AC-8.3) In `loans.py`, add one shared check that returns 403 for Audit users, and call it from `update_loan`, `delete_loan`, and `create_loan_repayment`.

## Value sourcing for items 7 and 8

| Value | Source |
|---|---|
| Funding bank id | `bank_account_id` in the endorse request, chosen in the modal |
| Lender company id | `BankAccount.company_id` of the chosen bank, else the company found by `BankAccount.company_name` |
| Borrower company id | the existing loan row |
| Is the user Audit | the `role` on the authenticated user (`audit` or `auditor`), and `user.role` in the screen |
