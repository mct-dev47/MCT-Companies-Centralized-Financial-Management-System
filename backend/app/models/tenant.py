"""Tenant leases and their payments (spec 0017)."""
from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class TenantLease(Base):
    __tablename__ = "tenant_leases"

    lease_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_ref = Column(String(30), unique=True, nullable=False, index=True)
    company_id = Column(
        Integer,
        ForeignKey("company.company_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_name = Column(String(255), nullable=False)
    unit_name = Column(String(255), nullable=False)
    rent_amount = Column(Numeric(15, 2), nullable=False)
    contract_date = Column(Date, nullable=False)
    # The First Due Date when the lease repeats, the single due date otherwise.
    due_date = Column(Date, nullable=False)
    lease_end_date = Column(Date, nullable=True)
    repeat_mode = Column(String(20), nullable=False, default="None")
    penalty_rate = Column(Numeric(5, 2), nullable=True)
    total_amount_payable = Column(Numeric(15, 2), nullable=False)
    status = Column(String(20), nullable=False, default="Active")
    notes = Column(Text, nullable=True)
    audit_status = Column(String(20), nullable=False, default="Pending Audit")
    audited_by = Column(String(100), nullable=True)
    audited_at = Column(DateTime(timezone=True), nullable=True)
    audit_remarks = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    payments = relationship(
        "TenantLeasePayment",
        back_populates="lease",
        cascade="all, delete-orphan",
        order_by="TenantLeasePayment.payment_date.desc()",
    )

    @property
    def amount_paid(self):
        return getattr(self, "_amount_paid", 0.00)

    @amount_paid.setter
    def amount_paid(self, val):
        self._amount_paid = val

    @property
    def remaining_balance(self):
        return getattr(self, "_remaining_balance", None)

    @remaining_balance.setter
    def remaining_balance(self, val):
        self._remaining_balance = val

    def __init__(self, **kwargs):
        ap = kwargs.pop("amount_paid", None)
        rem = kwargs.pop("remaining_balance", None)
        super().__init__(**kwargs)
        if ap is not None:
            self.amount_paid = ap
        if rem is not None:
            self.remaining_balance = rem


class TenantLeasePayment(Base):
    __tablename__ = "tenant_lease_payments"

    payment_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    lease_id = Column(
        Integer,
        ForeignKey("tenant_leases.lease_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(15, 2), nullable=False, default=0)
    method = Column(String(50), nullable=True)
    reference_no = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(10), nullable=False, default="Paid")
    missed_reason = Column(Text, nullable=True)
    period_index = Column(Integer, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lease = relationship("TenantLease", back_populates="payments")
