from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from datetime import date, datetime
from decimal import Decimal

class CashInflowBase(BaseModel):
    company_id: int
    transaction_date: date
    transaction_type: str = Field(..., description="e.g., Capital Injection, Grant, Investment, Misc")
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    reference_no: Optional[str] = None
    description: Optional[str] = None

class CashInflowCreate(CashInflowBase):
    pass

class CashInflowUpdate(BaseModel):
    transaction_date: Optional[date] = None
    transaction_type: Optional[str] = None
    amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    reference_no: Optional[str] = None
    description: Optional[str] = None

class CashInflowOut(CashInflowBase):
    cash_transaction_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
