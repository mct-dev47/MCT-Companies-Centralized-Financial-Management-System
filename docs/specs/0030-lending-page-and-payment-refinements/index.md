# 0030. Refine Lending Page Tables and Payment Validation

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This specification refines the Lending Page and Lending Details view to maximize visual clarity and data density. It removes the Date Borrowed and Due Date columns from the main lending table while preserving them in export files, strips outline borders from status indicators and audit tags, displays auditor initials and last name in a two line compact format, wraps long remarks with flexible row height in payment history, introduces a dedicated Created By column for payment transactions, and adds strict validation with character counters to the payment modal. These changes make lending records faster to scan and less prone to input mistakes.

## Requirements

**User stories**:
- As a finance officer, I want more horizontal space in the lending table so that borrower names and monetary amounts are easily readable without clipping.
- As an auditor or finance manager, I want status badges and audit tags to look clean and show the auditor identity directly in the row so that accountability is clear at a glance.
- As a collections officer reviewing payment history, I want long remarks to wrap across multiple lines and see who recorded each payment so that complete audit notes are visible.
- As a cashier recording a payment remittance, I want clear required markers and a fifty character limit on remarks so that payment records stay concise and consistent.

**Acceptance criteria**:
- **AC-1**: The main Lending table removes the `Date Borrowed` and `Due Date` columns from the screen view, redistributing the table column widths to borrower name, payable amounts, and status.
- **AC-2**: The `Date Borrowed` and `Due Date` fields remain fully intact in CSV and Excel export functions, retaining complete audit trails for reporting.
- **AC-3**: Status displays in both the Lending table and the Payment Schedule and History table render as clean colored text without pill borders and without background boxes.
- **AC-4**: In the Audit Tag column, the tag outline border is removed, displaying a two line compact layout with the audit state and formatted auditor name (for example, `Audited · V. Masiglat`) on the first line and the timestamp on the second line.
- **AC-5**: In the Payment Schedule and History table, the remarks column wraps long text with flexible row height instead of single line truncation with ellipsis.
- **AC-6**: A new `CREATED BY` column is added as the rightmost column in the Payment Schedule and History table, displaying the creator formatted as first name initial and last name (for example, `P. Tayam`), with a clean dash for historical records lacking creator metadata.
- **AC-7**: In the Record Payment modal, Payment Method displays a red asterisk indicating it is required while defaulting to `Cash`, and the Remarks field displays a real time character counter (for example, `0/50`) with a hard `maxLength` of 50 characters and form submission validation.

## Decision

**Chosen option**: Option 1: Fix in place targeted enhancements.

We will update the table columns, remove borders, add auditor and creator initials formatting, wrap remarks, and enforce the 50 character limit in place.

## Feature design

**Name formatting rule**:
A shared formatting function converts a full user name to the first initial and last name pattern:
```typescript
export function formatPersonInitialAndLastName(fullName?: string | null): string {
  if (!fullName || !fullName.trim()) return '—'
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  const firstInitial = parts[0][0].toUpperCase()
  const lastName = parts[parts.length - 1]
  return `${firstInitial}. ${lastName}`
}
```
For example:
- `Victoria Masiglat` becomes `V. Masiglat`
- `Princess Tayam` becomes `P. Tayam`
- `Mary Jane Watson` becomes `M. Watson`

