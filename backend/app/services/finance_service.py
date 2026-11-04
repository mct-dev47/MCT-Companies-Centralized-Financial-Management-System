from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.finance import Sale, Expense, CashInflow, Budget
from app.models.loan import Loan, LoanRepayment
from app.schemas.financial_calc import CompanyFinancialSummary, GroupFinancialSummary
from app.schemas.budget import BudgetVarianceOut
from app.schemas.loan import LoanStatementOut, LoanRepaymentOut
from app.services.petty_cash_service import PETTY_CASH_METHOD, PettyCashService

def quantize_currency(value: Decimal | float | int) -> Decimal:
    """Helper to consistently round financial values to 2 decimal places."""
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

class FinanceCalculator:
    """
    Pure calculation engine providing exact business and accounting formulas.
    """

    @staticmethod
    def calculate_net_profit(total_revenue: Decimal, total_expenses: Decimal) -> Decimal:
        """
        Net Profit = Total Revenue - Total Expenses
        """
        return quantize_currency(total_revenue - total_expenses)

    @staticmethod
    def calculate_profit_margin(total_revenue: Decimal, net_profit: Decimal) -> float:
        """
        Profit Margin (%) = (Net Profit / Total Revenue) * 100
        """
        if total_revenue <= Decimal("0.00"):
            return 0.0
        margin = (net_profit / total_revenue) * Decimal("100.00")
        return float(round(margin, 2))

    @staticmethod
    def calculate_cash_flow(
        cash_received_from_sales: Decimal,
        other_cash_inflows: Decimal,
        loans_received: Decimal,
        expenses_paid: Decimal,
        loan_repayments: Decimal,
        other_cash_outflows: Decimal = Decimal("0.00")
    ) -> dict:
        """
        Total Cash Inflow = Cash Received from Sales + Other Cash Inflows + Loans Received
        Total Cash Outflow = Expenses Paid + Loan Repayments + Other Cash Outflows
        Net Cash Flow = Total Cash Inflow - Total Cash Outflow
        """
        total_inflow = quantize_currency(cash_received_from_sales + other_cash_inflows + loans_received)
        total_outflow = quantize_currency(expenses_paid + loan_repayments + other_cash_outflows)
        net_cash_flow = quantize_currency(total_inflow - total_outflow)
        return {
            "total_cash_inflow": total_inflow,
            "total_cash_outflow": total_outflow,
            "net_cash_flow": net_cash_flow
        }

    @staticmethod
    def calculate_loan_interest(principal: Decimal, interest_rate_percent: Decimal) -> Decimal:
        """
        Interest Amount = Principal * (Interest Rate / 100)
        """
        rate_decimal = interest_rate_percent / Decimal("100.00")
        return quantize_currency(principal * rate_decimal)

    @staticmethod
    def calculate_loan_total_payable(principal: Decimal, interest_amount: Decimal) -> Decimal:
        """
        Total Loan Payable = Principal + Interest Amount
        """
        return quantize_currency(principal + interest_amount)

    @staticmethod
    def calculate_loan_remaining_balance(total_loan_payable: Decimal, total_repayments: Decimal) -> Decimal:
        """
        Remaining Loan Balance = Total Loan Payable - Total Repayments
        """
        remaining = total_loan_payable - total_repayments
        return quantize_currency(max(Decimal("0.00"), remaining))

    @staticmethod
    def calculate_budget_variance(allocated_amount: Decimal, actual_spent: Decimal) -> dict:
        """
        Actual Spent = Total Expenses for category within selected period
        Remaining Budget = Allocated Budget - Actual Spent
        Budget Utilization (%) = (Actual Spent / Allocated Budget) * 100
        Over Budget = Yes if Actual Spent > Allocated Budget
        """
        allocated = quantize_currency(allocated_amount)
        spent = quantize_currency(actual_spent)
        remaining = quantize_currency(allocated - spent)
        utilization = (float(spent) / float(allocated) * 100.0) if allocated > 0 else 0.0
        return {
            "remaining_budget": remaining,
            "utilization_percentage": round(utilization, 2),
            "is_over_budget": spent > allocated
        }


