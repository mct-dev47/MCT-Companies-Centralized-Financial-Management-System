from __future__ import annotations

import os
import sys

os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, os.path.abspath("backend"))

import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.errors import RateLimitException
from app.db.session import Base
from app.main import app, add_security_cache_headers
from app.models.security import RateLimit, LoginOtpChallenge, RevokedToken, UserSession
from app.models.user import User, UserCompany
from app.schemas.auth import PasswordResetRequest
from app.services.auth_service import request_password_reset
from app.services.rate_limiter import (
    rate_limiter,
    get_password_reset_combo_key,
    get_password_reset_ip_key,
    get_invitation_admin_key,
    get_invitation_ip_key,
    check_invitation_rate_limit,
    record_invitation_attempt,
)
from app.services.session_service import (
    register_user_session,
    revoke_session,
    verify_refresh_cookie,
    create_refresh_cookie_payload,
)


class TestSecurityHardening(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(
            bind=self.engine,
            tables=[
                RateLimit.__table__,
                LoginOtpChallenge.__table__,
                RevokedToken.__table__,
                UserSession.__table__,
                User.__table__,
                UserCompany.__table__,
            ],
        )
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionLocal()

        # Seed a test user
        self.user = User(
            user_id=1,
            email="security.admin@mct.com",
            name="Security Admin",
            role="admin",
            is_admin=True,
            status="ACTIVE",
            token_version=1,
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)

    # 1. Security Headers Tests
    def _execute_middleware(self, req: Request) -> Response:
        def run_coro(coro):
            try:
                coro.send(None)
            except StopIteration as e:
                return e.value

        class AwaitableVal:
            def __init__(self, val):
                self.val = val
            def __await__(self):
                if False:
                    yield
                return self.val

        def fake_call_next(request):
            return AwaitableVal(Response(content=b"ok", status_code=200))

        return run_coro(add_security_cache_headers(req, fake_call_next))

    def test_security_headers_present_on_http_responses(self):
        req = Request({"type": "http", "method": "GET", "path": "/api/v1/test", "headers": []})
        response = self._execute_middleware(req)

        # Essential headers
        self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")
        self.assertEqual(response.headers.get("x-frame-options"), "DENY")
        self.assertEqual(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin")
        self.assertEqual(response.headers.get("x-xss-protection"), "0")

        # Content-Security-Policy
        csp = response.headers.get("content-security-policy", "")
        self.assertIn("default-src 'self'", csp)
        self.assertIn("frame-ancestors 'none'", csp)

    def test_hsts_header_on_https_or_production(self):
        req = Request({"type": "http", "method": "GET", "path": "/api/v1/test", "headers": [(b"x-forwarded-proto", b"https")]})
        response = self._execute_middleware(req)
        hsts = response.headers.get("strict-transport-security", "")
        self.assertIn("max-age=31536000", hsts)
        self.assertIn("includeSubDomains", hsts)

    # 2. Session Concurrency Tests
    def test_session_concurrency_allows_up_to_3_sessions(self):
        # Register 3 distinct sessions for user 1
        register_user_session(self.db, user_id=1, sid="sid_1", family_id="fam_1", ip_address="192.168.1.1")
        register_user_session(self.db, user_id=1, sid="sid_2", family_id="fam_2", ip_address="192.168.1.2")
        register_user_session(self.db, user_id=1, sid="sid_3", family_id="fam_3", ip_address="192.168.1.3")

        active_count = self.db.query(UserSession).filter(UserSession.user_id == 1).count()
        self.assertEqual(active_count, 3)

    def test_session_concurrency_evicts_oldest_session_on_fourth(self):
        # Register 3 sessions with staggered timestamps
        t0 = datetime.now(timezone.utc) - timedelta(hours=3)
        t1 = datetime.now(timezone.utc) - timedelta(hours=2)
        t2 = datetime.now(timezone.utc) - timedelta(hours=1)

        s1 = UserSession(session_id="sid_1", user_id=1, family_id="fam_1", ip_address="192.168.1.1", last_activity_at=t0)
        s2 = UserSession(session_id="sid_2", user_id=1, family_id="fam_2", ip_address="192.168.1.2", last_activity_at=t1)
        s3 = UserSession(session_id="sid_3", user_id=1, family_id="fam_3", ip_address="192.168.1.3", last_activity_at=t2)
        self.db.add_all([s1, s2, s3])
        self.db.commit()

        # Register 4th session -> should evict sid_1 (oldest)
        register_user_session(self.db, user_id=1, sid="sid_4", family_id="fam_4", ip_address="192.168.1.4")

        active_sessions = self.db.query(UserSession).filter(UserSession.user_id == 1).all()
        active_sids = {s.session_id for s in active_sessions}

        self.assertEqual(len(active_sessions), 3)
        self.assertNotIn("sid_1", active_sids)
        self.assertIn("sid_2", active_sids)
        self.assertIn("sid_3", active_sids)
        self.assertIn("sid_4", active_sids)

        # Check sid_1 family is in RevokedToken table
        import hashlib
        fam_1_hash = hashlib.sha256(b"fam_1").hexdigest()
        revoked = self.db.query(RevokedToken).filter(RevokedToken.token_hash == fam_1_hash).first()
        self.assertIsNotNone(revoked)

    # 3. Password Reset Rate Limiting Tests
    def test_password_reset_rate_limiting_locks_out_after_3_attempts(self):
        email = "security.admin@mct.com"
        ip = "198.51.100.22"

        combo_key, rate_type, identifier = get_password_reset_combo_key(email, ip)

        # 3 attempts
        for i in range(3):
            is_locked, attempts, _, _ = rate_limiter.record_attempt(
                self.db, combo_key, rate_type, identifier, max_attempts=3, window_minutes=30, lockout_minutes=30
            )
            if i < 2:
                self.assertFalse(is_locked)
            else:
                self.assertTrue(is_locked)

        # Subsequent check verifies lockout active
        is_locked, retry_after, _ = rate_limiter.check_rate_limit(self.db, combo_key)
        self.assertTrue(is_locked)
        self.assertGreater(retry_after, 0)

        # Request password reset through service raises RateLimitException
        with self.assertRaises(RateLimitException) as ctx:
            request_password_reset(self.db, PasswordResetRequest(email=email), ip_address=ip)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.code, "AUTH_RATE_LIMITED")

    # 4. Invitation Rate Limiting Tests
    def test_invitation_rate_limit_enforces_5_per_hour_for_admin(self):
        admin_id = 1
        ip = "192.168.1.50"

        # Record 5 invitations
        for _ in range(5):
            check_invitation_rate_limit(self.db, admin_id=admin_id, ip=ip)
            record_invitation_attempt(self.db, admin_id=admin_id, ip=ip)

        # 6th attempt must be rejected with 429
        with self.assertRaises(RateLimitException) as ctx:
            check_invitation_rate_limit(self.db, admin_id=admin_id, ip=ip)

        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.code, "INVITATION_RATE_LIMITED")
        self.assertGreater(ctx.exception.retry_after, 0)

    def test_invitation_rate_limit_enforces_15_per_hour_for_ip(self):
        ip = "203.0.113.88"

        # 15 invitations across different admins from same untrusted IP
        for admin_idx in range(15):
            record_invitation_attempt(self.db, admin_id=100 + admin_idx, ip=ip)

        # 16th invitation from that IP must be blocked
        with self.assertRaises(RateLimitException) as ctx:
            check_invitation_rate_limit(self.db, admin_id=999, ip=ip)

        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.code, "INVITATION_IP_RATE_LIMITED")


if __name__ == "__main__":
    unittest.main()
