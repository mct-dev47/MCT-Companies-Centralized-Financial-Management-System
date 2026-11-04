from datetime import date
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import tenants as tenants_endpoints
from app.core.errors import validation_exception_handler
from app.core.cache import system_cache
from app.core.dependencies import get_current_user, get_db
from app.db.session import Base
from app.models.company import Company
from app.services import tenant_service
from app.services.tenant_service import (
    extract_company_code,
    count_periods,
    add_period_clamped,
)


FINANCE_USER = {
    "auth_user_id": "finance_u",
    "user_id": 2,
    "email": "finance@mct.com",
    "company_id": None,
    "company_ids": [1, 2, 5],
    "is_admin": False,
    "role": "finance",
}


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setattr(tenant_service, "_supabase_client", lambda: None)
    monkeypatch.setattr("app.api.v1.endpoints.tenants.require_company_feature_access", lambda *args, **kwargs: None)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("app.services.activity_log_service.SessionLocal", Session)
    monkeypatch.setattr("app.db.session.SessionLocal", Session)

    with Session() as seed:
        seed.add_all([
            Company(company_id=1, company_name="JK Property and Ventures Corporation", location="Manila", starting_balance=0),
            Company(company_id=2, company_name="FILCAP Prime Holdings Corp.", location="Cebu", starting_balance=0),
            Company(company_id=5, company_name="MCT Hospitality", location="Makati", starting_balance=0),
        ])
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.include_router(tenants_endpoints.router, prefix="/tenants")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: FINANCE_USER
    client = TestClient(app)
    return client


def test_extract_company_code():
    """covers: AC-6 - Company code extraction from company names."""
    assert extract_company_code("JK Property and Ventures Corporation") == "JK"
    assert extract_company_code("FILCAP Prime Holdings Corp.") == "FILCAP"
    assert extract_company_code("MCT Hospitality Business Corp") == "MCT"
    assert extract_company_code("Speedfire Retail") == "SPEEDFIRE"
    assert extract_company_code("") == "JK"


def test_tenant_reference_format_by_company(env):
    """covers: AC-6 - Tenant reference formatting per company TNT-{COMPANY_CODE}-{YYYY}-{NNN}."""
    client = env
    year = date.today().year

    # 1. JK lease
    r1 = client.post("/tenants/leases", json={
        "company_id": 1,
        "tenant_name": "Tenant Alpha",
        "unit_name": "Unit 101",
        "rent_amount": 15000,
        "contract_date": "2026-11-01",
        "due_date": "2026-12-01",
        "repeat_mode": "None",
        "total_amount_payable": 15000,
    })
    assert r1.status_code == 201, r1.text
    assert r1.json()["tenant_ref"] == f"TNT-JK-{year}-001"

    # 2. FILCAP lease
    r2 = client.post("/tenants/leases", json={
        "company_id": 2,
        "tenant_name": "Tenant Beta",
        "unit_name": "Unit 201",
        "rent_amount": 25000,
        "contract_date": "2026-11-01",
        "due_date": "2026-12-01",
        "repeat_mode": "None",
        "total_amount_payable": 25000,
    })
    assert r2.status_code == 201, r2.text
    assert r2.json()["tenant_ref"] == f"TNT-FILCAP-{year}-001"

    # 3. MCT lease
    r3 = client.post("/tenants/leases", json={
        "company_id": 5,
        "tenant_name": "Tenant Gamma",
        "unit_name": "Unit 301",
        "rent_amount": 35000,
        "contract_date": "2026-11-01",
        "due_date": "2026-12-01",
        "repeat_mode": "None",
        "total_amount_payable": 35000,
    })
    assert r3.status_code == 201, r3.text
    assert r3.json()["tenant_ref"] == f"TNT-MCT-{year}-001"


def test_tenant_reference_increments_sequence(env):
    """covers: AC-6 - Multiple leases in the same company increment sequence numbers."""
    client = env
    year = date.today().year

    for idx in range(1, 4):
        res = client.post("/tenants/leases", json={
            "company_id": 1,
            "tenant_name": f"Sequential Tenant {idx}",
            "unit_name": f"Unit {idx}",
            "rent_amount": 10000,
            "contract_date": "2026-11-01",
            "due_date": "2026-12-01",
            "repeat_mode": "None",
            "total_amount_payable": 10000,
        })
        assert res.status_code == 201, res.text
        assert res.json()["tenant_ref"] == f"TNT-JK-{year}-{idx:03d}"


