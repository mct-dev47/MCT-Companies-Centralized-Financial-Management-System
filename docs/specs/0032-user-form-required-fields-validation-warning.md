# 0032. User Form Required Fields Validation Warning

**Date**: 2026-11-06
**Status**: In Progress

## Summary

This enhancement adds an alert warning banner and visual highlighting to the Create User dialog in user management. When an administrator clicks Create User while required fields remain empty, null, or invalid, the modal displays an alert banner listing the uncompleted fields, highlights invalid inputs in red, and smoothly scrolls to the top. The warning dismisses dynamically as soon as the administrator begins correcting the inputs.

## Context

In the employee user management screen at http://localhost:5174/users, administrators register new staff members and appoint them to company workspaces using the Create User modal dialog. When mandatory inputs such as Full Name, Gmail Address, Role, or Company assignment are left empty or null, clicking the Create User button currently halts form submission without an alert banner.

Users who leave inputs untouched or who scroll down to the bottom action buttons can experience confusion about why clicking the button produces no apparent result. Administrators need an immediate, prominent warning banner inside the modal dialog that clearly communicates which required fields remain uncompleted, along with focused visual error styling on the offending inputs.

## Requirements

**User stories**:
- As an administrator registering an employee on the user management page, I want an alert warning banner and highlighted inputs when I attempt to submit with missing required fields, so that I immediately understand what information is required before user creation can proceed.

**Acceptance criteria**:
- **AC-1**: Clicking Create User when required inputs are empty, null, or invalid renders a warning alert banner at the top of the dialog detailing the missing required fields.
- **AC-2**: The required fields validated upon clicking Create User include Full Name (minimum 2 characters), Email Address (valid @gmail.com format), Role, and at least one Assigned Company selection.
- **AC-3**: When validation fails on clicking Create User, the modal dialog smoothly scrolls to the top container so the warning alert banner is immediately visible to the administrator.
- **AC-4**: Each empty or invalid required input displays field level red borders and inline error text in addition to the top alert banner.
- **AC-5**: The top validation alert banner and field level error states dismiss or clear dynamically as soon as the administrator edits the corresponding inputs or toggles an assigned company.
- **AC-6**: When all required fields are filled with valid values, clicking Create User proceeds directly to the user creation confirmation step without showing the warning banner.

## Options considered

### Option 1: Top alert banner with smooth scroll and reactive error cleanup

Under this option, clicking Create User evaluates both React Hook Form fields and the company selection state. If any required field is empty, null, or invalid, the modal renders an alert box at the top with an alert icon, lists the missing items, highlights invalid inputs in red, and smoothly scrolls the dialog container to the top. The banner and error states clear as soon as the administrator edits fields or selects a company.

**Pros**:
- High visibility directly in the user view regardless of scroll depth.
- Clear guidance listing exactly which fields need attention.
- Responsive cleanup gives immediate positive feedback as users type.

**Cons**:
- Requires managing an explicit top alert state alongside existing field level React Hook Form states.

### Option 2: Floating toast notification without modal alert banner

Under this option, clicking Create User with invalid fields triggers a floating toast popup in the corner of the browser viewport while highlighting the form inputs.

**Pros**:
- Uses the existing toast system.

**Cons**:
- Floating toasts can be overlooked outside the focused modal dialog area.
- Does not automatically scroll the modal dialog to the invalid inputs.

### Option 3: Passive submit button disablement

Under this option, the Create User submit button remains disabled until all required fields pass validation.

**Pros**:
- Prevents clicking on invalid forms entirely.

**Cons**:
- Poor user experience that leaves users guessing why the button is unresponsive.
- Provides no feedback explaining what values are missing.

## Decision

**Chosen option**: Option 1: Top alert banner with smooth scroll and reactive error cleanup

We adopt an alert warning banner placed at the top of the Create User modal with smooth scroll to top and dynamic error dismissal.

**Implementation skills**: None

## Rationale

An explicit alert banner directly within the modal provides clear, immediate feedback without relying on subtle button opacity or off screen toast popups that might go unnoticed. Auto scrolling the modal ensures users on smaller viewports or with scrolled dialogs immediately see the problem and can fix the required fields quickly.

## Feature design

**Data model sketch**:
No database schema changes needed. Existing employee schemas remain intact.

**State transitions**:
Not applicable.

**API surface**:
No backend API modifications needed. Existing user creation endpoints remain unchanged.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Clicking Create User with empty fields | Top warning banner and field errors | React Hook Form validation errors combined with company selection check |
| Form submission failure | Formatted missing fields summary | Aggregated names of uncompleted mandatory inputs |
| Scroll correction | Modal scroll position moved to top | Dialog container DOM element scrollIntoView invocation |
| User input correction | Cleared warning banner | Input change handler and company toggle callbacks |

**Key invariants**:
- The confirmation dialog never opens while any required field is empty, null, or invalid.
- Required fields always enforce Full Name, valid Gmail Address, Role, and at least one Company.
- The top warning banner always lists the specific fields requiring completion.

**Security model**:
Role based access control remains unchanged. Only authorized administrators and owner roles can access user creation. Validating inputs client side enhances data integrity before requests reach the backend.

**Configuration required**:
None.

**Critical test scenarios**:
- Empty form submission: Click Create User on pristine dialog; top warning banner appears listing missing fields and fields highlight red, verifies **AC-1**, **AC-2**, **AC-4**.
- Auto scroll behavior: Scroll dialog to bottom and click Create User; dialog container smoothly scrolls to top, verifies **AC-3**.
- Reactive clearing: Type a valid character into Full Name; full name error clears dynamically, verifies **AC-5**.
- Valid submission: Enter valid Full Name, valid Gmail, Role, and pick one Company, then click Create User; confirmation dialog opens without warning banner, verifies **AC-6**.

## Build plan

- [x] 1. Add top level warning alert state and alert banner component to `CreateUserModal.tsx`, satisfies **AC-1**, **AC-2**.
- [x] 2. Connect `form.handleSubmit` error callback to aggregate missing field labels and trigger smooth auto scroll to top, satisfies **AC-1**, **AC-3**, **AC-4**.
- [x] 3. Integrate assigned company selection validation into the top warning banner aggregation, satisfies **AC-2**, **AC-4**.
- [x] 4. Wire reactive clearing of the top warning banner and error borders as user edits inputs or selects companies, satisfies **AC-5**.
- [x] 5. Verify clean transition to confirmation modal on valid form submission, satisfies **AC-6**.

## Consequences

**Positive**:
- Immediate clarity for administrators attempting user creation.
- Eliminates user confusion when clicking submit on incomplete forms.
- Consistent visual feedback with auto scroll and reactive error clearing.

**Negative / tradeoffs**:
- Adds minor state handling overhead to the modal component.

**Neutral**:
- Pure client side frontend enhancement requiring no backend changes.

## Migration plan

**Strategy**: no migration needed
**Phases**:
1. Direct frontend component update in `CreateUserModal.tsx`.
**Rollback**: Revert component commits.
**Risks**: Very low risk, localized to modal form handling.

