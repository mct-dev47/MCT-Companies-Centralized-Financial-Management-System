"""Regression tests for GET /loans and GET /loans/export with repayments attached."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import loans as loans_endpoints
from app.core.dependencies import require_business_reader
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.loan import Loan, LoanRepayment

ADMIN = {
    "auth_user_id": "a",
    "user_id": 1,
    "email": "admin@mct.com",
    "company_id": None,
    "company_ids": [1, 2],
    "is_admin": True,
    "role": "admin",
}


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as seed:
        seed.add_all([
            Company(company_id=1, company_name="Lender Co"),
            Company(company_id=2, company_name="Borrower Co"),
            Loan(
                loan_id=1,
                borrower=2,
                lender=1,
                loan_ref_no="LN-1",
                principal_amount=Decimal("3000.00"),
                interest_rate=Decimal("10.00"),
                loan_date=date.today(),
                description="Loan: Inventory",
                status="Disbursed",
            ),
            LoanRepayment(
                loan_repayment_id=1,
                loan_id=1,
                payment_date=date.today(),
                remaining_balance=Decimal("2300.00"),
                amount=Decimal("1000.00"),
                status="completed",
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
    app.include_router(loans_endpoints.router, prefix="/loans")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[require_business_reader] = lambda: ADMIN
    return TestClient(app)


def test_list_and_export_loans_return_borrower_and_lender_records(client):
    borrower_res = client.get("/loans/export", params={"company_name": "Borrower Co", "scope": "borrower"})
    assert borrower_res.status_code == 200
    borrower_items = borrower_res.json()
    assert len(borrower_items) == 1
    assert borrower_items[0]["borrower_name"] == "Borrower Co"
    assert borrower_items[0]["lender_name"] == "Lender Co"
    assert borrower_items[0]["total_paid"] == "1000.00"
    assert borrower_items[0]["outstanding_balance"] == "2300.00"

    lender_res = client.get("/loans/export", params={"company_name": "Lender Co", "scope": "lender"})
    assert lender_res.status_code == 200
    assert len(lender_res.json()) == 1

    paginated_res = client.get("/loans")
    assert paginated_res.status_code == 200
    assert len(paginated_res.json()) == 1
