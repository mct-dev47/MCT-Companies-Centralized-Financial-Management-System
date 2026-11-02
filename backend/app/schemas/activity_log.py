"""
activity_log.py
---------------
Pydantic schemas for Activity Logs, filters, and data retention responses.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field


class ActivityLogBase(BaseModel):
    action: str
    action_category: Optional[str] = None
    user_id: Optional[int] = None
    company_id: Optional[int] = None
    ip_address: Optional[str] = None
    details: Optional[Any] = None


class ActivityLogCreate(ActivityLogBase):
    pass


class ActivityLogOut(ActivityLogBase):
    audit_log_id: int
    created_at: Optional[str] = None

    # Worked out on the server for user-friendly display in Admin UI
    user_name: str = "System"
    company_name: str = "System"
    description: str = ""
    module: str = "General"
    target: str = "-"

    class Config:
        from_attributes = True


class PaginatedActivityLogs(BaseModel):
    items: List[ActivityLogOut]
    total: int
    limit: int
    offset: int


class RetentionPurgeResponse(BaseModel):
    purged_count: int = Field(..., description="Number of expired log entries deleted")
    cutoff_date: str = Field(..., description="ISO 8601 cutoff timestamp (older records deleted)")
    message: str = Field(..., description="Human-readable status summary")

