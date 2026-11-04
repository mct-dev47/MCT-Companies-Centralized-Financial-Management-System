# Rationale: System hardening, persistence unification, and test stabilization

**Spec**: 0019
**Date**: 2026-11-02

## Context

A comprehensive code and security audit of the centralized financial management system revealed critical vulnerabilities and architectural fragilities that prevent safe operation.

First, cryptographic operations rely on insecure fallback strings when environment variables are omitted. If JWT secrets or payload encryption keys are missing in production, the application silently defaults to known keys, allowing trivial token forgery and administrative account takeover. Furthermore, authentication logic contains trial loops that attempt seeded test credentials on behalf of users, creating an unauthorized access route.

Second, the persistence layer suffers from an unsound dual write pattern. Write operations first make REST HTTP requests to Supabase PostgREST and subsequently write to local SQLite files via SQLAlchemy. When the local write fails or diverges, errors are swallowed and transactions are silently rolled back on one side only. This lack of atomic transaction guarantees leads to irreconcilable discrepancies in financial ledgers, bank balances, and petty cash accounts.

Third, the WebSocket channel `/ws` does not require authentication and broadcasts all application events globally. Any client connecting to the socket receives financial transactions, bank movements, and audit reviews across all companies regardless of permissions.

Fourth, more than half of the existing backend test suite fails during automated test runs due to missing cache methods, unhandled schema keys, and mock divergences. Addressing these defects now establishes a dependable foundation before containerized deployment pipelines are introduced.

## Options considered

### Option 1: Full hardening with database unification and PostgreSQL state persistence

Eliminate dual writes completely by standardizing on direct PostgreSQL connections through SQLAlchemy. Implement token revocation and rate limit tracking in PostgreSQL tables. Enforce token validation and tenant filtering on WebSocket channels. Remove all fallback secrets and seeded credential loops.

**Pros**:
- Solves all critical vulnerabilities and data integrity risks permanently.
- Requires no additional external services (such as Redis) while supporting multi worker scalability.
- Restores single source of truth for all accounting operations with true ACID transactions.

**Cons**:
- Requires updating database migration scripts and altering existing dual write helper methods across several endpoint files.

### Option 2: Minimal patch of secrets and auth bypasses while retaining dual writes

Patch the hardcoded JWT secret strings, remove seeded password loops, and leave the dual write REST plus SQLite synchronization logic intact.

**Pros**:
- Smaller immediate diff.
- Quicker to write in a single commit.

**Cons**:
- Leaves the primary cause of financial ledger drift, race conditions, and double network latency unaddressed.
- Fails to fix the core root causes of test suite failures.

## Rationale

Relying on a secondary SQLite database to back up remote Supabase REST writes creates an illusion of resilience while in reality introducing data split brain scenarios. In accounting systems, consistency and atomicity trump best effort synchronization. Standardizing on direct pooled PostgreSQL connections guarantees transaction integrity.

Similarly, storing revoked tokens and rate limits in Python in memory sets breaks immediately when running multiple server workers. Storing these transient security records in PostgreSQL tables provides multi process reliability without requiring an external Redis cluster at this stage.

## References

- RFC 7519: JSON Web Token (JWT)
- OWASP Top 10 API Security Risks: Broken Object Level Authorization and Security Misconfiguration
- SQLAlchemy Connection Pooling Documentation

