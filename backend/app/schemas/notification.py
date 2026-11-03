from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    """
    A computed, stateless notification.

    notification_id is a deterministic string key built from the notification
    type and source record IDs (e.g. "LOAN_OVERDUE-borrower-42").  The
    frontend should use this key to track read/dismiss state locally
    (e.g. in localStorage) since nothing is persisted on the backend.
    """
    notification_id: str
    notification_type: str
    title: str
    message: str
    company_id: Optional[int] = None
    reference_type: Optional[str] = None   # "loan" | "loan_repayment"
    reference_id: Optional[int] = None
    is_read: bool = False                   # always False from the server
    created_at: Optional[datetime] = None
    due_date: Optional[str] = None
    amount: Optional[float] = None
    remaining_amount: Optional[float] = None
    paid_amount: Optional[float] = None

    model_config = ConfigDict(from_attributes=False, extra="allow")


class NotificationCountOut(BaseModel):
    unread_count: int
