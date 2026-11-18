"""Flag Discrepancy saves the Flagged status together with the auditor's remarks."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.services.audit_review_service as audit_svc
from app.api.v1.endpoints import expenses as expenses_endpoints
from app.api.v1.endpoints import sales as sales_endpoints
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.finance import Expense, Sale

AUDITOR = {"user_id": 7, "email": "auditor@mct.test", "full_name": "Ana Auditor", "role": "audit",
           "is_admin": False, "company_id": 1, "company_ids": [1]}


@pytest.fixture()
def env(monkeypatch):
    # No Supabase in tests: the review is saved to the local table only
    def _no_client():
        raise RuntimeError("no supabase in tests")

    monkeypatch.setattr(audit_svc, "get_supabase_admin_client", _no_client)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    db.add_all([
        Company(company_id=1, company_name="Company Alpha"),
        Sale(sales_id=1, company_id=1, transaction_date=date(2026, 11, 10), amount=Decimal("250.00"),
             particulars="Room [Paid]", payment_method="Cash", payment_status="Paid", deposit_status="Not Deposited"),
        Expense(expense_id=1, company_id=1, expense_date=date(2026, 11, 10), amount=Decimal("80.00"),
                amount_paid=Decimal("80.00"), description="Supplies [Paid]", payment_method="Cash"),
    ])
    db.commit()

    app = FastAPI()
    app.include_router(sales_endpoints.router, prefix="/api/v1/sales")
    app.include_router(expenses_endpoints.router, prefix="/api/v1/expenses")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AUDITOR
    yield TestClient(app), db
    db.close()


@pytest.mark.parametrize("resource,model", [("sales", Sale), ("expenses", Expense)])
def test_flag_saves_status_and_remarks(env, resource, model):
    client, db = env
    res = client.patch(f"/api/v1/{resource}/1/audit",
                       json={"audit_status": "Flagged", "remarks": "Receipt total does not match"})
    assert res.status_code == 200, res.text
    db.expire_all()
    row = db.get(model, 1)
    assert row.audit_status == "Flagged"
    assert row.audit_remarks == "Receipt total does not match"
    assert row.audited_by
