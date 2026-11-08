# 0038. Petty Cash Excess Reimbursements and Intercompany Funding

**Date**: 2026-11-08
**Status**: Accepted

## Summary

This specification establishes an industry grade petty cash excess reimbursement and intercompany funding architecture. It resolves the dual funding structure where an expense is paid partially with company petty cash and partially out of pocket by an employee. The design introduces strict petty cash fund reservation under database locks for unrecorded spending, distinguishes pre-recorded expenses from unrecorded receipts, enforces a unified finalization lifecycle, establishes database level links and unique constraints, implements safe two step financial reversals for cancelled bank transfers, and invalidates approvals when funding sources change.

## Context

In standard business operations, an employee incurs legitimate business expenses totaling 8,000 pesos. The employee pays 5,000 pesos using the company petty cash float and 3,000 pesos out of pocket using personal money. The employee is entitled to be reimbursed solely for their 3,000 pesos personal out of pocket expenditure, while the company books must recognize the entire 8,000 pesos as business expenses.

To implement this reliably, the system must address five specific technical boundaries:
1. **Pre-recorded Expenses versus Unrecorded Cash Spending**: If the 5,000 pesos was already entered into the `expenses` table as a Petty Cash expense, it has already been deducted from the petty cash wallet balance. Reserving or deducting it a second time would understate available cash. The system must distinguish pre-recorded expenses (linked via `existing_expense_id`, no reservation hold, no second deduction) from unrecorded receipts (which reserve unallocated float under lock and are finalized once).
2. **Unified Lifecycle Timing**: Both zero excess claims ($O = 0$) and positive excess claims ($O > 0$) must be finalized at the same execution phase by Finance. Zero excess claims execute a finalization settlement that registers the petty cash expense without bank payout. If a zero excess claim links an already recorded expense, finalization reuses the existing record without creating a new expense or duplicate deduction.
3. **Transactional Reservation Coordinated Across All Operations**: Active pending claims place a reservation hold against the company's unreserved petty cash balance. All operations affecting petty cash (expense creation, top ups, reservations, settlements) coordinate under database locks (`PettyCashWallet` row lock via `SELECT FOR UPDATE` on PostgreSQL; `BEGIN IMMEDIATE` write transaction on SQLite).
4. **Database Migration & History Protection**: PostgreSQL and SQLite use engine specific migrations. Unique constraints are enforced via partial unique indexes (`WHERE reference_no IS NOT NULL`), avoiding errors with null references or existing legacy records. Pre-flight checks detect any historical duplicate references before index creation.
5. **Two Phase Transfer Cancellation & Approval Invalidation**: Cancelling an in transit transfer sets status to `RETURN_PENDING`. Bank B is credited only when the return deposit is confirmed via `confirm-reversal`, linking the original withdrawal. Material changes to funding bank or payment method invalidate previous approvals and mandate re-approval by Audit.
6. **Internal Ledger Authority**: The system functions as an authoritative internal financial ledger. Bank transactions record confirmed movements executed by Finance through banking portals or checks, enforced by database level idempotency keys.

## Requirements

**User stories**:
- As an employee or supervisor, I want to submit an expense reimbursement claim detailing total expenses, the amount paid from company petty cash, and the amount I paid out of pocket, so that I receive reimbursement strictly for my personal expenditures.
- As a Finance officer, I want the system to reserve petty cash funds under database locks for unrecorded expenses, avoid double deductions for pre-recorded expenses, select an authorized source bank, and execute live payouts only after audit approval.
- As an Auditor, I want to review the full expense breakdown, receipt evidence, bank selection, and intercompany funding method before approving the claim.
- As a Finance officer, I want cancelled in transit transfers to post actual bank reversal transactions only upon confirmed return, and intercompany liabilities to remain tracked until explicit repayment is recorded.

**Acceptance criteria**:
- **AC-1**: When an employee submits a claim, they provide total business expenses ($E$, e.g. 8,000.00), amount paid from company petty cash ($C$, e.g. 5,000.00), optional `existing_expense_id` (if the 5,000.00 was already entered in the Expense module), expense date, category, description, optional itemized lines, and receipts. The system computes employee out of pocket ($O = E - C$, e.g. 3,000.00) using decimal arithmetic. Submissions with $E \le 0$, $C < 0$, or $C > E$ are rejected with 422.
- **AC-2**: **Reservation Logic & Pre-Recorded Expense Validation**:
  - If `existing_expense_id` is provided, the backend validates under lock:
    1. The linked expense exists, belongs to the requesting company, has `payment_method = 'Petty Cash'`, and has `currency = 'PHP'`.
    2. The linked expense amount exactly equals $C$ (`expense.amount == C`).
    3. The linked expense is not voided or rejected, and is not already linked to another claim (`expense.linked_topup_id IS NULL`).
    Because this expense is already deducted from the ledger balance, `reserved_amount` is set to 0.00. No wallet reservation hold is placed, and no second wallet deduction occurs.
  - If `existing_expense_id` is null (unrecorded cash spending), the backend coordinates under lock and validates:
    $$C \le B_{\text{unreserved}} = B_{\text{ledger}} - \sum(\text{reserved\_amount of active pending claims})$$
    where active pending claims are those in `Pending Finance Endorsement`, `Pending Audit Approval`, `Approved`, or `Transfer In Transit`. The claim sets `reserved_amount = C`, placing a reservation hold until finalization, rejection, or cancellation.
