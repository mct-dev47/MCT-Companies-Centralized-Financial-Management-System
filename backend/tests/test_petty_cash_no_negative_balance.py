"""Petty cash can never go below zero: expenses that exceed the wallet are rejected."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.session import Base
from app.models.company import Company
from app.models.petty_cash import PettyCashTopUp
from app.services.petty_cash_service import PettyCashService


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add(Company(company_id=1, company_name="Company One", starting_balance=0))
    session.add(PettyCashTopUp(company_id=1, amount=Decimal("500.00"), topup_date=date(2026, 1, 1), status="Approved"))
    session.commit()
    yield session
    session.close()


def test_expense_within_balance_is_allowed(db):
    PettyCashService(db).ensure_sufficient_balance(1, "Petty Cash", Decimal("200.00"))


def test_expense_equal_to_balance_is_allowed(db):
    # Brings the wallet to exactly zero, which is fine
    PettyCashService(db).ensure_sufficient_balance(1, "Petty Cash", Decimal("500.00"))


def test_expense_over_balance_is_rejected(db):
    with pytest.raises(HTTPException) as exc:
        PettyCashService(db).ensure_sufficient_balance(1, "petty cash", Decimal("500.01"))
    assert exc.value.status_code == 400
    assert "Insufficient petty cash balance" in exc.value.detail
    assert "cannot go below" in exc.value.detail


def test_non_petty_cash_payment_is_not_checked(db):
    PettyCashService(db).ensure_sufficient_balance(1, "Cash", Decimal("99999.00"))


def test_pending_topup_does_not_count(db):
    db.add(PettyCashTopUp(company_id=1, amount=Decimal("1000.00"), topup_date=date(2026, 1, 2), status="Pending Finance Endorsement"))
    db.commit()
    with pytest.raises(HTTPException):
        PettyCashService(db).ensure_sufficient_balance(1, "Petty Cash", Decimal("600.00"))
