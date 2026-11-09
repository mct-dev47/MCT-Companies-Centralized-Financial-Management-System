# 0039. Secure Remember Me Authentication and Session Management

**Date**: 2026-11-09
**Status**: Ready for Verification

## Summary

This specification establishes a secure Remember Me authentication and session lifecycle architecture for the financial management system. Users can choose whether their authenticated session persists across browser restarts while maintaining identical server side security controls. The backend enforces a thirty minute idle timeout, an eight hour absolute maximum session lifetime, short lived access tokens kept strictly in client memory, rotating encrypted refresh cookies, reauthentication for sensitive actions, and instant session revocation.

## Requirements

**User stories**:
- As a company user, I want the option to stay signed in across browser restarts when Remember Me is checked, so that I do not need to enter credentials repeatedly on trusted devices.
- As a company user, I want my session to terminate automatically when I close my browser if Remember Me was left unchecked, so that shared workstations remain secure.
- As an auditor or finance manager, I want idle sessions to terminate after thirty minutes of inactivity, so that unattended terminals cannot be misused.
- As a security administrator, I want immediate session invalidation when a user logs out, resets their password, or is locked, so that compromised credentials cannot access company records.
- As a compliance officer, I want sensitive credential updates and critical financial operations to require fresh reauthentication even within an active Remember Me session.

**Acceptance criteria**:
- **AC-1**: Submitting sign in with Remember Me checked and completing two factor verification sets an encrypted refresh token cookie named `mct_refresh_token` with `HttpOnly`, `Secure` in production environments, `SameSite=Lax`, path `/api/v1/auth`, and a persistent lifetime of eight hours (28800 seconds).
- **AC-2**: Submitting sign in with Remember Me unchecked and completing two factor verification sets an encrypted refresh token cookie named `mct_refresh_token` with `HttpOnly`, `Secure` in production environments, `SameSite=Lax`, path `/api/v1/auth`, and no `Max-Age` or `Expires` attribute (browser session cookie).
- **AC-3**: The access token returned in the authentication payload has a short lifetime of five minutes (300 seconds), is stored strictly in JavaScript application memory, and is never written to `localStorage` or `sessionStorage`.
- **AC-4**: A dedicated endpoint `POST /api/v1/auth/refresh` validates the refresh cookie and issues a fresh short lived access token along with a rotated refresh cookie without requiring credentials reentry.
- **AC-5**: The backend enforces a thirty minute idle timeout during token refresh based on the latest qualifying user activity; refreshing after thirty minutes of qualifying inactivity rejects with a 401 unauthorized status and reason code `SESSION_EXPIRED_IDLE`.
- **AC-6**: The backend enforces an eight hour absolute session lifetime from initial session creation regardless of ongoing activity; refreshing after eight hours rejects with a 401 unauthorized status and reason code `SESSION_EXPIRED_MAX_DURATION`.
- **AC-7**: Background notification polling, websocket heartbeats, health checks, and token refresh calls do not update qualifying user activity timestamps and cannot keep an idle session alive.
- **AC-8**: Every successful token refresh rotates the refresh credential; concurrent refresh requests arriving within a fifteen second grace period succeed idempotently without triggering reuse errors.
- **AC-9**: Reusing a previously rotated refresh token outside the fifteen second grace period is detected as a security violation and immediately revokes the entire session family.
- **AC-10**: Calling `POST /api/v1/auth/logout` revokes the server side session in the `revoked_tokens` table, deletes the refresh cookie with matching path `/api/v1/auth`, clears client in memory state, and redirects to the sign in screen.
- **AC-11**: Cookie authenticated endpoints (`/api/v1/auth/refresh` and `/api/v1/auth/logout`) require custom header verification (`X-Requested-With: XMLHttpRequest` or `X-MCT-CSRF: 1`) to block cross site request forgery attempts.
- **AC-12**: Resetting a user password or updating user status to `LOCKED` or `SUSPENDED` increments `token_version` on the `users` table, instantly revoking all active sessions and refresh cookies for that user.
- **AC-13**: Frontend bootstraps authentication upon page load or browser launch via `authService.initSession()` using the refresh cookie; when expired, it redirects to `/login` with an informative alert banner explaining the expiration reason.
- **AC-14**: Company level data scoping, role permissions, and backend authorization guards remain enforced on every protected request; Remember Me never bypasses role based access control or company scoping.
- **AC-15**: Passwords and clear text credentials are never stored in `localStorage`, `sessionStorage`, or cookies; credentials exist in client memory only for the brief duration of the in flight network request.
- **AC-16**: Designated sensitive actions (changing account passwords, updating user security roles, deleting companies, or issuing financial reversals) require fresh credential reauthentication; an existing Remember Me session alone does not authorize these actions.
- **AC-17**: The application provides an always accessible, prominent logout action across all layouts; on shared or non dedicated hardware, Remember Me defaults to unchecked, and session cookies are cleared immediately upon browser closure.

