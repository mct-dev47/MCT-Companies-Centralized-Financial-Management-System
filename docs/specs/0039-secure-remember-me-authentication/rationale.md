# 0039. Secure Remember Me Authentication and Session Management: Rationale

## Context

The centralized financial system manages loans, cash balances, disbursements, and company accounts. In earlier iterations, the application stored access tokens directly in client session storage, issued tokens with long lifetimes, and lacked a refresh token rotation mechanism. When users checked Remember Me on the sign in page, the preference was not persisted across two factor verification, and no persistent refresh cookie was established. This left client sessions vulnerable to credential extraction from browser storage, did not support controlled session renewal, and lacked server side enforcement of idle timeouts.

Financial operations demand authoritative session safeguards. Unmonitored background polling or open browser tabs must not keep sessions alive indefinitely. The system must enforce authoritative server side session expiration while offering seamless persistence across browser restarts when explicitly requested by the user. Passwords must never be retained in client storage, permissions must be re-evaluated on every request, and sensitive actions must demand reauthentication.

## Options considered

### Option 1: Stateful database session records in a dedicated user_sessions table

Store each session and refresh token hash in a new relational table, querying the database on every token refresh and activity check.

**Pros**:
- Full auditability of all concurrent user sessions per account.
- Direct database queries to inspect and terminate specific device sessions.

**Cons**:
- Requires new table migrations and additional database writes on qualifying requests.
- Higher database connection overhead for session verification.

### Option 2: Stateless encrypted refresh cookies with token versioning and revoked tokens table (Chosen)

Store encrypted session metadata (session identifier, family identifier, creation time, remember me flag, and token nonce) in an HttpOnly refresh cookie, tracking qualifying activity in memory on the backend and recording revoked tokens and user token versions in the database.

**Pros**:
- Reuses existing Fernet payload encryption and the `revoked_tokens` database table.
- Eliminates database writes on regular session activity updates while preserving instant revocation.
- Simplifies architecture without introducing external cache dependencies like Redis.

**Cons**:
- In memory activity tracking requires fallback to cookie timestamps if the backend application process restarts.

### Option 3: External key value cache with Redis

Introduce Redis to manage session keys, idle timeouts, and sliding expiration.

**Pros**:
- Native time to live expiration primitives and high throughput.

**Cons**:
- Introduces new infrastructure dependency and configuration overhead not present in the current stack.
- Excessive operational complexity for the current application footprint.

## Rationale

Option 2 delivers comprehensive security controls without adding foreign infrastructure like Redis or placing write contention on PostgreSQL. The application already possesses Fernet payload encryption infrastructure in `app.core.encryption` and an indexed `revoked_tokens` table in `app.models.security`. By packaging session state inside an encrypted cookie, scoping that cookie strictly to `/api/v1/auth`, and verifying `token_version` from the database, the backend achieves immediate revocation for password resets and administrative locks while maintaining strict idle and absolute expiration policies.

