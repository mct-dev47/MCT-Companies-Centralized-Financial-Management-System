from __future__ import annotations

import argparse
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.invitation_dispatcher import cleanup_invitation_tables
from app.services.otp_service import otp_service
from app.services.rate_limiter import rate_limiter
from app.services.session_service import (
    cleanup_expired_revoked_tokens,
    cleanup_expired_user_sessions,
)

logger = logging.getLogger(__name__)

RETENTION_ADVISORY_LOCK_ID = 94827163
_local_purge_lock = threading.Lock()
_scheduler_started = False
_scheduler_lock = threading.Lock()


def _try_acquire_advisory_lock(
    db: Session,
    lock_id: int = RETENTION_ADVISORY_LOCK_ID,
) -> tuple[bool, bool, Any, Any]:
    """
    Attempts to acquire a PostgreSQL transaction-scoped advisory lock (`pg_try_advisory_xact_lock`)
    on a dedicated connection with an open transaction.
    Holding an open transaction ensures PgBouncer (port 6543 transaction pooling) pins the same
    physical backend connection for the life of the lock and guarantees automatic release when
    the transaction ends or disconnects, preventing leaked session locks.
    Returns (acquired, is_postgres, lock_conn, lock_tx).
    """
    bind = db.get_bind()
    dialect = getattr(getattr(bind, "dialect", None), "name", "")
    if dialect == "postgresql":
        lock_conn = bind.connect()
        lock_tx = lock_conn.begin()
        try:
            acquired = bool(
                lock_conn.execute(
                    text("SELECT pg_try_advisory_xact_lock(:lock_id)"),
                    {"lock_id": lock_id},
                ).scalar()
            )
            if not acquired:
                lock_tx.rollback()
                lock_conn.close()
                return False, True, None, None
            return True, True, lock_conn, lock_tx
        except Exception:
            try:
                lock_tx.rollback()
            except Exception:
                pass
            try:
                lock_conn.close()
            except Exception:
                pass
            raise
    return True, False, None, None


def _release_advisory_lock(lock_conn: Any, lock_tx: Any) -> None:
    try:
        if lock_tx is not None:
            lock_tx.commit()
    except Exception as exc:
        logger.warning("Failed committing advisory xact lock transaction: %s", exc)
    finally:
        try:
            if lock_conn is not None:
                lock_conn.close()
        except Exception:
            pass


