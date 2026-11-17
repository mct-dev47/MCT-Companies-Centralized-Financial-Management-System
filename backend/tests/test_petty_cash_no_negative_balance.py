"""Petty cash MAY go below zero: a supervisor sometimes pays an expense from her own pocket.

The expense is saved and the wallet simply shows a negative balance (the form warns first).
"""
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.session import Base
from app.models.company import Company
from app.models.finance import Expense
from app.models.petty_cash import PettyCashTopUp
from app.services.petty_cash_service import PettyCashService


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add(Company(company_id=1, company_name="Company One"))
    session.add(PettyCashTopUp(company_id=1, amount=Decimal("500.00"), topup_date=date(2026, 1, 1), status="Approved"))
    session.commit()
    yield session
    session.close()


def _petty_expense(db, amount: str) -> None:
    db.add(Expense(company_id=1, amount=Decimal(amount), amount_paid=Decimal(amount), payment_method="Petty Cash",
                   expense_date=date(2026, 1, 5), description="Supplies [Paid]"))
    db.commit()


def test_expense_over_balance_takes_wallet_negative(db):
    _petty_expense(db, "800.00")
    assert PettyCashService(db).get_balance(1) == Decimal("-300.00")


def test_negative_balance_shows_in_summary(db):
    _petty_expense(db, "650.00")
    summary = PettyCashService(db).get_summary(db.get(Company, 1))
    assert summary.balance == Decimal("-150.00")
    assert summary.is_low is True


def test_service_no_longer_has_a_blocking_check():
    assert not hasattr(PettyCashService, "ensure_sufficient_balance")
