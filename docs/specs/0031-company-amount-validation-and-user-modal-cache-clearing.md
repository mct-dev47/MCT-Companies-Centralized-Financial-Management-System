# 0031. Company Amount Input Validation and User Form Reset

**Date**: 2026-11-06
**Status**: Accepted

## Summary

This enhancement refines number inputs in company management and cleans cached form state in user management. Monetary inputs for starting balance and petty cash automatically replace a leading zero when you type a whole number, while preserving lone zero and decimal amounts. The user creation dialog clears all state on open and submit, and turns off browser autofill so previous employee entries never linger.

## Context

Administrators configuring company financial records encountered frustrating input behavior where typing after a zero created strings like 0100 instead of 100. In financial forms, lone zero is valid, and decimals like 0.50 are valid, but leading zeros on whole integers produce data entry mistakes.

Separately, the user creation modal in user management retained input values from earlier sessions. When administrators created one user and immediately opened the modal to create another, previous name, email, or role data remained visible in the form. Additionally, browser autocomplete suggested past user entries. This creates confusion and risks assigning wrong details to new employees.

## Requirements

**User stories**:
- As an administrator managing companies, I want monetary fields to prevent unintended leading zeros while accepting lone zero and decimals, so that company financial figures remain accurate and natural to type.
- As an administrator registering employees, I want the create user modal to open fresh without lingering entries or browser autofill from earlier users, so that user creation is secure and clean.

**Acceptance criteria**:
- **AC-1**: When typing starting balance or petty cash in Create Company modal, typing a digit while the current value is lone 0 replaces the 0 with the new digit instead of prepending 0 (for example typing 1 turns 0 into 1 rather than 0100).
- **AC-2**: Lone 0 remains valid and allowed in both starting balance and petty cash inputs.
- **AC-3**: Decimals starting with 0 (such as 0.50 or 0.05) remain valid and typeable without stripping or premature replacement.
- **AC-4**: In View Company modal edit mode, starting balance and petty cash inputs enforce the same leading zero replacement and decimal formatting behavior.
- **AC-5**: Create User modal resets all input fields, role selection, company assignments, avatar cropper, and errors to pristine defaults whenever the modal opens or reopens.
- **AC-6**: Successful user creation resets the Create User form and avatar state before modal dismissal so reopening never retains earlier user values.
- **AC-7**: Create User form and its text inputs include autocomplete off attributes to block browser autofill cache from suggesting or prepopulating previous employee credentials.

## Options considered

### Option 1: Automatic replacement on typing with complete modal reset and autocomplete off

Under this option, amount fields inspect incoming text. If the current value is 0 and you type a digit, the input replaces 0 with that digit. If you type a decimal point, it permits 0.xx without replacement. In user management, the dialog listens to dialog open state changes to trigger a full reset of React Hook Form and local image state, and marks inputs with autocomplete off.

**Pros**:
- Natural feel where users do not have to backspace before typing numbers.
- Handles both lone zero and decimal numbers cleanly.
- Guaranteed clean slate on every user dialog open without relying on manual dismissal callbacks.
- Stops browser autofill popups on shared administrative devices.

**Cons**:
- Requires custom change handling logic on numeric inputs rather than default raw number inputs.

### Option 2: Strict keystroke blocking on leading zeros with submit time reset only

This option blocks typing any digit after 0 unless you type a dot, forcing you to backspace the 0 before typing digits like 100. Form reset in user management only triggers on form submit success.

**Pros**:
- Simple keyboard event blocking.

**Cons**:
- Annoying user experience requiring manual backspacing when fields initialize with 0.
- Does not clear dirty form state if a user cancels halfway and opens the dialog again later.
- Does not stop browser autocomplete suggestions.

## Decision

**Chosen option**: Option 1: Automatic replacement on typing with complete modal reset and autocomplete off

We adopt automatic leading zero replacement for company balance fields and comprehensive state reset with autocomplete suppression for the user creation modal.

**Implementation skills**: None

## Rationale

