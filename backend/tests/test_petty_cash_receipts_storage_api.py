"""
Integration tests: petty cash receipts live in the Supabase "receipts" bucket,
and the petty_cash_topups table stores only storage paths.

The bucket is replaced with an in-memory fake (the network boundary); the
FastAPI router, service, schemas and SQLite DB are real.
"""
import base64
import json
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.petty_cash import router as petty_cash_router
from app.core.dependencies import get_current_user
from app.db.session import Base, get_db
from app.models.company import Company
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.services import receipt_storage as rs

SIGN_BASE = "https://proj.supabase.co/storage/v1/object/sign/receipts/"
PNG = b"\x89PNG\r\n\x1a\nfake-png-bytes"
PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


class FakeBucket:
    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.removed: list[str] = []
        self.fail_uploads = False

    def upload(self, path, data, options=None):
        if self.fail_uploads:
            raise RuntimeError("storage unavailable")
        self.files[path] = data
        return {"path": path}

    def create_signed_urls(self, paths, ttl):
        return [{"path": p, "signedURL": f"{SIGN_BASE}{p}?token=t"} for p in paths if p in self.files]

    def remove(self, paths):
        self.removed.extend(paths)


@pytest.fixture()
def env(monkeypatch):
    import app.api.v1.endpoints.petty_cash as endpoint_module

    monkeypatch.setattr(endpoint_module, "log_transaction", lambda *a, **kw: None)
    bucket = FakeBucket()
    monkeypatch.setattr(rs, "_bucket", lambda: bucket)
    # Storage "configured" for the upload endpoint; individual tests may override.
    monkeypatch.setattr(endpoint_module, "get_supabase_admin_client", lambda: object())
    # The fake Supabase host must pass the SSRF validator's DNS check without network.
    import socket
    import app.core.ssrf as ssrf

    monkeypatch.setattr(
        ssrf, "_resolve_hostname",
        lambda host, timeout=2.5: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("104.18.0.1", 0))],
    )

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()

    company = Company(company_name="MCT Kitchen", starting_balance=Decimal("0.00"))
    other = Company(company_name="Other Co", starting_balance=Decimal("0.00"))
    db.add_all([company, other])
    db.flush()
    db.add(PettyCashWallet(company_id=company.company_id, low_balance_threshold=Decimal("500.00")))
    db.commit()

    user_box = {
        "user": {
            "user_id": 1,
            "email": "supervisor@mct.test",
            "full_name": "Alex Supervisor",
            "role": "supervisor",
            "company_id": company.company_id,
            "company_name": company.company_name,
        }
    }

    app = FastAPI()
    app.include_router(petty_cash_router, prefix="/api/v1/petty-cash")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user_box["user"]

    yield {
        "client": TestClient(app),
        "db": db,
        "company": company,
        "other": other,
        "bucket": bucket,
        "user_box": user_box,
        "endpoint_module": endpoint_module,
    }

    app.dependency_overrides.clear()
    db.close()
    engine.dispose()


def _create_topup(client, company_id, **extra):
    payload = {
        "company_id": company_id,
        "amount": 1500.00,
        "topup_date": "2026-11-12",
        "description": "Receipt storage test",
        "request_type": "topup",
        **extra,
    }
    res = client.post("/api/v1/petty-cash/topups", json=payload)
    assert res.status_code == 201, res.text
    return res.json()["topup_id"]


def _stored_row(db, topup_id):
    db.expire_all()
    return db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == topup_id).one()


# ── POST /receipts (upload) ──────────────────────────────────────────────────

def test_upload_puts_file_in_bucket_and_returns_signed_url_and_path(env):
    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("or.png", PNG, "image/png")},
    )

    assert res.status_code == 200, res.text
    body = res.json()
    path = body["storage_path"]
    assert path.startswith("petty-cash/") and path.endswith(".png")
    assert env["bucket"].files[path] == PNG
    assert body["url"].startswith(SIGN_BASE)
    assert "base64" not in body["url"]
    assert body["file_size"] == len(PNG)
    assert body["mime_type"] == "image/png"


def test_upload_returns_502_instead_of_base64_when_bucket_upload_fails(env):
    env["bucket"].fail_uploads = True

    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("or.png", PNG, "image/png")},
    )

    assert res.status_code == 502
    assert "data:" not in res.text


def test_upload_falls_back_to_data_url_when_storage_is_not_configured(env, monkeypatch):
    monkeypatch.setattr(env["endpoint_module"], "get_supabase_admin_client", lambda: None)

    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("or.png", PNG, "image/png")},
    )

    assert res.status_code == 200
    assert res.json()["url"].startswith("data:image/png;base64,")
    assert res.json()["storage_path"] is None
    assert env["bucket"].files == {}


