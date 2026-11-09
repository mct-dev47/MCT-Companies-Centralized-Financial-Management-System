# 0041. Secure Rate Limiting for Login, OTP Resend, and API Requests

**Date**: 2026-11-09
**Status**: In Progress

## Summary

This specification establishes production grade rate limiting, brute force protection, one time password (OTP) lifecycle management, and centralized secure error handling across authentication and API endpoints. It implements unified PostgreSQL rate limit tables with row level locking and atomic operations to enforce strict security policies across all backend server instances without introducing external dependencies. It secures numeric OTP verification using keyed HMAC representations, provides two phase resend invalidation that never strands users upon email delivery failure, maintains a 30 day audit retention trail, intercepts all exceptions with centralized error handlers returning request correlation IDs, and equips the frontend with authoritative countdown timers and safe error message mapping.

## Requirements

**User stories**:
- As a security conscious user, I want the system to defend my account against automated password guessing, credential stuffing, and rainbow table attacks so that unauthorized actors cannot compromise my credentials.
- As a user attempting to sign in, I want clear, live countdown timers during cooldowns or lockouts so that I know exactly when I can retry without getting silently rejected.
- As a user requesting an OTP resend, I want my existing verification code to remain usable if email delivery fails so that network glitches do not lock me out.
- As an end user experiencing an issue, I want clean, polite, user friendly error messages without confusing technical jargon, stack traces, or raw code details.
- As a support engineer, I want a unique request correlation ID on every error response so that I can look up sanitized server logs and diagnose problems quickly without exposing internal details to users.
- As a system administrator, I want general and resource heavy API endpoints protected from excessive traffic so that system performance and availability remain high for all users.
- As an auditor or compliance officer, I want a complete, tamper resistant audit history of all issued, verified, invalidated, and expired OTPs retained for 30 days without exposing plaintext codes.
- As an operations engineer, I want rate limit and OTP challenge state to persist reliably across backend restarts and multiple worker processes so that distributed attacks cannot bypass restrictions.

**Acceptance criteria**:

