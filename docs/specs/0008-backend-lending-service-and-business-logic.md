# 0008. Backend Lending Service and Business Logic Architecture

**Date**: 2026-10-28
**Status**: Accepted

## Summary

This specification defines the migration of lending business logic from the frontend application into a dedicated backend service. All financial arithmetic, schedule generation, period locking, and status transitions will reside in backend/app/services/lending_service.py. The frontend lending page and services will retain only form validation, display rendering, and API communication.

## Context

During initial implementation, loan calculations, daily ledger tracking, and monthly installment rules were written directly inside the frontend user interface component. While this enabled rapid feedback, it placed domain business rules and ledger immutability enforcement on the client browser.

Embedding business logic in the client browser introduces architectural fragility. Financial ledger consistency, duplicate payment prevention, interest computation, and overdue installment evaluations must be enforced authoritatively on the server. The user requested using /architect to move all lending business logic and calculations into backend/app/services/lending_service.py, leaving only field validation in the frontend.

## Requirements

**User stories**:
- As a backend system, I want a dedicated LendingService to encapsulate all loan calculations, schedule generation, and ledger immutability checks so that business rules remain consistent and reliable.
- As an API client, I want REST endpoints under /api/v1/lending that calculate schedules, generate ledgers, and record repayments with authoritative validation.
- As a frontend application, I want a clean lendingService client in frontend/src/services/lendingService.ts that delegates business computations to the backend while preserving a local storage cache for offline reliability.
- As an auditor, I want period immutability locking enforced authoritatively by the backend so that duplicate or unauthorized collections on settled dates or months cannot be written.

**Acceptance criteria**:
- **AC-1**: Implement LendingService in backend/app/services/lending_service.py providing stateless financial arithmetic methods for interest calculation, total payable, cycle installment targets, and remaining balance.
- **AC-2**: Implement schedule and ledger generation in LendingService for Daily, Monthly, Quarterly, and Annually frequencies, automatically marking missed daily dates and deriving cycle installment due dates.
- **AC-3**: Enforce period settlement locking in LendingService, rejecting duplicate payment attempts on already settled daily dates or fully paid monthly installments with HTTP 409 conflict errors.
- **AC-4**: Expose dedicated REST API endpoints under /api/v1/lending in a new lending router registered in backend/app/api/v1/router.py for calculating loan facilities, generating schedule ledgers, and recording repayments.
- **AC-5**: Create frontend/src/services/lendingService.ts to serve as the unified API gateway for the lending page, providing network requests with local storage fallback.
- **AC-6**: Strip all calculations, ledger generators, and period locking logic from frontend/src/pages/LendingPage.tsx, retaining only user input field validation and display presentation.

## Options considered

### Option 1: Hybrid backend service with pure calculation methods and database repository operations

Implement LendingService in backend/app/services/lending_service.py as a hybrid engine containing both pure computational methods (calculating interest, cycle due dates, daily ledgers) and transactional database methods (creating facilities, recording repayments, updating loan statuses). Expose these via dedicated REST endpoints under /api/v1/lending and connect via frontend/src/services/lendingService.ts with a local storage fallback.

**Pros**:
- Clean separation of concerns where the backend serves as the authoritative source of truth.
- Pure methods allow fast unit testing without database setup.
- Transactional methods enforce ledger immutability and record integrity in the database.
- Local storage fallback provides zero downtime and resilience if the local backend server is momentarily unreachable.

**Cons**:
- Requires creating new FastAPI schemas and route definitions.

### Option 2: Stateless calculation engine only without database methods

Implement LendingService as a calculation helper library only, leaving database writes and queries inside existing loan endpoint functions.

**Pros**:
- Smaller backend service footprint.

**Cons**:
- Leaves endpoint handlers cluttered with mixed business rules and database queries.
- Duplicate checks and state transitions remain scattered across route files.

## Decision

**Chosen option**: Option 1: Hybrid backend service with pure calculation methods and database repository operations

We create backend/app/services/lending_service.py with pure calculation methods and database operations, expose them via dedicated /api/v1/lending endpoints, add frontend/src/services/lendingService.ts, and reduce frontend/src/pages/LendingPage.tsx to field validation and UI rendering.

## Rationale

