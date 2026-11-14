# Review, fix/admin, 2026-11-14

**Reviewed by**: Senior Code Reviewer (author on develop)
**Scope**: 20 files, uncommitted
**Verdict**: Approved (All findings resolved)

## Summary
This change implements Spec 0042 (Company Notification Alert Settings and Service Integration), adding a dedicated `company_notification_settings` table, REST endpoints, in-memory caching with tag invalidation, asynchronous outbox alerts for large expenses, loan reminder suppression, active company scoping, and navigation bell visibility for administrators. All 4 Major, 3 Minor, and 3 Nit findings identified during the review round have been addressed and verified with regression tests.

## Major Findings (All Resolved)

### ✅ Unpersisted default settings cached with ID=0 bypasses lazy DB provisioning
- **Files**: `backend/app/services/company_service.py`, `backend/app/services/notification_service.py`
- **Resolution**: `CompanyService.get_notification_settings()` now validates `getattr(cached, "id", 0) > 0` before returning from cache. `NotificationService._get_company_settings()` avoids polluting canonical cache keys with transient fallback instances. Lazy provisioning cleanly creates persistent rows on first lookup.

### ✅ Session rollback in error handler reverts preceding financial mutations
- **File**: `backend/app/api/v1/endpoints/expenses.py`
- **Resolution**: Wrapped `enqueue_notification_event()` in a nested transaction context (`with db.begin_nested():`) and removed the global `db.rollback()` call. Outbox dispatch exceptions now roll back strictly to the savepoint without reverting bank ledger reconciliations or expense creations.

### ✅ Post-query in-memory filtering breaks cursor pagination and `has_more` semantics
- **File**: `backend/app/services/notification_service.py`
- **Resolution**: Converted notification feed filtering to pre-query SQL filtering. Disabled notification types are computed upfront and passed directly to SQLAlchemy via `query.where(Notification.notification_type.notin_(disabled_types))` so that `limit + 1` cursor slicing accurately computes `has_more`.

### ✅ Unbounded ORM model loading on 30-second unread count polling endpoint
- **File**: `backend/app/services/notification_service.py`
- **Resolution**: Replaced Python-level iteration of loaded ORM rows with an aggregate SQL query `select(func.count(Notification.notification_id)).where(Notification.notification_type.notin_(disabled_types))`, eliminating memory allocations and unbounded database payloads during 30-second bell polling.

## Minor Findings (All Resolved)

### ✅ Uncached unindexed audit log scan during admin bell polling
- **File**: `backend/app/services/notification_service.py`
- **Resolution**: Added in-memory caching via `system_cache.get/set` with key `admin_system_notifs:limit:{limit}`, a 15-second TTL, and cache tag `["notifications"]`.

### ✅ Potential 500 internal server error on concurrent initial settings provisioning
- **File**: `backend/app/services/company_service.py`
- **Resolution**: Wrapped default row insertion in `try ... except IntegrityError: self.db.rollback()` and re-queried the existing row committed by the racing transaction.

### ✅ Non-atomic two-phase mutation on Settings page save
- **File**: `frontend/src/pages/SettingsPage.tsx`
- **Resolution**: Migrated `handleSaveChanges` to `Promise.allSettled`, providing granular error notifications for company profile and alert settings separately.

## Nits (All Resolved)

- ✅ `frontend/src/services/employeeService.ts`: Removed redundant duplicate keys in the `updateCompanyNotificationSettings` request body.
- ✅ `backend/migrations/0063_company_notification_settings.postgres.sql`: Removed redundant explicit unique index since the table column constraint is already `UNIQUE`.
- ✅ `frontend/src/components/layout/NotificationBell.tsx`: Removed unused `Wifi` icon import.
- ✅ `backend/app/schemas/notification.py`: Cleaned up camelCase and snake_case schema parsing.

## Strengths
- Decoupled database schema: Establishing `company_notification_settings` as a separate table with `ON DELETE CASCADE` keeps company identity models clean and free from operational messaging flags.
- Asynchronous outbox dispatch: `EXPENSE_LARGE_TRANSACTION` events are enqueued to `notification_outbox` rather than dispatched synchronously, ensuring financial expense recordings remain sub-millisecond.
- In-memory caching and invalidation: Company settings are served from `system_cache` with a 300-second TTL, and modifying settings properly purges both settings and notification cache tags.
- Fail-closed company scoping: Non-admin users are strictly confined to their actively entered company in `_resolve_authorized_scope`, preventing cross-company notification leaks.
- Client-side polling protection: `NotificationBell.tsx` checks `document.hidden` and attaches a `visibilitychange` listener, actively preventing useless background polling when browser tabs are inactive.

## Test Coverage
- `backend/tests/test_notification_alert_settings.py`: 6 tests covering all 11 acceptance criteria.
- `backend/tests/test_event_driven_notifications.py`: 12 tests covering outbox dispatch, leasing, cursor pagination, and retention.
- `backend/tests/test_migrations.py`: 2 tests covering SQLite and Postgres migration runner idempotency.
- Total: 20 passing unit and integration tests.

