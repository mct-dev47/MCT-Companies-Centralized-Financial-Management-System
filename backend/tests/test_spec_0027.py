from datetime import date
from decimal import Decimal
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import receivables as receivables_endpoints
from app.core.dependencies import get_current_user, get_db
from app.db.session import Base
from app.models.company import Company
from app.models.finance import Sale, Expense
from app.models.receivable import Receivable, ReceivablePayment
from app.services.receivables_service import ReceivablesService


FINANCE_USER = {
    "auth_user_id": "finance_u",
    "user_id": 2,
    "email": "finance@mct.com",
    "company_id": None,
    "company_ids": [1],
    "is_admin": False,
    "role": "finance",
}

SUPERVISOR_USER = {
    "auth_user_id": "sup_u",
    "user_id": 3,
    "email": "cashier@mct.com",
    "company_id": 1,
    "company_ids": [1],
    "is_admin": False,
    "role": "supervisor",
}

AUDITOR_USER = {
    "auth_user_id": "aud_u",
    "user_id": 4,
    "email": "auditor@mct.com",
    "company_id": None,
    "company_ids": [1],
    "is_admin": False,
    "role": "audit",
}


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with Session() as seed:
        seed.add(
            Company(
                company_id=1,
                company_name="MyCity.Kitchen Corporation",
                location="Manila",
                starting_balance=10000,
            )
        )
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(receivables_endpoints.router, prefix="/api/v1/receivables")
    app.dependency_overrides[get_db] = override_db

    return {"app": app, "Session": Session}


def test_create_receivable_and_balance_logic(env):
    """AC-4, AC-5: Create receivable and verify balance calculations."""
    app = env["app"]
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_USER
    client = TestClient(app)

    payload = {
        "customer_name": "Test Diner",
        "customer_type": "External",
        "company_id": 1,
        "items_summary": "Chicken Inasal (x2), Iced Tea",
        "total_amount": 450.00,
        "payment_option": "Partial",
        "amount_paid": 150.00,
        "payment_method": "Cash",
        "date": "2026-11-03",
    }
    res = client.post("/api/v1/receivables", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["customer_name"] == "Test Diner"
    assert float(data["total_amount"]) == 450.00
    assert float(data["amount_paid"]) == 150.00
    assert float(data["balance"]) == 300.00
    assert data["payment_status"] == "Partial"


def test_payment_remittance_validation_rejects_overpayment(env):
    """AC-9: Payment exceeding balance is rejected with HTTP 400."""
    app = env["app"]
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_USER
    client = TestClient(app)

    # Create unpaid receivable of 500
    create_res = client.post(
        "/api/v1/receivables",
        json={
            "customer_name": "Juan Dela Cruz",
            "customer_type": "Internal",
            "company_id": 1,
            "items_summary": "Staff meal",
            "total_amount": 500.00,
            "payment_option": "Pay Later",
        },
    )
    rec_id = create_res.json()["receivable_id"]

    # Attempt to remit 600 against 500 balance
    pay_res = client.post(
        f"/api/v1/receivables/{rec_id}/payments",
        json={"amount": 600.00, "payment_method": "Cash"},
    )
    assert pay_res.status_code == 400
    assert "cannot exceed outstanding debt" in pay_res.json()["detail"].lower()

    # Remit valid payment of 500 -> transitions to Paid
    valid_pay = client.post(
        f"/api/v1/receivables/{rec_id}/payments",
        json={"amount": 500.00, "payment_method": "Cash"},
    )
    assert valid_pay.status_code == 201

    get_res = client.get(f"/api/v1/receivables/{rec_id}")
    assert get_res.json()["payment_status"] == "Paid"
    assert float(get_res.json()["balance"]) == 0.00


def test_finance_only_role_enforcement(env):
    """AC-8: Editing and deleting receivables is restricted strictly to Finance role."""
    app = env["app"]
    Session = env["Session"]

    with Session() as db:
        rec = Receivable(
            company_id=1,
            company_name="MyCity.Kitchen Corporation",
            customer_name="Secret Customer",
            customer_type="External",
            transaction_date=date.today(),
            items_summary="Special Order",
            total_amount=Decimal("1000.00"),
            amount_paid=Decimal("0.00"),
            balance=Decimal("1000.00"),
            payment_status="Unpaid",
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        rec_id = rec.receivable_id

    # 1. Auditor attempts to edit -> 403 Forbidden
    app.dependency_overrides[get_current_user] = lambda: AUDITOR_USER
    client = TestClient(app)
    edit_res = client.put(
        f"/api/v1/receivables/{rec_id}",
        json={"total_amount": 1200.00},
    )
    assert edit_res.status_code == 403

    # 2. Unassigned Supervisor attempts to delete -> 403 Forbidden (Spec 0028 AC-3)
    unassigned_supervisor = {**SUPERVISOR_USER, "company_id": 99, "company_ids": [99]}
    app.dependency_overrides[get_current_user] = lambda: unassigned_supervisor
    client = TestClient(app)
    del_res = client.delete(f"/api/v1/receivables/{rec_id}")
    assert del_res.status_code == 403

    # 3. Assigned Supervisor can edit within company scope -> 200 Success (Spec 0028 AC-3)
    app.dependency_overrides[get_current_user] = lambda: SUPERVISOR_USER
    client = TestClient(app)
    sup_edit = client.put(
        f"/api/v1/receivables/{rec_id}",
        json={"notes": "Updated by Assigned Supervisor"},
    )
    assert sup_edit.status_code == 200

    # 4. Finance user attempts to edit and delete -> 200 Success
    app.dependency_overrides[get_current_user] = lambda: FINANCE_USER
    client = TestClient(app)
    edit_ok = client.put(
        f"/api/v1/receivables/{rec_id}",
        json={"notes": "Approved by Finance"},
    )
    assert edit_ok.status_code == 200
    assert edit_ok.json()["notes"] == "Approved by Finance"

    del_ok = client.delete(f"/api/v1/receivables/{rec_id}")
    assert del_ok.status_code == 200


def test_bidirectional_source_sync(env):
    """AC-7: Updating or deleting a receivable updates linked source sale."""
    Session = env["Session"]
    with Session() as db:
        # Create a source sale
        sale = Sale(
            company_id=1,
            particulars="Customer order",
            amount=Decimal("800.00"),
            transaction_date=date.today(),
        )
        db.add(sale)
        db.commit()
        db.refresh(sale)

        # Create linked receivable
        svc = ReceivablesService(db)
        from app.schemas.receivable import ReceivableCreate, ReceivableUpdate

        rec = svc.create_receivable(
            ReceivableCreate(
                customer_name="Linked Client",
                customer_type="External",
                company_id=1,
                items_summary="Customer order",
                total_amount=Decimal("800.00"),
                sale_id=sale.sales_id,
            )
        )

        # Update total from 800 to 1000
        svc.update_receivable(rec.receivable_id, ReceivableUpdate(total_amount=Decimal("1000.00")))
        db.refresh(sale)
        assert sale.amount == Decimal("1000.00")

        # Delete receivable -> removes or reduces linked sale
        svc.delete_receivable(rec.receivable_id)
        deleted_sale = db.query(Sale).filter(Sale.sales_id == sale.sales_id).first()
        assert deleted_sale is None

