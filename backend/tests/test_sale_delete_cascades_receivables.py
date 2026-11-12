"""Deleting a sale must also delete the receivables (and their payments) created from it."""
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.session import Base
from app.models.company import Company
from app.models.finance import Sale
from app.models.receivable import Receivable, ReceivablePayment


def _db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda c, _r: c.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_deleting_sale_deletes_its_receivables_and_payments_but_keeps_standalone_ones():
    db = _db()
    db.add(Company(company_id=1, company_name="A", starting_balance=Decimal("0")))
    db.flush()
    sale = Sale(company_id=1, transaction_date=date(2026, 11, 9), amount=Decimal("300"), particulars="Room", payment_method="Cash")
    db.add(sale)
    db.flush()
    linked = Receivable(company_id=1, company_name="A", customer_name="X", sale_id=sale.sales_id,
                        transaction_date=date(2026, 11, 9), items_summary="Room",
                        total_amount=Decimal("300"), amount_paid=Decimal("300"), balance=Decimal("0"), payment_status="Paid")
    standalone = Receivable(company_id=1, company_name="A", customer_name="Y", sale_id=None,
                            transaction_date=date(2026, 11, 9), items_summary="Other",
                            total_amount=Decimal("50"), amount_paid=Decimal("0"), balance=Decimal("50"), payment_status="Unpaid")
    db.add_all([linked, standalone])
    db.flush()
    db.add(ReceivablePayment(receivable_id=linked.receivable_id, payment_date=date(2026, 11, 10), amount=Decimal("300"), payment_method="Cash"))
    db.commit()

    db.delete(sale)
    db.commit()

    left = db.query(Receivable).all()
    assert [r.customer_name for r in left] == ["Y"]
    assert db.query(ReceivablePayment).count() == 0
