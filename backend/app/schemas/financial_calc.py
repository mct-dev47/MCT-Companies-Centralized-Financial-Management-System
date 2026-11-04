from pydantic import BaseModel
from typing import List, Optional
from datetime import date
from decimal import Decimal

class CompanyFinancialSummary(BaseModel):
    company_id: int
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    
    # 1. Income Statement (P&L)
    total_revenue: Decimal  # Total Sales
    total_expenses: Decimal
    total_expenses_paid: Decimal
    net_profit: Decimal  # total_revenue - total_expenses
    profit_margin_percentage: float  # (net_profit / total_revenue) * 100
    
    # 2. Cash Flow Statement
    cash_received_from_sales: Decimal
    other_cash_inflows: Decimal
    loans_received: Decimal
    total_cash_inflow: Decimal  # cash_received_from_sales + other_cash_inflows + loans_received
    
    expenses_paid: Decimal
    loan_repayments_made: Decimal
    other_cash_outflows: Decimal  # includes transfers_to_petty_cash
    transfers_to_petty_cash: Decimal = Decimal("0.00")  # sales cash moved into the petty cash wallet
    total_cash_outflow: Decimal  # expenses_paid + loan_repayments_made + other_cash_outflows
    
    net_cash_flow: Decimal  # total_cash_inflow - total_cash_outflow
    
    # 3. Debt & Loans
    total_loans_borrowed: Decimal
    total_loans_lent: Decimal
    total_loans_repaid: Decimal

class GroupFinancialSummary(BaseModel):
    total_group_revenue: Decimal  # Total Group Sales
    total_group_expenses: Decimal
    total_group_net_profit: Decimal  # Total Revenue - Total Expenses
    total_group_cash_inflow: Decimal
    total_group_cash_outflow: Decimal
    total_group_net_cash_flow: Decimal
    company_summaries: List[CompanyFinancialSummary] = []