def test_upload_rejects_unsupported_file_types(env):
    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )

    assert res.status_code == 400
    assert env["bucket"].files == {}


def test_upload_rejects_svg_images(env):
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("receipt.svg", svg, "image/svg+xml")},
    )

    assert res.status_code == 400
    assert env["bucket"].files == {}


def test_upload_rejects_files_over_5mb(env):
    big = b"0" * (5 * 1024 * 1024 + 1)

    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("big.pdf", big, "application/pdf")},
    )

    assert res.status_code == 400
    assert env["bucket"].files == {}


def test_upload_infers_mime_from_extension_for_generic_content_type(env):
    res = env["client"].post(
        "/api/v1/petty-cash/receipts",
        files={"file": ("scan.pdf", b"%PDF-1.4", "application/octet-stream")},
    )

    assert res.status_code == 200, res.text
    assert res.json()["mime_type"] == "application/pdf"
    assert res.json()["storage_path"].endswith(".pdf")


# ── Create / update store only paths ─────────────────────────────────────────

def test_create_with_signed_url_attachment_stores_path_not_url(env):
    upload = env["client"].post("/api/v1/petty-cash/receipts", files={"file": ("or.png", PNG, "image/png")}).json()
    attachments = json.dumps([{"file_url": upload["url"], "file_name": "or.png", "file_size": len(PNG)}])

    topup_id = _create_topup(env["client"], env["company"].company_id, attachments=attachments, receipt_url=upload["url"])

    row = _stored_row(env["db"], topup_id)
    stored = json.loads(row.attachments)
    assert stored == [{"file_name": "or.png", "file_size": len(PNG), "storage_path": upload["storage_path"]}]
    assert row.receipt_url == rs.storage_ref(upload["storage_path"])
    assert len(env["bucket"].files) == 1, "re-saving a signed URL must not upload again"


def test_create_with_legacy_data_url_moves_bytes_into_bucket(env):
    attachments = json.dumps([{"file_url": PNG_DATA_URL, "file_name": "or.png"}])

    topup_id = _create_topup(env["client"], env["company"].company_id, attachments=attachments)

    row = _stored_row(env["db"], topup_id)
    assert "data:" not in (row.attachments or "")
    assert "data:" not in (row.receipt_url or "")
    path = json.loads(row.attachments)[0]["storage_path"]
    assert env["bucket"].files[path] == PNG
    assert row.receipt_url == rs.storage_ref(path)


def test_create_keeps_inline_copy_when_bucket_is_down_so_receipt_is_not_lost(env):
    env["bucket"].fail_uploads = True
    attachments = json.dumps([{"file_url": PNG_DATA_URL, "file_name": "or.png"}])

    topup_id = _create_topup(env["client"], env["company"].company_id, attachments=attachments)

    row = _stored_row(env["db"], topup_id)
    assert json.loads(row.attachments)[0]["file_url"] == PNG_DATA_URL


def test_create_without_receipts_stores_nothing(env):
    topup_id = _create_topup(env["client"], env["company"].company_id)

    row = _stored_row(env["db"], topup_id)
    assert row.attachments is None
    assert row.receipt_url is None
    assert env["bucket"].files == {}


def test_update_normalizes_new_attachments_to_paths(env):
    topup_id = _create_topup(env["client"], env["company"].company_id)
    attachments = json.dumps([{"file_url": PNG_DATA_URL, "file_name": "new.png"}])

    res = env["client"].put(f"/api/v1/petty-cash/topups/{topup_id}", json={"attachments": attachments})

    assert res.status_code == 200, res.text
    row = _stored_row(env["db"], topup_id)
    item = json.loads(row.attachments)[0]
    assert "file_url" not in item
    assert env["bucket"].files[item["storage_path"]] == PNG


# ── Reading receipts back ────────────────────────────────────────────────────

def test_receipts_endpoint_returns_fresh_signed_urls(env):
    topup_id = _create_topup(
        env["client"], env["company"].company_id,
        attachments=json.dumps([{"file_url": PNG_DATA_URL, "file_name": "or.png"}]),
    )

    res = env["client"].get(f"/api/v1/petty-cash/topups/{topup_id}/receipts")

    assert res.status_code == 200, res.text
    body = res.json()
    item = json.loads(body["attachments"])[0]
    assert item["file_url"].startswith(SIGN_BASE)
    assert item["file_name"] == "or.png"
    assert body["receipt_url"].startswith(SIGN_BASE)


