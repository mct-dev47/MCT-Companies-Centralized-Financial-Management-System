"""
receipt_storage.py
------------------
Petty cash receipt files live in the Supabase Storage bucket ``receipts``.

The database stores only a *storage reference* — never the file bytes:

  * attachments JSON items:  {"storage_path": "petty-cash/2026/11/<uuid>.pdf",
                              "file_name": ..., "file_size": ..., "mime_type": ...}
  * receipt_url column:      "storage://receipts/petty-cash/2026/11/<uuid>.pdf"

On the way **in** (create / update), ``normalize_*`` converts whatever the
client sent into storage references:
  - a signed URL previously handed out for this bucket  -> its path
  - a legacy base64 ``data:`` URL                        -> uploaded, then its path
  - anything else (external https URL)                   -> kept as-is

On the way **out**, ``hydrate_*`` turns storage references back into
short-lived signed URLs under ``file_url`` / ``receipt_url`` so the
frontend can keep rendering ``<img src>`` / ``<iframe src>`` unchanged.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional
from urllib.parse import unquote

from app.db.supabase import get_supabase_admin_client

logger = logging.getLogger(__name__)

RECEIPTS_BUCKET = "receipts"
PATH_PREFIX = "petty-cash/"
STORAGE_REF_PREFIX = f"storage://{RECEIPTS_BUCKET}/"
SIGNED_URL_TTL_SECONDS = 60 * 60  # 1 hour
MAX_RECEIPT_BYTES = 5 * 1024 * 1024

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "application/pdf",
}

_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "application/pdf": ".pdf",
}

_DATA_URL_RE = re.compile(r"^data:([\w.+/-]+);base64,(.*)$", re.IGNORECASE | re.DOTALL)
_SIGNED_URL_PATH_RE = re.compile(
    rf"/storage/v1/object/(?:sign|public|authenticated)/{RECEIPTS_BUCKET}/([^?#]+)"
)
_SAFE_PATH_RE = re.compile(r"^petty-cash/[A-Za-z0-9/_.-]+$")


class ReceiptStorageError(RuntimeError):
    pass


# ── Path helpers ─────────────────────────────────────────────────────────────

def is_safe_storage_path(path: Optional[str]) -> bool:
    return bool(path) and bool(_SAFE_PATH_RE.match(path)) and ".." not in path


def storage_ref(path: str) -> str:
    return f"{STORAGE_REF_PREFIX}{path}"


def path_from_ref(value: Optional[str]) -> Optional[str]:
    """Return the bucket path for a storage:// ref or a signed/public URL of our bucket."""
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    if v.startswith(STORAGE_REF_PREFIX):
        path = v[len(STORAGE_REF_PREFIX):]
    else:
        m = _SIGNED_URL_PATH_RE.search(v)
        if not m:
            return None
        path = unquote(m.group(1))
    return path if is_safe_storage_path(path) else None


def _new_path(mime_type: str, filename: Optional[str] = None) -> str:
    ext = _EXT_BY_MIME.get(mime_type)
    if not ext and filename and "." in filename:
        ext = "." + re.sub(r"[^a-z0-9]", "", filename.rsplit(".", 1)[-1].lower())[:5]
    if not ext:
        ext = mimetypes.guess_extension(mime_type) or ".bin"
    now = datetime.now(timezone.utc)
    return f"{PATH_PREFIX}{now:%Y/%m}/{uuid.uuid4().hex}{ext}"


# ── Storage I/O ──────────────────────────────────────────────────────────────

def _bucket():
    client = get_supabase_admin_client()
    if client is None:
        raise ReceiptStorageError("Supabase storage is not configured.")
    return client.storage.from_(RECEIPTS_BUCKET)


def upload_receipt_bytes(data: bytes, mime_type: str, filename: Optional[str] = None) -> str:
    """Upload bytes to the receipts bucket and return the storage path."""
    if len(data) > MAX_RECEIPT_BYTES:
        raise ReceiptStorageError("File size exceeds the 5 MB limit.")
    path = _new_path(mime_type, filename)
    try:
        _bucket().upload(
            path,
            data,
            {"content-type": mime_type, "upsert": "false", "cache-control": "3600"},
        )
    except ReceiptStorageError:
        raise
    except Exception as exc:  # network / API errors
        raise ReceiptStorageError(f"Could not upload receipt to storage: {exc}") from exc
    return path


def sign_paths(paths: Iterable[str]) -> dict[str, str]:
    """Batch-create signed URLs. Missing/failed paths are simply absent from the result."""
    unique = sorted({p for p in paths if is_safe_storage_path(p)})
    if not unique:
        return {}
    try:
        res = _bucket().create_signed_urls(unique, SIGNED_URL_TTL_SECONDS)
    except Exception as exc:
        logger.warning("Could not sign receipt URLs: %s", exc)
        return {}
    out: dict[str, str] = {}
    for item in res or []:
        if isinstance(item, dict) and item.get("path"):
            url = item.get("signedURL") or item.get("signedUrl")
            if url and not item.get("error"):
                out[item["path"]] = url
    return out


