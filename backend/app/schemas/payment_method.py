from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class CompanyPaymentMethodBase(BaseModel):
    name: str = Field(..., min_length=1)
    company_name: Optional[str] = None
    company_id: Optional[int] = None


class CompanyPaymentMethodCreate(CompanyPaymentMethodBase):
    pass


class CompanyPaymentMethodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    company_name: Optional[str] = None
    company_id: Optional[int] = None
    created_at: Optional[datetime] = None
