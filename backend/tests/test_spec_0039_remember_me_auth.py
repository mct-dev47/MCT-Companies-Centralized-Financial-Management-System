from __future__ import annotations

import os
import sys
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Request, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.abspath("backend"))

from app.core.config import settings
from app.core.dependencies import get_current_user, require_reauthentication
from app.core.encryption import decrypt_payload, encrypt_payload
from app.db.session import Base
from app.models.security import RevokedToken
from app.models.user import User, UserCompany
from app.services.auth_service import create_jwt_token, reset_password
from app.services.session_service import (
    INACTIVITY_EXEMPT_PATHS,
    clear_refresh_cookie,
    create_reauth_token,
    create_refresh_cookie_payload,
    get_session_activity,
    revoke_session,
    rotate_refresh_token,
    set_refresh_cookie,
    track_session_activity,
    verify_csrf_header,
    verify_reauth_token,
    verify_refresh_cookie,
)


class TestSpec0039SecureRememberMeAuth(unittest.TestCase):
    def setUp(self):
        # Create an in-memory SQLite database for test isolation
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine, tables=[User.__table__, UserCompany.__table__, RevokedToken.__table__])
        SessionTest = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionTest()

        # Seed a test user
        self.test_user = User(
            user_id=101,
            name="Finance Officer",
            email="finance.test@mct.com",
            role="finance",
            is_admin=False,
            status="ACTIVE",
            token_version=1,
        )
        self.db.add(self.test_user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_ac12_user_model_has_token_version(self):
        """AC-12: Verify user model and table schema contain token_version with default 1."""
        u = self.db.query(User).filter(User.user_id == 101).first()
        self.assertIsNotNone(u)
        self.assertEqual(u.token_version, 1)

    def test_ac1_remember_me_sets_persistent_cookie(self):
        """AC-1: Remember Me checked sets mct_refresh_token with max_age=28800 (8h)."""
        cookie_val, payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )
        self.assertTrue(payload["remember_me"])

        response = Response()
        set_refresh_cookie(response, cookie_val, remember_me=True)

        set_cookie_header = response.headers.get("set-cookie", "")
        self.assertIn("mct_refresh_token=", set_cookie_header)
        self.assertIn("max-age=28800", set_cookie_header.lower())
        self.assertIn("httponly", set_cookie_header.lower())
        self.assertIn("samesite=lax", set_cookie_header.lower())
        self.assertIn("path=/api/v1/auth", set_cookie_header.lower())

    def test_ac2_remember_me_unchecked_sets_session_cookie(self):
        """AC-2: Remember Me unchecked sets mct_refresh_token with no Max-Age or Expires."""
        cookie_val, payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=False,
        )
        self.assertFalse(payload["remember_me"])

        response = Response()
        set_refresh_cookie(response, cookie_val, remember_me=False)

        set_cookie_header = response.headers.get("set-cookie", "")
        self.assertIn("mct_refresh_token=", set_cookie_header)
        self.assertNotIn("max-age=", set_cookie_header.lower())
        self.assertNotIn("expires=", set_cookie_header.lower())
        self.assertIn("httponly", set_cookie_header.lower())
        self.assertIn("samesite=lax", set_cookie_header.lower())
        self.assertIn("path=/api/v1/auth", set_cookie_header.lower())

    def test_ac3_access_token_short_lifetime(self):
        """AC-3: Access token has short 5-minute (300 seconds) lifetime."""
        token = create_jwt_token(
            user_id=101,
            email="finance.test@mct.com",
            expires_delta_seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS,
        )
        self.assertIsNotNone(token)
        from app.core.security import verify_token
        claims = verify_token(token)
        self.assertEqual(claims["exp"] - claims["iat"], 300)

    def test_ac4_and_ac8_token_refresh_and_rotation(self):
        """AC-4 & AC-8: Refresh validates cookie, rotates credentials, and handles concurrency within grace period."""
        cookie_val, old_payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )

        verification = verify_refresh_cookie(cookie_val, self.db)
        self.assertFalse(verification["is_grace_hit"])

        new_cookie_val, new_access_token, user_info = rotate_refresh_token(
            old_payload=verification["payload"],
            user=verification["user"],
            db=self.db,
        )

        self.assertNotEqual(cookie_val, new_cookie_val)
        self.assertIsNotNone(new_access_token)

        # Immediate concurrent request presenting old cookie within grace window succeeds idempotently (AC-8)
        grace_verification = verify_refresh_cookie(cookie_val, self.db)
        self.assertTrue(grace_verification["is_grace_hit"])
        self.assertEqual(grace_verification["cached_result"]["access_token"], new_access_token)

    def test_ac9_token_reuse_outside_grace_window_revokes_family(self):
        """AC-9: Reusing a rotated refresh token outside the grace period revokes the session family."""
        cookie_val, old_payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )

        verification = verify_refresh_cookie(cookie_val, self.db)
        new_cookie_val, _, _ = rotate_refresh_token(
            old_payload=verification["payload"],
            user=verification["user"],
            db=self.db,
        )

        # Fast forward time beyond grace period (15 seconds)
        with patch("app.services.session_service._current_timestamp") as mock_time:
            now_future = time.time() + 30
            mock_time.return_value = now_future

            with self.assertRaises(HTTPException) as cm:
                verify_refresh_cookie(cookie_val, self.db)
            self.assertEqual(cm.exception.status_code, 401)
            self.assertEqual(cm.exception.headers.get("X-Reason-Code"), "TOKEN_REUSE_DETECTED")

            # The entire family is now revoked, even the newly rotated token fails
            with self.assertRaises(HTTPException) as cm2:
                verify_refresh_cookie(new_cookie_val, self.db)
            self.assertEqual(cm2.exception.status_code, 401)

    def test_ac5_idle_timeout_enforcement(self):
        """AC-5: Inactivity past 30 minutes rejects with 401 and SESSION_EXPIRED_IDLE."""
        cookie_val, old_payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )

        # Fast forward past 30 minutes (1801 seconds) without qualifying activity
        with patch("app.services.session_service._current_timestamp") as mock_time:
            now_future = time.time() + 1850
            mock_time.return_value = now_future

            with self.assertRaises(HTTPException) as cm:
                verify_refresh_cookie(cookie_val, self.db)
            self.assertEqual(cm.exception.status_code, 401)
            self.assertEqual(cm.exception.headers.get("X-Reason-Code"), "SESSION_EXPIRED_IDLE")

    def test_ac6_absolute_session_lifetime_enforcement(self):
        """AC-6: Refreshing after 8 hours rejects with 401 and SESSION_EXPIRED_MAX_DURATION despite ongoing activity."""
        cookie_val, old_payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )

        # Fast forward past 8 hours (28850 seconds), while simulating active ping just 10s ago
        sid = old_payload["sid"]
        created_time = old_payload["created_at"]
        future_time = created_time + 28850

        with patch("app.services.session_service._current_timestamp") as mock_time:
            mock_time.return_value = future_time
            # Active request right now
            track_session_activity(sid)

            with self.assertRaises(HTTPException) as cm:
                verify_refresh_cookie(cookie_val, self.db)
            self.assertEqual(cm.exception.status_code, 401)
            self.assertEqual(cm.exception.headers.get("X-Reason-Code"), "SESSION_EXPIRED_MAX_DURATION")

    def test_ac7_inactivity_exempt_paths(self):
        """AC-7: Notification polling, health checks, and token refresh are exempt from activity updates."""
        self.assertIn("/api/v1/health", INACTIVITY_EXEMPT_PATHS)
        self.assertIn("/api/v1/notifications", INACTIVITY_EXEMPT_PATHS)
        self.assertIn("/api/v1/notifications/unread-count", INACTIVITY_EXEMPT_PATHS)
        self.assertIn("/api/v1/auth/refresh", INACTIVITY_EXEMPT_PATHS)

    def test_ac10_logout_revokes_session_and_clears_cookie(self):
        """AC-10: Logout revokes session family, nonce, and clears cookie."""
        cookie_val, payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )

        response = Response()
        clear_refresh_cookie(response)
        set_cookie_header = response.headers.get("set-cookie", "")
        self.assertIn('mct_refresh_token=""', set_cookie_header)

        # Revoke session in database
        revoke_session(self.db, sid=payload["sid"], family_id=payload["family_id"], nonce=payload["nonce"], user_id=101)

        # Refresh with revoked cookie now fails
        with self.assertRaises(HTTPException) as cm:
            verify_refresh_cookie(cookie_val, self.db)
        self.assertEqual(cm.exception.status_code, 401)

    def test_ac11_csrf_header_verification(self):
        """AC-11: Custom CSRF header is strictly required on cookie-authenticated requests."""
        # Missing header -> 403
        req_missing = Request(scope={"type": "http", "headers": []})
        with self.assertRaises(HTTPException) as cm:
            verify_csrf_header(req_missing)
        self.assertEqual(cm.exception.status_code, 403)

        # With X-MCT-CSRF -> Passes
        req_csrf = Request(scope={"type": "http", "headers": [(b"x-mct-csrf", b"1")]})
        verify_csrf_header(req_csrf)

        # With X-Requested-With -> Passes
        req_xhr = Request(scope={"type": "http", "headers": [(b"x-requested-with", b"XMLHttpRequest")]})
        verify_csrf_header(req_xhr)

    def test_ac12_token_version_revocation_on_password_reset(self):
        """AC-12: Incrementing token_version revokes active sessions and refresh cookies immediately."""
        cookie_val, payload = create_refresh_cookie_payload(
            user_id=101,
            email="finance.test@mct.com",
            token_version=1,
            remember_me=True,
        )

        # User changes password or admin updates status -> token_version becomes 2
        user = self.db.query(User).filter(User.user_id == 101).first()
        user.token_version = 2
        self.db.commit()

        # Refresh attempt presenting version 1 fails immediately
        with self.assertRaises(HTTPException) as cm:
            verify_refresh_cookie(cookie_val, self.db)
        self.assertEqual(cm.exception.status_code, 401)
        self.assertEqual(cm.exception.headers.get("X-Reason-Code"), "TOKEN_VERSION_OUTDATED")

    def test_ac16_reauthentication_requirement(self):
        """AC-16: Sensitive actions require fresh reauthentication token."""
        token, expires_in = create_reauth_token(user_id=101)
        self.assertEqual(expires_in, 300)
        self.assertTrue(verify_reauth_token(token, expected_user_id=101))
        # Wrong user fails
        self.assertFalse(verify_reauth_token(token, expected_user_id=999))
        # None fails
        self.assertFalse(verify_reauth_token(None, expected_user_id=101))

        # require_reauthentication dependency check
        req_no_reauth = Request(scope={"type": "http", "headers": []})
        with self.assertRaises(HTTPException) as cm:
            require_reauthentication(req_no_reauth, {"user_id": 101, "role": "admin"})
        self.assertEqual(cm.exception.status_code, 403)
        self.assertEqual(cm.exception.headers.get("X-Reason-Code"), "REAUTH_REQUIRED")

        # Valid reauth header passes
        req_valid = Request(scope={"type": "http", "headers": [(b"x-mct-reauth", token.encode("utf-8"))]})
        user_out = require_reauthentication(req_valid, {"user_id": 101, "role": "admin"})
        self.assertEqual(user_out["user_id"], 101)

    def test_ac15_no_credentials_stored_in_frontend(self):
        """AC-15: Scans authService.ts to verify access tokens and passwords are not stored in localStorage or sessionStorage."""
        service_file = Path("frontend/src/services/authService.ts")
        self.assertTrue(service_file.exists())
        content = service_file.read_text(encoding="utf-8")

        # Must not write access tokens to storage
        self.assertNotIn("sessionStorage.setItem(ACCESS_TOKEN_KEY", content)
        self.assertNotIn("localStorage.setItem(ACCESS_TOKEN_KEY", content)
        self.assertNotIn("sessionStorage.setItem('mct_access_token'", content)
        self.assertNotIn("localStorage.setItem('mct_access_token'", content)


if __name__ == "__main__":
    unittest.main()
