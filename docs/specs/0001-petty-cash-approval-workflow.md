# 0001. Petty Cash Request Approval and Disbursement Workflow

**Date**: 2026-10-27
**Status**: Proposed

## Summary

This specification defines the petty cash replenishment and review process across all MCT subsidiaries. Subsidiary companies submit petty cash replenishment requests without needing to guess or supply banking source details or voucher reference numbers. Requests enter a pending queue for the central finance team, who review each transaction, require a clear justification remark, and approve or disapprove the request. Upon approval, the requested funds credit the company petty cash balance in the shared database and display live in the frontend.

## Context

Company branches frequently require small cash disbursements for immediate operating expenses. Previously, the petty cash request interface expected branches to enter voucher reference codes and designate bank funding sources that only central treasury controls. In addition, the frontend interface used local browser storage mock records rather than communicating with the central database backend.

Because multiple company entities rely on central finance oversight, replenishment requests must follow a strict audit trail. Finance officers need to inspect pending submissions, supply mandatory review remarks explaining their decision, and have immediate ledger updates sync directly through the backend API to the PostgreSQL database.

## Requirements

**User stories**:
- As a company representative or supervisor, I want to submit a petty cash replenishment request with only the amount, date, and description, so that I can request funds simply without knowing corporate treasury details.
- As a finance officer, I want to review submitted petty cash requests and click any transaction to approve or disapprove it with a required remark, so that company funds are strictly accounted for.
- As a system auditor, I want all petty cash approvals and balance updates persisted to the central database, so that records cannot be lost or altered locally.

**Acceptance criteria**:
- **AC-1**: The petty cash request modal and ledger table remove all reference number, voucher number, and funding source inputs.
- **AC-2**: Submitting a petty cash request creates a top up record with status `Pending Finance Approval`, zero initial cash in credited, and routes it to the finance team view.
- **AC-3**: Clicking any pending transaction in the finance view opens the transaction summary dialog featuring distinct `Approve` and `Disapprove` buttons (transactions already approved hide these buttons).
- **AC-4**: Clicking `Approve` or `Disapprove` triggers a confirmation modal requiring a non empty remark input before submission can proceed.
- **AC-5**: Submitting approval updates the record status to `Approved`, records the review remark, saves the reviewer identity and timestamp, credits the company petty cash balance in the database, and refreshes the ledger in the UI.
- **AC-6**: Submitting disapproval updates the record status to `Disapproved` (or `Rejected`), records the required remark, keeps cash in at zero, and prevents balance credits.
- **AC-7**: All frontend actions connect directly to the FastAPI backend and primary PostgreSQL database with no reliance on mock local storage data.

## Options considered

### Option 1: Extend petty cash topups table with status and review fields

Add columns for status, remark, reviewed by, and reviewed at directly into the existing `petty_cash_topups` database table. The balance calculation treats only top up records with status `Approved` as positive balance additions.

**Pros**:
- Reuses existing ledger queries and foreign keys seamlessly.
- Minimal migration risk and simple single table updates.
- Maintains backwards compatibility with existing expense ledger calculations.

**Cons**:
- Table holds both pending requests and confirmed top ups.

### Option 2: Create a dedicated petty cash requests table

Build a standalone table for requests that creates an independent top up row only when finance confirms approval.

**Pros**:
- Isolates draft requests from approved records.

**Cons**:
- Requires duplicate fields across two tables.
- Complicates audit tracking across multiple table joins.

## Decision

**Chosen option**: Option 1: Extend petty cash topups table with status and review fields.

We extend the `petty_cash_topups` model and database table with `status`, `remark`, `reviewed_by`, and `reviewed_at` columns, ensuring single table integrity, simple audit logging, and direct balance computation based solely on approved records.

## Rationale

Extending `petty_cash_topups` ensures that every request remains in the ledger from creation to resolution. Finance officers can see the entire history of pending, approved, and disapproved transactions in one unified view. Calculating running balances simply filters for `status == 'Approved'`, preventing unapproved funds from prematurely expanding company budgets while keeping the schema compact and performant.

## Feature design

