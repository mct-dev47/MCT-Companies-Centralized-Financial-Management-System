from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CompanyParticularBase(BaseModel):
    name: str
    company_name: Optional[str] = None
    company_id: Optional[int] = None


class CompanyParticularCreate(CompanyParticularBase):
    pass


class CompanyParticularOut(BaseModel):
    id: int
    name: str
    company_name: Optional[str] = None
    company_id: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

