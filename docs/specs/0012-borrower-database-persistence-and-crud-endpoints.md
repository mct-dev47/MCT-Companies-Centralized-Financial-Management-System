# Build Spec 0012: Borrower Database Persistence and Full CRUD Endpoints

Status: In Progress

## Summary
Establish direct, persistent database synchronization for all borrower operations in the lending module. Eliminate in memory fallbacks and mock data collections so that every borrower record, modification, and deletion is executed live against the PostgreSQL database. Implement dedicated update (`PUT /borrowers/{id}`) and delete (`DELETE /borrowers/{id}`) backend endpoints. Update frontend services and UI modals to guarantee that editing borrower loan terms or deleting agreements commits directly to the database before reflecting on the screen.

## Requirements

### 1. Backend Update and Delete Endpoints
* Provide `PUT /api/v1/lending/borrowers/{borrower_id}` in [`backend/app/api/v1/endpoints/lending.py`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/api/v1/endpoints/lending.py) accepting `BorrowerUpdateRequest`.
* Allow updating borrower name, loan amount, interest rate, payment frequency, term days, date borrowed, due date, status, and notes.
* Automatically recalculate loan terms, total payable amount, installment target, and remaining balance based on payments already completed.
* Provide `DELETE /api/v1/lending/borrowers/{borrower_id}` in [`backend/app/api/v1/endpoints/lending.py`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/api/v1/endpoints/lending.py).
* Safely remove the borrower record and all associated payment transactions from the database via cascading deletion.

### 2. Frontend Gateway Methods
* In [`frontend/src/services/lendingService.ts`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/services/lendingService.ts), introduce `updateBorrower(borrowerId, payload)` making an HTTP PUT request.
* In [`frontend/src/services/lendingService.ts`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/services/lendingService.ts), introduce `deleteBorrower(borrowerId)` making an HTTP DELETE request.
* Remove `INITIAL_FACILITIES` mock data and local storage fallbacks so the application loads strictly what exists in the PostgreSQL database.

### 3. Frontend UI Integration
* In [`frontend/src/pages/LendingPage.tsx`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/LendingPage.tsx), update `handleSaveEditFacility` to call `lendingService.updateBorrower`.
* In [`frontend/src/pages/LendingPage.tsx`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/LendingPage.tsx), update `handleConfirmDelete` to call `lendingService.deleteBorrower`.
* Initialize `facilities` state as an empty list and populate it directly from `lendingService.getFacilities()`.
* When the database has no borrower records, display the empty state rather than fabricated records.

## Decision and Implementation Plan

### Phase 1: Backend Service and Endpoints
1. Define `BorrowerUpdateRequest` Pydantic model in [`backend/app/schemas/lending.py`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/schemas/lending.py).
2. Implement `update_borrower` and `delete_borrower` in [`backend/app/services/lending_service.py`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/services/lending_service.py).
3. Expose routes in [`backend/app/api/v1/endpoints/lending.py`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/api/v1/endpoints/lending.py).

### Phase 2: Frontend Service Methods
1. Add `updateBorrower` and `deleteBorrower` methods in [`frontend/src/services/lendingService.ts`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/services/lendingService.ts).
2. Update `getFacilities` and `loadFromStorage` in [`frontend/src/services/lendingService.ts`](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/services/lendingService.ts) to return an empty array instead of `INITIAL_FACILITIES`.

### Phase 3: UI Integration and Verification
1. Connect `handleSaveEditFacility` and `handleConfirmDelete` to real backend calls.
2. Verify live updates and deletions against the PostgreSQL database.

