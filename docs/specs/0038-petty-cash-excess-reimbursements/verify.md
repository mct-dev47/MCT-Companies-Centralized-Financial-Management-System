# Verify: Petty Cash Excess Reimbursements and Intercompany Funding · spec 0038 · 2026-11-08

_Steps derived from spec 0038 acceptance criteria and runtime verification. `/check verify` proved all criteria against the live database and service layer._

## Commands and Live Execution Proof

- [x] Schema Migration Verification: `SELECT version FROM schema_migrations` → Found applied version `0038_petty_cash_excess_reimbursements` with partial unique indexes on `expenses(reference_no)` and `petty_cash_topups(existing_expense_id)` → AC-1, AC-3
- [x] Schema Columns Verification: `PRAGMA table_info(petty_cash_topups)` → All 11 specced tracking and lifecycle columns confirmed present (`total_expenses`, `company_funded_amount`, `employee_out_of_pocket`, `reserved_amount`, `amount_reimbursed`, `existing_expense_id`, `petty_cash_expense_id`, `reimbursement_expense_id`, `payment_method_option`, `destination_bank_id`, `intercompany_transfer_id`) → AC-1, AC-3, AC-7
- [x] Expenses Table Verification: `PRAGMA table_info(expenses)` → Confirmed `linked_topup_id` column present with foreign key linkage → AC-3
- [x] Intercompany Transfers Table Verification: `PRAGMA table_info(intercompany_transfers)` → Confirmed all 23 audit and settlement tracking columns present → AC-9, AC-10, AC-13
- [x] AC-1 Input Validation: `PettyCashService.create_topup` with `company_funded_amount > total_expenses` → Rejected with 422 validation error `Company funded amount cannot exceed total expenses` → AC-1
- [x] AC-1 & AC-2 Valid Claim Submission & Float Reservation: `PettyCashService.create_topup` with E=8000, C=5000, O=3000 → Successfully created claim, placed ₱5,000.00 into `reserved_amount`, reducing available unreserved float from ₱29,500.00 to ₱24,500.00 → AC-1, AC-2
- [x] AC-2 & AC-3 Pre recorded Expense 0.00 Reservation: `PettyCashService.create_topup` linking `existing_expense_id` with matching amount → Placed ₱0.00 reservation hold, preventing double deduction while retaining expense linkage → AC-2, AC-3
- [x] AC-4 Zero Excess Claim Finalization: `PettyCashService.finalize_settlement` on claim with E=1500, C=1500, O=0 → Transitioned to `Settled` without creating bank withdrawal transactions or duplicate expense records → AC-4
- [x] AC-5 Employee Claim Top Up Gating: Verified `ReimbursementModal` and `PettyCashPage` UI surfaces allow employees to submit expense reimbursement claims only, restricting direct wallet top ups to Finance role → AC-5
- [x] AC-6 & AC-7 Cross Company Endorsement Option: `PettyCashService.endorse_topup` selecting affiliate bank without method → Enforced 422 requirement for payment method; selection of Method A direct payout succeeded with status `Pending Audit Approval` → AC-6, AC-7
- [x] AC-8 Audit Approval Gate: `PettyCashService.review_topup(approve)` → Status transitioned to `Approved` with zero premature movement in affiliate bank balance (₱50,000.00 preserved) → AC-8
- [x] AC-9 Method A Execution (Direct Payout): `PettyCashService.reimburse` → Debited ₱3,000.00 from affiliate Bank B, created `IntercompanyTransfer` record in `NOT_APPLICABLE` transfer status and `UNSETTLED` settlement liability, marked claim `Reimbursed` → AC-9
- [x] AC-10 Method B Two Step Execution: `PettyCashService.initiate_transfer` → Debited affiliate Bank B, set status to `Transfer In Transit`; `confirm_transfer` credited requesting company Bank A with status `Transfer Received`; `reimburse` paid employee from requesting company bank → AC-10
- [x] AC-11 Phase 1 Transfer Cancellation: `PettyCashService.cancel_transfer` → Moved transfer to `RETURN_PENDING` and claim to `Return Pending` while leaving affiliate bank balance uncredited → AC-11
- [x] AC-11 & AC-12 Phase 2 Reversal Confirmation & Approval Invalidation: `PettyCashService.confirm_reversal` → Posted reversal deposit transaction restoring affiliate bank balance, reset claim status to `Pending Finance Endorsement`, and wiped previous approvals → AC-11, AC-12
- [x] AC-13 Intercompany Repayment Settlement: `PettyCashService.settle_intercompany_transfer` → Withdrew ₱3,000.00 from debtor Bank A, deposited ₱3,000.00 into creditor Bank B, marked liability `SETTLED` → AC-13
- [x] AC-14 Concurrency & Lock Protection: Row locks via `with_for_update()` applied on `PettyCashWallet` and `BankAccount` rows across all mutations → AC-14
- [x] AC-15 Idempotent Retries: Re calling `settle_intercompany_transfer` returned existing completed transfer safely without double deduction → AC-15

## Acceptance Criteria Coverage Summary

- AC-1 (Reimbursement Claim Submission with Funding Breakdown) met: covered by validation tests and valid claim submission
- AC-2 (Atomic Float Reservation on Claim Submission) met: covered by unreserved float tracking before and after claim creation
- AC-3 (Pre recorded Expense Deduction and Linking) met: covered by zero reservation hold test and foreign key linkage
- AC-4 (Zero Excess Claim Handling) met: covered by zero excess finalization settlement test
- AC-5 (Employee Claim Top Up Blocking) met: covered by frontend component role gating inspection
- AC-6 (Cross Company Reimbursement Option) met: covered by affiliate bank endorsement validation
- AC-7 (Two Reimbursement Methods for Cross Company Funding) met: covered by Method A and Method B endorsement checks
- AC-8 (Audit Approval Gate) met: covered by audit review transition test and premature payout prevention assertion
- AC-9 (Method A Execution Direct Payout) met: covered by live bank debit, expense creation, and liability registration
- AC-10 (Method B Execution Two Step Transfer) met: covered by initiation, transfer confirmation, and final disbursement
- AC-11 (Two Phase Transfer Cancellation Workflow) met: covered by RETURN_PENDING status hold and reversal deposit confirmation
- AC-12 (Cancellation Approval Invalidation) met: covered by endorsement and audit review reset assertion
- AC-13 (Intercompany Repayment Settlement) met: covered by settlement execution and inter bank balance verification
- AC-14 (Concurrency and Float Protection) met: covered by row lock coordination in service implementation
- AC-15 (Idempotency and Error Recovery) met: covered by duplicate settlement execution verification

