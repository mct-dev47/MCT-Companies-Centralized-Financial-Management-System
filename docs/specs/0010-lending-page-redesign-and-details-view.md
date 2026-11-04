# 0010 · Lending Page Redesign, Full Page Details View, and Calendar Date Selector

**Status**: Accepted
**Date**: 2026-10-28

## Summary

This specification defines the architectural enhancements and visual revisions for the Lending feature. It removes the compliance status tier and accrued penalty charges, eliminates company name references to focus exclusively on external borrowers, cleans up due date displays, upgrades the lending information details view from a constrained modal dialog into a dedicated full screen page, and implements an interactive calendar date selector in the record payment workflow to restrict selection to valid, unsettled payment dates.

## Context

The micro lending module operates with individual borrowers rather than internal companies. Earlier iterations included tiered compliance badges (`Compliant`, `Delayed`, `Delinquent`), a 5 percent missed cycle penalty calculation, and company affiliations that do not match the business reality. Additionally, viewing facility details inside a modal dialog cramped the payment schedule table and ledger cards. Finally, choosing payment dates with a standard text or date input permitted accidental selection of dates that were already settled or outside the loan term.

## Requirements

1. **Remove Compliance Status**:
   - Eliminate the `Compliant`, `Delayed`, and `Delinquent` badges from the main facilities table and details view.
   - Remove compliance tier calculations from active displays.

2. **Remove Company Name References**:
   - Eliminate company names across the lending interface.
   - Display external borrower names exclusively, with optional borrower contact and address details where helpful.

3. **Clean Due Date Display**:
   - In the Due Date table column, remove cycle prefixes such as `Month 1: 2026-11-21`.
   - Display the clean calendar due date along with the loan term duration (for example `2026-11-21` and `40 days term`).

4. **Convert Lending Details Modal into Dedicated Full Screen Page**:
   - Replace the modal dialog overlay with a dedicated full screen page layout.
   - Provide a prominent back navigation button (`← Back to Lending Facilities`).
   - Present spacious summary metric cards: Loan Amount, Interest Rate, Total Payable, Total Paid, Remaining Balance, Installment Target, and Schedule Dates.
   - Remove compliance tier badges and 5 percent penalty cards from the details view.
   - Display a full width payment schedule and history ledger with generous spacing.

5. **Interactive Calendar Payment Date Selector**:
   - Replace the plain date input in the record payment workflow with an embedded interactive calendar picker.
   - Visually distinguish date states:
     - Available dates (pending or partial installments) are selectable.
     - Fully paid dates display a settled checkmark indicator and are disabled from selection.
     - Dates prior to loan start date or beyond valid term limits are disabled.
   - Automatically update the selected payment date upon clicking an available calendar day.

## Decision

1. **Frontend Architecture**:
   - [LendingPage.tsx](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/frontend/src/pages/LendingPage.tsx) will support two primary screen modes: the Facilities List view and the Facility Details view. When a user selects a facility, the view state switches to render the complete facility details screen taking up 100 percent of the screen width and height.
   - The interactive calendar component will compute each date status from the facility payment schedule and disable dates that have already received full payment or fall outside valid boundaries.
   - The main facilities table will show clean columns: Loan Ref No, Borrower Name, Principal Amount, Interest Rate, Total Amount Payable, Amount Paid, Remaining Balance, Due Date, Facility Status, and Actions.

2. **Backend & Service Consistency**:
   - [lending_service.py](file:///c:/MY%20PROJECTS/MCT-Companies-Centralized-Financial-Management-System/backend/app/services/lending_service.py) continues to enforce period settlement locking while returning clean financial metrics without requiring company affiliations.

## Build Plan

1. **Facilities List Table Polish**:
   - Remove compliance status column and badge rendering.
   - Remove company name references.
   - Format due date column to show clean date and term days.

2. **Full Screen Details Page View**:
   - Render a dedicated full screen component with header, action buttons, spacious summary cards, and full width schedule ledger table.
   - Remove accrued penalty cards and compliance tier badges.

3. **Interactive Calendar Date Picker Component**:
   - Construct a monthly calendar grid within the record payment dialog.
   - Highlight fully paid days in muted green with lock icons, disabling click events.
   - Highlight selectable active dates with hover effects and distinct selection rings.

## Consequences

- The user experience is substantially enhanced with a spacious, dedicated detail page.
- Accidental payment logging on already settled days is completely prevented through visual calendar locking.
- Redundant company and compliance clutter is eliminated.
