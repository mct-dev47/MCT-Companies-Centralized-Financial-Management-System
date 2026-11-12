"""The startup backfill must only fill blank sale statuses, never overwrite one a user chose.

Regression: it used to flip every Paid + 'Not Deposited' sale to 'Deposited' on each server start (raw SQL,
so no deposit date and no bank entry), and reset Pending + Deposited sales to 'Not Deposited'. The
Transactions ledger then counted money the bank never received.
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (register all tables)
from app.db.session import Base, backfill_sale_statuses
from app.models.finance import Sale


def _sale(sid, payment, deposit, dep_date=None):
    return Sale(
        sales_id=sid, company_id=1, transaction_date=date(2026, 11, 6), amount=Decimal("100"),
        particulars="Room [Paid]", payment_status=payment, deposit_status=deposit, deposit_date=dep_date,
    )


def test_backfill_keeps_chosen_deposit_status_and_fills_only_blanks():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add_all([
        _sale(1, "Paid", "Not Deposited"),                     # GCash not yet banked: must stay as is
        _sale(2, "Pending", "Deposited", date(2026, 11, 10)),   # partial payment deposited: must stay
        _sale(3, "Paid", ""),                                   # blank: filled as Deposited on the sale date
        _sale(4, "Unpaid", ""),                                 # blank: filled as Not Deposited
    ])
    db.commit()

    with engine.begin() as conn:
        backfill_sale_statuses(conn)

    db.expire_all()
    got = {s.sales_id: (s.deposit_status, s.deposit_date) for s in db.query(Sale).all()}
    assert got[1] == ("Not Deposited", None)
    assert got[2] == ("Deposited", date(2026, 11, 10))
    assert got[3] == ("Deposited", date(2026, 11, 6))
    assert got[4] == ("Not Deposited", None)
