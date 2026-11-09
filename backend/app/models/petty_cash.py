from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.session import Base
from app.models.bank import BankAccount
from app.models.intercompany_transfer import IntercompanyTransfer


class PettyCashTopUp(Base):
    """Money moved from a company's sales cash into its petty cash wallet or reimbursed expense."""

    __tablename__ = "petty_cash_topups"

    topup_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount = Column(Numeric(15, 2), nullable=False)
    topup_date = Column(Date, nullable=False, index=True)
    reference_no = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    # Funding bank chosen by Finance at endorsement (spec 0012). Nullable: historical rows
    # and approvals with no funding bank move no money.
    bank_account_id = Column(String(100), nullable=True)
    status = Column(String(50), nullable=False, default="Pending Finance Endorsement")
    request_type = Column(String(50), nullable=False, default="topup", server_default="topup")
    paid_by = Column(String(150), nullable=True)
    total_expenses = Column(Numeric(15, 2), nullable=True)
    company_funded_amount = Column(Numeric(15, 2), nullable=True, default=0.00)
    employee_out_of_pocket = Column(Numeric(15, 2), nullable=True, default=0.00)
    reserved_amount = Column(Numeric(15, 2), nullable=True, default=0.00)
    amount_reimbursed = Column(Numeric(15, 2), nullable=False, default=0.00)
    existing_expense_id = Column(Integer, ForeignKey("expenses.expense_id", ondelete="SET NULL"), nullable=True)
    petty_cash_expense_id = Column(Integer, ForeignKey("expenses.expense_id", ondelete="SET NULL"), nullable=True)
    reimbursement_expense_id = Column(Integer, ForeignKey("expenses.expense_id", ondelete="SET NULL"), nullable=True)
    payment_method_option = Column(String(50), nullable=True)
    destination_bank_id = Column(String(100), ForeignKey("bank_accounts.id"), nullable=True)
    intercompany_transfer_id = Column(Integer, ForeignKey("intercompany_transfers.transfer_id", ondelete="SET NULL"), nullable=True)
    reimbursed_at = Column(DateTime(timezone=True), nullable=True)
    reimbursed_by = Column(String(150), nullable=True)
    transfer_received_at = Column(DateTime(timezone=True), nullable=True)
    transfer_received_by = Column(String(150), nullable=True)
    receipt_url = Column(Text, nullable=True)
    attachments = Column(Text, nullable=True)
    items = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    endorsed_by = Column(String(100), nullable=True)
    endorsed_at = Column(DateTime(timezone=True), nullable=True)
    finance_remark = Column(Text, nullable=True)
    remark = Column(Text, nullable=True)
    reviewed_by = Column(String(100), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company", backref="petty_cash_topups")
    destination_bank = relationship("BankAccount", foreign_keys=[destination_bank_id])
    intercompany_transfer = relationship("IntercompanyTransfer", foreign_keys=[intercompany_transfer_id])


class PettyCashWallet(Base):
    """Per-company petty cash settings. The balance itself is always computed."""

    __tablename__ = "petty_cash_wallets"

    wallet_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    balance = Column(Numeric(15, 2), nullable=True, default=0)
    low_balance_threshold = Column(Numeric(15, 2), nullable=False, default=1000)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PettyCashCategory(Base):
    """Company-specific petty cash category configured by users."""

    __tablename__ = "petty_cash_categories"

    category_id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_petty_cash_categories_company_name"),
    )

    company = relationship("Company", backref="petty_cash_categories")

