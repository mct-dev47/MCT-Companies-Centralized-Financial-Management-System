"""
activity_logs.py
----------------
Admin-only REST endpoints for retrieving, managing, and purging activity logs.
All activity logs are retrieved directly from Supabase, backed by the
event-driven architecture and a 6-month data retention policy.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import AdminUser
from app.core.events import dispatch_activity_event
from app.db.session import get_db
from app.schemas.activity_log import (
    ActivityLogCreate,
    ActivityLogOut,
    PaginatedActivityLogs,
    RetentionPurgeResponse,
)
from app.services.activity_log_service import activity_log_service

router = APIRouter(prefix="/activity-logs", tags=["Activity Logs"])


@router.get("", response_model=List[ActivityLogOut], summary="List activity logs (Admin only)")
def list_activity_logs(
    _: AdminUser,
    search: Optional[str] = Query(None, description="Free-text search across company, user, action, module, target"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    module: Optional[str] = Query(None, description="Filter by module (e.g. Sales, Expense, Auth, Tenant)"),
    action_category: Optional[str] = Query(None, description="Filter by category (e.g. AUTH, TRANSACTION)"),
    start_date: Optional[date] = Query(None, description="Filter from date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Filter to date (inclusive)"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
) -> List[ActivityLogOut]:
    """
    Returns an enriched list of activity logs directly from Supabase.
    Accessible only to Central Administrator accounts.
    """
    logs, _ = activity_log_service.get_activity_logs(
        search=search,
        user_id=user_id,
        company_id=company_id,
        module=module,
        action_category=action_category,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
        db=db,
    )
    return logs


@router.get("/paginated", response_model=PaginatedActivityLogs, summary="Get paginated activity logs (Admin only)")
def get_paginated_activity_logs(
    _: AdminUser,
    search: Optional[str] = Query(None, description="Search query"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    module: Optional[str] = Query(None, description="Filter by module"),
    action_category: Optional[str] = Query(None, description="Filter by category"),
    start_date: Optional[date] = Query(None, description="From date"),
    end_date: Optional[date] = Query(None, description="To date"),
    limit: int = Query(25, ge=1, le=500, description="Page limit"),
    offset: int = Query(0, ge=0, description="Page offset"),
    db: Session = Depends(get_db),
) -> PaginatedActivityLogs:
    logs, total = activity_log_service.get_activity_logs(
        search=search,
        user_id=user_id,
        company_id=company_id,
        module=module,
        action_category=action_category,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
        db=db,
    )
    return PaginatedActivityLogs(
        items=logs,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{audit_log_id}", response_model=ActivityLogOut, summary="Get single activity log (Admin only)")
def get_activity_log(
    audit_log_id: int,
    _: AdminUser,
) -> ActivityLogOut:
    log = activity_log_service.get_activity_log_by_id(audit_log_id)
    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Activity log #{audit_log_id} not found",
        )
    return log


@router.post("", status_code=status.HTTP_202_ACCEPTED, summary="Record activity log via event dispatch")
def create_activity_log(
    payload: ActivityLogCreate,
    _: AdminUser,
) -> dict:
    """
    Record an activity log event. Dispatches through the EventBus asynchronously.
    """
    dispatch_activity_event(
        action=payload.action,
        action_category=payload.action_category,
        user_id=payload.user_id,
        company_id=payload.company_id,
        ip_address=payload.ip_address,
        details=payload.details,
    )
    return {"status": "accepted", "message": "Activity event dispatched for processing"}


@router.post(
    "/purge-expired",
    response_model=RetentionPurgeResponse,
    summary="Purge activity logs older than retention period (Admin only)",
)
def purge_expired_activity_logs(
    _: AdminUser,
    retention_days: int = Query(180, ge=1, description="Data retention window in days (default: 180 / 6 months)"),
) -> RetentionPurgeResponse:
    """
    Enforces the data retention policy. Purges logs older than retention_days
    from Supabase and local storage to prevent database bloat.
    """
    from datetime import datetime, timedelta, timezone

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    purged_count = activity_log_service.cleanup_expired_logs(retention_days=retention_days)

    return RetentionPurgeResponse(
        purged_count=purged_count,
        cutoff_date=cutoff.isoformat(),
        message=f"Successfully purged {purged_count} logs older than {retention_days} days.",
    )

