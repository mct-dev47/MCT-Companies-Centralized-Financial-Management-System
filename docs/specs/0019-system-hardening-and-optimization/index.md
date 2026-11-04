# 0019. System hardening, persistence unification, and test stabilization

**Date**: 2026-11-02
**Status**: Accepted

## Summary

This specification establishes the production hardening and architectural stability baseline for the financial system without touching container packaging. It eliminates hardcoded cryptographic fallbacks and default credential loops, retires fragile dual database writes in favor of direct pooled PostgreSQL access, enforces tenant isolation and authentication on WebSocket connections, and repairs thirty failing automated tests. Completing this work ensures that business records remain consistent, multi company data never leaks across sessions, and the test suite provides an honest safety net for future development.

## Requirements

**User stories**:
- As a security lead, I want all cryptographic keys, tokens, and credentials strictly validated with zero default fallbacks so that unauthorized parties cannot forge administrative privileges.
- As a company supervisor, I want real time WebSocket updates strictly filtered to my authorized company scope so that corporate financial records remain private and isolated.
- As a finance officer, I want financial entries recorded atomically in a single relational store with exact decimal precision so that ledgers never drift or suffer rounding errors.
- As a software engineer, I want the automated test suite to run clean and green across all modules so that regression detection remains reliable.

**Acceptance criteria**:
- **AC-1**: The backend fails fast at startup with an explicit configuration error if `SUPABASE_JWT_SECRET` is missing, empty, or shorter than 32 characters, with zero fallback to hardcoded default keys.
- **AC-2**: Seeded account password trial loops in `auth_service.py` are completely removed, requiring all users to authenticate strictly against valid stored credentials.
- **AC-3**: The WebSocket `/ws` endpoint requires a valid JWT access token passed via query parameter or connection header, rejecting unauthenticated handshakes with HTTP 401 or WebSocket closure code 1008.
- **AC-4**: Real time WebSocket broadcasts route messages only to active client connections whose verified user claims permit access to the target company identifier.
- **AC-5**: The dual write architecture is replaced by a single authoritative PostgreSQL database connection managed via pooled SQLAlchemy sessions, eliminating secondary writes to local SQLite.
- **AC-6**: Monetary amounts across all financial endpoints and models remain typed as Python `Decimal` and SQL `Numeric(18, 2)`, with zero conversions to binary floating point numbers.
- **AC-7**: Revoked token identifiers and login rate limit counters are persisted in dedicated PostgreSQL tables with automated expiration, ensuring state consistency across multiple processes.
- **AC-8**: The unauthenticated endpoint `GET /api/v1/users/{user_id}/picture` requires an active authenticated session, and file uploads validate image signatures using byte inspection rather than client supplied MIME headers alone.
- **AC-9**: Client side payload encryption in the frontend is deprecated in favor of standard HTTPS transport security, removing symmetric Fernet keys from client web bundles.
- **AC-10**: The full backend automated test suite (`pytest backend/tests`) passes with zero collection errors and zero test failures.

## Decision

**Chosen option**: Option 1: Full hardening with database unification and PostgreSQL state persistence.

This approach resolves all immediate security vulnerabilities, unifies data persistence into one reliable relational model, and fixes the test suite without introducing premature infrastructure complexity.

## Feature design

**Data model sketch**:

Table: `revoked_tokens`
- `token_hash`: String(64), Primary Key (SHA256 hex digest of bearer token)
- `user_id`: Integer, Nullable, Indexed
- `expires_at`: DateTime(timezone=True), Nullable
- `created_at`: DateTime(timezone=True), Default now

Table: `login_rate_limits`
- `ip_address`: String(45), Primary Key (IPv4 or IPv6)
- `failed_attempts`: Integer, Default 0
- `locked_until`: DateTime(timezone=True), Nullable
- `last_attempt_at`: DateTime(timezone=True), Default now

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /ws | GET (WebSocket) | token: string (query param) | realtime event stream | Token verification | 401, 1008 policy violation |
| /api/v1/users/{user_id}/picture | GET | user_id: int | Temporary redirect to signed URL | Bearer Token (CurrentUser) | 401, 404 |
| /api/v1/users/{user_id}/picture | POST | picture: UploadFile | UserResponse | Bearer Token (AdminUser) | 413, 422 |
| /api/v1/auth/login | POST | email, password | LoginChallengeResponse | Public (Rate limited) | 400, 401, 429 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| WebSocket handshake | Authorized connection | Token verified claims (sub, company_ids, role) |
| WebSocket event broadcast | Filtered JSON notification | Event company_id matching connection company scope |
| Record expense | Expense database row | Direct SQLAlchemy Session commit |
| Revoke token on logout | Blacklist entry | SHA256 digest written to revoked_tokens table |
| Login lockout check | Lockout decision | login_rate_limits table row for client IP |

**Key invariants**:
- No financial amount field may ever be cast to binary float within database interactions or business calculation services.
- A WebSocket connection without a cryptographically valid token must be terminated prior to receiving any event payloads.
- An application startup must abort immediately if secret keys are missing or below security thresholds.
- FastMemoryCache must provide a thread safe clear method to support test isolation and administrative cache flushes.

