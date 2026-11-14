import pytest
from datetime import date
from decimal import Decimal
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import categories as categories_endpoints
from app.api.v1.endpoints import sales as sales_endpoints
from app.api.v1.endpoints import expenses as expenses_endpoints
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.bank import BankAccount
from app.models.finance import CompanyCategory, Category, Sale, Expense

FINANCE_USER = {
    "auth_user_id": "finance_1",
    "user_id": 10,
    "email": "finance@mct.com",
    "full_name": "Finance User",
    "company_id": 1,
    "company_ids": [1],  # Restricted to Company Alpha only (ID 1)
    "is_admin": False,
    "role": "finance",
}

@pytest.fixture()
def client_and_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    app = FastAPI()
    app.include_router(categories_endpoints.router, prefix="/api/v1/categories")
    app.include_router(sales_endpoints.router, prefix="/api/v1/sales")
    app.include_router(expenses_endpoints.router, prefix="/api/v1/expenses")

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user():
        return FINANCE_USER

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    # Setup seed companies and sole-owned bank
    db = TestingSessionLocal()
    comp_a = Company(company_id=1, company_name="Company Alpha", starting_balance=Decimal("10000.00"))
    comp_b = Company(company_id=2, company_name="Company Beta", starting_balance=Decimal("10000.00"))
    bank_a = BankAccount(
        id="bank-alpha-1",
        bank_name="BDO",
        account_name="Alpha Checking",
        account_number="1234567890",
        company_name="Company Alpha",
        company_id=1,
        starting_balance=Decimal("50000.00"),
        current_balance=Decimal("50000.00"),
    )
    db.add_all([comp_a, comp_b, bank_a])
    db.commit()
    db.close()

    test_client = TestClient(app)
    return test_client, TestingSessionLocal

