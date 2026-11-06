from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func
from app.db.session import Base


class CompanyParticular(Base):
    __tablename__ = "company_particulars"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    company_id = Column(Integer, ForeignKey("company.company_id", ondelete="CASCADE"), nullable=True, index=True)
    company_name = Column(String(100), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

