from datetime import date, datetime
from decimal import Decimal
import inspect
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.petty_cash import router as petty_cash_router
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.finance import Category, Expense
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
import app.services.petty_cash_service as petty_cash_service_module
from app.services.petty_cash_service import PettyCashService


def _make_test_env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return engine, TestingSessionLocal


@pytest.fixture()
def pc_env(monkeypatch):
    import app.api.v1.endpoints.petty_cash as petty_cash_endpoint_module
    monkeypatch.setattr(petty_cash_endpoint_module, "log_transaction", lambda *a, **kw: None)

    engine, SessionLocal = _make_test_env()
    db = SessionLocal()

    comp_a = Company(company_name="MCT Kitchen", starting_balance=Decimal("0.00"))
    comp_b = Company(company_name="MCT Cafe", starting_balance=Decimal("0.00"))
    db.add_all([comp_a, comp_b])
    db.flush()

    cat_supplies = Category(name="Supplies")
    db.add(cat_supplies)
    db.flush()

    wallet_a = PettyCashWallet(company_id=comp_a.company_id, low_balance_threshold=Decimal("500.00"))
    wallet_b = PettyCashWallet(company_id=comp_b.company_id, low_balance_threshold=Decimal("500.00"))
    db.add_all([wallet_a, wallet_b])

    # Initial approved top-up of 1,000.00 for MCT Kitchen
    seed_topup = PettyCashTopUp(
        company_id=comp_a.company_id,
        request_type="topup",
        amount=Decimal("1000.00"),
        topup_date=date.today(),
        description="Opening petty cash float",
        status="Approved",
        created_by=1,
    )
    db.add(seed_topup)
    db.commit()

    current_user_box = {
        "user": {
            "user_id": 1,
            "email": "staff@mct.test",
            "full_name": "Alex Staff",
            "role": "company",
            "company_id": comp_a.company_id,
            "company_name": comp_a.company_name,
        }
    }

    app = FastAPI()
    app.include_router(petty_cash_router, prefix="/api/v1/petty-cash")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return current_user_box["user"]

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    client = TestClient(app)
    try:
        yield {
            "app": app,
            "db": db,
            "client": client,
            "comp_a": comp_a,
            "comp_b": comp_b,
            "cat_supplies": cat_supplies,
            "current_user_box": current_user_box,
        }
    finally:
        db.close()
        engine.dispose()