- **AC-3**: **Single Idempotent Expense Recognition**: Expense recognition occurs at the **Finalization / Execution** phase:
  - If `existing_expense_id` is null: the system creates two linked records with partial unique constraints:
    1. A petty cash expense of $C$ (5,000.00) with `payment_method = 'Petty Cash'` and `reference_no = 'PC-EXP-<topup_id>'`.
    2. A reimbursement expense of $O$ (3,000.00) with `payment_method = 'Bank Reimbursement'` and `reference_no = 'REIMB-<topup_id>'`.
  - If `existing_expense_id` was provided: the system updates the existing expense with `linked_topup_id` and creates only the reimbursement expense of $O$ (3,000.00) with `reference_no = 'REIMB-<topup_id>'`.
- **AC-4**: **Zero Excess Finalization**: For zero excess claims ($E = 5,000.00, C = 5,000.00, O = 0.00$), Audit approval transitions the claim to `Approved`. Finance clicks `Finalize Settlement`:
  - If `existing_expense_id` was provided: reuses the existing expense, updates its `linked_topup_id`, creates no new expense row, releases any reservation, and sets status to `Settled`.
  - If `existing_expense_id` is null: atomically creates `PC-EXP-<topup_id>` (5,000.00), releases the reservation hold, settles the wallet, and sets status to `Settled` without bank payout.
- **AC-5**: Regular employees only see the `Submit Reimbursement` action. The `Top-up Request` action is hidden for regular employees and retained for Admin, Finance, and Supervisors.
- **AC-6**: Finance reviews the claim, verifies the funding breakdown against receipts, and selects the funding bank account. The source bank defaults to an eligible account belonging to the requesting company. If Finance rejects the claim (`action="reject"`), bank selection is not required and any reservation hold is released.
- **AC-7**: When the selected source bank belongs to the requesting company, cross company payment method fields are hidden. When the selected source bank belongs to an affiliate company, Finance must select either `Direct Payment to Employee` (Method A) or `Transfer to Requesting Company's Bank First` (Method B). Method B requires choosing an eligible destination bank of the requesting company.
- **AC-8**: Auditor review requires an approval or disapproval decision with remarks. Approval transitions the claim to `Approved` but does not disburse bank funds.
- **AC-9**: For own company bank funding or Method A (Direct Payment), Finance clicking `Reimburse` executes an atomic withdrawal of $O$ (3,000.00) from the selected bank within a single database transaction, creates the expense records, updates claim status to `Reimbursed`, and sets `amount_reimbursed = O`. In Method A, an `intercompany_transfers` record is created in `transfer_status = 'NOT_APPLICABLE'` and `settlement_status = 'UNSETTLED'`.
- **AC-10**: For Method B (Transfer First):
  1. Finance clicks `Initiate Transfer`: withdraws $O$ (3,000.00) from Company B bank, records `BankTransaction` (`tx_id` saved in `source_bank_tx_id`), sets `transfer_status = 'IN_TRANSIT'`.
  2. Company A clicks `Confirm Transfer Received`: deposits $O$ (3,000.00) into Company A bank, records `BankTransaction` (`tx_id` saved in `destination_bank_tx_id`), sets `transfer_status = 'RECEIVED'`. The liability remains `settlement_status = 'UNSETTLED'`.
  3. Finance clicks `Reimburse`: withdraws $O$ (3,000.00) from Company A bank to pay the employee, finalizes the expense records, releases reservation holds, and marks the claim `Reimbursed`. If payout fails, funds remain in Company A with status `RECEIVED`, permitting safe retry without duplicating transfers.