- **AC-1**: Submitting four consecutive incorrect passwords for an email and IP combination increments the failure counter without prematurely activating the lockout.
- **AC-2**: Submitting the fifth consecutive incorrect password for an email and IP combination triggers an immediate 15 minute temporary lockout for that specific combination.
- **AC-3**: Submitting credentials during an active login lockout returns an HTTP 429 Too Many Requests response with a valid `Retry-After` header indicating remaining seconds, rejecting even the correct password.
- **AC-4**: A login attempt for a locked combination is permitted immediately after the server lockout duration expires.
- **AC-5**: Changing the submitted email address from an abusive IP address does not bypass the IP level protection threshold of 30 failures per 15 minutes.
- **AC-6**: When total login failures for an email address reach 15 across all IP addresses, the system enforces progressive response delays (2 to 5 seconds) and mandatory OTP challenge verification, neutralizing distributed brute force attacks without locking out the legitimate account owner who knows the correct password.
- **AC-7**: A successful login clears the failed attempt counter for the specific email and IP combination without clearing active lockouts on other abusive IP addresses.
- **AC-8**: Concurrent login requests for the same email and IP combination cannot race or exceed the configured 5 attempt threshold due to atomic database row locking and UPSERT logic.
- **AC-9**: The login lockout timer survives page refreshes and browser restarts, obtaining its authoritative remaining duration from the server via `/auth/rate-limit-status` rather than local client clocks.
- **AC-10**: Login rate limit responses, error messages, and execution durations never disclose whether an email address exists in the system database.
- **AC-11**: An OTP resend request initiated within 120 seconds of the prior OTP issuance or resend is rejected with an HTTP 429 response and a `Retry-After` header.
- **AC-12**: An OTP resend request initiated after the 120 second cooldown has expired succeeds, issues a fresh single use OTP, updates `last_sent_at`, and resets the two minute cooldown timer.
- **AC-13**: Initiating a sixth OTP resend after five successful resends triggers a 15 minute OTP resend lockout stored in `rate_limits` for that email and IP combination, surviving re-login attempts.
- **AC-14**: OTP resend requests rejected due to active cooldown or lockout do not generate a new OTP, do not invalidate existing valid OTPs, and do not dispatch emails.
- **AC-15**: OTP resend lockout state and cooldown timers survive page refreshes, tab switching, application restarts, and multiple backend workers.
- **AC-16**: Rotating the email address or IP address independently does not bypass applicable OTP resend thresholds (tracked across combination, email, and IP keys).
- **AC-17**: Concurrent OTP resend requests cannot exceed the maximum allowance of five resends within the active window.
- **AC-18**: Failed email delivery attempts do not increment successful resend counters or invalidate active challenge tokens.
- **AC-19**: The two factor authentication dialog displays live countdown timers formatted as `MM:SS` for both the two minute cooldown and 15 minute lockout, synchronized with server timestamps.
- **AC-20**: General API requests exceeding 120 requests per minute from a single client IP address return an HTTP 429 response with a `Retry-After` header, enforced via worker memory sliding windows, while heavy export and calculation endpoints enforce 30 requests per minute via database rate limiting.
- **AC-21**: Client IP resolution securely extracts the rightmost untrusted IP address in `X-Forwarded-For` using configured trusted proxy CIDRs, preventing header spoofing while aggregating IPv6 addresses by `/64` subnets.
- **AC-22**: Rate limit counters and lockout states for authentication and OTP endpoints remain strictly consistent across multiple backend Uvicorn workers and container instances through PostgreSQL atomic queries.
- **AC-23**: If database connectivity or rate limit storage fails during authentication checks, the system fails closed by returning an HTTP 503 Service Unavailable error rather than allowing unprotected access.
- **AC-24**: Expired rate limit records and obsolete OTP challenges older than the 30 day audit retention policy are safely pruned through automated cleanup queries without unbounded database table growth.
- **AC-25**: Existing authentication flows, token refresh, password recovery, initial setup, role based access control, and multi company authorization continue functioning without regression.
- **AC-26**: Short numeric OTP codes are stored strictly as keyed HMAC-SHA256 representations using a server side secret key, completely preventing rainbow table precomputation attacks if database snapshots are compromised.
- **AC-27**: When a user requests an OTP resend, the previous OTP is invalidated strictly after the email service confirms successful dispatch; if the new OTP email fails to send, the currently valid OTP remains active and accepted.
- **AC-28**: OTP lifecycle states (`pending_delivery`, `active`, `used`, `invalidated`, `expired`, `delivery_failed`) are explicitly tracked in PostgreSQL, and OTP verification and redemption are atomic so an OTP can never be redeemed more than once under concurrent requests.
- **AC-29**: Centralized exception handlers in `backend/app/core/errors.py` intercept all exceptions, returning uniform machine readable JSON error responses with stable error codes and request correlation IDs, ensuring zero leakage of stack traces, SQL errors, internal paths, or credentials.
- **AC-30**: Diagnostic server logs record timestamps, request IDs, endpoints, status codes, and sanitized context while strictly redacting passwords, plaintext OTPs, tokens, and authorization headers.
- **AC-31**: Login and password recovery endpoints return uniform generic responses and constant time processing, preventing user account existence enumeration.
- **AC-32**: The frontend error utility `frontend/src/utils/errorUtils.ts` maps machine readable server error codes directly to user friendly messages, never rendering raw exception strings, response bodies, or JavaScript error objects.
- **AC-33**: Every incoming API request receives a unique `X-Request-ID` header, propagated across logs and returned in error responses to facilitate troubleshooting without exposing sensitive diagnostics.
- **AC-34**: Frontend forms prevent duplicate submissions by disabling buttons and displaying loading spinners during in flight requests.
- **AC-35**: Production configuration strictly disables debug responses, detailed exception pages, and verbose traceback formatting.

## Decision

**Chosen option**: Option 1: Hybrid Architecture with PostgreSQL Atomic Auth Persistence, Keyed HMAC OTP Lifecycle, Request Correlation, and Centralized Safe Errors

The system will implement rate limiting and OTP challenge persistence directly in PostgreSQL using two new tables (`rate_limits` and `login_otp_challenges`) for authentication, OTP resend, and heavy calculation endpoints. High volume general API traffic will use an in memory sliding window per Uvicorn worker to eliminate database pool exhaustion. Concurrency safety for authentication is enforced via PostgreSQL atomic upsert statements. OTP verification material uses keyed HMAC-SHA256. Resend invalidation follows a two phase commit pattern that preserves valid OTPs on email delivery failure. Audit records are retained for 30 days before automated pruning. All errors are intercepted by centralized FastAPI exception handlers returning stable error codes and request correlation IDs. Frontend utilities map error codes to polite messages without exposing raw exceptions. Client IP addresses are resolved through a dedicated `get_client_ip` utility that validates reverse proxies against a configurable `TRUSTED_PROXIES` setting.

## Rationale

Reasoning and options: see rationale.md

## Feature design

### Data model sketch

The design introduces two tables in the PostgreSQL database, created via migration `0042_secure_rate_limiting.postgres.sql` (and matching SQLite migration for test environments).