def test_create_disbursement_happy_path_updates_expense_ledger_and_balance(pc_env, monkeypatch):
    monkeypatch.setattr(petty_cash_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    client = pc_env["client"]
    db = pc_env["db"]
    comp_a = pc_env["comp_a"]

    res = client.post(
        "/api/v1/petty-cash/disbursements",
        json={
            "company": comp_a.company_name,
            "amount": 250.50,
            "topup_date": date.today().isoformat(),
            "description": "Courier fees",
            "paid_by": "Alex Staff",
            "category": "Supplies",
        },
    )
    assert res.status_code == 201, res.text
    payload = res.json()
    assert payload["request_type"] == "disbursement"
    assert payload["status"] == "Approved"
    assert Decimal(str(payload["amount"])) == Decimal("250.50")
    assert Decimal(str(payload["company_funded_amount"])) == Decimal("250.50")
    assert Decimal(str(payload["employee_out_of_pocket"])) == Decimal("0.00")

    # Verify paired Expense created with Petty Cash and PC-DISB-<id>
    expenses = db.query(Expense).filter(Expense.company_id == comp_a.company_id).all()
    assert len(expenses) == 1
    exp = expenses[0]
    assert exp.payment_method == "Petty Cash"
    assert exp.reference_no == f"PC-DISB-{payload['topup_id']}"
    assert exp.linked_topup_id == payload["topup_id"]
    assert Decimal(str(exp.amount)) == Decimal("250.50")
    assert Decimal(str(exp.amount_paid)) == Decimal("250.50")

    # Balance and summary must reflect 1000.00 - 250.50 = 749.50 and NOT count disbursement as a topup
    svc = PettyCashService(db)
    summary = svc.get_summary(company=comp_a)
    assert Decimal(str(summary.total_topups)) == Decimal("1000.00")
    assert Decimal(str(summary.total_spent)) == Decimal("250.50")
    assert Decimal(str(summary.balance)) == Decimal("749.50")
    assert Decimal(str(summary.unreserved_balance)) == Decimal("749.50")

    summaries = svc.list_summaries()
    a_summary = next(s for s in summaries if s.company_id == comp_a.company_id)
    assert Decimal(str(a_summary.balance)) == Decimal("749.50")
    assert Decimal(str(a_summary.unreserved_balance)) == Decimal("749.50")

    # Ledger emits exactly one disbursement row (blank workflow status, Pending Audit, real expense_id)
    ledger = svc.list_ledger(company=comp_a)
    disb_rows = [r for r in ledger if r.request_type == "disbursement"]
    assert len(disb_rows) == 1
    assert disb_rows[0].entry_type == "expense"
    assert disb_rows[0].status == ""
    assert disb_rows[0].audit_status == "Pending Audit"
    assert disb_rows[0].expense_id == exp.expense_id
    assert Decimal(str(disb_rows[0].amount_out)) == Decimal("250.50")
    assert len([r for r in ledger if r.entry_type == "expense"]) == 1


def test_disbursement_respects_pending_reimbursement_unreserved_hold(pc_env, monkeypatch):
    monkeypatch.setattr(petty_cash_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    client = pc_env["client"]
    db = pc_env["db"]
    comp_a = pc_env["comp_a"]

    # Create a pending Reimbursement holding 600.00 of company float (unrecorded in Expenses yet)
    hold_reimb = PettyCashTopUp(
        company_id=comp_a.company_id,
        request_type="reimbursement",
        amount=Decimal("200.00"),
        total_expenses=Decimal("800.00"),
        company_funded_amount=Decimal("600.00"),
        employee_out_of_pocket=Decimal("200.00"),
        reserved_amount=Decimal("600.00"),
        topup_date=date.today(),
        description="Pending mixed reimbursement hold",
        status="Pending Finance Approval",
        paid_by="Alex Staff",
    )
    db.add(hold_reimb)
    db.commit()

    # Available unreserved = 1000.00 - 600.00 = 400.00
    bad_res = client.post(
        "/api/v1/petty-cash/disbursements",
        json={
            "company": comp_a.company_name,
            "amount": 500.00,
            "topup_date": date.today().isoformat(),
            "description": "Too large",
        },
    )
    assert bad_res.status_code == 422, bad_res.text
    detail = bad_res.json()["detail"]
    assert "400.00" in detail
    assert "500.00" in detail
    assert db.query(Expense).filter(Expense.company_id == comp_a.company_id).count() == 0

    # Exact remaining unreserved (400.00) must succeed
    ok_res = client.post(
        "/api/v1/petty-cash/disbursements",
        json={
            "company": comp_a.company_name,
            "amount": 400.00,
            "topup_date": date.today().isoformat(),
            "description": "Fits unreserved hold",
        },
    )
    assert ok_res.status_code == 201, ok_res.text
    assert db.query(Expense).filter(Expense.company_id == comp_a.company_id).count() == 1


def test_disbursement_role_and_company_access_guards(pc_env, monkeypatch):
    monkeypatch.setattr(petty_cash_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    client = pc_env["client"]
    comp_a = pc_env["comp_a"]
    comp_b = pc_env["comp_b"]
    user_box = pc_env["current_user_box"]

    # Company-scoped staff cannot create disbursement for another company
    cross_res = client.post(
        "/api/v1/petty-cash/disbursements",
        json={
            "company": comp_b.company_name,
            "amount": 50.00,
            "topup_date": date.today().isoformat(),
            "description": "Cross company attempt",
        },
    )
    assert cross_res.status_code == 403

    # Audit, Owner, and Admin cannot create disbursements via write guard
    for idx, blocked_role in enumerate(("audit", "owner", "admin"), start=10):
        user_box["user"] = {
            "user_id": idx,
            "email": f"{blocked_role}@mct.test",
            "full_name": "Blocked User",
            "role": blocked_role,
            "company_id": comp_a.company_id,
            "company_name": comp_a.company_name,
        }
        res = client.post(
            "/api/v1/petty-cash/disbursements",
            json={
                "company": comp_a.company_name,
                "amount": 50.00,
                "topup_date": date.today().isoformat(),
                "description": "Blocked role attempt",
            },
        )
        assert res.status_code == 403, f"Expected 403 for role={blocked_role}, got {res.status_code}"


def test_reimbursement_funding_breakdown_and_local_sql_expenses(pc_env):
    db = pc_env["db"]
    comp_a = pc_env["comp_a"]

    reimb = PettyCashTopUp(
        company_id=comp_a.company_id,
        request_type="reimbursement",
        amount=Decimal("300.00"),
        total_expenses=Decimal("800.00"),
        company_funded_amount=Decimal("500.00"),
        employee_out_of_pocket=Decimal("300.00"),
        reserved_amount=Decimal("500.00"),
        topup_date=date.today(),
        description="Mixed funding office supplies",
        status="Pending Finance Approval",
        paid_by="Alex Staff",
    )
    db.add(reimb)
    db.commit()

    svc = PettyCashService(db)
    ledger = svc.list_ledger(company=comp_a)
    reimb_row = next(r for r in ledger if r.record_id == reimb.topup_id)
    assert Decimal(str(reimb_row.total_expenses)) == Decimal("800.00")
    assert Decimal(str(reimb_row.company_funded_amount)) == Decimal("500.00")
    assert Decimal(str(reimb_row.employee_out_of_pocket)) == Decimal("300.00")

    # Verify AC-7: PettyCashService no longer uses get_supabase_admin_client
    assert not hasattr(petty_cash_service_module, "get_supabase_admin_client")
    src = inspect.getsource(PettyCashService._petty_cash_expenses)
    assert "supabase" not in src.lower()


def test_immediate_deduction_auditor_visibility_and_balance_parity(pc_env, monkeypatch):
    """Mixed & zero-excess claims deduct petty cash immediately, stay blank status, and preserve Auditor balance parity."""
    monkeypatch.setattr(petty_cash_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    client = pc_env["client"]
    db = pc_env["db"]
    comp_a = pc_env["comp_a"]

    # 1. Mixed claim: Total = 500, Petty Cash = 200 (deducts now), Out-of-Pocket = 300 (Pending Finance Endorsement)
    res_mixed = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": comp_a.company_name,
            "amount": 300.00,
            "total_expenses": 500.00,
            "company_funded_amount": 200.00,
            "employee_out_of_pocket": 300.00,
            "topup_date": date.today().isoformat(),
            "description": "Office courier and meals",
            "request_type": "reimbursement",
            "paid_by": "Alex Staff",
            "category": "Supplies",
        },
    )
    assert res_mixed.status_code == 201, res_mixed.text
    mixed = res_mixed.json()
    assert mixed["status"] == "Pending Finance Endorsement"
    assert Decimal(str(mixed["reserved_amount"])) == Decimal("0.00")
    assert mixed["petty_cash_expense_id"] is not None

    # 2. Zero-excess claim: Total = 150, Petty Cash = 150, Out-of-Pocket = 0 -> Settled immediately
    res_zero = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": comp_a.company_name,
            "amount": 0.00,
            "total_expenses": 150.00,
            "company_funded_amount": 150.00,
            "employee_out_of_pocket": 0.00,
            "topup_date": date.today().isoformat(),
            "description": "100pct float stationery",
            "request_type": "reimbursement",
            "paid_by": "Alex Staff",
            "category": "Supplies",
        },
    )
    assert res_zero.status_code == 201, res_zero.text
    zero = res_zero.json()
    assert zero["status"] == "Settled"
    assert zero["petty_cash_expense_id"] is not None

    # 3. Unendorsed top-up request (should NOT appear for Auditor)
    res_topup = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": comp_a.company_name,
            "amount": 400.00,
            "topup_date": date.today().isoformat(),
            "description": "Requested float replenish",
            "request_type": "topup",
        },
    )
    assert res_topup.status_code == 201, res_topup.text

    svc = PettyCashService(db)
    expected_bal = Decimal("1000.00") - Decimal("200.00") - Decimal("150.00")
    assert svc.get_balance(comp_a.company_id) == expected_bal

    # Non-auditor ledger view
    staff_ledger = svc.list_ledger(company=comp_a, user_role="company")
    pc_mixed = next(r for r in staff_ledger if r.entry_id == f"topup-{mixed['topup_id']}-pc")
    reimb_mixed = next(r for r in staff_ledger if r.entry_id == f"topup-{mixed['topup_id']}-reimb")
    assert pc_mixed.status == ""
    assert pc_mixed.audit_status == "Pending Audit"
    assert Decimal(str(pc_mixed.amount_out)) == Decimal("200.00")
    assert reimb_mixed.status == "Pending Finance Endorsement"
    assert reimb_mixed.audit_status is None

    # Zero-excess claim only emits disbursement row and omits movement from list_movements
    assert [r.entry_id for r in staff_ledger if r.record_id == zero["topup_id"]] == [f"topup-{zero['topup_id']}-pc"]
    movements = svc.list_movements(company=comp_a)
    assert all(m.topup_id != zero["topup_id"] for m in movements)

    # Auditor sees immediately deducted disbursements (with matching running_balance!)
    # while unendorsed top-up and -reimb rows stay hidden.
    audit_ledger = svc.list_ledger(company=comp_a, user_role="audit")
    audit_ids = {r.entry_id for r in audit_ledger}
    assert f"topup-{mixed['topup_id']}-pc" in audit_ids
    assert f"topup-{zero['topup_id']}-pc" in audit_ids
    assert f"topup-{mixed['topup_id']}-reimb" not in audit_ids
    assert f"topup-{res_topup.json()['topup_id']}" not in audit_ids
    assert Decimal(str(audit_ledger[0].running_balance)) == expected_bal