def test_receipts_endpoint_still_serves_legacy_inline_rows(env):
    db = env["db"]
    legacy = PettyCashTopUp(
        company_id=env["company"].company_id, amount=Decimal("100"), topup_date=__import__("datetime").date(2026, 1, 5),
        status="Pending Finance Endorsement", request_type="topup",
        attachments=json.dumps([{"file_url": PNG_DATA_URL, "file_name": "old.png"}]),
    )
    db.add(legacy)
    db.commit()

    res = env["client"].get(f"/api/v1/petty-cash/topups/{legacy.topup_id}/receipts")

    assert res.status_code == 200
    assert json.loads(res.json()["attachments"])[0]["file_url"] == PNG_DATA_URL


def test_receipts_endpoint_forbids_users_from_another_company(env):
    topup_id = _create_topup(
        env["client"], env["company"].company_id,
        attachments=json.dumps([{"file_url": PNG_DATA_URL, "file_name": "or.png"}]),
    )
    env["user_box"]["user"] = {
        **env["user_box"]["user"],
        "user_id": 2,
        "company_id": env["other"].company_id,
        "company_name": env["other"].company_name,
    }

    res = env["client"].get(f"/api/v1/petty-cash/topups/{topup_id}/receipts")

    assert res.status_code == 403
    assert SIGN_BASE not in res.text


def test_ledger_counts_storage_backed_receipts(env):
    _create_topup(
        env["client"], env["company"].company_id,
        attachments=json.dumps([
            {"file_url": PNG_DATA_URL, "file_name": "a.png"},
            {"file_url": PNG_DATA_URL, "file_name": "b.png"},
        ]),
    )

    res = env["client"].get("/api/v1/petty-cash/ledger", params={"company_id": env["company"].company_id})

    assert res.status_code == 200, res.text
    topup_entries = [e for e in res.json() if e.get("attachment_count")]
    assert topup_entries, res.json()
    assert topup_entries[0]["has_receipt"] is True
    assert topup_entries[0]["attachment_count"] == 2


# ── Delete cleans up bucket files ───────────────────────────────────────────

def test_deleting_a_topup_removes_its_files_from_the_bucket(env):
    topup_id = _create_topup(
        env["client"], env["company"].company_id,
        attachments=json.dumps([{"file_url": PNG_DATA_URL, "file_name": "or.png"}]),
    )
    path = json.loads(_stored_row(env["db"], topup_id).attachments)[0]["storage_path"]

    res = env["client"].delete(f"/api/v1/petty-cash/topups/{topup_id}")

    assert res.status_code == 204
    assert path in env["bucket"].removed


# ── Schema validation of storage references ─────────────────────────────────

@pytest.mark.parametrize(
    "storage_path",
    ["../../etc/passwd", "petty-cash/../secrets.pdf", "other-folder/x.png", ""],
)
def test_create_rejects_unsafe_attachment_storage_paths(env, storage_path):
    payload = {
        "company_id": env["company"].company_id,
        "amount": 100,
        "topup_date": "2026-11-12",
        "request_type": "topup",
        "attachments": json.dumps([{"storage_path": storage_path, "file_name": "x"}]),
    }

    res = env["client"].post("/api/v1/petty-cash/topups", json=payload)

    assert res.status_code == 422


def test_create_rejects_storage_ref_receipt_url_outside_receipts_folder(env):
    payload = {
        "company_id": env["company"].company_id,
        "amount": 100,
        "topup_date": "2026-11-12",
        "request_type": "topup",
        "receipt_url": "storage://receipts/../user profiles/admin.png",
    }

    res = env["client"].post("/api/v1/petty-cash/topups", json=payload)

    assert res.status_code == 422


# ── Movements list (Transaction page) ───────────────────────────────────────

def test_movements_hydrate_receipts_with_one_batch_signing_call(env, monkeypatch):
    for name in ("a.png", "b.png"):
        _create_topup(
            env["client"], env["company"].company_id,
            attachments=json.dumps([{"file_url": PNG_DATA_URL, "file_name": name}]),
        )
    calls = []
    original = env["bucket"].create_signed_urls
    monkeypatch.setattr(env["bucket"], "create_signed_urls", lambda paths, ttl: calls.append(paths) or original(paths, ttl))

    res = env["client"].get("/api/v1/petty-cash/movements", params={"company_id": env["company"].company_id})

    assert res.status_code == 200, res.text
    with_receipts = [m for m in res.json() if m.get("attachments")]
    assert len(with_receipts) == 2
    for m in with_receipts:
        assert json.loads(m["attachments"])[0]["file_url"].startswith(SIGN_BASE)
        assert m["receipt_url"].startswith(SIGN_BASE)
    assert len(calls) == 1, "all movement receipts should be signed in a single batch"
