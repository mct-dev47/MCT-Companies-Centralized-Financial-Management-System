import unittest
from fastapi import HTTPException
from app.core.dependencies import check_company_access, get_authorized_company_scope, AuthenticatedUser
from app.db.session import SessionLocal
from app.api.v1.endpoints.dashboard import get_dashboard_summary, invalidate_dashboard_cache
from app.api.v1.endpoints.companies import lookup_companies, get_companies

class TestFinanceCompanyIsolation(unittest.TestCase):
    def setUp(self):
        invalidate_dashboard_cache()
        self.finance_user_c1: AuthenticatedUser = {
            "auth_user_id": "101",
            "user_id": 101,
            "email": "finance@mctkitchen.com",
            "name": "Finance Kitchen",
            "role": "finance",
            "company_id": 1,
            "company_ids": [1],
            "is_admin": False,
            "status": "ACTIVE",
            "must_change_password": False,
        }

        self.finance_user_unassigned: AuthenticatedUser = {
            "auth_user_id": "102",
            "user_id": 102,
            "email": "finance_unassigned@mct.com",
            "name": "Finance Unassigned",
            "role": "finance",
            "company_id": None,
            "company_ids": [],
            "is_admin": False,
            "status": "ACTIVE",
            "must_change_password": False,
        }

        self.finance_multi_user: AuthenticatedUser = {
            "auth_user_id": "103",
            "user_id": 103,
            "email": "finance_multi@mct.com",
            "name": "Finance Multi",
            "role": "finance",
            "company_id": 1,
            "company_ids": [1, 3],
            "is_admin": False,
            "status": "ACTIVE",
            "must_change_password": False,
        }

    def test_check_company_access_allows_assigned_company(self):
        # Should not raise for company 1
        try:
            check_company_access(self.finance_user_c1, 1)
        except HTTPException:
            self.fail("check_company_access raised HTTPException for assigned company")

    def test_check_company_access_blocks_unassigned_company(self):
        # Must raise 403 for company 2 or 5
        with self.assertRaises(HTTPException) as ctx:
            check_company_access(self.finance_user_c1, 2)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("not assigned", ctx.exception.detail.lower())

    def test_get_authorized_company_scope_single_assigned(self):
        scope = get_authorized_company_scope(self.finance_user_c1, requested_company_id=None)
        self.assertEqual(scope, [1])

        scope_req1 = get_authorized_company_scope(self.finance_user_c1, requested_company_id=1)
        self.assertEqual(scope_req1, [1])

        with self.assertRaises(HTTPException) as ctx:
            get_authorized_company_scope(self.finance_user_c1, requested_company_id=2)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_get_authorized_company_scope_multi_assigned(self):
        scope = get_authorized_company_scope(self.finance_multi_user, requested_company_id=None)
        self.assertEqual(set(scope), {1, 3})

        scope_req3 = get_authorized_company_scope(self.finance_multi_user, requested_company_id=3)
        self.assertEqual(scope_req3, [3])

        with self.assertRaises(HTTPException) as ctx:
            get_authorized_company_scope(self.finance_multi_user, requested_company_id=2)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_get_authorized_company_scope_unassigned_blocked(self):
        with self.assertRaises(HTTPException) as ctx:
            get_authorized_company_scope(self.finance_user_unassigned, requested_company_id=None)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("not assigned", ctx.exception.detail.lower())

    def test_dashboard_summary_endpoint(self):
        db = SessionLocal()
        try:
            # Authorized request
            res = get_dashboard_summary(
                company_id=1,
                current_user=self.finance_user_c1,
                db=db,
            )
            self.assertIsNotNone(res)
            self.assertTrue(hasattr(res, "metrics"))
            self.assertTrue(hasattr(res, "monthly_pnl"))
            self.assertTrue(hasattr(res, "income_categories"))
            self.assertTrue(hasattr(res, "expense_categories"))
            self.assertTrue(hasattr(res, "recent_transactions"))

            # Unauthorized request: trying to query company 2
            with self.assertRaises(HTTPException) as ctx:
                get_dashboard_summary(
                    company_id=2,
                    current_user=self.finance_user_c1,
                    db=db,
                )
            self.assertEqual(ctx.exception.status_code, 403)
        finally:
            db.close()

    def test_lookup_and_get_companies_isolation(self):
        db = SessionLocal()
        try:
            # Non-admin finance user restricted to company 1
            lookup_res = lookup_companies(current_user=self.finance_user_c1, db=db)
            self.assertIsInstance(lookup_res, list)
            for c in lookup_res:
                cid = c.get("company_id") if isinstance(c, dict) else c.company_id
                self.assertEqual(cid, 1)

            # Unassigned finance user returns empty list
            lookup_unassigned = lookup_companies(current_user=self.finance_user_unassigned, db=db)
            self.assertEqual(lookup_unassigned, [])

            # get_companies returns CompanyOut scoped to company 1
            comps = get_companies(current_user=self.finance_user_c1, db=db)
            self.assertIsInstance(comps, list)
            for c in comps:
                self.assertEqual(c.id, 1)
        finally:
            db.close()

    def test_dashboard_cache_invalidation(self):
        db = SessionLocal()
        try:
            res1 = get_dashboard_summary(company_id=1, current_user=self.finance_user_c1, db=db)
            res2 = get_dashboard_summary(company_id=1, current_user=self.finance_user_c1, db=db)
            self.assertEqual(res1.company_id, res2.company_id)
            # Invalidation resets cache without error
            invalidate_dashboard_cache()
            res3 = get_dashboard_summary(company_id=1, current_user=self.finance_user_c1, db=db)
            self.assertEqual(res3.company_id, 1)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
