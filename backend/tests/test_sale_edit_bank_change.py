"""Editing a sale keeps the bank the user picked, and its money moves to that bank.

Before: SaleUpdate had no bank_account_id (and the frontend never sent it), so an edit silently kept
the old bank and the edit form fell back to the company's default bank.
"""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import sales as sales_endpoints
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.bank import BankAccount, BankTransaction
from app.models.company import Company
from app.models.finance import Sale

FINANCE_USER = {"user_id": 10, "email": "finance@mct.test", "role": "finance", "is_admin": False,
                "company_id": 1, "company_ids": [1]}


def _bank(id_, company="Company Alpha", company_id=1):
    return BankAccount(id=id_, bank_name="CHINABANK", account_name=id_, account_number="0000" + id_[-1],
                       company_name=company, company_id=company_id,
                       starting_balance=Decimal("0"), current_balance=Decimal("0"))


@pytest.fixture()
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = SessionLocal()
    db.add_all([
        Company(company_id=1, company_name="Company Alpha", starting_balance=Decimal("0")),
        Company(company_id=2, company_name="Company Beta", starting_balance=Decimal("0")),
        _bank("bank-a"), _bank("bank-b"), _bank("bank-beta", "Company Beta", 2),
        Sale(sales_id=1, company_id=1, transaction_date=date(2026, 11, 10), deposit_date=date(2026, 11, 10),
             amount=Decimal("500.00"), particulars="Room [Paid]", payment_method="Cash",
             payment_status="Paid", deposit_status="Deposited", bank_account_id="bank-a"),
    ])
    db.commit()
    # Money for the sale is in bank A to start with
    sales_endpoints.reconcile_sale_bank(db, sale_id=1, bank_account_id="bank-a")

    app = FastAPI()
    app.include_router(sales_endpoints.router, prefix="/api/v1/sales")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: FINANCE_USER
    yield TestClient(app), db
    db.close()


def _net(db, bank_id):
    return db.query(func.coalesce(func.sum(BankTransaction.deposit - BankTransaction.withdrawal), 0)).filter(
        BankTransaction.bank_account_id == bank_id).scalar()


def test_edit_saves_the_chosen_bank_and_moves_the_money(env):
    client, db = env
    assert Decimal(str(_net(db, "bank-a"))) == Decimal("500.00")

    res = client.put("/api/v1/sales/1", json={"bank_account_id": "bank-b"})
    assert res.status_code == 200, res.text

    db.expire_all()
    assert db.get(Sale, 1).bank_account_id == "bank-b"
    assert Decimal(str(_net(db, "bank-a"))) == Decimal("0.00")
    assert Decimal(str(_net(db, "bank-b"))) == Decimal("500.00")


def test_edit_without_a_bank_keeps_the_current_bank(env):
    client, db = env
    res = client.put("/api/v1/sales/1", json={"remarks": "checked"})
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Sale, 1).bank_account_id == "bank-a"
    assert Decimal(str(_net(db, "bank-a"))) == Decimal("500.00")


def test_bank_of_another_company_is_rejected(env):
    client, db = env
    res = client.put("/api/v1/sales/1", json={"bank_account_id": "bank-beta"})
    assert res.status_code == 400
    db.expire_all()
    assert db.get(Sale, 1).bank_account_id == "bank-a"
