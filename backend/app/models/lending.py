from sqlalchemy import Column, String, Text, Numeric, Date, DateTime, ForeignKey, Integer, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.session import Base


class Borrower(Base):
    """
    Dedicated table for micro-lending borrowers.
    Tracks borrower details, loan terms, and active repayment status.
    """
    __tablename__ = "borrowers"

    borrower_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    borrower_ref_no = Column(String(100), unique=True, nullable=True, index=True)
    borrower_name = Column(String(255), nullable=False, index=True)
    principal_amount = Column(Numeric(15, 2), nullable=False)
    interest_rate = Column(Numeric(5, 2), nullable=False, default=20.00)
    total_payable = Column(Numeric(15, 2), nullable=False)
    total_penalties = Column(Numeric(15, 2), nullable=False, default=0.00)
    amount_paid = Column(Numeric(15, 2), nullable=False, default=0.00)
    remaining_balance = Column(Numeric(15, 2), nullable=False, default=0.00)
    payment_frequency = Column(String(50), nullable=False, default="Daily")
    term_days = Column(Integer, nullable=False, default=40)
    date_borrowed = Column(Date, nullable=False, index=True)
    due_date = Column(Date, nullable=False, index=True)
    status = Column(String(50), nullable=False, default="Active")  # Active, Fully Paid, Delinquent
    audit_status = Column(String(20), nullable=False, default="Pending Audit", server_default="Pending Audit")
    audited_by = Column(String(100), nullable=True)
    audited_at = Column(DateTime(timezone=True), nullable=True)
    audit_remarks = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    # Bank the loan is released from (an Expense) and repayments are credited to (Sales) - spec 0045
    bank_account_id = Column(String(100), nullable=True)
    release_expense_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    transactions = relationship(
        "LendingTransaction",
        back_populates="borrower",
        cascade="all, delete-orphan",
        order_by="desc(LendingTransaction.payment_date), desc(LendingTransaction.created_at)",
    )


class LendingTransaction(Base):
    """
    Dedicated table for all lending transactions including repayments.
    """
    __tablename__ = "lending_transactions"

    transaction_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    borrower_id = Column(
        Integer,
        ForeignKey("borrowers.borrower_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    transaction_ref_no = Column(String(100), nullable=True, index=True)
    transaction_type = Column(String(50), nullable=False, default="Repayment")  # Repayment, Disbursement, Adjustment
    payment_date = Column(Date, nullable=False, index=True)
    due_date = Column(Date, nullable=True)
    cycle_index = Column(Integer, nullable=True)
    cycle_due_date = Column(Date, nullable=True)
    is_late = Column(Boolean, default=False)
    days_late = Column(Integer, default=0)
    amount = Column(Numeric(15, 2), nullable=False)
    penalty_portion = Column(Numeric(15, 2), default=0.00)
    remaining_balance = Column(Numeric(15, 2), nullable=True)
    payment_method = Column(String(50), nullable=False, default="Cash")  # Cash, GCash, Bank Transfer, Cheque
    reference_no = Column(String(100), nullable=True)
    status = Column(String(50), nullable=False, default="Completed")  # Completed, Pending, Advance Paid, Missed
    notes = Column(Text, nullable=True)
    recorded_by = Column(String(255), nullable=True)
    # The Sale this repayment created on the borrower's bank (spec 0045)
    sale_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    borrower = relationship("Borrower", back_populates="transactions")
