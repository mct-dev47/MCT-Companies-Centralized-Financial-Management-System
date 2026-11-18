from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.finance import Sale
from app.models.receivable import Receivable
from app.services.receivables_service import ReceivablesService
from app.services.sales_receivables_sync import SalesReceivablesSyncService


def _setup_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(Company(company_id=1, company_name="MCT Kitchen", location="Manila"))
    db.add(
        BankAccount(
            id="bnk-001",
            bank_name="BDO",
            account_name="Main",
            company_name="MCT Kitchen",
            company_id=1,
            starting_balance=Decimal("1000.00"),
            current_balance=Decimal("1000.00"),
        )
    )
    db.add(
        Sale(
            sales_id=1,
            company_id=1,
            transaction_date=date.today(),
            amount=Decimal("500.00"),
            particulars="Catering [Unpaid]",
            payment_status="Unpaid",
            deposit_status="Not Deposited",
            audit_status="Verified",
            bank_account_id="bnk-001",
        )
    )
    db.add(
        Receivable(
            receivable_id=1,
            company_id=1,
            company_name="MCT Kitchen",
            customer_name="Ana",
            customer_type="External",
            sale_id=1,
            sale_line_index=0,
            transaction_date=date.today(),
            items_summary="Catering",
            total_amount=Decimal("500.00"),
            amount_paid=Decimal("0.00"),
            balance=Decimal("500.00"),
            payment_status="Unpaid",
        )
    )
    db.commit()
    return db, engine


def test_use_supabase_returns_false_for_postgresql(monkeypatch):
    db, _ = _setup_db()
    sync = SalesReceivablesSyncService(db)
    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), url=SimpleNamespace(database="postgres"))
    monkeypatch.setattr(db, "get_bind", lambda: fake_bind)

    assert sync._use_supabase() is False


def test_use_supabase_returns_false_for_in_memory_sqlite():
    db, _ = _setup_db()
    sync = SalesReceivablesSyncService(db)

    assert sync._use_supabase() is False


def test_use_supabase_returns_true_for_file_sqlite(monkeypatch):
    db, _ = _setup_db()
    sync = SalesReceivablesSyncService(db)
    fake_bind = SimpleNamespace(dialect=SimpleNamespace(name="sqlite"), url=SimpleNamespace(database="mct.db"))
    monkeypatch.setattr(db, "get_bind", lambda: fake_bind)

    assert sync._use_supabase() is True


def test_list_receivables_skips_count_query_and_attaches_flags():
    db, engine = _setup_db()
    sql_statements = []

    @event.listens_for(engine, "before_cursor_execute")
    def _capture_sql(conn, cursor, statement, parameters, context, executemany):
        sql_statements.append(statement.upper())

    rows = ReceivablesService(db).list_receivables(limit=None)

    assert len(rows) == 1
    assert rows[0].is_locked is True
    assert rows[0].origin_bank_name == "BDO"
    assert rows[0].sale_deposit_status == "Not Deposited"
    assert not any("COUNT(" in stmt for stmt in sql_statements)


def test_list_receivables_with_count_returns_total_and_paginates():
    db, _ = _setup_db()
    db.add(
        Receivable(
            receivable_id=2,
            company_id=1,
            company_name="MCT Kitchen",
            customer_name="Ben",
            customer_type="External",
            sale_id=None,
            transaction_date=date.today(),
            items_summary="Snacks",
            total_amount=Decimal("200.00"),
            amount_paid=Decimal("0.00"),
            balance=Decimal("200.00"),
            payment_status="Unpaid",
        )
    )
    db.commit()

    rows, total = ReceivablesService(db).list_receivables_with_count(limit=1, offset=0)

    assert total == 2
    assert len(rows) == 1
