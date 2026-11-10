"""Deleting a sale or expense row ANY way (not only through the API) removes its bank entries and fixes
the bank balance. Regression: sales deleted outside the app left their bank entries behind (bnk-010 kept
P5,169 the Transactions ledger no longer counted)."""
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register all tables)
from app.db import bank_cascade
from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Expense, Sale


def _db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        bank_cascade.install_sqlite_triggers(conn)
    db = sessionmaker(bind=engine)()
    db.add(BankAccount(
        id="bnk-010", bank_name="CHINABANK", account_name="Main", account_number="1", company_name="Hotel",
        starting_balance=Decimal("20000.00"), current_balance=Decimal("20000.00"),
    ))
    db.add_all([
        Sale(sales_id=97, company_id=1, transaction_date=date(2026, 11, 7), amount=Decimal("899"),
             particulars="Room [Paid]", payment_status="Paid", deposit_status="Deposited"),
        Sale(sales_id=99, company_id=1, transaction_date=date(2026, 11, 7), amount=Decimal("499"),
             particulars="Room 2 [Paid]", payment_status="Paid", deposit_status="Deposited"),
        Expense(expense_id=5, company_id=1, expense_date=date(2026, 11, 7), amount=Decimal("300"),
                amount_paid=Decimal("300"), description="Supplies [Paid]"),
    ])
    for tx_id, dep, wd, sale, exp in (
        ("tx-a", "899", "0", 97, None),
        ("tx-b", "0", "100", 97, None),   # a reversal on the same sale: removed too
        ("tx-c", "499", "0", 99, None),
        ("tx-d", "0", "300", None, 5),
    ):
        db.add(BankTransaction(
            id=tx_id, bank_account_id="bnk-010", transaction_date="11/07/26", particulars="x",
            deposit=Decimal(dep), withdrawal=Decimal(wd), category="Cash", net_amount=Decimal(dep) + Decimal(wd),
            source_sale_id=sale, source_expense_id=exp,
        ))
    db.execute(text("UPDATE bank_accounts SET current_balance = 20000 + 899 - 100 + 499 - 300"))
    db.commit()
    return db


def _balance(db):
    db.expire_all()
    return db.get(BankAccount, "bnk-010").current_balance


def test_raw_sale_delete_removes_its_bank_entries_and_fixes_balance():
    db = _db()
    db.execute(text("DELETE FROM sales WHERE sales_id = 97"))  # outside the API, like the Supabase editor
    db.commit()
    assert {t.id for t in db.query(BankTransaction).all()} == {"tx-c", "tx-d"}
    assert _balance(db) == Decimal("20199.00")  # 20000 + 499 - 300


def test_raw_expense_delete_removes_its_bank_entry_and_fixes_balance():
    db = _db()
    db.execute(text("DELETE FROM expenses WHERE expense_id = 5"))
    db.commit()
    assert {t.id for t in db.query(BankTransaction).all()} == {"tx-a", "tx-b", "tx-c"}
    assert _balance(db) == Decimal("21298.00")  # 20000 + 899 - 100 + 499


def test_postgres_migration_file_matches_the_trigger_source():
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "0054_bank_entries_cascade.postgres.sql").read_text(encoding="utf-8")
    for _table, id_col, link_col in bank_cascade._LINKS:
        assert bank_cascade._body(id_col, link_col) in sql
