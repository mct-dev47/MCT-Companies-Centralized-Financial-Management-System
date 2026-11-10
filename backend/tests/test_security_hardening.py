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
    verify_csrf_header,
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

    # 5. CORS Hardening Tests
    def test_cors_rejects_wildcard_origin_with_credentials(self):
        """Settings rejects wildcard origin '*' when credentials are true."""
        from pydantic import ValidationError
        from app.core.config import Settings

        with self.assertRaises(ValidationError) as ctx:
            Settings(CORS_ORIGINS=["*"])
        self.assertIn("Wildcard CORS origin '*' cannot be combined with credentials", str(ctx.exception))

    def test_cors_middleware_uses_explicit_methods_and_headers(self):
        """Verify CORSMiddleware uses explicit method and header allowlists instead of wildcards."""
        from starlette.middleware.cors import CORSMiddleware
        cors_mw = next((m for m in app.user_middleware if m.cls == CORSMiddleware), None)
        self.assertIsNotNone(cors_mw, "CORSMiddleware not found in app user_middleware")

        kwargs = cors_mw.kwargs
        self.assertTrue(kwargs.get("allow_credentials"))
        self.assertNotIn("*", kwargs.get("allow_methods", []))
        self.assertNotIn("*", kwargs.get("allow_headers", []))
        self.assertIn("GET", kwargs.get("allow_methods", []))
        self.assertIn("POST", kwargs.get("allow_methods", []))
        self.assertIn("Authorization", kwargs.get("allow_headers", []))
        self.assertIn("X-MCT-CSRF", kwargs.get("allow_headers", []))
        self.assertIn("X-Requested-With", kwargs.get("allow_headers", []))
        self.assertIn("Idempotency-Key", kwargs.get("allow_headers", []))
        self.assertIn("X-User-Role", kwargs.get("allow_headers", []))
        self.assertIn("X-User-Name", kwargs.get("allow_headers", []))

    # 6. CSRF Protection Tests
    def test_csrf_header_verification_blocks_missing_custom_header(self):
        """State-changing cookie requests without custom header are rejected with 403."""
        req = Request({"type": "http", "method": "POST", "path": "/api/v1/auth/login/verify-otp", "headers": []})
        with self.assertRaises(HTTPException) as ctx:
            verify_csrf_header(req)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("CSRF header verification failed", ctx.exception.detail)

    def test_csrf_header_verification_blocks_untrusted_origin(self):
        """Requests with custom header but untrusted Origin are rejected with 403."""
        headers = [
            (b"x-mct-csrf", b"1"),
            (b"origin", b"http://malicious-attacker.com"),
        ]
        req = Request({"type": "http", "method": "POST", "path": "/api/v1/auth/login/verify-otp", "headers": headers})
        with self.assertRaises(HTTPException) as ctx:
            verify_csrf_header(req)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("origin verification failed", ctx.exception.detail)

    def test_csrf_header_verification_blocks_untrusted_referer(self):
        """Requests with custom header but untrusted Referer are rejected with 403."""
        headers = [
            (b"x-mct-csrf", b"1"),
            (b"referer", b"http://evil-site.org/phishing"),
        ]
        req = Request({"type": "http", "method": "POST", "path": "/api/v1/auth/login/verify-otp", "headers": headers})
        with self.assertRaises(HTTPException) as ctx:
            verify_csrf_header(req)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("referer verification failed", ctx.exception.detail)

    def test_csrf_header_verification_passes_with_trusted_origin(self):
        """Requests with custom header and trusted origin (including mixed-case) pass CSRF verification."""
        trusted_origin = settings.CORS_ORIGINS[0].encode("utf-8")
        headers = [
            (b"x-mct-csrf", b"1"),
            (b"origin", trusted_origin),
        ]
        req = Request({"type": "http", "method": "POST", "path": "/api/v1/auth/login/verify-otp", "headers": headers})
        # Must not raise
        verify_csrf_header(req)

        # Test case-insensitivity
        mixed_case_origin = settings.CORS_ORIGINS[0].replace("http://", "HTTP://").encode("utf-8")
        req_mixed = Request({"type": "http", "method": "POST", "path": "/api/v1/auth/login/verify-otp", "headers": [(b"x-mct-csrf", b"1"), (b"origin", mixed_case_origin)]})
        verify_csrf_header(req_mixed)

    # 7. Content Security Policy Tests
    def test_csp_header_disallows_unsafe_eval_and_includes_hardening_directives(self):
        """CSP removes unsafe-eval and adds object-src 'none', base-uri 'self', and form-action 'self'."""
        req = Request({"type": "http", "method": "GET", "path": "/api/v1/test", "headers": []})
        response = self._execute_middleware(req)
        csp = response.headers.get("content-security-policy", "")

        self.assertNotIn("'unsafe-eval'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertIn("base-uri 'self'", csp)
        self.assertIn("form-action 'self'", csp)
        self.assertIn("https://cdn.jsdelivr.net", csp)

    # 8. SSRF Prevention Tests
    def test_ssrf_validator_blocks_internal_and_cloud_metadata_ips(self):
        """validate_safe_url blocks private, loopback, and cloud metadata destinations."""
        from app.core.ssrf import validate_safe_url

        blocked_urls = [
            "http://127.0.0.1:8000/internal",
            "http://10.0.0.5/api",
            "http://192.168.1.1/router",
            "http://172.16.0.1/admin",
            "http://169.254.169.254/latest/meta-data/",
            "file:///etc/passwd",
            "ftp://ftp.example.com",
            "gopher://evil.com",
        ]
        for url in blocked_urls:
            with self.assertRaises(ValueError):
                validate_safe_url(url, allow_localhost_dev=False)

    def test_company_schema_ssrf_validation(self):
        """CompanyCreate rejects SSRF URLs in logo_url."""
        from pydantic import ValidationError
        from app.schemas.company import CompanyCreate

        with self.assertRaises(ValidationError) as ctx:
            CompanyCreate(
                name="Test Co",
                location="Manila",
                logo_url="http://169.254.169.254/metadata",
            )
        self.assertIn("SSRF security violation", str(ctx.exception))

    def test_petty_cash_schema_ssrf_validation(self):
        """PettyCashTopUpCreate rejects SSRF URLs in receipt_url."""
        from pydantic import ValidationError
        from app.schemas.petty_cash import PettyCashTopUpCreate
        from datetime import date

        with self.assertRaises(ValidationError) as ctx:
            PettyCashTopUpCreate(
                company_id=1,
                amount="100.00",
                topup_date=date.today(),
                receipt_url="http://192.168.1.1/secret.jpg",
            )
        self.assertIn("SSRF security violation", str(ctx.exception))

    def test_user_schema_ssrf_validation(self):
        """UserCreate and UserUpdate reject SSRF URLs in photo_url."""
        from pydantic import ValidationError
        from app.schemas.user import UserCreate, UserUpdate

        with self.assertRaises(ValidationError) as ctx:
            UserCreate(
                name="Security Test",
                email="security.test@gmail.com",
                photo_url="http://169.254.169.254/latest/meta-data/",
            )
        self.assertIn("SSRF security violation", str(ctx.exception))

        with self.assertRaises(ValidationError) as ctx:
            UserUpdate(
                photo_url="http://192.168.1.1/avatar.png",
            )
        self.assertIn("SSRF security violation", str(ctx.exception))

    def test_user_response_accepts_storage_path(self):
        """UserResponse serialization accepts relative storage object paths without error."""
        from app.schemas.user import UserResponse

        resp = UserResponse(
            user_id=26,
            name="Test User",
            email="test.user@gmail.com",
            photo_url="user/26/475baab5f6d142cc839187d5d1d87994.png",
        )
        self.assertEqual(resp.photo_url, "user/26/475baab5f6d142cc839187d5d1d87994.png")

    def test_user_schema_allows_relative_storage_paths(self):
        """UserCreate and UserUpdate accept relative storage paths and relative URLs."""
        from app.schemas.user import UserCreate, UserUpdate

        created = UserCreate(
            name="Test Create",
            email="test.create@gmail.com",
            photo_url="user/26/475baab5f6d142cc839187d5d1d87994.png",
        )
        self.assertEqual(created.photo_url, "user/26/475baab5f6d142cc839187d5d1d87994.png")

        updated = UserUpdate(
            photo_url="/api/v1/users/26/picture",
        )
        self.assertEqual(updated.photo_url, "/api/v1/users/26/picture")

    def test_ssrf_validator_relative_url_behavior(self):
        """validate_safe_url accepts relative paths only when allow_relative=True."""
        from app.core.ssrf import validate_safe_url

        # allow_relative=True allows safe relative paths
        self.assertEqual(
            validate_safe_url("user/26/photo.png", allow_relative=True),
            "user/26/photo.png",
        )
        self.assertEqual(
            validate_safe_url("/api/v1/users/26/picture", allow_relative=True),
            "/api/v1/users/26/picture",
        )

        # allow_relative=True still rejects protocol-relative SSRF attacks
        with self.assertRaises(ValueError):
            validate_safe_url("//169.254.169.254/metadata", allow_relative=True)

        # allow_relative=False (default) rejects scheme-less URLs
        with self.assertRaises(ValueError):
            validate_safe_url("user/26/photo.png", allow_relative=False)

    # 9. Generic Production Error & Database Leakage Prevention Tests
    def test_sqlalchemy_exception_handler_returns_generic_error_without_leaking_sql(self):
        """SQLAlchemyError handler returns generic 500 without leaking SQL table/query details."""
        from app.core.errors import sqlalchemy_exception_handler
        from sqlalchemy.exc import OperationalError

        req = Request({"type": "http", "method": "GET", "path": "/api/v1/test", "headers": []})
        sensitive_sql_error = OperationalError(
            statement="SELECT user_id, password_hash, secret_key FROM users WHERE is_admin = 1;",
            params={},
            orig=Exception("connection to server at 'internal-db.corp' failed"),
        )
        res = sqlalchemy_exception_handler(req, sensitive_sql_error)

        import json
        body = json.loads(res.body.decode("utf-8"))
        self.assertEqual(res.status_code, 500)
        self.assertEqual(body.get("code"), "DATABASE_ERROR")
        self.assertEqual(body.get("detail"), "A database error occurred. Please try again later.")
        self.assertNotIn("password_hash", str(body))
        self.assertNotIn("internal-db.corp", str(body))
        self.assertIn("request_id", body)

    def test_production_http_500_masks_sensitive_internal_traceback(self):
        """http_exception_handler in production mode sanitizes 5xx details."""
        from app.core.errors import http_exception_handler
        from starlette.exceptions import HTTPException as StarletteHTTPException

        req = Request({"type": "http", "method": "GET", "path": "/api/v1/test", "headers": []})
        exc = StarletteHTTPException(
            status_code=500,
            detail="Sensitive internal error: /var/secrets/key.pem corrupted at line 42",
        )

        with patch.object(settings, "ENVIRONMENT", "production"):
            res = http_exception_handler(req, exc)
            import json
            body = json.loads(res.body.decode("utf-8"))
            self.assertEqual(res.status_code, 500)
            self.assertEqual(body.get("detail"), "An internal server error occurred. Please try again later.")
            self.assertNotIn("/var/secrets", str(body))

    # 10. API Documentation Protection in Production Tests
    def test_production_docs_endpoint_requires_admin_authentication(self):
        """In production, accessing docs endpoint requires admin credentials."""
        from app.main import _get_admin_for_docs

        # Unauthenticated request raises 401
        req_unauth = Request({"type": "http", "method": "GET", "path": "/docs", "headers": [], "query_string": b""})
        with self.assertRaises(HTTPException) as ctx:
            _get_admin_for_docs(req_unauth, self.db)
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIn("Admin authentication required", ctx.exception.detail)

    def test_root_endpoint_omits_docs_url_in_production(self):
        """In production, root GET / omits docs_url."""
        from app.main import root
        import app.main as main_mod

        with patch.object(main_mod, "enable_open_docs", False):
            res = root()
            self.assertNotIn("docs_url", res)
            self.assertIn("health_check", res)


if __name__ == "__main__":
    unittest.main()
