from datetime import date
from typing import Optional
from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.session import Base


class Bill(Base):
    __tablename__ = "bills"

    bill_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bill_name = Column(String(255), nullable=False)
    amount = Column(Numeric(15, 2), nullable=True, default=0.00)
    recurring = Column(String(50), nullable=False, default="monthly")
    due_date = Column(Date, nullable=False)
    due_date_reminder = Column(Integer, nullable=False, default=3)
    notes = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="unpaid")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    company = relationship("Company", backref="bills")

    payments = relationship(
        "BillPayment",
        back_populates="bill",
        cascade="all, delete-orphan",
        order_by="BillPayment.payment_date.desc(), BillPayment.bill_payment_id.desc()",
    )

    @property
    def category(self) -> Optional[str]:
        return getattr(self, "_category", None)

    @category.setter
    def category(self, val: Optional[str]) -> None:
        self._category = val

    @property
    def frequency(self) -> str:
        return self.recurring

    @frequency.setter
    def frequency(self, val: str) -> None:
        self.recurring = val

    @property
    def is_recurring(self) -> bool:
        return (self.recurring or "").lower() not in ("one-time", "once", "onetime", "one_time")

    @is_recurring.setter
    def is_recurring(self, val: bool) -> None:
        if not val:
            self.recurring = "one-time"

    def __init__(self, **kwargs):
        cat = kwargs.pop("category", None)
        freq = kwargs.pop("frequency", None)
        is_rec = kwargs.pop("is_recurring", None)
        if freq and "recurring" not in kwargs:
            kwargs["recurring"] = freq
        if is_rec is False and "recurring" not in kwargs:
            kwargs["recurring"] = "one-time"
        super().__init__(**kwargs)
        if cat is not None:
            self.category = cat


class BillPayment(Base):
    __tablename__ = "bill_payments"

    bill_payment_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    bill_id = Column(
        Integer,
        ForeignKey("bills.bill_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period_key = Column(String(20), nullable=False, index=True)
    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    billed_amount = Column(Numeric(15, 2), nullable=True)
    payment_method = Column(String(50), nullable=False)
    reference_no = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    bill = relationship("Bill", back_populates="payments")

    @property
    def company_id(self) -> Optional[int]:
        cid = getattr(self, "_company_id", None)
        if cid is not None:
            return cid
        return self.bill.company_id if self.bill else None

    @company_id.setter
    def company_id(self, val: Optional[int]) -> None:
        self._company_id = val

    @property
    def period_due_date(self) -> Optional[date]:
        return getattr(self, "_period_due_date", None)

    @period_due_date.setter
    def period_due_date(self, val: Optional[date]) -> None:
        self._period_due_date = val

    def __init__(self, **kwargs):
        cid = kwargs.pop("company_id", None)
        p_due = kwargs.pop("period_due_date", None)
        if p_due and not kwargs.get("period_key"):
            kwargs["period_key"] = p_due.strftime("%Y-%m-%d") if hasattr(p_due, "strftime") else str(p_due)
        elif not kwargs.get("period_key"):
            kwargs["period_key"] = "default"
        super().__init__(**kwargs)
        if cid is not None:
            self.company_id = cid
        if p_due is not None:
            self.period_due_date = p_due
