"""
audit_logs.py
-------------
Backward-compatible Admin endpoint for retrieving audit log entries.
Delegates to activity_log_service.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import AdminUser
from app.db.session import get_db
from app.schemas.activity_log import ActivityLogOut
from app.services.activity_log_service import activity_log_service

# Backward-compatible alias
AuditLogOut = ActivityLogOut

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("", response_model=List[ActivityLogOut], summary="List audit log entries (admin only)")
def list_audit_logs(
    _: AdminUser,
    search: Optional[str] = Query(None, description="Search text"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    company_id: Optional[int] = Query(None, description="Filter by company ID"),
    module: Optional[str] = Query(None, description="Filter by module"),
    action_category: Optional[str] = Query(None, description="Filter by category (e.g. AUTH, TRANSACTION)"),
    start_date: Optional[date] = Query(None, description="Filter from date (inclusive)"),
    end_date: Optional[date] = Query(None, description="Filter to date (inclusive)"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    db: Session = Depends(get_db),
) -> List[ActivityLogOut]:
    """
    Returns a paginated, filterable list of audit log entries directly from Supabase.
    Accessible only by central administrator accounts.
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
