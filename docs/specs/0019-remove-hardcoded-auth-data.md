# 0019. Remove Hardcoded Auth Data and Bind All User State to Supabase

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification removes all hardcoded seeded accounts, mock identities, and email keyword role guessing from the frontend authentication service. It updates the welcome banner and navigation components to eliminate the hardcoded Remi Lee placeholder name. All user profiles, roles, and company affiliations will load live from Supabase records through backend authentication endpoints.

## Context

The application currently retains legacy seeded accounts inside the frontend authentication service. These accounts include hardcoded profiles for Remi Lee as central administrator, fictitious audit officers, and temporary supervisors. In addition, mapping logic inspects email string patterns to fabricate user objects when specific names appear.

Because of these legacy fallbacks, the dashboard welcome banner displays Remi Lee as the administrator name whenever a user signs in with admin credentials. In reality, real administrator credentials and profile records exist in Supabase tables.

Relying on hardcoded lists and mock names causes security risks, hides database synchronization issues, and confuses users who sign in with their own credentials. Every user identity displayed across the application must originate from the authoritative Supabase database records returned by the backend API.

## Requirements

**User stories**:
- As an authenticated administrator or team member, I want to see my real name and assigned role from Supabase so that the interface accurately reflects my personal credentials.
- As a security auditor, I want all mock user records and fallback accounts removed from the codebase so that unauthorized mock identities cannot be assumed in the client.
- As a user refreshing the application, I want my active session to rehydrate fresh profile details from the backend so that my permissions and name remain synchronized with Supabase.

**Acceptance criteria**:
- **AC-1**: The seeded accounts array and mock user constants in the frontend auth service are completely removed.
- **AC-2**: The user mapping function uses the exact name, role, and company returned by the backend Supabase query, with no hardcoded email name overrides for Remi Lee or any other user.
- **AC-3**: On browser reload, the session service calls the backend profile endpoint using the active bearer token to hydrate real user data from Supabase.
- **AC-4**: If a session token is expired or invalid on startup, the application cleanly purges stored session tokens and sets the session status to unauthenticated.
- **AC-5**: The dashboard welcome banner displays the live user full name from session context, falling back to a clean placeholder name User during initial load, with Remi Lee fully removed.
- **AC-6**: Navigation header blocks and user profile dropdowns render the user name, role label, and avatar directly from the active Supabase session user object.
- **AC-7**: Custom avatar overrides in local storage apply only when the user explicitly uploads a new avatar within their browser session, defaulting otherwise to the Supabase photo URL or application logo.

## Options considered

### Option 1: Fix in place by deleting seeded accounts and routing session hydration to backend profile endpoint

Remove the hardcoded arrays and name overrides directly in the frontend auth service. When the browser initializes, make the session bootstrap call the existing backend endpoint `/api/v1/auth/me` with the stored session bearer token. Update the welcome banner to use the authenticated user name or a neutral fallback.

**Pros**:
- Direct and clean resolution without adding new libraries.
- Reuses the existing tested backend endpoint `/api/v1/auth/me` which already queries Supabase users table.
- Eliminates Remi Lee and all mock artifacts in a single coordinated change.

**Cons**:
- Requires handling a brief loading state while the profile endpoint responds on page refresh.

### Option 2: Pure client side JWT decoding without backend verification

Remove seeded accounts and decode user claims directly from the JWT access token in the browser without calling the backend profile endpoint on refresh.

**Pros**:
- Avoids an extra network request on page refresh.

**Cons**:
- JWT claims can become stale if permissions or names change in Supabase while the token is active.
- Does not guarantee that revoked accounts or database updates reflect immediately in the user profile.

## Decision

**Chosen option**: Option 1: Fix in place by deleting seeded accounts and routing session hydration to backend profile endpoint.

The application will delete all hardcoded seeded accounts, remove string checks that hardcode Remi Lee, and hydrate user profile details directly from the Supabase backed `/api/v1/auth/me` endpoint.

## Rationale

Option 1 provides immediate consistency with Supabase. The backend already contains working endpoints for user authentication, OTP verification, and profile retrieval that query Supabase tables directly. Hardcoded accounts were temporary scaffolding from early development. Removing them ensures the application operates as a genuine production multi tenant financial management system.

