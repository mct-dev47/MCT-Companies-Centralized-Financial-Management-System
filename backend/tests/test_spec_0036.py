from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app
from app.models.company import Company
from app.models.particular import CompanyParticular
from app.core.dependencies import (
    require_business_reader,
    require_business_writer,
    AuthenticatedUser,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine
)

mock_user = AuthenticatedUser(
    auth_user_id="test-user-id",
    email="encoder@mct.com",
    role="encoder",
    company_ids=[1],
    accessible_company_ids=[1],
)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    # Seed company 1
    comp = Company(
        company_id=1,
        company_name="Test Company",
        location="Manila",
        starting_balance=Decimal("0.00"),
        petty_cash=Decimal("0.00"),
    )
    db.add(comp)
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


from unittest.mock import patch

@pytest.fixture()
def client():
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_business_reader] = lambda: mock_user
    app.dependency_overrides[require_business_writer] = lambda: mock_user

    with patch("app.api.v1.endpoints.particulars.get_supabase_admin_client", return_value=None):
        with TestClient(app) as test_client:
            yield test_client

    app.dependency_overrides.clear()


def test_particulars_scoping_sales_vs_expense(client):
    """
    AC-1: Particulars saved on sales sheets never appear in expense autocomplete lists,
    and particulars saved on expense sheets never appear in sales autocomplete lists.
    """
    # 1. Create a sales particular
    sales_res = client.post(
        "/api/v1/particulars",
        json={
            "company_id": 1,
            "company_name": "Test Company",
            "name": "Room Night Sales",
            "transaction_type": "Sales",
        },
    )
    assert sales_res.status_code == 201
    assert sales_res.json()["name"] == "Room Night Sales"
    assert sales_res.json()["transaction_type"] == "Sales"

    # 2. Create an expense particular
    expense_res = client.post(
        "/api/v1/particulars",
        json={
            "company_id": 1,
            "company_name": "Test Company",
            "name": "Plumbing Maintenance",
            "transaction_type": "Expense",
        },
    )
    assert expense_res.status_code == 201
    assert expense_res.json()["name"] == "Plumbing Maintenance"
    assert expense_res.json()["transaction_type"] == "Expense"

    # 3. Query with transaction_type=Sales
    get_sales = client.get("/api/v1/particulars?company_id=1&transaction_type=Sales")
    assert get_sales.status_code == 200
    sales_names = [p["name"] for p in get_sales.json()]
    assert "Room Night Sales" in sales_names
    assert "Plumbing Maintenance" not in sales_names

    # 4. Query with transaction_type=Expense
    get_expense = client.get("/api/v1/particulars?company_id=1&transaction_type=Expense")
    assert get_expense.status_code == 200
    expense_names = [p["name"] for p in get_expense.json()]
    assert "Plumbing Maintenance" in expense_names
    assert "Room Night Sales" not in expense_names


def test_particulars_duplicate_check_per_type(client):
    """
    Verify same name can exist across different transaction types,
    but duplicate within the same transaction type is deduplicated.
    """
    # Create "Consulting" for Sales
    res1 = client.post(
        "/api/v1/particulars",
        json={
            "company_id": 1,
            "name": "Consulting",
            "transaction_type": "Sales",
        },
    )
    assert res1.status_code == 201

    # Post duplicate for Sales -> returns existing without error
    res2 = client.post(
        "/api/v1/particulars",
        json={
            "company_id": 1,
            "name": "Consulting",
            "transaction_type": "Sales",
        },
    )
    assert res2.status_code == 201
    assert res2.json()["id"] == res1.json()["id"]

    # Create "Consulting" for Expense -> succeeds as a separate item
    res3 = client.post(
        "/api/v1/particulars",
        json={
            "company_id": 1,
            "name": "Consulting",
            "transaction_type": "Expense",
        },
    )
    assert res3.status_code == 201
    assert res3.json()["id"] != res1.json()["id"]
    assert res3.json()["transaction_type"] == "Expense"


def test_particulars_unauthorized_company_access(client):
    """
    AC-Security: A user cannot access or create particulars for a company
    they are not authorized to view/manage.
    """
    # Attempting to fetch company 999 should yield 403 Forbidden
    res_get = client.get("/api/v1/particulars?company_id=999")
    assert res_get.status_code == 403
    assert "Access denied" in res_get.json()["detail"]

    # Attempting to create for company 999 should yield 403 Forbidden
    res_post = client.post(
        "/api/v1/particulars",
        json={
            "company_id": 999,
            "name": "Unauthorized Particular",
            "transaction_type": "Sales",
        },
    )
    assert res_post.status_code == 403
    assert "Access denied" in res_post.json()["detail"]

