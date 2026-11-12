from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.db.session import Base, get_db
from app.main import app
from app.models.company import Company
from app.models.finance import Sale, Expense, Category
from app.core.dependencies import require_business_reader


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    def override_business_reader():
        return {
            "id": 1,
            "email": "finance@mct.com",
            "role": "finance",
            "is_admin": False,
            "company_ids": [],
        }

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_business_reader] = override_business_reader
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_sales_daily_summary_empty(client, db_session):
    response = client.get("/api/v1/sales/daily-summary")
    assert response.status_code == 200
    assert response.json() == []


def test_sales_daily_summary_aggregation(client, db_session):
    company = Company(
        company_id=1,
        company_name="MCT Kitchen",
        location="Manila",
        starting_balance=Decimal("0.00"),
    )
    db_session.add(company)
    db_session.commit()

    sale1 = Sale(
        sales_id=1,
        company_id=1,
        transaction_date=date(2026, 10, 15),
        amount=Decimal("1500.00"),
        particulars="Burger sales (Paid: 1500.00)",
        cheque_no="CHQ-001",
        deposit_status="Deposited",
        audit_status="Verified",
    )
    sale2 = Sale(
        sales_id=2,
        company_id=1,
        transaction_date=date(2026, 10, 15),
        amount=Decimal("500.00"),
        particulars="Drinks (Paid: 500.00)",
        cheque_no="CHQ-002",
        deposit_status="Deposited",
        audit_status="Verified",
    )
    sale3 = Sale(
        sales_id=3,
        company_id=1,
        transaction_date=date(2026, 10, 14),
        amount=Decimal("2000.00"),
        particulars="Catering event [Unpaid]",
        cheque_no="CHQ-003",
        audit_status="Pending Audit",
    )
    db_session.add_all([sale1, sale2, sale3])
    db_session.commit()

    response = client.get("/api/v1/sales/daily-summary")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

    # Most recent date first (2026-10-15)
    day1 = data[0]
    assert day1["date"] == "2026-10-15"
    assert day1["day_of_week"] == "Thursday"
    assert day1["transaction_count"] == 2
    assert float(day1["gross_total"]) == 2000.00
    assert float(day1["realized_cash"]) == 2000.00
    assert day1["audit_status"] == "All Verified"

    # Day 2 (2026-10-14)
    day2 = data[1]
    assert day2["date"] == "2026-10-14"
    assert day2["day_of_week"] == "Wednesday"
    assert day2["transaction_count"] == 1
    assert float(day2["gross_total"]) == 2000.00
    assert float(day2["realized_cash"]) == 0.00
    assert day2["audit_status"] == "Pending Audit"


def test_expenses_daily_summary_aggregation(client, db_session):
    company = Company(
        company_id=1,
        company_name="MCT Kitchen",
        location="Manila",
        starting_balance=Decimal("0.00"),
    )
    db_session.add(company)
    db_session.commit()

    exp1 = Expense(
        expense_id=1,
        company_id=1,
        expense_date=date(2026, 10, 20),
        amount=Decimal("800.00"),
        amount_paid=Decimal("800.00"),
        description="Office supplies",
        reference_no="VOUCH-01",
        audit_status="Verified",
    )
    exp2 = Expense(
        expense_id=2,
        company_id=1,
        expense_date=date(2026, 10, 20),
        amount=Decimal("400.00"),
        amount_paid=Decimal("0.00"),
        description="Kitchen repairs (Discrepancy)",
        reference_no="VOUCH-02",
        audit_status="Discrepancy",
    )
    db_session.add_all([exp1, exp2])
    db_session.commit()

    response = client.get("/api/v1/expenses/daily-summary")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    day = data[0]
    assert day["date"] == "2026-10-20"
    assert day["day_of_week"] == "Tuesday"
    assert day["transaction_count"] == 2
    assert float(day["gross_total"]) == 1200.00
    assert day["audit_status"] == "Discrepancy"
