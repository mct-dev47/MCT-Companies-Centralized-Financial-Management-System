"""
CLI tests for migrate_petty_cash_receipts_to_storage.py: moves inline base64
receipts into the "receipts" bucket. Dry run by default; --apply writes.
"""
import base64
import json
import sys
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import migrate_petty_cash_receipts_to_storage as migration
from app.db.session import Base
from app.models.company import Company
from app.models.petty_cash import PettyCashTopUp
from app.services import receipt_storage as rs

PNG = b"\x89PNG\r\n\x1a\nlegacy"
PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


class FakeBucket:
    def __init__(self):
        self.files = {}
        self.fail = False

    def upload(self, path, data, options=None):
        if self.fail:
            raise RuntimeError("down")
        self.files[path] = data


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    db = Session()
    company = Company(company_name="MCT Kitchen", starting_balance=Decimal("0"))
    db.add(company)
    db.flush()
    legacy = PettyCashTopUp(
        company_id=company.company_id, amount=Decimal("100"), topup_date=date(2026, 1, 5),
        status="Approved", request_type="topup",
        attachments=json.dumps([{"file_url": PNG_DATA_URL, "file_name": "old.png"}]),
        receipt_url=PNG_DATA_URL,
    )
    clean = PettyCashTopUp(
        company_id=company.company_id, amount=Decimal("50"), topup_date=date(2026, 1, 6),
        status="Approved", request_type="topup",
        attachments=json.dumps([{"storage_path": "petty-cash/2026/01/x.png"}]),
    )
    db.add_all([legacy, clean])
    db.commit()
    ids = {"legacy": legacy.topup_id, "clean": clean.topup_id}
    db.close()

    bucket = FakeBucket()
    monkeypatch.setattr(migration, "SessionLocal", Session)
    monkeypatch.setattr(migration, "get_supabase_admin_client", lambda: object())
    monkeypatch.setattr(rs, "_bucket", lambda: bucket)

    def row(key):
        s = Session()
        try:
            r = s.get(PettyCashTopUp, ids[key])
            return r.attachments, r.receipt_url
        finally:
            s.close()

    yield {"bucket": bucket, "row": row}
    engine.dispose()


def _run(monkeypatch, *args):
    monkeypatch.setattr(sys, "argv", ["migrate", *args])
    return migration.main()


def test_dry_run_reports_but_changes_nothing(env, monkeypatch, capsys):
    before = env["row"]("legacy")

    code = _run(monkeypatch)

    assert code == 0
    assert env["row"]("legacy") == before
    assert env["bucket"].files == {}
    assert "1 petty cash row(s) have inline receipt files" in capsys.readouterr().out


def test_apply_moves_inline_files_to_bucket_and_stores_paths(env, monkeypatch):
    code = _run(monkeypatch, "--apply")

    assert code == 0
    atts, receipt_url = env["row"]("legacy")
    path = json.loads(atts)[0]["storage_path"]
    assert env["bucket"].files == {path: PNG}, "receipt_url must reuse the attachment upload"
    assert receipt_url == rs.storage_ref(path)
    assert "data:" not in atts


def test_apply_leaves_already_migrated_rows_alone(env, monkeypatch):
    before = env["row"]("clean")

    _run(monkeypatch, "--apply")

    assert env["row"]("clean") == before


def test_apply_is_safe_to_rerun(env, monkeypatch):
    _run(monkeypatch, "--apply")
    after_first = env["row"]("legacy")

    code = _run(monkeypatch, "--apply")

    assert code == 0
    assert env["row"]("legacy") == after_first
    assert len(env["bucket"].files) == 1


def test_failed_uploads_leave_row_untouched_and_exit_nonzero(env, monkeypatch):
    env["bucket"].fail = True
    before = env["row"]("legacy")

    code = _run(monkeypatch, "--apply")

    assert code == 2
    assert env["row"]("legacy") == before


def test_aborts_when_supabase_is_not_configured(env, monkeypatch):
    monkeypatch.setattr(migration, "get_supabase_admin_client", lambda: None)

    assert _run(monkeypatch, "--apply") == 1
    assert env["bucket"].files == {}
