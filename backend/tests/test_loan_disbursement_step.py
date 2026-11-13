"""Spec 0046: Supervisor -> Finance endorse -> Audit approve -> Finance disburse.
Audit approval no longer moves money; Finance's Disburse step does, and sets the loan to Disbursed."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import loans as loans_endpoints
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.loan import Loan

FINANCE = {"auth_user_id": "f", "user_id": 2, "email": "finance@mct.com", "company_id": None,
           "company_ids": [1, 2], "is_admin": False, "role": "finance"}
AUDIT = {"auth_user_id": "u", "user_id": 3, "email": "audit@mct.com", "company_id": None,
         "company_ids": [1, 2], "is_admin": False, "role": "audit"}
SUPERVISOR = {"auth_user_id": "s", "user_id": 4, "email": "sup@mct.com", "company_id": 2,
              "company_ids": [2], "is_admin": False, "role": "supervisor"}


@pytest.fixture()
def env(monkeypatch):
    def no_supabase():
        raise RuntimeError("supabase disabled in tests")

    monkeypatch.setattr(loans_endpoints, "get_supabase_admin_client", no_supabase)
    monkeypatch.setattr(loans_endpoints, "log_transaction", lambda *a, **k: None)

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as seed:
        seed.add_all([
            Company(company_id=1, company_name="Lender Co", starting_balance=0),
            Company(company_id=2, company_name="Borrower Co", starting_balance=0),
            BankAccount(id="bnk-lender", bank_name="BDO", account_name="Lender", account_number="1",
                        company_name="Lender Co", company_id=1,
                        starting_balance=Decimal("10000"), current_balance=Decimal("10000")),
            BankAccount(id="bnk-borrower", bank_name="BPI", account_name="Borrower", account_number="2",
                        company_name="Borrower Co", company_id=2,
                        starting_balance=Decimal("0"), current_balance=Decimal("0")),
            Loan(loan_id=1, borrower=2, lender=1, loan_ref_no="LN-1", bank_account_id="bnk-lender",
                 principal_amount=Decimal("3000"), loan_date=date.today(), description="Loan: Inventory",
                 status="Pending Audit Approval"),
        ])
        seed.commit()

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    holder = {"user": AUDIT}
    app = FastAPI()
    app.include_router(loans_endpoints.router, prefix="/loans")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    return TestClient(app), holder, Session


def _balances(Session):
    with Session() as db:
        return (Decimal(str(db.get(BankAccount, "bnk-lender").current_balance)),
                Decimal(str(db.get(BankAccount, "bnk-borrower").current_balance)))


def _status(Session):
    with Session() as db:
        return db.get(Loan, 1).status


def _approve(client):
    return client.post("/loans/1/audit-review", json={"action": "approve", "remark": "ok"})


def test_audit_approval_does_not_move_money(env):
    client, holder, Session = env
    res = _approve(client)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "Approved"
    assert _status(Session) == "Approved"
    assert _balances(Session) == (Decimal("10000.00"), Decimal("0.00"))


def test_finance_disburse_moves_money_and_marks_disbursed(env):
    client, holder, Session = env
    _approve(client)
    holder["user"] = FINANCE
    res = client.post("/loans/1/disburse")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "Disbursed"
    assert body["disbursed_by"]
    assert _status(Session) == "Disbursed"
    assert _balances(Session) == (Decimal("7000.00"), Decimal("3000.00"))


def test_cannot_disburse_twice(env):
    client, holder, Session = env
    _approve(client)
    holder["user"] = FINANCE
    assert client.post("/loans/1/disburse").status_code == 200
    res = client.post("/loans/1/disburse")
    assert res.status_code == 409
    assert _balances(Session) == (Decimal("7000.00"), Decimal("3000.00"))


def test_cannot_disburse_before_audit_approval(env):
    client, holder, Session = env
    holder["user"] = FINANCE
    res = client.post("/loans/1/disburse")
    assert res.status_code == 409
    assert _status(Session) == "Pending Audit Approval"


def test_only_finance_can_disburse(env):
    client, holder, Session = env
    _approve(client)
    for user in (AUDIT, SUPERVISOR):
        holder["user"] = user
        assert client.post("/loans/1/disburse").status_code == 403
    assert _status(Session) == "Approved"


def test_disburse_blocked_when_bank_balance_is_too_low(env):
    client, holder, Session = env
    with Session() as db:
        db.get(BankAccount, "bnk-lender").current_balance = Decimal("1000")
        db.commit()
    _approve(client)
    holder["user"] = FINANCE
    res = client.post("/loans/1/disburse")
    assert res.status_code == 400
    assert _status(Session) == "Approved"


def test_repayment_blocked_until_disbursed(env):
    client, holder, Session = env
    _approve(client)
    holder["user"] = FINANCE
    res = client.post("/loans/1/repayments", json={"loan_id": 1, "payment_date": str(date.today()), "amount": 100})
    assert res.status_code == 409
