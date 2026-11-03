from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.session import Base


class PettyCashTopUp(Base):
    """Money moved from a company's sales cash into its petty cash wallet."""

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
    endorsed_by = Column(String(100), nullable=True)
    endorsed_at = Column(DateTime(timezone=True), nullable=True)
    finance_remark = Column(Text, nullable=True)
    remark = Column(Text, nullable=True)
    reviewed_by = Column(String(100), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company", backref="petty_cash_topups")


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