**Security model**:
- Central administrators manage user records and system configuration; they are prevented from altering operational transactions.
- Auditors have read only access across all company financial entries.
- Supervisors are strictly bounded to their assigned company IDs both in HTTP endpoints and WebSocket subscription events.
- All incoming uploaded images are inspected for binary magic bytes (JPEG, PNG, WEBP) to prevent disguised executable or script uploads.

**Configuration required**:
- `SUPABASE_JWT_SECRET`: Mandatory secret string, minimum 32 characters.
- `DATABASE_URL`: Mandatory PostgreSQL connection URI with psycopg2 driver.
- `PAYLOAD_ENCRYPTION_KEY`: Optional during transition; deprecated on frontend.

**Critical test scenarios**:
- Happy path: User logs in with valid credentials, receives JWT, connects to WebSocket with token, and receives company scoped event, verifying **AC-1**, **AC-3**, and **AC-4**.
- Failure case: Missing or invalid JWT secret at startup halts boot with clear configuration error, verifying **AC-1**.
- Failure case: Seeded password trial bypass fails closed when incorrect password is submitted, verifying **AC-2**.
- Concurrency and isolation: Event broadcast for Company A is received only by Company A clients and never by Company B clients, verifying **AC-4**.
- Data integrity: Expense insert commits directly to PostgreSQL and fails cleanly without partial SQLite writes, verifying **AC-5** and **AC-6**.
- Permissions: Anonymous user accessing `/users/{user_id}/picture` receives HTTP 401, verifying **AC-8**.
- Test suite: Running `pytest backend/tests` exits with code 0 and passes all test cases, verifying **AC-10**.

## Migration plan

**Strategy**: Strangler approach applied directly within the backend service.
**Phases**:
1. Phase 1: Security and configuration validation hardening (fail fast checks, credential loop removal, image validation).
2. Phase 2: Persistence tables addition for revoked tokens and rate limits, accompanied by test harness cache method fixes.
3. Phase 3: WebSocket connection authentication and tenant scoped broadcast routing.
4. Phase 4: Refactor finance endpoints (expenses, sales, bills) to use direct SQLAlchemy sessions exclusively, removing Supabase REST dual writes.
5. Phase 5: Deprecate frontend payload encryption, switching to standard HTTPS payload submission.
**Rollback**: Each phase can be verified independently against the test suite. Reverting a phase requires git rollback of that specific module without database loss.
**Risks**: Minor database schema update required for rate limit and revoked token tables. Ensure PostgreSQL user has `CREATE TABLE` permissions.

## Build plan

- [x] **Task 1 (AC-1, AC-2)**: Harden configuration and authentication services.
  - Make `SUPABASE_JWT_SECRET` strictly required with no default fallback string in `backend/app/core/config.py` and `auth_service.py`.
  - Delete seeded default password trial loops in `backend/app/services/auth_service.py`.
- [x] **Task 2 (AC-7, AC-8)**: Implement persistent security tables and secure user endpoints.
  - Create SQLAlchemy models and tables for `RevokedToken` and `LoginRateLimit`.
  - Refactor `backend/app/core/security.py` and `auth_service.py` to query these models.
  - Add `CurrentUser` authentication check to `GET /users/{user_id}/picture`.
  - Add image header validation with magic bytes in `upload_user_picture`.
- [x] **Task 3 (AC-3, AC-4)**: Secure and tenant isolate WebSocket connections.
  - Update `websocket_endpoint` in `backend/app/main.py` to extract and verify JWT tokens on connect.
  - Refactor `ConnectionManager` in `backend/app/core/websocket.py` to track company IDs per connection and filter broadcasts by company scope.
- [x] **Task 4 (AC-5, AC-6)**: Eliminate dual writes in financial endpoints.
  - Refactor `expenses.py`, `sales.py`, and `bank_accounts.py` to write directly through SQLAlchemy database sessions.
  - Remove secondary SQLite backup blocks and redundant Supabase REST insertions.
  - Verify all monetary amounts retain `Decimal` precision throughout.
- [x] **Task 5 (AC-9)**: Deprecate frontend symmetric payload encryption.
  - Update frontend login and reset forms to transmit payload fields directly over HTTPS.
  - Remove `VITE_PAYLOAD_ENCRYPTION_KEY` requirement from `frontend/src/services/payloadEncryption.ts`.
- [x] **Task 6 (AC-10)**: Repair automated test harness and broken test assertions.
  - Add `clear()` method to `FastMemoryCache` in `backend/app/core/cache.py`.
  - Fix lease identifier mapping in tenant tests and update test client dependency overrides.
  - Run `pytest backend/tests` to confirm complete test pass.

## Consequences

- Positive: The application becomes resilient against token forgery, tenant data leaks, and credential stuffing attacks.
- Positive: Financial ledgers achieve single source of truth consistency with ACID transaction guarantees.
- Positive: Test suite provides verifiable regression protection.
- Negative: Existing environments with missing `SUPABASE_JWT_SECRET` in their `.env` files will deliberately refuse to start until the variable is configured properly.

## Follow up

- Once this non container baseline is implemented and verified clean, run `/architect` to design the production Docker and Nginx deployment configuration.
- Introduce Alembic migration versioning scripts to formalize future database schema changes.

