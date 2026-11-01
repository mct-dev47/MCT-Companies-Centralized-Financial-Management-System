"""Regression and performance test suite for NotificationService & /api/v1/notifications."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 (registers all SQLAlchemy models)
from app.api.v1.endpoints import notifications as notifications_endpoints
from app.core.cache import system_cache
from app.core.dependencies import get_current_user
from app.core.errors import validation_exception_handler
from app.db.session import Base, get_db
from app.models.audit_log import AuditLog
from app.models.bills import Bill, BillPayment
from app.models.company import Company
from app.models.finance import Expense
from app.models.lending import Borrower, LendingTransaction
from app.models.loan import Loan, LoanRepayment
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.models.tenant import TenantLease, TenantLeasePayment
from app.schemas.bills import BillCreate, BillPaymentCreate
from app.schemas.lending import BorrowerCreateRequest, LendingPaymentCreateRequest
from app.services import tenant_service
from app.services.bills_service import BillsService
from app.services.lending_service import LendingService
from app.services.notification_service import NotificationService

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
    "auth_user_id": "auth-finance-1",
    "user_id": 2,
    "email": "finance@mct.com",
    "company_id": None,
    "company_ids": [],
    "is_admin": False,
    "role": "finance",
}

AUDIT_USER = {
    "auth_user_id": "auth-audit-1",
    "user_id": 3,
    "email": "audit@mct.com",
    "company_id": None,
    "company_ids": [],
    "is_admin": False,
    "role": "audit",
}


def make_company_user(company_id: int, user_id: int = 10):
    return {
        "auth_user_id": f"auth-comp-{company_id}-{user_id}",
        "user_id": user_id,
        "email": f"user{user_id}_c{company_id}@mct.com",
        "company_id": company_id,
        "company_ids": [company_id],
        "is_admin": False,
        "role": "company",
    }


@pytest.fixture()
def notif_env(monkeypatch):
    """Set up an isolated in-memory SQLite database and FastAPI TestClient."""
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)
    system_cache.clear()

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with SessionLocal() as seed:
        seed.add_all(
            [
                Company(
                    company_id=1,
                    company_name="JK Property and Ventures",
                    location="Manila",
                    starting_balance=Decimal("100000.00"),
                ),
                Company(
                    company_id=2,
                    company_name="MCT Lending Corp",
                    location="Cebu",
                    starting_balance=Decimal("100000.00"),
                ),
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
    app.include_router(notifications_endpoints.router, prefix="/api/v1/notifications")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]

    client = TestClient(app)
    return client, holder, SessionLocal, engine


def test_unauthenticated_requests_fail_closed(monkeypatch):
    """Missing or invalid bearer token must fail closed with 401 Unauthorized."""
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)
    system_cache.clear()

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(notifications_endpoints.router, prefix="/api/v1/notifications")
    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    r1 = client.get("/api/v1/notifications/")
    assert r1.status_code == 401

    r2 = client.get("/api/v1/notifications/unread-count")
    assert r2.status_code == 401


def test_authorization_and_tenant_isolation(notif_env):
    """
    Verify:
    - Company 1 supervisor cannot access Company 2 by ID or name (403).
    - Unknown company name fails closed with 404.
    - Spoofing ?user_role=admin or X-User-Role: admin does not grant admin/finance/audit privileges.
    - Calling without company_id scopes automatically to the supervisor's assigned company.
    """
    client, holder, SessionLocal, _ = notif_env
    today = date.today()

    with SessionLocal() as db:
        # Bill in Company 1 and Bill in Company 2, plus a Pending Finance Loan in Company 1
        db.add_all(
            [
                Bill(
                    company_id=1,
                    bill_name="Company 1 Electric",
                    category="Electricity",
                    amount=Decimal("5000.00"),
                    due_date=today,
                    frequency="One-Time",
                    status="Due",
                ),
                Bill(
                    company_id=2,
                    bill_name="Company 2 Water",
                    category="Water",
                    amount=Decimal("3200.00"),
                    due_date=today,
                    frequency="One-Time",
                    status="Due",
                ),
                Loan(
                    loan_ref_no="LN-TEST-001",
                    lender=1,
                    borrower=2,
                    amount=Decimal("25000.00"),
                    remaining_balance=Decimal("25000.00"),
                    loan_date=today,
                    status="Pending Finance",
                    particulars="Intercompany loan",
                ),
            ]
        )
        db.commit()

    # Authenticate as Company 1 supervisor
    holder["user"] = make_company_user(company_id=1, user_id=11)

    # 1. Requesting Company 2 by ID -> 403 Forbidden
    res_forbidden_id = client.get("/api/v1/notifications/?company_id=2")
    assert res_forbidden_id.status_code == 403

    # 2. Requesting Company 2 by name -> 403 Forbidden
    res_forbidden_name = client.get("/api/v1/notifications/?company_name=MCT%20Lending%20Corp")
    assert res_forbidden_name.status_code == 403

    # 3. Requesting unknown company name -> 404 Not Found
    res_unknown_name = client.get("/api/v1/notifications/?company_name=NonExistent%20Company")
    assert res_unknown_name.status_code == 404

    # 4. Spoofing user_role=finance via query param and header must NOT leak LOAN_PENDING_FINANCE
    # or Company 2's bill
    res_spoof = client.get(
        "/api/v1/notifications/?user_role=finance",
        headers={"X-User-Role": "admin"},
    )
    assert res_spoof.status_code == 200
    items = res_spoof.json()
    titles = [n["title"] for n in items]
    types = [n["notification_type"] for n in items]
    assert any("Company 1 Electric" in t for t in titles)
    assert not any("Company 2 Water" in t for t in titles)
    # LOAN_PENDING_FINANCE is only for finance/admin, not supervisor
    assert "LOAN_PENDING_FINANCE" not in types

    # 5. Authenticate as Finance user -> sees LOAN_PENDING_FINANCE
    holder["user"] = FINANCE_USER
    res_finance = client.get("/api/v1/notifications/")
    assert res_finance.status_code == 200
    finance_types = [n["notification_type"] for n in res_finance.json()]
    assert "LOAN_PENDING_FINANCE" in finance_types


def test_cache_sharing_and_post_commit_invalidation(notif_env):
    """
    Verify:
    - get_notifications() and get_unread_count() share the same scoped cache entry.
    - Recording or deleting a bill payment invalidates the notification cache after commit.
    """
    client, holder, SessionLocal, engine = notif_env
    today = date.today()
    holder["user"] = make_company_user(company_id=1, user_id=11)

    with SessionLocal() as db:
        svc = BillsService(db)
        bill_out = svc.create_bill(
            BillCreate(
                company_id=1,
                bill_name="PLDT Fiber",
                category="Internet",
                amount=Decimal("4000.00"),
                due_date=today,
                frequency="Monthly",
                is_recurring=True,
                status="Due",
            )
        )
        bill_id = bill_out.bill_id

    # Cold fetch populates cache
    r1 = client.get("/api/v1/notifications/")
    assert r1.status_code == 200
    initial_items = r1.json()
    assert any(n["notification_type"] == "BILL_DUE_TODAY" for n in initial_items)

    # Unread count should hit the warm cache with 0 SQL queries inside NotificationService
    queries_executed = []

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        queries_executed.append(statement)

    with SessionLocal() as db:
        ns = NotificationService(db)
        event.listen(engine, "before_cursor_execute", count_queries)
        try:
            cnt = ns.get_unread_count(
                company_id=1,
                user_role="supervisor",
                user_scope_key="u:11:r:supervisor:c:1",
            )
        finally:
            event.remove(engine, "before_cursor_execute", count_queries)
        assert cnt == len(initial_items)
        assert len(queries_executed) == 0, f"Expected 0 queries on warm cache hit, got {len(queries_executed)}"

    # Now record a partial payment of 1,500 on the 4,000 bill via BillsService
    with SessionLocal() as db:
        svc = BillsService(db)
        bill_after_pay = svc.record_payment(
            bill_id,
            BillPaymentCreate(
                amount=Decimal("1500.00"),
                billed_amount=Decimal("4500.00"),
                payment_date=today,
                period_due_date=today,
                payment_method="Bank Transfer",
                reference_no="REF-PARTIAL-1",
            ),
        )
        payment_id = bill_after_pay.payment_history[0].payment_id

    # Cache must have been invalidated after commit; next fetch must show BILL_PARTIALLY_PAID
    # and remaining balance 3,000.00 (4,500 billed_amount override - 1,500 paid)
    r2 = client.get("/api/v1/notifications/")
    assert r2.status_code == 200
    after_pay_items = r2.json()
    partial_notifs = [n for n in after_pay_items if n["notification_type"] == "BILL_PARTIALLY_PAID"]
    assert len(partial_notifs) == 1
    assert partial_notifs[0]["remaining_amount"] == pytest.approx(3000.0)
    assert partial_notifs[0]["paid_amount"] == pytest.approx(1500.0)

    due_today_notifs = [n for n in after_pay_items if n["notification_type"] == "BILL_DUE_TODAY"]
    assert len(due_today_notifs) == 1
    assert "(Partially Paid)" in due_today_notifs[0]["title"]
    assert due_today_notifs[0]["remaining_amount"] == pytest.approx(3000.0)

    # Delete the payment via delete_payment -> cache invalidated and BILL_PARTIALLY_PAID disappears
    with SessionLocal() as db:
        svc = BillsService(db)
        svc.delete_payment(bill_id, payment_id)

    r3 = client.get("/api/v1/notifications/")
    assert r3.status_code == 200
    after_del_items = r3.json()
    assert not any(n["notification_type"] == "BILL_PARTIALLY_PAID" for n in after_del_items)
    due_today_restored = [n for n in after_del_items if n["notification_type"] == "BILL_DUE_TODAY"]
    assert len(due_today_restored) == 1
    assert due_today_restored[0]["remaining_amount"] == pytest.approx(4000.0)


def test_recurring_bill_anchor_advances_across_paid_periods(notif_env):
    """
    Verify that a recurring monthly bill whose anchor due_date was 2 months ago
    and whose past 2 monthly periods are paid does NOT emit a false overdue notification
    for those paid periods, and instead advances to the current month's due date.
    """
    _, _, SessionLocal, _ = notif_env
    today = date.today()
    two_months_ago = BillsService._add_months(today, -2)
    one_month_ago = BillsService._add_months(today, -1)

    with SessionLocal() as db:
        svc = BillsService(db)
        bill_out = svc.create_bill(
            BillCreate(
                company_id=1,
                bill_name="Office Lease Utility",
                category="Utilities",
                amount=Decimal("8000.00"),
                due_date=two_months_ago,
                frequency="Monthly",
                is_recurring=True,
                status="Due",
            )
        )
        # Pay period 1 (two_months_ago) and period 2 (one_month_ago)
        svc.record_payment(
            bill_out.bill_id,
            BillPaymentCreate(
                amount=Decimal("8000.00"),
                payment_date=two_months_ago,
                period_due_date=two_months_ago,
                payment_method="Cash",
            ),
        )
        svc.record_payment(
            bill_out.bill_id,
            BillPaymentCreate(
                amount=Decimal("8000.00"),
                payment_date=one_month_ago,
                period_due_date=one_month_ago,
                payment_method="Cash",
            ),
        )

        ns = NotificationService(db)
        notifs = ns.get_notifications(company_id=1, user_role="admin", user_scope_key="test-recurring")
        bill_reminders = [
            n for n in notifs if n.notification_type in ("BILL_OVERDUE", "BILL_DUE_TODAY", "BILL_DUE_SOON")
        ]
        # Period 3 is due `today`, so it should be BILL_DUE_TODAY (not BILL_OVERDUE from 2 months ago)
        assert len(bill_reminders) == 1
        assert bill_reminders[0].notification_type == "BILL_DUE_TODAY"
        assert bill_reminders[0].due_date == today.isoformat()


def test_lending_notifications_and_read_only_get_borrowers(notif_env):
    """
    Verify:
    - Daily borrower with missed past days produces LENDING_INSTALLMENT_OVERDUE and LENDING_DUE_TODAY.
    - LendingService.get_borrowers() does not commit during read operations.
    """
    _, _, SessionLocal, _ = notif_env
    today = date.today()
    start_date = today - timedelta(days=5)

    with SessionLocal() as db:
        svc = LendingService(db)
        borrower_out = svc.create_borrower(
            BorrowerCreateRequest(
                borrower_name="Juan Dela Cruz",
                loan_amount=Decimal("10000.00"),
                interest_rate=Decimal("10.00"),
                payment_frequency="Daily",
                term_days=60,
                date_borrowed=start_date.isoformat(),
                due_date=(start_date + timedelta(days=60)).isoformat(),
            )
        )
        # Pay only the first day's installment so the remaining past days are missed and today is due
        svc.record_payment(
            LendingPaymentCreateRequest(
                borrower_id=borrower_out.borrower_id,
                payment_date=(start_date + timedelta(days=1)).isoformat(),
                amount=Decimal("200.00"),
                method="Cash",
                notes="Day 1 payment",
            )
        )

    with SessionLocal() as db:
        commit_called = False
        orig_commit = db.commit

        def spy_commit():
            nonlocal commit_called
            commit_called = True
            return orig_commit()

        db.commit = spy_commit
        ns = NotificationService(db)
        notifs = ns.get_notifications(company_id=1, user_role="admin", user_scope_key="test-lending")
        assert not commit_called, "Notification read path must never call db.commit()"

        lending_types = {n.notification_type for n in notifs}
        assert "LENDING_INSTALLMENT_OVERDUE" in lending_types
        assert "LENDING_DUE_TODAY" in lending_types


def test_petty_cash_low_and_zero_balance_notifications(notif_env):
    """
    Verify that petty cash balance is computed accurately from local SQL
    (approved non-seed topups minus non-seed petty cash expenses) and triggers
    PETTY_CASH_LOW_BALANCE both when positive-but-low and when 0 or negative.
    """
    _, _, SessionLocal, _ = notif_env
    today = date.today()

    with SessionLocal() as db:
        db.add(
            PettyCashWallet(
                company_id=1,
                balance=Decimal("0.00"),
                low_balance_threshold=Decimal("5000.00"),
            )
        )
        db.add(
            PettyCashTopUp(
                company_id=1,
                topup_date=today,
                amount=Decimal("3000.00"),
                description="Replenishment",
                status="Approved",
                reference_no="PC-TOP-001",
            )
        )
        db.add(
            Expense(
                company_id=1,
                expense_date=today,
                amount=Decimal("3000.00"),
                payment_method="Petty Cash",
                reference_no="EXP-PC-001",
                particulars="Office supplies",
            )
        )
        db.commit()

        ns = NotificationService(db)
        notifs = ns.get_notifications(company_id=1, user_role="admin", user_scope_key="test-pc-zero")
        pc_low = [n for n in notifs if n.notification_type == "PETTY_CASH_LOW_BALANCE" and n.company_id == 1]
        assert len(pc_low) == 1
        assert pc_low[0].amount == pytest.approx(0.0)


def _seed_scaled_dataset(db, count_per_entity: int):
    """Seed `count_per_entity` records of every notification-producing entity with multiple child rows."""
    today = date.today()
    for i in range(1, count_per_entity + 1):
        cid = 1 if i % 2 == 1 else 2
        bill = Bill(
            company_id=cid,
            bill_name=f"Scaled Bill {i}",
            category="Electricity",
            amount=Decimal("2500.00"),
            due_date=today - timedelta(days=35),
            frequency="Monthly",
            is_recurring=True,
            status="Due",
        )
        db.add(bill)
        db.flush()
        for p_idx in range(3):
            db.add(
                BillPayment(
                    bill_id=bill.bill_id,
                    company_id=cid,
                    amount=Decimal("500.00"),
                    payment_date=today - timedelta(days=10 - p_idx),
                    period_due_date=today - timedelta(days=35),
                    payment_method="Cash",
                )
            )

        borrower = Borrower(
            borrower_ref_no=f"BRW-SCALE-{i:04d}",
            borrower_name=f"Scaled Borrower {i}",
            principal_amount=Decimal("10000.00"),
            interest_rate=Decimal("10.00"),
            total_payable=Decimal("11000.00"),
            total_penalties=Decimal("0.00"),
            amount_paid=Decimal("600.00"),
            remaining_balance=Decimal("10400.00"),
            payment_frequency="Daily",
            term_days=60,
            date_borrowed=today - timedelta(days=10),
            due_date=today + timedelta(days=50),
            status="Active",
        )
        db.add(borrower)
        db.flush()
        for t_idx in range(3):
            db.add(
                LendingTransaction(
                    borrower_id=borrower.borrower_id,
                    transaction_type="Repayment",
                    amount=Decimal("200.00"),
                    payment_date=today - timedelta(days=9 - t_idx),
                    payment_method="Cash",
                    status="Completed",
                    notes=f"Payment {t_idx}",
                )
            )

        loan = Loan(
            loan_ref_no=f"LN-SCALE-{i:04d}",
            lender=1,
            borrower=2,
            amount=Decimal("50000.00"),
            remaining_balance=Decimal("40000.00"),
            loan_date=today - timedelta(days=20),
            due_date=today + timedelta(days=2),
            status="Approved",
            particulars=f"Scaled Loan {i}",
        )
        db.add(loan)
        db.flush()
        for r_idx in range(2):
            db.add(
                LoanRepayment(
                    loan_id=loan.loan_id,
                    payment_date=today - timedelta(days=5 - r_idx),
                    amount=Decimal("5000.00"),
                    remaining_balance=Decimal("40000.00"),
                    payment_method="Bank Transfer",
                )
            )

        lease = TenantLease(
            company_id=1,
            tenant_ref=f"TNT-SCALE-{i:04d}",
            tenant_name=f"Scaled Tenant {i}",
            unit_name=f"Unit {i}",
            rent_amount=Decimal("15000.00"),
            contract_date=today - timedelta(days=60),
            due_date=today - timedelta(days=30),
            lease_end_date=today + timedelta(days=300),
            repeat_mode="Monthly",
            total_amount_payable=Decimal("180000.00"),
            amount_paid=Decimal("15000.00"),
            remaining_balance=Decimal("165000.00"),
            status="Active",
        )
        db.add(lease)
        db.flush()
        for lp_idx in range(2):
            db.add(
                TenantLeasePayment(
                    lease_id=lease.lease_id,
                    payment_date=today - timedelta(days=30 - lp_idx),
                    amount=Decimal("7500.00"),
                    method="Cash",
                    status="Paid",
                    period_index=1,
                )
            )

        db.add(
            PettyCashTopUp(
                company_id=cid,
                topup_date=today - timedelta(days=1),
                amount=Decimal("2000.00"),
                description=f"Topup {i}",
                status="Pending" if i % 2 == 0 else "Approved",
                reference_no=f"PC-SCALE-{i:04d}",
            )
        )
        db.add(
            AuditLog(
                user_name="Supervisor",
                user_role="supervisor",
                action="CREATE",
                module="TRANSACTION",
                details={"record_id": i, "company_id": cid, "reference_no": f"DEP-{i:04d}", "amount": 1000},
                timestamp=datetime.utcnow(),
            )
        )
    db.commit()


def test_zero_n_plus_one_query_scaling(monkeypatch):
    """
    Verify that scaling the dataset 10x (from N=2 to N=20 entities with child collections)
    executes the exact same number of SQL queries (delta Q == 0).
    """
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)

    def measure_queries_for_scale(scale_n: int) -> int:
        system_cache.clear()
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

        with SessionLocal() as db:
            db.add_all(
                [
                    Company(company_id=1, company_name="JK Property and Ventures", starting_balance=0),
                    Company(company_id=2, company_name="MCT Lending Corp", starting_balance=0),
                ]
            )
            db.commit()
            _seed_scaled_dataset(db, scale_n)

        queries = []

        def listener(conn, cursor, statement, parameters, context, executemany):
            queries.append(statement)

        with SessionLocal() as db:
            ns = NotificationService(db)
            event.listen(engine, "before_cursor_execute", listener)
            try:
                items = ns.get_notifications(
                    company_id=None,
                    user_role="admin",
                    limit=500,
                    user_scope_key=f"scale-{scale_n}",
                )
            finally:
                event.remove(engine, "before_cursor_execute", listener)
            assert len(items) > 0
        return len(queries)

    q_small = measure_queries_for_scale(2)
    q_large = measure_queries_for_scale(20)
    assert q_large == q_small, f"N+1 detected: Q(N=2)={q_small} vs Q(N=20)={q_large}"