## Feature design

**Data model sketch**:
- Modify table `users`:
  - `token_version` (Integer, default 1, not null). Incrementing this value invalidates all access tokens and refresh cookies issued under previous versions.
- Table `revoked_tokens` (existing table reused):
  - `token_hash` (String 64, primary key). Stores SHA256 hash of revoked refresh token nonces or access tokens.
  - `user_id` (Integer, nullable, indexed).
  - `expires_at` (DateTime with timezone, nullable).
  - `created_at` (DateTime with timezone, default current UTC).

**State transitions**:
- Login initiated: credentials verified, OTP generated, `remember_me` sealed inside encrypted `mct_login_otp` cookie. Passwords are wiped from memory immediately after transport encryption.
- OTP verified: active session created, initial refresh credential generated, persistent or browser session cookie set based on `remember_me`.
- Active session: access token used for API requests, qualifying requests update in memory activity timestamp.
- Proactive or reactive refresh: `/api/v1/auth/refresh` checks idle time (30 min) and absolute time (8 hours); if valid, issues new access token, updates activity timestamp, and rotates refresh cookie.
- Sensitive action challenge: when attempting designated sensitive actions, the backend checks for a fresh reauthentication proof (password or recent challenge verification); if absent or older than five minutes, the client prompts for password confirmation.
- Idle timeout reached: 30 minutes pass without qualifying request; refresh endpoint rejects with `SESSION_EXPIRED_IDLE`.
- Absolute timeout reached: 8 hours pass from session creation; refresh endpoint rejects with `SESSION_EXPIRED_MAX_DURATION`.
- Revoked session: logout, password reset, or token reuse revokes the session family; refresh rejected immediately.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/v1/auth/login | POST | `email`, `password`, `remember_me` (or encrypted payload) | `status`, `expires_in`, `email` | Public | 400, 401, 403, 429 |
| /api/v1/auth/login/verify-otp | POST | `otp` (cookie `mct_login_otp`) | `access_token`, `user` | Cookie | 400, 401, 429 |
| /api/v1/auth/refresh | POST | Header `X-MCT-CSRF`, cookie `mct_refresh_token` | `access_token`, `user` | Cookie | 401, 403 |
| /api/v1/auth/logout | POST | Header `X-MCT-CSRF`, cookie `mct_refresh_token` | `message`, `success` | Bearer or Cookie | 200 |
| /api/v1/auth/me | GET | None | User profile object | Bearer | 401 |
| /api/v1/auth/reauthenticate | POST | `password` (or encrypted payload) | `reauth_token`, `expires_in` | Bearer | 401, 429 |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Login challenge | Encrypted OTP cookie with `remember_me` | Derived from client request parameter `LoginRequest.remember_me` |
| Verify OTP | Access token (5 minute expiry) | Generated JWT with user claims, `sid`, `token_version`, and `exp = now + 300` |
| Verify OTP | Refresh cookie (`mct_refresh_token`) | Fernet encrypted payload with `sid`, `family_id`, `created_at`, `token_version`, `nonce`, and `remember_me` |
| Token refresh | Rotated refresh cookie | Generated new cryptographic nonce, preserved `family_id` and `created_at`, updated activity time |
| Token refresh | Qualifying activity check | Read from backend `_session_activity[sid]`, fallback to cookie timestamp |
| Reauthentication | Short lived reauth proof token | Generated temporary signature verifying recent password entry |
| Session expiration notice | Explanatory banner on `/login` | URL query parameter `reason` set by client auth service (`inactivity` or `max_duration`) |