def test_backend_deduplication_rejects_rapid_duplicate(env):
    """covers: AC-2 - Backend rejects concurrent rapid duplicate submissions within 5 seconds."""
    client = env
    payload = {
        "company_id": 1,
        "tenant_name": "Rapid Clicker",
        "unit_name": "Stall 99",
        "rent_amount": 12000,
        "contract_date": "2026-11-01",
        "due_date": "2026-12-01",
        "repeat_mode": "None",
        "total_amount_payable": 12000,
    }

    # First click succeeds
    first = client.post("/tenants/leases", json=payload)
    assert first.status_code == 201

    # Second click within 5s returns 409 Conflict
    second = client.post("/tenants/leases", json=payload)
    assert second.status_code == 409
    assert "recently submitted" in second.json()["detail"].lower()

    # Third click with different case and spacing also detected
    case_variation = dict(payload)
    case_variation["tenant_name"] = "  rapid clicker  "
    third = client.post("/tenants/leases", json=case_variation)
    assert third.status_code == 409


def test_non_repeating_lease_total_payable_mirroring(env):
    """covers: AC-3 - Non repeating lease mirrors rent amount into total amount payable when omitted."""
    client = env
    payload = {
        "company_id": 1,
        "tenant_name": "Mirror Tenant",
        "unit_name": "Unit M1",
        "rent_amount": 18500,
        "contract_date": "2026-11-01",
        "due_date": "2026-11-15",
        "repeat_mode": "None",
    }
    res = client.post("/tenants/leases", json=payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["rent_amount"] == 18500.0
    assert data["total_amount_payable"] == 18500.0


def test_repeating_lease_total_payable_calculation(env):
    """covers: AC-5 - Repeating lease computes total amount payable from rent multiplied by period count."""
    client = env
    # 12 monthly periods from 2026-11-01 to 2027-10-01 at 20,000 rent = 240,000 total
    payload = {
        "company_id": 1,
        "tenant_name": "Annual Repeating Tenant",
        "unit_name": "Unit R12",
        "rent_amount": 20000,
        "contract_date": "2026-11-01",
        "due_date": "2026-11-01",
        "lease_end_date": "2027-10-01",
        "repeat_mode": "Monthly",
    }
    res = client.post("/tenants/leases", json=payload)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["total_amount_payable"] == 240000.0


def test_period_maths_across_frequencies():
    """covers: AC-4, AC-5 - Period counting and date clamping across all repeat modes."""
    # Daily: 30 days
    start_d = date(2026, 11, 1)
    end_d = date(2026, 11, 30)
    assert count_periods(start_d, end_d, "Daily") == 30

    # Monthly: 12 months
    start_m = date(2026, 11, 1)
    end_m = date(2027, 10, 1)
    assert count_periods(start_m, end_m, "Monthly") == 12

    # Quarterly: 4 quarters (1 year)
    start_q = date(2026, 11, 1)
    end_q = date(2027, 8, 1)
    assert count_periods(start_q, end_q, "Quarterly") == 4

    # Annually: 3 years
    start_y = date(2026, 11, 1)
    end_y = date(2028, 11, 1)
    assert count_periods(start_y, end_y, "Annually") == 3

    # Clamping on month ends (Jan 31 + 1 month = Feb 28)
    clamped = add_period_clamped(date(2026, 1, 31), "Monthly", 1)
    assert clamped == date(2026, 2, 28)


def test_repeating_lease_requires_valid_dates(env):
    """covers: AC-4, AC-5 - Repeating lease rejects missing or reversed end dates."""
    client = env
    # Missing lease end date
    r1 = client.post("/tenants/leases", json={
        "company_id": 1,
        "tenant_name": "Invalid Date Tenant",
        "unit_name": "Unit X",
        "rent_amount": 10000,
        "contract_date": "2026-11-01",
        "due_date": "2026-11-01",
        "repeat_mode": "Monthly",
    })
    assert r1.status_code == 400
    assert "lease end date is required" in r1.json()["detail"].lower()

    # End date before first due date
    r2 = client.post("/tenants/leases", json={
        "company_id": 1,
        "tenant_name": "Reversed Date Tenant",
        "unit_name": "Unit Y",
        "rent_amount": 10000,
        "contract_date": "2026-11-01",
        "due_date": "2026-11-01",
        "lease_end_date": "2026-10-01",
        "repeat_mode": "Monthly",
    })
    assert r2.status_code == 400
    assert "must be on or after the first due date" in r2.json()["detail"].lower()
