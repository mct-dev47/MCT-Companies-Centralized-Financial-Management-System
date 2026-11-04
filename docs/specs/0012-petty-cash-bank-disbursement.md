# 0012. Petty Cash Bank Disbursement on Approval

**Date**: 2026-10-29
**Status**: In Progress

## Summary

When Finance endorses a petty cash top-up request, they now choose a funding bank account first, just like the loan flow. When Internal Audit approves the request, the money moves automatically, and the rule depends on whose bank funds it. If the funding bank is a different account (an outside funder), the amount is withdrawn from that funding bank, deposited into the requesting company's own bank account, and the petty cash wallet is credited. If the funding bank is the requesting company's own account, no bank movement happens at all (no withdrawal and no deposit, the cash is already in that account); only the petty cash wallet is credited. Money is only created on the books when it genuinely comes from an outside account, so the bank ledger always stays balanced. This mirrors the loan disbursement built in spec 0011, adapted so a company funding its own petty cash is a wallet-only move.

## Context

Petty cash top-ups already flow through a three tier workflow: a company requests a top-up, Finance endorses it, Internal Audit approves it. Today approval only flips the status to `Approved`, which makes the computed wallet balance include the top-up (balance = sum of approved top-ups minus petty cash spending). No real bank money moves.

Spec 0011 added real bank disbursement for loans: on Audit approval the loan amount is withdrawn from the funding bank and deposited into the borrower's account. Petty cash has no equivalent. Finance has no way to say which bank funds a top-up, and approving a request does not touch any bank balance, so the bank ledger and the petty cash wallet drift apart from reality.

The requesting company's own petty cash wallet is a computed figure, not a stored balance, so crediting the wallet needs no new write; the `Approved` status already does that. The missing pieces are the funding bank choice (captured at the Finance endorse step) and the bank movements at approval. A naive version that always deposits into the company bank would be dangerous: when the company funds its own petty cash, depositing while skipping the withdrawal would invent money (the account would grow with nothing funding it). So the rule is split by funding source: an outside funder triggers a withdraw-then-deposit pair, while the company's own account triggers no bank movement at all, only the wallet credit.

## Requirements

**User stories**:
- As a Finance officer, I want to choose which bank account funds a petty cash top-up before I endorse it, so the disbursement draws from the right account.
- As a Finance officer, I want to be able to pick the requesting company's own bank account as the funding source and have it not be deducted, so a company can fund its own petty cash.
- As a company supervisor, I want an approved top-up to actually land in my company's bank account and petty cash wallet, so the recorded balances match the real money.

**Acceptance criteria**:
- **AC-1**: The Finance endorse action on the petty cash page requires Finance to select a funding bank account before the request can be endorsed. The chosen bank is saved on the top-up.
- **AC-2**: When Internal Audit approves a top-up whose funding bank is a DIFFERENT account from the requesting company's own (an outside funder), the amount is withdrawn from that funding bank and deposited into the requesting company's own bank account.
- **AC-3**: When Internal Audit approves a top-up whose funding bank IS the requesting company's own account, no bank movement happens at all: no withdrawal and no deposit. The bank balance is unchanged.
- **AC-4**: On any approval, the requesting company's petty cash wallet balance reflects the top-up (this already follows from the `Approved` status; approval must not break it).
- **AC-5**: Across both cases the bank ledger stays balanced: money is only ever created (deposited) when it was withdrawn from an outside funding account first. Approval never deposits without a matching withdrawal.
- **AC-6**: Rejecting (Finance) or disapproving (Audit) a top-up moves no bank money and credits no wallet.
- **AC-7**: A bank movement that fails (for example the funding account is not found) surfaces a clear error and does not leave the top-up half processed.

## Options considered

### Option 1: Move the money at Audit approval, Finance picks the bank at endorse (mirror loan 0011)

Finance selects the funding bank when they endorse. The withdraw and deposit run inside the existing Audit `review_topup` approve branch, exactly where loan 0011 does its disbursement (`audit_review_loan`).