## Key invariants

- Passwords and plain credentials must never be written to `localStorage`, `sessionStorage`, or cookies.
- Access tokens and refresh credentials must never be written to `localStorage` or `sessionStorage`.
- Refresh cookies must always be flagged `HttpOnly`, `SameSite=Lax`, and restricted to path `/api/v1/auth`.
- Remember Me must not alter the thirty minute idle timeout or eight hour absolute session lifetime.
- Background polling, websocket pings, health checks, and token refresh requests must never update session activity timestamps.
- Any refresh attempt presenting a token version older than `User.token_version` must be rejected immediately.
- Reusing a rotated refresh token outside the fifteen second grace window must immediately revoke all credentials in that family.
- Sensitive credential changes and critical company deletions must require fresh reauthentication regardless of session validity.
- Every protected route must validate role and company permissions; Remember Me never bypasses authorization.

## Security model

- Role based access control and company scoping are enforced by `get_current_user` and route dependencies on every authenticated request.
- Cross site request forgery protection is enforced on `/api/v1/auth/refresh` and `/api/v1/auth/logout` via custom header inspection (`X-MCT-CSRF` or `X-Requested-With`).
- Reauthentication security: sensitive operations require re-entering the account password to obtain a short lived reauthentication claim (valid for 5 minutes).
- Transport security: cookies marked `Secure` in production environments.
- Audit logging: login attempts, successful authentications, session expirations, logouts, reauthentication challenges, and token reuse violations are recorded in the audit log.

## Configuration required

- `ACCESS_TOKEN_EXPIRE_SECONDS`: integer, default 300 (5 minutes).
- `SESSION_IDLE_TIMEOUT_SECONDS`: integer, default 1800 (30 minutes).
- `SESSION_ABSOLUTE_LIFETIME_SECONDS`: integer, default 28800 (8 hours).
- `REFRESH_GRACE_PERIOD_SECONDS`: integer, default 15 (15 seconds).
- `REAUTH_TOKEN_EXPIRE_SECONDS`: integer, default 300 (5 minutes).

## Critical test scenarios

- Happy path: Sign in with Remember Me checked establishes persistent refresh cookie; access token refreshes successfully, verifies **AC-1**, **AC-3**, **AC-4**.
- Session cookie path: Sign in with Remember Me unchecked establishes session cookie without Max-Age, verifies **AC-2**, **AC-17**.
- Password safety: Sign in, refresh, and storage scans verify that passwords never enter `localStorage`, `sessionStorage`, or cookies, verifies **AC-15**.
- Idle timeout: Fast forwarding time past thirty minutes without qualifying activity causes refresh to reject with 401, verifies **AC-5**.
- Absolute timeout: Fast forwarding time past eight hours from session creation causes refresh to reject with 401, verifies **AC-6**.
- Background polling neutrality: Repeated notification polling or health checks do not prevent idle timeout, verifies **AC-7**.
- Concurrency and rotation: Two concurrent refresh requests within fifteen seconds both succeed without false reuse detection, verifies **AC-8**.
- Reuse detection: Submitting an already rotated refresh token after the grace window revokes the family and prevents further refresh, verifies **AC-9**.
- Logout: Calling logout invalidates the session, deletes the cookie, and clears memory state, verifies **AC-10**, **AC-17**.
- Anti CSRF guard: Refresh request without the required custom header is rejected, verifies **AC-11**.
- User wide revocation: Incrementing `token_version` on password reset invalidates all previously issued refresh cookies and access tokens, verifies **AC-12**.
- Frontend bootstrap and notice: Expired session navigates to `/login?reason=inactivity` displaying the alert banner, verifies **AC-13**.
- Authorization consistency: Protected routes maintain company isolation and role restrictions regardless of Remember Me choice, verifies **AC-14**.
- Reauthentication requirement: Calling sensitive credential or destructive company endpoints without fresh reauthentication proof returns 403 with reauth required, verifies **AC-16**.

