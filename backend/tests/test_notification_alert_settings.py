"""
Automated unit and integration tests for Spec 0042:
Company Notification Alert Settings and Service Integration (AC-1 through AC-11).
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import companies as companies_endpoints
from app.api.v1.endpoints import expenses as expenses_endpoints
from app.api.v1.endpoints import notifications as notifications_endpoints
from app.core.cache import system_cache
from app.core.dependencies import get_current_user
from app.core.errors import validation_exception_handler
from app.db.session import Base, get_db
from app.models.audit_log import AuditLog
from app.models.company import Company, CompanyNotificationSettings
from app.models.lending import Borrower
from app.models.loan import Loan
from app.models.notification import Notification, NotificationOutbox
from app.models.user import User, UserCompany
from app.services import company_service, tenant_service
from app.services.notification_service import (
    NotificationService,
    NotificationType,
    run_temporal_due_date_sweep,
)

ADMIN_USER = {
    "auth_user_id": "auth-admin-1",
    "user_id": 1,
    "email": "admin@mct.com",
    "company_id": None,
    "company_ids": [],
    "is_admin": True,
    "role": "admin",
}

FINANCE_USER = {
    "auth_user_id": "auth-finance-2",
    "user_id": 2,
    "email": "finance@mct.com",
    "company_id": None,
    "company_ids": [],
    "is_admin": False,
    "role": "finance",
}

MULTI_COMPANY_SUPERVISOR = {
    "auth_user_id": "auth-sup-10",
    "user_id": 10,
    "email": "sup10@mct.com",
    "company_id": 1,
    "company_ids": [1, 2],
    "is_admin": False,
    "role": "supervisor",
}


@pytest.fixture()
def alert_settings_env(monkeypatch):
    """Set up an isolated in-memory SQLite database and FastAPI TestClient."""
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)

    def _no_supabase():
        raise RuntimeError("Supabase disabled in local SQLite test")

    monkeypatch.setattr(expenses_endpoints, "get_supabase_admin_client", _no_supabase)
    system_cache.clear()

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with SessionLocal() as seed:
        c1 = Company(
            company_id=1,
            company_name="JK Property and Ventures",
            location="Manila",
            starting_balance=Decimal("250000.00"),
        )
        c2 = Company(
            company_id=2,
            company_name="MCT Lending Corp",
            location="Cebu",
            starting_balance=Decimal("250000.00"),
        )
        seed.add_all([c1, c2])

        u_admin = User(user_id=1, email="admin@mct.com", name="Admin", role="admin", is_admin=True)
        u_fin = User(user_id=2, email="finance@mct.com", name="Finance", role="finance", is_admin=False)
        u_sup = User(user_id=10, email="sup10@mct.com", name="Supervisor 10", role="supervisor", company_id=1)
        seed.add_all([u_admin, u_fin, u_sup])
        seed.commit()

        seed.add_all(
            [
                UserCompany(user_id=10, company_id=1),
                UserCompany(user_id=10, company_id=2),
            ]
        )
        seed.commit()

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    holder = {"user": ADMIN_USER}
    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.include_router(companies_endpoints.router, prefix="/api/v1/companies")
    app.include_router(notifications_endpoints.router, prefix="/api/v1/notifications")
    app.include_router(expenses_endpoints.router, prefix="/api/v1/expenses")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]

    client = TestClient(app)
    return client, holder, SessionLocal, engine


def test_lazy_default_provisioning_and_per_company_persistence(alert_settings_env):
    """
    Covers AC-1, AC-2, AC-3, AC-5:
    - GET /api/v1/companies/{id}/notification-settings lazily creates a persistent DB row
      with default values and returns a valid integer id plus snake_case and camelCase keys.
    - PUT /api/v1/companies/{id}/notification-settings updates only that company's preferences.
    - Non-admin users can GET settings for their assigned company but cannot PUT (403).
    """
    client, holder, SessionLocal, _ = alert_settings_env

    # 1. GET Company 1 notification settings (no row exists yet -> lazy creation)
    r1 = client.get("/api/v1/companies/1/notification-settings")
    assert r1.status_code == 200
    body1 = r1.json()
    assert isinstance(body1["id"], int) and body1["id"] > 0
    assert body1["company_id"] == 1
    assert body1["companyId"] == 1
    assert body1["transaction_alerts"] is True
    assert body1["transactionAlerts"] is True
    assert body1["loan_reminders"] is True
    assert body1["loanReminders"] is True
    assert body1["daily_summary"] is False
    assert body1["dailySummary"] is False
    assert body1["audit_alerts"] is True
    assert body1["auditAlerts"] is True

    # Confirm row is persisted in database
    with SessionLocal() as db:
        row = (
            db.query(CompanyNotificationSettings)
            .filter(CompanyNotificationSettings.company_id == 1)
            .first()
        )
        assert row is not None
        assert row.id == body1["id"]

    # 2. Update Company 1 settings via PUT using camelCase keys
    r_put = client.put(
        "/api/v1/companies/1/notification-settings",
        json={
            "transactionAlerts": False,
            "loanReminders": False,
            "dailySummary": True,
            "auditAlerts": False,
        },
    )
    assert r_put.status_code == 200
    updated1 = r_put.json()
    assert updated1["transaction_alerts"] is False
    assert updated1["transactionAlerts"] is False
    assert updated1["loan_reminders"] is False
    assert updated1["daily_summary"] is True
    assert updated1["audit_alerts"] is False

    # 3. Company 2 still has its own independent defaults
    r2 = client.get("/api/v1/companies/2/notification-settings")
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["company_id"] == 2
    assert body2["transaction_alerts"] is True
    assert body2["loan_reminders"] is True
    assert body2["daily_summary"] is False
    assert body2["audit_alerts"] is True

    # 4. Non-admin supervisor cannot PUT notification settings (403 Forbidden)
    holder["user"] = MULTI_COMPANY_SUPERVISOR
    r_forbidden = client.put(
        "/api/v1/companies/1/notification-settings",
        json={"transactionAlerts": True},
    )
    assert r_forbidden.status_code == 403

    # Non-admin supervisor CAN read settings for their assigned company
    r_sup_get = client.get("/api/v1/companies/1/notification-settings")
    assert r_sup_get.status_code == 200
    assert r_sup_get.json()["transaction_alerts"] is False


def test_settings_caching_and_invalidation(alert_settings_env):
    """
    Covers AC-10 and AC-11:
    - Company notification settings are cached in memory under notif_settings:c:{company_id}
      so repeated reads execute 0 SQL queries.
    - Updating settings invalidates both notif_settings:c:{company_id} and notifications cache tags.
    """
    client, _, SessionLocal, engine = alert_settings_env

    # Cold fetch populates cache
    r1 = client.get("/api/v1/companies/1/notification-settings")
    assert r1.status_code == 200
    assert system_cache.get("notif_settings:c:1") is not None

    # Populate a dummy notification cache entry tagged with "notifications"
    system_cache.set("notif:test-scope", ["cached-item"], ttl=300, tags={"notifications"})
    assert system_cache.get("notif:test-scope") == ["cached-item"]

    # Second read of settings hits memory cache with 0 SQL queries
    queries = []

    def count_sql(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    with SessionLocal() as db:
        event.listen(engine, "before_cursor_execute", count_sql)
        try:
            cached_out = company_service.CompanyService.get_notification_settings(db, 1)
        finally:
            event.remove(engine, "before_cursor_execute", count_sql)
        assert cached_out.company_id == 1
        assert len(queries) == 0

    # Updating settings invalidates notif_settings:c:1 and notifications tag
    r_put = client.put(
        "/api/v1/companies/1/notification-settings",
        json={"loan_reminders": False},
    )
    assert r_put.status_code == 200
    assert system_cache.get("notif:test-scope") is None


def test_large_expense_transaction_alert_toggle(alert_settings_env):
    """
    Covers AC-6:
    - When transaction_alerts is True (default), creating an expense >= 50,000 enqueues
      an EXPENSE_LARGE_TRANSACTION event in notification_outbox targeting ["supervisor", "finance"].
    - Expenses < 50,000 do not enqueue a large transaction alert.
    - When transaction_alerts is False for the company, creating an expense >= 50,000
      does NOT enqueue an EXPENSE_LARGE_TRANSACTION event, and existing EXPENSE_LARGE_TRANSACTION
      notifications are filtered out of the company's notification feed.
    """
    client, holder, SessionLocal, _ = alert_settings_env
    today_str = date.today().isoformat()

    # 1. With transaction_alerts=True (default), create an expense of 65,000.00 as supervisor
    holder["user"] = MULTI_COMPANY_SUPERVISOR
    r_exp1 = client.post(
        "/api/v1/expenses",
        json={
            "company_id": 1,
            "category": "Equipment",
            "amount": 65000.00,
            "payment_method": "Bank Transfer",
            "expense_date": today_str,
            "particulars": "Heavy equipment purchase",
        },
    )
    assert r_exp1.status_code == 201

    with SessionLocal() as db:
        outbox_rows = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.company_id == 1,
                NotificationOutbox.event_type == NotificationType.EXPENSE_LARGE_TRANSACTION,
            )
            .all()
        )
        assert len(outbox_rows) == 1
        assert set(outbox_rows[0].target_roles) == {"supervisor", "finance"}
        assert outbox_rows[0].payload["amount"] == pytest.approx(65000.0)

    # 2. Expense below threshold (12,000.00) does not enqueue large transaction alert
    r_exp_small = client.post(
        "/api/v1/expenses",
        json={
            "company_id": 1,
            "category": "Supplies",
            "amount": 12000.00,
            "payment_method": "Cash",
            "expense_date": today_str,
            "particulars": "Routine office supplies",
        },
    )
    assert r_exp_small.status_code == 201

    with SessionLocal() as db:
        count_after_small = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.company_id == 1,
                NotificationOutbox.event_type == NotificationType.EXPENSE_LARGE_TRANSACTION,
            )
            .count()
        )
        assert count_after_small == 1

    # 3. Admin disables transaction_alerts for Company 1
    holder["user"] = ADMIN_USER
    r_disable = client.put(
        "/api/v1/companies/1/notification-settings",
        json={"transaction_alerts": False},
    )
    assert r_disable.status_code == 200

    # Create another large expense of 80,000.00 as supervisor -> must NOT enqueue outbox alert
    holder["user"] = MULTI_COMPANY_SUPERVISOR
    r_exp2 = client.post(
        "/api/v1/expenses",
        json={
            "company_id": 1,
            "category": "Equipment",
            "amount": 80000.00,
            "payment_method": "Bank Transfer",
            "expense_date": today_str,
            "particulars": "Generator unit",
        },
    )
    assert r_exp2.status_code == 201

    with SessionLocal() as db:
        count_after_disabled = (
            db.query(NotificationOutbox)
            .filter(
                NotificationOutbox.company_id == 1,
                NotificationOutbox.event_type == NotificationType.EXPENSE_LARGE_TRANSACTION,
            )
            .count()
        )
        assert count_after_disabled == 1

        # Also verify persistent EXPENSE_LARGE_TRANSACTION notifications are suppressed from feed when disabled
        db.add(
            Notification(
                notification_id="exp-large-notif-1",
                recipient_user_id=10,
                company_id=1,
                notification_type=NotificationType.EXPENSE_LARGE_TRANSACTION,
                title="Large Expense Recorded",
                message="65,000 PHP expense",
                reference_type="expense",
                reference_id=1,
            )
        )
        db.commit()

        svc = NotificationService(db)
        feed_disabled = svc.get_notifications_feed(
            recipient_user_id=10,
            company_id=1,
            user_role="supervisor",
        )
        assert not any(
            n.notification_type == NotificationType.EXPENSE_LARGE_TRANSACTION
            for n in feed_disabled.items
        )


def test_loan_reminders_suppression_in_feed_and_sweep(alert_settings_env):
    """
    Covers AC-7:
    - When loan_reminders is disabled for a company, upcoming and overdue loan/lending
      maturity reminders are suppressed from both live query feeds and temporal due-date sweeps.
    """
    client, holder, SessionLocal, _ = alert_settings_env
    today = date.today()

    with SessionLocal() as db:
        # Seed an overdue approved Loan for Company 1 (borrower=1) and Company 2 (borrower=2)
        db.add_all(
            [
                Loan(
                    loan_ref_no="LN-C1-DUE",
                    lender=2,
                    borrower=1,
                    amount=Decimal("30000.00"),
                    remaining_balance=Decimal("30000.00"),
                    loan_date=today - timedelta(days=15),
                    due_date=today - timedelta(days=1),
                    status="Approved",
                    particulars="Company 1 overdue loan",
                ),
                Loan(
                    loan_ref_no="LN-C2-DUE",
                    lender=1,
                    borrower=2,
                    amount=Decimal("40000.00"),
                    remaining_balance=Decimal("40000.00"),
                    loan_date=today - timedelta(days=15),
                    due_date=today - timedelta(days=1),
                    status="Approved",
                    particulars="Company 2 overdue loan",
                ),
                Borrower(
                    borrower_ref_no="BRW-C1-001",
                    borrower_name="Carlos Mendoza",
                    principal_amount=Decimal("10000.00"),
                    interest_rate=Decimal("5.00"),
                    total_payable=Decimal("10500.00"),
                    total_penalties=Decimal("0.00"),
                    amount_paid=Decimal("0.00"),
                    remaining_balance=Decimal("10500.00"),
                    payment_frequency="Monthly",
                    term_days=30,
                    date_borrowed=today - timedelta(days=35),
                    due_date=today - timedelta(days=2),
                    status="Active",
                ),
            ]
        )
        db.commit()

    # 1. With loan_reminders=True (default), Company 1 supervisor sees LOAN_OVERDUE and LENDING_OVERDUE
    holder["user"] = MULTI_COMPANY_SUPERVISOR
    r_before = client.get("/api/v1/notifications?company_id=1")
    assert r_before.status_code == 200
    types_before = {item["notification_type"] for item in r_before.json()}
    assert "LOAN_OVERDUE" in types_before
    assert "LENDING_OVERDUE" in types_before

    # 2. Admin disables loan_reminders for Company 1
    holder["user"] = ADMIN_USER
    r_toggle = client.put(
        "/api/v1/companies/1/notification-settings",
        json={"loan_reminders": False},
    )
    assert r_toggle.status_code == 200

    # 3. Company 1 supervisor feed now suppresses LOAN_OVERDUE and LENDING_OVERDUE
    holder["user"] = MULTI_COMPANY_SUPERVISOR
    r_after = client.get("/api/v1/notifications?company_id=1")
    assert r_after.status_code == 200
    types_after = {item["notification_type"] for item in r_after.json()}
    assert "LOAN_OVERDUE" not in types_after
    assert "LENDING_OVERDUE" not in types_after

    # 4. Run temporal due-date sweep -> Company 1 loan/lending reminders are skipped while Company 2 is swept
    sweep_stats = run_temporal_due_date_sweep(SessionLocal)
    assert sweep_stats["status"] == "success"
    with SessionLocal() as db:
        c1_swept = (
            db.query(Notification)
            .filter(
                Notification.company_id == 1,
                Notification.notification_type.in_(["LOAN_OVERDUE", "LENDING_OVERDUE"]),
            )
            .count()
        )
        c2_swept = (
            db.query(Notification)
            .filter(
                Notification.company_id == 2,
                Notification.notification_type == "LOAN_OVERDUE",
            )
            .count()
        )
        assert c1_swept == 0
        assert c2_swept >= 1


def test_active_company_scoping_for_multi_company_non_admin_user(alert_settings_env):
    """
    Covers AC-8:
    - Non-admin user assigned to Company 1 and Company 2 only receives notifications matching
      their actively entered company (company_name or company_id), preventing notifications
      from other assigned companies from leaking into the view.
    """
    client, holder, SessionLocal, _ = alert_settings_env
    now = datetime.now(timezone.utc)

    with SessionLocal() as db:
        db.add_all(
            [
                Notification(
                    notification_id="notif-c1-only",
                    recipient_user_id=10,
                    company_id=1,
                    notification_type="BILL_DUE_TODAY",
                    title="JK Property Electric Bill",
                    message="Company 1 bill due",
                    created_at=now,
                ),
                Notification(
                    notification_id="notif-c2-only",
                    recipient_user_id=10,
                    company_id=2,
                    notification_type="BILL_DUE_TODAY",
                    title="MCT Lending Water Bill",
                    message="Company 2 bill due",
                    created_at=now,
                ),
            ]
        )
        db.commit()

    holder["user"] = MULTI_COMPANY_SUPERVISOR

    # Entering Company 2 ("MCT Lending Corp") returns only Company 2 notifications
    r_c2 = client.get("/api/v1/notifications?company_name=MCT%20Lending%20Corp")
    assert r_c2.status_code == 200
    ids_c2 = [n["notification_id"] for n in r_c2.json()]
    assert "notif-c2-only" in ids_c2
    assert "notif-c1-only" not in ids_c2

    # Entering Company 1 ("JK Property and Ventures") returns only Company 1 notifications
    r_c1 = client.get("/api/v1/notifications?company_name=JK%20Property%20and%20Ventures")
    assert r_c1.status_code == 200
    ids_c1 = [n["notification_id"] for n in r_c1.json()]
    assert "notif-c1-only" in ids_c1
    assert "notif-c2-only" not in ids_c1


def test_admin_system_activity_notifications(alert_settings_env):
    """
    Covers AC-9:
    - Admin users receive system events and activity log notices (SYSTEM_ACTIVITY_NOTICE)
      from GET /api/v1/notifications and GET /api/v1/notifications/count.
    """
    client, holder, SessionLocal, _ = alert_settings_env
    holder["user"] = ADMIN_USER

    with SessionLocal() as db:
        db.add(
            AuditLog(
                user_name="Admin",
                user_role="admin",
                action="UPDATE",
                module="SETTINGS",
                details={
                    "company_id": 1,
                    "description": "Updated notification settings for JK Property and Ventures",
                },
                timestamp=datetime.now(timezone.utc),
            )
        )
        db.commit()

    system_cache.clear()

    r_list = client.get("/api/v1/notifications")
    assert r_list.status_code == 200
    items = r_list.json()
    assert len(items) >= 1
    assert any(n["notification_type"] == "SYSTEM_ACTIVITY_NOTICE" for n in items)

    r_count = client.get("/api/v1/notifications/count")
    assert r_count.status_code == 200
    assert r_count.json()["unread_count"] >= 1
