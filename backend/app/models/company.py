from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class Company(Base):
    __tablename__ = "company"

    company_id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    company_name = Column(String(100), nullable=False)
    location = Column(String(100), nullable=True, default="Manila")
    contact_number = Column(String(11), nullable=True)
    phone = Column(String(8), nullable=True)
    starting_balance = Column(Numeric(15, 2), nullable=False)
    petty_cash = Column(Numeric(15, 2), nullable=True, default=0.0)
    logo_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    notification_settings = relationship(
        "CompanyNotificationSettings",
        uselist=False,
        back_populates="company",
        cascade="all, delete-orphan",
    )


class CompanyNotificationSettings(Base):
    __tablename__ = "company_notification_settings"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    transaction_alerts = Column(Boolean, nullable=False, default=True, server_default=text("TRUE"))
    loan_reminders = Column(Boolean, nullable=False, default=True, server_default=text("TRUE"))
    daily_summary = Column(Boolean, nullable=False, default=False, server_default=text("FALSE"))
    audit_alerts = Column(Boolean, nullable=False, default=True, server_default=text("TRUE"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    company = relationship("Company", back_populates="notification_settings")

