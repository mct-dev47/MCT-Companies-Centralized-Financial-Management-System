from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class IntercompanyTransfer(Base):
    """Tracks intercompany funding movements and liabilities resulting from cross company reimbursements."""

    __tablename__ = "intercompany_transfers"

    transfer_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    source_company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    destination_company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_bank_id = Column(String(100), ForeignKey("bank_accounts.id"), nullable=False)
    destination_bank_id = Column(String(100), ForeignKey("bank_accounts.id"), nullable=True)
    source_bank_tx_id = Column(String(100), ForeignKey("bank_transactions.id"), nullable=True)
    destination_bank_tx_id = Column(String(100), ForeignKey("bank_transactions.id"), nullable=True)
    reversal_bank_tx_id = Column(String(100), ForeignKey("bank_transactions.id"), nullable=True)
    repayment_source_bank_tx_id = Column(String(100), ForeignKey("bank_transactions.id"), nullable=True)
    repayment_destination_bank_tx_id = Column(String(100), ForeignKey("bank_transactions.id"), nullable=True)
    linked_topup_id = Column(
        Integer,
        ForeignKey("petty_cash_topups.topup_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    amount = Column(Numeric(15, 2), nullable=False)
    transfer_type = Column(String(50), nullable=False)
    reference_no = Column(String(100), nullable=False, unique=True, index=True)
    transfer_status = Column(
        String(50),
        nullable=False,
        default="NOT_APPLICABLE",
        server_default="NOT_APPLICABLE",
        index=True,
    )
    settlement_status = Column(
        String(50),
        nullable=False,
        default="UNSETTLED",
        server_default="UNSETTLED",
        index=True,
    )
    initiated_by = Column(String(150), nullable=False)
    initiated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    received_by = Column(String(150), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)
    settled_at = Column(DateTime(timezone=True), nullable=True)
    repaid_by = Column(String(150), nullable=True)
    notes = Column(Text, nullable=True)

    source_company = relationship("Company", foreign_keys=[source_company_id])
    destination_company = relationship("Company", foreign_keys=[destination_company_id])
    source_bank = relationship("BankAccount", foreign_keys=[source_bank_id])
    destination_bank = relationship("BankAccount", foreign_keys=[destination_bank_id])

