# 0035. Tenant Audit Review and Lease Refinements: Rationale

## Context

The centralized financial system manages commercial stall and unit tenant leases for JK Property and Ventures alongside lending facilities for FilCap. In earlier iterations, lending facilities received a dedicated Audit Review panel displaying the auditor name, timestamp, and audit findings directly in the borrower details summary. The Tenant Details view lacked this dedicated panel, showing only partial audit badges in the header without a unified findings container.

Furthermore, several operational gaps existed across tenant workflows:
First, the Record Payment modal permitted freeform input without validating future payment dates or requiring payment methods, while remarks lacked a character boundary.
Second, the Edit Tenant Lease modal permitted altering rent amounts, contract dates, and payment schedules even after payments were logged, risking financial discrepancy between the payment ledger and lease terms.
Third, the New Tenant Lease modal offered seldom used schedule frequencies (Does not repeat, Quarterly, Annually), presented a cluttered layout with dates separated across different form sections, contained an unused Late Penalty field, and showed a redundant schedule calculation box.

Standardizing the tenant view to match FilCap lending patterns and strengthening form validation ensures consistent data hygiene and prevents inadvertent ledger tampering.

## Options considered

### Option 1: Minimal Frontend Validation Only

Add character counters and frontend validation without locking edited lease terms or standardizing the audit card layout.

**Pros**:
- Fastest to implement with minimal changes to form state.
- No impact on existing editing workflows.

**Cons**:
- Leaves leases vulnerable to retroactive tampering when payments are already recorded.
- Fails to provide visual parity with FilCap Lending audit reviews.
- Keeps cluttered lease creation layouts with redundant options and unused fields.

### Option 2: Unified Full Stack Alignment (Chosen)

Implement the dedicated Audit Review card matching FilCap Lending, lock core lease terms when payment transactions exist, simplify payment schedules strictly to Daily and Monthly, remove late penalty and repeat summary boxes, realign date inputs into a balanced grid, and enforce strict input validation across payment and lease forms.

**Pros**:
- Establishes complete visual consistency between FilCap Lending and JK Property tenant lease views.
- Protects historical payment integrity by locking core contract terms once transactions exist.
- Enforces standardized, clean payment remarks capped at 50 characters with required payment method selection while keeping reference numbers optional.
- Streamlines the lease creation workflow into a clean, modern form with immediate field validation.
- Verifies database schema columns and guarantees all data originates directly from Supabase.

**Cons**:
- Requires coordinating form layout updates, repeat option mappings, and validation state across shared modals and tenant components.

## Rationale

Option 2 delivers a robust and cohesive solution across the entire tenant workflow.

Matching the FilCap Lending audit card provides immediate familiarity for supervisors and auditors. Rather than searching through disparate headers, reviewers find audit status, reviewer attribution, timestamps, and findings in the exact same panel location across both lending and commercial leasing modules.

Locking contract terms once payments are made is an essential internal control. If rent amounts, payment schedules, or contract dates change after payments are logged, historical balances and aging schedules become unreliable. Restricting those fields to read only mode once payments exist safeguards ledger accuracy while still allowing updates to lessee names, unit numbers, and general notes.

Simplifying the payment schedule to Daily and Monthly eliminates confusing edge cases from quarterly and annual frequencies that commercial stalls do not use. Removing the unused Late Penalty field and the redundant calculation box declutters the dialog, while placing Date Contracted, Lease End Date, First Due Date, and Status in a balanced two column grid creates an intuitive, error free creation flow.

