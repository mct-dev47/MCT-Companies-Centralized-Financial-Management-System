"""The reconcile sweep brings every bank back to exactly what the Transactions ledger counts.

Reproduces the drift seen on bnk-010: a Deposited sale with no bank entry, a Not Deposited sale whose bank
entry stayed behind, and a stored balance that no longer equals its entries.
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register all tables)
from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.company import Company
from app.models.finance import Sale
from app.services.bank_reconcile import reconcile_all_banks


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(Company(company_id=1, company_name="Hotel", starting_balance=Decimal("0")))
    db.add(BankAccount(
        id="bnk-010", bank_name="CHINABANK", account_name="Main", account_number="1", company_name="Hotel",
        starting_balance=Decimal("20000.00"), current_balance=Decimal("19999.00"),  # drifted stored balance
    ))
    db.commit()
    return db


def _sale(sid, payment, deposit, amount, parts, dep_date=None):
    return Sale(
        sales_id=sid, company_id=1, transaction_date=date(2026, 11, 6), amount=Decimal(amount),
        particulars=parts, payment_status=payment, deposit_status=deposit, deposit_date=dep_date,
        bank_account_id="bnk-010",
    )


def _ledger_target(db):
    """What the Transactions ledger shows for the bank: starting balance + paid amount of Deposited sales."""
    return Decimal("20000.00") + Decimal("1349.00")


def test_sweep_makes_bank_equal_ledger_and_is_idempotent():
    db = _db()
    db.add_all([
        _sale(104, "Paid", "Deposited", "1349", "Room [Paid]"),              # deposited, bank never credited
        _sale(105, "Paid", "Not Deposited", "499", "Room 2 [Paid]"),          # not deposited, but bank has it
    ])
    db.add(BankTransaction(
        id="tx-stale", bank_account_id="bnk-010", transaction_date="11/06/26", particulars="Sales Collection: Room 2 [Paid]",
        deposit=Decimal("499.00"), withdrawal=Decimal("0.00"), category="Cash", net_amount=Decimal("499.00"),
        source_sale_id=105,
    ))
    db.add(BankTransaction(  # sale 97 was deleted outside the app: its entry must go
        id="tx-orphan", bank_account_id="bnk-010", transaction_date="11/07/26", particulars="Sales Collection: gone",
        deposit=Decimal("899.00"), withdrawal=Decimal("0.00"), category="Cash", net_amount=Decimal("899.00"),
        source_sale_id=97,
    ))
    db.commit()

    first = reconcile_all_banks(db)
    db.expire_all()
    acc = db.get(BankAccount, "bnk-010")
    net = sum((t.deposit or 0) - (t.withdrawal or 0) for t in db.query(BankTransaction).all())

    assert acc.current_balance == _ledger_target(db)
    assert acc.current_balance == acc.starting_balance + net
    assert first["sales_checked"] == 2
    assert first["orphan_entries_removed"] == 1
    assert db.get(BankTransaction, "tx-orphan") is None
    assert first["accounts_still_off"] == {}

    second = reconcile_all_banks(db)
    assert second["entries_posted"] == 0
    assert second["balances_fixed"] == 0


def test_startup_repair_removes_leftovers_and_fixes_balance_without_touching_live_entries():
    from app.services.bank_reconcile import repair_bank_integrity

    db = _db()
    db.add(_sale(109, "Paid", "Deposited", "899", "Room [Paid]", date(2026, 11, 7)))
    for tx_id, sale_id in (("tx-live", 109), ("tx-gone", 97)):  # 97 was deleted outside the app
        db.add(BankTransaction(
            id=tx_id, bank_account_id="bnk-010", transaction_date="11/07/26", particulars="Sales Collection: Room",
            deposit=Decimal("899.00"), withdrawal=Decimal("0.00"), category="Cash", net_amount=Decimal("899.00"),
            source_sale_id=sale_id,
        ))
    db.commit()

    first = repair_bank_integrity(db)
    db.expire_all()
    assert first["orphan_entries_removed"] == 1
    assert {t.id for t in db.query(BankTransaction).all()} == {"tx-live"}
    assert db.get(BankAccount, "bnk-010").current_balance == Decimal("20899.00")

    assert repair_bank_integrity(db) == {"statuses_restored": 0, "orphan_entries_removed": 0, "balances_fixed": 0}


def test_startup_repair_keeps_entries_when_sales_table_is_empty():
    """Guard: if this database holds no sales at all (they live elsewhere), entries are never purged."""
    from app.services.bank_reconcile import repair_bank_integrity

    db = _db()
    db.add(BankTransaction(
        id="tx-keep", bank_account_id="bnk-010", transaction_date="11/07/26", particulars="x",
        deposit=Decimal("100.00"), withdrawal=Decimal("0.00"), category="Cash", net_amount=Decimal("100.00"),
        source_sale_id=1,
    ))
    db.commit()
    assert repair_bank_integrity(db)["orphan_entries_removed"] == 0
    assert db.get(BankTransaction, "tx-keep") is not None


def test_supervisor_scope_only_reconciles_their_companies():
    db = _db()
    db.add(Company(company_id=2, company_name="Other", starting_balance=Decimal("0")))
    db.add_all([
        _sale(104, "Paid", "Deposited", "1349", "Room [Paid]"),
        Sale(sales_id=200, company_id=2, transaction_date=date(2026, 11, 6), amount=Decimal("500"),
             particulars="Other [Paid]", payment_status="Paid", deposit_status="Deposited", bank_account_id="bnk-010"),
    ])
    db.commit()
    result = reconcile_all_banks(db, company_ids=[1])
    assert result["sales_checked"] == 1
    assert {t.source_sale_id for t in db.query(BankTransaction).all()} == {104}
