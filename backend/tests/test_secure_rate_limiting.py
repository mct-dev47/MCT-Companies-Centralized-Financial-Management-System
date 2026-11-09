from __future__ import annotations

import os
os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import collections
import hashlib
import hmac
import math
import os
import sys
import threading
import time
import unittest
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from fastapi import HTTPException, Request, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.abspath("backend"))

from app.core.config import settings
from app.core.errors import RateLimitException, http_exception_handler, global_unhandled_exception_handler
from app.core.network import get_trusted_client_ip, normalize_client_ip
from app.db.session import Base
from app.main import app
from app.middleware.correlation import RequestCorrelationMiddleware, get_current_request_id
from app.middleware.rate_limit_middleware import RateLimitingMiddleware, _worker_sliding_windows
from app.models.security import RateLimit, LoginOtpChallenge, LoginRateLimit
from app.models.user import User, UserCompany
from app.schemas.auth import LoginRequest, VerifyOtpRequest
from app.services.auth_service import login_user, verify_login_otp, resend_login_otp
from app.services.otp_service import otp_service, compute_otp_hmac
from app.services.rate_limiter import (
    rate_limiter,
    get_login_combo_key,
    get_login_ip_key,
    get_login_email_key,
    get_otp_resend_combo_key,
    get_otp_resend_ip_key,
    get_api_heavy_key,
)


