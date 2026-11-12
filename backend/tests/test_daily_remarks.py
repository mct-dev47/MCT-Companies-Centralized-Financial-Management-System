from datetime import date

import pytest
from fastapi import Response
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.endpoints.daily_remarks import list_daily_remarks, upsert_daily_remark
from app.models.daily_remark import DailyRemark
from app.models.finance import Base
from app.schemas.daily_remark import DailyRemarkUpsert

USER = {"user_id": 7, "role": "finance", "full_name": "Fin User"}
DAY = date(2026, 11, 9)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _save(db, company_id=1, kind="sales", remark_date=DAY, remarks="Closed early"):
    return upsert_daily_remark(
        DailyRemarkUpsert(company_id=company_id, kind=kind, remark_date=remark_date, remarks=remarks),
        Response(),
        USER,
        db,
    )


def test_create_then_list(db):
    saved = _save(db)
    assert saved.remarks == "Closed early"
    assert saved.updated_by == "Fin User"

    rows = list_daily_remarks(1, "sales", None, None, USER, db)
    assert [r.remarks for r in rows] == ["Closed early"]


def test_second_save_updates_same_row(db):
    _save(db, remarks="First")
    _save(db, remarks="Second")
    assert db.query(DailyRemark).count() == 1
    assert db.query(DailyRemark).first().remarks == "Second"


def test_blank_remark_clears_the_day(db):
    _save(db)
    result = _save(db, remarks="   ")
    assert result is None
    assert db.query(DailyRemark).count() == 0


def test_kinds_and_companies_are_separate(db):
    _save(db, kind="sales", remarks="Sales note")
    _save(db, kind="expense", remarks="Expense note")
    _save(db, company_id=2, kind="sales", remarks="Other company")
    assert db.query(DailyRemark).count() == 3

    sales = list_daily_remarks(1, "sales", None, None, USER, db)
    expense = list_daily_remarks(1, "expense", None, None, USER, db)
    assert [r.remarks for r in sales] == ["Sales note"]
    assert [r.remarks for r in expense] == ["Expense note"]


def test_date_range_filter(db):
    _save(db, remark_date=date(2026, 11, 1), remarks="Early")
    _save(db, remark_date=date(2026, 11, 20), remarks="Late")
    rows = list_daily_remarks(1, "sales", date(2026, 11, 10), date(2026, 11, 30), USER, db)
    assert [r.remarks for r in rows] == ["Late"]


def test_invalid_kind_rejected():
    with pytest.raises(ValidationError):
        DailyRemarkUpsert(company_id=1, kind="loan", remark_date=DAY, remarks="x")
