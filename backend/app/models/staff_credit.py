from sqlalchemy import Column, BigInteger, String, Text, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.session import Base

class StaffCredit(Base):
    __tablename__ = "staff_credits"

    staff_credit_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    company_id = Column(BigInteger, nullable=False, index=True)
    user_id = Column(BigInteger, nullable=False, index=True)
    amount = Column(Numeric(15, 2), nullable=False)
    credit_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    status = Column(String(50), default="active")  # active, partially_paid, fully_paid, defaulted
    purpose = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    repayments = relationship("StaffCreditRepayment", back_populates="staff_credit", cascade="all, delete-orphan")


class StaffCreditRepayment(Base):
    __tablename__ = "staff_credits_repayment"

    repayment_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    staff_credit_id = Column(BigInteger, ForeignKey("staff_credits.staff_credit_id", ondelete="CASCADE"), nullable=False, index=True)
    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    payment_method = Column(String(50), nullable=True)  # cash, salary_deduction, bank_transfer
    reference_no = Column(String(100), nullable=True)
    status = Column(String(50), default="completed")
    received_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff_credit = relationship("StaffCredit", back_populates="repayments")
