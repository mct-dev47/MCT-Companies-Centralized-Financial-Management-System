from decimal import Decimal
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

class CompanyBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=100)
    contact_number: Optional[str] = Field(default=None, max_length=11)
    phone: Optional[str] = Field(default=None, max_length=8)
    starting_balance: Decimal = Field(decimal_places=2)
    petty_cash: Optional[Decimal] = Field(default=Decimal("0.00"), decimal_places=2)
    logo_url: Optional[str] = None

class CompanyCreate(CompanyBase):
    pass

class CompanyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    location: Optional[str] = Field(default=None, min_length=1, max_length=100)
    contact_number: Optional[str] = Field(default=None, max_length=11)
    phone: Optional[str] = Field(default=None, max_length=8)
    starting_balance: Optional[Decimal] = Field(default=None, decimal_places=2)
    petty_cash: Optional[Decimal] = Field(default=None, decimal_places=2)
    logo_url: Optional[str] = None

class CompanyOut(BaseModel):
    id: int
    name: str
    location: str
    contact_number: Optional[str] = None
    phone: Optional[str] = None
    starting_balance: float
    petty_cash: float = 0.0
    logo_url: Optional[str] = None
    total_revenue: float = 0.0
    total_expenses: float = 0.0
    net_profit: float = 0.0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class AuthorizedCompanyOut(BaseModel):
    id: int
    name: str
    location: str
    contact_number: Optional[str] = None
    phone: Optional[str] = None
    starting_balance: float = 0.0
    petty_cash: float = 0.0
    logo_url: Optional[str] = None
    role: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class CompanyLookupOut(BaseModel):
    company_id: int
    company_name: str
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    api_v1_path: str
