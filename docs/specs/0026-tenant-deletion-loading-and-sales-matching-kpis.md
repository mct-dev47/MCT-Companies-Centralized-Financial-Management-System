# 0026. Tenant deletion loading guard and sales matching metrics

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This decision adds a submission lock with a visible loading indicator to the tenant delete confirmation dialog to stop duplicate clicks from sending repeated deletion calls for the same lease. It also brings the tenant KPI cards into full alignment with the sales page layout by introducing three side by side cards for Total Receivables, Cash Collected, and Remaining Balance. These cards calculate values dynamically from filtered tenant records so metrics stay accurate across all status filters.

## Context

When leasing officers delete a tenant lease inside the delete confirmation modal, the delete button does not become disabled or show a loading indicator. Users on slow connections or who click rapidly can trigger multiple concurrent delete requests for the same lease identifier. While the database eventually handles or errors on the missing record, the client shows error alerts or broken UI states because the first request already deleted the resource.

At the same time, the tenant management page currently features a single composite KPI card that shows Total Tenant Receivables with collection and balance figures placed inside a small subtitle. In contrast, the sales module displays three clear, side by side cards: Total Sales, Cash Collected, and Outstanding Balance. When users filter by status such as Paid or Unpaid, they expect the tenant page to behave with the exact same clarity. When viewing paid records, they want to focus on total cash collected; when viewing unpaid records, they want to focus on total receivables and outstanding balances. Aligning the tenant KPI cards with the sales page standard creates consistency and eliminates confusion.

## Requirements

**User stories**:
- As a leasing officer, I want the delete button in the tenant modal to show a loading state and disable immediately upon clicking so that I do not trigger multiple deletions of the same account.
- As a finance manager or auditor, I want the tenant page to display three separate cards for Total Receivables, Cash Collected, and Remaining Balance matching the sales page so that I can see sales volume, cash collected, and outstanding balances clearly.
- As an operator filtering tenants by Paid, Unpaid, or Pending status, I want the three cards to reflect the filtered set accurately so that cash collected and receivables match my active view.

**Acceptance criteria**:
- **AC-1**: When the user clicks the Delete Lease button in the delete confirmation modal, the button disables immediately, displays a spinning loader, changes its label to "Deleting...", and ignores further click events until the request finishes.
- **AC-2**: The backend tenant deletion endpoint handles duplicate or concurrent delete requests gracefully, returning a 204 No Content if already removed or treating non existent IDs idempotently without causing unhandled server exceptions.
- **AC-3**: The tenant page replaces the single composite summary card with three separate, responsive cards displayed side by side: Total Receivables (total obligation volume across matching leases), Cash Collected (actual cash payments recorded), and Remaining Balance (total unsettled balances).
- **AC-4**: When the user changes the status filter to Paid, Unpaid, Pending, or All, the three tenant cards update dynamically from the filtered dataset without requiring a full page refresh.
- **AC-5**: If a deletion fails due to network or authorization issues, the modal re-enables the delete button, removes the spinner, and displays an informative error message banner.

## Options considered

### Option 1: Client side button disabling only and single adaptive card

Disable the delete button inside React state while keeping the single card and changing its title based on the active status filter.

**Pros**:
- Involves minimal HTML layout adjustments.
- Keeps all figures bundled into one card container.

**Cons**:
- Does not match the proven three card standard used across the sales and lending pages.
- Leaves the backend vulnerable to parallel automated scripts sending concurrent delete requests.

### Option 2: Dual layer button locking with backend idempotent deletion and three side by side KPI cards (Chosen)

Disable the client delete button with a visible spinner during deletion, enforce safe idempotent deletion handling on the server, and replace the single card with three dedicated summary cards matching the sales page design.

**Pros**:
- Completely prevents duplicate deletion attempts from rapid user clicks.
- Matches the familiar sales page summary cards, presenting sales volume, cash collected, and outstanding balances with visual clarity.
- Adapts cleanly to mobile, tablet, and desktop screens with consistent card styling.

**Cons**:
- Requires updating the top metric section layout in `TenantPage.tsx` and adding deletion state management.

## Decision

**Chosen option**: Option 2: Dual layer button locking with backend idempotent deletion and three side by side KPI cards.

We will add an `isSubmittingDelete` state to `TenantPage.tsx` with a loading spinner on the delete button, ensure the backend delete handler handles concurrent requests safely, and replace the single summary card with three separate cards for Total Receivables, Cash Collected, and Remaining Balance.

## Rationale

