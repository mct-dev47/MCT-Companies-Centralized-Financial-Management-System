from sqlalchemy import Column, Integer, String, Text, Date, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.session import Base


class DailyRemark(Base):
    """One operational remark for a whole day (spec 0041).

    Scoped to a company, a calendar date, and a kind ('sales' or 'expense').
    """

    __tablename__ = "daily_remarks"
    __table_args__ = (
        UniqueConstraint("company_id", "remark_date", "kind", name="uq_daily_remarks_company_date_kind"),
    )

    daily_remark_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(Integer, nullable=False, index=True)
    remark_date = Column(Date, nullable=False)
    kind = Column(String(20), nullable=False)
    remarks = Column(Text, nullable=False)
    updated_by = Column(String(150), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
