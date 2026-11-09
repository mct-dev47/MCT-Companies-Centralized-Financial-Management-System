# 0041. Secure Rate Limiting for Login, OTP Resend, and API Requests (Rationale)

**Date**: 2026-11-09
**Status**: Proposed

## Context

The MCT Financial Management System manages sensitive corporate financial data, lending records, tenant leases, and banking transactions across multiple companies. Protecting user accounts, authentication endpoints, and API infrastructure against credential stuffing, brute force password guessing, OTP enumeration, email flooding, and denial of service attacks is a critical production security requirement.

Current authentication mechanisms in the backend feature preliminary rate limiting that is incomplete and vulnerable to circumvention. Login failure tracking only monitors a client IP address in a basic database row, leaving email addresses unmonitored. An attacker rotating residential IP addresses or cloud proxies can launch distributed brute force attacks against a victim account without triggering the IP based lockout. Conversely, an attacker can intentionally lock out an entire corporate office sharing a single public IP address by cycling through fictitious emails.

OTP verification and resend logic also presents critical security and operational gaps. The current implementation tracks OTP resend intervals and resend counters inside an encrypted client cookie, while challenge state is held in a process local Python dictionary (`_otp_challenges`). If a user opens multiple browser tabs, clears browser cookies, or if the backend runs multiple worker processes or restarts, OTP challenges lose state or allow resend limits to be reset. Furthermore, if a new OTP email fails to dispatch, existing implementations often prematurely invalidate the user's current valid OTP, stranding the legitimate user.

Short 6 digit numeric verification codes possess a small search space of only one million combinations. Storing raw OTPs or plain SHA-256 hashes in database records exposes the system to rainbow table precomputation attacks if database snapshots are compromised. Additionally, there is no centralized rate limiting middleware protecting general business API endpoints, leaving endpoints such as reporting and transaction queries vulnerable to rapid scraping and resource exhaustion.

Error handling across endpoints currently exhibits inconsistencies that create information leakage risks. Unhandled exceptions or database constraint errors can inadvertently reveal SQL table structures, third party service names, or execution stack traces to frontend consumers. When error handling is fragmented across routes, frontend components resort to parsing unstructured strings or display raw technical messages. A secure application demands centralized exception handling, stable machine readable error codes, generic responses that thwart account enumeration, request correlation IDs for sanitized server diagnostics, and safe frontend message rendering.

Without production grade rate limiting, resilient OTP lifecycle management, and centralized secure error handling, the platform remains exposed to automated attacks, account takeover risks, denial of service incidents, information leakage, and excessive email delivery costs. The rate limiting and error handling system must enforce hard limits atomically on the backend, support multi worker environments, prevent IP spoofing through reverse proxies, handle IPv6 prefix rotation, provide authoritative countdown synchronization to the frontend, manage OTP lifecycle states with audit retention, sanitize all user facing errors, and fail closed if rate limiting storage is unavailable.

## Options considered

### Option 1: Hybrid Architecture with PostgreSQL Atomic Auth Persistence, Keyed HMAC OTP Lifecycle, Request Correlation, and Centralized Safe Errors (Chosen)

This option implements a resilient, multi tier rate limiting, OTP lifecycle, and centralized secure error handling architecture tailored to operational reality. High risk authentication and OTP endpoints (login attempts, OTP resends, OTP verification, password resets, and heavy resource exports) are persisted in PostgreSQL using atomic `UPSERT` statements and row level locking across dedicated `rate_limits` and `login_otp_challenges` tables. 

OTP codes are stored as keyed HMAC-SHA256 representations using a server secret key, preventing rainbow table inversion. OTP records support explicit lifecycle states (`pending_delivery`, `active`, `used`, `invalidated`, `expired`, `delivery_failed`). When resending an OTP, the previous OTP is invalidated strictly after the email service confirms successful dispatch; delivery failures leave the active OTP intact. Records are retained for 30 days for compliance audits before automated pruning. For high volume general API traffic (120 requests per minute per IP), each backend worker enforces sliding windows in process memory with thread locks.

