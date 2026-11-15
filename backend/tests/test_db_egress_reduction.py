"""
Regression tests for DB egress reductions:
  - Entity timeline pre-filters audit_logs in SQL instead of loading the table.
  - Company lookups use a cached directory that is invalidated on writes.
"""
import json

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.company_resolver import get_company_name_map, resolve_company
from app.db.session import Base
from app.models.audit_log import AuditLog
from app.models.company import Company
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


def _log(action, details):
    return AuditLog(action=action, action_category="TRANSACTION", details=json.dumps(details))


def test_timeline_only_returns_matching_audit_rows(db):
    db.add_all([
        _log("SALE_CREATED", {"record_type": "sale", "record_id": "42"}),
        _log("SALE_UPDATED", {"reference_no": "SAL-2026-0042"}),
        _log("SALE_CREATED", {"record_type": "sale", "record_id": "7"}),          # other sale
        _log("EXPENSE_CREATED", {"record_type": "expense", "record_id": "42"}),   # other type
    ])
    db.commit()

    events = ActivityLogService().get_entity_timeline(
        record_type="sales", record_id="42", ref_no="sal-2026-0042", db=db,
    )
    actions = sorted(e.action for e in events if e.id.startswith("audit-"))
    assert actions == ["SALE_CREATED", "SALE_UPDATED"]


def test_timeline_sql_prefilter_does_not_load_unrelated_rows(db):
    db.add_all([_log("EXPENSE_CREATED", {"record_type": "expense", "record_id": str(i)}) for i in range(50)])
    db.add(_log("SALE_CREATED", {"record_type": "sale", "record_id": "999"}))
    db.commit()
    db.expunge_all()

    loaded = []

    def _on_load(target, _ctx):
        loaded.append(target.audit_log_id)

    event.listen(AuditLog, "load", _on_load)
    try:
        ActivityLogService().get_entity_timeline(record_type="sale", record_id="999", db=db)
    finally:
        event.remove(AuditLog, "load", _on_load)

    assert len(loaded) == 1, f"expected only the matching row to be loaded, got {len(loaded)}"


def test_company_directory_is_cached_and_invalidated_on_write(db):
    db.add_all([Company(company_name="Alpha Holdings", starting_balance=0), Company(company_name="Beta Retail", starting_balance=0)])
    db.commit()

    statements = []

    @event.listens_for(db.get_bind(), "before_cursor_execute")
    def _capture(conn, cursor, statement, params, context, executemany):
        if "FROM company" in statement:
            statements.append(statement)

    first = get_company_name_map(db)
    second = get_company_name_map(db)
    assert sorted(first.values()) == ["Alpha Holdings", "Beta Retail"]
    assert first == second
    assert len(statements) == 1, "second lookup should be served from cache"

    db.add(Company(company_name="Gamma Foods", starting_balance=0))
    db.commit()
    assert "Gamma Foods" in get_company_name_map(db).values()


def test_resolve_company_matches_by_name_via_cache(db):
    db.add_all([Company(company_name="Alpha Holdings", starting_balance=0), Company(company_name="Beta Retail Corp", starting_balance=0)])
    db.commit()

    assert resolve_company(db, company_name="beta retail").company_name == "Beta Retail Corp"
    assert resolve_company(db, company_name="All Companies").company_name == "Alpha Holdings"
    with pytest.raises(Exception):
        resolve_company(db, company_name="Nonexistent")
