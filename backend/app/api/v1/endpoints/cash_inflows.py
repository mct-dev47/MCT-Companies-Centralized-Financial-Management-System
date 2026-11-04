from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import List, Optional
from datetime import date
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.finance import CashInflow
from app.schemas.cash_inflow import CashInflowCreate, CashInflowOut

router = APIRouter()

@router.get("", response_model=List[CashInflowOut], summary="List cash inflows")
def get_cash_inflows(
    company_id: Optional[int] = Query(None, description="Filter by Company ID"),
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    db: Session = Depends(get_db)
):
    query = db.query(CashInflow)
    if company_id:
        query = query.filter(CashInflow.company_id == company_id)
    if start_date:
        query = query.filter(CashInflow.transaction_date >= start_date)
    if end_date:
        query = query.filter(CashInflow.transaction_date <= end_date)
    return query.order_by(CashInflow.transaction_date.desc()).all()

@router.post("", response_model=CashInflowOut, status_code=status.HTTP_201_CREATED, summary="Record a cash inflow")
def create_cash_inflow(inflow_in: CashInflowCreate, db: Session = Depends(get_db)):
    inflow = CashInflow(**inflow_in.model_dump())
    db.add(inflow)
    db.commit()
    db.refresh(inflow)
    return inflow

@router.get("/{cash_transaction_id}", response_model=CashInflowOut, summary="Get cash inflow details")
def get_cash_inflow(cash_transaction_id: int, db: Session = Depends(get_db)):
    inflow = db.query(CashInflow).filter(CashInflow.cash_transaction_id == cash_transaction_id).first()
    if not inflow:
        raise HTTPException(status_code=404, detail="Cash inflow record not found")
    return inflow
