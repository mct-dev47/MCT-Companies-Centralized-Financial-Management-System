from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal

# --- Staff Credit Repayment ---
class StaffCreditRepaymentBase(BaseModel):
    staff_credit_id: int
    payment_date: date
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: Optional[str] = Field(default="salary_deduction", description="salary_deduction, cash, bank_transfer")
    reference_no: Optional[str] = None
    status: str = Field(default="completed")
    received_at: Optional[datetime] = None
    notes: Optional[str] = None

class StaffCreditRepaymentCreate(StaffCreditRepaymentBase):
    pass

class StaffCreditRepaymentOut(StaffCreditRepaymentBase):
    repayment_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# --- Staff Credit ---
class StaffCreditBase(BaseModel):
    company_id: int
    user_id: int
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    credit_date: date
    due_date: Optional[date] = None
    status: str = Field(default="active", description="active, partially_paid, fully_paid, defaulted")
    purpose: Optional[str] = None
    notes: Optional[str] = None

class StaffCreditCreate(StaffCreditBase):
    pass

class StaffCreditUpdate(BaseModel):
    due_date: Optional[date] = None
    status: Optional[str] = None
    purpose: Optional[str] = None
    notes: Optional[str] = None

class StaffCreditOut(StaffCreditBase):
    staff_credit_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class StaffCreditSummaryOut(BaseModel):
    staff_credit_id: int
    company_id: int
    user_id: int
    original_credit_amount: Decimal
    total_repaid_amount: Decimal
    remaining_balance: Decimal
    status: str
    credit_date: date
    due_date: Optional[date] = None
    repayments: List[StaffCreditRepaymentOut] = []
