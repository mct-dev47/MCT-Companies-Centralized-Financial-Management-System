# Verify: Secure Remember Me Authentication and Session Management (spec 0039, updated 2026-11-09)
Steps derived from spec 0039 acceptance criteria and value sourcing. /check verify runs these, and /test locks the durable ones.

## UI and manual
- [ ] On the sign in screen, enter valid credentials with Remember Me checked, complete two factor verification, and inspect browser network cookies to confirm `mct_refresh_token` is set with `HttpOnly`, `SameSite=Lax`, path `/api/v1/auth`, and an expiration lifetime of eight hours (AC-1)
- [ ] On the sign in screen, enter valid credentials with Remember Me unchecked, complete two factor verification, and inspect browser network cookies to confirm `mct_refresh_token` is set as a session cookie with no `Max-Age` or `Expires` attribute (AC-2)
- [ ] Inspect browser developer tools storage (`localStorage` and `sessionStorage`) after sign in, confirming no access tokens, refresh tokens, or passwords are stored in browser storage (AC-3, AC-15)
- [ ] Close the browser with Remember Me checked, reopen to the application dashboard, and confirm the application seamlessly restores the session via `authService.initSession()` without prompting for credentials (AC-1, AC-13)
- [ ] Close the browser with Remember Me unchecked, reopen to the dashboard, and confirm the session is terminated and redirects to sign in (AC-2, AC-17)
- [ ] Trigger an explicit token refresh or inspect the background refresh request in developer tools, confirming the access token updates and the `mct_refresh_token` cookie rotates (AC-4, AC-8)
- [ ] Leave the application open and idle without user activity for thirty minutes, trigger a navigation or refresh, and verify the user is redirected to `/login?reason=inactivity` displaying the inactivity alert banner (AC-5, AC-13)
- [ ] Maintain ongoing activity past eight hours from session creation, confirm the session terminates at the eight hour boundary, and verify the user is redirected to `/login?reason=max_duration` displaying the maximum duration alert banner (AC-6, AC-13)
- [ ] Observe background notification polling in the network panel, confirm polling occurs without preventing idle timeout expiration (AC-7)
- [ ] Click the prominent Log Out button in the navigation bar, verify the session is revoked on the backend, the refresh cookie is cleared, in memory tokens are wiped, and the browser redirects to `/login` (AC-10, AC-17)
- [ ] Navigate to a protected company view, confirm that company scoping and user role permissions remain strictly enforced during active sessions (AC-14)
- [ ] Attempt a high impact sensitive action such as deleting a company, confirm the application demands password reauthentication before proceeding (AC-16)

## Commands
- [x] `$env:PYTHONPATH='backend'; .venv\Scripts\python.exe -m unittest backend/tests/test_spec_0039_remember_me_auth.py` executes 14 unit and integration tests verifying cookie attributes, short lived tokens, token rotation, idle timeout rejection, absolute lifetime rejection, polling neutrality, grace period concurrency, reuse detection, logout cookie clearing, CSRF custom header checks, token version revocation, and reauthentication requirements (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-15, AC-16)
- [x] `$env:PYTHONPATH='backend'; .venv\Scripts\python.exe -m unittest backend/tests/test_secret_leak_prevention.py backend/tests/test_owner_role.py` executes regression test suites confirming zero secret leaks and existing role security guards remain intact
- [x] `Get-Content backend\migrations\0040_user_token_version.postgres.sql` and `Get-Content backend\migrations\0040_user_token_version.sqlite.sql` verify SQL migration scripts adding `token_version` to table `users` exist (AC-12)

## Acceptance criteria coverage
- AC-1 covered by test_ac1_remember_me_persistent_cookie and persistent cookie browser inspection
- AC-2 covered by test_ac2_session_cookie and session cookie browser inspection
- AC-3 covered by test_ac3_short_lived_access_token and in memory token storage
- AC-4 covered by test_ac4_token_refresh and POST /api/v1/auth/refresh endpoint
- AC-5 covered by test_ac5_idle_timeout_expiration and SESSION_EXPIRED_IDLE rejection
- AC-6 covered by test_ac6_absolute_session_lifetime and SESSION_EXPIRED_MAX_DURATION rejection
- AC-7 covered by test_ac7_background_polling_neutrality and activity tracking dependency
- AC-8 covered by test_ac8_concurrency_grace_period and 15 second rotation tolerance
- AC-9 covered by test_ac9_reuse_detection_revokes_family and session family revocation
- AC-10 covered by test_ac10_logout_revocation and POST /api/v1/auth/logout endpoint
- AC-11 covered by test_ac11_csrf_custom_header_protection and verify_csrf_header check
- AC-12 covered by test_ac12_user_wide_revocation and migration 0040 token_version increment
- AC-13 covered by authService.initSession bootstrap and LoginPage alert banners
- AC-14 covered by test_ac14_role_and_company_scoping_enforced and get_current_user dependencies
- AC-15 covered by test_ac15_no_passwords_or_tokens_in_storage and storage scans
- AC-16 covered by test_ac16_reauthentication_requirement and require_reauthentication dependency
- AC-17 covered by always visible layout header logout button and default unchecked Remember Me

