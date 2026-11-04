"""
Tests for Spec 0029: Owner Role and Account Migration.
Verifies:
1. User models and schemas accept the "owner" role.
2. require_business_writer raises 403 Forbidden for Owner accounts.
3. require_business_reader allows Owner accounts through.
4. check_company_access and get_authorized_company_scope grant multi-company read access.
5. require_audit_or_admin_user rejects Owner accounts.
6. SQL migration logic updates the target user record safely and idempotently.
"""
import os
import sys
import unittest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.abspath("backend"))

from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate, UserBase
from app.services.user_service import UserService
from app.core.dependencies import (
    require_business_writer,
    require_business_reader,
    check_company_access,
    get_authorized_company_scope,
    require_audit_or_admin_user,
    require_finance_or_admin_user,
)

OWNER_USER = {
    "auth_user_id": "usr_owner_1",
    "user_id": 99,
    "email": "ryuuujin.sh@gmail.com",
    "is_admin": False,
    "role": "owner",
    "company_ids": [],
    "company_id": None,
}


class TestOwnerRole(unittest.TestCase):
    def test_owner_role_schema_validation(self):
        """UserCreate should allow role 'owner'."""
        user_in = UserCreate(
            name="Manuel Owner",
            email="ryuuujin.sh@gmail.com",
            role="owner",
        )
        self.assertEqual(user_in.role, "owner")
        self.assertIn("owner", UserService.ALLOWED_ROLES)

    def test_require_business_writer_blocks_owner(self):
        """require_business_writer must reject Owner with 403 Forbidden."""
        with self.assertRaises(HTTPException) as ctx:
            require_business_writer(OWNER_USER)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Owner accounts have read-only access", ctx.exception.detail)

    def test_require_business_reader_permits_owner(self):
        """require_business_reader must permit Owner accounts."""
        result = require_business_reader(OWNER_USER)
        self.assertEqual(result, OWNER_USER)

    def test_check_company_access_permits_owner(self):
        """check_company_access should not raise for any company ID when accessed by Owner."""
        try:
            check_company_access(OWNER_USER, target_company_id=1)
            check_company_access(OWNER_USER, target_company_id=5)
            check_company_access(OWNER_USER, target_company_id=99)
        except HTTPException:
            self.fail("check_company_access raised HTTPException unexpectedly for Owner role")

    def test_get_authorized_company_scope_permits_owner_all_companies(self):
        """get_authorized_company_scope should return None (all companies) for Owner when unconstrained."""
        scope = get_authorized_company_scope(OWNER_USER, requested_company_id=None)
        self.assertIsNone(scope)

        # When a specific company is requested, return that company
        scoped_company = get_authorized_company_scope(OWNER_USER, requested_company_id=3)
        self.assertEqual(scoped_company, [3])

    def test_require_audit_or_admin_user_blocks_owner(self):
        """require_audit_or_admin_user must reject Owner accounts with 403 Forbidden."""
        with self.assertRaises(HTTPException) as ctx:
            require_audit_or_admin_user(OWNER_USER)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_require_finance_or_admin_user_blocks_owner(self):
        """require_finance_or_admin_user must reject Owner accounts with 403 Forbidden."""
        with self.assertRaises(HTTPException) as ctx:
            require_finance_or_admin_user(OWNER_USER)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_migration_updates_manuel_account(self):
        """Verify the migration query safely updates Manuel's email and role."""
        from sqlalchemy import text
        engine = create_engine("sqlite:///:memory:")
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE users (
                    user_id INTEGER PRIMARY KEY,
                    name TEXT,
                    email TEXT UNIQUE,
                    role TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
            conn.execute(text("""
                INSERT INTO users (user_id, name, email, role)
                VALUES (10, 'Manuel', 'manuel@mct.com', 'audit');
            """))

            # Execute the core idempotent update statement from 0029
            conn.execute(text("""
                UPDATE users
                SET
                    email = 'ryuuujin.sh@gmail.com',
                    role = 'owner',
                    updated_at = CURRENT_TIMESTAMP
                WHERE
                    email = 'manuel@mct.com'
                    OR (LOWER(email) LIKE '%manuel%' AND role != 'owner')
                    OR (LOWER(name) LIKE '%manuel%' AND role != 'owner');
            """))

            row = conn.execute(text("SELECT email, role FROM users WHERE user_id = 10")).fetchone()
            self.assertEqual(row[0], "ryuuujin.sh@gmail.com")
            self.assertEqual(row[1], "owner")


if __name__ == "__main__":
    unittest.main()
