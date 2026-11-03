from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.websocket import ws_manager
from app.models.company import Company
from app.models.notification import Notification, NotificationOutbox
from app.models.user import User, UserCompany

logger = logging.getLogger(__name__)

DEFAULT_LEASE_DURATION_SEC = 60
VALID_ROLES = {"admin", "finance", "audit", "auditor", "supervisor", "company"}


def enqueue_notification_event(
    db: Session,
    event_type: str,
    company_id: int,
    target_roles: Optional[List[str]] = None,
    payload: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
    target_user_ids: Optional[List[int]] = None,
) -> NotificationOutbox:
    """
    Enqueues an event into notification_outbox within the active caller transaction.
    Guarantees that if caller transaction rolls back, this outbox event rolls back too.
    """
    if not company_id or company_id <= 0:
        raise ValueError("A valid company_id is required to enqueue a notification event.")

    cleaned_roles = [
        r.strip().lower() for r in (target_roles or []) if r and r.strip().lower() in VALID_ROLES
    ]
    cleaned_user_ids = [uid for uid in (target_user_ids or []) if isinstance(uid, int) and uid > 0]

    # Generate deterministic or random idempotency key if not supplied
    if not idempotency_key:
        ref_t = (payload or {}).get("ref_type", "gen")
        ref_i = (payload or {}).get("ref_id", 0)
        idempotency_key = f"{event_type}:{company_id}:{ref_t}:{ref_i}:{uuid.uuid4().hex[:8]}"

    now = datetime.now(timezone.utc)
    outbox_entry = NotificationOutbox(
        idempotency_key=idempotency_key,
        event_type=event_type,
        company_id=company_id,
        target_roles=cleaned_roles,
        target_user_ids=cleaned_user_ids,
        payload=payload or {},
        status="PENDING",
        created_at=now,
        updated_at=now,
    )
    db.add(outbox_entry)
    return outbox_entry


def claim_outbox_batch(session_factory: Callable[[], Session], batch_size: int = 50) -> List[Dict[str, Any]]:
    """
    Atomically claims pending or expired-lease outbox events using FOR UPDATE SKIP LOCKED.
    Assigns a unique claim_token (fencing token) to guarantee lease ownership.
    """
    now = datetime.now(timezone.utc)
    lease_until = now + timedelta(seconds=DEFAULT_LEASE_DURATION_SEC)
    claimed_records = []

    with session_factory() as db:
        try:
            # Explicit grouping:
            # (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= :now))
            # OR (status = 'PROCESSING' AND lease_expires_at < :now)
            stmt = (
                select(NotificationOutbox)
                .where(
                    or_(
                        and_(
                            NotificationOutbox.status == "PENDING",
                            or_(
                                NotificationOutbox.next_retry_at.is_(None),
                                NotificationOutbox.next_retry_at <= now,
                            ),
                        ),
                        and_(
                            NotificationOutbox.status == "PROCESSING",
                            NotificationOutbox.lease_expires_at < now,
                        ),
                    )
                )
                .order_by(NotificationOutbox.outbox_id.asc())
                .limit(batch_size)
            )
            # Use SKIP LOCKED if supported (PostgreSQL)
            try:
                stmt = stmt.with_for_update(skip_locked=True)
            except Exception:
                pass

            events = db.scalars(stmt).all()
            if not events:
                return []

            for ev in events:
                new_token = str(uuid.uuid4())
                ev.status = "PROCESSING"
                ev.claim_token = new_token
                ev.lease_expires_at = lease_until
                ev.updated_at = now
                claimed_records.append({
                    "outbox_id": ev.outbox_id,
                    "claim_token": new_token,
                    "event_type": ev.event_type,
                    "company_id": ev.company_id,
                    "target_roles": ev.target_roles or [],
                    "target_user_ids": ev.target_user_ids or [],
                    "payload": ev.payload or {},
                    "retry_count": ev.retry_count,
                    "max_retries": ev.max_retries,
                })

            db.commit()
            return claimed_records
        except Exception as exc:
            db.rollback()
            logger.error("Error claiming outbox batch: %s", exc)
            raise


