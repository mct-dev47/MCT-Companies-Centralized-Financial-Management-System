"""
Test RBAC and Company-Level Permissions (spec 0019).
Verifies:
1. Admin: strictly Company Management, User Management, Activity Log. No business CRUD.
2. Finance: Full CRUD across all companies on business features; no user/company management.
3. Auditor: Read-only on business features + audit review actions. No create, edit, or delete.
4. Supervisor: CRUD strictly within assigned companies. Accessing unassigned companies returns 403.
5. Company features:
   - Tenants: exclusively JK Property and Ventures Corporation (ID 5).
   - Lending: exclusively FILCAP Prime Holdings Corp. (ID 7).
"""
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.abspath("backend"))

from datetime import date
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # Registers models
from app.db.session import Base, get_db
from app.models.company import Company
from app.core.dependencies import (
    get_current_user,
    require_business_reader,
    require_business_writer,
    require_finance_user,
    require_auditor_user,
    require_admin_user,
)
from app.core.company_features import (
    COMPANY_FEATURE_TENANTS,
    COMPANY_FEATURE_LENDING,
    JK_PROPERTY_COMPANY_ID,
    FILCAP_COMPANY_ID,
    is_feature_authorized_for_company,
)
from app.api.v1.endpoints import (
    bills as bills_endpoints,
    lending as lending_endpoints,
    sales as sales_endpoints,
    expenses as expenses_endpoints,
    tenants as tenants_endpoints,
    petty_cash as petty_cash_endpoints,
    bank_accounts as bank_endpoints,
    companies as companies_endpoints,
    users as users_endpoints,
    audit_logs as audit_logs_endpoints,
)
from app.services import tenant_service

ADMIN_USER = {
    "auth_user_id": "usr_admin",
    "user_id": 1,
    "email": "admin@mct.com",
    "is_admin": True,
    "role": "admin",
    "company_ids": [],
    "company_id": None,
}

FINANCE_USER = {
    "auth_user_id": "usr_finance",
    "user_id": 2,
    "email": "finance@mct.com",
    "is_admin": False,
    "role": "finance",
    "company_ids": list(range(1, 15)),
    "company_id": None,
}

AUDITOR_USER = {
    "auth_user_id": "usr_auditor",
    "user_id": 3,
    "email": "auditor@mct.com",
    "is_admin": False,
    "role": "auditor",
    "company_ids": list(range(1, 15)),
    "company_id": None,
}

SUPERVISOR_USER = {
    "auth_user_id": "usr_supervisor",
    "user_id": 4,
    "email": "supervisor@mct.com",
    "is_admin": False,
    "role": "supervisor",
    "company_ids": [4, 5],
    "company_id": 5,
}


