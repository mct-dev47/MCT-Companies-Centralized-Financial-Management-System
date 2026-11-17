"""
Test Database Migrations Runner and Schema Migrations (spec 0020).
Verifies:
1. Migration runner correctly applies forward migrations to SQLite.
2. Migration idempotency: running migrations multiple times succeeds without errors.
3. Schema tracking: schema_migrations records applied versions.
4. Schema validation: users has status and must_change_password columns;
   user_invitations and invitation_outbox tables are created with proper indexes.
5. Migration runner respects already applied migrations.
"""
import os
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.abspath("backend"))

from sqlalchemy import create_engine, text, inspect
from app.db.migrations import run_migrations, get_applied_migrations


class TestMigrations(unittest.TestCase):
    def setUp(self):
        # Create an in-memory SQLite database simulating a fresh database with v0001 schema
        self.engine = create_engine("sqlite:///:memory:")
        with self.engine.begin() as conn:
            # Baseline users table without status or must_change_password
            conn.execute(text("""
                CREATE TABLE users (
                    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    auth_user_id VARCHAR(128) UNIQUE,
                    company_id INTEGER,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    full_name VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
            # Insert a baseline legacy user
            conn.execute(text("""
                INSERT INTO users (auth_user_id, email, full_name, role)
                VALUES ('auth_seed_1', 'legacy@gmail.com', 'Legacy User', 'supervisor');
            """))

    def tearDown(self):
        self.engine.dispose()

    def test_forward_migration_applies_cleanly(self):
        """Verify that running migrations applies 0002 and records it in schema_migrations."""
        # Run migrations
        applied = run_migrations(self.engine)
        self.assertIn("0002_user_status_and_invitations", applied)

        # Verify schema_migrations table contains the version
        history = get_applied_migrations(self.engine)
        self.assertIn("0002_user_status_and_invitations", history)

        # Inspect columns of users
        inspector = inspect(self.engine)
        user_cols = {col["name"]: col for col in inspector.get_columns("users")}
        self.assertIn("status", user_cols)
        self.assertIn("must_change_password", user_cols)

        # Check existing user was backfilled to ACTIVE and must_change_password = 0
        with self.engine.connect() as conn:
            row = conn.execute(text("SELECT status, must_change_password FROM users WHERE email = 'legacy@gmail.com'")).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "ACTIVE")
            self.assertEqual(row[1], 0)

        # Verify new tables exist
        table_names = inspector.get_table_names()
        self.assertIn("user_invitations", table_names)
        self.assertIn("invitation_outbox", table_names)
        self.assertIn("rate_limits", table_names)
        self.assertIn("login_otp_challenges", table_names)
        self.assertIn("user_sessions", table_names)
        self.assertIn("schema_migrations", table_names)
        self.assertIn("0043_user_sessions", applied)

        # Verify indexes on invitation_outbox
        outbox_indexes = [idx["name"] for idx in inspector.get_indexes("invitation_outbox")]
        self.assertTrue(any("status" in idx or "claim" in idx or "idx" in idx for idx in outbox_indexes))

    def test_migration_idempotency(self):
        """Verify that running migrations a second or third time does nothing and does not fail."""
        # First execution
        first_run = run_migrations(self.engine)
        self.assertIn("0002_user_status_and_invitations", first_run)

        # Second execution
        second_run = run_migrations(self.engine)
        self.assertEqual(second_run, [], "Subsequent run should not re-apply existing migrations")

        # Third execution
        third_run = run_migrations(self.engine)
        self.assertEqual(third_run, [])

        # Schema remains intact and verified
        inspector = inspect(self.engine)
        self.assertIn("users", inspector.get_table_names())
        self.assertIn("user_invitations", inspector.get_table_names())
        self.assertIn("invitation_outbox", inspector.get_table_names())

    def test_migration_0067_drops_legacy_columns_and_nulls_orphan_company_id(self):
        """Verify 0067 drops unused company and bank_accounts columns and nulls orphan company_id."""
        with self.engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE company (
                    company_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_name VARCHAR(100) NOT NULL,
                    location VARCHAR(100) NOT NULL,
                    contact_person VARCHAR(100),
                    email VARCHAR(100),
                    current_balance NUMERIC(15, 2),
                    starting_balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00
                );
            """))
            conn.execute(text("""
                CREATE TABLE bank_accounts (
                    id VARCHAR(100) PRIMARY KEY,
                    bank_name VARCHAR(255) NOT NULL,
                    account_name VARCHAR(255) NOT NULL,
                    account_number VARCHAR(100) NOT NULL DEFAULT '0000',
                    company_name VARCHAR(255) NOT NULL,
                    company_id INTEGER,
                    notes TEXT
                );
            """))
            conn.execute(text("INSERT INTO company (company_id, company_name, location, starting_balance) VALUES (1, 'Valid Co', 'Manila', 100.00)"))
            conn.execute(text("INSERT INTO bank_accounts (id, bank_name, account_name, company_name, company_id) VALUES ('bnk-1', 'BDO', 'Main', 'Valid Co', 1)"))
            conn.execute(text("INSERT INTO bank_accounts (id, bank_name, account_name, company_name, company_id) VALUES ('bnk-2', 'BPI', 'Orphan', 'Missing Co', 999)"))

        applied = run_migrations(self.engine)
        self.assertIn("0067_company_bank_schema_cleanup", applied)

        inspector = inspect(self.engine)
        company_cols = {col["name"] for col in inspector.get_columns("company")}
        bank_cols = {col["name"] for col in inspector.get_columns("bank_accounts")}
        for dropped in ("contact_person", "email", "current_balance", "starting_balance"):
            self.assertNotIn(dropped, company_cols)
        for dropped in ("account_number", "notes"):
            self.assertNotIn(dropped, bank_cols)

        with self.engine.connect() as conn:
            valid_cid = conn.execute(text("SELECT company_id FROM bank_accounts WHERE id = 'bnk-1'")).scalar()
            orphan_cid = conn.execute(text("SELECT company_id FROM bank_accounts WHERE id = 'bnk-2'")).scalar()
            self.assertEqual(valid_cid, 1)
            self.assertIsNone(orphan_cid)


if __name__ == "__main__":
    unittest.main()

