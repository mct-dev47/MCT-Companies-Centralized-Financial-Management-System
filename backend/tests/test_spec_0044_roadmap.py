"""
Tests for Spec 0044: Remaining Gaps & Future Roadmap Architecture.
Compatible with both unittest and pytest.
Covers:
1. BillsService.count_bills and list_bills scoping (including empty company_ids=[]).
2. list_bills endpoint pagination parameters and X-Total-Count / X-Page-Limit / X-Page-Offset headers.
3. get_loans endpoint pagination parameters and headers on both fresh queries and cache hits.
4. Migration 0058_compound_performance_indexes on SQLite.
"""
import os
import sys
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch

os.environ.setdefault("TESTING", "1")
sys.path.insert(0, os.path.abspath("backend"))

from fastapi import Response
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints.bills import list_bills
from app.api.v1.endpoints.loans import get_loans
from app.core.cache import system_cache
from app.core.dependencies import AuthenticatedUser
from app.core.pagination import PaginationParams
from app.db.migrations import run_migrations
from app.db.session import Base
from app.models.bills import Bill
from app.models.company import Company
from app.models.loan import Loan
from app.services.bills_service import BillsService


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


mock_finance_user = AuthenticatedUser(
    user_id=1,
    email="finance@test.com",
    role="finance",
    company_id=None,
    company_ids=[1, 2],
    assigned_company=None,
)


class TestSpec0044Roadmap(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(bind=test_engine)
        self.db = TestingSessionLocal()
        self.db.query(Bill).delete()
        self.db.query(Loan).delete()
        self.db.query(Company).delete()

        comp1 = Company(company_id=1, company_name="Alpha Corp", starting_balance=Decimal("10000.00"))
        comp2 = Company(company_id=2, company_name="Beta Corp", starting_balance=Decimal("10000.00"))
        self.db.add_all([comp1, comp2])
        self.db.commit()

        # Seed 3 bills for Alpha Corp and 2 bills for Beta Corp
        for i in range(1, 4):
            self.db.add(
                Bill(
                    company_id=1,
                    bill_name=f"Alpha Utility {i}",
                    amount=Decimal("1500.00"),
                    recurring="monthly",
                    due_date=date(2026, 11, 10 + i),
                    due_date_reminder=3,
                    status="unpaid",
                )
            )
        for i in range(1, 3):
            self.db.add(
                Bill(
                    company_id=2,
                    bill_name=f"Beta Internet {i}",
                    amount=Decimal("2500.00"),
                    recurring="monthly",
                    due_date=date(2026, 11, 15 + i),
                    due_date_reminder=3,
                    status="unpaid",
                )
            )

        # Seed 4 loans
        for i in range(1, 5):
            self.db.add(
                Loan(
                    borrower=1,
                    lender=2,
                    loan_ref_no=f"LN-0044-{i}",
                    principal_amount=Decimal("5000.00"),
                    interest_rate=Decimal("2.50"),
                    interest_type="simple",
                    loan_date=date(2026, 11, i),
                    due_date=date(2026, 12, i),
                    description=f"Working capital {i}",
                    status="Approved",
                )
            )
        self.db.commit()
        system_cache.clear()

    def tearDown(self):
        self.db.close()
        system_cache.clear()

    def test_bills_service_count_and_empty_scope(self):
        service = BillsService(self.db)
        self.assertEqual(service.count_bills(), 5)
        self.assertEqual(service.count_bills(company_id=1), 3)
        self.assertEqual(service.count_bills(company_name="Beta Corp"), 2)
        self.assertEqual(service.count_bills(company_ids=[1, 2]), 5)
        # Defensive check: empty list must return 0 and [] rather than bypassing filter
        self.assertEqual(service.count_bills(company_ids=[]), 0)
        self.assertEqual(service.list_bills(company_ids=[]), [])

    def test_bills_endpoint_pagination_and_headers(self):
        response = Response()
        items = list_bills(
            response=response,
            user=mock_finance_user,
            company_id=None,
            company_name=None,
            company=None,
            pagination=PaginationParams(limit=2, offset=1),
            db=self.db,
        )
        self.assertIsInstance(items, list)
        self.assertEqual(len(items), 2)
        self.assertEqual(response.headers.get("X-Total-Count"), "5")
        self.assertEqual(response.headers.get("X-Page-Limit"), "2")
        self.assertEqual(response.headers.get("X-Page-Offset"), "1")

    def test_loans_endpoint_pagination_and_cache_hit_headers(self):
        def _raise_no_supabase():
            raise RuntimeError("Force SQLite fallback in test")

        with patch("app.api.v1.endpoints.loans.get_supabase_admin_client", side_effect=_raise_no_supabase):
            # 1. First call (populates cache)
            resp1 = Response()
            items1 = get_loans(
                response=resp1,
                borrower_id=None,
                lender_id=None,
                company_name=None,
                scope=None,
                status=None,
                start_date=None,
                end_date=None,
                user_role=None,
                pagination=PaginationParams(limit=2, offset=0),
                request=None,
                current_user=mock_finance_user,
                db=self.db,
            )
            self.assertEqual(len(items1), 2)
            self.assertEqual(resp1.headers.get("X-Total-Count"), "4")
            self.assertEqual(resp1.headers.get("X-Page-Limit"), "2")
            self.assertEqual(resp1.headers.get("X-Page-Offset"), "0")

            # 2. Second identical call (served from cache) must still include pagination headers
            resp2 = Response()
            items2 = get_loans(
                response=resp2,
                borrower_id=None,
                lender_id=None,
                company_name=None,
                scope=None,
                status=None,
                start_date=None,
                end_date=None,
                user_role=None,
                pagination=PaginationParams(limit=2, offset=0),
                request=None,
                current_user=mock_finance_user,
                db=self.db,
            )
            self.assertEqual(len(items2), 2)
            self.assertEqual(resp2.headers.get("X-Total-Count"), "4")
            self.assertEqual(resp2.headers.get("X-Page-Limit"), "2")
            self.assertEqual(resp2.headers.get("X-Page-Offset"), "0")

    def test_migration_0058_compound_indexes(self):
        mig_engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=mig_engine)
        applied = run_migrations(mig_engine)
        self.assertIn("0058_compound_performance_indexes", applied)

        inspector = inspect(mig_engine)
        sales_idx = {idx["name"] for idx in inspector.get_indexes("sales")}
        expenses_idx = {idx["name"] for idx in inspector.get_indexes("expenses")}
        bank_tx_idx = {idx["name"] for idx in inspector.get_indexes("bank_transactions")}
        bills_idx = {idx["name"] for idx in inspector.get_indexes("bills")}
        loan_idx = {idx["name"] for idx in inspector.get_indexes("loan")}

        self.assertIn("idx_sales_company_transaction_date", sales_idx)
        self.assertIn("idx_sales_company_deposit_status", sales_idx)
        self.assertIn("idx_expenses_company_expense_date", expenses_idx)
        self.assertIn("idx_bank_transactions_account_date", bank_tx_idx)
        self.assertIn("idx_bills_company_due_date", bills_idx)
        self.assertIn("idx_loan_borrower_date", loan_idx)
        self.assertIn("idx_loan_lender_date", loan_idx)
        mig_engine.dispose()


if __name__ == "__main__":
    unittest.main()
