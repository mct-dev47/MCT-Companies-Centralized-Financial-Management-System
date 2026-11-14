from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class CategoryBase(BaseModel):
    name: str
    description: Optional[str] = None

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class CategoryOut(CategoryBase):
    category_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CompanyCategoryCreate(BaseModel):
    company_name: Optional[str] = None
    company_id: Optional[int] = None
    category_type: Optional[str] = None  # "sales" | "expense"
    name: str
    description: Optional[str] = None


class CompanyCategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class CompanyCategoryOut(BaseModel):
    category_id: int
    company_id: int
    company_name: Optional[str] = None
    category_type: str
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
