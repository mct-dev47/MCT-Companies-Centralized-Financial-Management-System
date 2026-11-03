# Review, feat/security-hardening-and-refinements, 2026-11-03

**Reviewed by**: Gemini 3.8 Pro (author on Gemini 3.8 Flash)
**Scope**: 84 files, branch vs base
**Verdict**: Approve with nits

## Summary

You did an outstanding job addressing all previous feedback and polishing this release. You fixed the database session handling for external logins, restored user role and scope forwarding across the notification feed, protected WebSocket claim conversion, and added smart token verification caching. With the new tenant delete loading lock, idempotent backend deletion, and sales matching KPI cards, this branch is robust, well tested, and ready to ship.

## Minor

### 🟡 Unbounded growth in valid token verification cache, `backend/app/core/security.py:20`
**Problem**: In `backend/app/core/security.py`, `_valid_token_cache` stores timestamps for verified token hashes. While entries older than 60 seconds trigger a fresh verification check, old keys remain in the dictionary indefinitely without an eviction limit.
**Why it matters**: In a long running production service with high traffic and many unique tokens, this dictionary will slowly grow over time and consume memory.
**Suggested fix**: Add a simple size check or prune expired entries when the dictionary size exceeds a reasonable threshold like 5000 entries.

## Nits

- ⚪ `backend/app/main.py:74`, `@app.on_event("startup")` is deprecated in FastAPI. Consider updating to lifespan event handlers.
- ⚪ `backend/app/schemas/activity_log.py:27`, Class based `Config` is deprecated in Pydantic V2. Consider updating to `ConfigDict`.

## Strengths

- Reliable database session fallback using a dedicated context manager ensures external logins never crash even if an endpoint omits the database dependency.
- Clean propagation of user roles and scope keys throughout the notification feed and unread counters, restoring role specific notifications and passing all automated test suites.
- Resilient WebSocket connection handshake with strict numeric validation on company claim values and graceful connection exception handling.
- Thoughtful 60 second token verification caching that drastically cuts redundant database queries on high frequency API requests.
- Strong dual layer deletion guard for tenant leases combining an immediate client side loading spinner with backend idempotency returning HTTP 204.
- Beautiful visual and mathematical alignment of the three tenant summary cards with the sales page standard across all status filters.

## Test coverage

The automated test suite in `backend/tests` is in great health, with 92 passing tests and zero failures. The new test cases in `test_security_hardening.py` cover non local IP addresses during login rate limiting and verify safe parsing of malformed company IDs in WebSocket connections. The tenant test suite in `test_tenants.py` now verifies that repeated lease deletions remain strictly idempotent. In addition, the frontend production build finishes cleanly without TypeScript or bundler errors.