class FinanceService:
    """
    Database queries & aggregation logic for financial transactions.
    """

    def __init__(self, db: Session):
        self.db = db

    def get_company_financial_summary(
        self,
        company_id: int,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> CompanyFinancialSummary:
        # 1. Total Revenue (Sales)
        sales_q = self.db.query(func.coalesce(func.sum(Sale.amount), 0)).filter(Sale.company_id == company_id)
        if start_date:
            sales_q = sales_q.filter(Sale.transaction_date >= start_date)
        if end_date:
            sales_q = sales_q.filter(Sale.transaction_date <= end_date)
        total_revenue = quantize_currency(sales_q.scalar())

        # 2. Other Cash Inflows (Capital injections, grants, misc deposits)
        inflow_q = self.db.query(func.coalesce(func.sum(CashInflow.amount), 0)).filter(CashInflow.company_id == company_id)
        if start_date:
            inflow_q = inflow_q.filter(CashInflow.transaction_date >= start_date)
        if end_date:
            inflow_q = inflow_q.filter(CashInflow.transaction_date <= end_date)
        other_cash_inflows = quantize_currency(inflow_q.scalar())

        # 3. Expenses & Expenses Paid
        exp_q = self.db.query(
            func.coalesce(func.sum(Expense.amount), 0),
            func.coalesce(func.sum(Expense.amount_paid), 0)
        ).filter(Expense.company_id == company_id)
        if start_date:
            exp_q = exp_q.filter(Expense.expense_date >= start_date)
        if end_date:
            exp_q = exp_q.filter(Expense.expense_date <= end_date)
        exp_row = exp_q.first()
        total_expenses = quantize_currency(exp_row[0] if exp_row else 0)

        # Petty cash expenses still count in P&L, but their cash comes out of the
        # petty cash wallet. Sales cash only drops when the wallet is topped up.
        paid_q = self.db.query(func.coalesce(func.sum(Expense.amount_paid), 0)).filter(
            Expense.company_id == company_id,
            func.lower(func.coalesce(Expense.payment_method, "")) != PETTY_CASH_METHOD,
        )
        if start_date:
            paid_q = paid_q.filter(Expense.expense_date >= start_date)
        if end_date:
            paid_q = paid_q.filter(Expense.expense_date <= end_date)
        expenses_paid = quantize_currency(paid_q.scalar())
        transfers_to_petty_cash = quantize_currency(
            PettyCashService(self.db).topups_total_in_period(company_id, start_date, end_date)
        )

        # 4. Income Statement: Net Profit & Profit Margin
        net_profit = FinanceCalculator.calculate_net_profit(total_revenue, total_expenses)
        profit_margin = FinanceCalculator.calculate_profit_margin(total_revenue, net_profit)

        # 5. Loans
        borrowed_q = self.db.query(func.coalesce(func.sum(Loan.principal_amount), 0)).filter(Loan.borrower == company_id)
        lent_q = self.db.query(func.coalesce(func.sum(Loan.principal_amount), 0)).filter(Loan.lender == company_id)
        total_loans_borrowed = quantize_currency(borrowed_q.scalar())
        total_loans_lent = quantize_currency(lent_q.scalar())

        # Loan Repayments made on borrowed loans
        repaid_q = self.db.query(func.coalesce(func.sum(LoanRepayment.amount), 0)).join(Loan).filter(Loan.borrower == company_id)
        total_loans_repaid = quantize_currency(repaid_q.scalar())

        # 6. Cash Flow Calculations
        # Cash received from sales (using total sales as cash received in current period)
        cash_from_sales = total_revenue
        cash_flow = FinanceCalculator.calculate_cash_flow(
            cash_received_from_sales=cash_from_sales,
            other_cash_inflows=other_cash_inflows,
            loans_received=total_loans_borrowed,
            expenses_paid=expenses_paid,
            loan_repayments=total_loans_repaid,
            other_cash_outflows=transfers_to_petty_cash
        )

        return CompanyFinancialSummary(
            company_id=company_id,
            period_start=start_date,
            period_end=end_date,
            total_revenue=total_revenue,
            total_expenses=total_expenses,
            total_expenses_paid=expenses_paid,
            net_profit=net_profit,
            profit_margin_percentage=profit_margin,
            cash_received_from_sales=cash_from_sales,
            other_cash_inflows=other_cash_inflows,
            loans_received=total_loans_borrowed,
            total_cash_inflow=cash_flow["total_cash_inflow"],
            expenses_paid=expenses_paid,
            loan_repayments_made=total_loans_repaid,
            other_cash_outflows=transfers_to_petty_cash,
            transfers_to_petty_cash=transfers_to_petty_cash,
            total_cash_outflow=cash_flow["total_cash_outflow"],
            net_cash_flow=cash_flow["net_cash_flow"],
            total_loans_borrowed=total_loans_borrowed,
            total_loans_lent=total_loans_lent,
            total_loans_repaid=total_loans_repaid
        )

    def get_list_summaries_for_companies(
        self,
        company_ids: List[int],
    ) -> dict[int, dict]:
        """
        Batch version of the revenue/expense/net-profit figures used by the
        company LIST view, computed for many companies at once.

        """
        result: dict[int, dict] = {}
        if not company_ids:
            return result

        # One grouped query for all sales, one for all expenses.
        revenue_rows = (
            self.db.query(Sale.company_id, func.coalesce(func.sum(Sale.amount), 0))
            .filter(Sale.company_id.in_(company_ids))
            .group_by(Sale.company_id)
            .all()
        )
        expense_rows = (
            self.db.query(Expense.company_id, func.coalesce(func.sum(Expense.amount), 0))
            .filter(Expense.company_id.in_(company_ids))
            .group_by(Expense.company_id)
            .all()
        )

        revenue_by_company = {cid: amount for cid, amount in revenue_rows}
        expense_by_company = {cid: amount for cid, amount in expense_rows}

        for company_id in company_ids:
            total_revenue = quantize_currency(revenue_by_company.get(company_id, 0))
            total_expenses = quantize_currency(expense_by_company.get(company_id, 0))
            net_profit = FinanceCalculator.calculate_net_profit(total_revenue, total_expenses)
            result[company_id] = {
                "total_revenue": total_revenue,
                "total_expenses": total_expenses,
                "net_profit": net_profit,
            }
        return result

    def get_budget_variance(self, budget_id: int) -> Optional[BudgetVarianceOut]:
        budget = self.db.query(Budget).filter(Budget.budget_id == budget_id).first()
        if not budget:
            return None

        spent = self.db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
            Expense.company_id == budget.company_id,
            Expense.category_id == budget.category_id,
            Expense.expense_date >= budget.start_date,
            Expense.expense_date <= budget.end_date
        ).scalar()

        variance = FinanceCalculator.calculate_budget_variance(budget.amount, Decimal(spent))

        return BudgetVarianceOut(
            budget_id=budget.budget_id,
            company_id=budget.company_id,
            category_id=budget.category_id,
            allocated_budget=budget.amount,
            actual_spent=quantize_currency(spent),
            remaining_budget=variance["remaining_budget"],
            utilization_percentage=variance["utilization_percentage"],
            is_over_budget=variance["is_over_budget"],
            start_date=budget.start_date,
            end_date=budget.end_date
        )

    def get_loan_statement(self, loan_id: int) -> Optional[LoanStatementOut]:
        loan = self.db.query(Loan).filter(Loan.loan_id == loan_id).first()
        if not loan:
            return None

        repayments = self.db.query(LoanRepayment).filter(LoanRepayment.loan_id == loan_id).order_by(LoanRepayment.payment_date.asc()).all()
        total_repaid = sum((r.amount for r in repayments), Decimal("0.00"))

        rate = loan.interest_rate or Decimal("0.00")
        interest_amount = FinanceCalculator.calculate_loan_interest(loan.principal_amount, rate)
        total_payable = FinanceCalculator.calculate_loan_total_payable(loan.principal_amount, interest_amount)
        remaining_balance = FinanceCalculator.calculate_loan_remaining_balance(total_payable, total_repaid)
        status = "settled" if remaining_balance == Decimal("0.00") else "active"

        return LoanStatementOut(
            loan_id=loan.loan_id,
            borrower=loan.borrower,
            lender=loan.lender,
            principal_amount=loan.principal_amount,
            interest_rate=rate,
            interest_type=loan.interest_type or "simple",
            interest_amount=interest_amount,
            total_loan_payable=total_payable,
            total_amount_repaid=quantize_currency(total_repaid),
            current_remaining_balance=remaining_balance,
            status=status,
            repayments=[LoanRepaymentOut.model_validate(r) for r in repayments]
        )
