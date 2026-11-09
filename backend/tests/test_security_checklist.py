from __future__ import annotations

import os
import sys

os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, os.path.abspath("backend"))

import inspect
import json
import unittest
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.base import StrictBaseModel, PaginatedResponse
from app.schemas.expense import ExpenseCreate, ExpenseUpdate
from app.schemas.bills import BillCreate, BillUpdate
from app.schemas.sale import SaleCreate, SaleUpdate
from app.schemas.petty_cash import PettyCashTopUpCreate, PettyCashTopUpUpdate, ReceiptUploadOut
from app.schemas.lending import (
    BorrowerCreateRequest,
    BorrowerUpdateRequest,
    LendingPaymentCreateRequest,
    LendingTransactionCreateRequest,
    BorrowerOut,
    LendingTransactionOut,
)
from app.schemas.receivable import (
    ReceivableCreate,
    ReceivableUpdate,
    PayrollDeductionRequest,
    PayrollSettlementOut,
)
from app.core.pagination import PaginationParams
from app.middleware.request_limits import (
    RequestSizeLimitMiddleware,
    RequestTimeoutMiddleware,
    MAX_REQUEST_BODY_BYTES,
    REQUEST_TIMEOUT_SECONDS,
    EXEMPT_TIMEOUT_PATHS,
)
from app.api.v1.endpoints import (
    expenses as expenses_ep,
    bills as bills_ep,
    sales as sales_ep,
    receivables as receivables_ep,
    lending as lending_ep,
    petty_cash as petty_cash_ep,
)
from app.core import dependencies


