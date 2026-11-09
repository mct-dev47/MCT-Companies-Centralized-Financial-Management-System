from datetime import datetime, timezone
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    CheckConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base


class UserInvitation(Base):
    __tablename__ = "user_invitations"

    invitation_id = Column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    status = Column(String(20), nullable=False, default="PENDING", index=True)
    purpose = Column(
        String(30),
        nullable=False,
        default="initial_password_setup",
        server_default="initial_password_setup",
        index=True,
    )
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_by_user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'CLAIMED', 'ACCEPTED', 'EXPIRED', 'REVOKED')",
            name="chk_invitation_status",
        ),
        CheckConstraint(
            "purpose IN ('initial_password_setup', 'password_reset')",
            name="chk_invitation_purpose",
        ),
        Index("idx_user_invitations_token_status", "token_hash", "status"),
        Index("idx_user_invitations_user_purpose", "user_id", "purpose", "status"),
    )


class InvitationOutbox(Base):
    __tablename__ = "invitation_outbox"

    job_id = Column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    idempotency_key = Column(String(160), unique=True, nullable=False, index=True)
    user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    invitation_id = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("user_invitations.invitation_id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_email = Column(String(255), nullable=False)
    encrypted_payload = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="PENDING", index=True)
    retry_count = Column(Integer, nullable=False, default=0)
    max_retries = Column(Integer, nullable=False, default=5)
    next_retry_at = Column(DateTime(timezone=True), nullable=True, index=True)

    claim_token = Column(String(64), nullable=True, index=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True, index=True)

    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    invitation = relationship("UserInvitation", foreign_keys=[invitation_id])
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'CLAIMED', 'DISPATCHED_TO_PROVIDER', 'FAILED', 'DEAD_LETTER', 'CANCELLED')",
            name="chk_outbox_status",
        ),
        Index("idx_outbox_fetch", "status", "next_retry_at"),
        Index("idx_outbox_lease", "claim_token", "lease_expires_at"),
    )

