from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from datetime import date, datetime
from decimal import Decimal

class BudgetBase(BaseModel):
    company_id: int
    category_id: int
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    period_type: str = Field(..., description="monthly, quarterly, yearly")
    start_date: date
    end_date: date
    description: Optional[str] = None

class BudgetCreate(BudgetBase):
    pass

class BudgetUpdate(BaseModel):
    category_id: Optional[int] = None
    amount: Optional[Decimal] = Field(None, gt=0, decimal_places=2)
    period_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None

class BudgetOut(BudgetBase):
    budget_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

class BudgetVarianceOut(BaseModel):
    budget_id: int
    company_id: int
    category_id: int
    allocated_budget: Decimal
    actual_spent: Decimal
    remaining_budget: Decimal
    utilization_percentage: float
    is_over_budget: bool
    start_date: date
    end_date: date
