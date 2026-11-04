"""Request and response shapes for tenant leases (spec 0017)."""
from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# Money limits: finite numbers only, and nothing the numeric(15,2) columns cannot hold.
MAX_MONEY = 99_999_999_999.0

RepeatMode = Literal["None", "Daily", "Monthly", "Quarterly", "Annually"]
LeaseStatus = Literal["Active", "Completed", "Overdue", "Pending"]
PaymentStatus = Literal["Paid", "Missed"]


class LeaseCreate(BaseModel):
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    tenant_name: str = Field(..., min_length=1, max_length=255)
    unit_name: str = Field(..., min_length=1, max_length=255)
    rent_amount: float = Field(..., allow_inf_nan=False, le=MAX_MONEY)
    contract_date: date
    due_date: date
    lease_end_date: Optional[date] = None
    repeat_mode: RepeatMode = "None"
    penalty_rate: Optional[float] = Field(None, allow_inf_nan=False)
    total_amount_payable: Optional[float] = Field(None, allow_inf_nan=False, le=MAX_MONEY)
    status: LeaseStatus = "Active"
    notes: Optional[str] = Field(None, max_length=4000)


class LeaseUpdate(BaseModel):
    tenant_name: Optional[str] = Field(None, min_length=1, max_length=255)
    unit_name: Optional[str] = Field(None, min_length=1, max_length=255)
    rent_amount: Optional[float] = Field(None, allow_inf_nan=False, le=MAX_MONEY)
    contract_date: Optional[date] = None
    due_date: Optional[date] = None
    lease_end_date: Optional[date] = None
    repeat_mode: Optional[RepeatMode] = None
    penalty_rate: Optional[float] = Field(None, allow_inf_nan=False)
    total_amount_payable: Optional[float] = Field(None, allow_inf_nan=False, le=MAX_MONEY)
    status: Optional[LeaseStatus] = None
    notes: Optional[str] = Field(None, max_length=4000)
    # Sent as true to clear the penalty or end date (a plain null means "not provided").
    clear_penalty_rate: bool = False
    clear_lease_end_date: bool = False


class PaymentIn(BaseModel):
    payment_date: date
    amount: float = Field(0, allow_inf_nan=False, ge=0, le=MAX_MONEY)
    method: Optional[str] = Field(None, max_length=50)
    reference_no: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=4000)
    status: PaymentStatus = "Paid"
    missed_reason: Optional[str] = Field(None, max_length=1000)
    period_index: Optional[int] = Field(None, ge=0, le=100000)


class PaymentOut(BaseModel):
    payment_id: int
    lease_id: int
    payment_date: date
    amount: float
    method: Optional[str] = None
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    status: str
    missed_reason: Optional[str] = None
    period_index: Optional[int] = None
    created_by: Optional[int] = None
    created_at: Optional[str] = None


class LeaseOut(BaseModel):
    lease_id: int
    tenant_ref: str
    company_id: int
    company_name: Optional[str] = None
    tenant_name: str
    unit_name: str
    rent_amount: float
    contract_date: date
    due_date: date
    lease_end_date: Optional[date] = None
    repeat_mode: str
    penalty_rate: Optional[float] = None
    total_amount_payable: float
    status: str
    notes: Optional[str] = None
    amount_paid: float
    remaining_balance: float
    audit_status: str = "Pending Audit"
    audited_by: Optional[str] = None
    audited_at: Optional[str] = None
    audit_remarks: Optional[str] = None
    created_by: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    payments: List[PaymentOut] = []