def test_audit_status_persistence_via_expenses_endpoint_and_workflow_audit_derivation(pc_env, monkeypatch):
    """Disbursement & standalone Petty Cash Expense audit statuses persist via PATCH /expenses/{id}/audit,
    and Top-up / Reimburse rows derive Audit Status from workflow approval."""
    from app.api.v1.endpoints.expenses import router as expenses_router
    import app.services.audit_review_service as audit_review_service_module

    monkeypatch.setattr(petty_cash_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    monkeypatch.setattr(audit_review_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    monkeypatch.setattr(audit_review_service_module, "get_supabase_admin_client", lambda: None)

    app = pc_env["app"]
    app.include_router(expenses_router, prefix="/api/v1/expenses")
    client = TestClient(app)
    db = pc_env["db"]
    comp_a = pc_env["comp_a"]
    cat_supplies = pc_env["cat_supplies"]
    user_box = pc_env["current_user_box"]

    # Create a direct Petty Cash Expense (Expense module) and an immediate zero-excess Disbursement
    standalone_exp = Expense(
        company_id=comp_a.company_id,
        category_id=cat_supplies.category_id,
        expense_date=date.today(),
        amount=Decimal("100.00"),
        amount_paid=Decimal("100.00"),
        description="Printer ink direct petty cash",
        payment_method="Petty Cash",
        reference_no="EXP-RAW-1",
    )
    db.add(standalone_exp)
    db.commit()
    db.refresh(standalone_exp)

    res_zero = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": comp_a.company_name,
            "amount": 0.00,
            "total_expenses": 250.00,
            "company_funded_amount": 250.00,
            "employee_out_of_pocket": 0.00,
            "topup_date": date.today().isoformat(),
            "description": "Immediate disbursement item",
            "request_type": "reimbursement",
        },
    )
    assert res_zero.status_code == 201, res_zero.text
    disb_exp_id = res_zero.json()["petty_cash_expense_id"]

    # Create Top-up rows at every workflow stage to verify derived workflow audit_status
    stages = [
        ("Pending Finance Endorsement", None),
        ("Rejected by Finance", None),
        ("Pending Audit Approval", "Pending Audit"),
        ("Approved", "Verified"),
        ("Disapproved by Audit", "Flagged"),
    ]
    stage_topup_ids = {}
    for st_label, _ in stages:
        t = PettyCashTopUp(
            company_id=comp_a.company_id,
            request_type="topup",
            amount=Decimal("50.00"),
            topup_date=date.today(),
            description=f"Topup {st_label}",
            status=st_label,
        )
        db.add(t)
        db.flush()
        stage_topup_ids[st_label] = t.topup_id
    db.commit()

    # Initial check: blank workflow status and Pending Audit on both Expense & Disbursement
    ledger_before = client.get(f"/api/v1/petty-cash/ledger?company_name={comp_a.company_name}").json()
    raw_row = next(r for r in ledger_before if r["entry_id"] == f"expense-{standalone_exp.expense_id}")
    disb_row = next(r for r in ledger_before if r["entry_id"] == f"topup-{res_zero.json()['topup_id']}-pc")
    assert raw_row["status"] == ""
    assert raw_row["audit_status"] == "Pending Audit"
    assert disb_row["status"] == ""
    assert disb_row["audit_status"] == "Pending Audit"

    for st_label, expected_audit in stages:
        row = next(r for r in ledger_before if r["record_id"] == stage_topup_ids[st_label] and r["request_type"] == "topup")
        assert row["audit_status"] == expected_audit

    # Switch to Audit Officer and persist real audit reviews on both expenses
    user_box["user"] = {
        "user_id": 9,
        "email": "auditor@mct.test",
        "full_name": "Claire Auditor",
        "role": "audit",
        "company_ids": [comp_a.company_id],
    }
    r1 = client.patch(f"/api/v1/expenses/{standalone_exp.expense_id}/audit", json={"audit_status": "Verified"})
    assert r1.status_code == 200, r1.text
    r2 = client.patch(f"/api/v1/expenses/{disb_exp_id}/audit", json={"audit_status": "Flagged", "remarks": "Missing OR"})
    assert r2.status_code == 200, r2.text

    # Reload ledger as Finance and verify persisted audit_status & cache invalidation
    user_box["user"] = {
        "user_id": 8,
        "email": "finance@mct.test",
        "full_name": "Fran Finance",
        "role": "finance",
        "company_ids": [comp_a.company_id],
    }
    ledger_after = client.get(f"/api/v1/petty-cash/ledger?company_name={comp_a.company_name}").json()
    raw_after = next(r for r in ledger_after if r["entry_id"] == f"expense-{standalone_exp.expense_id}")
    disb_after = next(r for r in ledger_after if r["entry_id"] == f"topup-{res_zero.json()['topup_id']}-pc")
    assert raw_after["status"] == ""
    assert raw_after["audit_status"] == "Verified"
    assert raw_after["audited_by"] == "Claire Auditor"
    assert disb_after["status"] == ""
    assert disb_after["audit_status"] == "Flagged"
    assert disb_after["audit_remarks"] == "Missing OR"


