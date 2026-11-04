from typing import Optional
from decimal import Decimal
from sqlalchemy import Column, Integer, String, Text, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.session import Base

class Loan(Base):
    __tablename__ = "loan"

    loan_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    borrower = Column(Integer, nullable=False, index=True)  # Company_ID of borrower
    lender = Column(Integer, nullable=True, index=True)    # Company_ID of lender, assigned by Finance upon approval
    loan_ref_no = Column(String(100), unique=True, nullable=True)
    bank_account_id = Column(String(100), nullable=True)
    principal_amount = Column(Numeric(15, 2), nullable=True)
    interest_rate = Column(Numeric(5, 2), default=0.00)
    interest_type = Column(String(50), default="simple")  # simple, compound
    loan_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="Pending Finance Endorsement")
    endorsed_by = Column(String(100), nullable=True)
    endorsed_at = Column(DateTime(timezone=True), nullable=True)
    finance_remark = Column(Text, nullable=True)
    audit_reviewed_by = Column(String(100), nullable=True)
    audit_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    audit_remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    repayments = relationship("LoanRepayment", back_populates="loan", cascade="all, delete-orphan")

    @property
    def amount(self) -> Optional[Decimal]:
        return self.principal_amount

    @amount.setter
    def amount(self, val: Optional[Decimal]) -> None:
        self.principal_amount = val

    @property
    def particulars(self) -> Optional[str]:
        return self.description

    @particulars.setter
    def particulars(self, val: Optional[str]) -> None:
        self.description = val

    @property
    def remaining_balance(self) -> Optional[Decimal]:
        return getattr(self, "_remaining_balance", None)

    @remaining_balance.setter
    def remaining_balance(self, val: Optional[Decimal]) -> None:
        self._remaining_balance = val

    def __init__(self, **kwargs):
        amt = kwargs.pop("amount", None)
        part = kwargs.pop("particulars", None)
        rem = kwargs.pop("remaining_balance", None)
        if amt is not None and "principal_amount" not in kwargs:
            kwargs["principal_amount"] = amt
        if part is not None and "description" not in kwargs:
            kwargs["description"] = part
        super().__init__(**kwargs)
        if rem is not None:
            self.remaining_balance = rem


class LoanRepayment(Base):
    __tablename__ = "loans_repayments"

    loan_repayment_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    loan_id = Column(Integer, ForeignKey("loan.loan_id", ondelete="CASCADE"), nullable=False, index=True)
    recorded_by = Column(Integer, nullable=True)
    payment_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    remaining_balance = Column(Numeric(15, 2), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    reference_no = Column(String(100), nullable=True)
    status = Column(String(50), default="completed")  # pending, completed, overdue
    received_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    loan = relationship("Loan", back_populates="repayments")

    @property
    def payment_method(self) -> Optional[str]:
        return getattr(self, "_payment_method", None)

    @payment_method.setter
    def payment_method(self, val: Optional[str]) -> None:
        self._payment_method = val

    def __init__(self, **kwargs):
        pm = kwargs.pop("payment_method", None)
        super().__init__(**kwargs)
        if pm is not None:
            self.payment_method = pm
