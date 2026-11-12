"""
Regression tests for:
1) Petty cash Finance/Audit/Supervisor notification delivery on cold & warm DB
   when status is 'Pending Finance Approval' (top-ups and reimbursements)
2) Finance direct-endorsed replenishment funding bank persistence & validation
   (own bank, cross-company 'direct', cross-company 'transfer_first', zero-excess)
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import notifications as notifications_endpoints
from app.api.v1.endpoints import petty_cash as petty_cash_endpoints
from app.core.cache import system_cache
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.finance import Category, Expense
from app.models.intercompany_transfer import IntercompanyTransfer
from app.models.notification import Notification
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.models.user import User, UserCompany
from app.schemas.petty_cash import PettyCashTopUpCreate
from app.services.notification_service import NotificationService
from app.services.petty_cash_service import PettyCashService


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setattr("app.services.activity_log_service.get_supabase_admin_client", lambda: None)
    monkeypatch.setattr("app.core.events.dispatch_activity_event", lambda *args, **kwargs: None)

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("app.services.activity_log_service.SessionLocal", Session)
    monkeypatch.setattr("app.db.session.SessionLocal", Session)

    with Session() as seed:
        comp_a = Company(
            company_id=101,
            company_name="Alpha Tech Inc",
            starting_balance=Decimal("100000.00"),
        )
        comp_b = Company(
            company_id=102,
            company_name="Beta Logistics Corp",
            starting_balance=Decimal("100000.00"),
        )
        seed.add_all([comp_a, comp_b])
        seed.flush()

        bank_a = BankAccount(
            id="BANK-A-01",
            company_id=101,
            company_name="Alpha Tech Inc",
            bank_name="BDO Unibank",
            account_name="Alpha Checking",
            account_number="101-0001",
            current_balance=Decimal("50000.00"),
            starting_balance=Decimal("50000.00"),
        )
        bank_b = BankAccount(
            id="BANK-B-01",
            company_id=102,
            company_name="Beta Logistics Corp",
            bank_name="BPI",
            account_name="Beta Funding",
            account_number="102-0001",
            current_balance=Decimal("80000.00"),
            starting_balance=Decimal("80000.00"),
        )
        bank_shared = BankAccount(
            id="BANK-SHARED-01",
            company_id=102,
            company_name="Beta Logistics Corp",
            company_names=["Beta Logistics Corp", "Alpha Tech Inc"],
            bank_name="Metrobank",
            account_name="Joint Ops",
            account_number="103-0001",
            current_balance=Decimal("40000.00"),
            starting_balance=Decimal("40000.00"),
        )
        seed.add_all([bank_a, bank_b, bank_shared])

        seed.add_all([
            User(user_id=1, email="admin@mct.com", name="System Admin", role="admin", is_admin=True),
            User(user_id=2, email="finance@mct.com", name="Finance Officer", role="finance", is_admin=False),
            User(user_id=3, email="audit@mct.com", name="Internal Auditor", role="audit", is_admin=False),
            User(user_id=4, email="sup_alpha@mct.com", name="Alpha Supervisor", role="supervisor", company_id=101, is_admin=False),
        ])
        seed.flush()
        seed.add(UserCompany(user_id=4, company_id=101))

        seed.add_all([
            PettyCashTopUp(
                company_id=101,
                amount=Decimal("20000.00"),
                topup_date=date.today(),
                description="Initial Float",
                status="Approved",
                request_type="topup",
            ),
            PettyCashWallet(
                company_id=101,
                balance=Decimal("20000.00"),
                low_balance_threshold=Decimal("1000.00"),
            ),
        ])
        seed.commit()

    system_cache.invalidate_tag("petty_cash")
    system_cache.invalidate_tag("notifications")

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(petty_cash_endpoints.router, prefix="/api/v1/petty-cash")
    app.include_router(notifications_endpoints.router, prefix="/api/v1/notifications")

    return {"Session": Session, "app": app, "engine": engine}


SUPERVISOR_AUTH = {
    "auth_user_id": "sup_alpha",
    "user_id": 4,
    "email": "sup_alpha@mct.com",
    "full_name": "Alpha Supervisor",
    "company_id": 101,
    "company_ids": [101],
    "is_admin": False,
    "role": "supervisor",
}

FINANCE_AUTH = {
    "auth_user_id": "finance_1",
    "user_id": 2,
    "email": "finance@mct.com",
    "full_name": "Finance Officer",
    "company_id": None,
    "company_ids": [101, 102],
    "is_admin": False,
    "role": "finance",
}

AUDIT_AUTH = {
    "auth_user_id": "audit_1",
    "user_id": 3,
    "email": "audit@mct.com",
    "full_name": "Internal Auditor",
    "company_id": None,
    "company_ids": [101, 102],
    "is_admin": False,
    "role": "audit",
}

ADMIN_AUTH = {
    "auth_user_id": "admin_1",
    "user_id": 1,
    "email": "admin@mct.com",
    "full_name": "System Admin",
    "company_id": None,
    "company_ids": [101, 102],
    "is_admin": True,
    "role": "admin",
}


def test_supervisor_petty_cash_notifies_finance_on_cold_and_warm_db(env):
    """Pending Finance Approval top-ups and replenishments must notify Finance whether notifications table is empty or populated."""
    Session = env["Session"]

    with Session() as db:
        pc_svc = PettyCashService(db)
        notif_svc = NotificationService(db)

        # 1. Cold DB: Supervisor submits a top-up with 'Pending Finance Approval'
        topup_out = pc_svc.create_topup(
            PettyCashTopUpCreate(
                company_id=101,
                amount=Decimal("2500.00"),
                topup_date=date.today(),
                description="Weekly buffer",
                status="Pending Finance Approval",
                request_type="topup",
            ),
            current_user=SUPERVISOR_AUTH,
        )

        # Finance receives PETTY_CASH_REQUEST in feed and unread count; Admin gets 0
        feed_fin = notif_svc.get_notifications_feed(
            recipient_user_id=2,
            user_role="finance",
            user_scope_key="u:2:r:finance:c:None",
        )
        req_items = [n for n in feed_fin.items if n.notification_type == "PETTY_CASH_REQUEST" and n.reference_id == topup_out.topup_id]
        assert len(req_items) == 1
        assert notif_svc.get_unread_count(recipient_user_id=2, user_role="finance", user_scope_key="u:2:r:finance:c:None") >= 1
        assert notif_svc.get_unread_count(recipient_user_id=1, user_role="admin", user_scope_key="u:1:r:admin:c:None") == 0

        # 2. Warm DB: Finance already has a persistent BILL_DUE notification row
        db.add(
            Notification(
                notification_id="bill-due-existing-1",
                recipient_user_id=2,
                company_id=101,
                notification_type="BILL_DUE_SOON",
                title="Bill Due Soon",
                message="Water utility due in 3 days",
                reference_type="bill",
                reference_id=9001,
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

        # Supervisor submits a replenishment claim ('Pending Finance Approval')
        reimb_out = pc_svc.create_topup(
            PettyCashTopUpCreate(
                company_id=101,
                amount=Decimal("1200.00"),
                total_expenses=Decimal("3200.00"),
                company_funded_amount=Decimal("2000.00"),
                topup_date=date.today(),
                paid_by="Alpha Supervisor",
                description="Office hardware",
                status="Pending Finance Approval",
                request_type="reimbursement",
            ),
            current_user=SUPERVISOR_AUTH,
        )

        # Unpersisted legacy row (direct DB insert without _sync_petty_cash_notifications) must STILL surface
        legacy_row = PettyCashTopUp(
            company_id=101,
            amount=Decimal("900.00"),
            topup_date=date.today(),
            description="Direct SQL insert awaiting Finance",
            status="Pending Finance Approval",
            request_type="topup",
        )
        db.add(legacy_row)
        db.commit()
        db.refresh(legacy_row)
        system_cache.invalidate_tag("notifications")

        feed_warm = notif_svc.get_notifications_feed(
            recipient_user_id=2,
            user_role="finance",
            user_scope_key="u:2:r:finance:c:None",
        )
        ref_ids = {n.reference_id for n in feed_warm.items if n.notification_type == "PETTY_CASH_REQUEST"}
        assert topup_out.topup_id in ref_ids
        assert reimb_out.topup_id in ref_ids
        assert legacy_row.topup_id in ref_ids
        # Bill due-date reminders are for the company supervisor only, never Finance
        assert not any(n.notification_id == "bill-due-existing-1" for n in feed_warm.items)

        # Verify replenishment notification title/details
        reimb_notif = next(n for n in feed_warm.items if n.reference_id == reimb_out.topup_id)
        assert "Replenishment" in reimb_notif.title
        assert "3,200.00" in reimb_notif.message
        assert "1,200.00" in reimb_notif.message

        # Marking the persistent notification read keeps read_at and does NOT duplicate via _unpersisted_petty_cash_workflow
        notif_svc.mark_as_read(reimb_notif.notification_id, recipient_user_id=2)
        feed_after_read = notif_svc.get_notifications_feed(
            recipient_user_id=2,
            user_role="finance",
            user_scope_key="u:2:r:finance:c:None",
        )
        matching_reimb = [n for n in feed_after_read.items if n.reference_id == reimb_out.topup_id and n.notification_type == "PETTY_CASH_REQUEST"]
        assert len(matching_reimb) == 1
        assert matching_reimb[0].read_at is not None


def test_workflow_api_notifications_end_to_end(env):
    """End-to-end API flow: Supervisor -> Finance -> Audit -> Supervisor approval and rejection resolution."""
    app = env["app"]
    current_user = {"val": SUPERVISOR_AUTH}
    app.dependency_overrides[get_current_user] = lambda: current_user["val"]
    client = TestClient(app)

    # 1. Supervisor creates replenishment request via HTTP endpoint
    resp = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": "Alpha Tech Inc",
            "amount": 1500.0,
            "total_expenses": 4500.0,
            "company_funded_amount": 3000.0,
            "topup_date": date.today().isoformat(),
            "description": "Printer Toner",
            "status": "Pending Finance Approval",
            "request_type": "reimbursement",
            "paid_by": "Alpha Supervisor",
        },
    )
    assert resp.status_code == 201, resp.text
    claim_id = resp.json()["topup_id"]

    # 2. Finance polls /api/v1/notifications/count and /api/v1/notifications
    current_user["val"] = FINANCE_AUTH
    cnt_res = client.get("/api/v1/notifications/count")
    assert cnt_res.status_code == 200
    assert cnt_res.json()["unread_count"] == 1

    fin_list = client.get("/api/v1/notifications").json()
    assert len(fin_list) == 1
    assert fin_list[0]["notification_type"] == "PETTY_CASH_REQUEST"
    assert fin_list[0]["reference_id"] == claim_id

    # 3. Finance endorses -> resolves Finance alert and notifies Audit
    end_res = client.post(
        f"/api/v1/petty-cash/topups/{claim_id}/endorse",
        json={
            "action": "endorse",
            "remark": "Verified receipts",
            "bank_account_id": "BANK-A-01",
        },
    )
    assert end_res.status_code == 200, end_res.text

    assert client.get("/api/v1/notifications/count").json()["unread_count"] == 0

    current_user["val"] = AUDIT_AUTH
    audit_list = client.get("/api/v1/notifications").json()
    assert len(audit_list) == 1
    assert audit_list[0]["notification_type"] == "PETTY_CASH_AUDIT"
    assert audit_list[0]["reference_id"] == claim_id

    # 4. Audit approves -> resolves Audit alert and notifies Supervisor
    rev_res = client.post(
        f"/api/v1/petty-cash/topups/{claim_id}/review",
        json={"action": "approve", "remark": "Audit cleared"},
    )
    assert rev_res.status_code == 200, rev_res.text
    assert client.get("/api/v1/notifications/count").json()["unread_count"] == 0

    current_user["val"] = SUPERVISOR_AUTH
    sup_list = client.get("/api/v1/notifications").json()
    assert len(sup_list) == 1
    assert sup_list[0]["notification_type"] == "PETTY_CASH_APPROVED"
    assert sup_list[0]["reference_id"] == claim_id

    # 5. Rejection path: Supervisor submits another request -> Finance rejects -> notifies Supervisor
    resp2 = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": "Alpha Tech Inc",
            "amount": 500.0,
            "topup_date": date.today().isoformat(),
            "description": "Extra float",
            "status": "Pending Finance Approval",
            "request_type": "topup",
        },
    )
    assert resp2.status_code == 201, resp2.text
    topup2_id = resp2.json()["topup_id"]

    current_user["val"] = FINANCE_AUTH
    assert client.get("/api/v1/notifications/count").json()["unread_count"] == 1
    rej_res = client.post(
        f"/api/v1/petty-cash/topups/{topup2_id}/endorse",
        json={"action": "reject", "remark": "Insufficient budget"},
    )
    assert rej_res.status_code == 200, rej_res.text
    assert client.get("/api/v1/notifications/count").json()["unread_count"] == 0

    current_user["val"] = SUPERVISOR_AUTH
    sup_list2 = client.get("/api/v1/notifications").json()
    rej_notifs = [n for n in sup_list2 if n["reference_id"] == topup2_id]
    assert len(rej_notifs) == 1
    assert rej_notifs[0]["notification_type"] == "PETTY_CASH_REJECTED"


def test_finance_direct_replenishment_funding_bank_validation_and_persistence(env):
    """Finance creating a replenishment request ('Pending Audit Approval') must support & validate Funding Bank + Affiliate methods."""
    Session = env["Session"]

    with Session() as db:
        pc_svc = PettyCashService(db)
        notif_svc = NotificationService(db)

        # 1. Missing funding bank on positive out-of-pocket direct-endorsed claim -> 422
        with pytest.raises(HTTPException) as exc:
            pc_svc.create_topup(
                PettyCashTopUpCreate(
                    company_id=101,
                    amount=Decimal("2000.00"),
                    total_expenses=Decimal("5000.00"),
                    company_funded_amount=Decimal("3000.00"),
                    topup_date=date.today(),
                    description="Missing bank",
                    status="Pending Audit Approval",
                    request_type="reimbursement",
                    paid_by="Finance Officer",
                ),
                current_user=FINANCE_AUTH,
            )
        assert exc.value.status_code == 422

        # 2. Cross-company affiliate bank rejected at creation (422) regardless of payment_method_option (Spec 0042 AC-1)
        for method_opt, dest_id in (
            (None, None),
            ("direct", None),
            ("transfer_first", None),
            ("transfer_first", "BANK-A-01"),
            ("transfer_first", "BANK-B-01"),
        ):
            with pytest.raises(HTTPException) as exc_cross:
                pc_svc.create_topup(
                    PettyCashTopUpCreate(
                        company_id=101,
                        amount=Decimal("2000.00"),
                        total_expenses=Decimal("5000.00"),
                        company_funded_amount=Decimal("3000.00"),
                        topup_date=date.today(),
                        description="Cross-company funding rejected",
                        status="Pending Audit Approval",
                        request_type="reimbursement",
                        bank_account_id="BANK-B-01",
                        payment_method_option=method_opt,
                        destination_bank_id=dest_id,
                    ),
                    current_user=FINANCE_AUTH,
                )
            assert exc_cross.value.status_code == 422
            assert "must belong to the requesting company" in exc_cross.value.detail

        # 5. Own bank direct-endorsed replenishment succeeds, notifies Audit, and reimburses cleanly
        own_claim = pc_svc.create_topup(
            PettyCashTopUpCreate(
                company_id=101,
                amount=Decimal("1000.00"),
                total_expenses=Decimal("3000.00"),
                company_funded_amount=Decimal("2000.00"),
                topup_date=date.today(),
                description="Own bank claim",
                status="Pending Audit Approval",
                request_type="reimbursement",
                bank_account_id="BANK-A-01",
                finance_remark="Funded via Alpha BDO",
                paid_by="Finance Officer",
            ),
            current_user=FINANCE_AUTH,
        )
        assert own_claim.status == "Pending Audit Approval"
        assert own_claim.bank_account_id == "BANK-A-01"
        assert own_claim.payment_method_option is None

        # Audit gets notified (and Finance does not get a redundant FINANCE_REQUEST for its own submission)
        audit_feed = notif_svc.get_notifications_feed(recipient_user_id=3, user_role="audit")
        assert any(n.reference_id == own_claim.topup_id and n.notification_type == "PETTY_CASH_AUDIT" for n in audit_feed.items)
        fin_feed = notif_svc.get_notifications_feed(recipient_user_id=2, user_role="finance")
        assert not any(n.reference_id == own_claim.topup_id and n.notification_type == "PETTY_CASH_REQUEST" for n in fin_feed.items)

        pc_svc.review_topup(own_claim.topup_id, action="approve", remark="OK", reviewer_name="Internal Auditor")
        reimb_res = pc_svc.reimburse(own_claim.topup_id, current_user=FINANCE_AUTH)
        assert reimb_res.status == "Reimbursed"

        # 6. Historical affiliate direct payment seeded in DB still records IntercompanyTransfer on reimburse (Spec 0042 AC-2)
        direct_claim = PettyCashTopUp(
            company_id=101,
            amount=Decimal("1500.00"),
            total_expenses=Decimal("2500.00"),
            company_funded_amount=Decimal("1000.00"),
            employee_out_of_pocket=Decimal("1500.00"),
            reserved_amount=Decimal("1000.00"),
            topup_date=date.today(),
            description="Affiliate direct claim",
            status="Approved",
            request_type="reimbursement",
            bank_account_id="BANK-B-01",
            payment_method_option="direct",
            finance_remark="Beta direct payout",
            paid_by="Finance Officer",
            endorsed_by="Legacy Finance",
            reviewed_by="Internal Auditor",
        )
        db.add(direct_claim)
        db.commit()
        db.refresh(direct_claim)
        direct_reimb = pc_svc.reimburse(direct_claim.topup_id, current_user=FINANCE_AUTH)
        assert direct_reimb.status == "Reimbursed"
        assert db.query(IntercompanyTransfer).filter(IntercompanyTransfer.linked_topup_id == direct_claim.topup_id).count() == 1

        # 7. Historical affiliate transfer_first seeded in DB still initiates transfer cleanly (Spec 0042 AC-2)
        tf_claim = PettyCashTopUp(
            company_id=101,
            amount=Decimal("1200.00"),
            total_expenses=Decimal("2200.00"),
            company_funded_amount=Decimal("1000.00"),
            employee_out_of_pocket=Decimal("1200.00"),
            reserved_amount=Decimal("1000.00"),
            topup_date=date.today(),
            description="Affiliate transfer first",
            status="Approved",
            request_type="reimbursement",
            bank_account_id="BANK-B-01",
            payment_method_option="transfer_first",
            destination_bank_id="BANK-A-01",
            finance_remark="Beta transfer first",
            paid_by="Finance Officer",
            endorsed_by="Legacy Finance",
            reviewed_by="Internal Auditor",
        )
        db.add(tf_claim)
        db.commit()
        db.refresh(tf_claim)
        tf_res = pc_svc.initiate_transfer(tf_claim.topup_id, current_user=FINANCE_AUTH)
        assert tf_res.status == "Transfer In Transit"

        # 8. Zero-excess claim settles immediately without funding bank or Audit approval queue
        zero_claim = pc_svc.create_topup(
            PettyCashTopUpCreate(
                company_id=101,
                amount=Decimal("0.00"),
                total_expenses=Decimal("1000.00"),
                company_funded_amount=Decimal("1000.00"),
                topup_date=date.today(),
                description="Float only claim",
                status="Pending Audit Approval",
                request_type="reimbursement",
                finance_remark="Zero excess float settlement",
                paid_by="Finance Officer",
            ),
            current_user=FINANCE_AUTH,
        )
        assert zero_claim.status == "Settled"
        assert zero_claim.bank_account_id is None
        assert zero_claim.petty_cash_expense_id is not None


def test_reimbursement_accepts_base64_receipt_data_urls_and_blocks_unsafe_schemes(env):
    """Regression: base64 data URLs from /receipts must pass validation, while unsafe schemes return 422."""
    import json

    app = env["app"]
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_AUTH
    client = TestClient(app)

    large_b64 = "A" * 4000
    data_url = f"data:image/png;base64,{large_b64}"
    attachments_json = json.dumps([
        {"file_url": data_url, "file_name": "receipt.png", "file_size": 3000, "mime_type": "image/png"}
    ])

    resp_ok = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": "Alpha Tech Inc",
            "amount": 250.0,
            "total_expenses": 250.0,
            "company_funded_amount": 0.0,
            "employee_out_of_pocket": 250.0,
            "topup_date": date.today().isoformat(),
            "description": "Office receipt upload",
            "request_type": "reimbursement",
            "paid_by": "Supervisor User",
            "receipt_url": None,
            "attachments": attachments_json,
        },
    )
    assert resp_ok.status_code == 201, resp_ok.text
    created_data = resp_ok.json()
    assert created_data["receipt_url"] == data_url
    assert created_data["attachments"] == attachments_json

    resp_direct = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": "Alpha Tech Inc",
            "amount": 120.0,
            "total_expenses": 120.0,
            "company_funded_amount": 0.0,
            "employee_out_of_pocket": 120.0,
            "topup_date": date.today().isoformat(),
            "description": "Direct receipt URL upload",
            "request_type": "reimbursement",
            "paid_by": "Supervisor User",
            "receipt_url": data_url,
            "attachments": attachments_json,
        },
    )
    assert resp_direct.status_code == 201, resp_direct.text

    # Unsafe schemes (HTML / SVG data URLs or internal metadata URLs) must still fail 422
    for bad_url in [
        "data:text/html;base64,PHNjcmlwdD4=",
        "data:image/svg+xml;base64,PHN2Zz4=",
        "http://169.254.169.254/latest/meta-data/",
    ]:
        resp_bad = client.post(
            "/api/v1/petty-cash/topups",
            json={
                "company_name": "Alpha Tech Inc",
                "amount": 100.0,
                "total_expenses": 100.0,
                "company_funded_amount": 0.0,
                "employee_out_of_pocket": 100.0,
                "topup_date": date.today().isoformat(),
                "description": "Bad scheme",
                "request_type": "reimbursement",
                "paid_by": "Supervisor User",
                "receipt_url": bad_url,
            },
        )
        assert resp_bad.status_code == 422, f"Expected 422 for {bad_url}, got {resp_bad.status_code}"


def test_spec_0042_cross_company_http_422_and_lean_ledger_lazy_receipts(env):
    """Spec 0042 AC-1, AC-3, AC-4: Cross-company HTTP 422 rejection, lean /ledger (bounded queries), and /topups/{id}/receipts scoping."""
    import json

    app = env["app"]
    Session = env["Session"]
    engine = env["engine"]
    client = TestClient(app)

    # 1. Cross-company topup creation via HTTP returns 422 without altering wallet/bank
    app.dependency_overrides[get_current_user] = lambda: FINANCE_AUTH
    resp_cross_create = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": "Alpha Tech Inc",
            "amount": 500.0,
            "topup_date": date.today().isoformat(),
            "description": "Blocked foreign bank topup",
            "status": "Pending Audit Approval",
            "request_type": "topup",
            "bank_account_id": "BANK-B-01",
        },
    )
    assert resp_cross_create.status_code == 422
    assert "must belong to the requesting company" in resp_cross_create.json()["detail"]

    # 2. Supervisor creates pending topup; Finance attempting to endorse with foreign bank returns 422
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_AUTH
    resp_sup = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": "Alpha Tech Inc",
            "amount": 500.0,
            "topup_date": date.today().isoformat(),
            "description": "Pending own topup",
            "request_type": "topup",
        },
    )
    assert resp_sup.status_code == 201
    pending_id = resp_sup.json()["topup_id"]

    app.dependency_overrides[get_current_user] = lambda: FINANCE_AUTH
    resp_cross_endorse = client.post(
        f"/api/v1/petty-cash/topups/{pending_id}/endorse",
        json={
            "action": "endorse",
            "remark": "Try foreign bank",
            "bank_account_id": "BANK-B-01",
        },
    )
    assert resp_cross_endorse.status_code == 422
    assert "must belong to the requesting company" in resp_cross_endorse.json()["detail"]

    # Verify bank balances untouched
    with Session() as db:
        bank_b = db.query(BankAccount).filter(BankAccount.id == "BANK-B-01").first()
        assert bank_b.current_balance == Decimal("80000.00")

        # 3. Seed 25 rows (including heavy base64 payloads, multi-attachment, legacy destination_bank_id, and Beta row)
        sample_b64 = "data:image/png;base64," + ("A" * 2048)
        multi_atts = json.dumps([
            {"file_url": sample_b64, "file_name": "r1.png"},
            {"file_url": sample_b64, "file_name": "r2.png"},
        ])
        for idx in range(24):
            db.add(
                PettyCashTopUp(
                    company_id=101,
                    amount=Decimal("100.00"),
                    topup_date=date.today(),
                    description=f"Alpha Bulk Row {idx}",
                    status="Pending Audit Approval",
                    request_type="reimbursement",
                    total_expenses=Decimal("100.00"),
                    company_funded_amount=Decimal("0.00"),
                    employee_out_of_pocket=Decimal("100.00"),
                    bank_account_id="BANK-A-01",
                    destination_bank_id="BANK-A-01" if idx == 0 else None,
                    receipt_url=sample_b64 if idx == 0 else None,
                    attachments=multi_atts if idx == 0 else None,
                )
            )
        beta_topup = PettyCashTopUp(
            company_id=102,
            amount=Decimal("300.00"),
            topup_date=date.today(),
            description="Beta Confidential Receipt",
            status="Pending Audit Approval",
            request_type="reimbursement",
            total_expenses=Decimal("300.00"),
            employee_out_of_pocket=Decimal("300.00"),
            bank_account_id="BANK-B-01",
            receipt_url=sample_b64,
        )
        db.add(beta_topup)
        db.commit()
        db.refresh(beta_topup)
        beta_id = beta_topup.topup_id
        alpha_receipt_id = (
            db.query(PettyCashTopUp)
            .filter(PettyCashTopUp.company_id == 101, PettyCashTopUp.description == "Alpha Bulk Row 0")
            .first()
            .topup_id
        )

    system_cache.invalidate_tag("petty_cash")
    executed_queries = []

    def count_queries(conn, cursor, statement, parameters, context, executemany):
        executed_queries.append(statement)

    event.listen(engine, "before_cursor_execute", count_queries)
    try:
        app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_AUTH
        resp_ledger = client.get("/api/v1/petty-cash/ledger", params={"company_name": "Alpha Tech Inc"})
    finally:
        event.remove(engine, "before_cursor_execute", count_queries)

    assert resp_ledger.status_code == 200
    rows = resp_ledger.json()
    assert len(rows) >= 25
    # Constant bounded query count (no per-row N+1 BankAccount/IntercompanyTransfer queries)
    assert len(executed_queries) < 12, f"Expected bounded query count, got {len(executed_queries)}"

    target_row = next(r for r in rows if r["record_id"] == alpha_receipt_id and r["request_type"] == "reimbursement")
    assert target_row["receipt_url"] is None
    assert target_row["attachments"] is None
    assert target_row["has_receipt"] is True
    assert target_row["attachment_count"] == 2
    assert target_row["destination_bank_name"] == "BDO Unibank"
    assert all(r["receipt_url"] is None and r["attachments"] is None for r in rows)

    # Lazy receipt endpoint: 200 own company, 403 cross-company, 404 missing
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_AUTH
    resp_rec_ok = client.get(f"/api/v1/petty-cash/topups/{alpha_receipt_id}/receipts")
    assert resp_rec_ok.status_code == 200
    assert resp_rec_ok.json()["topup_id"] == alpha_receipt_id
    assert resp_rec_ok.json()["receipt_url"].startswith("data:image/png;base64,")
    assert len(json.loads(resp_rec_ok.json()["attachments"])) == 2

    resp_rec_forbidden = client.get(f"/api/v1/petty-cash/topups/{beta_id}/receipts")
    assert resp_rec_forbidden.status_code == 403

    resp_rec_missing = client.get("/api/v1/petty-cash/topups/999999/receipts")
    assert resp_rec_missing.status_code == 404


def test_spec_0042_eligible_expenses_scoping_search_and_claim_exclusion(env):
    """Spec 0042 AC-5 & AC-6: /eligible-expenses scopes by company, filters with q, excludes claimed rows."""
    app = env["app"]
    Session = env["Session"]
    client = TestClient(app)

    with Session() as db:
        cat = Category(name="Office Supplies")
        db.add(cat)
        db.flush()

        exp1 = Expense(
            company_id=101,
            category_id=cat.category_id,
            payment_method="Petty Cash",
            expense_date=date.today(),
            amount=Decimal("850.00"),
            description="Laser Toner Cartridge",
            reference_no="EXP-A-101",
        )
        exp2 = Expense(
            company_id=101,
            category_id=cat.category_id,
            payment_method="Petty Cash",
            expense_date=date.today(),
            amount=Decimal("420.00"),
            description="Bond Paper Reams",
            reference_no="EXP-A-102",
        )
        exp_bank = Expense(
            company_id=101,
            category_id=cat.category_id,
            payment_method="Bank Transfer",
            expense_date=date.today(),
            amount=Decimal("1000.00"),
            description="Should Not Appear",
            reference_no="EXP-BANK-1",
        )
        exp_linked = Expense(
            company_id=101,
            category_id=cat.category_id,
            payment_method="Petty Cash",
            expense_date=date.today(),
            amount=Decimal("200.00"),
            description="Already Linked Expense",
            reference_no="EXP-LINKED-1",
            linked_topup_id=1,
        )
        exp_beta = Expense(
            company_id=102,
            category_id=cat.category_id,
            payment_method="Petty Cash",
            expense_date=date.today(),
            amount=Decimal("900.00"),
            description="Beta Fleet Fuel",
            reference_no="EXP-B-201",
        )
        db.add_all([exp1, exp2, exp_bank, exp_linked, exp_beta])
        db.commit()
        db.refresh(exp1)
        db.refresh(exp2)
        exp1_id, exp2_id = exp1.expense_id, exp2.expense_id

    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_AUTH

    # Scoped list returns only Alpha's 2 eligible Petty Cash expenses
    r_list = client.get("/api/v1/petty-cash/eligible-expenses", params={"company_name": "Alpha Tech Inc"})
    assert r_list.status_code == 200
    ids = {e["expense_id"] for e in r_list.json()}
    assert ids == {exp1_id, exp2_id}

    # Substring filter q over particulars/category/reference_no
    r_search = client.get("/api/v1/petty-cash/eligible-expenses", params={"company_name": "Alpha Tech Inc", "q": "Toner"})
    assert r_search.status_code == 200
    assert [e["expense_id"] for e in r_search.json()] == [exp1_id]

    # Cross-company 403 for Supervisor
    r_forbidden = client.get("/api/v1/petty-cash/eligible-expenses", params={"company_name": "Beta Logistics Corp"})
    assert r_forbidden.status_code == 403

    # Claiming exp1 succeeds once and fails 422 on duplicate attempt, excluding it from subsequent /eligible-expenses calls
    claim_payload = {
        "company_name": "Alpha Tech Inc",
        "amount": 150.0,
        "total_expenses": 1000.0,
        "company_funded_amount": 850.0,
        "employee_out_of_pocket": 150.0,
        "existing_expense_id": exp1_id,
        "topup_date": date.today().isoformat(),
        "description": "Supplies reimbursement",
        "request_type": "reimbursement",
        "paid_by": "Alpha Supervisor",
    }
    r_claim1 = client.post("/api/v1/petty-cash/reimbursements", json=claim_payload)
    assert r_claim1.status_code == 201, r_claim1.text

    r_claim2 = client.post("/api/v1/petty-cash/reimbursements", json=claim_payload)
    assert r_claim2.status_code == 422

    r_after = client.get("/api/v1/petty-cash/eligible-expenses", params={"company_name": "Alpha Tech Inc"})
    assert r_after.status_code == 200
    assert [e["expense_id"] for e in r_after.json()] == [exp2_id]

