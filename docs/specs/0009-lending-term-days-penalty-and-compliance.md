# 0009. Lending Term Days, Penalty Calculation, and Compliance Tracking

**Date**: 2026-10-28
**Status**: Accepted

## Summary

This specification defines the lending terms, automated daily and monthly penalty assessments, compliance tracking, and payment flexibility rules. When creating a loan, loan officers can define the term duration in days with forty days as the standard default and twenty percent as the standard interest rate. The system automatically computes periodic installment targets, derives the final due date, and assesses a flat five percent fee on the periodic target for any missed installment without compounding. Borrowers who remit excess amounts receive advance credit toward upcoming installments, and late recorded payments do not incur penalty fees if the actual transaction date occurred on time.

## Context

Lending operations require predictable repayment cycles, fair penalty rules, and operational flexibility for field collection officers. Previously, loan agreements assumed generic start and due dates without explicit day counts, and the interest rate was set to five percent.

Under the actual operating model, lending facilities typically run for a standard forty days with twenty percent interest. Daily payments divide the total payable evenly across the term. For example, a thirty thousand peso loan with twenty percent interest yields thirty six thousand pesos total payable, requiring nine hundred pesos daily across forty days. If the borrower fails to remit the installment for a scheduled day, a flat five percent fee of forty five pesos is assessed on that missed installment. Similar rules apply to monthly facilities, such as sixty day two month terms with five percent penalties per missed monthly installment.

Loan officers also require flexibility when recording transactions. Operators frequently collect cash in the field and encode the receipts later in the day or on the following morning. The system must not penalize borrowers for late data entry if the payment date matches the schedule. Furthermore, borrowers frequently pay multiple days in advance, so excess remittances must satisfy upcoming installment periods and protect borrowers from unwarranted missed day penalties.

## Requirements

**User stories**:
- As a loan officer, I want to set the loan term duration in days (defaulting to forty days) and have the system calculate the final due date automatically from the start date so that data entry is rapid and error free.
- As a credit administrator, I want the facility creation form to default to twenty percent interest so that standard contracts follow company policy without manual adjustments.
- As a collection officer, I want the system to compute a flat five percent penalty fee on the installment target whenever an installment is missed so that delinquent days incur the correct agreed charges without compounding.
- As a collection officer, I want to record payments made in the field with their real transaction dates without triggering automated penalties so that delayed encoding does not unfairly penalize on time borrowers.
- As a borrower, I want advance payments to cover future installments so that paying ahead protects me from penalties on upcoming scheduled dates.
- As an auditor, I want a tiered compliance status for every borrower (Compliant, Delayed, or Delinquent) so that collection risks are visible immediately.

**Acceptance criteria**:
- **AC-1**: The Add Lending Facility modal provides a Term Days numeric input defaulting to 40 days, and automatically updates the Due Date based on Date Borrowed plus the entered number of days.
- **AC-2**: The default interest rate in the Add Lending Facility modal is set to 20.0 percent.
- **AC-3**: For daily loans, the daily installment target is calculated as total payable divided by term days. Each calendar day with zero payment past its due date incurs a flat penalty equal to 5 percent of the installment target (for example 5 percent of 900 is 45 pesos).
- **AC-4**: For monthly loans, the term days defaults to 60 days (2 months), and missed monthly cycles incur a flat 5 percent penalty on the monthly installment target.
- **AC-5**: Penalties are calculated and added to the loan total payable and remaining balance without compounding on previously accrued penalty fees.
- **AC-6**: Advance remittances credit forward to subsequent installment cycles. If an excess payment covers future days or months, those future dates are marked as paid in advance and never trigger penalties.
- **AC-7**: Late recorded entries use the user specified transaction payment date rather than the system entry timestamp, ensuring payments made on time do not trigger missed status or penalty fees.
- **AC-8**: Every loan displays a dynamic compliance tier: Compliant (zero missed installments), Delayed (one missed installment pending settlement), or Delinquent (two or more missed installments).

## Options considered

### Option 1: Integral penalty accounting with forward cycle crediting and actual payment date evaluation

Implement loan term day inputs in the facility modal with automatic date projection, enforce default 40 days and 20 percent interest, calculate flat 5 percent penalties per missed installment cycle, credit excess payments forward against upcoming installments, evaluate penalties based on recorded transaction dates, and compute a dynamic three tier compliance indicator.

**Pros**:
- Exactly matches the business rules and practical collection reality of field collection officers.
- Protects borrowers who pay in advance while holding delinquent borrowers accountable with fair flat fees.
- Eliminates erroneous penalties caused by delayed data entry.
- Provides immediate visual compliance status for management review.

**Cons**:
- Requires ledger reconciliation logic in LendingService to calculate advance day credits and accumulated penalty amounts.

### Option 2: Separate punitive penalty fee ledger with manual officer penalty waivers

Keep loan duration as static calendar dates, leave interest at previous defaults, and require loan officers to manually apply or waive penalty charges when reviewing delinquent accounts.

**Pros**:
- Gives officers total discretion over penalty fees.

**Cons**:
- High administrative burden on loan officers.
- Prone to inconsistent application of contract terms across borrowers.
- Does not automate 40 day calculations or 20 percent default settings.

## Decision

**Chosen option**: Option 1: Integral penalty accounting with forward cycle crediting and actual payment date evaluation

We implement term duration in days with 40 days standard default, 20 percent default interest, flat 5 percent non compounding penalties on missed installment targets, advance installment crediting, payment date priority for late log protection, and tiered compliance badges.

