from sqlalchemy import Column, DateTime, Integer, Numeric, String
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