class TestSecurityChecklist(unittest.TestCase):
    # ---------------------------------------------------------
    # ITEM 1: Centralized Authentication & Authorization Dependencies
    # ---------------------------------------------------------
    def test_item1_centralized_dependencies_exist(self):
        """Item 1: Verify all required centralized auth dependencies exist in app.core.dependencies."""
        self.assertTrue(hasattr(dependencies, "get_current_user"))
        self.assertTrue(hasattr(dependencies, "CurrentUser"))
        self.assertTrue(hasattr(dependencies, "AdminUser"))
        self.assertTrue(hasattr(dependencies, "AuditorUser"))
        self.assertTrue(hasattr(dependencies, "FinanceUser"))
        self.assertTrue(hasattr(dependencies, "BusinessWriter"))
        self.assertTrue(hasattr(dependencies, "BusinessReader"))
        self.assertTrue(hasattr(dependencies, "check_company_access"))
        self.assertTrue(hasattr(dependencies, "get_authorized_company_scope"))
        self.assertTrue(hasattr(dependencies, "require_reauthentication"))

    def test_item1_tenant_isolation_enforcement(self):
        """Item 1: Verify check_company_access rejects unassigned company access with 403."""
        supervisor_user = {
            "user_id": 4,
            "role": "supervisor",
            "is_admin": False,
            "company_id": 5,
            "company_ids": [5],
        }
        # Accessing assigned company (ID 5) must pass without exception
        dependencies.check_company_access(supervisor_user, 5)

        # Accessing unassigned company (ID 99) must raise HTTP 403 Forbidden
        with self.assertRaises(HTTPException) as ctx:
            dependencies.check_company_access(supervisor_user, 99)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Access denied", ctx.exception.detail)

    # ---------------------------------------------------------
    # ITEM 2: Strict Schemas, Types, Length Limits, and Allowlisted Fields
    # ---------------------------------------------------------
    def test_item2_expense_schema_extra_forbid_and_length_limits(self):
        """Item 2: ExpenseCreate strictly forbids extra fields and bounds string lengths."""
        # Extra field rejected
        with self.assertRaises(ValidationError) as ctx:
            ExpenseCreate.model_validate({
                "company_id": 1,
                "category_id": 1,
                "expense_date": str(date.today()),
                "amount": "100.00",
                "particulars": "Office supplies",
                "injected_extra_field": "attack",
            })
        self.assertIn("extra_forbidden", str(ctx.exception))

        # Max length boundary (500 chars)
        with self.assertRaises(ValidationError) as ctx:
            ExpenseCreate.model_validate({
                "company_id": 1,
                "category_id": 1,
                "expense_date": str(date.today()),
                "amount": "100.00",
                "particulars": "Z" * 501,
            })
        self.assertIn("string_too_long", str(ctx.exception))

    def test_item2_bill_schema_extra_forbid(self):
        """Item 2: BillCreate strictly forbids unexpected fields."""
        with self.assertRaises(ValidationError) as ctx:
            BillCreate.model_validate({
                "company_id": 1,
                "bill_name": "Electricity",
                "due_date": str(date.today()),
                "amount": "500.00",
                "unrecognized_field": "test",
            })
        self.assertIn("extra_forbidden", str(ctx.exception))

    def test_item2_sale_schema_extra_forbid(self):
        """Item 2: SaleCreate strictly forbids unexpected fields."""
        with self.assertRaises(ValidationError) as ctx:
            SaleCreate.model_validate({
                "company_id": 1,
                "category_id": 1,
                "transaction_date": str(date.today()),
                "amount": "500.00",
                "particulars": "Retail sales",
                "unrecognized_field": "test",
            })
        self.assertIn("extra_forbidden", str(ctx.exception))

    def test_item2_petty_cash_schema_extra_forbid(self):
        """Item 2: PettyCashTopUpCreate strictly forbids unexpected fields."""
        with self.assertRaises(ValidationError) as ctx:
            PettyCashTopUpCreate.model_validate({
                "company_id": 1,
                "amount": "500.00",
                "topup_date": str(date.today()),
                "unrecognized_field": "test",
            })
        self.assertIn("extra_forbidden", str(ctx.exception))

    def test_item2_lending_schema_extra_forbid(self):
        """Item 2: Lending input schemas strictly forbid unexpected fields."""
        with self.assertRaises(ValidationError) as ctx:
            BorrowerCreateRequest.model_validate({
                "borrower_name": "Jane Doe",
                "loan_amount": "1000.00",
                "malicious_extra": 123,
            })
        self.assertIn("extra_forbidden", str(ctx.exception))

    def test_item2_receivable_schema_extra_forbid(self):
        """Item 2: ReceivableCreate strictly forbids unexpected fields."""
        with self.assertRaises(ValidationError) as ctx:
            ReceivableCreate.model_validate({
                "customer_name": "Test Customer",
                "company_id": 1,
                "items_summary": "Services rendered",
                "malicious_extra": 123,
            })
        self.assertIn("extra_forbidden", str(ctx.exception))

    # ---------------------------------------------------------
    # ITEM 3: Parameterized Queries (Safe SQL / ORM)
    # ---------------------------------------------------------
    def test_item3_parameterized_sql_no_concatenation(self):
        """Item 3: Verify raw SQL queries use text() with bound named parameters rather than string concatenation."""
        from app.services.rate_limiter import RateLimiterService
        src = inspect.getsource(RateLimiterService._record_attempt_postgres)
        self.assertIn("text(", src)
        self.assertIn(":key", src)
        self.assertIn(":now", src)
        self.assertNotIn('f"INSERT', src)
        self.assertNotIn('f"SELECT', src)

    # ---------------------------------------------------------
    # ITEM 4: Explicit Response Schemas
    # ---------------------------------------------------------
    def test_item4_explicit_response_models_on_endpoints(self):
        """Item 4: Verify previously unmodeled endpoints now declare explicit response models."""
        # Lending POST /transactions
        t_route = next(r for r in lending_ep.router.routes if getattr(r, "path", None) == "/transactions" and "POST" in r.methods)
        self.assertEqual(t_route.response_model, LendingTransactionOut)

        # Lending POST /payments
        p_route = next(r for r in lending_ep.router.routes if getattr(r, "path", None) == "/payments" and "POST" in r.methods)
        self.assertEqual(p_route.response_model, LendingTransactionOut)

        # Petty cash POST /receipts
        r_route = next(r for r in petty_cash_ep.router.routes if getattr(r, "path", None) == "/receipts" and "POST" in r.methods)
        self.assertEqual(r_route.response_model, ReceiptUploadOut)

        # Receivables POST /settle-payroll
        s_route = next(r for r in receivables_ep.router.routes if getattr(r, "path", None) == "/settle-payroll" and "POST" in r.methods)
        self.assertEqual(s_route.response_model, PayrollSettlementOut)

    def test_daily_summary_endpoints_have_no_pagination_dependency(self):
        """Verify daily summary endpoints aggregate full dataset and do not bind PaginationParams."""
        for ep_module, name in [(expenses_ep, "get_expenses_daily_summary"), (sales_ep, "get_sales_daily_summary")]:
            route = next((r for r in ep_module.router.routes if "/daily-summary" in getattr(r, "path", "")), None)
            self.assertIsNotNone(route, f"daily-summary route not found in {ep_module.__name__}")
            sig = inspect.signature(route.endpoint)
            self.assertNotIn("pagination", sig.parameters, f"daily-summary in {ep_module.__name__} should not be sliced by pagination")

    # ---------------------------------------------------------
    # ITEM 5 & 6: Query Parameter Validation, Pagination, Limits
    # ---------------------------------------------------------
    def test_item5_pagination_parameters_and_bounds(self):
        """Item 5 & 6: Verify PaginationParams defines strict bounds (default: 50, max: 100)."""
        sig = inspect.signature(PaginationParams.__init__)
        limit_param = sig.parameters["limit"]
        offset_param = sig.parameters["offset"]

        # Default limit is 50
        self.assertEqual(limit_param.default.default, 50)
        # Bounds ge=1, le=100 in metadata
        metadata_str = str(limit_param.default.metadata)
        self.assertIn("ge=1", metadata_str)
        self.assertIn("le=100", metadata_str)

        # Default offset is 0
        self.assertEqual(offset_param.default.default, 0)
        offset_meta_str = str(offset_param.default.metadata)
        self.assertIn("ge=0", offset_meta_str)

    def test_item5_endpoints_wire_pagination_dependency(self):
        """Item 5 & 6: Verify list endpoints wire PaginationParams as dependency."""
        for ep_module, route_path in [
            (expenses_ep, ""),
            (bills_ep, ""),
            (sales_ep, ""),
            (receivables_ep, ""),
        ]:
            route = next((r for r in ep_module.router.routes if getattr(r, "path", None) == route_path and "GET" in r.methods), None)
            self.assertIsNotNone(route, f"GET route for {ep_module.__name__} not found")
            sig = inspect.signature(route.endpoint)
            self.assertIn("pagination", sig.parameters, f"pagination dependency missing on {ep_module.__name__}")

    # ---------------------------------------------------------
    # ITEM 6: Request Size & Execution Time Limits
    # ---------------------------------------------------------
    def test_item6_request_size_and_timeout_thresholds(self):
        """Item 6: Verify request limits configuration."""
        self.assertEqual(MAX_REQUEST_BODY_BYTES, 10 * 1024 * 1024)  # 10 MB limit
        self.assertEqual(REQUEST_TIMEOUT_SECONDS, 30.0)             # 30 second timeout
        self.assertIn("/ws", EXEMPT_TIMEOUT_PATHS)
        self.assertIn("/api/v1/health", EXEMPT_TIMEOUT_PATHS)

    # ---------------------------------------------------------
    # ITEM 7: Rate Limiting & Abuse Prevention
    # ---------------------------------------------------------
    def test_item7_rate_limiting_configured(self):
        """Item 7: Verify rate limiter and middleware define heavy route protection."""
        from app.middleware.rate_limit_middleware import RateLimitingMiddleware, HEAVY_ROUTE_KEYWORDS
        self.assertIn("/export", HEAVY_ROUTE_KEYWORDS)
        self.assertIn("/reports", HEAVY_ROUTE_KEYWORDS)
        self.assertIn("/calculate", HEAVY_ROUTE_KEYWORDS)
        self.assertIn("/reconciliation", HEAVY_ROUTE_KEYWORDS)


if __name__ == "__main__":
    unittest.main()
