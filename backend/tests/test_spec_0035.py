import pytest
from decimal import Decimal
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app
from app.models.payment_method import CompanyPaymentMethod
from app.models.company import Company
from app.schemas.sale import SaleCreate
from app.schemas.expense import ExpenseCreate
from app.core.dependencies import require_business_reader, require_business_writer, AuthenticatedUser

# In-memory SQLite engine for tests with StaticPool so all connections share the memory db
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


mock_user = AuthenticatedUser(
    user_id=1,
    email="admin@test.com",
    role="admin",
    company_id=None,
    assigned_company=None,
)

app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[require_business_reader] = lambda: mock_user
app.dependency_overrides[require_business_writer] = lambda: mock_user

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    comp_a = Company(company_id=1, company_name="Company Alpha", starting_balance=1000.0)
    comp_b = Company(company_id=2, company_name="Company Beta", starting_balance=1000.0)
    db.merge(comp_a)
    db.merge(comp_b)
    db.commit()
    db.close()
    yield
    # cleanup
    db = TestingSessionLocal()
    db.query(CompanyPaymentMethod).delete()
    db.commit()
    db.close()


def test_custom_payment_methods_company_isolation():
    # 1. Add Maya for Company Alpha
    res1 = client.post(
        "/api/v1/payment-methods",
        json={"name": "Maya", "company_name": "Company Alpha", "company_id": 1},
    )
    assert res1.status_code == 201, res1.text
    method_data = res1.json()
    assert method_data["name"] == "Maya"
    assert method_data["company_name"] == "Company Alpha"
    method_id = method_data["id"]

    # 2. Add Panda for Company Beta
    res2 = client.post(
        "/api/v1/payment-methods",
        json={"name": "Panda", "company_name": "Company Beta", "company_id": 2},
    )
    assert res2.status_code == 201
    assert res2.json()["name"] == "Panda"

    # 3. Retrieve payment methods for Company Alpha -> only Maya
    get_alpha = client.get("/api/v1/payment-methods?company_name=Company Alpha")
    assert get_alpha.status_code == 200
    alpha_methods = [m["name"] for m in get_alpha.json()]
    assert "Maya" in alpha_methods
    assert "Panda" not in alpha_methods

    # 4. Retrieve payment methods for Company Beta -> only Panda
    get_beta = client.get("/api/v1/payment-methods?company_name=Company Beta")
    assert get_beta.status_code == 200
    beta_methods = [m["name"] for m in get_beta.json()]
    assert "Panda" in beta_methods
    assert "Maya" not in beta_methods

    # 5. Delete method for Company Alpha
    del_res = client.delete(f"/api/v1/payment-methods/{method_id}")
    assert del_res.status_code == 200

    # 6. Verify deleted
    get_alpha_after = client.get("/api/v1/payment-methods?company_name=Company Alpha")
    assert "Maya" not in [m["name"] for m in get_alpha_after.json()]


def test_payment_method_empty_name_validation():
    res = client.post(
        "/api/v1/payment-methods",
        json={"name": "   ", "company_name": "Company Alpha"},
    )
    assert res.status_code == 422 or res.status_code == 400


def test_sale_validation_amount_particulars_category():
    # Valid sale
    valid_sale = SaleCreate(
        company_id=1,
        company="Company Alpha",
        category="Food Sales",
        particulars="Burger Combo",
        amount=Decimal("150.00"),
        transaction_date=date.today(),
    )
    assert valid_sale.particulars == "Burger Combo"

    # Amount < 1.00 should fail
    with pytest.raises(ValueError):
        SaleCreate(
            company_id=1,
            company="Company Alpha",
            category="Food Sales",
            particulars="Burger Combo",
            amount=Decimal("0.50"),
            transaction_date=date.today(),
        )

    # Empty particulars should fail
    with pytest.raises(ValueError):
        SaleCreate(
            company_id=1,
            company="Company Alpha",
            category="Food Sales",
            particulars="   ",
            amount=Decimal("100.00"),
            transaction_date=date.today(),
        )

    # Empty category should fail
    with pytest.raises(ValueError):
        SaleCreate(
            company_id=1,
            company="Company Alpha",
            category="   ",
            particulars="Burger Combo",
            amount=Decimal("100.00"),
            transaction_date=date.today(),
        )


def test_expense_validation_amount_particulars_category():
    # Valid expense
    valid_exp = ExpenseCreate(
        company_id=1,
        company="Company Alpha",
        category="Office Supplies",
        particulars="Paper Clips",
        amount=Decimal("50.00"),
        expense_date=date.today(),
    )
    assert valid_exp.particulars == "Paper Clips"

    # Amount < 1.00 should fail
    with pytest.raises(ValueError):
        ExpenseCreate(
            company_id=1,
            company="Company Alpha",
            category="Office Supplies",
            particulars="Paper Clips",
            amount=Decimal("0.00"),
            expense_date=date.today(),
        )

    # Empty particulars should fail
    with pytest.raises(ValueError):
        ExpenseCreate(
            company_id=1,
            company="Company Alpha",
            category="Office Supplies",
            particulars="   ",
            amount=Decimal("50.00"),
            expense_date=date.today(),
        )

    # Empty category should fail
    with pytest.raises(ValueError):
        ExpenseCreate(
            company_id=1,
            company="Company Alpha",
            category="   ",
            particulars="Paper Clips",
            amount=Decimal("50.00"),
            expense_date=date.today(),
        )


def test_payment_method_cross_company_access_forbidden():
    # User assigned only to Company 1 (Company Alpha)
    scoped_user = AuthenticatedUser(
        user_id=99,
        email="supervisor@alpha.com",
        role="supervisor",
        company_id=1,
        company_ids=[1],
        is_admin=False,
    )
    app.dependency_overrides[require_business_reader] = lambda: scoped_user
    app.dependency_overrides[require_business_writer] = lambda: scoped_user

    try:
        # Accessing Company 2 (Company Beta) should yield 403 Forbidden
        res_get = client.get("/api/v1/payment-methods?company_id=2")
        assert res_get.status_code == 403

        # Creating for Company 2 should yield 403 Forbidden
        res_post = client.post(
            "/api/v1/payment-methods",
            json={"name": "UnauthorizedMethod", "company_id": 2, "company_name": "Company Beta"},
        )
        assert res_post.status_code == 403
    finally:
        # Restore mock_user
        app.dependency_overrides[require_business_reader] = lambda: mock_user
        app.dependency_overrides[require_business_writer] = lambda: mock_user
