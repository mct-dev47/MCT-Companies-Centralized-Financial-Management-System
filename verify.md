# Verify Company Notification Alert Settings and Service Integration

You can use these steps to check the new notification alert settings and service integration at your own pace. Feel free to run all of them or skip any step you do not need right now.

## 1. Run the Automated Backend Test Suite

- [x] Run `pytest backend/tests/test_notification_alert_settings.py -v` -> 6 passed in `test_notification_alert_settings.py` (`AC-1` through `AC-11`)
- [x] Run `pytest backend/tests/test_migrations.py backend/tests/test_event_driven_notifications.py -v` -> 14 passed (`test_forward_migration_applies_cleanly`, `test_migration_idempotency`, and all 12 event driven notification tests)

```powershell
pytest backend/tests/test_notification_alert_settings.py -v
pytest backend/tests/test_migrations.py backend/tests/test_event_driven_notifications.py -v
```

## 2. Check the Settings Page Toggles and Company Switching (AC-1, AC-2, AC-3, AC-4, AC-5)

- [x] **AC-1 & AC-5**: `GET /api/v1/companies/1/notification-settings` lazily provisions a persistent row in `company_notification_settings` (`id=1`, `transaction_alerts=True`, `loan_reminders=True`, `daily_summary=False`, `audit_alerts=True`) and `SettingsPage.tsx` calls `loadNotificationSettingsForCompany` on initial company load.
- [x] **AC-2**: Switching companies in `SettingsPage.tsx` calls `loadNotificationSettingsForCompany(comp.id)` and `GET /api/v1/companies/2/notification-settings` returns Company 2 independent settings (`id=2`).
- [x] **AC-3**: Clicking **Save Changes** in `SettingsPage.tsx` runs `Promise.all([updateCompany, updateCompanyNotificationSettings])` via `PUT /api/v1/companies/1/notification-settings` (HTTP 200) and calls `notifyNotificationsUpdated()`.
- [x] **AC-4**: Clicking **Discard** in `SettingsPage.tsx` (`handleDiscardChanges`) restores `transactionAlerts`, `loanReminders`, `dailySummary`, and `auditAlerts` from `savedNotificationSettings`.

## 3. Check Large Expense Alerts and Loan Reminder Filtering (AC-6, AC-7)

- [x] **AC-6**: With `transaction_alerts=True`, `POST /api/v1/expenses` for 60000 pesos returns HTTP 201 and enqueues 1 `EXPENSE_LARGE_TRANSACTION` event in `notification_outbox` targeting `["supervisor", "finance"]`. With `transaction_alerts=False`, `POST /api/v1/expenses` for 75000 pesos returns HTTP 201 and enqueues 0 new outbox alerts, while suppressing `EXPENSE_LARGE_TRANSACTION` from the company feed.
- [x] **AC-7**: With `loan_reminders=True`, `GET /api/v1/notifications?company_id=1` returns `LOAN_OVERDUE`, `LENDING_OVERDUE`, and `LENDING_INSTALLMENT_OVERDUE`. With `loan_reminders=False`, those due date reminders are suppressed from both the live notification feed and `run_temporal_due_date_sweep`.

## 4. Check Active Company Scoping, Admin Bell Visibility, and Caching (AC-8, AC-9, AC-10, AC-11)

- [x] **AC-8**: Non admin user assigned to Company 1 and Company 2 requesting `GET /api/v1/notifications?company_name=MCT%20Lending%20Corp` receives only Company 2 notifications (`c1_leaked=False`), and `NotificationBell.tsx` scopes `scopedCompanyName` to `activeCompany || user?.assignedCompany || 'All Companies'`.
- [x] **AC-9**: `TopHeader.tsx` and `NotificationBell.tsx` render the notification bell for Administrator accounts, and `GET /api/v1/notifications` as Admin returns `SYSTEM_ACTIVITY_NOTICE` items (`unread_count >= 1`).
- [x] **AC-10**: `PUT /api/v1/companies/1/notification-settings` invalidates both `notif_settings:c:1` and the `notifications` cache tag (`notifications_cache_invalidated=True`).
- [x] **AC-11**: Warm cache read on `GET /api/v1/companies/1/notification-settings` executes 0 SQL queries against `company_notification_settings` (300s TTL), and `NotificationBell.tsx` pauses its 30s polling interval when `document.hidden` is true.
