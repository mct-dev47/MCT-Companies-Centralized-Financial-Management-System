import json
from typing import Optional
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base

class AuditLog(Base):
    __tablename__ = 'audit_logs'

    audit_log_id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    company_id = Column(Integer, ForeignKey("company.company_id", ondelete="SET NULL"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    action = Column(String(255), nullable=False)
    # Category of the action (e.g. AUTH, TRANSACTION, USER, etc.)
    action_category = Column(String(50), nullable=True)
    # IP address of the user who performed the action
    ip_address = Column(String(45), nullable=True)
    # Optional extra context stored as plain text or JSON string
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def user_name(self) -> Optional[str]:
        return getattr(self, "_user_name", None)

    @user_name.setter
    def user_name(self, val: Optional[str]) -> None:
        self._user_name = val

    @property
    def user_role(self) -> Optional[str]:
        return getattr(self, "_user_role", None)

    @user_role.setter
    def user_role(self, val: Optional[str]) -> None:
        self._user_role = val

    @property
    def module(self) -> Optional[str]:
        return getattr(self, "_module", None)

    @module.setter
    def module(self, val: Optional[str]) -> None:
        self._module = val

    @property
    def timestamp(self) -> Optional[datetime]:
        return self.created_at

    @timestamp.setter
    def timestamp(self, val: Optional[datetime]) -> None:
        self.created_at = val

    def __init__(self, **kwargs):
        uname = kwargs.pop("user_name", None)
        urole = kwargs.pop("user_role", None)
        mod = kwargs.pop("module", None)
        ts = kwargs.pop("timestamp", None)
        if "details" in kwargs and isinstance(kwargs["details"], (dict, list)):
            kwargs["details"] = json.dumps(kwargs["details"])
        if ts is not None and kwargs.get("created_at") is None:
            kwargs["created_at"] = ts
        super().__init__(**kwargs)
        if uname is not None:
            self.user_name = uname
        if urole is not None:
            self.user_role = urole
        if mod is not None:
            self.module = mod
        if ts is not None:
            self.timestamp = ts
