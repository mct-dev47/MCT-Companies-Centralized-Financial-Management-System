from sqlalchemy import Column, String, Text, Numeric, DateTime, ForeignKey, Integer
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.session import Base

class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id = Column(String(100), primary_key=True, index=True)
    bank_name = Column(String(255), nullable=False)
    account_name = Column(String(255), nullable=False)
    account_number = Column(String(100), nullable=False)
    company_name = Column(String(255), nullable=False, index=True)
    company_id = Column(Integer, nullable=True, index=True)
    card_label = Column(String(255), nullable=True)
    account_type = Column(String(50), nullable=False, default="Checking")
    branch = Column(String(255), nullable=True)
    starting_balance = Column(Numeric(15, 2), nullable=False, default=0.00)
    current_balance = Column(Numeric(15, 2), nullable=False, default=0.00)
    color_theme = Column(String(20), nullable=False, default="red")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    transactions = relationship(
        "BankTransaction",
        back_populates="account",
        cascade="all, delete-orphan",
        order_by="desc(BankTransaction.created_at)"
    )


class BankTransaction(Base):
    __tablename__ = "bank_transactions"

    id = Column(String(100), primary_key=True, index=True)
    bank_account_id = Column(String(100), ForeignKey("bank_accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_date = Column(String(50), nullable=False)
    cheque_no = Column(String(100), nullable=True)
    particulars = Column(Text, nullable=False)
    withdrawal = Column(Numeric(15, 2), nullable=True, default=0.00)
    deposit = Column(Numeric(15, 2), nullable=True, default=0.00)
    category = Column(String(100), nullable=False, default="Bank Transfer")
    net_amount = Column(Numeric(15, 2), nullable=False, default=0.00)
    # Links a bank entry to the sale it came from, so the bank can be reconciled with the sale.
    source_sale_id = Column(Integer, nullable=True, index=True)
    # Same for an expense (spec 0044): the bank holds only the PAID part of an expense, kept in step on every edit.
    source_expense_id = Column(Integer, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("BankAccount", back_populates="transactions")
