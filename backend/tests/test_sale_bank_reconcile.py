from decimal import Decimal
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.services.bank_service import BankService


def _session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(BankAccount(
        id="bnk-001", bank_name="BDO", account_name="Main", account_number="1",
        company_name="Acme", starting_balance=Decimal("1000.00"), current_balance=Decimal("1000.00"),
    ))
    db.commit()
    return db


def _balance(db):
    db.expire_all()
    return db.get(BankAccount, "bnk-001").current_balance


def _ledger_net(db):
    rows = db.query(BankTransaction).all()
    return sum((r.deposit or 0) - (r.withdrawal or 0) for r in rows)


def _sync(svc, target, **kw):
    return svc.sync_sale_deposit(
        sale_id=7, target_amount=Decimal(target), account_id="bnk-001",
        particulars="Sales Collection: Item", **kw,
    )


def test_bank_matches_ledger_through_deposit_edit_undeposit():
    db = _session()
    svc = BankService(db)

    _sync(svc, "0")                      # Not Deposited: nothing credited
    assert _balance(db) == Decimal("1000.00")

    _sync(svc, "500")                    # marked Deposited
    assert _balance(db) == Decimal("1500.00")

    _sync(svc, "500")                    # no change: no duplicate entry
    assert db.query(BankTransaction).count() == 1

    _sync(svc, "800")                    # amount edited up
    assert _balance(db) == Decimal("1800.00")

    _sync(svc, "300")                    # amount edited down
    assert _balance(db) == Decimal("1300.00")

    _sync(svc, "0")                      # un-deposited or deleted
    assert _balance(db) == Decimal("1000.00")

    # Bank balance always equals starting balance plus the transactions list.
    assert _balance(db) == Decimal("1000.00") + Decimal(str(_ledger_net(db)))
    db.close()


def test_legacy_unlinked_credit_is_adopted_not_doubled():
    db = _session()
    svc = BankService(db)
    svc.record_deposit_by_account_id("bnk-001", Decimal("500"), "Sales Collection: Item")
    db.query(BankTransaction).update({"category": "Cash"})
    db.commit()

    _sync(svc, "500", legacy_particulars="Item")
    assert _balance(db) == Decimal("1500.00")
    assert db.query(BankTransaction).count() == 1
    db.close()
