# 0040. Password Reset and Initial Account Password Setup Security

**Date**: 2026-11-09
**Status**: In Progress

## Summary

This specification establishes a secure password recovery flow and hardens the initial account password setup flow in the financial management system. Both flows share one reusable password setup interface while enforcing strict cryptographic separation between token purposes. The backend validates token authenticity and expiry during initial link opening and password submission, revokes all active sessions upon password change, and protects recovery requests against account enumeration and timing attacks.

## Requirements

**User stories**:
* As a newly provisioned user, I want to activate my account using a secure 24 hour magic link invitation so that I can establish my password and access my authorized workspace.
* As a registered user, I want to initiate a password recovery request using my email address so that I can regain access if I forget my credentials.
* As an administrator, I want to reissue invitations when a setup link expires so that pending employees can configure their credentials without duplicate accounts.
* As a security officer, I want password reset actions to invalidate all previous sessions, tokens, and active refresh cookies so that compromised accounts are immediately secured.
* As a security auditor, I want token redemption to be atomic and protected against race conditions, replay attacks, and enumeration so that company records remain confidential.

**Acceptance criteria**:
* **AC-1**: Initial setup tokens expire after 24 hours (86400 seconds) from issuance, and cannot be consumed at or past the exact expiration timestamp.
* **AC-2**: An expired setup token cannot set a password or activate an account, even if the user loaded the password setup interface while the token was still valid.
* **AC-3**: Initial setup tokens are strictly single use; once consumed or claimed, duplicate or replay submissions are rejected with a 400 error.
* **AC-4**: Reissuing an invitation for a user account immediately invalidates and revokes any previously pending setup tokens and cancels pending outbox delivery jobs for that user.
* **AC-5**: Ineligible accounts (accounts in `SUSPENDED`, `DEACTIVATED`, or `LOCKED` status) cannot complete initial password setup or password recovery.
* **AC-6**: Initial password setup tokens carry purpose `initial_password_setup` and are rejected with a 400 error if submitted to the password reset endpoint.
* **AC-7**: Submitting `POST /api/v1/auth/forgot-password` with registered, unregistered, or ineligible email addresses (including suspended accounts and pending unactivated accounts) returns the identical generic response: "If an account exists for that email address, you will receive instructions to reset your password." Ineligible and unregistered accounts silently suppress token generation.
* **AC-8**: The forgot password endpoint enforces dual sliding window rate limits (maximum 5 requests per email per 15 minutes, maximum 10 requests per IP address per 15 minutes), rejecting excess requests with HTTP 429 and a uniform message without exposing whether the IP or email triggered throttling.
* **AC-9**: The forgot password endpoint enforces an execution time floor (padding total duration to 150 to 200 milliseconds using monotonic clock measurement) and a 60 second per email silent resend cooldown, preventing account enumeration via network timing discrepancies or rapid email bombing.
* **AC-10**: Password reset tokens expire after 30 minutes (1800 seconds) from creation, and are rejected at or past the expiration timestamp.
* **AC-11**: Invalid, expired, revoked, or already consumed password reset tokens cannot change an account password.
* **AC-12**: Password reset tokens carry purpose `password_reset`, cannot activate a provisioned account or complete initial password setup, and do not alter `user.status` to `ACTIVE`.
* **AC-13**: Successfully completing a password reset increments `token_version` on the user record, instantly revoking all active sessions and refresh cookies across all devices, and clears any active login rate limit lockout for that user.
* **AC-14**: Successfully completing a password reset or initial password setup does not automatically authenticate the user; the user must log in normally using their new password.
* **AC-15**: All tokens are generated with at least 256 bits of cryptographic entropy, transmitted in URL fragments as Fernet encrypted strings, and stored in the database exclusively as SHA-256 hashes.
* **AC-16**: Database token consumption is atomic using conditional update queries requiring both status and purpose match (`status = 'PENDING' AND expires_at > now AND purpose = :expected_purpose`), preventing concurrent requests or purpose mismatch attacks.
* **AC-17**: Password updates follow a three phase compensation saga (conditional DB claim, external Supabase Admin update with automatic rollback to PENDING on provider error, and final DB commit bumping `token_version`), ensuring resilient state consistency.
* **AC-18**: Passwords and raw decrypted tokens are never written to database tables, server logs, audit logs, error messages, or persistent browser storage; the encrypted Fernet token string is permitted in tab scoped `sessionStorage` strictly to preserve state across page reloads until submission.
* **AC-19**: Email delivery failures leave user accounts in a recoverable pending state without causing duplicate account creation or orphaned credentials.
* **AC-20**: Both flows reuse the single existing Set Password interface at `/auth/setup-password`, dynamically adjusting titles, descriptions, and submission actions based on the backend validated token purpose.
* **AC-21**: Database migration safely adds the `purpose` column to `user_invitations` with backward compatible default `initial_password_setup`, preserving existing users and pending invitations.
* **AC-22**: Opening a magic link in a browser or automated email scanner performs a read validation via POST on mount and scrubs the URL fragment without consuming the single use token.

