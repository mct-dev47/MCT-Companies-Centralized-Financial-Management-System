"""Petty Cash is expense-only: sales must never carry it as category or payment method."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.sales import _reject_petty_cash_category_id
from app.models.finance import Base, Category
from app.schemas.sale import PETTY_CASH_NOT_ALLOWED_IN_SALES, SaleCreate, SaleUpdate


def _create_kwargs(**overrides):
    kwargs = dict(
        company_id=1,
        category="Rendered Fee",
        transaction_date=date.today(),
        amount=Decimal("100.00"),
        payment_method="Cash",
        particulars="Consulting",
    )
    kwargs.update(overrides)
    return kwargs


@pytest.mark.parametrize("value", ["Petty Cash", "petty cash", "  PETTY CASH  "])
def test_create_rejects_petty_cash_category(value):
    with pytest.raises(ValidationError, match=PETTY_CASH_NOT_ALLOWED_IN_SALES):
        SaleCreate(**_create_kwargs(category=value))


@pytest.mark.parametrize("value", ["Petty Cash", "petty cash"])
def test_create_rejects_petty_cash_payment_method(value):
    with pytest.raises(ValidationError, match=PETTY_CASH_NOT_ALLOWED_IN_SALES):
        SaleCreate(**_create_kwargs(payment_method=value))


def test_create_allows_normal_sale():
    sale = SaleCreate(**_create_kwargs())
    assert sale.category == "Rendered Fee"


def test_update_rejects_petty_cash_category_and_payment_method():
    with pytest.raises(ValidationError, match=PETTY_CASH_NOT_ALLOWED_IN_SALES):
        SaleUpdate(category="Petty Cash")
    with pytest.raises(ValidationError, match=PETTY_CASH_NOT_ALLOWED_IN_SALES):
        SaleUpdate(payment_method="Petty Cash")


def test_update_allows_other_fields():
    assert SaleUpdate(payment_method="GCash").payment_method == "GCash"


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add_all([
        Category(category_id=1, name="Petty Cash"),
        Category(category_id=2, name="Rendered Fee"),
    ])
    session.commit()
    yield session
    session.close()


def test_category_id_pointing_at_petty_cash_is_rejected(db):
    with pytest.raises(HTTPException) as exc:
        _reject_petty_cash_category_id(db, 1, use_supabase=False)
    assert exc.value.status_code == 422
    assert exc.value.detail == PETTY_CASH_NOT_ALLOWED_IN_SALES


@pytest.mark.parametrize("category_id", [2, None, 999])
def test_other_category_ids_are_allowed(db, category_id):
    _reject_petty_cash_category_id(db, category_id, use_supabase=False)