Rapid clicking on delete buttons is a common pattern in web applications when visual feedback is absent. Disabling the button and rendering a spinner gives immediate user feedback, while backend idempotency guarantees data safety.

Regarding metrics, separating Total Receivables (sales volume), Cash Collected (actual money in hand), and Remaining Balance (unpaid balances) directly reflects how financial teams operate. The sales page already uses this three card standard. Replicating it on the tenant page ensures visual and logical harmony across the application.

## Feature design

**Data model sketch**:
No database schema changes are required. Existing `tenant_leases` and `tenant_lease_payments` tables retain all current columns and relationships.

**State transitions**:
Delete button state:
`Idle` (clickable, red background) -> `Deleting` (disabled, spinner visible, label "Deleting...") -> `Success` (modal closes, lease removed from state, notification broadcast) or `Error` (modal re-enables button, error banner shown).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/tenants/leases/{id} | DELETE | lease_id:int | 204 No Content | Bearer (admin, supervisor, finance) | 401, 403, 404 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Calculate Total Receivables | Sum of totalDue across matching leases | Derived from `filteredTenants.reduce((sum, item) => sum + (financialsById.get(item.id)?.totalDue \|\| 0), 0)` |
| Calculate Cash Collected | Sum of amountPaid across matching leases | Derived from `filteredTenants.reduce((sum, item) => sum + (financialsById.get(item.id)?.amountPaid \|\| 0), 0)` |
| Calculate Remaining Balance | Sum of remaining balance across matching leases | Derived from `filteredTenants.reduce((sum, item) => sum + (financialsById.get(item.id)?.remaining \|\| 0), 0)` |
| Disable delete action | isSubmittingDelete boolean flag | Local React component state in `TenantPage.tsx` |

**Key invariants**:
- Deleting a lease must always delete its associated payments cleanly.
- Rapid repeated clicks on the Delete Lease button must send only one delete HTTP request.
- The three KPI cards must always calculate their values strictly from `filteredTenants` so that period, date range, search query, and status filters apply consistently.

**Security model**:
- Lease deletion remains restricted to authenticated users with supervisor, finance, or admin permissions.
- Audit role remains read only and cannot see or trigger the delete action.

**Critical test scenarios**:
- Happy path deletion: User clicks Delete Lease in the confirmation modal, button shows spinner with "Deleting...", lease is deleted, modal closes, and table updates, verifies **AC-1**.
- Concurrent deletion prevention: User double clicks or triple clicks the delete button rapidly, only one DELETE request is issued, and subsequent clicks are ignored, verifies **AC-1**, **AC-2**.
- KPI metrics accuracy: Filtering by Paid shows Cash Collected matching Total Receivables while Remaining Balance is zero; filtering by Unpaid shows Remaining Balance matching unpaid lease obligations, verifies **AC-3**, **AC-4**.
- Deletion error recovery: When the server returns an error during deletion, the modal remains open, the button re-enables, and an error banner displays, verifies **AC-5**.

## Build plan

1. In `frontend/src/pages/TenantPage.tsx`, introduce `isSubmittingDelete` boolean state and update `handleConfirmDelete` to guard against concurrent submissions (**AC-1**, **AC-5**).
2. Update the delete confirmation modal dialog in `TenantPage.tsx` to bind `disabled={isSubmittingDelete}`, render `<Loader2 className="w-4 h-4 animate-spin shrink-0" />`, and switch label to "Deleting..." (**AC-1**).
3. In `backend/app/services/tenant_service.py` and `backend/app/api/v1/endpoints/tenants.py`, ensure lease deletion handles missing records idempotently without raising unhandled 500 exceptions (**AC-2**).
4. In `frontend/src/pages/TenantPage.tsx`, replace the single composite card with three responsive cards matching `SalesPage.tsx`: Total Receivables with Store icon, Cash Collected with Wallet icon, and Remaining Balance with Receipt icon (**AC-3**, **AC-4**).
5. Verify live behavior, check responsiveness, and run automated backend and frontend test suites (**AC-1**, **AC-2**, **AC-3**, **AC-4**).

## Consequences

**Positive**:
- Eliminates duplicate deletion network requests and race conditions on slow connections.
- Provides immediate visual feedback during lease deletion.
- Standardizes summary metrics across sales and tenant modules, improving user experience and reporting accuracy.

**Negative / tradeoffs**:
- Slightly more vertical space occupied by three cards on narrow mobile screens (handled via responsive grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).

**Neutral**:
- No database migrations or schema adjustments are required.
