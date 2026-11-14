from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, computed_field, model_validator


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
    due_date: Optional[str] = None
    amount: Optional[float] = None
    remaining_amount: Optional[float] = None
    paid_amount: Optional[float] = None

    @computed_field
    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    model_config = ConfigDict(from_attributes=True, extra="allow")


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


class CompanyNotificationSettingsUpdate(BaseModel):
    transaction_alerts: Optional[bool] = None
    loan_reminders: Optional[bool] = None
    daily_summary: Optional[bool] = None
    audit_alerts: Optional[bool] = None

    @model_validator(mode="before")
    @classmethod
    def _accept_camel_case_keys(cls, data: Any) -> Any:
        if isinstance(data, dict):
            normalized = dict(data)
            camel_map = {
                "transactionAlerts": "transaction_alerts",
                "loanReminders": "loan_reminders",
                "dailySummary": "daily_summary",
                "auditAlerts": "audit_alerts",
            }
            for camel_key, snake_key in camel_map.items():
                if camel_key in normalized and snake_key not in normalized:
                    normalized[snake_key] = normalized.pop(camel_key)
            return normalized
        return data

    model_config = ConfigDict(populate_by_name=True)


class CompanyNotificationSettingsOut(BaseModel):
    id: int
    company_id: int
    transaction_alerts: bool = True
    loan_reminders: bool = True
    daily_summary: bool = False
    audit_alerts: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @computed_field
    @property
    def companyId(self) -> int:
        return self.company_id

    @computed_field
    @property
    def transactionAlerts(self) -> bool:
        return self.transaction_alerts

    @computed_field
    @property
    def loanReminders(self) -> bool:
        return self.loan_reminders

    @computed_field
    @property
    def dailySummary(self) -> bool:
        return self.daily_summary

    @computed_field
    @property
    def auditAlerts(self) -> bool:
        return self.audit_alerts

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

