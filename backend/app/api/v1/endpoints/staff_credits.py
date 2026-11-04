from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import List, Optional
from decimal import Decimal
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.staff_credit import StaffCredit, StaffCreditRepayment
from app.schemas.staff_credit import StaffCreditCreate, StaffCreditOut, StaffCreditRepaymentCreate, StaffCreditRepaymentOut, StaffCreditSummaryOut
from app.services.finance_service import FinanceService

router = APIRouter()

@router.get("", response_model=List[StaffCreditOut], summary="List staff credits")
def get_staff_credits(
    company_id: Optional[int] = Query(None, description="Filter by Company ID (MCT Kitchen)"),
    user_id: Optional[int] = Query(None, description="Filter by User ID"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status"),
    db: Session = Depends(get_db)
):
    query = db.query(StaffCredit)
    if company_id:
        query = query.filter(StaffCredit.company_id == company_id)
    if user_id:
        query = query.filter(StaffCredit.user_id == user_id)
    if status_filter:
        query = query.filter(StaffCredit.status == status_filter)
    return query.order_by(StaffCredit.credit_date.desc()).all()

@router.post("", response_model=StaffCreditOut, status_code=status.HTTP_201_CREATED, summary="Issue a staff credit")
def create_staff_credit(credit_in: StaffCreditCreate, db: Session = Depends(get_db)):
    credit = StaffCredit(**credit_in.model_dump())
    db.add(credit)
    db.commit()
    db.refresh(credit)
    return credit

@router.get("/{staff_credit_id}/summary", response_model=StaffCreditSummaryOut, summary="Get staff credit summary & repayment balance")
def get_staff_credit_summary(staff_credit_id: int, db: Session = Depends(get_db)):
    service = FinanceService(db)
    summary = service.get_staff_credit_summary(staff_credit_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Staff credit not found")
    return summary

@router.post("/{staff_credit_id}/repayments", response_model=StaffCreditRepaymentOut, status_code=status.HTTP_201_CREATED, summary="Record a staff credit repayment")
def create_staff_credit_repayment(staff_credit_id: int, repayment_in: StaffCreditRepaymentCreate, db: Session = Depends(get_db)):
    credit = db.query(StaffCredit).filter(StaffCredit.staff_credit_id == staff_credit_id).first()
    if not credit:
        raise HTTPException(status_code=404, detail="Staff credit not found")

    service = FinanceService(db)
    summary = service.get_staff_credit_summary(staff_credit_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Staff credit summary error")

    if repayment_in.amount > summary.remaining_balance:
        raise HTTPException(
            status_code=400,
            detail=f"Repayment amount ({repayment_in.amount}) exceeds remaining balance ({summary.remaining_balance})"
        )

    repayment_data = repayment_in.model_dump()
    repayment_data["staff_credit_id"] = staff_credit_id

    repayment = StaffCreditRepayment(**repayment_data)
    db.add(repayment)

    # Check if this settles the credit
    new_remaining = summary.remaining_balance - repayment_in.amount
    if new_remaining == Decimal("0.00"):
        credit.status = "fully_paid"
    else:
        credit.status = "partially_paid"

    db.commit()
    db.refresh(repayment)
    return repayment