```text
Table: rate_limits
-----------------------------------------------------------------------------
Column           Type                        Constraints
-----------------------------------------------------------------------------
key              VARCHAR(190)                PRIMARY KEY
rate_type        VARCHAR(50)                 NOT NULL, INDEXED
identifier       VARCHAR(120)                NOT NULL, INDEXED
attempts         INTEGER                     NOT NULL DEFAULT 0
window_start     TIMESTAMP WITH TIME ZONE    NOT NULL
locked_until     TIMESTAMP WITH TIME ZONE    NULLABLE, INDEXED
last_attempt_at  TIMESTAMP WITH TIME ZONE    NOT NULL
created_at       TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW()
updated_at       TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW()

Indexes:
- PRIMARY KEY (key)
- INDEX idx_rate_limits_type_id (rate_type, identifier)
- INDEX idx_rate_limits_locked_until (locked_until)
- INDEX idx_rate_limits_last_attempt (last_attempt_at)
```

```text
Table: login_otp_challenges
-----------------------------------------------------------------------------
Column              Type                        Constraints
-----------------------------------------------------------------------------
otp_id              VARCHAR(36)                 PRIMARY KEY (UUID v4)
challenge_id        VARCHAR(36)                 NOT NULL, INDEXED (UUID v4)
user_id             INTEGER                     NULLABLE, FOREIGN KEY (users.user_id)
email               VARCHAR(255)                NOT NULL, INDEXED
purpose             VARCHAR(50)                 NOT NULL DEFAULT 'login_2fa'
ip_address          VARCHAR(45)                 NOT NULL
otp_hmac            VARCHAR(64)                 NOT NULL (HMAC-SHA256 of 6-digit OTP)
status              VARCHAR(30)                 NOT NULL DEFAULT 'pending_delivery'
attempts            INTEGER                     NOT NULL DEFAULT 0
max_attempts        INTEGER                     NOT NULL DEFAULT 5
resend_count        INTEGER                     NOT NULL DEFAULT 0
last_sent_at        TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW()
expires_at          TIMESTAMP WITH TIME ZONE    NOT NULL, INDEXED
consumed_at         TIMESTAMP WITH TIME ZONE    NULLABLE
invalidated_at      TIMESTAMP WITH TIME ZONE    NULLABLE
invalidation_reason VARCHAR(100)                NULLABLE
delivery_outcome    VARCHAR(50)                 NULLABLE
created_at          TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW()
updated_at          TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW()

Indexes:
- PRIMARY KEY (otp_id)
- INDEX idx_otp_challenges_session (challenge_id, status)
- INDEX idx_otp_challenges_email_ip (email, ip_address)
- INDEX idx_otp_challenges_expires (expires_at)
- INDEX idx_otp_challenges_retention (created_at, status)
```

### Rate limit key conventions

To ensure consistent key construction across the codebase, keys in `rate_limits` strictly follow these patterns:

| Rate Category | `rate_type` | `identifier` | `key` Format | Window / Policy |
|---|---|---|---|---|
| Login email and IP combo | `login_combo` | `{email_sha256_16}:{normalized_ip}` | `login:combo:{email_sha256_16}:{normalized_ip}` | 5 attempts, 15 min lockout |
| Login global email | `login_email` | `{email_sha256_16}` | `login:email:{email_sha256_16}` | 15 attempts, progressive delay |
| Login pure IP | `login_ip` | `{normalized_ip}` | `login:ip:{normalized_ip}` | 30 attempts, 15 min lockout |
| OTP resend combo | `otp_resend_combo` | `{email_sha256_16}:{normalized_ip}` | `otp_resend:combo:{email_sha256_16}:{normalized_ip}` | 5 resends, 15 min lockout |
| OTP resend pure IP | `otp_resend_ip` | `{normalized_ip}` | `otp_resend:ip:{normalized_ip}` | 10 resends, 15 min lockout |
| Heavy API endpoint | `api_heavy` | `{normalized_ip}` | `api:heavy:{normalized_ip}` | 30 req/min sliding window |

Note: `{email_sha256_16}` represents the first 16 hexadecimal characters of `SHA-256(normalized_email)` to prevent storing raw email addresses in rate limit keys. `{normalized_ip}` is the IPv4 string or the `/64` CIDR string for IPv6.

### Window reset and update algorithm

When evaluating an attempt against `rate_limits`:

1. Read row for `key`.
2. If `locked_until` exists and `locked_until > NOW()`:
   Calculate `retry_after = CEIL(EXTRACT(EPOCH FROM (locked_until - NOW())))`.
   Raise HTTP 429 with header `Retry-After: {retry_after}`.
3. If `locked_until` exists and `locked_until <= NOW()`:
   Lockout has expired: reset `attempts = 1`, `locked_until = NULL`, `window_start = NOW()`, `last_attempt_at = NOW()`.
4. If row does not exist:
   Insert new row with `attempts = 1`, `window_start = NOW()`, `last_attempt_at = NOW()`.
5. If row exists and `NOW() > window_start + window_duration`:
   Window has expired: reset `attempts = 1`, `window_start = NOW()`, `last_attempt_at = NOW()`.
