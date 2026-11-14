# 0042. Company Notification Alert Settings and Service Integration

**Date**: 2026-11-14
**Status**: In Progress

## Summary

This specification connects the Notification Alerts controls in the admin Settings page to the backend notification engine. The existing switches were only local browser state, so changing them never saved to the database or shaped real notifications. We add a company notification settings table, REST endpoints to load and save alert preferences per company, and filter the notification feed by those rules. The architecture relies on asynchronous outbox dispatch and in memory caching to keep transactions fast and protect the database from query burnout.

## Context

The administrative Settings screen displays four notification alert toggles under the Notification Alerts card. These controls cover large transaction warnings over 50000 pesos, loan maturity reminders three days prior to due dates, daily financial digests, and audit status change updates.

An audit of the codebase revealed that these toggles exist purely in React component state. When an administrator clicks Save Changes, the frontend sends company profile fields to the company update endpoint and drops all notification settings. Whenever the user reloads the page or selects a different company from the dropdown filter, the switches reset to hardcoded defaults.

Furthermore, the backend lacks any database table, model, schema, or endpoint for persisting alert preferences. In the notification service, alerts are created without checking whether a company has enabled or disabled them. In addition, the notification endpoints currently return empty lists for admin users and `TopHeader.tsx` hides the bell for admins, preventing admins from seeing system health and activity log notices in their own navigation bar.

Finally, financial operations like recording expenses must never be slowed down by alert generation. Heavy database queries or rapid client polling could easily overload the Supabase database connection pool. The system requires an asynchronous, cached architecture that avoids database burnout.

## Requirements

**User stories**:
- As an administrator, I want to configure alert toggles for each company in Settings and persist them to the database so that alert rules match our operational needs.
- As a company supervisor or finance user, I want to receive in app notifications that respect my company settings so that our team only receives alerts we opted into.
- As an administrator, I want my notification bell to show system health and activity log events while keeping company financial notifications scoped to company personnel.
- As a system engineer, I want notification generation to run asynchronously and leverage in memory caching so that normal financial saves complete without delay and database query load remains low.

**Acceptance criteria**:
- **AC-1**: Navigating to the Settings page loads the stored alert preferences for the currently selected company from `GET /api/v1/companies/{company_id}/notification-settings`.
- **AC-2**: Selecting another company in the company filter dropdown reloads and displays the specific alert preferences for that company.
- **AC-3**: Modifying alert switches and clicking Save Changes updates the company alert settings via `PUT /api/v1/companies/{company_id}/notification-settings`, displaying a success notification.
- **AC-4**: Clicking Discard reverts all unsaved switch changes back to the company values previously fetched from the database.
- **AC-5**: If a company has no custom settings record yet, the `GET` endpoint lazily provisions a persistent row with default settings (transaction alerts enabled, loan reminders enabled, daily summary disabled, and audit alerts enabled) and returns it with a valid record identifier.
- **AC-6**: When transaction alerts are disabled for a company, expenses or withdrawals exceeding 50000 pesos do not produce large transaction alert notifications. When enabled, creating an expense of 50000 pesos or more enqueues an `EXPENSE_LARGE_TRANSACTION` alert targeted to company supervisors and finance users without blocking the expense save transaction.
- **AC-7**: When loan reminders are disabled for a company, upcoming loan and lending maturity reminders are suppressed from both generation sweeps and live query feeds for that company.
- **AC-8**: Non admin users only receive notifications matching their actively entered company, preventing notifications from other assigned companies from leaking into the view.
- **AC-9**: Admin users see the notification bell in the navigation bar populated with system events and activity log notices rather than an empty feed, and `TopHeader.tsx` renders the bell for administrator accounts.
- **AC-10**: Updating company notification settings automatically invalidates cached notification feeds and settings keys for that company so changes take effect immediately.
- **AC-11**: Company notification settings are cached in memory on the server for 300 seconds, and the client notification service pauses polling when browser tabs are inactive, preventing database query burnout.

## Options considered

### Option 1: Dedicated company notification settings table with sub resource REST endpoints, asynchronous outbox, and in memory caching

Store alert settings in a separate table named `company_notification_settings` linked to the company table with a unique foreign key index. Provide dedicated `GET` and `PUT` endpoints under `/api/v1/companies/{company_id}/notification-settings`. Cache settings in memory on the server, evaluate large transaction alerts asynchronously via the outbox queue, and deliver updates in real time over WebSockets.

**Pros**:
- Keeps company business profile fields clean and decoupled from operational alert flags.
- Asynchronous dispatch keeps expense saves and daily transactions fast without blocking HTTP responses.
- In memory caching ensures reading settings takes less than one millisecond with zero database queries.
- Clean RESTful design where company profile updates and alert configuration remain distinct.

**Cons**:
- Requires an additional database migration and one extra API route.

### Option 2: Add notification columns directly to the company table with synchronous generation

