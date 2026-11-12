"""Bill payments are paid from a chosen funding source (a company bank account or petty cash).
The amount may not exceed what that source holds, the money really leaves it (bank entry / petty cash
balance), the payment shows as a paid Expense in Transactions, and undoing the payment gives it back.
Bill due dates always reach the notification feed."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.bills import Bill, BillPayment
from app.models.company import Company
from app.models.finance import Expense
from app.models.notification import Notification
from app.models.petty_cash import PettyCashTopUp
from app.schemas.bills import BillPaymentCreate
from app.services.bills_service import BillsService
from app.services.notification_service import NotificationService
from app.services.petty_cash_service import PettyCashService


def _db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(Company(company_id=1, company_name="Acme", starting_balance=Decimal("0.00")))
    db.add(Company(company_id=2, company_name="Other Co", starting_balance=Decimal("0.00")))
    db.add(BankAccount(
        id="bnk-001", bank_name="BDO", account_name="Acme Main", account_number="0001",
        company_name="Acme", company_id=1,
        starting_balance=Decimal("1000.00"), current_balance=Decimal("1000.00"),
    ))
    db.add(BankAccount(
        id="bnk-other", bank_name="BPI", account_name="Other", account_number="0002",
        company_name="Other Co", company_id=2,
        starting_balance=Decimal("5000.00"), current_balance=Decimal("5000.00"),
    ))
    db.add(PettyCashTopUp(
        company_id=1, amount=Decimal("500.00"), topup_date=date.today(),
        status="Approved", request_type="topup", reference_no="PC-1",
    ))
    db.add(Bill(
        bill_id=1, company_id=1, bill_name="Meralco", amount=Decimal("300.00"),
        recurring="monthly", due_date=date.today(), due_date_reminder=3,
    ))
    db.commit()
    return db


def _pay(amount, **kw):
    return BillPaymentCreate(
        payment_date=date.today(), amount=Decimal(str(amount)), payment_method="Bank Transfer", **kw
    )


def _bank(db, acc="bnk-001"):
    db.expire_all()
    return db.get(BankAccount, acc).current_balance


# ── Amount & funding validation ─────────────────────────────────────────────

@pytest.mark.parametrize("bad", ["abc", "12a", "-50", "0"])
def test_amount_rejects_letters_negative_and_zero(bad):
    with pytest.raises(ValidationError):
        BillPaymentCreate(payment_date=date.today(), amount=bad, payment_method="Cash")


def test_amount_accepts_decimals():
    p = BillPaymentCreate(payment_date=date.today(), amount="1250.75", payment_method="Cash")
    assert p.amount == Decimal("1250.75")


def test_bank_funding_requires_a_bank_account():
    with pytest.raises(ValidationError):
        _pay(100, funding_source="bank")


def test_cannot_pay_more_than_the_bank_holds():
    db = _db()
    db.get(BankAccount, "bnk-001").current_balance = Decimal("250.00")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        BillsService(db).record_payment(1, _pay(300, funding_source="bank", bank_account_id="bnk-001"))
    assert exc.value.status_code == 400
    assert db.query(BillPayment).count() == 0
    assert _bank(db) == Decimal("250.00")


def test_cannot_pay_from_another_companys_bank():
    db = _db()
    with pytest.raises(HTTPException) as exc:
        BillsService(db).record_payment(1, _pay(300, funding_source="bank", bank_account_id="bnk-other"))
    assert exc.value.status_code == 400


def test_cannot_pay_more_than_petty_cash_holds():
    db = _db()
    db.get(Bill, 1).amount = Decimal("800.00")
    db.commit()
    with pytest.raises(HTTPException) as exc:
        BillsService(db).record_payment(1, _pay(800, funding_source="petty_cash"))
    assert exc.value.status_code == 400
    assert PettyCashService(db).get_balance(1) == Decimal("500.00")


# ── Money movement ──────────────────────────────────────────────────────────

def test_bank_paid_bill_debits_the_bank_and_shows_as_paid_expense():
    db = _db()
    BillsService(db).record_payment(1, _pay("300.00", funding_source="bank", bank_account_id="bnk-001"))

    payment = db.query(BillPayment).one()
    assert payment.funding_source == "bank" and payment.bank_account_id == "bnk-001"
    expense = db.get(Expense, payment.expense_id)
    assert expense.amount == Decimal("300.00") and expense.amount_paid == Decimal("300.00")
    assert expense.bank_account_id == "bnk-001"
    assert expense.payment_method == "Bank Transfer"
    assert _bank(db) == Decimal("700.00")
    bt = db.query(BankTransaction).one()
    assert bt.source_expense_id == expense.expense_id and bt.withdrawal == Decimal("300.00")
    # Petty cash is untouched by a bank payment
    assert PettyCashService(db).get_balance(1) == Decimal("500.00")


def test_petty_cash_paid_bill_lowers_petty_cash_not_the_bank():
    db = _db()
    BillsService(db).record_payment(1, _pay("120.50", funding_source="petty_cash"))

    payment = db.query(BillPayment).one()
    assert payment.payment_method == "Petty Cash"
    expense = db.get(Expense, payment.expense_id)
    assert expense.payment_method == "Petty Cash" and expense.bank_account_id is None
    assert PettyCashService(db).get_balance(1) == Decimal("379.50")
    assert _bank(db) == Decimal("1000.00")
    assert db.query(BankTransaction).count() == 0


def test_undoing_a_payment_gives_the_money_back():
    db = _db()
    svc = BillsService(db)
    svc.record_payment(1, _pay(300, funding_source="bank", bank_account_id="bnk-001"))
    assert _bank(db) == Decimal("700.00")
    svc.delete_latest_payment(1)
    assert _bank(db) == Decimal("1000.00")
    assert db.query(Expense).count() == 0
    assert db.query(BankTransaction).count() == 0

    svc.record_payment(1, _pay(200, funding_source="petty_cash"))
    assert PettyCashService(db).get_balance(1) == Decimal("300.00")
    payment_id = db.query(BillPayment).one().bill_payment_id
    svc.delete_payment(1, payment_id)
    assert PettyCashService(db).get_balance(1) == Decimal("500.00")


def test_payment_without_funding_source_still_works_and_moves_no_money():
    db = _db()
    BillsService(db).record_payment(1, _pay(300))
    assert db.query(BillPayment).one().expense_id is None
    assert _bank(db) == Decimal("1000.00")


# ── Due-date notifications ──────────────────────────────────────────────────

def test_due_bill_shows_in_feed_even_when_user_has_stored_notifications():
    db = _db()
    # Any stored notification used to hide every computed bill reminder
    db.add(Notification(
        notification_id="PETTY_CASH_REQUEST-9-1", recipient_user_id=1, company_id=1,
        notification_type="PETTY_CASH_REQUEST", title="Request", message="x", reference_type="petty_cash",
    ))
    db.commit()

    svc = NotificationService(db)
    feed = svc.get_notifications_feed(recipient_user_id=1, company_id=1, user_role="supervisor")
    types = {n.notification_type for n in feed.items}
    assert "BILL_DUE_TODAY" in types
    assert "PETTY_CASH_REQUEST" in types
    assert svc.get_unread_count(company_id=1, user_role="supervisor", recipient_user_id=1) >= 2


def test_upcoming_and_overdue_bills_notify_and_paid_ones_stop():
    db = _db()
    db.get(Bill, 1).due_date = date.today() + timedelta(days=2)
    db.add(Bill(
        bill_id=2, company_id=1, bill_name="Water", amount=Decimal("50.00"),
        recurring="one-time", due_date=date.today() - timedelta(days=3), due_date_reminder=3,
    ))
    db.add(Notification(
        notification_id="X-1", recipient_user_id=1, company_id=1,
        notification_type="PETTY_CASH_AUDIT", title="t", message="m",
    ))
    db.commit()

    def bill_types(role="supervisor"):
        from app.core.cache import system_cache
        system_cache.clear()
        feed = NotificationService(db).get_notifications_feed(
            recipient_user_id=1, company_id=1, user_role=role
        )
        return {(n.reference_id, n.notification_type) for n in feed.items if n.reference_type == "bill"}

    assert (1, "BILL_DUE_SOON") in bill_types()
    assert (2, "BILL_OVERDUE") in bill_types()
    # Due-date reminders are for the supervisor only
    assert not any(t in ("BILL_DUE_SOON", "BILL_OVERDUE") for _, t in bill_types("finance"))
    assert not any(t in ("BILL_DUE_SOON", "BILL_OVERDUE") for _, t in bill_types("audit"))

    BillsService(db).record_payment(2, _pay(50))
    assert not any(ref == 2 and t.startswith("BILL_") and t != "BILL_PAYMENT_RECORDED" and "PAYMENT" not in t
                   for ref, t in bill_types())
