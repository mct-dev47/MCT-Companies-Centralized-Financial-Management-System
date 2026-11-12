from datetime import date
from typing import Optional
from sqlalchemy import Column, BigInteger, Integer, String, Text, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship, backref

from app.db.session import Base


class Receivable(Base):
    __tablename__ = "receivables"

    receivable_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_name = Column(String(255), nullable=False, index=True)
    customer_name = Column(String(255), nullable=False, index=True)
    customer_type = Column(String(50), nullable=False, default="External")  # 'Internal' or 'External'
    sale_id = Column(Integer, ForeignKey("sales.sales_id", ondelete="CASCADE"), nullable=True, index=True)
    sale_line_index = Column(Integer, nullable=True)
    expense_id = Column(Integer, ForeignKey("expenses.expense_id", ondelete="SET NULL"), nullable=True, index=True)
    transaction_date = Column(Date, nullable=False)
    items_summary = Column(Text, nullable=False)
    total_amount = Column(Numeric(15, 2), nullable=False)
    amount_paid = Column(Numeric(15, 2), nullable=False, default=0.00)
    balance = Column(Numeric(15, 2), nullable=False, default=0.00)
    payment_status = Column(String(50), nullable=False, default="Unpaid")  # 'Unpaid', 'Partial', 'Paid'
    notes = Column(Text, nullable=True)
    client_ref = Column(String(64), nullable=True, unique=True)  # offline queue dedupe (spec 0038)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    payments = relationship(
        "ReceivablePayment",
        back_populates="receivable",
        cascade="all, delete-orphan",
        order_by="desc(ReceivablePayment.payment_date), desc(ReceivablePayment.payment_id)",
    )
    sale = relationship("Sale", foreign_keys=[sale_id], backref=backref("receivables", cascade="all, delete", passive_deletes=True))
    expense = relationship("Expense", foreign_keys=[expense_id], backref="receivables")


class ReceivablePayment(Base):
    __tablename__ = "receivable_payments"

    payment_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    receivable_id = Column(
        BigInteger().with_variant(Integer, "sqlite"),
        ForeignKey("receivables.receivable_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    payment_method = Column(String(50), nullable=False)  # 'Cash', 'GCash', 'Bank Transfer', 'Payroll Deduction'
    bank_account_id = Column(
        String(100),
        ForeignKey("bank_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reference_no = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    received_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    receivable = relationship("Receivable", back_populates="payments")
    bank_account = relationship("BankAccount", foreign_keys=[bank_account_id], backref="receivable_payments")