- **AC-11**: **Two Phase Transfer Cancellation & Financial Reversal**:
  - If an in transit transfer is cancelled before receipt via `cancel-transfer`: status transitions to `transfer_status = 'RETURN_PENDING'`. Bank B's balance is NOT credited at this stage.
  - When the return of funds is verified via `confirm-reversal`: the system posts an actual reversal deposit of $O$ (3,000.00) to Company B bank account (`BankTransaction` category: `'Intercompany Transfer Reversal'`, reference: `'REV-<reference_no>'`), updates `transfer_status = 'CANCELLED'`, and invalidates previous approvals.
  - Cancellation is strictly forbidden if `transfer_status` is `RECEIVED` or claim is `Reimbursed`.
  - All transfer attempts remain preserved in `intercompany_transfers` table; `petty_cash_topups.intercompany_transfer_id` always points to the current active attempt.
- **AC-12**: **Re-approval on Material Funding Changes**: If a transfer is cancelled or Finance changes the source bank or payment method after endorsement or approval, any previous Audit approval is automatically invalidated. The claim status resets to `Pending Finance Endorsement`, requiring Finance re-endorsement and fresh Audit approval before any disbursement can occur.
- **AC-13**: **Intercompany Repayment & Settlement Validation**: When Company A repays Company B, calling `/intercompany-transfers/{id}/settle`:
  - Validates that `settlement_status == 'UNSETTLED'` and `transfer_status` is `NOT_APPLICABLE` (Method A) or `RECEIVED` (Method B). Cancelled or pending transfers cannot be settled.
  - Validates that repayment amount equals the outstanding liability.
  - Validates that source bank belongs to Company A and destination bank belongs to Company B.
  - Executes an atomic withdrawal from Company A bank (`repayment_source_bank_tx_id`) and atomic deposit into Company B bank (`repayment_destination_bank_tx_id`).
  - Transitions `settlement_status` to `'SETTLED'` and records `settled_at` and `repaid_by`.
- **AC-14**: Bank balances are revalidated under row locks immediately prior to any withdrawal or transfer out. If available funds are insufficient, the transaction fails with a clear error and no partial records are written.
- **AC-15**: **Idempotency Protection**: Execution endpoints (`reimburse`, `finalize-settlement`, `transfer`, `confirm-transfer`, `cancel-transfer`, `confirm-reversal`, `settle`) require an `Idempotency-Key`. Retries of committed transactions return the existing result with HTTP 200 without executing duplicate movements.

## Options considered

### Option 1: Reservation under database locks, pre-recorded expense deduplication, and two-phase reversal with re-approval (Chosen)

Differentiate pre-recorded expenses from unrecorded receipts, enforce transactional reservation holds under wallet locks, split unrecorded expenses into petty cash and reimbursement records, post real reversal transactions upon confirmed return, and invalidate approvals when funding sources change.

**Pros**:
- Completely eliminates double counting and double deductions.
- Prevents race conditions where two employees claim the same petty cash float.
- Enforces an identical finalization lifecycle point for zero excess and positive excess claims.
- Guarantees financial ledger integrity: money that left a bank account is restored via an actual reversal deposit transaction upon confirmed return.
- Eliminates compliance risk: changing funding sources requires fresh Audit approval.

**Cons**:
- Slightly more detailed state machine for transfer cancellation (`IN_TRANSIT` -> `RETURN_PENDING` -> `CANCELLED`).

### Option 2: Blind balance checking at execution without reservation

Check balance only at submission and again at final reimbursement without reserving funds in between.

**Pros**:
- Avoids implementing reservation hold logic.

**Cons**:
- Fails when multiple employees submit claims concurrently: the second claim will be endorsed and approved, only to fail unexpectedly at final payout.

### Option 3: Immediate balance refund on transfer cancellation without verified return

Credit Bank B immediately when Finance clicks cancel, without verifying that funds were actually returned.

**Pros**:
- Single click cancellation.

**Cons**:
- Severe financial vulnerability: allows funds to be spent twice if the transfer has already left the bank.

## Decision

**Chosen option**: Option 1: Reservation under database locks, pre-recorded expense deduplication, and two-phase reversal with re-approval.

This solution guarantees complete financial correctness, audit traceability, and database safety.

**Implementation skills**: `develop` (`.agents/skills/develop/`), `security-audit` (`.agents/skills/security-audit/`)

## Rationale

Physical cash and bank balances are real world assets. A database must never assume an asset is available without an active reservation hold. Differentiating pre-recorded expenses prevents duplicate deductions while recognizing unrecorded receipts ensures that every peso is captured. Requiring confirmed return before restoring bank balances prevents ledger phantom funds, and invalidating approvals upon funding changes preserves strict audit governance.

## Feature design

### Data model sketch