def run_auth_retention_purge(
    session_factory: Callable[[], Session] = SessionLocal,
    batch_size: Optional[int] = None,
    now: Optional[datetime] = None,
    include_activity_logs: bool = False,
) -> dict[str, int]:
    """
    Executes batched data retention and sensitive-field scrubbing across all auth tables,
    guarded by an in-process lock and a PostgreSQL transaction-scoped advisory lock.
    """
    if not _local_purge_lock.acquire(blocking=False):
        logger.info("Skipping auth retention purge: local purge lock is already held.")
        return {"skipped_locked": 1}

    resolved_batch = (
        batch_size
        if batch_size is not None
        else getattr(settings, "RETENTION_PURGE_BATCH_SIZE", 1000)
    )
    resolved_now = now if now is not None else datetime.now(timezone.utc)
    if resolved_now.tzinfo is None:
        resolved_now = resolved_now.replace(tzinfo=timezone.utc)

    results: dict[str, int] = {
        "revoked_tokens": 0,
        "rate_limits": 0,
        "login_otp_challenges": 0,
        "invitation_outbox": 0,
        "user_invitations_scrubbed": 0,
        "user_sessions": 0,
    }

    db = session_factory()
    is_postgres = False
    pg_lock_acquired = False
    lock_conn = None
    lock_tx = None
    try:
        try:
            lock_res = _try_acquire_advisory_lock(db)
            if len(lock_res) == 4:
                pg_lock_acquired, is_postgres, lock_conn, lock_tx = lock_res
            else:
                pg_lock_acquired, is_postgres = lock_res[0], lock_res[1]
        except Exception as exc:
            logger.error("Failed acquiring advisory lock for retention purge: %s", exc)
            return {"error_lock": 1}

        if not pg_lock_acquired:
            logger.info(
                "Skipping auth retention purge: Postgres advisory lock %d is held by another worker.",
                RETENTION_ADVISORY_LOCK_ID,
            )
            return {"skipped_locked": 1}

        # 1. revoked_tokens
        try:
            results["revoked_tokens"] = cleanup_expired_revoked_tokens(
                db, batch_size=resolved_batch, now=resolved_now
            )
        except Exception as exc:
            logger.error("Retention purge failed for revoked_tokens: %s", exc)

        # 2. rate_limits
        try:
            results["rate_limits"] = rate_limiter.cleanup_expired_records(
                db,
                retention_days=settings.RATE_LIMITS_RETENTION_DAYS,
                batch_size=resolved_batch,
                now=resolved_now,
            )
        except Exception as exc:
            logger.error("Retention purge failed for rate_limits: %s", exc)

        # 3. login_otp_challenges
        try:
            results["login_otp_challenges"] = otp_service.cleanup_expired_challenges(
                db,
                retention_days=settings.OTP_CHALLENGES_RETENTION_DAYS,
                batch_size=resolved_batch,
                now=resolved_now,
            )
        except Exception as exc:
            logger.error("Retention purge failed for login_otp_challenges: %s", exc)

        # 4. invitation_outbox & user_invitations
        try:
            inv_res = cleanup_invitation_tables(
                db,
                retention_days=settings.INVITATION_OUTBOX_RETENTION_DAYS,
                batch_size=resolved_batch,
                now=resolved_now,
            )
            results["invitation_outbox"] = inv_res.get("invitation_outbox_deleted", 0)
            results["user_invitations_scrubbed"] = inv_res.get("user_invitations_scrubbed", 0)
        except Exception as exc:
            logger.error("Retention purge failed for invitation tables: %s", exc)

        # 5. user_sessions
        try:
            results["user_sessions"] = cleanup_expired_user_sessions(
                db, batch_size=resolved_batch, now=resolved_now
            )
        except Exception as exc:
            logger.error("Retention purge failed for user_sessions: %s", exc)

        # 6. activity_logs (optional batched local 180-day audit retention)
        if include_activity_logs:
            try:
                from app.services.activity_log_service import activity_log_service
                results["activity_logs"] = activity_log_service.cleanup_expired_logs_batched(
                    db,
                    retention_days=180,
                    batch_size=resolved_batch,
                    now=resolved_now,
                )
            except Exception as exc:
                logger.error("Retention purge failed for activity_logs: %s", exc)

        logger.info("Auth retention purge completed: %s", results)
        return results
    finally:
        if is_postgres and pg_lock_acquired:
            _release_advisory_lock(lock_conn, lock_tx)
        try:
            db.close()
        except Exception:
            pass
        _local_purge_lock.release()


def start_periodic_retention_scheduler(
    interval_seconds: Optional[int] = None,
    stop_event: Optional[threading.Event] = None,
) -> Optional[threading.Thread]:
    """
    Starts a single daemon background thread that runs run_auth_retention_purge()
    on startup and then every interval_seconds (default 6 hours).
    """
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started and stop_event is None:
            return None
        _scheduler_started = True

    resolved_interval = max(
        60,
        int(
            interval_seconds
            if interval_seconds is not None
            else getattr(settings, "RETENTION_PURGE_INTERVAL_SECONDS", 21600)
        ),
    )
    ev = stop_event or threading.Event()

    def _loop() -> None:
        while not ev.is_set():
            try:
                run_auth_retention_purge(include_activity_logs=False)
            except Exception as exc:
                logger.error("Periodic retention scheduler iteration failed: %s", exc)
            if ev.wait(timeout=resolved_interval):
                break

    thread = threading.Thread(
        target=_loop,
        daemon=True,
        name="auth-retention-scheduler",
    )
    thread.start()
    return thread


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="Run auth tables data retention purge.")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=getattr(settings, "RETENTION_PURGE_BATCH_SIZE", 1000),
        help="Batch size per delete iteration (default: 1000).",
    )
    parser.add_argument(
        "--include-activity-logs",
        action="store_true",
        help="Also purge local activity_logs rows older than 180 days in batches.",
    )
    args = parser.parse_args()
    run_auth_retention_purge(
        batch_size=args.batch_size,
        include_activity_logs=args.include_activity_logs,
    )


if __name__ == "__main__":
    main()