## Build plan

1. Create database migration `0040_user_token_version.sql` for PostgreSQL and SQLite to add `token_version` to `users`, satisfies **AC-12**.
2. Update backend security models and configurations (`app.core.config`, `app.models.user`, `app.models.security`), satisfies **AC-3**, **AC-5**, **AC-6**, **AC-12**, **AC-15**.
3. Implement backend session token services (`create_refresh_cookie`, `verify_refresh_cookie`, `rotate_refresh_cookie`, `track_session_activity`), satisfies **AC-1**, **AC-2**, **AC-4**, **AC-7**, **AC-8**, **AC-9**.
4. Update `POST /api/v1/auth/login` and `POST /api/v1/auth/login/verify-otp` to handle `remember_me` and issue refresh cookies, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-15**.
5. Implement `POST /api/v1/auth/refresh` with CSRF protection, idle timeout checks, absolute lifetime checks, and rotation, satisfies **AC-4**, **AC-5**, **AC-6**, **AC-8**, **AC-9**, **AC-11**.
6. Implement `POST /api/v1/auth/reauthenticate` and dependency guard `require_reauthentication` for sensitive endpoints, satisfies **AC-16**.
7. Update `POST /api/v1/auth/logout` and password reset endpoints to revoke sessions and increment `token_version`, satisfies **AC-10**, **AC-12**.
8. Attach session activity tracking middleware or dependency hook to qualifying business routes while excluding polling routes, satisfies **AC-5**, **AC-7**, **AC-14**.
9. Refactor frontend authentication services (`authService.ts`, `SessionContext.tsx`) to store access tokens strictly in memory, implement proactive and reactive token refresh, and remove storage token keys, satisfies **AC-3**, **AC-4**, **AC-13**, **AC-15**.
10. Update `SignInForm.tsx`, `LoginPage.tsx`, and application layout headers to handle Remember Me state, render session expiration alert banners, and ensure prominent logout visibility, satisfies **AC-1**, **AC-2**, **AC-13**, **AC-17**.
11. Implement comprehensive backend unit and integration tests covering cookie attributes, rotation, idle timeout, absolute lifetime, concurrency, password safety, and reauthentication, satisfies **AC-1** through **AC-17**.

## Consequences

**Positive**:
- Eliminates exposure of passwords and tokens to browser `localStorage`, `sessionStorage`, and cookies.
- Seamless persistence across browser restarts for users who opt in, without compromising security.
- Automatic session termination on idle terminals protects financial records.
- Instant, system wide session termination upon password reset or administrative account lock.
- Sensitive operations require explicit confirmation even inside persistent sessions.

**Negative / tradeoffs**:
- Storing access tokens purely in memory requires a silent network refresh on every page reload.
- Rotating refresh tokens requires careful concurrency handling and a grace period to avoid race condition logouts.
- Users must periodically re-enter passwords when executing high impact administrative or financial actions.

**Neutral**:
- Requires adding `token_version` column to the `users` table via migration.
- Existing frontend API calls will use in memory token retrieval instead of reading `sessionStorage`.

## Migration plan

**Strategy**: Strangler pattern in place
**Phases**:
1. Apply database migration adding `token_version` with default value 1.
2. Deploy backend changes supporting both new refresh cookies and backward compatible bearer authorization.
3. Update frontend to use in memory token management and silent refresh.
4. Clean up legacy access token storage items from client storage during sign in and bootstrap.
**Rollback**:
- Revert application deployment; database column `token_version` remains safe and ignored by older code.
**Risks**:
- Rapid multiple tabs opening simultaneously could race on initial refresh; mitigated by single flight frontend promise locking and backend fifteen second grace window.

## Follow-up

- [ ] Verify that third party websocket authentication receives the latest in memory access token during reconnection.

