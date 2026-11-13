import os

os.environ.setdefault("TESTING", "1")

import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch
from fastapi import Response
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.health import check_db_connection
from app.core.config import Settings
from app.core.errors import (
    _crash_alert_last_sent,
    _record_and_send_crash_alert,
    resolve_admin_email,
)
from app.db.migrations import MIGRATIONS_DIR, run_migrations
from app.db.session import Base, create_db_engine
from app.models.audit_log import AuditLog
from app.models.bank import BankAccount
from app.models.user import User
from app.schemas.bank import BankDepositWithdrawRequest
from app.services.bank_service import BankService


class TestProductionReadiness(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        _crash_alert_last_sent.clear()

    def tearDown(self):
        self.engine.dispose()
        _crash_alert_last_sent.clear()

    def test_production_db_engine_refuses_sqlite_and_fails_fast(self):
        """In ENVIRONMENT=production, missing or SQLite DATABASE_URL or failed Postgres probe must raise RuntimeError."""
        with self.assertRaises(RuntimeError) as ctx_empty:
            create_db_engine(raw_db_url="", environment="production", is_testing=False)
        self.assertIn("CRITICAL", str(ctx_empty.exception))

        with self.assertRaises(RuntimeError) as ctx_sqlite:
            create_db_engine(raw_db_url="sqlite:///local.db", environment="production", is_testing=False)
        self.assertIn("SQLite fallback is disabled in production", str(ctx_sqlite.exception))

        with patch("app.db.session.create_engine", side_effect=Exception("Connection timed out")):
            with self.assertRaises(RuntimeError) as ctx_conn_fail:
                create_db_engine(
                    raw_db_url="postgresql://user:pass@unreachable-host:5432/db",
                    environment="production",
                    is_testing=False,
                )
            self.assertIn("Refusing to fall back to local SQLite in production", str(ctx_conn_fail.exception))

    def test_production_settings_auto_enforces_secure_cookies(self):
        """ENVIRONMENT=production must automatically enforce OTP_COOKIE_SECURE=True."""
        prod_settings = Settings(
            ENVIRONMENT="production",
            OTP_COOKIE_SECURE=False,
            SUPABASE_JWT_SECRET="prod-jwt-secret-key-at-least-32-characters-long",
        )
        self.assertTrue(prod_settings.OTP_COOKIE_SECURE)

    def test_production_settings_auto_derives_frontend_url_from_cors_origins(self):
        """In production, if FRONTEND_URL is default localhost, auto-adopt the primary HTTPS CORS origin."""
        prod_settings = Settings(
            ENVIRONMENT="production",
            CORS_ORIGINS=["https://financial-mct.vercel.app", "https://admin.mct.com"],
            SUPABASE_JWT_SECRET="prod-jwt-secret-key-at-least-32-characters-long",
        )
        self.assertEqual(prod_settings.FRONTEND_URL, "https://financial-mct.vercel.app")
        self.assertIn("https://financial-mct.vercel.app", prod_settings.CORS_ORIGINS)

    def test_production_settings_custom_frontend_url_normalized_and_added_to_cors(self):
        """Custom FRONTEND_URL has trailing slashes stripped and is added to CORS_ORIGINS."""
        prod_settings = Settings(
            ENVIRONMENT="production",
            FRONTEND_URL="https://portal.mctcompanies.com/   ",
            CORS_ORIGINS=["https://financial-mct.vercel.app"],
            SUPABASE_JWT_SECRET="prod-jwt-secret-key-at-least-32-characters-long",
        )
        self.assertEqual(prod_settings.FRONTEND_URL, "https://portal.mctcompanies.com")
        self.assertIn("https://portal.mctcompanies.com", prod_settings.CORS_ORIGINS)

    def test_migration_0052_has_no_hardcoded_email_and_syncs_is_admin(self):
        """Migration 0052 files must not contain hardcoded personal emails and must sync is_admin."""
        pg_sql = (MIGRATIONS_DIR / "0052_update_admin_email.postgres.sql").read_text(encoding="utf-8")
        sq_sql = (MIGRATIONS_DIR / "0052_update_admin_email.sqlite.sql").read_text(encoding="utf-8")
        self.assertNotIn("@gmail.com", pg_sql)
        self.assertNotIn("@gmail.com", sq_sql)
        self.assertIn("is_admin", pg_sql)
        self.assertIn("is_admin", sq_sql)

        with self.SessionLocal() as db:
            db.add(User(user_id=1, email="dynamic.admin@mct.com", name="Admin", role="supervisor", is_admin=True))
            db.commit()

        run_migrations(self.engine)

        with self.SessionLocal() as db:
            u = db.query(User).filter(User.user_id == 1).first()
            self.assertEqual(u.email, "dynamic.admin@mct.com")
            self.assertTrue(u.is_admin)
            self.assertEqual(u.role, "admin")

    def test_resolve_admin_email_uses_is_admin_and_crash_alert_respects_cooldown(self):
        """Built-in 500 crash alert dynamically resolves the is_admin user, logs SYSTEM_CRASH_500, and deduplicates."""
        with self.SessionLocal() as db:
            db.add(User(user_id=7, email="secops.admin@mct.com", name="SecOps Admin", role="admin", is_admin=True))
            db.commit()
            resolved = resolve_admin_email(db)
            self.assertEqual(resolved, "secops.admin@mct.com")

        with patch("app.db.session.SessionLocal", self.SessionLocal), \
             patch("app.services.email_service.send_transactional_email", return_value=True) as mock_email:
            first_sent = _record_and_send_crash_alert(
                request_id="req-crash-001",
                method="POST",
                path="/api/v1/sales",
                client_ip="10.0.0.5",
                exc_type="ZeroDivisionError",
                error_category="SERVER_CRASH",
            )
            self.assertTrue(first_sent)
            mock_email.assert_called_once()
            self.assertEqual(mock_email.call_args.kwargs["recipient_email"], "secops.admin@mct.com")

            # Immediate duplicate on same endpoint & exception must be suppressed by cooldown
            second_sent = _record_and_send_crash_alert(
                request_id="req-crash-002",
                method="POST",
                path="/api/v1/sales",
                client_ip="10.0.0.5",
                exc_type="ZeroDivisionError",
                error_category="SERVER_CRASH",
            )
            self.assertFalse(second_sent)
            self.assertEqual(mock_email.call_count, 1)

        with self.SessionLocal() as db:
            import json
            crash_logs = db.query(AuditLog).filter(AuditLog.action == "SYSTEM_CRASH_500").all()
            self.assertEqual(len(crash_logs), 1)
            raw_details = crash_logs[0].details
            details = json.loads(raw_details) if isinstance(raw_details, str) else raw_details
            self.assertEqual(details.get("request_id"), "req-crash-001")

    def test_health_db_readiness_probe_returns_503_when_db_down(self):
        """/api/v1/health/db returns 200 when connected and 503 when database connection fails."""
        ok_resp = Response()
        with patch("app.api.v1.endpoints.health.engine", self.engine):
            res_ok = check_db_connection(response=ok_resp)
            self.assertEqual(res_ok["status"], "ok")
            self.assertNotEqual(ok_resp.status_code, 503)

        fail_resp = Response()
        broken_engine = MagicMock()
        broken_engine.connect.side_effect = RuntimeError("DB unreachable")
        with patch("app.api.v1.endpoints.health.engine", broken_engine):
            res_fail = check_db_connection(response=fail_resp)
            self.assertEqual(res_fail["status"], "degraded")
            self.assertEqual(fail_resp.status_code, 503)

        # If Supabase API check throws an error while SQLAlchemy is up, status is "degraded"
        sb_err_resp = Response()
        with patch("app.api.v1.endpoints.health.engine", self.engine), \
             patch("app.api.v1.endpoints.health.get_supabase_client", side_effect=RuntimeError("Supabase REST error")):
            res_sb_err = check_db_connection(response=sb_err_resp)
            self.assertEqual(res_sb_err["status"], "degraded")
            self.assertEqual(res_sb_err["database_checks"]["supabase_api"], "error: connection failed")

    def test_generic_supabase_test_guard_and_cached_admin_email_fallback(self):
        """Generic test guard blocks any .supabase.co host in TESTING=1 and resolve_admin_email caches last known admin."""
        from app.db.supabase import _is_blocked_live_supabase_in_test

        with patch.dict(os.environ, {"TESTING": "1"}, clear=False), \
             patch("app.db.supabase.settings.SUPABASE_URL", "https://any-other-project.supabase.co"):
            self.assertTrue(_is_blocked_live_supabase_in_test())

        with patch.dict(os.environ, {"TESTING": "1", "ALLOW_LIVE_SUPABASE_IN_TEST": "1"}, clear=False), \
             patch("app.db.supabase.settings.SUPABASE_URL", "https://any-other-project.supabase.co"):
            self.assertFalse(_is_blocked_live_supabase_in_test())

        with self.SessionLocal() as db:
            db.add(User(user_id=9, email="cached.admin@mct.com", name="Cached Admin", role="admin", is_admin=True))
            db.commit()
            self.assertEqual(resolve_admin_email(db), "cached.admin@mct.com")

        # Simulate total DB outage where db.query raises an exception and ADMIN_EMAIL is empty
        broken_db = MagicMock()
        broken_db.query.side_effect = RuntimeError("Total DB outage")
        with patch("app.core.errors.settings.ADMIN_EMAIL", ""):
            self.assertEqual(resolve_admin_email(broken_db), "cached.admin@mct.com")

    def test_bank_service_uses_row_locking_on_deposit_and_withdraw(self):
        """BankService.deposit and withdraw acquire a row lock via _get_account_for_update."""
        with self.SessionLocal() as db:
            acct = BankAccount(
                id="bnk-001",
                bank_name="BDO",
                account_name="MCT Main",
                account_number="1234-5678",
                company_name="MCT",
                starting_balance=Decimal("1000.00"),
                current_balance=Decimal("1000.00"),
            )
            db.add(acct)
            db.commit()

            svc = BankService(db)
            with patch.object(svc, "_get_account_for_update", wraps=svc._get_account_for_update) as spy_lock:
                svc.deposit("bnk-001", BankDepositWithdrawRequest(amount=Decimal("500.00"), particulars="Dep"))
                svc.withdraw("bnk-001", BankDepositWithdrawRequest(amount=Decimal("200.00"), particulars="Wdr"))
                self.assertEqual(spy_lock.call_count, 2)

    def test_supabase_client_memoization_and_bounded_timeouts(self):
        """Supabase clients are singleton-cached and configured with bounded timeouts."""
        from app.db.supabase import (
            _get_client_options,
            get_supabase_admin_client,
            reset_supabase_clients,
            DEFAULT_SUPABASE_TIMEOUT_SECONDS,
        )

        opts = _get_client_options()
        self.assertEqual(opts.postgrest_client_timeout, DEFAULT_SUPABASE_TIMEOUT_SECONDS)
        self.assertEqual(DEFAULT_SUPABASE_TIMEOUT_SECONDS, 8)

        reset_supabase_clients()
        mock_client = MagicMock()
        with patch("app.db.supabase._is_blocked_live_supabase_in_test", return_value=False), \
             patch("app.db.supabase.settings.SUPABASE_URL", "https://mock.supabase.co"), \
             patch("app.db.supabase.settings.SUPABASE_KEY", "mock-key"), \
             patch("app.db.supabase.create_client", return_value=mock_client) as mock_create:
            c1 = get_supabase_admin_client()
            c2 = get_supabase_admin_client()
            self.assertIs(c1, c2)
            mock_create.assert_called_once()

            reset_supabase_clients()
            c3 = get_supabase_admin_client()
            self.assertEqual(mock_create.call_count, 2)

    def test_get_application_user_network_timeout_skips_redundant_retry(self):
        """When query 1 to Supabase fails due to network timeout, query 2 is skipped and local DB is used."""
        from app.services.auth_service import _get_application_user

        with self.SessionLocal() as db:
            db.add(User(user_id=42, email="fallback.user@mct.com", name="Fallback User", role="finance", is_admin=False))
            db.commit()

        mock_admin = MagicMock()
        # Query 1 raises TimeoutError
        mock_admin.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = TimeoutError("Connection timed out")

        with patch("app.services.auth_service.get_supabase_admin_client", return_value=mock_admin), \
             patch("app.db.session.SessionLocal", self.SessionLocal):
            user = _get_application_user(email="fallback.user@mct.com")
            self.assertIsNotNone(user)
            self.assertEqual(user["email"], "fallback.user@mct.com")
            self.assertEqual(user["role"], "finance")
            # Query 1 was called once; query 2 was NOT called because network timeout bypassed redundant query
            self.assertEqual(mock_admin.table.return_value.select.call_count, 1)


if __name__ == "__main__":
    unittest.main()