## Decision

**Chosen option**: Option 1: Unified Token Schema with Strict Purpose Isolation, URL Fragment Scrubbing, and Reused Set Password Interface.

Extend the existing `user_invitations` table with a `purpose` column, enforce strict separation between `initial_password_setup` and `password_reset`, protect magic links with URL fragment scrubbing, and reuse the established Set Password modal for both authentication flows.

**Implementation skills**: `develop` (c:\MY PROJECTS\MCT-Companies-Centralized-Financial-Management-System\.agents\skills\develop) · `security-audit` (c:\MY PROJECTS\MCT-Companies-Centralized-Financial-Management-System\.agents\skills\security-audit)

## Rationale

Reasoning and options: see rationale.md.

## Feature design

**Data model sketch**:

Modify table `user_invitations`:
* `purpose` (String 30, not null, default 'initial_password_setup'). Allowed values: `'initial_password_setup'`, `'password_reset'`.
* Compound index: `idx_user_invitations_user_purpose` on `(user_id, purpose, status)`.
* Existing columns reused: `invitation_id`, `user_id`, `token_hash`, `status`, `expires_at`, `claimed_at`, `accepted_at`, `created_at`, `created_by_user_id`.
* Existing table `invitation_outbox` reused for outbox queuing and background delivery with Brevo API v3.
* Existing table `users`: `token_version` incremented upon password reset to revoke all active sessions.

**State transitions**:
* Setup invitation issued: token created with purpose `initial_password_setup`, status `PENDING`, expires in 24 hours. Outbox job created.
* Reset request received: if last request was within 60 seconds, return generic 200 without new token. Otherwise, mark previous pending reset tokens for this user `REVOKED`. Create new token with purpose `password_reset`, status `PENDING`, expires in 30 minutes. Outbox job created.
* Ineligible reset request (unregistered, suspended, or pending initial setup): execute dummy work and enforce duration floor of 150 to 200 milliseconds, silently suppressing token creation. Return generic 200.
* Link opened in browser: client sends POST to `/api/v1/auth/tokens/validate`. Backend checks status `PENDING`, `expires_at > now`, and purpose. Returns token purpose and validity. Token remains `PENDING` (not consumed by view).
* Password submitted: client sends POST with token and password.
  * Phase 1: Atomically transition status from `PENDING` to `CLAIMED` where `expires_at > now` and `purpose = :expected_purpose`.
  * Phase 2: Update password in Supabase Admin Auth. If Supabase fails, revert token status to `PENDING` and raise HTTP 502.
  * Phase 3: Finalize DB transaction: transition token to `ACCEPTED`, update user records, and commit.