6. If row exists and `NOW() <= window_start + window_duration`:
   Increment `attempts = attempts + 1`, `last_attempt_at = NOW()`.
   If `attempts >= max_allowed_attempts`:
   Set `locked_until = NOW() + INTERVAL '{lockout_minutes} minutes'`.
   Calculate `retry_after = lockout_minutes * 60`.
   Raise HTTP 429 with header `Retry-After: {retry_after}`.

In PostgreSQL, steps 4 through 6 are executed in a single atomic SQL statement:
```sql
INSERT INTO rate_limits (key, rate_type, identifier, attempts, window_start, locked_until, last_attempt_at, created_at, updated_at)
VALUES (:key, :rate_type, :identifier, 1, :now, NULL, :now, :now, :now)
ON CONFLICT (key) DO UPDATE SET
  attempts = CASE
    WHEN rate_limits.locked_until IS NOT NULL AND rate_limits.locked_until <= :now THEN 1
    WHEN :now > rate_limits.window_start + :window_interval THEN 1
    ELSE rate_limits.attempts + 1
  END,
  window_start = CASE
    WHEN rate_limits.locked_until IS NOT NULL AND rate_limits.locked_until <= :now THEN :now
    WHEN :now > rate_limits.window_start + :window_interval THEN :now
    ELSE rate_limits.window_start
  END,
  locked_until = CASE
    WHEN (rate_limits.locked_until IS NULL OR rate_limits.locked_until <= :now)
         AND (CASE WHEN :now > rate_limits.window_start + :window_interval THEN 1 ELSE rate_limits.attempts + 1 END) >= :max_attempts
    THEN :now + :lockout_interval
    ELSE NULL
  END,
  last_attempt_at = :now,
  updated_at = :now
RETURNING attempts, locked_until;
```

### Two phase OTP resend coordination algorithm

To guarantee that a previous valid OTP is invalidated only after a replacement OTP has successfully been dispatched:

```text
[User requests OTP Resend]
       │
       ▼
Phase 1: Database Pre-allocation (Short Transaction)
       │
       ├── Check rate limits (2m cooldown, 5 resend cap, 15m lockout)
       ├── Generate new cryptographically secure 6 digit OTP
       ├── Compute HMAC-SHA256(key=OTP_HMAC_SECRET, msg=new_otp)
       ├── Insert new login_otp_challenges row with status = 'pending_delivery'
       └── Commit transaction (releases database connection before external HTTP call)
       │
       ▼
External Dispatch (Zero Database Locks Held)
       │
       ├── Call send_transactional_email(to_email, otp, timeout=5.0)
       │
       ├──► IF send succeeds (returns True):
       │        │
       │        ▼
       │    Phase 2a: Confirmation Transaction (Short Transaction)
       │        ├── Mark previous 'active' OTP as status = 'invalidated',
       │        │   invalidated_at = NOW(), invalidation_reason = 'superseded_by_resend'
       │        ├── Update new OTP status = 'active', delivery_outcome = 'sent', last_sent_at = NOW()
       │        ├── Increment resend_count in challenge & rate_limits
       │        ├── Commit transaction
       │        └── Return { "expires_in": 180, "resend_available_in": 120 }
       │
       └──► IF send fails (returns False or network error):
                │
                ▼
            Phase 2b: Failure Rollback (Short Transaction)
                ├── Mark new pending OTP as status = 'delivery_failed', delivery_outcome = 'failed'
                ├── Leave prior 'active' OTP completely untouched (still valid for verification!)
                ├── Do NOT increment resend_count
                ├── Commit transaction
                └── Return HTTP 502 Bad Gateway ("Unable to send verification code. Please try again.")
```

### State transitions