def test_delete_pending_mixed_claim_preserves_pc_expense_and_zero_excess_skips_notifications(pc_env, monkeypatch):
    """Zero-excess creates no workflow notifications; deleting a pending mixed claim preserves the disbursed Expense cleanly."""
    from app.models.notification import Notification
    from app.models.user import User

    monkeypatch.setattr(petty_cash_service_module.ws_manager, "broadcast_sync", lambda *a, **kw: None)
    client = pc_env["client"]
    db = pc_env["db"]
    comp_a = pc_env["comp_a"]

    fin_user = User(name="Finance Approver", email="fin@mct.test", role="finance", status="ACTIVE")
    aud_user = User(name="Audit Approver", email="aud@mct.test", role="audit", status="ACTIVE")
    db.add_all([fin_user, aud_user])
    db.commit()

    # 1. Zero-excess claim must NOT create Finance/Audit approval notifications
    res_zero = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": comp_a.company_name,
            "amount": 0.00,
            "total_expenses": 120.00,
            "company_funded_amount": 120.00,
            "employee_out_of_pocket": 0.00,
            "topup_date": date.today().isoformat(),
            "description": "Zero excess no notif",
            "request_type": "reimbursement",
        },
    )
    assert res_zero.status_code == 201, res_zero.text
    assert res_zero.json()["status"] == "Settled"
    assert db.query(Notification).count() == 0

    # 2. Mixed pending claim -> creates PC-EXP immediately -> delete pending request -> Expense remains unlinked & balance intact
    res_mixed = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_name": comp_a.company_name,
            "amount": 200.00,
            "total_expenses": 500.00,
            "company_funded_amount": 300.00,
            "employee_out_of_pocket": 200.00,
            "topup_date": date.today().isoformat(),
            "description": "Mixed delete preservation",
            "request_type": "reimbursement",
        },
    )
    assert res_mixed.status_code == 201, res_mixed.text
    topup_id = res_mixed.json()["topup_id"]
    pc_exp_id = res_mixed.json()["petty_cash_expense_id"]

    del_res = client.delete(f"/api/v1/petty-cash/topups/{topup_id}")
    assert del_res.status_code == 204, del_res.text

    exp_after = db.query(Expense).filter(Expense.expense_id == pc_exp_id).first()
    assert exp_after is not None
    assert exp_after.linked_topup_id is None
    assert exp_after.reference_no == f"EXP-PC-{pc_exp_id}"

    svc = PettyCashService(db)
    expected_bal = Decimal("1000.00") - Decimal("120.00") - Decimal("300.00")
    assert svc.get_balance(comp_a.company_id) == expected_bal
    ledger = svc.list_ledger(company=comp_a)
    assert Decimal(str(ledger[0].running_balance)) == expected_bal
    standalone_row = next(r for r in ledger if r.entry_id == f"expense-{pc_exp_id}")
    assert standalone_row.status == ""
    assert standalone_row.audit_status == "Pending Audit"
