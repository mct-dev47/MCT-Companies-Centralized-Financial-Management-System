import pytest
from datetime import date
from decimal import Decimal
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import tenants as tenants_endpoints
from app.api.v1.endpoints import petty_cash as petty_cash_endpoints
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.bank import BankAccount
from app.models.petty_cash import PettyCashTopUp
from app.services import tenant_service

SUPERVISOR_JK = {
    "auth_user_id": "s_jk",
    "user_id": 105,
    "email": "jkproperty@mct.com",
    "full_name": "JK Supervisor",
    "company_id": 5,
    "company_ids": [5],
    "is_admin": False,
    "role": "supervisor",
}

FINANCE_USER = {
    "auth_user_id": "f_user",
    "user_id": 102,
    "email": "finance@mct.com",
    "full_name": "Finance Officer",
    "company_id": None,
    "company_ids": [1, 2, 3, 4, 5],
    "is_admin": False,
    "role": "finance",
}

@pytest.fixture()
def setup_app(monkeypatch):
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)
    monkeypatch.setattr("app.api.v1.endpoints.tenants.require_company_feature_access", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.petty_cash_service.get_supabase_admin_client", lambda: None)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("app.services.activity_log_service.SessionLocal", Session)
    monkeypatch.setattr("app.db.session.SessionLocal", Session)

    with Session() as seed:
        seed.add_all([
            Company(company_id=1, company_name="MCT Kitchen", location="Manila", starting_balance=0),
            Company(company_id=5, company_name="JK Property and Ventures Corporation", location="Manila", starting_balance=0),
            BankAccount(
                id="bank-1",
                company_id=1,
                company_name="MCT Kitchen",
                bank_name="BDO",
                account_name="Main Operating Account",
                account_number="1234567890",
                account_type="Checking",
                branch="Main",
                current_balance=Decimal("500000.00"),
                starting_balance=Decimal("500000.00"),
            ),
        ])
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.dependency_overrides[get_db] = override_db
    app.include_router(tenants_endpoints.router, prefix="/api/v1/tenants")
    app.include_router(petty_cash_endpoints.router, prefix="/api/v1/petty-cash")
    return app

def test_tenant_lease_creation_resolves_company_name(setup_app):
    """Verifies AC-3: POST /api/v1/tenants/leases resolves company name and succeeds without error."""
    current_caller = SUPERVISOR_JK
    setup_app.dependency_overrides[get_current_user] = lambda: current_caller
    client = TestClient(setup_app)

    payload = {
        "company_name": "JK Property and Ventures Corporation",
        "tenant_name": "Rolando Gomez",
        "unit_name": "Stall 14A",
        "rent_amount": 15000.0,
        "contract_date": "2026-11-01",
        "due_date": "2026-11-01",
        "lease_end_date": "2027-11-01",
        "repeat_mode": "Monthly",
        "penalty_rate": 5.0,
        "status": "Active",
    }
    res = client.post("/api/v1/tenants/leases", json=payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["company_id"] == 5
    assert data["tenant_name"] == "Rolando Gomez"
    assert data["penalty_rate"] == 5.0

def test_tenant_penalty_rejects_negative(setup_app):
    """Verifies AC-2: Negative late penalty is rejected by server validation."""
    setup_app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_JK
    client = TestClient(setup_app)

    payload = {
        "company_id": 5,
        "tenant_name": "Maria Santos",
        "unit_name": "Unit B",
        "rent_amount": 10000.0,
        "contract_date": "2026-11-01",
        "due_date": "2026-11-01",
        "lease_end_date": "2027-11-01",
        "repeat_mode": "Monthly",
        "penalty_rate": -10.0,
        "status": "Active",
    }
    res = client.post("/api/v1/tenants/leases", json=payload)
    assert res.status_code == 400
    assert "Late penalty must be blank or a number from 0 to 100" in res.json()["detail"]

def test_petty_cash_topup_accepts_company_and_company_name(setup_app):
    """Verifies AC-4: Petty cash top up accepts company or company_name without attribute error."""
    setup_app.dependency_overrides[get_current_user] = lambda: FINANCE_USER
    client = TestClient(setup_app)

    # 1. Calling with company_name
    res1 = client.post("/api/v1/petty-cash/topups", json={
        "company_name": "MCT Kitchen",
        "amount": 2500.0,
        "topup_date": date.today().isoformat(),
        "description": "Replenish pantry funds",
    })
    assert res1.status_code == 201, res1.text
    assert res1.json()["company_id"] == 1

    # 2. Calling with company (legacy schema field)
    res2 = client.post("/api/v1/petty-cash/topups", json={
        "company": "MCT Kitchen",
        "amount": 1500.0,
        "topup_date": date.today().isoformat(),
        "description": "Weekly condiments budget",
    })
    assert res2.status_code == 201, res2.text
    assert res2.json()["company_id"] == 1

def test_finance_petty_cash_endorsement_workflow(setup_app):
    """Verifies AC-6: When finance requests petty cash with funding bank, it routes directly to pending audit review."""
    setup_app.dependency_overrides[get_current_user] = lambda: FINANCE_USER
    client = TestClient(setup_app)

    payload = {
        "company_name": "MCT Kitchen",
        "amount": 10000.0,
        "topup_date": date.today().isoformat(),
        "description": "Emergency kitchen supplies replenishment",
        "status": "Pending Audit Approval",
        "bank_account_id": "bank-1",
        "finance_remark": "Endorsed from BDO main operating bank",
    }
    res = client.post("/api/v1/petty-cash/topups", json=payload)
    assert res.status_code == 201, res.text
    topup = res.json()
    assert topup["status"] == "Pending Audit Approval"
    assert topup["bank_account_id"] == "bank-1"
    assert topup["finance_remark"] == "Endorsed from BDO main operating bank"
    assert topup["endorsed_by"] == "Finance Officer"
