from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import date
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.company import Company
from app.schemas.financial_calc import CompanyFinancialSummary, GroupFinancialSummary
from app.services.finance_service import FinanceService, quantize_currency
from decimal import Decimal

router = APIRouter()

@router.get("/company/{company_id}", response_model=CompanyFinancialSummary, summary="Calculate company financial summary & P&L")
def get_company_summary(
    company_id: int,
    start_date: Optional[date] = Query(None, description="Start date for calculation period"),
    end_date: Optional[date] = Query(None, description="End date for calculation period"),
    db: Session = Depends(get_db)
):
    service = FinanceService(db)
    return service.get_company_financial_summary(company_id, start_date, end_date)

@router.get("/group-summary", response_model=GroupFinancialSummary, summary="Calculate MCT Group-wide consolidated financial summary")
def get_group_summary(
    start_date: Optional[date] = Query(None, description="Start date for calculation period"),
    end_date: Optional[date] = Query(None, description="End date for calculation period"),
    db: Session = Depends(get_db)
):
    service = FinanceService(db)

    # Calculate for all registered companies dynamically
    company_summaries = []
    total_group_revenue = Decimal("0.00")
    total_group_expenses = Decimal("0.00")
    total_group_cash_inflow = Decimal("0.00")
    total_group_cash_outflow = Decimal("0.00")

    active_companies = db.query(Company.company_id).order_by(Company.company_id.asc()).all()
    for (cid,) in active_companies:
        summary = service.get_company_financial_summary(cid, start_date, end_date)
        company_summaries.append(summary)
        total_group_revenue += summary.total_revenue
        total_group_expenses += summary.total_expenses
        total_group_cash_inflow += summary.total_cash_inflow
        total_group_cash_outflow += summary.total_cash_outflow

    total_group_net_profit = quantize_currency(total_group_revenue - total_group_expenses)
    total_group_net_cash_flow = quantize_currency(total_group_cash_inflow - total_group_cash_outflow)

    return GroupFinancialSummary(
        total_group_revenue=quantize_currency(total_group_revenue),
        total_group_expenses=quantize_currency(total_group_expenses),
        total_group_net_profit=total_group_net_profit,
        total_group_cash_inflow=quantize_currency(total_group_cash_inflow),
        total_group_cash_outflow=quantize_currency(total_group_cash_outflow),
        total_group_net_cash_flow=total_group_net_cash_flow,
        company_summaries=company_summaries
    )
