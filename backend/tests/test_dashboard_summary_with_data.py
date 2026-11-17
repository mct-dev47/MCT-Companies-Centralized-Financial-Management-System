"""The dashboard summary must load when there ARE sales and expenses.

The money totals come back as Decimal (SQLAlchemy Numeric), and the category percentages divided a
float by them, raising TypeError (HTTP 500: "The dashboard data could not be loaded"). The older
dashboard test had no sales, so the category loop never ran and the bug went unseen.
"""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import dashboard
from app.core.cache import system_cache
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.finance import Category, Expense, Sale

SUPERVISOR = {"user_id": 3, "email": "s@mct.test", "role": "supervisor", "is_admin": False,
              "company_id": 1, "company_ids": [1]}


@pytest.fixture()
def client():
    system_cache.clear()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    db.add_all([
        Company(company_id=1, company_name="Company Alpha", starting_balance=Decimal("0"), petty_cash=Decimal("5000.00")),
        Category(category_id=1, name="Room"),
        Category(category_id=2, name="Food"),
        Category(category_id=3, name="Supplies"),
        Sale(company_id=1, category_id=1, amount=Decimal("750.00"), transaction_date=date(2026, 11, 1),
             particulars="Room [Paid]", payment_status="Paid", deposit_status="Deposited"),
        Sale(company_id=1, category_id=2, amount=Decimal("250.00"), transaction_date=date(2026, 11, 2),
             particulars="Meal [Paid]", payment_status="Paid", deposit_status="Deposited"),
        Expense(company_id=1, category_id=3, amount=Decimal("400.00"), amount_paid=Decimal("400.00"),
                expense_date=date(2026, 11, 3), description="Soap [Paid]", payment_method="Cash"),
    ])
    db.commit()

    app = FastAPI()
    app.include_router(dashboard.router, prefix="/api/v1/dashboard")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR
    yield TestClient(app)
    db.close()
    system_cache.clear()


def test_dashboard_loads_with_sales_and_expenses(client):
    res = client.get("/api/v1/dashboard/summary")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["metrics"]["total_cash"] == 1000.0
    assert body["metrics"]["total_expense"] == 400.0
    income = {c["category"]: c["percentage"] for c in body["income_categories"]}
    assert income == {"Room": 75.0, "Food": 25.0}
    supplies = body["expense_categories"][0]
    assert (supplies["category"], supplies["amount"], supplies["percentage"]) == ("Supplies", 400.0, 100.0)