#### OTP Challenge Lifecycle
```text
(CREATION) ──► status: pending_delivery
     │
     ├──► [Email dispatch succeeds] ──► status: active
     │          │
     │          ├──► [Wrong code submitted, attempts < 5] ──► attempts++ (status remains active)
     │          ├──► [Wrong code submitted, attempts == 5] ──► status: invalidated (max_attempts_exceeded)
     │          ├──► [Replacement OTP successfully sent] ──► status: invalidated (superseded_by_resend)
     │          ├──► [Time exceeds 180 seconds] ──► status: expired
     │          └──► [Correct code submitted] ──► status: used, consumed_at = NOW()
     │
     └──► [Email dispatch fails] ──► status: delivery_failed (prior active OTP remains valid)
```

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/auth/login` | POST | `email: str`, `password: str`, `remember_me: bool` | `status: str`, `email: str` | Public | 400, 401, 429, 503 |
| `/api/v1/auth/login/verify-otp` | POST | `otp: str` (6 digits), Cookie: `mct_login_otp` | `access_token: str`, `user: dict` | Cookie challenge | 401, 429, 503 |
| `/api/v1/auth/login/resend-otp` | POST | Cookie: `mct_login_otp` | `expires_in: int`, `resend_available_in: int` | Cookie challenge | 404, 429, 502, 503 |
| `/api/v1/auth/rate-limit-status` | GET | Query: `email: Optional[str]`, `scope: Optional[str]`, Cookie: `mct_login_otp` | `locked: bool`, `retry_after: int`, `locked_until: str`, `cooldown_remaining: int` | Public | 503 |
| Centralized Middleware | ALL | IP address, path, headers | Request pass through or 429 response | Global | 429, 503 |

### Centralized error response format

All error responses across the application return a structured JSON body accompanied by a unique `X-Request-ID` HTTP header:

```json
{
  "code": "AUTH_RATE_LIMITED",
  "detail": "Too many attempts. Please try again in 14:59.",
  "request_id": "req_01h8q7v9x2b3n4m5",
  "retry_after": 899,
  "locked_until": "2026-11-09T08:00:00Z",
  "scope": "login_lockout"
}
```

### Machine readable error code dictionary

| HTTP Status | Error Code | Default User Message | Condition |
|---|---|---|---|
| 401 | `AUTH_INVALID_CREDENTIALS` | "Invalid email or password." | Bad password, unknown email, or unverified account |
| 429 | `AUTH_RATE_LIMITED` | "Too many attempts. Please try again in 15:00." | 5 failed logins for email and IP combination |
| 429 | `AUTH_IP_RATE_LIMITED` | "Too many login attempts from this network. Try again later." | 30 failed logins from single IP |
| 429 | `OTP_COOLDOWN_ACTIVE` | "Please wait 02:00 before requesting another code." | Resend requested within 120 seconds |
| 429 | `OTP_RESEND_LOCKED` | "You have reached the resend limit. Please try again in 15:00." | 5 resends exceeded for combination |
| 401 | `OTP_INVALID` | "The code is invalid or has expired. Request a new code if needed." | HMAC mismatch or expired OTP |
| 429 | `OTP_MAX_ATTEMPTS` | "Too many verification attempts. Please sign in again." | 5 bad OTP entries on challenge |
| 502 | `OTP_DELIVERY_FAILED` | "Unable to send verification code. Please try again later." | Email service error on resend |
| 400 | `TOKEN_EXPIRED` | "This link has expired or is no longer valid. Request a new link." | Password reset or invitation token invalid |
| 429 | `API_RATE_LIMITED` | "Too many requests. Please slow down." | General IP limit of 120 req/min exceeded |
| 503 | `SERVICE_UNAVAILABLE` | "Authentication service temporarily unavailable. Please try again." | Database failure during rate limit check |
| 500 | `INTERNAL_SERVER_ERROR` | "Something went wrong. Please try again later." | Unhandled server exception (stack trace logged, never sent to client) |

### Frontend error mapping matrix

The frontend `formatUserFriendlyErrorMessage` utility in `frontend/src/utils/errorUtils.ts` maps error responses using these rules:

1. If the server response contains a recognized `code`, return the exact mapped user friendly message.
2. If `retry_after` is present, format remaining time into `MM:SS` and interpolate into the message.
3. If a network failure occurs (no response received), return "Unable to connect. Please check your connection and try again."
4. If an unexpected 500 error occurs, return "Something went wrong. Please try again later."
5. Never display raw backend exception messages, Python tracebacks, or database column names.

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Enforce login rate limit | Remaining lockout duration (`Retry-After`) | Calculated from `rate_limits.locked_until - NOW()` |
| Display login countdown | `MM:SS` live countdown timer | Server response header `Retry-After` or `/rate-limit-status` |
| Track login attempts | `rate_limits.key` | Normalized email SHA-256 prefix combined with client IP |
| Validate client IP | Authoritative client IP | Rightmost untrusted IP in `X-Forwarded-For` via `TRUSTED_PROXIES` |
| Enforce OTP cooldown | Remaining cooldown seconds | Calculated from `120 - (NOW() - login_otp_challenges.last_sent_at)` |
| Enforce OTP lockout | 15 minute resend lockout | Checked against `rate_limits` key `otp_resend:combo:{email}:{ip}` |
| Verify OTP submission | Verification match | Constant time comparison of `HMAC-SHA256(submitted_otp)` and `otp_hmac` |
| Consume OTP challenge | Session tokens and cookies | Atomic update setting `status = 'used'`, `consumed_at = NOW()` where `status = 'active'` |
| Track request diagnostics | `request_id` | UUID v4 generated by correlation middleware, set on request and response |
| General API rate check | Request count in current minute | In memory sliding window counter per Uvicorn worker |
| Audit retention pruning | Eligible records deleted | Deleted where `created_at < NOW() - INTERVAL '30 days'` and `status != 'active'` |

### Key invariants

1. Passwords, raw OTP values, session secrets, and unhashed authorization tokens are never logged or stored in database tables.
2. Email addresses are always normalized (lowercased, stripped, Gmail dot rules applied) before calculating rate limit keys.
3. Login lockout duration is exactly 15 minutes (900 seconds) after five failed attempts on the same email and IP combination.
4. OTP resend cooldown is exactly 2 minutes (120 seconds) between successful resends, derived from `login_otp_challenges.last_sent_at`.
5. OTP resend lockout is exactly 15 minutes after five successful resends, recorded in `rate_limits` so starting a new login session cannot bypass it.
6. OTP verification allows a maximum of 5 failed attempts per challenge before rejecting further attempts with HTTP 429 and marking the OTP invalidated.
7. Generating a replacement OTP invalidates the previous OTP strictly after email dispatch confirms success; delivery failure leaves the valid OTP intact.
8. Numeric OTP codes are stored strictly as keyed HMAC-SHA256 representations using a server side secret key (`OTP_HMAC_SECRET`).
9. OTP records across all states (`used`, `invalidated`, `expired`, `delivery_failed`) are retained for 30 days for audit and security analysis before automated pruning.
10. Active OTP records are never deleted by cleanup routines regardless of age.
11. Every rate limit check and counter increment on authentication endpoints is atomic to prevent race conditions during concurrent requests.
12. All time calculations use authoritative UTC timestamps (`timezone.utc`).
13. The system fails closed: database connection failures during authentication rate limit evaluations return HTTP 503 rather than bypassing security controls.
14. Raw backend exceptions, tracebacks, and database schema errors are never returned to clients.
15. Diagnostic server logs redact all sensitive fields including passwords, OTPs, session cookies, and authorization headers.

### Security model

- **Client IP extraction**: Directly examining `X-Forwarded-For` without checking the proxy socket IP is strictly prohibited. The system only trusts `X-Forwarded-For` when `request.client.host` matches a configured CIDR in `TRUSTED_PROXIES`. Untrusted hops are ignored, and the rightmost untrusted IP is used as the client address.
- **IPv6 prefix grouping**: Individual IPv6 addresses are aggregated into `/64` CIDR blocks to prevent attackers from bypassing limits by rotating interface identifiers.
- **Keyed HMAC protection**: 6 digit OTP codes are HMAC-hashed with a 32 byte secret key. Even if the database is leaked, an adversary cannot precompute or reverse the OTP values using rainbow tables.
- **Information leakage protection**: Authentication failure responses use uniform generic wording ("Invalid email or password") and constant time processing, preventing user enumeration.
- **Request correlation**: Every request is assigned a unique `request_id` logged across all server events and returned in response headers, enabling safe operational debugging without leaking diagnostic internals.
- **Audit logging**: Security events (failed logins, lockouts activated, OTP resends, verification failures, rate limit blocks) are written to structured application logs with timestamps, event types, sanitized IP addresses, request IDs, and hashed identifiers.

### Configuration required

The following configuration variables are defined in `backend/app/core/config.py`:

- `TRUSTED_PROXIES`: Comma separated list of trusted reverse proxy IP addresses or CIDR blocks (default: `"127.0.0.1,::1"`).
- `LOGIN_MAX_ATTEMPTS`: Maximum failed login attempts before lockout (default: `5`).
- `LOGIN_LOCKOUT_MINUTES`: Lockout duration in minutes for login (default: `15`).
- `LOGIN_GLOBAL_EMAIL_MAX_ATTEMPTS`: Account level threshold across all IPs (default: `15`).
- `LOGIN_IP_MAX_ATTEMPTS`: Global IP threshold across all accounts (default: `30`).
- `OTP_RESEND_INTERVAL_SECONDS`: Cooldown interval between OTP resends (default: `120`).
- `OTP_RESEND_LIMIT`: Maximum allowed resends before lockout (default: `5`).
- `OTP_RESEND_LOCKOUT_MINUTES`: Lockout duration after five resends (default: `15`).
- `OTP_MAX_ATTEMPTS`: Maximum OTP verification attempts per challenge (default: `5`).
- `OTP_EXPIRES_SECONDS`: OTP validity lifetime (default: `180`).
- `OTP_AUDIT_RETENTION_DAYS`: Retention period for OTP audit records before cleanup (default: `30`).
- `OTP_HMAC_SECRET`: Secret key for HMAC-SHA256 OTP hashing (minimum 32 characters, fallback to unwrap_secret of SUPABASE_JWT_SECRET).
- `API_RATE_LIMIT_PER_MINUTE`: Default requests per minute per IP (default: `120`).
- `HEAVY_API_RATE_LIMIT_PER_MINUTE`: Requests per minute for heavy export or calculation routes (default: `30`).
- `RATE_LIMIT_ENABLED`: Global master switch for testing and test client bypass (default: `True`).

### Critical test scenarios

- **Scenario 1**: 4 failed logins followed by correct password succeeds; 5th failed login triggers 15 minute lockout rejecting even the correct password with HTTP 429 and `Retry-After: 900` (verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**).
- **Scenario 2**: 5 failed logins from IP A for email X triggers lockout for (X, A); email Y from IP A remains accessible until IP A reaches 30 total failures; email X from IP B receives progressive delays but permits login with the correct password when email X reaches 15 total failures (verifies **AC-5**, **AC-6**).
- **Scenario 3**: 10 simultaneous login requests for the same account cannot exceed the 5 attempt threshold due to atomic row locking (verifies **AC-8**, **AC-22**).
- **Scenario 4**: Frontend login timer displays remaining lockout time in `MM:SS`, disables the submit button, updates every second, re-enables at zero, and restores its countdown when the page is reloaded (verifies **AC-9**).
- **Scenario 5**: OTP resend requested at 60 seconds returns HTTP 429 with `Retry-After: 60`; requested at 121 seconds succeeds and returns new countdown; 6th resend triggers 15 minute lockout and disables resend button even if user logs in again (verifies **AC-11**, **AC-12**, **AC-13**, **AC-14**, **AC-19**).
- **Scenario 6**: Entering 5 incorrect OTP codes locks the challenge, rejecting further attempts with HTTP 429 (verifies **AC-10**, **AC-14**).
- **Scenario 7**: When replacement OTP email delivery fails, the existing active OTP remains valid and can still be verified successfully; the failed resend is recorded as `delivery_failed` (verifies **AC-18**, **AC-27**).
- **Scenario 8**: When replacement OTP email delivery succeeds, the previous active OTP transitions to `invalidated` with reason `superseded_by_resend` and is immediately rejected (verifies **AC-27**).
- **Scenario 9**: OTP verification material is compared against keyed HMAC-SHA256, and database stores zero plaintext OTP codes (verifies **AC-26**).
- **Scenario 10**: Used, unused, invalidated, and expired OTP records remain in the database for 30 days; cleanup deletes records older than 30 days while leaving active OTPs untouched (verifies **AC-24**).
- **Scenario 11**: General API endpoint receives 121 requests within 60 seconds from one IP; 121st request receives HTTP 429; exempt health route remains accessible (verifies **AC-20**).
- **Scenario 12**: Spoofed `X-Forwarded-For` header from untrusted direct connection is discarded in favor of actual socket IP (verifies **AC-21**).
- **Scenario 13**: Database failure during rate limit check raises HTTP 503 rather than allowing unauthenticated access (verifies **AC-23**).
- **Scenario 14**: Simulated internal unhandled server exception returns clean HTTP 500 JSON containing a `request_id` without exposing stack traces, Python file paths, or credentials (verifies **AC-29**, **AC-33**).
- **Scenario 15**: Frontend error utility intercepts server error codes and renders mapped user friendly text rather than raw API objects (verifies **AC-32**).

## Build plan

- [x] Database migration: Create `backend/migrations/0042_secure_rate_limiting.postgres.sql` and SQLite counterpart defining `rate_limits` and `login_otp_challenges` with primary keys, compound indexes, HMAC columns, and lifecycle audit fields, satisfies **AC-22**, **AC-24**, **AC-26**, **AC-28**.
- [x] Core rate limiter service: Implement `backend/app/services/rate_limiter.py` with atomic sliding window tracking, lockout calculation, fail closed handling, exact key formatting, and record cleanup, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-8**, **AC-22**, **AC-23**, **AC-24**.
- [x] Client IP and trusted proxy utility: Implement `get_trusted_client_ip` in `backend/app/core/network.py` supporting `TRUSTED_PROXIES` configuration and IPv6 `/64` CIDR normalization, satisfies **AC-21**.
- [x] Centralized exception handling and request correlation: Refactor `backend/app/core/errors.py` and implement `RequestCorrelationMiddleware` in `backend/app/middleware/correlation.py` providing uniform error payloads with `code`, `request_id`, and `retry_after`, satisfies **AC-29**, **AC-30**, **AC-33**, **AC-35**.
- [x] Enhanced login authentication: Refactor `login_user` in `backend/app/services/auth_service.py` to enforce the three tier rate limit policy (email + IP, email progressive delay, IP), emit structured security logs, and return HTTP 429 with `Retry-After` headers and standard error JSON, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-6**, **AC-7**, **AC-10**, **AC-30**, **AC-31**.
- [x] Persistent HMAC OTP challenge service: Implement `backend/app/services/otp_service.py` replacing process local `_otp_challenges` with database persistence in `login_otp_challenges`, enforcing keyed HMAC-SHA256 storage, two phase resend invalidation, atomic single use consumption, 2 minute cooldowns, 5 resend ceilings, cross session 15 minute resend lockouts, and 30 day audit retention, satisfies **AC-11**, **AC-12**, **AC-13**, **AC-14**, **AC-15**, **AC-16**, **AC-17**, **AC-18**, **AC-26**, **AC-27**, **AC-28**.
- [x] Rate limit status endpoint: Add `GET /api/v1/auth/rate-limit-status` in `backend/app/api/v1/endpoints/auth.py` supporting query parameters and `mct_login_otp` cookie parsing to provide authoritative remaining lockout and cooldown seconds, satisfies **AC-9**, **AC-19**.
- [x] Centralized API rate limiting middleware: Implement `RateLimitingMiddleware` in `backend/app/middleware/rate_limit_middleware.py` using worker memory sliding windows for general routes (120 req/min) and database rate limiting for heavy export/calculation routes (30 req/min), satisfies **AC-20**, **AC-21**, **AC-23**.
- [x] Frontend error mapping and live login timer: Update `frontend/src/utils/errorUtils.ts` and `frontend/src/components/auth/SignInForm.tsx` to handle machine readable error codes, display the `MM:SS` live timer, disable submission during lockouts and loading, and synchronize with server state across page refreshes via `/rate-limit-status`, satisfies **AC-3**, **AC-9**, **AC-32**, **AC-34**.
- [x] Frontend OTP cooldown and lockout timers: Update `frontend/src/components/auth/TwoFactorDialog.tsx` to support distinct 2 minute cooldown and 15 minute lockout states with live countdowns and server persistence, satisfies **AC-11**, **AC-13**, **AC-19**, **AC-32**.
- [x] Automated test suite: Implement comprehensive automated tests in `backend/tests/test_secure_rate_limiting.py` verifying all 35 acceptance criteria with mockable clocks, concurrent threads, two phase delivery simulations, HMAC validations, error payload validations, retention pruning checks, and SQLite fallback compatibility, satisfies **AC-1** through **AC-35**.

## Migration plan

**Strategy**: Strangler and expand/contract database migration

**Phases**:
1. Phase 1 (Schema expand): Apply migration `0042` creating `rate_limits` and `login_otp_challenges`. Existing `login_rate_limits` table remains in place for backward compatibility during deployment.
2. Phase 2 (Service cutover): Deploy updated backend code with new rate limiting services, OTP HMAC service, request correlation middleware, and centralized error handlers enabled. Traffic immediately transitions to `rate_limits` and `login_otp_challenges`.
3. Phase 3 (Cleanup): Deprecate legacy `LoginRateLimit` model and archive obsolete records.

**Rollback**:
If unforeseen issues arise, reverting backend code to the prior commit returns rate limiting to the previous implementation. Tables created in migration `0042` do not conflict with existing operations and can remain dormant or be dropped via rollback script.

**Risks**:
- Increased database connection usage from rate checks: mitigated by reserving PostgreSQL atomic checks strictly for authentication, OTP resend, and heavy exports, using in memory sliding windows for general API traffic.
- Legitimate corporate offices sharing single public IP: mitigated by setting the pure IP threshold generously (30 attempts) while keeping the primary 5 attempt lockout strictly bound to the email and IP combination.

## Consequences

**Positive**:
- Protects accounts from brute force password cracking, credential stuffing, and rainbow table inversion.
- Guarantees OTP challenges are single use, multi worker safe, and resilient against server restarts.
- Two phase resend coordination guarantees that email delivery failures never strand legitimate users.
- Provides a tamper resistant 30 day audit retention history of all verification events.
- Protects API infrastructure from scraping and resource exhaustion attacks without exhausting database connections.
- Centralized error handling and request correlation IDs prevent information leakage while enabling rapid operational troubleshooting.
- Protects legitimate users from distributed denial of service lockouts.
- Enhances user experience with clear, authoritative countdown timers instead of vague error messages.

**Negative / tradeoffs**:
- Requires periodic background pruning of expired rate limit and challenge records older than 30 days.
- In memory general API rate limits are scoped to each worker process rather than shared globally across workers.

**Neutral**:
- Requires administrators to properly configure `TRUSTED_PROXIES` in environments behind reverse proxies or load balancers.

## Follow-up

- [ ] Confirm production reverse proxy configuration in deployment environments (e.g. Cloudflare, AWS ALB, Nginx) to populate `TRUSTED_PROXIES` env setting.
- [ ] Schedule periodic background execution (cron or scheduler task) for database rate limit and OTP challenge table pruning after the 30 day audit retention period.
