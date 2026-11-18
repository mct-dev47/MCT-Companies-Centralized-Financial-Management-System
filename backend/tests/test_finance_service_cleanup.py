import os
import sys
import unittest
from datetime import date
from decimal import Decimal

os.environ.setdefault("TESTING", "1")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.company import Company
from app.models.finance import Sale, Expense
from app.models.loan import Loan, LoanRepayment
from app.services.finance_service import FinanceService


class TestFinanceServiceCleanup(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionLocal()

        self.db.add_all([
            Company(company_id=1, company_name="Alpha", location="Manila"),
            Company(company_id=2, company_name="Beta", location="Cebu"),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_get_company_financial_summary_zero_other_cash_inflows(self):
        self.db.add(Sale(
            company_id=1,
            transaction_date=date(2026, 11, 10),
            amount=Decimal("1000.00"),
            particulars="Daily food sales [Paid]",
            payment_status="Paid",
        ))
        self.db.add(Expense(
            company_id=1,
            expense_date=date(2026, 11, 10),
            amount=Decimal("300.00"),
            amount_paid=Decimal("300.00"),
            description="Supplies",
        ))
        self.db.commit()

        summary = FinanceService(self.db).get_company_financial_summary(company_id=1)
        self.assertEqual(summary.other_cash_inflows, Decimal("0.00"))
        self.assertEqual(summary.total_revenue, Decimal("1000.00"))
        self.assertEqual(summary.total_expenses, Decimal("300.00"))
        self.assertEqual(summary.net_profit, Decimal("700.00"))
        self.assertEqual(summary.total_cash_inflow, Decimal("1000.00"))

    def test_get_loan_statement_without_interest_type(self):
        loan = Loan(
            borrower=1,
            lender=2,
            loan_ref_no="LN-CLEAN-1",
            principal_amount=Decimal("1000.00"),
            interest_rate=Decimal("10.00"),
            loan_date=date(2026, 11, 1),
            status="Disbursed",
        )
        self.db.add(loan)
        self.db.flush()
        self.db.add(LoanRepayment(
            loan_id=loan.loan_id,
            payment_date=date(2026, 11, 15),
            remaining_balance=Decimal("900.00"),
            amount=Decimal("200.00"),
        ))
        self.db.commit()

        stmt = FinanceService(self.db).get_loan_statement(loan.loan_id)
        self.assertIsNotNone(stmt)
        self.assertEqual(stmt.principal_amount, Decimal("1000.00"))
        self.assertEqual(stmt.interest_amount, Decimal("100.00"))
        self.assertEqual(stmt.total_loan_payable, Decimal("1100.00"))
        self.assertEqual(stmt.total_amount_repaid, Decimal("200.00"))
        self.assertEqual(stmt.current_remaining_balance, Decimal("900.00"))
        self.assertEqual(stmt.status, "active")
        self.assertNotIn("interest_type", stmt.model_dump())


if __name__ == "__main__":
    unittest.main()
