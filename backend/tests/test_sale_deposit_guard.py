"""The database refuses a deposit status change that has no matching deposit date, so stale code (the old
startup backfill, still on teammates' checkouts of `dev`) can no longer flip sales behind the bank's back.
The startup repair also undoes flips that already happened."""
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register all tables)
from app.db import sale_status_guard
from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Sale
from app.services.bank_reconcile import repair_bank_integrity

OLD_BACKFILL = (
    "UPDATE sales SET deposit_status = 'Deposited' WHERE payment_status = 'Paid' AND (deposit_status IS NULL OR deposit_status = '' OR deposit_status = 'Not Deposited')",
    "UPDATE sales SET deposit_status = 'Not Deposited' WHERE payment_status IN ('Unpaid', 'Pending')",
)


def _db(guard=True):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    if guard:
        with engine.begin() as conn:
            sale_status_guard.install_sqlite_trigger(conn)
    db = sessionmaker(bind=engine)()
    db.add(BankAccount(id="bnk-010", bank_name="CB", account_name="Main", account_number="1", company_name="Hotel",
                       starting_balance=Decimal("20000"), current_balance=Decimal("20275")))
    db.add_all([
        Sale(sales_id=113, company_id=1, transaction_date=date(2026, 11, 6), amount=Decimal("1349"),
             particulars="Room [Paid]", payment_status="Paid", deposit_status="Not Deposited"),
        Sale(sales_id=103, company_id=1, transaction_date=date(2026, 11, 8), amount=Decimal("549"),
             particulars="Room [Pending]", payment_status="Pending", deposit_status="Deposited",
             deposit_date=date(2026, 11, 10)),
    ])
    db.add(BankTransaction(id="tx-103", bank_account_id="bnk-010", transaction_date="11/10/26", particulars="x",
                           deposit=Decimal("275"), withdrawal=Decimal("0"), category="Cash",
                           net_amount=Decimal("275"), source_sale_id=103))
    db.commit()
    return db


def _status(db):
    db.expire_all()
    return {s.sales_id: (s.deposit_status, s.deposit_date) for s in db.query(Sale).all()}


def test_guard_blocks_the_old_backfill():
    db = _db()
    for stmt in OLD_BACKFILL:
        db.execute(text(stmt))
    db.commit()
    assert _status(db) == {113: ("Not Deposited", None), 103: ("Deposited", date(2026, 11, 10))}


def test_guard_allows_real_app_changes_that_move_status_and_date_together():
    db = _db()
    db.execute(text("UPDATE sales SET deposit_status='Deposited', deposit_date='2026-11-06' WHERE sales_id=113"))
    db.execute(text("UPDATE sales SET deposit_status='Not Deposited', deposit_date=NULL WHERE sales_id=103"))
    db.execute(text("UPDATE sales SET remarks='ok' WHERE sales_id=113"))  # unrelated edits untouched
    db.commit()
    assert _status(db) == {113: ("Deposited", date(2026, 11, 6)), 103: ("Not Deposited", None)}


def test_startup_repair_undoes_flips_that_already_happened():
    db = _db(guard=False)  # damage done before the guard existed
    for stmt in OLD_BACKFILL:
        db.execute(text(stmt))
    db.commit()
    assert _status(db)[113] == ("Deposited", None)
    assert _status(db)[103] == ("Not Deposited", date(2026, 11, 10))

    result = repair_bank_integrity(db)
    assert result["statuses_restored"] == 2
    assert _status(db) == {113: ("Not Deposited", None), 103: ("Deposited", date(2026, 11, 10))}
    assert repair_bank_integrity(db)["statuses_restored"] == 0


def test_postgres_migration_file_matches_the_guard_source():
    from pathlib import Path

    sql = (Path(__file__).resolve().parents[1] / "migrations" / "0057_sale_deposit_guard.postgres.sql").read_text(encoding="utf-8")
    assert sale_status_guard._INCONSISTENT in sql
