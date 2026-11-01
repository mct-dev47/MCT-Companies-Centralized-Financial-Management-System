"""
notifications.py
----------------
In-app notification endpoints.

Notifications are stateless — computed on the fly from Bills, Lending,
Inter-company Loans, Tenant Leases, Petty Cash, and Audit Logs.
Read/dismiss state is managed on the frontend (localStorage keyed on notification_id).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.company_resolver import normalize_company_id, resolve_company
from app.core.dependencies import AuthenticatedUser, CurrentUser, check_company_access
from app.db.session import get_db
from app.schemas.notification import NotificationCountOut, NotificationOut
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"])

MULTI_COMPANY_ROLES = {"admin", "finance", "audit", "auditor"}


def _resolve_authorized_scope(
    db: Session,
    current_user: AuthenticatedUser,
    company_id_param: Optional[int],
    company_name_param: Optional[str],
) -> tuple[Optional[int], str, str]:
    """
    Fail-closed scope resolution using only the authenticated user's server-verified
    role and assigned company permissions. Never trusts client-supplied role parameters.
    Returns (resolved_company_id, effective_role, user_cache_scope).
    """
    if not current_user or (not current_user.get("auth_user_id") and not current_user.get("user_id") and not current_user.get("email")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

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
        comp = resolve_company(db, None, clean_cname)
        explicit_cid = comp.company_id

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

    user_ident = str(
        current_user.get("user_id")
        or current_user.get("auth_user_id")
        or current_user.get("email")
    )
    user_scope_key = f"u:{user_ident}:r:{effective_role}:c:{resolved_cid if resolved_cid is not None else 'all'}"
    return resolved_cid, effective_role, user_scope_key


@router.get(
    "",
    response_model=List[NotificationOut],
    summary="Get notifications (computed from bills, lending, loans, tenants, petty cash & audit logs)",
)
def get_notifications(
    current_user: CurrentUser,
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    notification_type: Optional[str] = Query(None, description="Filter by notification type"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> List[NotificationOut]:
    resolved_cid, effective_role, user_scope_key = _resolve_authorized_scope(
        db=db,
        current_user=current_user,
        company_id_param=company_id,
        company_name_param=company_name,
    )
    svc = NotificationService(db)
    return svc.get_notifications(
        company_id=resolved_cid,
        user_role=effective_role,
        user_scope_key=user_scope_key,
        notification_type=notification_type,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/count",
    response_model=NotificationCountOut,
    summary="Get total active notification count",
)
def notification_count(
    current_user: CurrentUser,
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    db: Session = Depends(get_db),
) -> NotificationCountOut:
    resolved_cid, effective_role, user_scope_key = _resolve_authorized_scope(
        db=db,
        current_user=current_user,
        company_id_param=company_id,
        company_name_param=company_name,
    )
    svc = NotificationService(db)
    count = svc.get_unread_count(
        company_id=resolved_cid,
        user_role=effective_role,
        user_scope_key=user_scope_key,
    )
    return NotificationCountOut(unread_count=count)