**Data model sketch**:
- Table: `petty_cash_topups`
  - `topup_id`: Integer, primary key
  - `company_id`: Integer, foreign key to `company.company_id`
  - `amount`: Numeric(15, 2), required
  - `topup_date`: Date, required
  - `description`: Text, required
  - `status`: String(50), default `Pending Finance Approval`, allowed values: `Pending Finance Approval`, `Approved`, `Disapproved`
  - `remark`: Text, required when status is `Approved` or `Disapproved`
  - `reviewed_by`: Integer or String, optional until reviewed
  - `reviewed_at`: DateTime(timezone=True), optional until reviewed
  - `created_by`: Integer, optional
  - `created_at`: DateTime(timezone=True), default now

**State transitions**:
- `Pending Finance Approval` -> `Approved` (via finance approval confirmation with required remark)
- `Pending Finance Approval` -> `Disapproved` (via finance disapproval confirmation with required remark)

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/petty-cash/ledger | GET | company_name, start_date, end_date | List[PettyCashLedgerEntry] | Bearer | 401, 500 |
| /api/v1/petty-cash/summary | GET | company_name, start_date, end_date | PettyCashSummaryOut | Bearer | 404, 500 |
| /api/v1/petty-cash/topups | POST | company, amount, topup_date, description | PettyCashTopUpOut | Bearer | 400, 422 |
| /api/v1/petty-cash/topups/{id}/review | POST | action (`approve` or `disapprove`), remark | PettyCashTopUpOut | Bearer (Finance/Admin) | 400, 404, 422 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Submit request | Status `Pending Finance Approval` | Inferred default upon request submission |
| Submit request | Cash in (₱0.00) | Calculated (uncredited until approved) |
| Finance Review | Status `Approved` or `Disapproved` | Review action chosen in confirmation modal |
| Finance Review | Review remark | Required text input from confirmation modal |
| Finance Review | Reviewed by | Session user display name or email |
| Finance Review | Reviewed at | Server current timestamp |
| Balance query | Running balance | Computed sum of approved top ups minus expenses |

**Key invariants**:
- Unapproved or disapproved top ups never add to the company running balance.
- Remarks are strictly mandatory whenever a transaction status changes to `Approved` or `Disapproved`.
- An already approved transaction cannot be approved or disapproved again.

**Security model**:
- Company supervisors can submit petty cash requests for their assigned company.
- Only users with `finance` or `admin` roles can approve or disapprove requests.

**Critical test scenarios**:
- Happy path: Company requests ₱10,000 petty cash. Finance opens transaction, clicks Approve, inputs required remark "Approved for kitchen supplies", and confirms. Balance increases by ₱10,000 and status updates to Approved. Verifies **AC-2**, **AC-3**, **AC-4**, **AC-5**.
- Disapproval path: Finance clicks Disapprove on a request, inputs required remark "Exceeds monthly allocation", and confirms. Record displays Disapproved with remark and balance is unchanged. Verifies **AC-4**, **AC-6**.
- Validation failure: Finance attempts to approve without entering a remark. System rejects submission until remark is supplied. Verifies **AC-4**.
- Field cleanup: Petty cash page and modal contain no voucher or funding source fields. Verifies **AC-1**.

## Build plan

1. Database Migration: Add `status`, `remark`, `reviewed_by`, and `reviewed_at` columns to `petty_cash_topups` across primary PostgreSQL and local SQLite fallbacks (**AC-2**, **AC-5**, **AC-6**, **AC-7**).
2. Backend Models and Schemas: Update SQLAlchemy `PettyCashTopUp` model and Pydantic schemas to include review fields and validation (**AC-2**, **AC-4**, **AC-7**).
3. Backend Service and Review Endpoint: Implement review endpoint `/api/v1/petty-cash/topups/{id}/review` enforcing required remarks and update ledger balance logic to count only approved top ups (**AC-2**, **AC-5**, **AC-6**, **AC-7**).
4. Frontend Service Integration: Update `pettyCashService.ts` to support review requests and fetch ledger entries directly from the backend API (**AC-5**, **AC-7**).
5. Frontend Request Modal Cleanup: Remove reference number, voucher number, and funding source inputs from `TopUpPettyCashModal.tsx` (**AC-1**).
6. Frontend Ledger and Finance Review UI: Update `PettyCashPage.tsx` to fetch real data from backend, remove voucher/source columns, display review remarks, and allow finance users to click transactions to open approve or disapprove flows with mandatory remark confirmation dialogs (**AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**).
