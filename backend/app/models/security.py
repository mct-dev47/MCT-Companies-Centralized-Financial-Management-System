from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime
from app.db.session import Base


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    token_hash = Column(String(64), primary_key=True, index=True)
    user_id = Column(Integer, nullable=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class LoginRateLimit(Base):
    __tablename__ = "login_rate_limits"

    ip_address = Column(String(45), primary_key=True, index=True)
    failed_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    last_attempt_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