**Pros**:
- Matches the shipped loan pattern, so the code and the mental model are consistent.
- The money moves at the final approval, the true point of no return.
- Finance, who owns funding decisions, chooses the bank.

**Cons**:
- Touches two steps (endorse captures the bank, approve moves the money).

### Option 2: Move the money at Finance endorse

Do the bank movement when Finance endorses, before Audit sees it.

**Pros**:
- Single step.

**Cons**:
- Money would move before Audit approves, breaking the three tier control. Audit disapproval would then need a reversal. Rejected by the workflow's own design.

## Decision

**Chosen option**: Option 1: Finance picks the funding bank at endorse; the bank movement runs at Audit approval, mirroring loan spec 0011, with a split rule by funding source.

On Audit approve, in this order:
1. Resolve the funding bank from the top-up's saved `bank_account_id`.
2. Decide whether the funding bank belongs to the requesting company itself (the funding `BankAccount.company_id` equals the top-up's `company_id`, with a company name match fallback when the account has no `company_id`).
3. **If the funding bank is the company's own account**: do no bank movement at all (no withdrawal, no deposit). The cash is already there.
4. **If the funding bank is a different account** (outside funder): withdraw the amount from the funding bank, then deposit the amount into the requesting company's own bank account (found by the company's id or name, the same lookup loans use).
5. Keep the status `Approved` so the computed wallet balance includes the top-up, in both cases.

This guarantees a deposit only ever follows a withdrawal, so no money is invented.

## Rationale

The loan disbursement in spec 0011 already proved this shape in this codebase: capture the bank choice on the record, run the withdraw and deposit in the Audit approve branch, broadcast a `BANK_UPDATED` event. Reusing it keeps petty cash consistent with loans and avoids inventing a second money movement pattern. Moving the money at approval rather than endorsement preserves the three tier control the whole workflow exists to enforce (Context). The "do not deduct the company's own account" rule is the one real difference from loans, and it is a single ownership comparison, so it fits cleanly into the same branch.

## Feature design

**Data model sketch**:
- `petty_cash_topups` gains one column: `bank_account_id` (`String(100)`, nullable), the funding bank Finance chose. Matches the `loans.bank_account_id` column added in spec 0011. Nullable so existing rows and the rare approval with no bank still behave.

