"""Partial receivable payments reach the sale and the bank; the deposit bank is fixed; day remarks cascade."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.daily_remark import DailyRemark
from app.models.finance import Sale
from app.models.receivable import Receivable
from app.schemas.receivable import ReceivablePaymentCreate, ReceivableUpdate
from app.services.daily_remark_cascade import purge_orphan_daily_remark
from app.services.receivables_service import ReceivablesService
from app.services.sales_receivables_sync import SalesReceivablesSyncService


def _setup(sale_day=None):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    day = sale_day or date.today()
    db.add(Company(company_id=1, company_name="MCT Kitchen", location="Manila", starting_balance=Decimal("0.00")))
    for bid, name in (("bnk-001", "BDO"), ("bnk-002", "BPI")):
        db.add(BankAccount(
            id=bid, bank_name=name, account_name="Main", account_number="0000-" + bid,
            company_name="MCT Kitchen", company_id=1,
            starting_balance=Decimal("1000.00"), current_balance=Decimal("1000.00"),
        ))
    db.add(Sale(
        sales_id=1, company_id=1, transaction_date=day, amount=Decimal("500.00"),
        particulars="Catering [Unpaid]", payment_status="Unpaid", deposit_status="Not Deposited",
        bank_account_id="bnk-001",
    ))
    db.add(Receivable(
        receivable_id=1, company_id=1, company_name="MCT Kitchen", customer_name="Ana",
        customer_type="External", sale_id=1, sale_line_index=0, transaction_date=day,
        items_summary="Catering", total_amount=Decimal("500.00"), amount_paid=Decimal("0.00"),
        balance=Decimal("500.00"), payment_status="Unpaid",
    ))
    db.commit()
    return db


def _balance(db, bid):
    db.expire_all()
    return db.get(BankAccount, bid).current_balance


def test_partial_payment_reflects_in_sale_and_auto_deposits():
    db = _setup()
    ReceivablesService(db).record_payment(
        1, ReceivablePaymentCreate(amount=Decimal("200.00"), payment_date=date.today(), bank_account_id="bnk-001")
    )
    sale = db.get(Sale, 1)
    assert "[Pending]" in sale.particulars
    assert sale.deposit_status == "Deposited"
    assert sale.deposit_date == date.today()
    # The sale's collected amount counts the partial payment, and the bank holds it.
    sync = SalesReceivablesSyncService(db)
    assert sync.compute_sale_paid_amount(1, sale.particulars, sale.amount) == Decimal("200.00")
    assert _balance(db, "bnk-001") == Decimal("1200.00")
    db.close()


def test_payment_always_goes_to_the_sales_origin_bank():
    db = _setup()
    # The client asks for BPI, but the sale was recorded to BDO: BDO receives it.
    pay = ReceivablesService(db).record_payment(
        1, ReceivablePaymentCreate(amount=Decimal("100.00"), payment_date=date.today(), bank_account_id="bnk-002")
    )
    assert pay.bank_account_id == "bnk-001"
    assert _balance(db, "bnk-001") == Decimal("1100.00")
    assert _balance(db, "bnk-002") == Decimal("1000.00")

    rec = ReceivablesService(db).get_receivable(1)
    assert rec.origin_bank_account_id == "bnk-001"
    assert rec.origin_bank_name == "BDO"
    assert rec.sale_deposit_status == "Deposited"
    db.close()


def test_deposit_status_tab_lets_supervisor_override():
    db = _setup(sale_day=date.today() - timedelta(days=3))
    svc = ReceivablesService(db)
    svc.record_payment(1, ReceivablePaymentCreate(amount=Decimal("200.00"), payment_date=date.today()))
    assert _balance(db, "bnk-001") == Decimal("1200.00")

    svc.update_receivable(1, ReceivableUpdate(deposit_status="Not Deposited"))
    sale = db.get(Sale, 1)
    assert sale.deposit_status == "Not Deposited" and sale.deposit_date is None
    assert _balance(db, "bnk-001") == Decimal("1000.00")

    picked = date.today() - timedelta(days=1)
    rec = svc.update_receivable(1, ReceivableUpdate(deposit_status="Deposited", deposit_date=picked))
    assert db.get(Sale, 1).deposit_date == picked
    assert rec.sale_deposit_status == "Deposited"
    assert _balance(db, "bnk-001") == Decimal("1200.00")

    # The deposit date cannot be before the sale date.
    with pytest.raises(HTTPException):
        svc.update_receivable(1, ReceivableUpdate(deposit_status="Deposited", deposit_date=date.today() - timedelta(days=10)))
    db.close()


def test_cannot_mark_deposited_with_nothing_collected():
    db = _setup()
    with pytest.raises(HTTPException) as exc:
        ReceivablesService(db).update_receivable(1, ReceivableUpdate(deposit_status="Deposited"))
    assert exc.value.status_code == 422
    db.close()


def test_day_remark_is_deleted_with_the_last_sale_of_the_day():
    db = _setup()
    day = date.today()
    db.add(Sale(sales_id=2, company_id=1, transaction_date=day, amount=Decimal("50.00"), particulars="Soda [Paid]"))
    db.add(DailyRemark(company_id=1, remark_date=day, kind="sales", remarks="Busy day"))
    db.add(DailyRemark(company_id=1, remark_date=day, kind="expense", remarks="Gas refill"))
    db.commit()

    db.delete(db.get(Sale, 2))
    db.commit()
    assert purge_orphan_daily_remark(db, None, "sales", 1, day) is False  # sale 1 is still on that day

    db.query(Receivable).delete()
    db.delete(db.get(Sale, 1))
    db.commit()
    assert purge_orphan_daily_remark(db, None, "sales", 1, day) is True
    kinds = {r.kind for r in db.query(DailyRemark).all()}
    assert kinds == {"expense"}  # only the sales remark goes
    db.close()
