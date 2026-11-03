# Verify: System hardening, persistence unification, and test stabilization · spec 0019 · updated 2026-11-02

_Steps derived from spec 0019 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Submit login request on frontend without `VITE_PAYLOAD_ENCRYPTION_KEY` → payload transmits cleanly over HTTPS and signs in successfully → AC-9
- [x] Connect WebSocket client to `/ws` without authorization token → connection rejected with closure code 1008 → AC-3
- [x] Connect WebSocket client as Supervisor for Company 1, trigger event for Company 2 → socket receives zero messages from Company 2 → AC-4
- [x] Make unauthenticated request to `GET /api/v1/users/1/picture` → returns HTTP 401 Unauthorized → AC-8
- [x] Upload non image file disguised as picture (`.png` extension with text content) → returns HTTP 400 or 422 with invalid image header error → AC-8
- [x] Post logout request with valid bearer token → token hash recorded in `revoked_tokens` table and subsequent use yields HTTP 401 → AC-7
- [x] Submit invalid password repeatedly for a single IP address → lockout recorded in `login_rate_limits` table yielding HTTP 429 → AC-7

## Commands

- [x] `pytest backend/tests` → exits 0 with 48 of 48 tests passing clean → AC-10
- [x] `pytest backend/tests/test_rbac_permissions.py` → verifies central admin, supervisor, and auditor permission boundaries → AC-1, AC-2
- [x] `pytest backend/tests/test_expenses.py` → records expense via SQLAlchemy session with exact Decimal precision → AC-5, AC-6
- [x] `pytest backend/tests/test_notifications.py` → verifies scoped notifications and unread counter queries → AC-4, AC-10
- [x] `pytest backend/tests/test_lending_late_payment.py` → verifies lending service methods and schedules with Decimal precision → AC-6, AC-10
- [x] `pytest backend/tests/test_tenants.py` → verifies tenant CRUD and lease payment histories without SQLite split brain → AC-5, AC-10
- [x] `python -c "from app.core.config import Settings; Settings(SUPABASE_JWT_SECRET='short')"` → raises ValidationError aborting startup → AC-1
- [x] `npm --prefix frontend run build` → builds clean production bundle with zero TypeScript compilation errors → AC-9

## Acceptance criteria coverage

- AC-1 (Secret validation fail fast) covered by config validation command and test_rbac_permissions
- AC-2 (No seeded password loops) covered by test_rbac_permissions and manual auth testing
- AC-3 (WebSocket authentication) covered by manual `/ws` connect verification without token
- AC-4 (Tenant isolation on broadcasts) covered by manual multi company socket broadcast check and test_notifications
- AC-5 (Single relational persistence) covered by test_expenses and test_tenants
- AC-6 (Exact Decimal precision) covered by test_expenses and test_lending_late_payment
- AC-7 (Persistent revoked tokens and rate limits) covered by manual token logout and IP lockout tests
- AC-8 (User picture auth and byte inspection) covered by manual picture request and upload byte check
- AC-9 (Frontend payload encryption deprecation) covered by frontend production build and login form submission
- AC-10 (Clean automated test suite) covered by full `pytest backend/tests` suite