**State transitions**:
`Pending Finance Endorsement` → (Finance endorse, now also saves `bank_account_id`) → `Pending Audit Approval` → (Audit approve, now also moves bank money) → `Approved`. Reject/disapprove branches unchanged and move no money.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /petty-cash/topups/{id}/endorse | POST | action (req), remark (req), bank_account_id (req when action=endorse) | PettyCashTopUpOut (incl. bank_account_id) | Finance (X-User-Name) | 422 missing bank/remark |
| /petty-cash/topups/{id}/review | POST | action (req), remark (req) | PettyCashTopUpOut | Audit (X-User-Name) | 400 bank move failed, 422 missing remark |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Finance endorse | funding `bank_account_id` | new input field on `PettyCashEndorseIn`, chosen in the endorse modal |
| Audit approve | amount to move | the top-up's `amount` column |
| Audit approve | funding bank account | the top-up's saved `bank_account_id` |
| Audit approve | "is the funding bank the company's own?" | compare funding `BankAccount.company_id` to the top-up's `company_id` (name-match fallback) |
| Audit approve | destination (company's own) bank account, outside-funder case only | looked up by the top-up's `company_id` / company name, same as loan 0011 deposit target |
| Audit approve | wallet credit | derived: the `Approved` status makes `get_balance` include this top-up (no new write) |

**Key invariants**:
- Money moves only on the `approve` branch of `review_topup`, never on endorse, reject, or disapprove.
- A deposit is always paired with a withdrawal from an outside funding account; approval never deposits without a matching withdrawal, so no money is invented.
- Own-account funding does zero bank movement; only the wallet (a computed value) reflects it.
- The wallet balance stays a computed value; approval never writes a stored wallet balance.

**Security model**:
- Endorse is a Finance action, review/approve is an Internal Audit action, unchanged from today. The endorse endpoint reads the actor from `X-User-Name` as it already does. No new roles.

**Configuration required**:
- None.

**Critical test scenarios**:
- Outside funder (happy path): Finance endorses with a funding bank that is NOT the company's own, Audit approves, the funding bank is debited, the company's bank is credited by the same amount, the wallet reflects the top-up. Verifies **AC-1, AC-2, AC-4, AC-5**.
- Own-account funding: Finance endorses with the company's own bank as the funding source, Audit approves, no withdrawal and no deposit are recorded, bank balance unchanged, the wallet reflects the top-up. Verifies **AC-3, AC-4, AC-5**.
- Rejection: Finance rejects, or Audit disapproves, no bank movement, no wallet credit. Verifies **AC-6**.
- Failure: funding bank id is set but the account cannot be found on approve, the approval returns a clear error and the top-up is not left half processed. Verifies **AC-7**.

## Build plan

1. Add the `bank_account_id` column (`String(100)`, nullable) to the `PettyCashTopUp` model, and a migration that adds it to `petty_cash_topups` (follow the existing `migrate_petty_cash_approval.py` style). Satisfies **AC-1**.
2. Add `bank_account_id` to `PettyCashEndorseIn` (optional field) and to `PettyCashTopUpOut`; require it in the service `endorse_topup` when `action == "endorse"`, and save it on the row. Satisfies **AC-1**.
3. In `PettyCashService.review_topup`, on the `approve` branch (after the status is set to `Approved`), run the bank movement using `BankService`: resolve the funding account from `bank_account_id`; determine if it is the company's own account (its `company_id` equals the top-up's `company_id`, name-match fallback). If it IS the company's own account, do nothing to the bank. If it is a DIFFERENT account, withdraw the amount from the funding account and deposit it into the company's own account (looked up by company id/name, same as loan 0011); broadcast `BANK_UPDATED`. Wrap in error handling that raises a clear `HTTPException` on failure so the top-up is not left half processed. Satisfies **AC-2, AC-3, AC-5, AC-7**.
4. Confirm the `Approved` status still feeds the computed wallet balance (no code change expected; verify `get_balance` and `_build_summary` already count it). Satisfies **AC-4**.
5. Leave the reject and disapprove branches untouched; add a test-style check that they move no money. Satisfies **AC-6**.
6. Frontend `PettyCashPage.tsx`: in the Finance endorse confirmation modal, add a bank account picker (list the funding bank options, allow choosing the requesting company's own account), require a selection before endorsing, and pass `bank_account_id` to `pettyCashService.endorseTopUp`. Update `pettyCashService.endorseTopUp` and the `PettyCashTransaction` type to carry `bankAccountId`. Satisfies **AC-1**.

## Consequences

**Positive**:
- Approved petty cash top-ups move real bank money and stay consistent with the loan flow.
- The bank ledger can never be inflated: a deposit only ever follows a withdrawal from an outside account, and a company funding its own petty cash touches no bank balance.

**Negative / tradeoffs**:
- Finance now must pick a bank to endorse, one extra required field in the endorse step.
- Two services (petty cash and bank) are now coupled at approval, as loans already are.

**Neutral**:
- One new nullable column and a migration. Existing rows keep working (no funding bank, no movement on a historical approval).
- Follows the same `try/except` + `BANK_UPDATED` broadcast pattern as `audit_review_loan`.

## Follow-up

- [ ] Decide what should happen if the company has no own bank account to deposit into (today the loan flow silently skips the deposit; confirm whether petty cash should warn instead).
- [ ] After build, run `/sync` to record the new petty-cash bank-disbursement convention in the backend area `AGENTS.md` (as requested; `/architect` does not edit context files).

## Migration plan

**Strategy**: add column nullable (no backfill needed)
**Phases**:
1. Add `bank_account_id` nullable to `petty_cash_topups`; deploy backend that reads and writes it.
2. Ship the frontend bank picker on the endorse step.
**Rollback**: revert the commits; the nullable column can stay harmlessly or be dropped. No live data is transformed.
**Risks**: low. Historical approvals have no funding bank and move no money, which is the intended backward-compatible behavior.
