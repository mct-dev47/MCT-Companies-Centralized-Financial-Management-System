"""
Regression tests for chronological ordering of Activity Timeline & Remarks
(oldest on top, newest on bottom).
"""
import json
from datetime import date, datetime, timezone, timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.session import Base
from app.models.audit_log import AuditLog
from app.models.company import Company
from app.models.finance import Sale
from app.models.petty_cash import PettyCashTopUp
from app.services.activity_log_service import ActivityLogService


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def test_timeline_orders_audit_logs_and_model_milestones_chronologically(db):
    company = Company(company_id=1, company_name="Test Co")
    db.add(company)
    db.flush()

    sale = Sale(
        sales_id=101,
        company_id=1,
        transaction_date=date(2026, 11, 18),
        particulars="Room Charge",
        amount=1000.0,
        payment_status="Paid",
        audit_status="Verified",
        audited_by="Auditor",
        audited_at=datetime(2026, 11, 18, 12, 0, 0, tzinfo=timezone.utc),
        created_at=datetime(2026, 11, 18, 10, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 11, 18, 12, 0, 0, tzinfo=timezone.utc),
    )
    db.add(sale)

    log_remark = AuditLog(
        action="SALE_UPDATED",
        action_category="TRANSACTION",
        details=json.dumps({
            "record_type": "sale",
            "record_id": "101",
            "notes": "Follow-up remark at 11am",
        }),
        created_at=datetime(2026, 11, 18, 11, 0, 0, tzinfo=timezone.utc),
    )
    db.add(log_remark)
    db.commit()

    events = ActivityLogService().get_entity_timeline(
        record_type="sale",
        record_id="101",
        db=db,
    )

    actions = [e.action for e in events]
    assert actions == ["SALE_CREATED", "SALE_UPDATED", "SALE_AUDITED"]


def test_timeline_orders_mixed_timezones_and_space_separators_chronologically():
    """
    Simulates Postgres DateTime(timezone=True) where AuditLog.created_at
    has a timezone offset (producing a space separator via str(r.created_at))
    and Sale timestamps have a different timezone offset (+08:00 vs +00:00).
    """
    tz_mnl = timezone(timedelta(hours=8))

    # 10:00+08:00 == 02:00 UTC (oldest)
    sale = MagicMock(spec=Sale)
    sale.sales_id = 102
    sale.transaction_date = date(2026, 11, 18)
    sale.particulars = "Mixed TZ Sale"
    sale.amount = 500.0
    sale.payment_status = "Paid"
    sale.audit_status = "Verified"
    sale.audited_by = "Auditor"
    sale.audit_remarks = "Verified at 12pm MNL"
    sale.created_at = datetime(2026, 11, 18, 10, 0, 0, tzinfo=tz_mnl)
    # 12:00+08:00 == 04:00 UTC (newest)
    sale.audited_at = datetime(2026, 11, 18, 12, 0, 0, tzinfo=tz_mnl)
    sale.updated_at = datetime(2026, 11, 18, 12, 0, 0, tzinfo=tz_mnl)

    # 03:00 UTC == 11:00+08:00 (middle, and str() has a space separator +00:00)
    log_remark = AuditLog(
        audit_log_id=5001,
        user_id=None,
        company_id=1,
        action="SALE_UPDATED",
        action_category="TRANSACTION",
        ip_address=None,
        details=json.dumps({
            "record_type": "sale",
            "record_id": "102",
            "notes": "Remark 1 hour after creation",
        }),
        created_at=datetime(2026, 11, 18, 3, 0, 0, tzinfo=timezone.utc),
    )

    mock_db = MagicMock()

    def query_side_effect(model):
        q = MagicMock()
        if model is AuditLog:
            q.filter.return_value = q
            q.order_by.return_value = q
            q.all.return_value = [log_remark]
        elif model is Sale:
            q.filter.return_value = q
            q.first.return_value = sale
        else:
            q.filter.return_value = q
            q.all.return_value = []
            q.first.return_value = None
        return q

    mock_db.query.side_effect = query_side_effect

    events = ActivityLogService().get_entity_timeline(
        record_type="sale",
        record_id="102",
        db=mock_db,
    )

    actions = [e.action for e in events]
    assert actions == ["SALE_CREATED", "SALE_UPDATED", "SALE_AUDITED"], (
        f"Expected [SALE_CREATED, SALE_UPDATED, SALE_AUDITED], got {actions} "
        f"with timestamps {[e.timestamp for e in events]}"
    )


def test_petty_cash_timeline_orders_milestones_and_audit_logs_chronologically(db):
    company = Company(company_id=3, company_name="Petty Cash Co")
    db.add(company)
    db.flush()

    topup = PettyCashTopUp(
        topup_id=201,
        company_id=3,
        topup_date=date(2026, 11, 18),
        amount=2000.0,
        request_type="topup",
        status="Approved",
        description="Office supplies float",
        created_at=datetime(2026, 11, 18, 8, 0, 0),
        endorsed_by="Finance",
        endorsed_at=datetime(2026, 11, 18, 9, 0, 0),
        reviewed_by="Auditor",
        reviewed_at=datetime(2026, 11, 18, 11, 0, 0),
    )
    db.add(topup)

    # AuditLog remark between endorsed (09:00) and reviewed (11:00)
    log_remark = AuditLog(
        action="PETTY_CASH_UPDATED",
        action_category="PETTY_CASH",
        details=json.dumps({
            "record_type": "petty_cash",
            "record_id": "201",
            "notes": "Clarification remark at 10am",
        }),
        created_at=datetime(2026, 11, 18, 10, 0, 0),
    )
    db.add(log_remark)
    db.commit()

    events = ActivityLogService().get_entity_timeline(
        record_type="petty_cash",
        record_id="201",
        db=db,
    )

    actions = [e.action for e in events]
    assert actions == [
        "PETTY_CASH_TOPUP_CREATED",
        "PETTY_CASH_ENDORSED",
        "PETTY_CASH_UPDATED",
        "PETTY_CASH_AUDIT_REVIEW",
    ], f"Got {actions} with timestamps {[e.timestamp for e in events]}"
