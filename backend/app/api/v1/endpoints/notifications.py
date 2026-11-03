"""
notifications.py
----------------
Fast, event-driven in-app notification endpoints with fail-closed authorization,
compound cursor pagination, single-source-of-truth read state, and administrative recovery.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.company_resolver import normalize_company_id, resolve_company
from app.core.dependencies import (
    AuthenticatedUser,
    CurrentUser,
    check_company_access,
    require_admin_user,
)
from app.db.session import SessionLocal, get_db
from app.models.notification import Notification, NotificationOutbox
from app.schemas.notification import (
    NotificationCountOut,
    NotificationListResponse,
    NotificationOut,
    NotificationOutboxOut,
)
from app.services.notification_dispatcher import process_outbox_batch
from app.services.notification_service import (
    NotificationService,
    prune_expired_notifications_batch,
    run_temporal_due_date_sweep,
)

router = APIRouter(tags=["Notifications"])

MULTI_COMPANY_ROLES = {"admin", "finance", "audit", "auditor"}


def _resolve_authorized_scope(
    db: Session,
    current_user: AuthenticatedUser,
    company_id_param: Optional[int],
    company_name_param: Optional[str],
) -> tuple[Optional[int], str, int]:
    """
    Fail-closed scope resolution using only the authenticated user's server-verified
    role and assigned company permissions. Client-supplied role parameters are discarded.
    Returns (resolved_company_id, effective_role, authenticated_user_id).
    """
    if not current_user or not current_user.get("user_id"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    user_id = int(current_user["user_id"])
    is_admin = bool(current_user.get("is_admin"))
    raw_role = str(current_user.get("role") or ("admin" if is_admin else "supervisor")).strip().lower()

    if is_admin:
        effective_role = "admin"
    elif raw_role in ("company", "company employee", ""):
        effective_role = "supervisor"
    else:
        effective_role = raw_role

    is_multi_company = is_admin or effective_role in MULTI_COMPANY_ROLES

    # Resolve explicit company filter if supplied by caller
    explicit_cid: Optional[int] = normalize_company_id(company_id_param) if company_id_param is not None else None
    clean_cname = (company_name_param or "").strip()
    if explicit_cid is None and clean_cname and clean_cname.lower() != "all companies":
        # Fail closed if an unknown company name is requested; never fall back to None (All Companies)
        try:
            comp = resolve_company(db, None, clean_cname)
            explicit_cid = comp.company_id
        except HTTPException:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.")

    if is_multi_company:
        resolved_cid = explicit_cid
    else:
        assigned_raw = current_user.get("company_ids") or []
        assigned_cids = [
            cid for cid in (normalize_company_id(c) for c in assigned_raw) if cid is not None
        ]
        primary_cid = normalize_company_id(current_user.get("company_id"))
        if primary_cid is not None and primary_cid not in assigned_cids:
            assigned_cids.insert(0, primary_cid)

        if not assigned_cids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Your account is not assigned to any company.",
            )

        if explicit_cid is not None:
            check_company_access(current_user, explicit_cid)
            resolved_cid = explicit_cid
        else:
            resolved_cid = assigned_cids[0]

    return resolved_cid, effective_role, user_id


@router.get(
    "",
    response_model=Union[List[NotificationOut], NotificationListResponse],
    summary="Get user notifications with compound cursor pagination or array fallback",
)
def get_notifications(
    current_user: CurrentUser,
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    cursor: Optional[str] = Query(None, description="Monotonic cursor ISO_DATETIME|ID"),
    direction: str = Query("before", pattern="^(before|after)$", description="Pagination direction"),
    notification_type: Optional[str] = Query(None, description="Filter by notification type"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    resolved_cid, effective_role, user_id = _resolve_authorized_scope(
        db=db,
        current_user=current_user,
        company_id_param=company_id,
        company_name_param=company_name,
    )
    svc = NotificationService(db)

    # If cursor is supplied, return compound cursor response object
    if cursor:
        return svc.get_notifications_feed(
            recipient_user_id=user_id,
            company_id=resolved_cid,
            cursor=cursor,
            direction=direction,
            notification_type=notification_type,
            limit=limit,
        )

    # Otherwise return list of notifications for direct backward compatibility
    feed = svc.get_notifications_feed(
        recipient_user_id=user_id,
        company_id=resolved_cid,
        notification_type=notification_type,
        limit=limit,
    )
    return feed.items


@router.get(
    "/feed",
    response_model=NotificationListResponse,
    summary="Get paginated notification feed with next_cursor and total_unread count",
)
def get_notifications_feed(
    current_user: CurrentUser,
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    direction: str = Query("before", pattern="^(before|after)$"),
    notification_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    resolved_cid, effective_role, user_id = _resolve_authorized_scope(
        db=db,
        current_user=current_user,
        company_id_param=company_id,
        company_name_param=company_name,
    )
    svc = NotificationService(db)
    return svc.get_notifications_feed(
        recipient_user_id=user_id,
        company_id=resolved_cid,
        cursor=cursor,
        direction=direction,
        notification_type=notification_type,
        limit=limit,
    )


@router.get(
    "/count",
    response_model=NotificationCountOut,
    summary="Get total unread notification count for authenticated user",
)
@router.get(
    "/unread-count",
    response_model=NotificationCountOut,
    include_in_schema=False,
)
@router.get(
    "/unread-count",
    response_model=NotificationCountOut,
    summary="Get unread notification count",
)
def notification_count(
    current_user: CurrentUser,
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    db: Session = Depends(get_db),
) -> NotificationCountOut:
    resolved_cid, effective_role, user_id = _resolve_authorized_scope(
        db=db,
        current_user=current_user,
        company_id_param=company_id,
        company_name_param=company_name,
    )
    svc = NotificationService(db)
    count = svc.get_unread_count(
        recipient_user_id=user_id,
        company_id=resolved_cid,
    )
    return NotificationCountOut(unread_count=count)


@router.post(
    "/{notification_id}/read",
    response_model=NotificationOut,
    summary="Mark a specific notification as read and establish 90-day retention",
)
def mark_read(
    notification_id: str,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> NotificationOut:
    if not current_user or not current_user.get("user_id"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    user_id = int(current_user["user_id"])
    svc = NotificationService(db)
    notif = svc.mark_as_read(notification_id=notification_id, recipient_user_id=user_id)
    if not notif:
        # Check if notification exists for another user to distinguish 404 from 403
        existing = db.query(Notification.notification_id).filter(
            Notification.notification_id == notification_id
        ).scalar()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Cannot modify another user's notification.",
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    return NotificationOut.model_validate(notif)


@router.post(
    "/mark-all-read",
    response_model=Dict[str, int],
    summary="Mark all unread notifications as read for current user and company scope",
)
def mark_all_read(
    current_user: CurrentUser,
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> Dict[str, int]:
    resolved_cid, effective_role, user_id = _resolve_authorized_scope(
        db=db,
        current_user=current_user,
        company_id_param=company_id,
        company_name_param=company_name,
    )
    svc = NotificationService(db)
    updated = svc.mark_all_as_read(recipient_user_id=user_id, company_id=resolved_cid)
    return {"updated_count": updated}


# ── Administrative & Background Worker Endpoints ──────────────────────────────

@router.post(
    "/admin/sweep-reminders",
    summary="Trigger periodic due-date reminder sweep (Admin only)",
)
def trigger_sweep_reminders(
    admin_user: AuthenticatedUser = Depends(require_admin_user),
):
    result = run_temporal_due_date_sweep(SessionLocal)
    return result


@router.post(
    "/admin/process-outbox",
    summary="Trigger processing of pending outbox events (Admin / Worker trigger)",
)
def trigger_process_outbox(
    admin_user: AuthenticatedUser = Depends(require_admin_user),
):
    processed = process_outbox_batch(SessionLocal, batch_size=50)
    return {"processed_count": processed}


@router.get(
    "/admin/outbox/dead-letter",
    response_model=List[NotificationOutboxOut],
    summary="Inspect dead-letter outbox queue (Admin only)",
)
def get_dead_letter_events(
    admin_user: AuthenticatedUser = Depends(require_admin_user),
    db: Session = Depends(get_db),
) -> List[NotificationOutboxOut]:
    events = (
        db.query(NotificationOutbox)
        .filter(NotificationOutbox.status == "DEAD_LETTER")
        .order_by(NotificationOutbox.updated_at.desc())
        .limit(100)
        .all()
    )
    return [NotificationOutboxOut.model_validate(e) for e in events]


@router.post(
    "/admin/outbox/retry-failed",
    summary="Retry dead-letter outbox events (Admin only)",
)
def retry_failed_outbox_events(
    admin_user: AuthenticatedUser = Depends(require_admin_user),
    db: Session = Depends(get_db),
):
    res = (
        db.query(NotificationOutbox)
        .filter(NotificationOutbox.status == "DEAD_LETTER")
        .update(
            {
                "status": "PENDING",
                "retry_count": 0,
                "error_message": None,
                "next_retry_at": None,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return {"requeued_count": res}


@router.post(
    "/admin/prune-expired",
    summary="Manually trigger monthly pruning of expired notifications (Admin only)",
)
def trigger_prune_expired(
    admin_user: AuthenticatedUser = Depends(require_admin_user),
):
    deleted = prune_expired_notifications_batch(SessionLocal, batch_size=1000)
    return {"deleted_count": deleted}