1. `petty_cash_wallets` (ensured existence per company):
   - `wallet_id`: `BIGSERIAL PRIMARY KEY` (PostgreSQL) / `INTEGER PRIMARY KEY AUTOINCREMENT` (SQLite)
   - `company_id`: `BIGINT NOT NULL UNIQUE REFERENCES company(company_id)`
   - `low_balance_threshold`: `NUMERIC(15, 2) NOT NULL DEFAULT 1000.00`
   - *Note: Wallet row is locked via `SELECT FOR UPDATE` on PostgreSQL; on SQLite, `BEGIN IMMEDIATE` ensures single writer database lock.*

2. `petty_cash_topups` (existing table extended via migration):
   - `total_expenses`: `NUMERIC(15, 2) NULL` (gross expenses incurred, e.g. 8,000.00)
   - `company_funded_amount`: `NUMERIC(15, 2) NULL DEFAULT 0.00` (amount paid from company petty cash, e.g. 5,000.00)
   - `employee_out_of_pocket`: `NUMERIC(15, 2) NULL DEFAULT 0.00` (amount paid personally by employee, e.g. 3,000.00)
   - `reserved_amount`: `NUMERIC(15, 2) NULL DEFAULT 0.00` (active reservation hold on wallet float; 0.00 if pre-recorded)
   - `amount`: `NUMERIC(15, 2) NOT NULL` (net reimbursement payout owed to employee, equals `employee_out_of_pocket`)
   - `amount_reimbursed`: `NUMERIC(15, 2) NOT NULL DEFAULT 0.00` (amount actually disbursed to employee)
   - `existing_expense_id`: `BIGINT NULL REFERENCES expenses(expense_id)` (set if petty cash expense was pre-recorded)
   - `petty_cash_expense_id`: `BIGINT NULL REFERENCES expenses(expense_id)` (linked 5,000.00 expense record)
   - `reimbursement_expense_id`: `BIGINT NULL REFERENCES expenses(expense_id)` (linked 3,000.00 expense record)
   - `payment_method_option`: `VARCHAR(50) NULL` (`direct` or `transfer_first`)
   - `destination_bank_id`: `VARCHAR(100) NULL REFERENCES bank_accounts(id)`
   - `intercompany_transfer_id`: `BIGINT NULL REFERENCES intercompany_transfers(transfer_id)`
   - `reimbursed_at`: `TIMESTAMPTZ NULL` (PostgreSQL) / `DATETIME NULL` (SQLite)
   - `reimbursed_by`: `VARCHAR(150) NULL`
   - `transfer_received_at`: `TIMESTAMPTZ NULL` (PostgreSQL) / `DATETIME NULL` (SQLite)
   - `transfer_received_by`: `VARCHAR(150) NULL`

3. `expenses` (existing table constraints & indexes added):
   - Unique partial index: `CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_reference_no ON expenses(reference_no) WHERE reference_no IS NOT NULL;`
   - `linked_topup_id`: `BIGINT NULL REFERENCES petty_cash_topups(topup_id)`
   - Unique partial index on pre-records: `CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_existing_expense_id ON petty_cash_topups(existing_expense_id) WHERE existing_expense_id IS NOT NULL;`

4. `intercompany_transfers` (new table):
   - `transfer_id`: `BIGSERIAL PRIMARY KEY` (PostgreSQL) / `INTEGER PRIMARY KEY AUTOINCREMENT` (SQLite)
   - `source_company_id`: `BIGINT NOT NULL REFERENCES company(company_id)` (funding company, e.g. Company B)
   - `destination_company_id`: `BIGINT NOT NULL REFERENCES company(company_id)` (requesting company, e.g. Company A)
   - `source_bank_id`: `VARCHAR(100) NOT NULL REFERENCES bank_accounts(id)`
   - `destination_bank_id`: `VARCHAR(100) NULL REFERENCES bank_accounts(id)`
   - `source_bank_tx_id`: `VARCHAR(100) NULL REFERENCES bank_transactions(id)` (withdrawal from Bank B)
   - `destination_bank_tx_id`: `VARCHAR(100) NULL REFERENCES bank_transactions(id)` (deposit into Bank A)
   - `reversal_bank_tx_id`: `VARCHAR(100) NULL REFERENCES bank_transactions(id)` (reversal deposit to Bank B if cancelled)
   - `repayment_source_bank_tx_id`: `VARCHAR(100) NULL REFERENCES bank_transactions(id)` (withdrawal from Bank A on repayment)
   - `repayment_destination_bank_tx_id`: `VARCHAR(100) NULL REFERENCES bank_transactions(id)` (deposit to Bank B on repayment)
   - `linked_topup_id`: `BIGINT NULL REFERENCES petty_cash_topups(topup_id)`
   - `amount`: `NUMERIC(15, 2) NOT NULL`
   - `transfer_type`: `VARCHAR(50) NOT NULL` (`reimbursement_direct` or `reimbursement_transfer_first`)
   - `reference_no`: `VARCHAR(100) NOT NULL UNIQUE` (pattern: `ICT-YYYYMMDD-XXXX`)
   - `transfer_status`: `VARCHAR(50) NOT NULL DEFAULT 'NOT_APPLICABLE'` (`NOT_APPLICABLE`, `IN_TRANSIT`, `RETURN_PENDING`, `RECEIVED`, `CANCELLED`)
   - `settlement_status`: `VARCHAR(50) NOT NULL DEFAULT 'UNSETTLED'` (`UNSETTLED`, `SETTLED`)
   - `initiated_by`: `VARCHAR(150) NOT NULL`
   - `initiated_at`: `TIMESTAMPTZ NOT NULL DEFAULT NOW()` (PostgreSQL) / `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` (SQLite)
   - `received_by`: `VARCHAR(150) NULL`
   - `received_at`: `TIMESTAMPTZ NULL` (PostgreSQL) / `DATETIME NULL` (SQLite)
   - `settled_at`: `TIMESTAMPTZ NULL` (PostgreSQL) / `DATETIME NULL` (SQLite)
   - `repaid_by`: `VARCHAR(150) NULL`
   - `notes`: `TEXT NULL`