def test_company_categories_crud_and_isolation(client_and_db):
    client, _ = client_and_db

    # 1. New company starts with ZERO categories
    resp = client.get("/api/v1/categories?company_name=Company Alpha&category_type=sales")
    assert resp.status_code == 200
    assert resp.json() == []

    # 2. Add sales category to Company Alpha
    resp = client.post(
        "/api/v1/categories",
        json={"company_name": "Company Alpha", "category_type": "sales", "name": "Catering Sales"},
    )
    assert resp.status_code in [200, 201]
    cat_alpha_sales = resp.json()
    assert cat_alpha_sales["name"] == "Catering Sales"
    assert cat_alpha_sales["company_name"] == "Company Alpha"
    assert cat_alpha_sales["category_type"] == "sales"
    alpha_sales_id = cat_alpha_sales["category_id"]

    # 3. Add expense category to Company Alpha
    resp = client.post(
        "/api/v1/categories",
        json={"company_name": "Company Alpha", "category_type": "expense", "name": "Kitchen Supplies"},
    )
    assert resp.status_code in [200, 201]
    cat_alpha_exp = resp.json()
    alpha_exp_id = cat_alpha_exp["category_id"]

    # 4. Verify Company Alpha categories are separated by type
    resp = client.get("/api/v1/categories?company_name=Company Alpha&category_type=sales")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Catering Sales"

    resp = client.get("/api/v1/categories?company_name=Company Alpha&category_type=expense")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Kitchen Supplies"

    # 5. Duplicate category in same company and type returns 409 Conflict
    resp = client.post(
        "/api/v1/categories",
        json={"company_name": "Company Alpha", "category_type": "sales", "name": "Catering Sales"},
    )
    assert resp.status_code == 409

    # 6. Edit / Rename category
    resp = client.put(
        f"/api/v1/categories/{alpha_sales_id}",
        json={"name": "Special Catering Sales"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Special Catering Sales"

    # 7. Duplicate on rename returns 409 Conflict
    # Add a second category
    resp_second = client.post(
        "/api/v1/categories",
        json={"company_name": "Company Alpha", "category_type": "sales", "name": "Direct Sales"},
    )
    assert resp_second.status_code in [200, 201]
    second_id = resp_second.json()["category_id"]

    # Attempt to rename second to the first category's name
    resp_dup = client.put(
        f"/api/v1/categories/{second_id}",
        json={"name": "Special Catering Sales"},
    )
    assert resp_dup.status_code == 409

    # 8. Delete category
    resp = client.delete(f"/api/v1/categories/{alpha_sales_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"

    # Verify deleted
    resp = client.get("/api/v1/categories?company_name=Company Alpha&category_type=sales")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Direct Sales"

def test_cross_company_authorization(client_and_db, monkeypatch):
    client, _ = client_and_db

    # A supervisor user assigned ONLY to Company Alpha (ID 1)
    supervisor_user = {
        "auth_user_id": "sup_1",
        "user_id": 20,
        "email": "supervisor@mct.com",
        "full_name": "Supervisor User",
        "company_id": 1,
        "company_ids": [1],
        "is_admin": False,
        "role": "supervisor",
    }

    from app.core import dependencies
    # Override current_user for this test to the supervisor
    app = client.app
    app.dependency_overrides[dependencies.get_current_user] = lambda: supervisor_user

    try:
        # Accessing assigned company (Alpha) succeeds
        resp = client.get("/api/v1/categories?company_name=Company Alpha&category_type=sales")
        assert resp.status_code == 200

        # Attempting to read Company Beta (ID 2) categories returns 403 Forbidden
        resp = client.get("/api/v1/categories?company_name=Company Beta&category_type=sales")
        assert resp.status_code == 403

        # Attempting to create category for Company Beta returns 403 Forbidden
        resp = client.post(
            "/api/v1/categories",
            json={"company_name": "Company Beta", "category_type": "sales", "name": "Beta Sales"},
        )
        assert resp.status_code == 403
    finally:
        app.dependency_overrides[dependencies.get_current_user] = lambda: FINANCE_USER

def test_legacy_global_category_fallback(client_and_db):
    client, SessionLocal = client_and_db

    # Sending a legacy category without company info or type creates a global Category
    resp = client.post(
        "/api/v1/categories",
        json={"name": "Global Utilities", "description": "Global office utilities"},
    )
    assert resp.status_code in [200, 201]
    created = resp.json()
    assert created["name"] == "Global Utilities"

    db = SessionLocal()
    glob_cat = db.query(Category).filter(Category.name == "Global Utilities").first()
    assert glob_cat is not None
    # Ensure it did NOT get inserted into CompanyCategory
    comp_cat = db.query(CompanyCategory).filter(CompanyCategory.name == "Global Utilities").first()
    assert comp_cat is None
    db.close()

def test_sales_and_expenses_bank_resolution(client_and_db):
    client, SessionLocal = client_and_db

    # 1. Record sale with bank_account_id OMITTED -> auto-assigns sole-owned bank
    resp = client.post(
        "/api/v1/sales/",
        json={
            "company": "Company Alpha",
            "transaction_date": "2026-11-14",
            "particulars": "Lunch Buffet Auto Bank",
            "amount": 2500.0,
            "category": "Food Sales",
            "payment_method": "Cash",
            "payment_status": "Paid",
        },
    )
    assert resp.status_code in [200, 201]

    # Verify database record has sole-owned bank_account_id automatically assigned
    db = SessionLocal()
    sale = db.query(Sale).filter(Sale.particulars == "Lunch Buffet Auto Bank").first()
    assert sale is not None
    assert sale.bank_account_id == "bank-alpha-1"

    # 2. Record expense with bank_account_id OMITTED -> auto-assigns sole-owned bank
    resp = client.post(
        "/api/v1/expenses/",
        json={
            "company": "Company Alpha",
            "expense_date": "2026-11-14",
            "particulars": "Raw Ingredients Auto Bank",
            "amount": 1200.0,
            "category": "Kitchen Supplies",
            "payment_method": "Cash",
        },
    )
    assert resp.status_code in [200, 201]

    expense = db.query(Expense).filter(Expense.particulars == "Raw Ingredients Auto Bank").first()
    assert expense is not None
    assert expense.bank_account_id == "bank-alpha-1"

    # 3. Record expense with Petty Cash -> bank_account_id MUST be None
    resp = client.post(
        "/api/v1/expenses/",
        json={
            "company": "Company Alpha",
            "expense_date": "2026-11-14",
            "particulars": "Petty Office Coffee",
            "amount": 150.0,
            "category": "Office",
            "payment_method": "Petty Cash",
        },
    )
    assert resp.status_code in [200, 201]

    petty_exp = db.query(Expense).filter(Expense.particulars == "Petty Office Coffee").first()
    assert petty_exp is not None
    assert petty_exp.bank_account_id is None
    db.close()
