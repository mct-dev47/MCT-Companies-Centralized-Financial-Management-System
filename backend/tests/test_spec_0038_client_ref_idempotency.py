"""Spec 0038: resending a create with the same client_ref returns the existing record, never a duplicate."""
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

from app.api.v1.endpoints import expenses as expenses_endpoints
from app.api.v1.endpoints import receivables as receivables_endpoints
from app.api.v1.endpoints import sales as sales_endpoints
from app.core.dependencies import get_current_user, get_db
from app.db.session import Base
from app.models.company import Company
from app.models.finance import Expense, Sale
from app.models.receivable import Receivable

SUPERVISOR_CO1 = {
    "auth_user_id": "sup1",
    "user_id": 3,
    "email": "cashier1@mct.com",
    "company_id": 1,
    "company_ids": [1],
    "is_admin": False,
    "role": "supervisor",
}

SUPERVISOR_CO2 = {**SUPERVISOR_CO1, "auth_user_id": "sup2", "user_id": 5, "email": "cashier2@mct.com",
                  "company_id": 2, "company_ids": [2]}


def _no_supabase():
    raise RuntimeError("Supabase disabled in tests")


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as seed:
        seed.add_all([
            Company(company_id=1, company_name="Company One", location="Manila", starting_balance=0),
            Company(company_id=2, company_name="Company Two", location="Cebu", starting_balance=0),
        ])
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(sales_endpoints.router, prefix="/api/v1/sales")
    app.include_router(expenses_endpoints.router, prefix="/api/v1/expenses")
    app.include_router(receivables_endpoints.router, prefix="/api/v1/receivables")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_CO1

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as sales_sync, \
         patch("app.api.v1.endpoints.sales.get_supabase_admin_client", side_effect=_no_supabase), \
         patch("app.api.v1.endpoints.expenses.get_supabase_admin_client", side_effect=_no_supabase), \
         patch("app.api.v1.endpoints.sales.reconcile_sale_bank"), \
         patch("app.api.v1.endpoints.expenses.reconcile_expense_bank"), \
         patch("app.api.v1.endpoints.sales.log_transaction"), \
         patch("app.api.v1.endpoints.expenses.log_transaction"), \
         patch("app.api.v1.endpoints.sales.ws_manager"), \
         patch("app.core.websocket.ws_manager.broadcast_sync"):
        sales_sync.return_value._use_supabase.return_value = False
        yield {"app": app, "Session": Session, "client": TestClient(app)}


def _sale(**kw):
    body = {
        "company_id": 1,
        "category": "Food",
        "transaction_date": date.today().isoformat(),
        "amount": 250,
        "particulars": "Lunch set",
        "payment_status": "Paid",
        "payment_method": "Cash",
    }
    body.update(kw)
    return body


def _expense(**kw):
    body = {
        "company_id": 1,
        "category": "Supplies",
        "expense_date": date.today().isoformat(),
        "amount": 120,
        "particulars": "Napkins",
        "payment_method": "Cash",
    }
    body.update(kw)
    return body


def _receivable(**kw):
    body = {
        "customer_name": "Juan",
        "customer_type": "External",
        "company_id": 1,
        "items_summary": "Lunch set",
        "total_amount": 250,
        "payment_option": "Pay Later",
    }
    body.update(kw)
    return body


def test_sale_same_client_ref_creates_once(env):
    """AC-1"""
    client, Session = env["client"], env["Session"]
    first = client.post("/api/v1/sales", json=_sale(client_ref="ref-sale-0001"))
    assert first.status_code == 201, first.text
    second = client.post("/api/v1/sales", json=_sale(client_ref="ref-sale-0001"))
    assert second.status_code == 200, second.text
    assert second.json()["sales_id"] == first.json()["sales_id"]
    with Session() as db:
        assert db.query(Sale).filter(Sale.client_ref == "ref-sale-0001").count() == 1
        assert db.query(Sale).count() == 1


def test_expense_same_client_ref_creates_once(env):
    """AC-1"""
    client, Session = env["client"], env["Session"]
    first = client.post("/api/v1/expenses", json=_expense(client_ref="ref-exp-0001"))
    assert first.status_code == 201, first.text
    second = client.post("/api/v1/expenses", json=_expense(client_ref="ref-exp-0001"))
    assert second.status_code == 200, second.text
    assert second.json()["expense_id"] == first.json()["expense_id"]
    with Session() as db:
        assert db.query(Expense).count() == 1


def test_receivable_same_client_ref_creates_once(env):
    """AC-2"""
    client, Session = env["client"], env["Session"]
    first = client.post("/api/v1/receivables", json=_receivable(client_ref="ref-rec-0001"))
    assert first.status_code == 201, first.text
    second = client.post("/api/v1/receivables", json=_receivable(client_ref="ref-rec-0001"))
    assert second.status_code == 200, second.text
    assert second.json()["receivable_id"] == first.json()["receivable_id"]
    with Session() as db:
        assert db.query(Receivable).count() == 1


def test_client_ref_from_another_company_is_forbidden(env):
    """AC-3"""
    app, client = env["app"], env["client"]
    assert client.post("/api/v1/sales", json=_sale(client_ref="ref-shared-001")).status_code == 201
    assert client.post("/api/v1/receivables", json=_receivable(client_ref="ref-shared-002")).status_code == 201

    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_CO2
    sale = client.post("/api/v1/sales", json=_sale(company_id=2, client_ref="ref-shared-001"))
    assert sale.status_code == 403
    rec = client.post("/api/v1/receivables", json=_receivable(company_id=2, client_ref="ref-shared-002"))
    assert rec.status_code == 403


def test_without_client_ref_behaves_as_before(env):
    """AC-4"""
    client, Session = env["client"], env["Session"]
    assert client.post("/api/v1/sales", json=_sale()).status_code == 201
    assert client.post("/api/v1/sales", json=_sale()).status_code == 201
    assert client.post("/api/v1/expenses", json=_expense()).status_code == 201
    assert client.post("/api/v1/expenses", json=_expense()).status_code == 201
    with Session() as db:
        assert db.query(Sale).count() == 2
        assert db.query(Expense).count() == 2


def test_client_ref_too_short_is_rejected(env):
    assert env["client"].post("/api/v1/sales", json=_sale(client_ref="abc")).status_code == 422
