from sqlalchemy import Column, Integer, BigInteger, String, Text, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship, synonym
from app.db.session import Base

class Category(Base):
    __tablename__ = "category"

    category_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    sales = relationship("Sale", back_populates="category")
    expenses = relationship("Expense", back_populates="category")
    budgets = relationship("Budget", back_populates="category")


class CashInflow(Base):
    __tablename__ = "cash_inflow"

    cash_transaction_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(Integer, nullable=False, index=True)
    transaction_date = Column(Date, nullable=False)
    transaction_type = Column(String(100), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    reference_no = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Sale(Base):
    __tablename__ = "sales"

    sales_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(Integer, nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("category.category_id", ondelete="SET NULL"), nullable=True)
    payment_method = Column(String(100), nullable=True)  # e.g. GCash, Cash, Cheque, Bank Transfer, etc.
    payment_status = Column(String(50), nullable=False, default="Paid", server_default="Paid")
    deposit_status = Column(String(50), nullable=False, default="Not Deposited", server_default="Not Deposited")
    transaction_date = Column(Date, nullable=False)
    cheque_no = Column("cheque_number", String(100), nullable=True)
    cheque_number = synonym("cheque_no")
    amount = Column(Numeric(15, 2), nullable=False)
    particulars = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Audit review result (spec 0014): saved on the server so every account sees the same status.
    audit_status = Column(String(20), nullable=False, default="Pending Audit", server_default="Pending Audit")
    audited_by = Column(String(100), nullable=True)
    audited_at = Column(DateTime(timezone=True), nullable=True)
    audit_remarks = Column(Text, nullable=True)
    # Operational remarks (spec 0040): supervisor and finance notes
    remarks = Column(Text, nullable=True)
    client_ref = Column(String(64), nullable=True, unique=True)  # offline queue dedupe (spec 0038)
    # Bank account this sale is credited to (spec 0042)
    bank_account_id = Column(String(100), nullable=True, index=True)
    # Day the money reached the bank (spec 0043). transaction_date stays the day the sale happened.
    deposit_date = Column(Date, nullable=True)

    category = relationship("Category", back_populates="sales")



class Expense(Base):
    __tablename__ = "expenses"

    expense_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(Integer, nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("category.category_id", ondelete="SET NULL"), nullable=True)
    payment_method = Column(String(100), nullable=True)  # e.g. GCash, Cash, Petty Cash, Cheque, etc.
    created_by = Column(Integer, nullable=True)
    expense_date = Column(Date, nullable=False)
    reference_no = Column(String(100), nullable=True)
    cheque_no = Column("cheque_number", String(100), nullable=True)
    cheque_number = synonym("cheque_no")
    amount = Column(Numeric(15, 2), nullable=False)
    amount_paid = Column(Numeric(15, 2), default=0.00)
    description = Column(Text, nullable=True)
    particulars = synonym("description")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Audit review result (spec 0014): saved on the server so every account sees the same status.
    audit_status = Column(String(20), nullable=False, default="Pending Audit", server_default="Pending Audit")
    audited_by = Column(String(100), nullable=True)
    audited_at = Column(DateTime(timezone=True), nullable=True)
    audit_remarks = Column(Text, nullable=True)
    # Operational remarks (spec 0040): supervisor and finance notes
    remarks = Column(Text, nullable=True)
    client_ref = Column(String(64), nullable=True, unique=True)  # offline queue dedupe (spec 0038)
    # Bank account this expense is paid from (spec 0042)
    bank_account_id = Column(String(100), nullable=True, index=True)
    linked_topup_id = Column(Integer, ForeignKey("petty_cash_topups.topup_id", ondelete="SET NULL"), nullable=True, index=True)

    def __init__(self, **kwargs):
        if "particulars" in kwargs and "description" not in kwargs:
            kwargs["description"] = kwargs.pop("particulars")
        super().__init__(**kwargs)

    category = relationship("Category", back_populates="expenses")


class Budget(Base):
    __tablename__ = "budget"

    budget_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(Integer, nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("category.category_id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    period_type = Column(String(50), nullable=False)  # monthly, quarterly, yearly
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    category = relationship("Category", back_populates="budgets")