* Setup completion: user status becomes `ACTIVE`, `must_change_password` set to false, and initial setup tokens invalidated.
* Reset completion: user `token_version` incremented (revoking all sessions), login rate limit lockout cleared, informational confirmation email dispatched, and outstanding reset tokens invalidated.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/auth/forgot-password | POST | `email`: string | `message`: string, `success`: boolean | Public | 400, 429 |
| /api/v1/auth/tokens/validate | POST | `token`: string | `valid`: boolean, `purpose`: string, `masked_email`: string | Public | 400, 410, 422 |
| /api/v1/auth/setup-password | POST | `token`: string, `new_password`: string | `message`: string, `success`: boolean | Public | 400, 422, 502 |
| /api/v1/auth/reset-password | POST | `token`: string, `new_password`: string | `message`: string, `success`: boolean | Public | 400, 403, 422, 502 |
| /api/v1/users/{id}/reinvite | POST | `user_id`: int in path | `UserResponse` | Admin | 403, 404, 422 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Forgot password request | Magic link token | Generated via `secrets.token_urlsafe(32)`, hashed via SHA-256 for DB lookup |
| Forgot password request | Reset magic link URL | Constructed from `settings.FRONTEND_URL` + `/auth/setup-password#token=` + encrypted token |
| Link opening validation | Verified token purpose | Read from database column `user_invitations.purpose` after matching `token_hash` |
| Link opening validation | Masked email | Derived on server from `user.email` via `mask_email` helper |
| Password reset submission | Session revocation proof | Incremented `user.token_version` on `users` table |
| Password confirmation email | Security notification | Sent to user email via Brevo API v3 in background worker with no credentials |

**Key invariants**:
* Passwords and raw decrypted tokens are never written to `localStorage`, persistent storage, cookies, server logs, or error responses.
* Tokens are stored in the database exclusively as 64 character hex SHA-256 hashes.
* Setup tokens expire in 24 hours; reset tokens expire in 30 minutes.
* Tokens are single use and claimed atomically using conditional SQL updates matching both status and purpose.
* Email scanners and GET requests cannot consume tokens or alter token status.
* Password change on reset immediately revokes all active sessions by bumping `token_version`.
* Magic links must use URL fragments (`#token=...`) and be scrubbed immediately on page mount.
* Public token endpoints are exempt from `verify_csrf_header` because they authenticate via single use tokens in JSON payloads.
* Neither flow automatically logs the user in; explicit authentication is required after completion.

**Security model**:
* Role based access: administrative re-invitation requires verified Admin role.
* Public endpoints: protected by IP and email sliding window rate limiting.
* Anti enumeration: forgot password returns a constant response regardless of account status or existence, enforces a monotonic duration floor of 150 to 200 milliseconds, and applies a 60 second silent resend cooldown.
* Transport security: magic links enforce `Referrer-Policy: no-referrer` and use HTTPS public base URLs.
* Audit logging: records invitation reissues, recovery requests, delivery outcomes, token verifications, and session revocations without recording sensitive values.

**Configuration required**:
* `INITIAL_SETUP_TOKEN_LIFETIME_HOURS`: default 24 (hours)
* `PASSWORD_RESET_TOKEN_LIFETIME_MINUTES`: default 30 (minutes)
* `FORGOT_PASSWORD_RATE_LIMIT_EMAIL_COUNT`: default 5 (requests)
* `FORGOT_PASSWORD_RATE_LIMIT_EMAIL_WINDOW_SECONDS`: default 900 (15 minutes)
* `FORGOT_PASSWORD_RATE_LIMIT_IP_COUNT`: default 10 (requests)
* `FORGOT_PASSWORD_RATE_LIMIT_IP_WINDOW_SECONDS`: default 900 (15 minutes)
* `FORGOT_PASSWORD_SILENT_COOLDOWN_SECONDS`: default 60 (seconds)
* `FORGOT_PASSWORD_TIME_FLOOR_MS`: default 180 (milliseconds)

**Critical test scenarios**:
* Scenario 1: Setup token expires after 24 hours and rejects submission, verifies **AC-1**, **AC-2**.
* Scenario 2: Concurrent requests cannot consume the same token twice, verifies **AC-3**, **AC-16**.
* Scenario 3: Admin reissuing an invitation revokes older pending setup tokens, verifies **AC-4**.
* Scenario 4: Suspended or locked accounts cannot activate or reset, verifies **AC-5**.
* Scenario 5: Initial setup token rejected when submitted to reset password endpoint, verifies **AC-6**, **AC-12**.
* Scenario 6: Registered and unregistered emails receive identical response without timing leaks, verifies **AC-7**, **AC-9**.
* Scenario 7: Forgot password rate limits block excess requests at threshold, verifies **AC-8**.
* Scenario 8: Password reset token expires after 30 minutes, verifies **AC-10**, **AC-11**.
* Scenario 9: Password reset increments user token_version and terminates active sessions, verifies **AC-13**.
* Scenario 10: Successful password change requires fresh login and does not auto authenticate, verifies **AC-14**.
* Scenario 11: Link opening validates token without consuming it, verifies **AC-22**.
* Scenario 12: External provider failure rolls back claimed token to pending, verifies **AC-17**.