def delete_paths(paths: Iterable[str]) -> None:
    unique = [p for p in {*paths} if is_safe_storage_path(p)]
    if not unique:
        return
    try:
        _bucket().remove(unique)
    except Exception as exc:
        logger.warning("Could not delete receipt files %s: %s", unique, exc)


# ── Normalize (client input -> stored refs) ─────────────────────────────────

def _upload_data_url(data_url: str, filename: Optional[str]) -> Optional[str]:
    m = _DATA_URL_RE.match(data_url.strip())
    if not m:
        return None
    mime = m.group(1).lower()
    if mime not in ALLOWED_MIME_TYPES:
        return None
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", m.group(2)), validate=True)
    except (binascii.Error, ValueError):
        return None
    return upload_receipt_bytes(raw, mime, filename)


def _to_path(value: Optional[str], filename: Optional[str] = None) -> Optional[str]:
    """Resolve a client-supplied URL into a bucket path, uploading data URLs.

    Returns None when the value is not something we store in the bucket
    (e.g. an external https URL), or if a data-URL upload failed.
    """
    if not value or not isinstance(value, str):
        return None
    path = path_from_ref(value)
    if path:
        return path
    if value.strip().lower().startswith("data:"):
        try:
            return _upload_data_url(value, filename)
        except ReceiptStorageError as exc:
            # Never lose the user's receipt: caller keeps the data URL.
            logger.warning("Receipt data URL upload failed, keeping inline copy: %s", exc)
    return None


def normalize_attachments(attachments: Optional[str]) -> Optional[str]:
    """Rewrite attachments JSON so each item references the bucket instead of carrying bytes."""
    if not attachments or not attachments.strip():
        return attachments
    try:
        items = json.loads(attachments)
    except (TypeError, ValueError):
        return attachments
    if not isinstance(items, list):
        return attachments

    changed = False
    out = []
    for item in items:
        if not isinstance(item, dict):
            out.append(item)
            continue
        new_item = dict(item)
        existing = new_item.get("storage_path")
        if existing and is_safe_storage_path(existing):
            new_item.pop("file_url", None)
            new_item.pop("url", None)
        else:
            new_item.pop("storage_path", None)
            src = new_item.get("file_url") or new_item.get("url")
            path = _to_path(src, new_item.get("file_name") or new_item.get("filename"))
            if path:
                new_item["storage_path"] = path
                new_item.pop("file_url", None)
                new_item.pop("url", None)
        if new_item != item:
            changed = True
        out.append(new_item)
    return json.dumps(out) if changed else attachments


def normalize_receipt_url(receipt_url: Optional[str], attachments: Optional[str] = None) -> Optional[str]:
    """Store receipt_url as a storage:// ref when it points at (or carries) a bucket file.

    When the receipt is the same file as an attachment, reuse that attachment's
    path so we don't upload the same bytes twice.
    """
    if not receipt_url or not isinstance(receipt_url, str):
        return receipt_url
    path = path_from_ref(receipt_url)
    if not path and receipt_url.strip().lower().startswith("data:"):
        path = _first_attachment_path(attachments) or _to_path(receipt_url)
    return storage_ref(path) if path else receipt_url


def _first_attachment_path(attachments: Optional[str]) -> Optional[str]:
    try:
        items = json.loads(attachments or "")
    except (TypeError, ValueError):
        return None
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and is_safe_storage_path(item.get("storage_path")):
                return item["storage_path"]
    return None


def first_attachment_ref(attachments: Optional[str]) -> Optional[str]:
    path = _first_attachment_path(attachments)
    return storage_ref(path) if path else None


def collect_paths(receipt_url: Optional[str], attachments: Optional[str]) -> list[str]:
    paths: list[str] = []
    p = path_from_ref(receipt_url)
    if p:
        paths.append(p)
    try:
        items = json.loads(attachments or "")
    except (TypeError, ValueError):
        items = []
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and is_safe_storage_path(item.get("storage_path")):
                paths.append(item["storage_path"])
    return paths


# ── Hydrate (stored refs -> signed URLs for the client) ─────────────────────

def hydrate(
    receipt_url: Optional[str],
    attachments: Optional[str],
    signed: Optional[dict[str, str]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Return (receipt_url, attachments) with storage refs replaced by signed URLs.

    Pass a pre-computed ``signed`` map when hydrating many rows (batch signing).
    """
    if signed is None:
        signed = sign_paths(collect_paths(receipt_url, attachments))

    out_receipt = receipt_url
    rp = path_from_ref(receipt_url) if receipt_url and receipt_url.startswith(STORAGE_REF_PREFIX) else None
    if rp:
        out_receipt = signed.get(rp)

    out_atts = attachments
    try:
        items = json.loads(attachments or "")
    except (TypeError, ValueError):
        items = None
    if isinstance(items, list):
        changed = False
        for item in items:
            if isinstance(item, dict) and is_safe_storage_path(item.get("storage_path")):
                item["file_url"] = signed.get(item["storage_path"], "")
                changed = True
        if changed:
            out_atts = json.dumps(items)
    return out_receipt, out_atts
