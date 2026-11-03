from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, computed_field


class NotificationOut(BaseModel):
    """
    Unified notification schema with single-source-of-truth read state (read_at).
    Provides is_read as a computed boolean property for backward compatibility.
    """
    notification_id: str
    notification_type: str
    title: str
    message: str
    company_id: Optional[int] = None
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    read_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    extra_data: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    @computed_field
    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    model_config = ConfigDict(from_attributes=True)


class NotificationListResponse(BaseModel):
    """
    Compound cursor-paginated notification feed.
    """
    items: List[NotificationOut]
    next_cursor: Optional[str] = None
    has_more: bool = False
    total_unread: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class NotificationCountOut(BaseModel):
    unread_count: int


class NotificationOutboxOut(BaseModel):
    outbox_id: int
    idempotency_key: str
    event_type: str
    company_id: int
    target_roles: List[str] = []
    target_user_ids: List[int] = []
    status: str
    retry_count: int
    max_retries: int
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