## Migration plan

**Strategy**: Big bang direct replacement within the frontend authentication module.

**Phases**:
1. Remove seeded account constants, mock exports, and name overriding logic from the auth service.
2. Update session hydration to invoke the backend profile endpoint when an access token exists.
3. Update the welcome banner and navigation components to remove hardcoded fallback names.
4. Verify end to end login and dashboard presentation with actual Supabase administrator credentials.

**Rollback**:
Revert the commit if unexpected regressions occur with token validation.

**Risks**:
If the backend profile endpoint fails or times out during refresh, the user will be logged out. This is standard secure behavior for expired sessions.

## Feature design

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/auth/me | GET | None (bearer header) | UserResponse object with user id, email, name, role, company names, photo url | Bearer token | 401 Unauthorized, 404 Not Found |
| /api/v1/auth/login/verify-otp | POST | otp (6 digits) | access_token, user object | Session cookie | 400 Invalid OTP, 429 Rate limited |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Render Welcome Banner | User display name | user.fullName from session context, sourced from Supabase users.name |
| Render Welcome Banner Fallback | Placeholder greeting | Default text User while session status is loading |
| Render User Navigation Block | User email and role | user.email and user.role from Supabase users table |
| Render User Avatar | Profile image | user.avatarUrl from Supabase users.photo_url or local upload override |
| Hydrate Browser Session | Fresh user session | Backend GET /api/v1/auth/me response |

**Key invariants**:
- No user identity, email, or role may be hardcoded or inferred from email string patterns in frontend code.
- If no user is logged in, the welcome banner must never show Remi Lee.
- Stored session tokens in sessionStorage must be verified against the backend before establishing an authenticated state.

**Security model**:
- All role enforcement continues to rely on backend token verification.
- Frontend displays role and permissions strictly derived from verified Supabase user records.

**Critical test scenarios**:
- Happy path: User logs in with real Supabase credentials, verifies OTP, and sees their actual name on the welcome banner, verifying **AC-2** and **AC-5**.
- Hydration path: User refreshes the page, the client calls `/api/v1/auth/me`, and the session state restores with accurate Supabase data, verifying **AC-3**.
- Expired session failure: User refreshes with an expired or tampered token, the backend returns 401, session storage is wiped, and the user redirects to sign in, verifying **AC-4**.
- Remi Lee absence check: Grepping the frontend source tree confirms zero references to Remi Lee in code or fallbacks, verifying **AC-1** and **AC-5**.

## Build plan

1. Clean up `frontend/src/services/authService.ts` by deleting `SEEDED_ACCOUNTS`, mock user constants, and `detectUserByEmail`, satisfies **AC-1**.
2. Refactor `mapUser` in `frontend/src/services/authService.ts` to map name directly from `user.name` and role from `user.role` without string overrides, satisfies **AC-2**.
3. Implement `fetchCurrentUser` in `frontend/src/services/authService.ts` targeting `/api/v1/auth/me` and integrate it into `getSession` for session hydration, satisfies **AC-3**, **AC-4**.
4. Update `frontend/src/components/dashboard/WelcomeBanner.tsx` to remove the Remi Lee fallback and display `user?.fullName || 'User'`, satisfies **AC-5**.
5. Update `frontend/src/components/layout/NavUserBlock.tsx` and `frontend/src/components/layout/UserProfileDropdown.tsx` to source avatar and names cleanly, satisfies **AC-6**, **AC-7**.
6. Verify end to end build with TypeScript check and tests, satisfies **AC-1**, **AC-2**, **AC-5**.

## Consequences

**Positive**:
- Eliminates confusion regarding who is currently logged in.
- Guarantees data displayed matches actual Supabase database records.
- Closes potential mock identity spoofing risks in the frontend.

**Negative / tradeoffs**:
- A network request to `/api/v1/auth/me` is required on initial page load when rehydrating an existing session.

**Neutral**:
- Legacy local storage keys for mock avatars or test users will be ignored or cleaned up on logout.

