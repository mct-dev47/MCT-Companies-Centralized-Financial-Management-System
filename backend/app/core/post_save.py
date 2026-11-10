"""
Speed helpers for the sale / expense save path.

* `rest_and_orm_share_database()` tells whether the Supabase REST client and SQLAlchemy (DATABASE_URL)
  point at the SAME Supabase project. When they do, the "local backup" write after a REST insert is a
  second write of the same row to the same database, so callers skip it.
* `run_post_save()` runs work that does not affect the response (audit log, particulars library)
  after the request, on a small thread pool, so the user is not kept waiting for it. Each task opens
  its own database session. On SQLite (tests / local mode) it runs inline, so behaviour stays
  deterministic there.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any, Callable, Iterable, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="post-save")


@lru_cache(maxsize=1)
def rest_and_orm_share_database() -> bool:
    """True when DATABASE_URL is the same Supabase project as SUPABASE_URL (compares project refs only)."""
    try:
        from app.core.config import settings

        db = urlparse(settings.DATABASE_URL or "")
        if not (db.scheme or "").startswith("postgres"):
            return False
        user = db.username or ""
        db_ref = user.split(".", 1)[1] if "." in user else None
        if not db_ref and (db.hostname or "").startswith("db.") and (db.hostname or "").endswith(".supabase.co"):
            db_ref = (db.hostname or "").split(".")[1]  # direct connection: db.<ref>.supabase.co
        sb_host = urlparse(getattr(settings, "SUPABASE_URL", "") or "").hostname or ""
        sb_ref = sb_host.split(".")[0] if sb_host.endswith(".supabase.co") else None
        return bool(db_ref) and db_ref == sb_ref
    except Exception:
        return False


def _runs_inline() -> bool:
    try:
        from app.db.session import engine

        return engine.dialect.name == "sqlite"
    except Exception:
        return True


def _safe(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    try:
        fn(*args, **kwargs)
    except Exception:
        logger.exception("Post-save task %s failed", getattr(fn, "__name__", fn))


def run_post_save(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    """Run `fn` after the response (thread pool), or inline on SQLite. Never raises."""
    if _runs_inline():
        _safe(fn, *args, **kwargs)
        return
    try:
        _executor.submit(_safe, fn, *args, **kwargs)
    except RuntimeError:
        # Pool shut down (process exiting): do it now rather than drop it
        _safe(fn, *args, **kwargs)


def record_created_side_effects(
    *,
    company_id: int,
    company_name: str,
    particulars_text: str,
    particulars_type: str,
    audit_action: Any,
    user_id: Optional[int],
    ip_address: str,
    record_id: int,
    record_type: str,
    audit_extra: Optional[dict] = None,
    db: Any = None,
) -> None:
    """
    Save the record's particulars to the company library and write its audit log entry.
    Uses `db` when given (inline mode), otherwise opens its own session.
    """
    from app.api.v1.endpoints.particulars import extract_particular_names, save_company_particular_if_not_exists
    from app.services.audit_service import log_transaction

    def _do(session: Any) -> None:
        try:
            names: Iterable[str] = extract_particular_names(particulars_text or "")
            for p_name in names:
                save_company_particular_if_not_exists(session, company_id, company_name, p_name, particulars_type)
        except Exception:
            logger.warning("Could not save particulars for %s %s", record_type, record_id, exc_info=True)
        log_transaction(
            session,
            audit_action,
            user_id=user_id,
            company_id=company_id,
            ip_address=ip_address,
            record_id=record_id,
            record_type=record_type,
            extra=audit_extra,
        )

    if db is not None:
        _do(db)
        return
    from app.db.session import SessionLocal

    with SessionLocal() as session:
        _do(session)


def schedule_created_side_effects(db: Any, **kwargs: Any) -> None:
    """Inline (with the request session) on SQLite; otherwise after the response with a fresh session."""
    if _runs_inline():
        _safe(record_created_side_effects, db=db, **kwargs)
    else:
        run_post_save(record_created_side_effects, **kwargs)
