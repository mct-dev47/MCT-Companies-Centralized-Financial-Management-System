"""An expense paid with petty cash is always filed under the Petty Cash category."""
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

from app.api.v1.endpoints import expenses as expenses_endpoints
from app.core.dependencies import get_current_user, get_db
from app.db.session import Base
from app.models.company import Company
from app.models.finance import Category, Expense

SUPERVISOR = {
    "auth_user_id": "sup1",
    "user_id": 3,
    "email": "cashier1@example.com",
    "company_id": 1,
    "company_ids": [1],
    "is_admin": False,
    "role": "supervisor",
}


def _no_supabase():
    raise RuntimeError("Supabase disabled in tests")


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as seed:
        seed.add(Company(company_id=1, company_name="Company One", location="Manila", starting_balance=0))
        seed.add(Category(name="Office Supplies"))
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(expenses_endpoints.router, prefix="/api/v1/expenses")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR

    with patch("app.api.v1.endpoints.expenses.get_supabase_admin_client", side_effect=_no_supabase), \
         patch("app.api.v1.endpoints.expenses.reconcile_expense_bank"), \
         patch("app.api.v1.endpoints.expenses.log_transaction"), \
         patch("app.core.websocket.ws_manager.broadcast_sync"):
        yield {"Session": Session, "client": TestClient(app)}


def _category_of(Session, expense_id):
    with Session() as db:
        exp = db.get(Expense, expense_id)
        cat = db.get(Category, exp.category_id) if exp.category_id else None
        return cat.name if cat else None


def _create(client, **kw):
    body = {
        "company_id": 1,
        "category": "Office Supplies",
        "expense_date": date.today().isoformat(),
        "amount": 150,
        "particulars": "Bond paper",
        "payment_method": "Cash",
    }
    body.update(kw)
    res = client.post("/api/v1/expenses/", json=body)
    assert res.status_code in (200, 201), res.text
    return res.json()


def _id(payload):
    return payload.get("expense_id") or payload.get("record_id") or payload.get("id")


def test_petty_cash_payment_forces_petty_cash_category(env):
    created = _create(env["client"], payment_method="Petty Cash")
    assert _category_of(env["Session"], _id(created)) == "Petty Cash"


def test_other_payment_keeps_chosen_category(env):
    created = _create(env["client"], payment_method="Cash")
    assert _category_of(env["Session"], _id(created)) == "Office Supplies"


def test_switching_to_petty_cash_on_edit_forces_petty_cash_category(env):
    created = _create(env["client"], payment_method="Cash")
    eid = _id(created)
    res = env["client"].put(
        f"/api/v1/expenses/{eid}",
        json={"payment_method": "Petty Cash", "category": "Office Supplies"},
    )
    assert res.status_code == 200, res.text
    assert _category_of(env["Session"], eid) == "Petty Cash"