### State transitions

- Request Submission: `Pending Finance Endorsement` (places reservation hold `reserved_amount` if unrecorded)
- Finance Endorsement: `Pending Audit Approval` (revalidates reservation, stores funding bank)
- Funding Change (Post Approval): Resets status to `Pending Finance Endorsement` (invalidates approval; requires fresh re-endorsement and Audit approval)
- Audit Approval: `Approved` (reservation holds; ready for execution)
- Execution (Zero Excess): `Settled` (releases reservation, inserts or reuses 5,000.00 petty cash expense, no bank movement)
- Execution (Own Bank or Method A Direct): `Reimbursed` (releases reservation, inserts expenses, pays employee)
- Execution (Method B Step 1): `Transfer In Transit` (Company B bank debited, `transfer_status = 'IN_TRANSIT'`)
- Execution (Method B Cancellation Requested): `Return Pending` (`transfer_status = 'RETURN_PENDING'`; Bank B balance remains debited)
- Execution (Method B Reversal Confirmed): `Pending Finance Endorsement` (reversal deposit posted to Company B bank, `transfer_status = 'CANCELLED'`; previous approval invalidated)
- Execution (Method B Step 2): `Transfer Received` (Company A bank credited upon manual confirmation, `transfer_status = 'RECEIVED'`)
- Execution (Method B Step 3): `Reimbursed` (releases reservation, inserts expenses, Company A bank pays employee)

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/petty-cash/reimbursements` | POST | total_expenses, company_funded_amount, existing_expense_id, expense_date, company, paid_by, category, description, items, attachments | PettyCashTopUpOut | Supervisor, Finance, Admin | 422 insufficient unreserved petty cash, 422 existing expense mismatch |
| `/api/v1/petty-cash/topups/{id}/endorse` | POST | action, remark, bank_account_id (optional on reject), payment_method_option, destination_bank_id | PettyCashTopUpOut | Finance, Admin | 422 missing bank, 422 missing payment method for cross company |
| `/api/v1/petty-cash/topups/{id}/review` | POST | action, remark | PettyCashTopUpOut | Audit, Auditor, Admin | 400 already processed, 422 missing remark |
| `/api/v1/petty-cash/topups/{id}/finalize-settlement` | POST | notes (optional) | PettyCashTopUpOut | Finance, Admin | 400 not zero excess, 400 wrong status |
| `/api/v1/petty-cash/topups/{id}/reimburse` | POST | notes (optional) | PettyCashTopUpOut | Finance, Admin | 400 insufficient bank funds, 400 wrong status, 409 already reimbursed |
| `/api/v1/petty-cash/topups/{id}/transfer` | POST | notes (optional) | PettyCashTopUpOut | Finance, Admin | 400 insufficient bank funds, 400 not transfer first |
| `/api/v1/petty-cash/topups/{id}/confirm-transfer` | POST | notes (optional) | PettyCashTopUpOut | Finance, Admin, Supervisor (receiving co) | 400 transfer not in transit |
| `/api/v1/petty-cash/topups/{id}/cancel-transfer` | POST | reason (required) | PettyCashTopUpOut | Finance, Admin | 400 transfer already received or not in transit |
| `/api/v1/petty-cash/topups/{id}/confirm-reversal` | POST | verification_notes | PettyCashTopUpOut | Finance, Admin | 400 transfer not in return pending |
| `/api/v1/petty-cash/intercompany-transfers` | GET | company_id, settlement_status | List[IntercompanyTransferOut] | Finance, Admin, Audit | 401 unauthorized |
| `/api/v1/petty-cash/intercompany-transfers/{id}/settle` | POST | source_bank_id (Company A), destination_bank_id (Company B), notes | IntercompanyTransferOut | Finance, Admin | 400 insufficient funds, 400 already settled, 422 invalid banks |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Submit Reimbursement | total_expenses | Client input param $E$ |
| Submit Reimbursement | company_funded_amount | Client input param $C$ |
| Submit Reimbursement | reserved_amount | Set to $C$ if `existing_expense_id` is null; set to 0.00 if `existing_expense_id` is provided |
| Submit Reimbursement | employee_out_of_pocket | Computed backend formula: $E - C$ |
| Submit Reimbursement | amount | Set equal to employee_out_of_pocket ($O$, e.g. 3,000.00) |
| Submit Reimbursement | topup_date | Client `expense_date` or current date if omitted |
| Finance Endorse | funding_company_id | Resolved from source BankAccount.company_id in database |
| Finance Endorse | is_cross_company | Comparison: source BankAccount.company_id != topup.company_id |
| Finance Endorse | payment_method_option | User selection from modal: direct or transfer_first |
| Finalize Settlement (Zero Excess) | petty cash expense | Inserts PC-EXP-{id} (5,000.00) if unrecorded, or links existing; releases reservation hold |
| Reimburse (Own Bank) | bank withdrawal | amount from topup.amount deducted from source BankAccount |
| Reimburse (Method A) | intercompany transfer record | source_company_id from source bank, destination_company_id from topup.company_id, transfer_status NOT_APPLICABLE, settlement_status UNSETTLED |
| Transfer (Method B) | bank withdrawal B | amount deducted from Company B bank, tx_id saved in source_bank_tx_id, transfer_status IN_TRANSIT |
| Confirm Transfer (Method B) | bank deposit A | amount credited to Company A destination bank, tx_id saved in destination_bank_tx_id, transfer_status RECEIVED |
| Cancel Transfer (Method B) | return pending status | updates transfer_status to RETURN_PENDING, bank balance untouched |
| Confirm Reversal (Method B) | reversal deposit B | posts reversal deposit to Company B bank, tx_id saved in reversal_bank_tx_id, transfer_status CANCELLED |
| Settle Repayment | repayment transactions | Bank A withdrawal (repayment_source_bank_tx_id), Bank B deposit (repayment_destination_bank_tx_id), settlement_status SETTLED |
| Finalize Expenses | expense records | Inserts PC-EXP-{id} (if unrecorded) and REIMB-{id} under Company A |

### Key invariants

- Total business expenditure $E$ is recognized exactly once in the `expenses` table under Company A.
- Amount reimbursed to the employee is strictly equal to verified `employee_out_of_pocket` ($O$). The company funded amount ($C$) is never reimbursed to the employee.
- Active pending claims place a reservation hold on unreserved petty cash balances. If an expense is pre-recorded, its reservation hold is 0.00 and no second wallet deduction occurs.
- Cancelling an in transit transfer sets status to `RETURN_PENDING`. The bank balance is restored only when `confirm-reversal` posts a real reversal deposit transaction.
- Material funding changes or transfer cancellations automatically invalidate previous Audit approvals, requiring re-endorsement and re-approval.
- All bank balance deductions, deposits, and status mutations occur within a single database transaction under locks without premature commits.
- Repaying an intercompany liability posts real bank transactions for both Company A withdrawal and Company B deposit.
- Execution endpoints require and enforce `Idempotency-Key` headers to guarantee zero duplicate financial postings upon network retries.

### Security model

- Role based access control strictly matching codebase roles:
  - Submissions: Authorized for `supervisor`, `finance`, and `admin` assigned to the company.
  - Endorsement & Bank Selection: Restricted to `finance` and `admin` roles.
  - Audit Review: Restricted to `audit`, `auditor`, and `admin` roles. Auditors cannot execute payouts.
  - Payout Execution (`reimburse`, `finalize-settlement`, `transfer`, `cancel-transfer`, `confirm-reversal`): Restricted to `finance` and `admin` roles.
  - Transfer Confirmation: Restricted to `finance`, `admin`, or company-scoped `supervisor` of the receiving company.
  - Repayment Settlement (`/settle`): Restricted to `finance` and `admin` roles.
- Company scoping: Users scoped to a single company cannot access or select banks of other companies unless granted cross company finance permissions.
- Backend derives bank ownership from authoritative database records, never trusting frontend company parameters.

### Configuration required

No new external environment variables or third party services are required.

### Critical test scenarios

- Explicit funding breakdown calculation: Submitting $E = 8,000.00$ and $C = 5,000.00$ stores $O = 3,000.00$ as the payable amount; petty cash wallet decreases by 5,000.00, bank decreases by 3,000.00, and single expense of 8,000.00 is recognized, verifies **AC-1**, **AC-3**, **AC-9**.
- Concurrency reservation hold: When unreserved petty cash is 5,000.00, Claim 1 submitting for $C = 5,000.00$ reserves the balance; Claim 2 attempting a simultaneous claim for $C = 5,000.00$ is rejected with 422 Insufficient unreserved petty cash, verifies **AC-2**.
- Pre-recorded expense deduplication: Linking `existing_expense_id` for $C = 5,000.00$ sets `reserved_amount = 0.00`, avoids duplicate wallet deduction, and creates only the 3,000.00 bank reimbursement expense, verifies **AC-2**, **AC-3**.
- Existing expense validation: Linking an expense with mismatched amount ($C = 5,000.00$ vs expense amount 2,000.00) or mismatched company is rejected with 422 before any records are changed, verifies **AC-2**.
- Zero excess claim finalization: Submitting $E = 5,000.00$ and $C = 5,000.00$ sets $O = 0.00$; finalizing creates PC-EXP-5000 (if unrecorded) or links existing, reduces petty cash wallet by 5,000.00, and moves no bank funds, verifies **AC-4**.
- Employee Top Up UI restriction: Regular employee role cannot see or access Top Up button on Petty Cash page, verifies **AC-5**.
- Method A cross company direct payout: Company B bank debited 3,000.00, intercompany transfer created in UNSETTLED settlement status with transfer_status NOT_APPLICABLE, and no fake deposit in Company A, verifies **AC-7**, **AC-9**.
- Method B transfer first lifecycle: Company B debited 3,000.00 (IN_TRANSIT); Company A receives 3,000.00 (RECEIVED, UNSETTLED); Company A pays employee 3,000.00 (Reimbursed), verifies **AC-7**, **AC-10**.
- Method B failed payout retry: When payout fails after transfer is RECEIVED, status remains RECEIVED and intercompany liability remains UNSETTLED, allowing safe payout retry without duplicating transfers, verifies **AC-10**.
- Two phase reversal and re-approval: Cancelling an in transit transfer moves to RETURN_PENDING (bank balance unchanged); confirming reversal posts reversal deposit of 3,000.00 to Company B, sets status to CANCELLED, and invalidates approval to Pending Finance Endorsement, verifies **AC-11**, **AC-12**.
- Intercompany repayment settlement: Calling `/settle` posts withdrawal to Company A bank, deposit to Company B bank, and sets settlement_status to SETTLED; duplicate settlement calls are blocked, verifies **AC-13**, **AC-15**.
- Insufficient bank balance: If source bank balance is below payout amount, transaction fails cleanly without partial records, verifies **AC-14**.
- Idempotency key retries: Retrying a `/reimburse` request with the same Idempotency-Key after a network timeout returns HTTP 200 with original transaction details without executing a second bank withdrawal, verifies **AC-15**.

## Build plan

The build plan follows a Tracer Bullet delivery strategy: establishing database migrations and schemas, building the backend service and endpoints, and wiring the frontend user interface.

1. Create migration scripts `0038_petty_cash_excess_reimbursements.postgres.sql` and `0038_petty_cash_excess_reimbursements.sqlite.sql` with engine specific types and partial unique indexes (`WHERE reference_no IS NOT NULL`), satisfies **AC-1**, **AC-3**, **AC-9**, **AC-10**, **AC-11**, **AC-13**.
2. Update SQLAlchemy models and Pydantic schemas in `backend/app/models/` and `backend/app/schemas/` for `petty_cash`, `expenses`, and `intercompany_transfers`, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-7**.
3. Implement petty cash reservation hold logic in `petty_cash_service.py` coordinating all petty cash operations under wallet locks (`with_for_update()` on PostgreSQL; `BEGIN IMMEDIATE` write lock on SQLite), differentiating pre-recorded expenses from unrecorded spending, satisfies **AC-2**.
4. Implement unified expense creation logic in `petty_cash_service.py` generating `PC-EXP-<id>` and `REIMB-<id>` with deduplication checks and strict amount validations against `existing_expense_id`, satisfies **AC-2**, **AC-3**, **AC-4**.
5. Implement zero excess finalization endpoint `/finalize-settlement` in `petty_cash_service.py`, branching cleanly on pre-recorded vs unrecorded spending, satisfies **AC-4**.
6. Implement endorsement logic in `petty_cash_service.py` validating source bank ownership, requiring conditional payment method for cross company banks, and recording destination bank, satisfies **AC-6**, **AC-7**.
7. Implement execution endpoints in `petty_cash_service.py` and API router: `/reimburse`, `/transfer`, and `/confirm-transfer` with `Idempotency-Key` handling and caller managed atomic bank operations without premature commits, satisfies **AC-8**, **AC-9**, **AC-10**, **AC-14**, **AC-15**.
8. Implement two phase reversal endpoints `/cancel-transfer` (moving to `RETURN_PENDING`) and `/confirm-reversal` (posting reversal deposit and resetting approval to `Pending Finance Endorsement`), satisfies **AC-11**, **AC-12**.
9. Implement `/settle` in `petty_cash_service.py` executing atomic repayment withdrawal from Company A and deposit to Company B with strict liability and bank ownership checks, satisfies **AC-13**.
10. Update `ReimbursementModal.tsx` to provide the clear funding breakdown fields (total expenses $E$, company petty cash used $C$, live computed out of pocket $O$), optional existing expense link, description, and multiple receipt upload handling, satisfies **AC-1**, **AC-2**, **AC-3**.
11. Update `PettyCashPage.tsx` to hide the `Top-up Request` action for regular employees while preserving it for Admin, Finance, and Supervisors, satisfies **AC-5**.
12. Update `PettyCashPage.tsx` review modal and ledger to display source bank selector, dynamic conditional payment method field, destination bank selector, status badges, and action buttons (`Initiate Transfer`, `Cancel Transfer`, `Confirm Reversal`, `Confirm Receipt`, `Finalize Settlement`, `Reimburse`), satisfies **AC-4**, **AC-7**, **AC-10**, **AC-11**, **AC-12**.
13. Update `TransactionPage.tsx` and Cash Ledger queries to properly display intercompany transfer rows, reversal deposits, and reimbursement movements across all active statuses, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-13**.
14. Write automated backend unit and integration tests in `backend/tests/` verifying calculations, reservation holds under concurrency, pre-recorded expense deduplication, zero excess claims, atomic locks, two phase transfer reversals, and intercompany repayment, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**, **AC-15**.

## Migration plan

**Strategy**: Strangler with engine specific migrations and non destructive additive schema changes.

**Phases**:
1. Run pre-flight check for duplicate reference numbers in `expenses` table before applying index:
   ```sql
   SELECT reference_no, COUNT(*) FROM expenses WHERE reference_no IS NOT NULL GROUP BY reference_no HAVING COUNT(*) > 1;
   ```
2. Run migration `0038_petty_cash_excess_reimbursements.postgres.sql` on PostgreSQL and `0038_petty_cash_excess_reimbursements.sqlite.sql` on SQLite. All new columns on `petty_cash_topups` and `expenses` are nullable.
3. Deploy backend service and endpoints. Existing top up and flat reimbursement requests continue functioning without change.
4. Deploy frontend updates to `ReimbursementModal.tsx` and `PettyCashPage.tsx`.

**Rollback**:
- Backward compatible migration adds columns and partial indexes only. Rollback does not drop tables or columns if active transactions have been written.

**Risks**:
- Low risk. Existing top up rows have `NULL` in the new columns and continue using their standard workflow.

## Consequences

**Positive**:
- Completely eliminates double deductions by distinguishing pre-recorded expenses from unrecorded spending.
- Reserves petty cash balances under database locks, preventing concurrent claims from overdrawing the float.
- Enforces an identical finalization lifecycle point for zero excess and positive excess claims.
- Guarantees financial ledger integrity by posting real reversal deposit transactions only upon confirmed return.
- Invalidates approvals on material funding changes, enforcing strict audit governance.
- Provides complete database level foreign keys and partial unique indexes across both PostgreSQL and SQLite.
- Preserves full transfer attempt history and prevents duplicate payments with idempotency keys.

**Negative / tradeoffs**:
- Method B requires multiple user steps (Initiate Transfer, Confirm Receipt, Reimburse), increasing interaction time for cross company transfers.
- Adding reservation hold checks adds locking overhead on the petty cash wallet during claim submission.

**Neutral**:
- Requires two engine specific migration scripts and new audit log activity records for tracking transfers, reversals, and confirmations.

## Follow-up

- [ ] Add an Intercompany Balances dashboard widget in a future release to summarize cumulative Due To and Due From amounts across all MCT companies.
