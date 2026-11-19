from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, Field


class DashboardMetricSummary(BaseModel):
    total_cash: float = Field(0.0, description="Total cash sales/deposits realized")
    total_expense: float = Field(0.0, description="Total cash expenses/withdrawals disbursed")
    net_income: float = Field(0.0, description="Total cash minus total expense")
    overdue_count: int = Field(0, description="Count of overdue records/flagged items")
    due_soon_count: int = Field(0, description="Count of pending/due soon records")
    petty_cash_balance: float = Field(0.0, description="Current petty cash balance")


class MonthlyProfitLossItem(BaseModel):
    key: str = Field(..., description="YYYY-MM")
    label: str = Field(..., description="e.g. Oct 2026")
    short_label: str = Field(..., description="e.g. Oct '26")
    income: float = 0.0
    expenses: float = 0.0
    profit: float = 0.0


class CategoryBreakdownItem(BaseModel):
    category: str
    amount: float
    percentage: float = 0.0
    color: Optional[str] = None


class DashboardTransactionOut(BaseModel):
    id: str
    ref_no: str
    cheque_no: Optional[str] = None
    date: str
    type: str
    company: str
    description: str
    amount: float = 0.0
    withdrawal: float = 0.0
    deposit: float = 0.0
    category: str = "Uncategorized"
    payment_method: Optional[str] = None
    status: str = "Paid"
    audit_status: str = "Pending Audit"
    sale_date: Optional[str] = None
    deposit_status: Optional[str] = None
    deposit_date: Optional[str] = None
    paid_amount: Optional[float] = None
    audited_by: Optional[str] = None
    audit_date: Optional[str] = None
    audit_notes: Optional[str] = None
    bank_account_id: Optional[str] = None
    created_at: Optional[str] = None


class DashboardSummaryResponse(BaseModel):
    company_name: str
    company_id: Optional[int] = None
    metrics: DashboardMetricSummary
    monthly_pnl: List[MonthlyProfitLossItem]
    income_categories: List[CategoryBreakdownItem]
    expense_categories: List[CategoryBreakdownItem]
    recent_transactions: List[DashboardTransactionOut]