def resolve_event_recipients(
    db: Session,
    company_id: int,
    target_roles: List[str],
    target_user_ids: List[int],
) -> Set[int]:
    """
    Resolves recipient user IDs based on validated roles and direct user targets.
    Enforces strict company isolation and returns deduplicated user IDs.
    """
    final_recipients: Set[int] = set()

    # 1. Role-based resolution
    cleaned_roles = [r.strip().lower() for r in target_roles if r.strip().lower() in VALID_ROLES]
    if cleaned_roles:
        # Multi-company privileged roles: admin, finance, audit, auditor
        multi_roles = [r for r in cleaned_roles if r in ("admin", "finance", "audit", "auditor")]
        if multi_roles:
            stmt_multi = select(User.user_id).where(
                or_(
                    User.is_admin.is_(True),
                    func.lower(User.role).in_(multi_roles),
                )
            )
            final_recipients.update(db.scalars(stmt_multi).all())

        # Company-assigned operational roles: supervisor, company
        single_roles = [r for r in cleaned_roles if r in ("supervisor", "company")]
        if single_roles:
            stmt_single = (
                select(User.user_id)
                .join(UserCompany, User.user_id == UserCompany.user_id)
                .where(
                    UserCompany.company_id == company_id,
                    func.lower(User.role).in_(single_roles),
                )
            )
            final_recipients.update(db.scalars(stmt_single).all())

            # Also check primary company_id on users table as fallback
            stmt_primary = (
                select(User.user_id)
                .where(
                    User.company_id == company_id,
                    func.lower(User.role).in_(single_roles),
                )
            )
            final_recipients.update(db.scalars(stmt_primary).all())

    # 2. Direct user targets
    if target_user_ids:
        for uid in target_user_ids:
            if isinstance(uid, int) and uid > 0:
                final_recipients.add(uid)

    return final_recipients


def renew_lease(
    db: Session,
    outbox_id: int,
    claim_token: str,
    extension_sec: int = DEFAULT_LEASE_DURATION_SEC,
) -> bool:
    """
    Extends the lease duration for a long-running event still being processed.
    Returns True if lease was successfully renewed, False if claim_token mismatch.
    """
    now = datetime.now(timezone.utc)
    res = db.execute(
        update(NotificationOutbox)
        .where(
            NotificationOutbox.outbox_id == outbox_id,
            NotificationOutbox.claim_token == claim_token,
            NotificationOutbox.status == "PROCESSING",
        )
        .values(
            lease_expires_at=now + timedelta(seconds=extension_sec),
            updated_at=now,
        )
    )
    db.commit()
    return (res.rowcount or 0) > 0


def complete_outbox_event(
    session_factory: Callable[[], Session],
    outbox_id: int,
    claim_token: str,
    notifications_to_insert: List[Notification],
) -> bool:
    """
    Atomically inserts recipient notifications and marks outbox COMPLETED.
    Fails safely if claim_token does not match (stale worker prevention).
    """
    now = datetime.now(timezone.utc)
    with session_factory() as db:
        try:
            # 1. Optimistic fencing check
            stmt_update = (
                update(NotificationOutbox)
                .where(
                    NotificationOutbox.outbox_id == outbox_id,
                    NotificationOutbox.claim_token == claim_token,
                    NotificationOutbox.status == "PROCESSING",
                )
                .values(
                    status="COMPLETED",
                    error_message=None,
                    updated_at=now,
                )
            )
            res = db.execute(stmt_update)
            if (res.rowcount or 0) == 0:
                logger.warning(
                    "Worker lost lease for outbox_id %d (claim_token mismatch). Aborting completion.",
                    outbox_id,
                )
                db.rollback()
                return False

            # 2. Idempotent insert of recipient notifications
            for notif in notifications_to_insert:
                # Check for existing to be compatible with both PostgreSQL and SQLite
                existing = db.scalar(
                    select(Notification.notification_id).where(
                        Notification.notification_id == notif.notification_id
                    )
                )
                if not existing:
                    db.add(notif)

            db.commit()
            return True
        except Exception as exc:
            db.rollback()
            logger.error("Failed completing outbox event %d: %s", outbox_id, exc)
            raise


def handle_event_failure(
    session_factory: Callable[[], Session],
    outbox_id: int,
    claim_token: str,
    retry_count: int,
    max_retries: int,
    exc: Exception,
):
    """
    Handles event failure with exponential backoff + jitter, or dead-letter routing.
    Verifies claim_token so stale workers cannot overwrite newer states.
    """
    now = datetime.now(timezone.utc)
    is_permanent = isinstance(exc, (ValueError, KeyError, IntegrityError))
    new_retry_count = retry_count + 1

    with session_factory() as db:
        try:
            if is_permanent or new_retry_count >= max_retries:
                # Move to DEAD_LETTER
                db.execute(
                    update(NotificationOutbox)
                    .where(
                        NotificationOutbox.outbox_id == outbox_id,
                        NotificationOutbox.claim_token == claim_token,
                    )
                    .values(
                        status="DEAD_LETTER",
                        retry_count=new_retry_count,
                        error_message=str(exc)[:1000],
                        updated_at=now,
                    )
                )
            else:
                # Exponential backoff with jitter: 2^retry * 1s + jitter (max 300s)
                delay_sec = min(300.0, (2.0 ** retry_count) + random.uniform(0.1, 0.5))
                next_retry = now + timedelta(seconds=delay_sec)
                db.execute(
                    update(NotificationOutbox)
                    .where(
                        NotificationOutbox.outbox_id == outbox_id,
                        NotificationOutbox.claim_token == claim_token,
                    )
                    .values(
                        status="PENDING",
                        retry_count=new_retry_count,
                        next_retry_at=next_retry,
                        error_message=str(exc)[:1000],
                        updated_at=now,
                    )
                )
            db.commit()
        except Exception as err:
            db.rollback()
            logger.error("Failed updating failure status for outbox_id %d: %s", outbox_id, err)