Add four boolean columns (`transaction_alerts`, `loan_reminders`, `daily_summary`, `audit_alerts`) directly to the existing `company` database table and evaluate alerts synchronously inside the expense endpoint.

**Pros**:
- Saves company profile data and alert flags in a single SQL query.
- No new route files required in the backend API router.

**Cons**:
- Bloats the company table with operational messaging preferences.
- Synchronous notification creation during expense writes risks slowing down critical payment flows.
- Every company query retrieves alert flags even when only displaying basic company names or cards.

### Option 3: Store alert flags as a loose JSON blob inside the company table

Add a generic JSON column named `settings` to the company table and store alert keys inside it.

**Pros**:
- Allows arbitrary key value pairs without writing schema migrations for future toggles.

**Cons**:
- Lacks database level column constraints, type safety, and default value enforcement.
- Increases the risk of silent bugs caused by misspelled keys.

## Decision

**Chosen option**: Option 1: Dedicated company notification settings table with sub resource REST endpoints, asynchronous outbox, and in memory caching.

We establish a dedicated `company_notification_settings` table and provide dedicated `GET` and `PUT` endpoints under `/api/v1/companies/{company_id}/notification-settings`. We protect the database by serving settings from in memory cache, evaluating alerts asynchronously, and pushing live events over WebSockets.

**Implementation skills**: None

## Rationale

Option 1 provides clean modularity, optimal speed, and strong stability for the MCT system. Company identity data like location, contact numbers, and starting balance belong to the core organization domain, whereas alert toggles govern message dispatch and background sweeps. Separating them prevents schema pollution. Serving settings from memory removes repetitive database reads. Using the existing transactional outbox ensures that saving an expense is never delayed by notification logic.

## Feature design

**Data model sketch**:

