"""
Petty cash receipts are stored in the Supabase "receipts" bucket; the DB keeps
only storage paths. These tests use a fake bucket so no network is touched.
"""
import base64
import json

import pytest

from app.services import receipt_storage as rs


class FakeBucket:
    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.removed: list[str] = []

    def upload(self, path, data, options=None):
        self.files[path] = data
        return {"path": path}

    def create_signed_urls(self, paths, ttl):
        return [
            {"path": p, "signedURL": f"https://proj.supabase.co/storage/v1/object/sign/receipts/{p}?token=t"}
            for p in paths
            if p in self.files
        ]

    def remove(self, paths):
        self.removed.extend(paths)


@pytest.fixture()
def bucket(monkeypatch):
    fake = FakeBucket()
    monkeypatch.setattr(rs, "_bucket", lambda: fake)
    return fake


PNG = b"\x89PNG\r\n\x1a\nfakepng"
PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


def test_data_url_attachment_is_uploaded_and_replaced_by_path(bucket):
    atts = json.dumps([{"file_url": PNG_DATA_URL, "file_name": "r.png", "file_size": len(PNG)}])
    stored = json.loads(rs.normalize_attachments(atts))

    assert "file_url" not in stored[0]
    path = stored[0]["storage_path"]
    assert path.startswith("petty-cash/") and path.endswith(".png")
    assert bucket.files[path] == PNG


def test_signed_url_is_converted_back_to_path_without_reupload(bucket):
    bucket.files["petty-cash/2026/11/abc.pdf"] = b"%PDF"
    signed = "https://proj.supabase.co/storage/v1/object/sign/receipts/petty-cash/2026/11/abc.pdf?token=xyz"
    stored = json.loads(rs.normalize_attachments(json.dumps([{"file_url": signed, "file_name": "a.pdf"}])))

    assert stored == [{"storage_path": "petty-cash/2026/11/abc.pdf", "file_name": "a.pdf"}]
    assert len(bucket.files) == 1


def test_receipt_url_reuses_attachment_path(bucket):
    atts = rs.normalize_attachments(json.dumps([{"file_url": PNG_DATA_URL, "file_name": "r.png"}]))
    ref = rs.normalize_receipt_url(PNG_DATA_URL, atts)

    assert ref.startswith(rs.STORAGE_REF_PREFIX)
    assert len(bucket.files) == 1, "receipt_url must not upload the same bytes twice"


def test_hydrate_returns_signed_urls(bucket):
    bucket.files["petty-cash/2026/11/abc.png"] = PNG
    receipt, atts = rs.hydrate(
        "storage://receipts/petty-cash/2026/11/abc.png",
        json.dumps([{"storage_path": "petty-cash/2026/11/abc.png", "file_name": "r.png"}]),
    )
    assert receipt.startswith("https://proj.supabase.co/storage/v1/object/sign/receipts/")
    assert json.loads(atts)[0]["file_url"] == receipt


def test_external_urls_and_unsafe_paths_are_left_alone(bucket):
    atts = json.dumps([{"file_url": "https://example.com/r.png"}])
    assert rs.normalize_attachments(atts) == atts
    assert rs.path_from_ref("storage://receipts/../secrets.txt") is None
    assert rs.path_from_ref("storage://receipts/other-folder/x.png") is None


def test_upload_failure_keeps_inline_copy(monkeypatch):
    def boom():
        raise rs.ReceiptStorageError("down")

    monkeypatch.setattr(rs, "_bucket", boom)
    atts = json.dumps([{"file_url": PNG_DATA_URL}])
    assert rs.normalize_attachments(atts) == atts


def test_collect_paths_for_cleanup(bucket):
    paths = rs.collect_paths(
        "storage://receipts/petty-cash/a.png",
        json.dumps([{"storage_path": "petty-cash/b.pdf"}, {"file_url": "https://example.com/x"}]),
    )
    assert sorted(paths) == ["petty-cash/a.png", "petty-cash/b.pdf"]


