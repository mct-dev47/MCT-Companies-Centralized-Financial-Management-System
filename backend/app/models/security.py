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


class RateLimit(Base):
    __tablename__ = "rate_limits"

    key = Column(String(190), primary_key=True)
    rate_type = Column(String(50), nullable=False, index=True)
    identifier = Column(String(120), nullable=False, index=True)
    attempts = Column(Integer, default=0, nullable=False)
    window_start = Column(DateTime(timezone=True), nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True, index=True)
    last_attempt_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class LoginOtpChallenge(Base):
    __tablename__ = "login_otp_challenges"

    otp_id = Column(String(36), primary_key=True)
    challenge_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    email = Column(String(255), nullable=False, index=True)
    purpose = Column(String(50), default="login_2fa", nullable=False)
    ip_address = Column(String(45), nullable=False)
    otp_hmac = Column(String(64), nullable=False)
    status = Column(String(30), default="pending_delivery", nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=5, nullable=False)
    resend_count = Column(Integer, default=0, nullable=False)
    last_sent_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    invalidated_at = Column(DateTime(timezone=True), nullable=True)
    invalidation_reason = Column(String(100), nullable=True)
    delivery_outcome = Column(String(50), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

