# Review, dev, 2026-11-12

**Reviewed by**: flash (author on pro)
**Scope**: 30 files, branch vs dev
**Verdict**: Approve (all minor findings and nits addressed)

## Summary
This change set prepares the application for production deployment across Render, Vercel, and Supabase by eliminating silent SQLite fallbacks, removing hardcoded admin credentials, enforcing row level concurrency locks across financial models, adding built in 500 and DB crash alerting with rate limiting cooldowns, setting up automated GitHub Actions CI, and hardening Docker and NGINX configurations. All 3 minor findings and 1 nit identified in the review have been addressed and verified by unit tests.

## Resolved Findings
### 🟢 Generic live Supabase project host guard in test safety block, `backend/app/db/supabase.py:21`
**Resolution**: Replaced the hardcoded `_LIVE_PROD_SUPABASE_HOST` constant with a generic check in `_is_blocked_live_supabase_in_test()` that blocks any `.supabase.co` or `.supabase.in` host when `TESTING=1` unless `ALLOW_LIVE_SUPABASE_IN_TEST=1` is set.

### 🟢 Health probe reports "degraded" if Supabase REST API check fails, `backend/app/api/v1/endpoints/health.py:56`
**Resolution**: Updated `/health/db` so `"status"` reports `"degraded"` whenever any check in `database_checks` starts with `"error:"`, while keeping HTTP 503 tied to primary SQLAlchemy connectivity.

### 🟢 Emergency crash alerts survive total DB outages via in memory admin email cache and fallback, `backend/app/core/errors.py:25`
**Resolution**: Added `_last_resolved_admin_email` caching in `resolve_admin_email()` plus fallback to `settings.ADMIN_EMAIL` and `settings.BREVO_FROM_EMAIL`, and updated `backend/.env.production.example` to document setting `ADMIN_EMAIL` for cold start DB outages.

### 🟢 Updated `create_db_engine` docstring, `backend/app/db/session.py:22`
**Resolution**: Updated the docstring to describe the isolated disk backed temporary SQLite file (`mct_test_<pid>.db`) used in `TESTING=1`.

## Strengths
* **Fail Fast Production Engine**: Replacing silent local SQLite fallbacks with a hard `RuntimeError` in production prevents split brain data loss across Render container restarts.
* **Financial Concurrency Hardening**: Adding `.with_for_update()` row locks on `BankAccount`, `Borrower`, and `Receivable` prevents concurrent balance race conditions, overdrafts, and double repayments.
* **Dynamic Admin Resolution and Credential Scrubbing**: Replacing hardcoded personal email addresses across PostgreSQL and SQLite migrations with dynamic `is_admin` role synchronization properly removes personal data and secures migrations.
* **Automated CI Workflow**: Introducing `.github/workflows/ci.yml` provides an automated pre merge safety gate running Python 3.13 pytest and Node 22 lint and build on every pull request to `dev` and `main`.

## Test coverage
* **Excellent**: Comprehensive coverage provided in `backend/tests/test_production_readiness.py` exercising production fail fast enforcement, auto enforced secure cookies, migration 0052 dynamic `is_admin` sync, built in 500 crash alerting with deduplication and cooldown, `/health/db` 503 degradation on DB failure, and `BankService` row level locking.
* Existing regression suites (`test_activity_logs.py`, `test_expenses.py`, `test_lending_late_payment.py`, `test_spec_0024.py`, `test_spec_0030_lending_refinements.py`, `test_user_invitation_resilience.py`) all pass cleanly (56 of 56 tests passing).