All backend errors flow through centralized FastAPI exception handlers returning a uniform JSON structure with stable machine readable error codes, safe user friendly messages, and a unique request correlation ID. Server logs capture sanitized diagnostics with sensitive parameters redacted. The frontend `errorUtils.ts` utility maps error codes directly to approved user messages, ensuring raw exceptions, stack traces, and internal paths are never rendered to users.

**Pros**:
- Guarantees strict multi worker atomicity and persistence across restarts for critical security boundaries (login brute force, OTP resend caps, and verification attempts).
- Keyed HMAC-SHA256 completely prevents rainbow table attacks against 6 digit OTP codes.
- Two phase resend coordination prevents stranding users when email delivery fails.
- Complete audit trail of used, unused, invalidated, and expired OTPs retained for 30 days.
- Centralized error formatting eliminates secret leakage, SQL schema exposure, and account enumeration across all routes.
- Request correlation IDs allow rapid operational troubleshooting without exposing internal diagnostics to users.
- Protects the PostgreSQL database and connection pool from exhaustion by avoiding a synchronous database write on every general API read request.

**Cons**:
- In memory general API rate limits are tracked per worker process rather than across an external cluster, giving a slight multiplier if traffic is distributed across workers. For general business traffic at 120 requests per minute, this is acceptable.

### Option 2: Pure PostgreSQL for Every Single API Request

This option routes every incoming HTTP request, including general read queries, through synchronous PostgreSQL `rate_limits` table updates.

**Pros**:
- A single conceptual storage engine for all rate limiting.

**Cons**:
- With default SQLAlchemy pool sizes (max 15 connections), concurrent traffic quickly saturates database connections. Under fail closed rules, connection saturation cascades into a total application outage (HTTP 503).
- Blocks the Uvicorn asyncio event loop during synchronous database round trips on Supabase.

### Option 3: Introduce and Deploy Redis as an External Caching and Rate Limiting Cluster

This option provisions a dedicated Redis instance or managed Redis cluster to handle all rate limiting counters, TTL based sliding windows, and OTP challenge states using atomic Lua scripts.

**Pros**:
- High throughput and sub millisecond latency for high volume rate checks.
- Native TTL key expiration eliminates the need for manual record pruning.

**Cons**:
- Introduces an entirely new external infrastructure component that is not currently deployed, configured, or monitored in the project.
- Adds recurring infrastructure costs, network complexity, and failure modes if Redis loses connectivity.
- Violates the project principle of preferring boring, existing infrastructure before adding external operational dependencies.

## Rationale

Option 1 is selected because it delivers uncompromising security for authentication, robust protection against information leakage, and operational stability for everyday application traffic.

The platform runs on FastAPI and PostgreSQL/Supabase with a 15 connection database pool per worker. Writing to PostgreSQL on every single API request creates severe connection pool contention and latency spikes. By using PostgreSQL atomic tables strictly where durability, cryptographic auditability, and cross worker consistency are mandatory and using worker memory sliding windows for general API protection, the system achieves maximum security without risking connection pool exhaustion.

To protect accounts against denial of service attacks without leaving them vulnerable to distributed brute force, a three tier lockout policy is established:
1. Email and IP combination (Tier 1): 5 failed attempts triggers a 15 minute hard lockout for that specific combination. Even the correct password is rejected with HTTP 429.
2. Email across all IPs (Tier 2): 15 failed attempts across all IPs triggers progressive execution delays (2 to 5 seconds) and mandatory OTP challenge escalation. Crucially, it does not lock out the legitimate account owner who knows the correct password, completely neutralizing the distributed denial of service attack vector.
3. IP across all emails (Tier 3): 30 failed attempts triggers a 15 minute lockout for that IP, defending against credential stuffing across diverse accounts.

Centralizing error handling within `backend/app/core/errors.py` guarantees that raw database errors, third party service exceptions, and debug traces are intercepted and replaced with clean JSON responses. Emitting request correlation IDs connects user facing issues with sanitized server logs, resolving customer support issues while preventing attackers from discovering database schemas, filesystem layouts, or internal service topology.
