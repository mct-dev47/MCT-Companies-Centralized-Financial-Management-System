# Review, spec 0027 receivables lifecycle, 2026-11-03

**Reviewed by**: Gemini 3.8 Pro (author on Gemini 3.8 Flash)
**Scope**: 18 files, uncommitted changes
**Verdict**: Approve with nits

## Summary
The change introduces dedicated database tables and real time WebSocket updates for food receivables and unpaid expense life cycles, satisfying core requirements of spec 0027. The earlier blockers causing runtime errors on expense submission and unwanted payroll deduction triggers during FIFO cash payments have both been fixed and verified. The backend service architecture and database models are sound, role checks restrict edit and delete actions strictly to Finance users, and both the production build and test suites pass cleanly.

## Major
### 🟠 Bidirectional sync on deletion and updates omits particulars text update, `backend/app/services/receivables_service.py:412`
**Problem**: When a receivable linked to a source sale or expense (`rec.sale_id` or `rec.expense_id`) is modified or deleted, the service updates `s.amount` or `e.amount`, but leaves the stored itemized particulars text untouched.
**Why it matters**: The particulars string will still display the old or deleted items even though the monetary amount changed, creating a mismatch between the text breakdown and the financial total.
**Suggested fix**: Update the particulars string on the linked sale or expense record when amounts change, or record an audit adjustment note.

### 🟠 Bank account check prevents recording cash expenses without clear guidance, `frontend/src/pages/AddTransactionSheetPage.tsx:749`
**Problem**: Line 749 halts submission if `!isPettyCash && currentCompanyBanks.length === 0`, requiring a bank account associated with the company even when the chosen payment method is Cash.
**Why it matters**: Users recording cash expenses for companies without registered bank accounts receive an error and cannot proceed.
**Suggested fix**: Allow cash payment methods to proceed without a mandatory bank account selection, or display clear inline guidance to configure bank accounts first.

## Minor
### 🟡 Potential double count of realized cash collections in SalesPage, `frontend/src/pages/SalesPage.tsx:620`
**Problem**: Line 620 adds `receivablesKpis.cashCollected` directly to `cashTotal`.
**Why it matters**: If receivable payments are deposited to a bank account and also logged as general cash inflows, adding them here may double count total cash on hand.
**Suggested fix**: Verify whether recorded payments already contribute to cash inflows before adding them to `totalCash`.

## Strengths
- Dedicated database models and cascading foreign keys for receivables and payment history.
- Strong role authorization restricting edit and delete operations strictly to Finance users with HTTP 403 enforcement.
- Instant multi tab synchronization via WebSocket event broadcasting on all mutations.
- Clean handover between expense encoding and sales unpaid assignment when unpaid line items are recorded.

## Test coverage
- Backend coverage is solid with 4 tests in `backend/tests/test_spec_0027.py` verifying balance logic, payment limits, and Finance role restrictions.
- Frontend production bundle builds cleanly in Vite with zero compilation errors.