## Build plan

- [x] 1. Database migration: Create migration `0041_user_invitations_purpose` adding the `purpose` column to `user_invitations` with default `initial_password_setup`, constraint check, and compound index, satisfies **AC-21**.
- [x] 2. Core token utilities: Implement purpose aware token creation, SHA-256 hashing, Fernet payload encryption, and configuration settings in `user_service.py` and `config.py`, satisfies **AC-1**, **AC-6**, **AC-10**, **AC-12**, **AC-15**, **AC-16**.
- [x] 3. Link validation endpoint: Implement `POST /api/v1/auth/tokens/validate` returning 200 for valid, 410 for expired, 400 for used, and 422 for malformed tokens without consuming the token, satisfies **AC-20**, **AC-22**.
- [x] 4. Forgot password request handler: Implement `POST /api/v1/auth/forgot-password` with dual rate limiting, 60 second silent cooldown, execution duration floor padding, constant public response, outbox dispatch, and older token revocation, satisfies **AC-7**, **AC-8**, **AC-9**, **AC-15**, **AC-18**, **AC-19**.
- [x] 5. Password reset endpoint: Implement `POST /api/v1/auth/reset-password` with atomic single use claiming matching purpose, three phase Supabase compensation saga, `token_version` session revocation, and security notification email dispatch, satisfies **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-14**, **AC-16**, **AC-17**, **AC-18**.
- [x] 6. Hardened initial setup endpoint: Update `POST /api/v1/auth/setup-password` and administrative re-invitation to strictly enforce purpose `initial_password_setup`, 24 hour expiry, and previous token revocation, returning `UserResponse` directly, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-14**.
- [x] 7. Email dispatcher template handling: Update `InvitationDispatcher` to render welcome template for `initial_password_setup` and password recovery template for `password_reset`, satisfies **AC-19**.
- [x] 8. Frontend Set Password consolidation: Update `/auth/setup-password` to scrub URL fragments on mount, store Fernet ciphertext in `sessionStorage` until submit, validate on mount, adapt UI to purpose, and simplify `RecoveryDialog.tsx` to email request and generic feedback, satisfies **AC-18**, **AC-20**, **AC-22**.
- [x] 9. Automated test suite: Write comprehensive automated tests covering all 22 scenarios using controllable test clocks, isolated in memory SQLite, and mock mailer clients, satisfies **AC-1** through **AC-22**.

## Consequences

**Positive**:
* Eliminates permanent non expiring magic links by enforcing strict backend time limits.
* Unifies password setup and password reset under one tested, accessible interface.
* Prevents account enumeration through constant time responses, duration padding, and identical public output.
* Guarantees immediate session revocation across all devices whenever a password is reset.
* Protects against link scanner pre consumption by using POST validation and URL fragment scrubbing.

**Negative / tradeoffs**:
* Users whose 30 minute reset link expires must submit a new forgot password request.
* Administrators must actively re-invite users whose 24 hour initial invitation expires.
* Rate limiting requires memory tracking and database lookup overhead on unauthenticated requests.

**Neutral**:
* Existing database records in `user_invitations` are preserved and default to `initial_password_setup`.
* The Set Password interface routes at `/auth/setup-password` remain fully backward compatible.

## Migration plan

**Strategy**: Strangler migration with safe backward compatible schema additions.
**Phases**:
1. Phase 1: Apply migration `0041_user_invitations_purpose` to add the `purpose` column with default value `'initial_password_setup'`. Existing pending invitations remain valid.
2. Phase 2: Deploy backend updates for token validation, purpose enforcement, and forgot password endpoints.
3. Phase 3: Deploy frontend consolidated Set Password component and updated recovery dialog.
**Rollback**:
Revert migration `0041` by dropping the `purpose` column and index. The previous code continues to function using default invitation handling.
**Risks**:
Low risk. All existing columns, user records, and pending invitations remain intact.

## Follow-up

* [ ] Verify Brevo API transactional template styling for password reset notices in staging environment.
* [ ] Review rate limiting thresholds after two weeks in production to ensure legitimate users are not throttled.
