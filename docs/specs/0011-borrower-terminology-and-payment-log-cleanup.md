# Build Spec 0011: Borrower Terminology, Database Migration, and Payment Log Search

Status: Accepted

## Summary
Align the lending system terminology and database architecture with the borrower model. The concept of lending facility is completely replaced with Borrower. The PostgreSQL database tables are migrated from `lending_facilities` to `borrowers`. In the main Lending Page, the secondary facility ID displayed beneath the borrower name is removed, and the primary action button is renamed from New Lending Facility to New Borrower. In the Lending Details Page, the Paid and Pending toggle and all synthetic pending installment rows are removed. The payment log displays only genuine payment transactions completed by the user, accompanied by an interactive search bar for querying dates, methods, reference numbers, and remarks.

## Requirements

### 1. Main Lending Table and Terminology
- Remove the subtitle displaying `facilityID` or `loanId` directly below the borrower name in the main table row.
- Rename all user facing labels and button texts from Lending Facility or Facility to Borrower (for example New Borrower, Edit Borrower, Borrowers).
- In empty state messages, change No lending facilities found to No borrowers found.

### 2. Database and Backend Migration
- Migrate table `lending_facilities` to `borrowers` in PostgreSQL.
- Rename `facility_id` to `borrower_id` in `borrowers` and `lending_transactions`.
- Rename `facility_ref_no` to `borrower_ref_no` in `borrowers`.
- Update SQLAlchemy model [Borrower](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/models/lending.py) and relationships.
- Update Pydantic schemas in [backend/app/schemas/lending.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/schemas/lending.py).
- Update query and persistence routines in [backend/app/services/lending_service.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/services/lending_service.py) and endpoints in [backend/app/api/v1/endpoints/lending.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/api/v1/endpoints/lending.py).

### 3. Payment Schedule and History Log Clean Up
- Remove the Paid and Pending toggle completely from the Payment Schedule and History section header.
- Eliminate all synthetic scheduled pending installment entries. Only genuine recorded payment transactions made by the borrower are included in the log.
- Provide a dedicated search bar in the section header allowing the user to filter payment records by payment date, notes, remarks, payment method, or reference number.
- If the borrower has not made any payments yet, show the friendly empty state card with an action button to record the first payment.

## Decision and Implementation Plan

### Phase 1: Database Migration
1. Execute PostgreSQL `ALTER TABLE lending_facilities RENAME TO borrowers`.
2. Rename columns `facility_id` to `borrower_id` and `facility_ref_no` to `borrower_ref_no` on table `borrowers`.
3. In `lending_transactions`, rename `facility_id` to `borrower_id` and update the foreign key constraint to reference `borrowers(borrower_id)`.

### Phase 2: Backend Models, Schemas, and Services
1. In [backend/app/models/lending.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/models/lending.py), rename class `LendingFacility` to `Borrower`, pointing to `__tablename__ = "borrowers"`. Keep alias for backward compatibility.
2. In [backend/app/schemas/lending.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/schemas/lending.py), update schema models.
3. In [backend/app/services/lending_service.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/services/lending_service.py), update all database queries and methods to operate on `Borrower` and `borrower_id`.
4. In [backend/app/api/v1/endpoints/lending.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/api/v1/endpoints/lending.py), maintain endpoints and support borrower terminology.

### Phase 3: Frontend Types and UI Updates
1. In [frontend/src/services/lendingService.ts](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/services/lendingService.ts), update interfaces and storage helpers.
2. In [frontend/src/pages/LendingPage.tsx](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/LendingPage.tsx):
   - Remove the `facility.loanId` subtitle beneath the borrower name in the table cell.
   - Change New Lending Facility to New Borrower.
   - Update modal titles, descriptions, and button labels to refer to Borrower.
   - In details page, remove `historyStatusFilter`, `generatedPending`, and the Paid/Pending toggle.
   - Place a search bar in the Payment Schedule & History header for searching dates and remarks.
   - Display only genuine payments or the empty state when no payments have occurred yet.
