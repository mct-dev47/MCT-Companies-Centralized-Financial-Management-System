# Rationale: Refine Lending Page Tables and Payment Validation

## Context

The micro lending interface serves high volume day to day financial workflows for FilCap Prime Holdings Corp. Users review dozens of active borrower records and log daily or monthly payment remittances.

Currently, the main table displays ten columns including Date Borrowed and Due Date. On typical laptop screens, these date columns crowd out borrower names and financial amounts. Both dates already exist inside the Lending Details view and in export reports, making them redundant on the main screen.

Status pills and audit tags also carry heavy borders and backgrounds that create visual noise across large tables. Auditor tags do not visibly identify which auditor performed the audit review unless a user hovers over a tooltip.

In the Lending Details view, the Payment Schedule and History table truncates long remarks with an ellipsis. Finance staff cannot read critical notes without opening inspect tools or checking raw data. In addition, payment entries do not show which finance staff member recorded the collection.

In the Record Payment modal, Payment Method lacks a visual required indicator, and the remarks field allows unbounded text input without client side validation or character counters.

## Options considered

### Option 1: Fix in place targeted enhancements (Chosen)

Apply targeted component updates to `frontend/src/pages/LendingPage.tsx`, update `DailyPaymentRecord` in `frontend/src/services/lendingService.ts`, and augment `LendingTransaction` in `backend/app/models/lending.py` and `backend/app/services/lending_service.py` to persist `recorded_by`.

Pros:
- Zero disruption to existing lending calculation logic, period locks, or penalty assessments.
- Quick to build, test, and verify.
- Reuses existing user session data and shared utility helpers.

Cons:
- Requires updating both frontend table columns and backend transaction persistence.

### Option 2: Full redesign of lending tables into subcomponents

Extract the borrower table, details payment history, and payment modal into separate isolated components before making the visual changes.

Pros:
- Decreases line count in the monolithic `LendingPage.tsx`.

Cons:
- High regression risk for state passing and modal synchronization.
- Unnecessary churn for focused visual and validation improvements.

## Rationale

Fixing in place addresses every user requirement directly without introducing architectural churn. The layout adjustments only touch presentation markup, column groupings, and validation logic. Storing the creator name in the existing lending transaction flow ensures future payment logs maintain high accountability.