## Rationale

Option 1 automates standard lending contracts while reflecting the practical workflow of loan officers. Setting 40 days and 20 percent interest reduces repetitive input. Calculating flat 5 percent penalties per missed target enforces contract discipline without usurious compounding. Recognizing transaction payment dates prevents punishing borrowers when officers encode receipts late, and forward crediting honors borrower advance payments.

## Feature design

**Data model sketch**:
The backend service and frontend models are enhanced with term days and penalty tracking fields:
- `term_days`: Integer, default 40 for daily, 60 for monthly
- `penalty_rate`: Numeric(5, 2), default 5.00 percent
- `total_penalties`: Numeric(15, 2), sum of accrued missed installment fees
- `installment_target`: Numeric(15, 2), periodic installment due
- `advance_amount`: Numeric(15, 2), credit balance covering future cycles
- `compliance_status`: String enum ('Compliant', 'Delayed', 'Delinquent')
- `missed_cycles_count`: Integer tracking unfulfilled past cycles

**Compliance Tier Rules**:
- `Compliant`: Zero unpaid cycles up to current date.
- `Delayed`: Exactly one unpaid cycle up to current date.
- `Delinquent`: Two or more unpaid cycles up to current date.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/lending/calculate | POST | principal: float, rate: float (def 20), term_days: int (def 40), frequency: str, start_date: str | total_payable, installment_target, due_date, cycles | bearer | 422 |
| /api/v1/lending/facilities | POST | borrower_name, principal, rate (def 20), term_days (def 40), frequency, start_date, notes | created facility with term days and targets | bearer | 400, 422 |
| /api/v1/lending/ledger/{facility_id} | GET | facility_id: int | facility, ledger_items, compliance_status, total_penalties, advance_credit | bearer | 404 |
| /api/v1/lending/payments | POST | facility_id, payment_date, amount, method, ref, notes | updated remaining balance, advance credit, compliance | bearer | 400, 409, 422 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Project Due Date | Due date string derived from start date and term days | Computed by start date plus term days |
| Accrue Missed Penalty | 5 percent fee per unfulfilled past cycle | Computed as installment target multiplied by 0.05 |
| Advance Credit | Unconsumed funds covering future installment cycles | Computed as cumulative paid minus cumulative due to date |
| Compliance Status | Compliant, Delayed, or Delinquent badge | Derived from count of unpaid past cycles |

**Key invariants**:
- Due date is strictly determined by start date plus term days unless manually overridden.
- Penalty is calculated as a flat 5 percent of the cycle installment target, never compounded on past penalties.
- Payment date entered by the user governs whether a cycle was settled on time, regardless of when the entry was encoded into the database.
- Advance payments reduce pending cycle liabilities sequentially from earliest upcoming to latest.

**Security model**:
- Authenticated loan officers and finance managers can configure term days, record remittances, and log late receipts.
- Auditors have read only visibility into accrued penalties, transaction dates, and compliance tiers.

**Critical test scenarios**:
- Standard daily loan: 30,000 principal at 20 percent interest for 40 days produces 36,000 total payable, 900 daily target, and 45 pesos penalty per missed day, verifies AC-1, AC-2, AC-3.
- Missed day fee: Borrower fails to pay on day 5, ledger adds 45 penalty to total payable, remaining balance becomes 36,045, status marks Delayed, verifies AC-3, AC-5, AC-8.
- Advance payment: Borrower pays 1,800 on day 1, covering day 1 and day 2, day 2 is marked Paid in Advance with zero penalty, verifies AC-6.
- Late data entry: Borrower pays on day 3, officer encodes it on day 5 with payment date day 3, no penalty is assessed for day 3, verifies AC-7.

## Build plan

1. Update backend/app/services/lending_service.py to support term days parameter, default 20 percent interest, automated flat 5 percent penalty calculations, forward cycle advance crediting, and tiered compliance evaluation, satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8.
2. Update backend/app/schemas/lending.py with term_days, total_penalties, advance_amount, and compliance_status fields, satisfies AC-1, AC-8.
3. Update frontend/src/services/lendingService.ts to integrate term days calculations, penalty models, and advance payment indicators, satisfies AC-1, AC-6, AC-8.
4. Update frontend/src/pages/LendingPage.tsx Add Facility modal with Term Days input (default 40), default 20 percent interest, automated Due Date projection, and display compliance badges (Compliant, Delayed, Delinquent) and penalty summaries in the table and detail modal, satisfies AC-1, AC-2, AC-8.

## Consequences

**Positive**:
- Lending workflows match standard company 40 day contracts and 20 percent rates directly out of the box.
- Transparent non compounding penalties prevent debt spiraling while encouraging borrower discipline.
- Field collection staff can encode receipts without fear of triggering unwarranted system penalties.
- Advance payments are credited correctly, fostering borrower trust.

**Negative / tradeoffs**:
- Requires tracking cumulative due versus cumulative paid to derive advance credits and delinquent cycles.

## Migration plan

**Strategy**: In place enhancement with backward compatible defaults
**Phases**:
1. Update backend calculation and repository logic in lending_service.py.
2. Update backend schemas and endpoints.
3. Update frontend service gateway and LendingPage UI components.
**Rollback**: Existing loans without term days continue to calculate based on calendar dates without disruption.
**Risks**: None; all schema changes are additive with defaults.