Financial data entry should feel intuitive. Users expect that clicking a field showing 0 and pressing 1 will result in 1, not 01. Preserving lone 0 and decimals like 0.50 satisfies accounting requirements without cumbersome validation popups.

For user creation, resetting both on open and on success ensures no ghost state survives modal transitions regardless of whether the dialog closed via submit, cancel button, or overlay click. Disabling autocomplete protects employee identity data on shared admin workstations.

## Feature design

**Data model sketch**:
No database schema changes needed. Existing company balance and employee user schemas remain intact.

**State transitions**:
Not applicable.

**API surface**:
No new or modified backend API endpoints needed. Existing company and user endpoints remain unchanged.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Typing company starting balance | Sanitized numeric string or number | Keypress input sanitized by leading zero replacement logic |
| Typing company petty cash | Sanitized numeric string or number | Keypress input sanitized by leading zero replacement logic |
| Opening create user modal | Pristine form default values | React Hook Form default values on dialog open event |
| Creating user successfully | Empty cached state | Reset handler triggered on successful API response |

**Key invariants**:
- Starting balance and petty cash inputs never display non decimal leading zeros such as 0100.
- Starting balance and petty cash accept lone 0 and valid positive decimals.
- Create user form starts empty on every modal invocation.

**Security model**:
Role based access control remains unchanged. Only authorized administrators and finance officers can create companies or register users. Disabling browser autocomplete on user creation prevents credential leakage and inadvertent employee profile mixing in shared administrative browser sessions.

**Configuration required**:
None.

**Critical test scenarios**:
- Happy path: Enter 0 in Starting Balance, then type 5; value displays 5 instead of 05, verifies **AC-1**.
- Lone zero: Enter 0 in Starting Balance; value remains 0 without errors, verifies **AC-2**.
- Decimal path: Enter 0.75 in Starting Balance; value preserves decimal fraction, verifies **AC-3**.
- Edit company consistency: Edit company starting balance in View Company modal, type over lone 0; zero replaces smoothly, verifies **AC-4**.
- Modal reopen cleanup: Fill user form halfway, close dialog, reopen dialog; all fields are empty, verifies **AC-5**.
- Submit cleanup: Successfully create a user, reopen modal; all fields and avatar preview are blank, verifies **AC-6**.
- Autocomplete prevention: Click Full Name and Email inputs; browser does not present past user autofill dropdowns, verifies **AC-7**.

## Build plan

- [x] 1. Implement a reusable numeric input sanitizer helper that converts leading zeros before whole digits while preserving lone 0 and decimal sequences, satisfies **AC-1**, **AC-2**, **AC-3**.
- [x] 2. Apply the numeric sanitizer helper to Starting Balance and Petty Cash fields in `CreateCompanyModal.tsx`, satisfies **AC-1**, **AC-2**, **AC-3**.
- [x] 3. Apply the numeric sanitizer helper to Starting Balance and Petty Cash fields in `ViewCompanyModal.tsx` edit mode, satisfies **AC-4**.
- [x] 4. Update `CreateUserModal.tsx` to reset form state and avatar variables whenever `open` prop transitions to true and on successful user creation, satisfies **AC-5**, **AC-6**.
- [x] 5. Add `autoComplete="off"` and browser cache prevention attributes to the form and input fields in `CreateUserModal.tsx`, satisfies **AC-7**.

## Consequences

**Positive**:
- Natural numeric entry without accidental leading zeros or awkward backspacing.
- Consistent user experience across both company creation and company editing.
- Fresh user registration dialog without ghost data from previous employees.
- Improved privacy on shared workstations by suppressing browser autofill history.

**Negative / tradeoffs**:
- Users must explicitly type a decimal point if they intend to enter values under 1 peso starting with 0.

**Neutral**:
- Pure client side frontend enhancement requiring no backend migrations or API adjustments.

## Migration plan

**Strategy**: no migration needed
**Phases**:
1. Direct frontend component update in place.
**Rollback**: Revert component commits.
**Risks**: Very low risk, localized to form controls.