class TestRBACPermissions(unittest.TestCase):
    def setUp(self):
        # Disable Supabase remote connections in unit tests
        self.sb_patcher = patch("app.db.supabase.get_supabase_admin_client", side_effect=Exception("Supabase disabled in unit tests"))
        self.sb_patcher.start()

        def mock_summaries(cids):
            return {cid: {"total_revenue": 0.0, "total_expenses": 0.0, "net_profit": 0.0} for cid in cids}

        self.fin_patcher = patch("app.services.finance_service.FinanceService.get_list_summaries_for_companies", side_effect=mock_summaries)
        self.fin_patcher.start()

        self.ts_patcher = patch.object(tenant_service, "_supabase_client", return_value=None)
        self.ts_patcher.start()

        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=engine)
        self.Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

        with self.Session() as seed:
            seed.add_all([
                Company(company_id=1, company_name="MCT Hotel", location="Manila", starting_balance=1000),
                Company(company_id=4, company_name="Speedfire Construction & Trading Corp.", location="Manila", starting_balance=1000),
                Company(company_id=5, company_name="JK Property and Ventures Corporation", location="Manila", starting_balance=1000),
                Company(company_id=7, company_name="FILCAP Prime Holdings Corp.", location="Manila", starting_balance=1000),
            ])
            seed.commit()

        def override_db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        self.current_user_holder = {"user": ADMIN_USER}

        app = FastAPI()
        app.include_router(bills_endpoints.router, prefix="/bills")
        app.include_router(lending_endpoints.router, prefix="/lending")
        app.include_router(sales_endpoints.router, prefix="/sales")
        app.include_router(expenses_endpoints.router, prefix="/expenses")
        app.include_router(tenants_endpoints.router, prefix="/tenants")
        app.include_router(petty_cash_endpoints.router, prefix="/petty-cash")
        app.include_router(bank_endpoints.router, prefix="/bank-accounts")
        app.include_router(companies_endpoints.router, prefix="/companies")
        app.include_router(users_endpoints.router, prefix="/users")
        app.include_router(audit_logs_endpoints.router)

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: self.current_user_holder["user"]

        self.client = TestClient(app)

    def tearDown(self):
        self.sb_patcher.stop()
        self.fin_patcher.stop()
        self.ts_patcher.stop()

    # 1. Admin RBAC Tests
    def test_admin_blocked_from_business_crud(self):
        self.current_user_holder["user"] = ADMIN_USER

        # Admin cannot access Bills (403)
        res = self.client.get("/bills")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Administrator accounts manage system configuration and users only", res.json()["detail"])

        # Admin cannot access Sales (403)
        res = self.client.get("/sales")
        self.assertEqual(res.status_code, 403)

        # Admin cannot access Expenses (403)
        res = self.client.get("/expenses")
        self.assertEqual(res.status_code, 403)

        # Admin cannot create a sale (403)
        res = self.client.post("/sales", json={"amount": 100, "transaction_date": "2026-11-01", "particulars": "test"})
        self.assertEqual(res.status_code, 403)

    def test_admin_allowed_company_user_audit_management(self):
        self.current_user_holder["user"] = ADMIN_USER

        # Admin can list companies (200)
        res = self.client.get("/companies")
        self.assertEqual(res.status_code, 200)

        # Admin can list users (200)
        res = self.client.get("/users")
        self.assertEqual(res.status_code, 200)

        # Admin can list audit logs (200)
        res = self.client.get("/audit-logs")
        self.assertEqual(res.status_code, 200)

    # 2. Finance RBAC Tests
    def test_finance_allowed_business_crud_blocked_user_company_mgmt(self):
        self.current_user_holder["user"] = FINANCE_USER

        # Finance can read business operations
        res = self.client.get("/bills")
        self.assertEqual(res.status_code, 200)

        res = self.client.get("/sales")
        self.assertEqual(res.status_code, 200)

        res = self.client.get("/expenses")
        self.assertEqual(res.status_code, 200)

        # Finance cannot manage users (403)
        res = self.client.get("/users")
        self.assertEqual(res.status_code, 403)

        # Finance cannot create companies (403)
        res = self.client.post("/companies", json={"name": "New Co", "location": "Manila", "starting_balance": 0})
        self.assertEqual(res.status_code, 403)

        # Finance cannot view central audit logs (403)
        res = self.client.get("/audit-logs")
        self.assertEqual(res.status_code, 403)

    # 3. Auditor RBAC Tests
    def test_auditor_read_only_and_blocked_from_writes(self):
        self.current_user_holder["user"] = AUDITOR_USER

        # Auditor can read business operations
        res = self.client.get("/bills")
        self.assertEqual(res.status_code, 200)

        res = self.client.get("/sales")
        self.assertEqual(res.status_code, 200)

        # Auditor cannot create bills (403)
        res = self.client.post("/bills", json={"company_id": 1, "vendor_name": "Vendor", "amount": 100, "due_date": "2026-12-01"})
        self.assertEqual(res.status_code, 403)

        # Auditor cannot create sales (403)
        res = self.client.post("/sales", json={"company_id": 1, "amount": 100, "transaction_date": "2026-11-01", "particulars": "test"})
        self.assertEqual(res.status_code, 403)

        # Auditor cannot create expenses (403)
        res = self.client.post("/expenses", json={"company_id": 1, "amount": 100, "expense_date": "2026-11-01", "particulars": "test"})
        self.assertEqual(res.status_code, 403)

        # Auditor cannot manage users or companies (403)
        self.assertEqual(self.client.get("/users").status_code, 403)
        self.assertEqual(self.client.post("/companies", json={"name": "Test", "location": "Manila", "starting_balance": 0}).status_code, 403)

    # 4. Supervisor RBAC & Company Scoping Tests
    def test_supervisor_assigned_company_scoping(self):
        # Supervisor has access only to Speedfire (4) and JK Property (5)
        self.current_user_holder["user"] = SUPERVISOR_USER

        # Supervisor CAN access assigned company
        res = self.client.get("/bills?company_id=5")
        self.assertEqual(res.status_code, 200)

        res = self.client.get("/bills?company_id=4")
        self.assertEqual(res.status_code, 200)

        # Supervisor CANNOT access unassigned company (1 - MCT Hotel)
        res = self.client.get("/bills?company_id=1")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Access denied", res.json()["detail"])

        # Supervisor cannot create a record for unassigned company
        res = self.client.post("/bills", json={"company_id": 1, "vendor_name": "Test", "amount": 500, "due_date": "2026-12-01"})
        self.assertEqual(res.status_code, 403)

        # Supervisor cannot manage users or companies
        self.assertEqual(self.client.get("/users").status_code, 403)
        self.assertEqual(self.client.post("/companies", json={"name": "Test", "location": "Manila", "starting_balance": 0}).status_code, 403)

    # 5. Company-Specific Feature Gatekeeping (Tenants & Lending)
    def test_tenants_feature_gatekeeper(self):
        # Helper function checks
        self.assertTrue(is_feature_authorized_for_company(COMPANY_FEATURE_TENANTS, JK_PROPERTY_COMPANY_ID))
        self.assertFalse(is_feature_authorized_for_company(COMPANY_FEATURE_TENANTS, 1))
        self.assertFalse(is_feature_authorized_for_company(COMPANY_FEATURE_TENANTS, FILCAP_COMPANY_ID))

        # Finance tries to access Tenants on a non-JK company (MCT Hotel = 1) -> 403 Forbidden
        self.current_user_holder["user"] = FINANCE_USER
        res = self.client.get("/tenants/leases?company_id=1")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Tenants is only available for JK Property and Ventures Corporation", res.json()["detail"])

        # Finance access Tenants on JK Property (5) -> 200
        res = self.client.get("/tenants/leases?company_id=5")
        self.assertEqual(res.status_code, 200)

    def test_lending_feature_gatekeeper(self):
        # Helper function checks
        self.assertTrue(is_feature_authorized_for_company(COMPANY_FEATURE_LENDING, FILCAP_COMPANY_ID))
        self.assertFalse(is_feature_authorized_for_company(COMPANY_FEATURE_LENDING, 1))
        self.assertFalse(is_feature_authorized_for_company(COMPANY_FEATURE_LENDING, JK_PROPERTY_COMPANY_ID))

        # Finance access Lending on non-FILCAP company (1) -> 403 Forbidden
        self.current_user_holder["user"] = FINANCE_USER
        res = self.client.get("/lending/borrowers?company_id=1")
        self.assertEqual(res.status_code, 403)
        self.assertIn("Lending is only available for FILCAP Prime Holdings Corp.", res.json()["detail"])

        # Finance access Lending on FILCAP (7) -> 200
        res = self.client.get("/lending/borrowers?company_id=7")
        self.assertEqual(res.status_code, 200)


if __name__ == "__main__":
    unittest.main()
