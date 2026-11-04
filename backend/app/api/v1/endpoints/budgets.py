from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import List, Optional
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.finance import Budget
from app.schemas.budget import BudgetCreate, BudgetOut, BudgetVarianceOut
from app.services.finance_service import FinanceService

router = APIRouter()

@router.get("", response_model=List[BudgetOut], summary="List budgets")
def get_budgets(
    company_id: Optional[int] = Query(None, description="Filter by Company ID"),
    category_id: Optional[int] = Query(None, description="Filter by Category ID"),
    db: Session = Depends(get_db)
):
    query = db.query(Budget)
    if company_id:
        query = query.filter(Budget.company_id == company_id)
    if category_id:
        query = query.filter(Budget.category_id == category_id)
    return query.all()

@router.post("", response_model=BudgetOut, status_code=status.HTTP_201_CREATED, summary="Create a new budget")
def create_budget(budget_in: BudgetCreate, db: Session = Depends(get_db)):
    budget = Budget(**budget_in.model_dump())
    db.add(budget)
    db.commit()
    db.refresh(budget)
    return budget

@router.get("/{budget_id}/variance", response_model=BudgetVarianceOut, summary="Get real-time budget variance and burn rate")
def get_budget_variance(budget_id: int, db: Session = Depends(get_db)):
    service = FinanceService(db)
    variance = service.get_budget_variance(budget_id)
    if not variance:
        raise HTTPException(status_code=404, detail="Budget not found")
    return variance