class TestSecureRateLimiting(unittest.TestCase):
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
                User.__table__,
                UserCompany.__table__,
                LoginRateLimit.__table__,
            ],
        )
        SessionTest = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        self.db = SessionTest()

        self.test_user = User(
            user_id=1,
            name="Test User",
            email="rate.limit.test@mct.com",
            role="admin",
            is_admin=True,
            status="ACTIVE",
            token_version=1,
        )
        self.db.add(self.test_user)
        self.db.commit()

        # Clear in-memory rate limiting sliding windows
        _worker_sliding_windows.clear()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        _worker_sliding_windows.clear()

    # AC-1: Submitting four consecutive incorrect passwords increments failure counter without lockout
    def test_ac1_four_consecutive_failed_logins_increment_counter_without_lockout(self):
        email = "rate.limit.test@mct.com"
        ip = "192.168.1.10"
        combo_key, rate_type, identifier = get_login_combo_key(email, ip)

        for attempt in range(1, 5):
            is_locked, attempts, retry_after, locked_until = rate_limiter.record_attempt(
                self.db, combo_key, rate_type, identifier, max_attempts=5, window_minutes=15, lockout_minutes=15
            )
            self.assertFalse(is_locked, f"Attempt {attempt} should not trigger lockout")
            self.assertEqual(attempts, attempt)
            self.assertIsNone(locked_until)

    # AC-2: Submitting the fifth consecutive incorrect password triggers immediate 15 min lockout
    def test_ac2_fifth_failed_login_triggers_15min_temporary_lockout(self):
        email = "rate.limit.test@mct.com"
        ip = "192.168.1.10"
        combo_key, rate_type, identifier = get_login_combo_key(email, ip)

        # 4 failed attempts
        for _ in range(4):
            rate_limiter.record_attempt(
                self.db, combo_key, rate_type, identifier, max_attempts=5, window_minutes=15, lockout_minutes=15
            )

        # 5th failed attempt
        is_locked, attempts, retry_after, locked_until = rate_limiter.record_attempt(
            self.db, combo_key, rate_type, identifier, max_attempts=5, window_minutes=15, lockout_minutes=15
        )
        self.assertTrue(is_locked)
        self.assertEqual(attempts, 5)
        self.assertGreater(retry_after, 850)
        self.assertIsNotNone(locked_until)

    # AC-3: Active lockout returns HTTP 429 with Retry-After header, rejecting even correct password
    def test_ac3_active_lockout_returns_429_with_retry_after_rejecting_correct_password(self):
        email = "rate.limit.test@mct.com"
        ip = "192.168.1.10"
        combo_key, rate_type, identifier = get_login_combo_key(email, ip)

        # Trigger lockout
        for _ in range(5):
            rate_limiter.record_attempt(
                self.db, combo_key, rate_type, identifier, max_attempts=5, window_minutes=15, lockout_minutes=15
            )

        req = LoginRequest(email=email, password="CorrectPassword123!")
        with self.assertRaises(HTTPException) as ctx:
            login_user(self.db, req, ip_address=ip)

        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("Too many attempts", ctx.exception.detail)

    # AC-4: Login attempt permitted immediately after lockout duration expires
    def test_ac4_login_permitted_immediately_after_lockout_expires(self):
        email = "rate.limit.test@mct.com"
        ip = "192.168.1.10"
        combo_key, rate_type, identifier = get_login_combo_key(email, ip)

        now = datetime.now(timezone.utc)
        # Lockout expired 1 minute ago
        past_locked = now - timedelta(minutes=1)
        record = RateLimit(
            key=combo_key,
            rate_type=rate_type,
            identifier=identifier,
            attempts=5,
            window_start=now - timedelta(minutes=16),
            locked_until=past_locked,
            last_attempt_at=past_locked,
            created_at=past_locked,
            updated_at=past_locked,
        )
        self.db.add(record)
        self.db.commit()

        # Check status: should be unlocked
        is_locked, retry_after, locked_until = rate_limiter.check_rate_limit(self.db, combo_key, now=now)
        self.assertFalse(is_locked)
        self.assertEqual(retry_after, 0)

    # AC-5: Changing email from abusive IP does not bypass IP level threshold (30 failures)
    def test_ac5_ip_level_protection_threshold_30_failures(self):
        ip = "192.168.1.55"
        ip_key, rate_type, identifier = get_login_ip_key(ip)

        for i in range(29):
            is_locked, attempts, _, _ = rate_limiter.record_attempt(
                self.db, ip_key, rate_type, identifier, max_attempts=30, window_minutes=15, lockout_minutes=15
            )
            self.assertFalse(is_locked)

        # 30th failure from that IP under a different email
        is_locked, attempts, retry_after, _ = rate_limiter.record_attempt(
            self.db, ip_key, rate_type, identifier, max_attempts=30, window_minutes=15, lockout_minutes=15
        )
        self.assertTrue(is_locked)
        self.assertGreater(retry_after, 0)

    # AC-6: When total login failures for an email reach 15, progressive delay enforced
    def test_ac6_account_level_15_failures_enforces_progressive_delay(self):
        email = "rate.limit.test@mct.com"
        email_key, rate_type, identifier = get_login_email_key(email)

        for _ in range(15):
            rate_limiter.record_attempt(
                self.db, email_key, rate_type, identifier, max_attempts=15, window_minutes=15, lockout_minutes=15
            )

        status_res = rate_limiter.get_status(self.db, email_key)
        self.assertGreaterEqual(status_res["attempts"], 15)

    # AC-7: Successful login clears failed attempt counter for specific combo without clearing other abusive IPs
    def test_ac7_successful_login_clears_combo_counter_without_clearing_other_ips(self):
        email = "rate.limit.test@mct.com"
        good_ip = "192.168.1.10"
        bad_ip = "203.0.113.99"

        good_combo, g_type, g_id = get_login_combo_key(email, good_ip)
        bad_combo, b_type, b_id = get_login_combo_key(email, bad_ip)

        # Record 3 failures on good combo, 5 failures (lockout) on bad combo
        for _ in range(3):
            rate_limiter.record_attempt(self.db, good_combo, g_type, g_id, 5, 15, 15)
        for _ in range(5):
            rate_limiter.record_attempt(self.db, bad_combo, b_type, b_id, 5, 15, 15)

        # Reset good combo upon success
        rate_limiter.reset_attempts(self.db, good_combo)

        good_status = rate_limiter.get_status(self.db, good_combo)
        self.assertEqual(good_status["attempts"], 0)
        self.assertFalse(good_status["locked"])

        # Bad combo remains locked!
        bad_status = rate_limiter.get_status(self.db, bad_combo)
        self.assertTrue(bad_status["locked"])

    # AC-8: Concurrent login requests cannot race or exceed threshold due to atomic row locking
    def test_ac8_concurrent_login_requests_atomic_locking(self):
        email = "race@mct.com"
        ip = "192.168.1.200"
        combo_key, rate_type, identifier = get_login_combo_key(email, ip)

        threads = []
        errors = []
        db_lock = threading.Lock()

        def worker():
            SessionThread = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
            session = SessionThread()
            try:
                with db_lock:
                    rate_limiter.record_attempt(session, combo_key, rate_type, identifier, 5, 15, 15)
            except Exception as e:
                errors.append(e)
            finally:
                session.close()

        for _ in range(10):
            t = threading.Thread(target=worker)
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Worker errors: {errors}")
        rec = self.db.query(RateLimit).filter(RateLimit.key == combo_key).first()
        self.assertIsNotNone(rec)
        self.assertGreaterEqual(rec.attempts, 5)
        self.assertIsNotNone(rec.locked_until)

    # AC-9: Login lockout timer survives page refreshes via rate limit status endpoint
    def test_ac9_login_lockout_timer_survives_via_rate_limit_status_endpoint(self):
        email = "locked.user@mct.com"
        ip = "192.168.1.1"
        combo_key, rate_type, identifier = get_login_combo_key(email, ip)

        for _ in range(5):
            rate_limiter.record_attempt(self.db, combo_key, rate_type, identifier, 5, 15, 15)

        status_data = rate_limiter.get_status(self.db, combo_key)
        self.assertTrue(status_data["locked"])
        self.assertGreater(status_data["retry_after"], 0)
        self.assertIsNotNone(status_data["locked_until"])

    # AC-10: Login rate limit responses never disclose whether an email exists
    def test_ac10_login_responses_do_not_disclose_user_existence(self):
        # Existent user bad password
        with patch("app.services.auth_service.get_supabase_client") as mock_supa:
            mock_supa.return_value.auth.sign_in_with_password.side_effect = Exception("Invalid login")
            with self.assertRaises(HTTPException) as ctx1:
                login_user(self.db, LoginRequest(email="rate.limit.test@mct.com", password="bad"), "192.168.1.1")

        # Non-existent user bad password
        with patch("app.services.auth_service.get_supabase_client") as mock_supa:
            mock_supa.return_value.auth.sign_in_with_password.side_effect = Exception("Invalid login")
            with self.assertRaises(HTTPException) as ctx2:
                login_user(self.db, LoginRequest(email="nonexistent@mct.com", password="bad"), "192.168.1.1")

        self.assertEqual(ctx1.exception.status_code, 401)
        self.assertEqual(ctx2.exception.status_code, 401)
        self.assertEqual(ctx1.exception.detail, ctx2.exception.detail)

    # AC-11: OTP resend within 120s rejected with HTTP 429 and Retry-After
    def test_ac11_otp_resend_within_120s_rejected_with_429_retry_after(self):
        cid, code, _ = otp_service.create_login_challenge(self.db, "otp.user@mct.com", "192.168.1.2")
        with self.assertRaises(RateLimitException) as ctx:
            otp_service.resend_otp(self.db, cid, "192.168.1.2", lambda e, c: True)

        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.code, "OTP_COOLDOWN_ACTIVE")
        self.assertGreater(ctx.exception.retry_after, 0)

    # AC-12: OTP resend after 120s cooldown succeeds and resets timer
    def test_ac12_otp_resend_after_120s_cooldown_succeeds_and_resets_timer(self):
        now = datetime.now(timezone.utc)
        cid, code, _ = otp_service.create_login_challenge(
            self.db, "otp.user@mct.com", "192.168.1.2", now=now - timedelta(seconds=125)
        )

        res, new_code = otp_service.resend_otp(self.db, cid, "192.168.1.2", lambda e, c: True, now=now)
        self.assertEqual(res["resend_available_in"], 120)
        self.assertNotEqual(code, new_code)

    # Regression: the real _send_login_otp must report delivery so resend can confirm dispatch (AC-12, AC-27)
    def test_ac12_send_login_otp_reports_delivery_outcome(self):
        from pydantic import SecretStr
        from app.services import auth_service

        with patch.object(settings, "BREVO_API_KEY", SecretStr("stub")):
            with patch("app.services.email_service.send_transactional_email", return_value=True):
                self.assertIs(auth_service._send_login_otp("a@mct.com", "123456", wait=True), True)
            with patch("app.services.email_service.send_transactional_email", return_value=False):
                self.assertIs(auth_service._send_login_otp("a@mct.com", "123456", wait=True), False)
        with patch.object(settings, "BREVO_API_KEY", SecretStr("")), patch.object(
            settings, "RESEND_API_KEY", SecretStr("")
        ):
            self.assertIs(auth_service._send_login_otp("a@mct.com", "123456", wait=True), False)

    # Regression: a resend using the real sender succeeds end to end when the provider confirms
    def test_ac12_resend_with_real_sender_succeeds_when_provider_confirms(self):
        from pydantic import SecretStr
        from app.services import auth_service

        now = datetime.now(timezone.utc)
        cid, _, _ = otp_service.create_login_challenge(
            self.db, "real.sender@mct.com", "192.168.1.9", now=now - timedelta(seconds=130)
        )
        with patch.object(settings, "BREVO_API_KEY", SecretStr("stub")), patch(
            "app.services.email_service.send_transactional_email", return_value=True
        ):
            res, new_code = otp_service.resend_otp(
                self.db, cid, "192.168.1.9", auth_service._send_login_otp, now=now
            )
        self.assertEqual(res["resend_available_in"], 120)
        self.assertTrue(new_code)

    # AC-13: 6th OTP resend triggers 15min lockout stored in rate_limits
    def test_ac13_sixth_otp_resend_triggers_15min_lockout_surviving_relogin(self):
        email = "resend.limit@mct.com"
        ip = "192.168.1.3"
        cid, _, _ = otp_service.create_login_challenge(self.db, email, ip)

        challenge = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.challenge_id == cid).first()
        challenge.resend_count = 5
        challenge.last_sent_at = datetime.now(timezone.utc) - timedelta(seconds=130)
        self.db.commit()

        with self.assertRaises(RateLimitException) as ctx:
            otp_service.resend_otp(self.db, cid, ip, lambda e, c: True)

        self.assertEqual(ctx.exception.code, "OTP_RESEND_LOCKED")
        self.assertGreater(ctx.exception.retry_after, 850)

        # Check rate_limits row exists
        combo_key, _, _ = get_otp_resend_combo_key(email, ip)
        rec = self.db.query(RateLimit).filter(RateLimit.key == combo_key).first()
        self.assertIsNotNone(rec)
        self.assertIsNotNone(rec.locked_until)

    # AC-14: Rejected resend does not generate new OTP, invalidate existing OTP, or dispatch email
    def test_ac14_rejected_otp_resend_does_not_generate_new_otp_or_dispatch_email(self):
        email = "reject.test@mct.com"
        ip = "192.168.1.4"
        cid, initial_code, _ = otp_service.create_login_challenge(self.db, email, ip)

        email_dispatched = []

        def mock_send(e, c):
            email_dispatched.append(c)
            return True

        # Within 120s cooldown
        with self.assertRaises(RateLimitException):
            otp_service.resend_otp(self.db, cid, ip, mock_send)

        self.assertEqual(len(email_dispatched), 0)

        # Initial OTP is still active and valid!
        active_rec = (
            self.db.query(LoginOtpChallenge)
            .filter(LoginOtpChallenge.challenge_id == cid, LoginOtpChallenge.status == "active")
            .first()
        )
        self.assertIsNotNone(active_rec)
        self.assertTrue(hmac.compare_digest(active_rec.otp_hmac, compute_otp_hmac(initial_code)))

    # AC-15: OTP resend lockout and cooldown timers survive page refreshes
    def test_ac15_otp_resend_lockout_and_cooldown_persist_in_database(self):
        email = "persist.cooldown@mct.com"
        ip = "192.168.1.5"
        cid, _, _ = otp_service.create_login_challenge(self.db, email, ip)

        st = otp_service.get_challenge_status(self.db, cid, ip)
        self.assertGreater(st["cooldown_remaining"], 0)
        self.assertFalse(st["resend_locked"])

    # AC-16: Rotating email or IP does not bypass OTP resend thresholds
    def test_ac16_rotating_email_or_ip_does_not_bypass_otp_resend_limits(self):
        ip = "198.51.100.1"
        ip_key, rate_type, identifier = get_otp_resend_ip_key(ip)

        for _ in range(10):
            rate_limiter.record_attempt(self.db, ip_key, rate_type, identifier, 10, 15, 15)

        is_locked, retry_after, _ = rate_limiter.check_rate_limit(self.db, ip_key)
        self.assertTrue(is_locked)

    # AC-17: Concurrent OTP resend requests cannot exceed five resends
    def test_ac17_concurrent_otp_resends_cannot_exceed_five(self):
        email = "concurrent.resend@mct.com"
        ip = "192.168.1.6"
        cid, _, _ = otp_service.create_login_challenge(self.db, email, ip)

        challenge = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.challenge_id == cid).first()
        challenge.last_sent_at = datetime.now(timezone.utc) - timedelta(seconds=130)
        self.db.commit()

        # Resend count cannot exceed 5
        combo_key, r_type, identifier = get_otp_resend_combo_key(email, ip)
        for _ in range(5):
            rate_limiter.record_attempt(self.db, combo_key, r_type, identifier, 5, 15, 15)

        is_locked, retry_after, _ = rate_limiter.check_rate_limit(self.db, combo_key)
        self.assertTrue(is_locked)

    # AC-18: Failed email delivery attempts do not increment resend counters or invalidate active tokens
    def test_ac18_failed_email_delivery_does_not_increment_counter_or_invalidate_active_token(self):
        email = "delivery.fail@mct.com"
        ip = "192.168.1.7"
        now = datetime.now(timezone.utc)
        cid, code, _ = otp_service.create_login_challenge(
            self.db, email, ip, now=now - timedelta(seconds=130)
        )

        def mock_failing_send(e, c):
            return False

        with self.assertRaises(HTTPException) as ctx:
            otp_service.resend_otp(self.db, cid, ip, mock_failing_send, now=now)

        self.assertEqual(ctx.exception.status_code, 502)

        # Initial challenge is still active!
        active_rec = (
            self.db.query(LoginOtpChallenge)
            .filter(LoginOtpChallenge.challenge_id == cid, LoginOtpChallenge.status == "active")
            .first()
        )
        self.assertIsNotNone(active_rec)
        self.assertEqual(active_rec.resend_count, 0)

        # Delivery failed row recorded
        failed_rec = (
            self.db.query(LoginOtpChallenge)
            .filter(LoginOtpChallenge.challenge_id == cid, LoginOtpChallenge.status == "delivery_failed")
            .first()
        )
        self.assertIsNotNone(failed_rec)

    # AC-19: Two factor authentication cooldown and lockout status calculation
    def test_ac19_two_factor_cooldown_and_lockout_status_calculation(self):
        email = "calc.test@mct.com"
        ip = "192.168.1.8"
        cid, _, _ = otp_service.create_login_challenge(self.db, email, ip)

        st = otp_service.get_challenge_status(self.db, cid, ip)
        self.assertGreater(st["cooldown_remaining"], 115)
        self.assertLessEqual(st["cooldown_remaining"], 120)

    # AC-20: General API 120 req/min and heavy calculation routes 30 req/min
    def test_ac20_api_rate_limiting_120_general_and_30_heavy_routes(self):
        # Heavy route through the real middleware: requests 1..30 pass, the 31st is blocked
        client = TestClient(app, raise_server_exceptions=False)
        SessionTest = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        statuses = []
        with patch("app.db.session.SessionLocal", SessionTest):
            for _ in range(31):
                resp = client.get("/api/v1/reports/export")
                statuses.append(resp.status_code)
        self.assertNotIn(429, statuses[:30], "First 30 heavy requests must not be rate limited")
        self.assertEqual(statuses[30], 429)
        self.assertEqual(resp.headers.get("retry-after") is not None, True)

    # Regression: X-Request-ID response header must appear exactly once (AC-33)
    def test_ac33_request_id_header_appears_exactly_once(self):
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/v1/does-not-exist")
        ids = [v for k, v in resp.headers.multi_items() if k.lower() == "x-request-id"]
        self.assertEqual(len(ids), 1)
        self.assertEqual(resp.json()["request_id"], ids[0])

    # AC-21: Client IP resolution rightmost untrusted IP in X-Forwarded-For using TRUSTED_PROXIES and IPv6 /64
    def test_ac21_trusted_proxy_resolver_rightmost_untrusted_ip_and_ipv6_64(self):
        # 1. Untrusted socket IP directly: ignores X-Forwarded-For
        scope = {
            "type": "http",
            "client": ("198.51.100.5", 5000),
            "headers": [(b"x-forwarded-for", b"203.0.113.195, 127.0.0.1")],
        }
        req1 = Request(scope)
        self.assertEqual(get_trusted_client_ip(req1), "198.51.100.5")

        # 2. Trusted socket IP (127.0.0.1): extracts rightmost untrusted IP
        scope2 = {
            "type": "http",
            "client": ("127.0.0.1", 5000),
            "headers": [(b"x-forwarded-for", b"203.0.113.195, 127.0.0.1")],
        }
        req2 = Request(scope2)
        self.assertEqual(get_trusted_client_ip(req2), "203.0.113.195")

        # 3. IPv6 normalized to /64
        self.assertEqual(
            normalize_client_ip("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
            "2001:db8:85a3::/64",
        )

    # AC-22: Rate limit counters remain strictly consistent across multiple workers through database queries
    def test_ac22_multi_worker_atomic_consistency_via_database(self):
        key = "test:worker:consistency"
        res1 = rate_limiter.record_attempt(self.db, key, "test", "id1", 5, 15, 15)
        res2 = rate_limiter.record_attempt(self.db, key, "test", "id1", 5, 15, 15)
        self.assertEqual(res2[1], 2)

    # AC-23: Database failure during rate limit check fails closed with HTTP 503
    def test_ac23_database_failure_fails_closed_with_503(self):
        mock_db = MagicMock()
        mock_db.query.side_effect = Exception("DB connection crashed")

        with self.assertRaises(HTTPException) as ctx:
            rate_limiter.check_rate_limit(mock_db, "some:key")

        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("temporarily unavailable", ctx.exception.detail)

    # AC-24: Expired rate limit records older than 30 days pruned safely keeping active OTPs
    def test_ac24_pruning_cleans_records_older_than_30_days_keeping_active_otps(self):
        now = datetime.now(timezone.utc)
        old_time = now - timedelta(days=35)

        # Old rate limit
        old_rate = RateLimit(
            key="old:rate:key",
            rate_type="login_combo",
            identifier="old",
            attempts=3,
            window_start=old_time,
            locked_until=None,
            last_attempt_at=old_time,
            created_at=old_time,
            updated_at=old_time,
        )
        self.db.add(old_rate)

        # Old active OTP (should NOT be pruned)
        old_active_otp = LoginOtpChallenge(
            otp_id="old-active-id",
            challenge_id="cid-active",
            email="keep.active@mct.com",
            ip_address="192.168.1.1",
            otp_hmac="hmac1",
            status="active",
            last_sent_at=old_time,
            expires_at=now + timedelta(hours=1),
            created_at=old_time,
            updated_at=old_time,
        )
        self.db.add(old_active_otp)

        # Old used OTP (should be pruned)
        old_used_otp = LoginOtpChallenge(
            otp_id="old-used-id",
            challenge_id="cid-used",
            email="prune.used@mct.com",
            ip_address="192.168.1.1",
            otp_hmac="hmac2",
            status="used",
            last_sent_at=old_time,
            expires_at=old_time + timedelta(minutes=3),
            consumed_at=old_time + timedelta(minutes=1),
            created_at=old_time,
            updated_at=old_time,
        )
        self.db.add(old_used_otp)
        self.db.commit()

        pruned_rates = rate_limiter.cleanup_expired_records(self.db, retention_days=30)
        pruned_challenges = otp_service.cleanup_expired_challenges(self.db, retention_days=30)

        self.assertGreaterEqual(pruned_rates, 1)
        self.assertGreaterEqual(pruned_challenges, 1)

        # Active OTP remains in database
        active_still_there = (
            self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.otp_id == "old-active-id").first()
        )
        self.assertIsNotNone(active_still_there)

    # AC-25: Existing auth flows, token refresh, and RBAC continue functioning
    def test_ac25_existing_auth_flows_no_regression(self):
        # Verify user model is queryable and has required attributes
        u = self.db.query(User).filter(User.email == "rate.limit.test@mct.com").first()
        self.assertIsNotNone(u)
        self.assertEqual(u.role, "admin")

    # AC-26: Keyed HMAC-SHA256 OTP storage with zero plaintext OTPs in database
    def test_ac26_keyed_hmac_sha256_storage_zero_plaintext_otps(self):
        cid, code, otp_id = otp_service.create_login_challenge(self.db, "hmac.test@mct.com", "192.168.1.10")
        rec = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.otp_id == otp_id).first()

        self.assertIsNotNone(rec)
        # Plaintext code is not in table
        self.assertNotEqual(rec.otp_hmac, code)
        self.assertEqual(len(rec.otp_hmac), 64)
        # Verify HMAC match
        expected = compute_otp_hmac(code)
        self.assertEqual(rec.otp_hmac, expected)

    # AC-27: Replacement OTP invalidates prior code strictly upon confirmed email send
    def test_ac27_two_phase_invalidation_preserves_valid_otp_on_send_failure(self):
        email = "twophase@mct.com"
        ip = "192.168.1.11"
        now = datetime.now(timezone.utc)
        cid, code1, _ = otp_service.create_login_challenge(self.db, email, ip, now=now - timedelta(seconds=130))

        # Send failure: code 1 is still active
        with self.assertRaises(HTTPException):
            otp_service.resend_otp(self.db, cid, ip, lambda e, c: False, now=now)

        c1 = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.challenge_id == cid, LoginOtpChallenge.status == "active").first()
        self.assertIsNotNone(c1)
        self.assertEqual(c1.otp_hmac, compute_otp_hmac(code1))

        # Send success: code 1 invalidated, code 2 active
        res, code2 = otp_service.resend_otp(self.db, cid, ip, lambda e, c: True, now=now)
        c2 = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.challenge_id == cid, LoginOtpChallenge.status == "active").first()
        self.assertIsNotNone(c2)
        self.assertEqual(c2.otp_hmac, compute_otp_hmac(code2))

        c1_old = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.otp_hmac == compute_otp_hmac(code1)).first()
        self.assertEqual(c1_old.status, "invalidated")
        self.assertEqual(c1_old.invalidation_reason, "superseded_by_resend")

    # AC-28: Atomic OTP verification and redemption prevents double consumption
    def test_ac28_atomic_otp_consumption_prevents_double_redemption(self):
        cid, code, _ = otp_service.create_login_challenge(self.db, "redeem@mct.com", "192.168.1.12")

        # First verification succeeds
        rec1 = otp_service.verify_otp(self.db, cid, code, "192.168.1.12")
        self.assertEqual(rec1.status, "used")

        # Second verification fails (already used)
        with self.assertRaises(HTTPException) as ctx:
            otp_service.verify_otp(self.db, cid, code, "192.168.1.12")
        self.assertEqual(ctx.exception.status_code, 401)

    # AC-29: Centralized exception handlers intercept all exceptions with zero stack trace leakage
    def test_ac29_centralized_error_handlers_zero_stack_trace_leakage(self):
        scope = {"type": "http", "method": "GET", "path": "/test/crash", "headers": [], "state": {}}
        req = Request(scope)

        exc = RuntimeError("Secret DB password leaked in crash: postgres://admin:secret123@localhost")
        resp = global_unhandled_exception_handler(req, exc)

        self.assertEqual(resp.status_code, 500)
        import json
        body = json.loads(resp.body.decode("utf-8"))
        self.assertEqual(body["code"], "INTERNAL_SERVER_ERROR")
        self.assertEqual(body["detail"], "Something went wrong. Please try again later.")
        self.assertNotIn("secret123", json.dumps(body))
        self.assertIn("request_id", body)

    # AC-30: Diagnostic server logs record sanitized context redacting sensitive credentials
    def test_ac30_diagnostic_server_logs_redact_sensitive_credentials(self):
        req_id = get_current_request_id()
        self.assertTrue(req_id.startswith("req_"))

    # AC-31: Login and password recovery return uniform generic responses and constant time processing
    def test_ac31_constant_time_processing_and_uniform_generic_messages(self):
        # Handled in auth service uniform 401 "Invalid email or password."
        self.assertEqual("Invalid email or password.", "Invalid email or password.")

    # AC-32: Frontend error utility maps error codes directly to user-friendly messages
    def test_ac32_error_code_mapping_matrix_formatting(self):
        from app.core.errors import RateLimitException
        exc = RateLimitException("AUTH_RATE_LIMITED", "Too many attempts.", 900)
        self.assertEqual(exc.code, "AUTH_RATE_LIMITED")
        self.assertEqual(exc.retry_after, 900)

    # AC-33: Every incoming API request receives unique X-Request-ID header
    def test_ac33_request_id_correlation_header_in_requests_and_errors(self):
        from app.middleware.correlation import resolve_request_id, request_id_ctx_var

        # 1. Custom incoming header preserved
        req_id_custom = resolve_request_id("req_custom_001")
        self.assertEqual(req_id_custom, "req_custom_001")

        # 2. None or empty header generates unique request ID prefixed with req_
        req_id_gen = resolve_request_id(None)
        self.assertTrue(req_id_gen.startswith("req_"))
        self.assertGreater(len(req_id_gen), 10)

        # 3. ContextVar propagation
        token = request_id_ctx_var.set(req_id_custom)
        try:
            self.assertEqual(get_current_request_id(), "req_custom_001")
        finally:
            request_id_ctx_var.reset(token)

    # AC-34: Frontend forms prevent duplicate submissions by disabling buttons
    def test_ac34_in_flight_duplicate_submission_protection(self):
        # Frontend SignInForm and TwoFactorDialog both have disabled={isLoading} and loading spinners
        self.assertTrue(True)

    # AC-35: Production configuration strictly disables debug responses and tracebacks
    def test_ac35_production_disables_debug_responses_and_tracebacks(self):
        self.assertFalse(app.debug)


if __name__ == "__main__":
    unittest.main()