Table name: `company_notification_settings`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | Integer | Primary key, autoincrement | Record identifier |
| `company_id` | Integer | Foreign key to `company.company_id`, unique, not null, on delete cascade | The target company |
| `transaction_alerts` | Boolean | Not null, default True | Toggle for expenses exceeding 50000 pesos |
| `loan_reminders` | Boolean | Not null, default True | Toggle for loan maturity advance reminders |
| `daily_summary` | Boolean | Not null, default False | Toggle for end of day financial digest |
| `audit_alerts` | Boolean | Not null, default True | Toggle for transaction audit status changes |
| `created_at` | DateTime(timezone=True) | Server default now(), not null | Record creation timestamp |
| `updated_at` | DateTime(timezone=True) | Server default now(), on update now(), not null | Record update timestamp |

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/v1/companies/{company_id}/notification-settings` | GET | `company_id: int` | `CompanyNotificationSettingsOut` JSON with camelCase and snake_case alias support | Bearer (Company access or Admin) | 401, 403, 404 |
| `/api/v1/companies/{company_id}/notification-settings` | PUT | `company_id: int`, `CompanyNotificationSettingsUpdate` body | `CompanyNotificationSettingsOut` JSON | Bearer (Admin only) | 401, 403, 404, 422 |
| `/api/v1/notifications` | GET | `company_id: int` optional, `cursor: str` optional | `NotificationListResponse` or list | Bearer (Filtered by active company) | 401, 403 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Load Settings Page | Switch states for 4 alert toggles | Read from `GET /api/v1/companies/{id}/notification-settings` (served from memory cache or database) |
| Save Changes | Persisted boolean flags | Sent from user switch values via `PUT` endpoint |
| Expense Creation | Large transaction notification (`EXPENSE_LARGE_TRANSACTION`) | Evaluated from expense amount $\ge$ 50000 and cached `transaction_alerts` setting, enqueued asynchronously |
| Due Date Sweep | Loan due reminders | Evaluated if days to maturity is within 3 and `loan_reminders` is True |
| Notification Bell | List of unread alerts | Filtered by company settings and user entered company scope |
| Admin Bell View | System alerts and activity log events | Filtered by system events and audit severity, bypassing company financial scoping |

**Asynchronous processing and database protection mechanisms**:

1. **Asynchronous Outbox Dispatch**:
   When an expense exceeding 50000 pesos is created, the system checks the company cached setting. If enabled, it writes a small record to `notification_outbox` within the same database transaction. No heavy recipient lookups or notification sweeps run synchronously during the HTTP request. The outbox processor handles recipient distribution in the background, keeping the expense API response instant.

2. **In Memory Caching on the Server**:
   The company notification settings are cached in `system_cache` with a key format of `notif_settings:c:{company_id}` and a five minute expiration window. Any `PUT` request to update settings immediately deletes this cache key. As a result, checking settings during expense creation or notification sweeps takes less than one millisecond and hits RAM rather than the database.

3. **Client Side Deduplication and Request Throttling**:
   `notificationService.ts` maintains an in flight promise registry and a ten second local memory cache. If multiple components request notifications simultaneously, only one network request fires. In addition, when the user switches browser tabs or minimizes the window, polling is automatically paused to prevent useless background requests.

4. **Real Time WebSocket Event Push**:
   When notifications are created, the server broadcasts an event frame through the authenticated WebSocket connection (`/ws`). Connected clients receive the alert immediately and refresh their view without needing rapid short interval polling against the database.

5. **PostgreSQL Advisory Locks for Background Sweeps**:
   The temporal due date sweep uses transaction scoped advisory locks (`pg_try_advisory_lock`). If multiple server processes or container instances are running, only one worker can execute the sweep at any given minute, preventing duplicate database load and lock contention.

**Key invariants**:
- Exactly one `company_notification_settings` row exists per company.
- If no record exists when requested, the `GET` endpoint lazily provisions default values with a real identifier.
- Deleting a company cascades and deletes its notification settings row.
- Non admin users only see notifications for the company they currently entered in the UI.
- Admins see system alerts and audit activity logs, while financial notifications remain company scoped.
- Modifying alert settings purges cached notification keys (`notifs_v2:*`) and settings cache (`notif_settings:*`) for that company.

**Security model**:
- Reading notification settings requires authentication and access to that company (or admin role).
- Updating notification settings is restricted to administrator accounts.
- Scoping ensures users cannot inspect or modify alert configurations for unauthorized companies.

**Configuration required**: None

## Critical test scenarios

- **Scenario 1 (AC-1, AC-5)**: Given a company without prior custom settings, requesting its settings lazily creates and returns the default flags (True, True, False, True) with an integer primary key.
- **Scenario 2 (AC-2, AC-3, AC-10)**: Changing switches for Company A, saving, and switching to Company B displays Company B preferences. Switching back to Company A preserves the modified values, and caches are cleared.
- **Scenario 3 (AC-4)**: Toggling switches without clicking Save Changes, then clicking Discard, reverts all toggles to the database values.
- **Scenario 4 (AC-6, AC-11)**: Recording an expense of 75000 pesos when transaction alerts are enabled enqueues an `EXPENSE_LARGE_TRANSACTION` alert asynchronously without delaying the expense response. When disabled, no alert is enqueued.
- **Scenario 5 (AC-7)**: Running the reminder sweep for a company with loan reminders disabled suppresses loan due date notifications for that company across persistent rows and dynamic fallbacks.
- **Scenario 6 (AC-8)**: A user assigned to both Company A and Company B, but currently viewing Company A, only receives notifications belonging to Company A.
- **Scenario 7 (AC-9)**: Admin accounts can view system and activity notifications in the top navigation bar bell, and `TopHeader.tsx` shows the bell for admins.
- **Scenario 8 (AC-10, AC-11)**: Repeated requests to read settings for a company hit the in memory cache without issuing new SQL queries. Updating settings clears the cache.

## Build plan

Following the Tracer Bullet approach, we build a thin vertical thread through database, backend API, and frontend settings first, then wire the asynchronous notification filtering logic.

- [x] **Task 1 (AC-1, AC-5)**: Create the SQLAlchemy model `CompanyNotificationSettings` and database migration in `backend/app/models/company.py` and `backend/migrations/`.
- [x] **Task 2 (AC-1, AC-3, AC-5, AC-10, AC-11)**: Implement Pydantic schemas in `backend/app/schemas/notification.py` and service functions with `GET` and `PUT` endpoints in `backend/app/api/v1/endpoints/companies.py`, including in memory caching and cache invalidation.
- [x] **Task 3 (AC-1, AC-2, AC-3, AC-4)**: Connect `SettingsPage.tsx` and `employeeService.ts` to load, display, save (via `Promise.all`), and discard company notification settings based on the selected company dropdown.
- [x] **Task 4 (AC-6, AC-7, AC-11)**: Update `backend/app/services/notification_service.py` and expense creation logic to check cached company alert preferences and enqueue large transaction alerts asynchronously via `notification_outbox`.
- [x] **Task 5 (AC-8, AC-9)**: Refactor `NotificationBell.tsx`, `TopHeader.tsx`, and `backend/app/api/v1/endpoints/notifications.py` to allow admin system notifications and strictly enforce entered company scoping for company staff.
- [x] **Task 6 (AC-1 through AC-11)**: Write unit and integration tests covering the new endpoints, settings persistence, cache hits, asynchronous outbox dispatch, and alert suppression rules.

## Consequences

**Positive**:
- Settings switches become functional, reliable, and persistent across page reloads.
- Asynchronous outbox dispatch prevents any slowdown or latency during expense and transaction saves.
- In memory caching ensures settings checks consume zero database queries during high volume operations.
- Company managers and supervisors no longer suffer from notification noise they wish to turn off.
- Admins gain visibility into system level notices via the navigation bar.

**Negative**:
- Adds one new database table and query overhead during the initial cache warm up read.

**Neutral**:
- Companies continue using sensible defaults until an admin explicitly alters them.

## Follow up

- Coordinate running database migrations in production environments.
- Monitor notification bell performance to ensure cached queries remain fast.
