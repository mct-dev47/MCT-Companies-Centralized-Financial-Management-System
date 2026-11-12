from datetime import date
from decimal import Decimal
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
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
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
def test_env(monkeypatch):
    import app.api.v1.endpoints.petty_cash as petty_cash_endpoint_module
    monkeypatch.setattr(petty_cash_endpoint_module, "log_transaction", lambda *a, **kw: None)

    engine, SessionLocal = _make_test_env()
    db = SessionLocal()

    company = Company(company_name="MCT Kitchen", starting_balance=Decimal("0.00"))
    db.add(company)
    db.flush()

    wallet = PettyCashWallet(company_id=company.company_id, low_balance_threshold=Decimal("500.00"))
    db.add(wallet)
    db.commit()

    current_user_box = {
        "user": {
            "user_id": 1,
            "email": "supervisor@mct.test",
            "full_name": "Alex Supervisor",
            "role": "supervisor",
            "company_id": company.company_id,
            "company_name": company.company_name,
        }
    }

    test_app = FastAPI()
    test_app.include_router(petty_cash_router, prefix="/api/v1/petty-cash")

    def _override_get_db():
        try:
            yield db
        finally:
            pass

    def _override_get_current_user():
        return current_user_box["user"]

    test_app.dependency_overrides[get_db] = _override_get_db
    test_app.dependency_overrides[get_current_user] = _override_get_current_user
    client = TestClient(test_app)

    yield {"client": client, "db": db, "company": company, "current_user_box": current_user_box}

    test_app.dependency_overrides.clear()
    db.close()


def test_edit_and_delete_pending_topup(test_env):
    client = test_env["client"]
    db = test_env["db"]
    company = test_env["company"]

    # 1. Create top-up request
    res = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_id": company.company_id,
            "amount": 2500.00,
            "topup_date": "2026-11-12",
            "description": "Initial top-up request",
            "request_type": "topup",
        },
    )
    assert res.status_code == 201, res.text
    topup_id = res.json()["topup_id"]
    assert res.json()["status"] == "Pending Finance Endorsement"

    # 2. Edit top-up request
    edit_res = client.put(
        f"/api/v1/petty-cash/topups/{topup_id}",
        json={
            "amount": 3000.00,
            "description": "Updated top-up request",
        },
    )
    assert edit_res.status_code == 200, edit_res.text
    assert float(edit_res.json()["amount"]) == 3000.00
    assert edit_res.json()["description"] == "Updated top-up request"

    # 3. Delete top-up request
    del_res = client.delete(
        f"/api/v1/petty-cash/topups/{topup_id}",
    )
    assert del_res.status_code == 204

    # Verify deleted
    assert db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first() is None


def test_edit_and_delete_pending_reimbursement(test_env):
    client = test_env["client"]
    db = test_env["db"]
    company = test_env["company"]

    # 1. Create reimbursement claim
    res = client.post(
        "/api/v1/petty-cash/reimbursements",
        json={
            "company_id": company.company_id,
            "amount": 1200.00,
            "total_expenses": 1200.00,
            "company_funded_amount": 0.00,
            "topup_date": "2026-11-12",
            "description": "Office supplies claim",
            "paid_by": "Maria Clara",
            "category": "Office Supplies",
        },
    )
    assert res.status_code == 201, res.text
    reimb_id = res.json()["topup_id"]
    assert res.json()["status"] == "Pending Finance Endorsement"

    # 2. Edit reimbursement claim
    edit_res = client.put(
        f"/api/v1/petty-cash/topups/{reimb_id}",
        json={
            "amount": 1500.00,
            "description": "Office supplies and toner",
            "paid_by": "Maria Clara Santos",
            "category": "Supplies",
        },
    )
    assert edit_res.status_code == 200, edit_res.text
    data = edit_res.json()
    assert float(data["amount"]) == 1500.00
    assert float(data["total_expenses"]) == 1500.00
    assert data["description"] == "Office supplies and toner"
    assert data["paid_by"] == "Maria Clara Santos"
    assert data["category"] == "Supplies"

    # 3. Delete reimbursement claim
    del_res = client.delete(
        f"/api/v1/petty-cash/topups/{reimb_id}",
    )
    assert del_res.status_code == 204
    assert db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == reimb_id).first() is None


def test_cannot_edit_or_delete_after_finance_endorsement(test_env):
    client = test_env["client"]
    db = test_env["db"]
    company = test_env["company"]

    # 1. Create top-up request
    res = client.post(
        "/api/v1/petty-cash/topups",
        json={
            "company_id": company.company_id,
            "amount": 1000.00,
            "topup_date": "2026-11-12",
            "description": "Top-up before endorsement",
            "request_type": "topup",
        },
    )
    assert res.status_code == 201
    topup_id = res.json()["topup_id"]

    # 2. Simulate finance endorsement by updating status to Pending Audit Approval
    topup = db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).first()
    topup.status = "Pending Audit Approval"
    topup.endorsed_by = "Finance Officer"
    db.commit()

    # 3. Editing should now be blocked
    edit_res = client.put(
        f"/api/v1/petty-cash/topups/{topup_id}",
        json={"amount": 1500.00, "description": "Attempted edit"},
    )
    assert edit_res.status_code == 400
    assert "already been reviewed by finance" in edit_res.text

    # 4. Deleting should also be blocked
    del_res = client.delete(
        f"/api/v1/petty-cash/topups/{topup_id}",
    )
    assert del_res.status_code == 400
    assert "already been reviewed by finance" in del_res.text


def test_edit_can_clear_optional_fields(test_env):
    client = test_env["client"]
    company = test_env["company"]

    res = client.post(
        "/api/v1/petty-cash/reimbursements",
        json={
            "company_id": company.company_id,
            "amount": 800.00,
            "total_expenses": 800.00,
            "company_funded_amount": 0.00,
            "topup_date": "2026-11-12",
            "description": "Taxi fare",
            "paid_by": "Maria",
            "category": "Travel",
        },
    )
    assert res.status_code == 201, res.text
    claim_id = res.json()["topup_id"]

    # The frontend now sends '' for a cleared field (it used to send null, which meant "unchanged").
    edit_res = client.put(
        f"/api/v1/petty-cash/topups/{claim_id}",
        json={"amount": 900.00, "description": "", "paid_by": "", "category": ""},
    )
    assert edit_res.status_code == 200, edit_res.text
    data = edit_res.json()
    assert float(data["amount"]) == 900.00
    assert data["description"] is None
    assert data["paid_by"] is None
    assert data["category"] is None
