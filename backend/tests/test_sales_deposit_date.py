"""Spec 0043: a sale keeps its sale date and gets a separate bank deposit date."""
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.sales import update_sale_deposit_status
from app.models.finance import Base, Sale
from app.schemas.sale import DepositStatusUpdate, SaleCreate, SaleUpdate


def _create(**kw):
    base = dict(
        company_id=1,
        category="Food",
        transaction_date=date.today() - timedelta(days=3),
        amount=Decimal("1000"),
        particulars="GCash order",
        payment_status="Paid",
    )
    base.update(kw)
    return SaleCreate(**base)


def test_deposited_sale_defaults_deposit_date_to_sale_date():
    sale = _create()
    assert sale.deposit_status == "Deposited"
    assert sale.deposit_date == sale.transaction_date


def test_explicit_deposit_date_is_kept():
    later = date.today() - timedelta(days=2)
    sale = _create(deposit_date=later)
    assert sale.deposit_date == later


def test_deposit_date_cannot_precede_sale_date():
    with pytest.raises(ValidationError):
        _create(deposit_date=date.today() - timedelta(days=10))


def test_not_deposited_clears_deposit_date():
    sale = _create(deposit_status="Not Deposited", deposit_date=date.today())
    assert sale.deposit_date is None
    upd = SaleUpdate(deposit_status="Not Deposited", deposit_date=date.today())
    assert upd.deposit_date is None


def _session_with_sale(**kw):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    sale = Sale(
        company_id=1,
        transaction_date=date.today() - timedelta(days=3),
        amount=Decimal("1000.00"),
        payment_status="Paid",
        deposit_status="Not Deposited",
        particulars="GCash order",
        **kw,
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)
    return session, sale


def _patch_deposit(session, sale, body):
    user = {"user_id": 1, "role": "admin", "company_ids": [1]}
    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync, \
         patch("app.api.v1.endpoints.sales.log_transaction"), \
         patch("app.api.v1.endpoints.sales.ws_manager"), \
         patch("app.api.v1.endpoints.sales.reconcile_sale_bank"):
        mock_sync.return_value._use_supabase.return_value = False
        return update_sale_deposit_status(
            sales_id=sale.sales_id, deposit_in=body, request=MagicMock(), current_user=user, db=session
        )


def test_patch_deposit_status_stores_chosen_deposit_date():
    session, sale = _session_with_sale()
    chosen = date.today() - timedelta(days=1)
    res = _patch_deposit(session, sale, DepositStatusUpdate(deposit_status="Deposited", deposit_date=chosen, bank_account_id="bnk-001"))
    session.refresh(sale)
    assert res.deposit_date == chosen
    assert sale.deposit_date == chosen
    assert sale.bank_account_id == "bnk-001"
    # the sale date is untouched
    assert sale.transaction_date == date.today() - timedelta(days=3)


def test_patch_deposit_status_defaults_to_sale_date_and_reverts_to_none():
    session, sale = _session_with_sale()
    _patch_deposit(session, sale, DepositStatusUpdate(deposit_status="Deposited"))
    session.refresh(sale)
    assert sale.deposit_date == sale.transaction_date

    _patch_deposit(session, sale, DepositStatusUpdate(deposit_status="Not Deposited"))
    session.refresh(sale)
    assert sale.deposit_date is None


def test_patch_deposit_date_before_sale_date_is_rejected():
    from fastapi import HTTPException

    session, sale = _session_with_sale()
    with pytest.raises(HTTPException) as exc:
        _patch_deposit(
            session, sale,
            DepositStatusUpdate(deposit_status="Deposited", deposit_date=date.today() - timedelta(days=9)),
        )
    assert exc.value.status_code == 422