Option 1 establishes an authoritative architecture for credit facilities. Core calculations such as cycle due dates, period locking, and monthly progress become reusable, testable server side functions. Keeping local storage as a fallback in frontend/src/services/lendingService.ts guarantees that user interactions on the frontend remain fluid while transitioning toward complete server side persistence.

## Feature design

**Data model sketch**:
The backend service operates on existing models `Loan` and `LoanRepayment` while extending repayment records with cycle metadata:
- `frequency`: String enum (Daily, Monthly, Quarterly, Annually)
- `cycle_due_date`: Date indicating the installment due date
- `cycle_month_index`: Optional integer tracking the installment cycle number
- `is_locked`: Boolean indicating settled period immutability

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/lending/calculate | POST | principal: float, rate: float, frequency: str, start_date: str, due_date: str | total_payable, interest, installment_target, cycles | bearer | 422 |
| /api/v1/lending/facilities | GET | company_id: int (opt) | list of lending facilities | bearer | 200 |
| /api/v1/lending/facilities | POST | borrower_name, principal, rate, frequency, start_date, due_date, notes | created facility | bearer | 400, 422 |
| /api/v1/lending/ledger/{facility_id} | GET | facility_id: str | facility, ledger_items: list, active_cycle, is_overdue | bearer | 404 |
| /api/v1/lending/payments | POST | facility_id: str, payment_date: str, amount: float, method: str, ref: str, notes: str | repayment_record, remaining_balance, status | bearer | 400, 409, 422 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Calculate Facility | Total amount payable and periodic installment target | Computed by LendingService.calculate_facility from principal, rate, and dates |
| Build Ledger | Daily and monthly installment items with status and lock flag | Computed by LendingService.generate_ledger from loan schedule and repayment history |
| Record Payment | Updated remaining balance and period lock state | Computed and persisted by LendingService.record_payment, updating Loan and LoanRepayment records |

**Key invariants**:
- Payment amounts cannot be lower than one peso or greater than the facility remaining balance.
- Once a daily date or monthly installment is fully settled, it is locked against duplicate payment additions or removals.
- Every installment cycle has a deterministic due date derived from the borrowing start date and schedule frequency.

**Security model**:
- Authenticated users with Finance or Admin privileges can create facilities and record remittances.
- Auditor roles can inspect facility ledgers and statements with read only access.

**Critical test scenarios**:
- Happy path: LendingService calculates interest, creates a monthly facility, and records an installment payment that reduces balance, verifies AC-1 and AC-4.
- Failure case: Attempting to record a payment on an already settled daily date returns HTTP 409 conflict, verifies AC-3.
- Partial payment: Recording a payment lower than the monthly installment target marks the month as Partial and retains remaining cycle balance, verifies AC-2.

## Build plan

1. Implement backend/app/services/lending_service.py with LendingService class providing pure financial calculation methods, schedule ledger generators, and period locking logic, satisfies AC-1, AC-2, AC-3.
2. Create schemas in backend/app/schemas/lending.py and router endpoints in backend/app/api/v1/endpoints/lending.py registered in backend/app/api/v1/router.py, satisfies AC-4.
3. Create frontend/src/services/lendingService.ts providing API client methods with local storage fallback, satisfies AC-5.
4. Refactor frontend/src/pages/LendingPage.tsx to strip all calculation helpers and ledger builders, consuming frontend/src/services/lendingService.ts and keeping only field validation, satisfies AC-6.

## Consequences

**Positive**:
- Server side authority ensures financial calculations and duplicate locks cannot be bypassed in the browser.
- Frontend code becomes significantly simpler and focused purely on user experience and input validation.
- Facilitates seamless multi user collaboration and accurate reporting across devices.

**Negative / tradeoffs**:
- Requires backend server availability for live calculations, mitigated by local storage fallback during offline development.

## Migration plan

**Strategy**: Strangler pattern
**Phases**:
1. Implement and test backend/app/services/lending_service.py and its API routes.
2. Build frontend/src/services/lendingService.ts with backward compatible local storage caching.
3. Switch frontend/src/pages/LendingPage.tsx to consume the new service, stripping duplicate business logic.
**Rollback**: If backend endpoints fail, frontend falls back to cached local storage calculations.
**Risks**: Minor schema mismatches during API payload serialization, managed through Pydantic models.
