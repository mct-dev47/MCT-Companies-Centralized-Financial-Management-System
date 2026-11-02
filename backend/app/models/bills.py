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
