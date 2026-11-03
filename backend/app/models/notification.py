from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, List, Optional

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base

# Dialect-agnostic JSON type (JSONB on PostgreSQL, JSON on SQLite)
JSONType = JSON().with_variant(JSONB, "postgresql")


class Notification(Base):
    __tablename__ = "notifications"

    notification_id = Column(String(160), primary_key=True)
    recipient_user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_id = Column(
        Integer, ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False, index=True
    )
    notification_type = Column(String(100), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    reference_type = Column(String(50), nullable=True)
    reference_id = Column(Integer, nullable=True)

    # Authoritative Read & Resolution Lifecycle
    read_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)

    extra_data = Column(JSONType, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # User & Company relationships
    recipient = relationship("User", foreign_keys=[recipient_user_id])
    company = relationship("Company", foreign_keys=[company_id])

    __table_args__ = (
        UniqueConstraint("notification_id", "recipient_user_id", name="uq_notification_recipient"),
        Index("idx_notifications_recipient_feed", "recipient_user_id", "created_at", "notification_id"),
        Index("idx_notifications_recipient_company", "recipient_user_id", "company_id", "created_at", "notification_id"),
        Index("idx_notifications_compound_cursor", "recipient_user_id", "created_at", "notification_id"),
    )

    @property
    def is_read(self) -> bool:
        """Derived property: single source of truth is read_at."""
        return self.read_at is not None

    def __repr__(self) -> str:
        return f"<Notification(id='{self.notification_id}', user={self.recipient_user_id}, read={self.is_read})>"


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"

    outbox_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    idempotency_key = Column(String(160), unique=True, nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    company_id = Column(
        Integer, ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Structured JSONB Recipient Targets
    target_roles = Column(JSONType, nullable=False, server_default=text("'[]'"))
    target_user_ids = Column(JSONType, nullable=False, server_default=text("'[]'"))

    payload = Column(JSONType, nullable=False)
    status = Column(String(20), nullable=False, default="PENDING", index=True)
    retry_count = Column(Integer, nullable=False, default=0)
    max_retries = Column(Integer, nullable=False, default=5)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)

    # Fencing-Token Lease Ownership
    claim_token = Column(String(64), nullable=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True)

    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_outbox_pending_poll", "status", "next_retry_at", "outbox_id"),
        Index("idx_outbox_lease_recovery", "status", "lease_expires_at", "outbox_id"),
    )

    def __repr__(self) -> str:
        return f"<NotificationOutbox(id={self.outbox_id}, event='{self.event_type}', status='{self.status}')>"

