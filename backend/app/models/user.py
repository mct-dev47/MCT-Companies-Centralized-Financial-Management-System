from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    company_id = Column(Integer, ForeignKey("company.company_id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False, index=True)
    role = Column(String(50), nullable=False, default="company")  # "admin", "audit", "finance", "supervisor", "company", "owner"
    photo_url = Column(String(500), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    is_admin = Column(Boolean, nullable=False, default=False)
    status = Column(String(30), nullable=False, default="ACTIVE", index=True)
    must_change_password = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user_companies = relationship("UserCompany", cascade="all, delete-orphan", lazy="joined", back_populates="user")

    def __repr__(self):
        return f"<User(id={self.user_id}, name='{self.name}', email='{self.email}', role='{self.role}')>"


class UserCompany(Base):
    __tablename__ = "user_companies"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    company_id = Column(Integer, ForeignKey("company.company_id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="user_companies")