**Data model sketch**:
Frontend `DailyPaymentRecord`:
```typescript
export interface DailyPaymentRecord {
  // Existing fields ...
  recordedBy?: string
  recorded_by?: string
}
```
Backend `LendingTransaction`:
```python
class LendingTransaction(Base):
    # Existing columns ...
    recorded_by = Column(String(255), nullable=True)
```

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/lending/payments` | POST | `borrower_id`, `amount`, `payment_date`, `method`, `notes` (max 50 chars), `recorded_by` | transaction object with `recorded_by` | BusinessWriter | 400, 404, 409 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| View lending table | Borrower status text | Derived from `facility.status`, rendered as colored borderless text |
| View lending table | Auditor name in Audit Tag | Derived from `facility.auditedBy` via name formatting helper |
| View payment history | Status text | Derived from payment status, rendered as colored borderless text |
| View payment history | Remarks cell | Read from `p.notes`, rendered with word break and flexible row height |
| View payment history | Created By column | Read from `p.recorded_by` or `p.recordedBy` via name formatting helper |
| Submit payment | Payment method | Form input, defaulted to Cash, required |
| Submit payment | Remarks validation | Form input, capped at 50 characters with live counter |
| Submit payment | Created by metadata | Captured from active user session (`user.fullName`) and passed to backend |

**Key invariants**:
- Removing columns from the screen table must not remove them from CSV or Excel file generation.
- Remarks cannot exceed 50 characters when submitted.
- Payment method cannot be submitted as an empty string.
- Historical payments without creator metadata display an em dash placeholder without errors.

**Security model**:
Only users with BusinessWriter permissions can record payments. Auditor tags remain viewable and editable only by users with Auditor role permissions.

**Critical test scenarios**:
- Main table rendering: Verify Date Borrowed and Due Date are gone from screen, table spans full width, and status text has no border, verifying **AC-1** and **AC-3**.
- CSV export check: Verify exported CSV still includes Date Borrowed and Due Date columns, verifying **AC-2**.
- Audit tag display: Verify audited loans show borderless label with `Audited · <Initial. LastName>` and timestamp underneath, verifying **AC-4**.
- Payment remarks wrapping: Verify long remarks wrap gracefully without horizontal table blowout and row height expands, verifying **AC-5**.
- Created by column: Verify payment history shows `CREATED BY` column with creator initials and last name, verifying **AC-6**.
- Modal validation: Verify Payment Method has red asterisk, Remarks has live character counter at 50 maximum, and typing past 50 is blocked, verifying **AC-7**.

## Build plan

- [x] 1. Create backend database column `recorded_by` on `lending_transactions` table and update lending schemas, service, and endpoints to persist and return it, satisfies **AC-6**.
- [x] 2. Add name formatting helper `formatPersonInitialAndLastName` in frontend utilities, satisfies **AC-4**, **AC-6**.
- [x] 3. Update main Lending table in `LendingPage.tsx` to remove Date Borrowed and Due Date columns, adjust colgroup percentages, and preserve export logic, satisfies **AC-1**, **AC-2**.
- [x] 4. Update Status and Audit Tag cells in `LendingPage.tsx` to remove outline borders and display compact two line auditor format, satisfies **AC-3**, **AC-4**.
- [x] 5. Update Payment Schedule and History table in `LendingPage.tsx` to remove status borders, enable text wrapping on remarks, and append the `CREATED BY` column, satisfies **AC-3**, **AC-5**, **AC-6**.
- [x] 6. Update Record Payment modal in `LendingPage.tsx` with red asterisk on Payment Method, 50 character limit with live counter on Remarks, and submission payload sending user full name, satisfies **AC-7**.

## Consequences

**Positive**:
- Significant increase in usable horizontal space for borrower records.
- Visually clean interface without heavy boxed borders cluttering status cells.
- Direct attribution for loan audits and payment receipts.
- Prevention of overly verbose remarks that degrade reporting layout.

**Negative / tradeoffs**:
- Quick dates on the main table require either opening the details view or viewing export sheets.

**Neutral**:
- Older payments recorded prior to this change will display an em dash in the Created By column.

## Follow-up

- [x] Run `/develop` to implement these refinements across backend and frontend files.
- [ ] Verify responsive layout across tablet and desktop viewports.

## Migration plan

**Strategy**: Direct additive migration.
**Phases**:
1. Add nullable column `recorded_by` to `lending_transactions` in backend database and SQLite fallback.
2. Deploy backend service and frontend page updates simultaneously.
**Rollback**: The column is nullable, so rolling back frontend changes requires zero database changes.
**Risks**: None. Existing records continue to work seamlessly with fallback dashes.