# ── Edge cases ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "bad_data_url",
    [
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",   # disallowed type (scriptable)
        "data:text/html;base64,PGgxPmhpPC9oMT4=",
        "data:image/png;base64,!!!not-base64!!!",
    ],
)
def test_unsafe_or_corrupt_data_urls_are_not_uploaded(bucket, bad_data_url):
    atts = json.dumps([{"file_url": bad_data_url}])

    assert rs.normalize_attachments(atts) == atts
    assert bucket.files == {}


def test_oversized_upload_is_rejected(bucket):
    with pytest.raises(rs.ReceiptStorageError):
        rs.upload_receipt_bytes(b"0" * (rs.MAX_RECEIPT_BYTES + 1), "image/png")
    assert bucket.files == {}


@pytest.mark.parametrize("value", [None, "", "   ", "not json", "{\"a\": 1}"])
def test_normalize_leaves_empty_or_non_list_attachments_unchanged(bucket, value):
    assert rs.normalize_attachments(value) == value


def test_normalize_is_idempotent(bucket):
    once = rs.normalize_attachments(json.dumps([{"file_url": PNG_DATA_URL, "file_name": "r.png"}]))
    twice = rs.normalize_attachments(once)

    assert twice == once
    assert len(bucket.files) == 1


def test_item_with_existing_storage_path_drops_stale_signed_url(bucket):
    item = {"storage_path": "petty-cash/2026/11/a.png", "file_url": "https://expired.example/x", "file_name": "a.png"}

    stored = json.loads(rs.normalize_attachments(json.dumps([item])))

    assert stored == [{"storage_path": "petty-cash/2026/11/a.png", "file_name": "a.png"}]


def test_signed_url_with_url_encoded_path_is_decoded(bucket):
    url = "https://proj.supabase.co/storage/v1/object/sign/receipts/petty-cash%2F2026%2F11%2Fa.png?token=t"

    assert rs.path_from_ref(url) == "petty-cash/2026/11/a.png"


def test_signed_url_for_another_bucket_is_not_treated_as_ours(bucket):
    url = "https://proj.supabase.co/storage/v1/object/sign/user%20profiles/petty-cash/a.png?token=t"

    assert rs.path_from_ref(url) is None


def test_external_receipt_url_is_kept_as_is(bucket):
    assert rs.normalize_receipt_url("https://example.com/r.png") == "https://example.com/r.png"


def test_sign_paths_returns_empty_map_when_storage_errors(monkeypatch):
    class Broken:
        def create_signed_urls(self, paths, ttl):
            raise RuntimeError("network down")

    monkeypatch.setattr(rs, "_bucket", lambda: Broken())

    assert rs.sign_paths(["petty-cash/a.png"]) == {}


def test_hydrate_blanks_url_when_file_is_missing_from_bucket(bucket):
    receipt, atts = rs.hydrate(
        "storage://receipts/petty-cash/gone.png",
        json.dumps([{"storage_path": "petty-cash/gone.png"}]),
    )

    assert receipt is None
    assert json.loads(atts)[0]["file_url"] == ""


def test_hydrate_leaves_legacy_and_external_values_untouched(bucket):
    legacy = json.dumps([{"file_url": PNG_DATA_URL}])

    receipt, atts = rs.hydrate("https://example.com/r.png", legacy)

    assert receipt == "https://example.com/r.png"
    assert atts == legacy


def test_delete_paths_skips_unsafe_paths(bucket):
    rs.delete_paths(["petty-cash/a.png", "../etc/passwd", "user profiles/x.png"])

    assert bucket.removed == ["petty-cash/a.png"]


def test_bucket_errors_when_supabase_is_not_configured(monkeypatch):
    monkeypatch.setattr(rs, "get_supabase_admin_client", lambda: None)

    with pytest.raises(rs.ReceiptStorageError):
        rs.upload_receipt_bytes(PNG, "image/png")