def process_single_outbox_event(
    session_factory: Callable[[], Session],
    event_data: Dict[str, Any],
) -> bool:
    """
    Executes a single claimed outbox event and sends scoped WebSocket broadcast post-commit.
    """
    outbox_id = event_data["outbox_id"]
    claim_token = event_data["claim_token"]
    event_type = event_data["event_type"]
    company_id = event_data["company_id"]
    target_roles = event_data.get("target_roles") or []
    target_user_ids = event_data.get("target_user_ids") or []
    payload = event_data.get("payload") or {}
    retry_count = event_data.get("retry_count", 0)
    max_retries = event_data.get("max_retries", 5)

    notifications_to_broadcast: List[Notification] = []

    try:
        # Resolve recipients
        with session_factory() as db:
            recipient_ids = resolve_event_recipients(
                db=db,
                company_id=company_id,
                target_roles=target_roles,
                target_user_ids=target_user_ids,
            )

        if not recipient_ids:
            logger.warning(
                "Outbox event %d has no matching recipients. Marking DEAD_LETTER to prevent broadcast.",
                outbox_id,
            )
            with session_factory() as db:
                db.execute(
                    update(NotificationOutbox)
                    .where(
                        NotificationOutbox.outbox_id == outbox_id,
                        NotificationOutbox.claim_token == claim_token,
                    )
                    .values(
                        status="DEAD_LETTER",
                        error_message="No valid recipients found for specified roles and company.",
                        updated_at=datetime.now(timezone.utc),
                    )
                )
                db.commit()
            return False

        now = datetime.now(timezone.utc)
        created_notifications: List[Notification] = []
        broadcast_items: List[Dict[str, Any]] = []

        ref_type = payload.get("ref_type")
        ref_id = payload.get("ref_id")
        title = payload.get("title", f"Notification: {event_type}")
        message = payload.get("message", "")
        extra_data = payload.get("extra_data")

        for uid in recipient_ids:
            notif_id = f"{event_type}-{ref_type or 'gen'}-{ref_id or 0}-{uid}"
            notif = Notification(
                notification_id=notif_id,
                recipient_user_id=uid,
                company_id=company_id,
                notification_type=event_type,
                title=title,
                message=message,
                reference_type=ref_type,
                reference_id=ref_id,
                read_at=None,
                resolved_at=None,
                expires_at=None,
                extra_data=extra_data,
                created_at=now,
            )
            created_notifications.append(notif)
            broadcast_items.append({
                "notification_id": notif_id,
                "notification_type": event_type,
                "title": title,
                "message": message,
                "company_id": company_id,
                "reference_type": ref_type,
                "reference_id": ref_id,
                "read_at": None,
                "is_read": False,
                "created_at": now.isoformat(),
                "recipient_user_id": uid,
            })

        # Complete event atomically
        success = complete_outbox_event(
            session_factory=session_factory,
            outbox_id=outbox_id,
            claim_token=claim_token,
            notifications_to_insert=created_notifications,
        )

        if not success:
            return False

    except Exception as exc:
        logger.exception("Error processing outbox event %d: %s", outbox_id, exc)
        handle_event_failure(
            session_factory=session_factory,
            outbox_id=outbox_id,
            claim_token=claim_token,
            retry_count=retry_count,
            max_retries=max_retries,
            exc=exc,
        )
        return False

    # Post-commit scoped WebSocket broadcast (outside DB transaction, using pure dicts)
    for item in broadcast_items:
        try:
            ws_manager.broadcast_sync({
                "type": "NOTIFICATION_RECEIVED",
                "notification": item,
                "recipient_user_id": item["recipient_user_id"],
                "company_id": item["company_id"],
            })
        except Exception as ws_err:
            logger.warning("Post-commit WS push failed for user %d: %s", item["recipient_user_id"], ws_err)

    return True


def process_outbox_batch(
    session_factory: Callable[[], Session],
    batch_size: int = 50,
) -> int:
    """
    Main worker entry point: claims and executes a batch of outbox events.
    """
    try:
        claimed = claim_outbox_batch(session_factory, batch_size=batch_size)
    except OperationalError as op_err:
        # Transient DB connection failure: do not crash, let caller retry
        logger.warning("Database unavailable during outbox claim: %s", op_err)
        return 0

    processed_count = 0
    for event_data in claimed:
        if process_single_outbox_event(session_factory, event_data):
            processed_count += 1

    return processed_count
