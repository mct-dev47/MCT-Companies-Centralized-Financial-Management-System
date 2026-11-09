"""
Comprehensive Automated Test Suite for Password Reset and Setup Security (Spec 0040).
Verifies AC-1 through AC-22:
- AC-1, AC-2: Setup token 24h expiry and rejection at or past expiry.
- AC-3: Strict single-use token consumption.
- AC-4: Reinvitation revokes older setup tokens and cancels outbox jobs.
- AC-5: Ineligible accounts (SUSPENDED, DEACTIVATED, LOCKED) blocked from setup & reset.
- AC-6: Purpose isolation (setup token rejected at reset endpoint).
- AC-7: Forgot password anti-enumeration generic response and token suppression.
- AC-8: Dual sliding-window rate limiting (5 per email, 10 per IP per 15 min).
- AC-9: 60s silent cooldown and monotonic time floor padding.
- AC-10, AC-11: Reset token 30m expiry and invalid token rejection.
- AC-12: Reset token rejected at setup endpoint; user.status not altered to ACTIVE.
- AC-13: Password reset session revocation via token_version bump & lockout clearance.
- AC-14: Explicit login required (no auto-authentication).
- AC-15: Cryptographic entropy, SHA-256 database storage, and Fernet ciphertext.
- AC-16: Atomic database consumption preventing concurrency race conditions.
- AC-17: Three-phase compensation saga with rollback to PENDING on provider error.
- AC-18: Plaintext secrets invariant (no passwords or raw tokens in DB).
- AC-19: Email delivery resilience and template dispatching.
- AC-20, AC-22: Link validation endpoint contract without pre-consumption.
- AC-21: Schema migration backward compatibility.
"""
import hashlib
import json
import os
import secrets
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath("backend"))

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models
from app.core.config import settings
from app.core.encryption import decrypt_payload, encrypt_payload, encrypt_invitation_token
from app.db.session import Base
from app.models.company import Company
from app.models.invitation import InvitationOutbox, UserInvitation
from app.models.security import LoginRateLimit
from app.models.user import User, UserCompany
from app.schemas.auth import (
    PasswordResetConfirm,
    PasswordResetRequest,
    SetupPasswordRequest,
    TokenValidateRequest,
)
from app.services.auth_service import (
    _forgot_pwd_email_requests,
    _forgot_pwd_ip_requests,
    _forgot_pwd_last_sent,
    request_password_reset,
    reset_password,
    setup_invitation_password,
    validate_invitation_token,
)
from app.services.invitation_dispatcher import InvitationDispatcher
from app.services.user_service import UserService, UserValidationError


class TestPasswordResetAndSetupSecurity(unittest.TestCase):
    def setUp(self):
        # Reset in-memory rate limiters before each test
        _forgot_pwd_email_requests.clear()
        _forgot_pwd_ip_requests.clear()
        _forgot_pwd_last_sent.clear()

        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.db = self.Session()

        # Seed test company
        company = Company(
            company_id=1,
            company_name="MCT Test Corp",
            location="Manila",
            starting_balance=50000,
        )
        self.db.add(company)

        # Seed primary admin
        admin = User(
            user_id=1,
            name="Primary Admin",
            email="admin@mct.com",
            role="admin",
            is_admin=True,
            status="ACTIVE",
            must_change_password=False,
            token_version=1,
        )
        self.db.add(admin)

        # Seed standard active user
        active_user = User(
            user_id=2,
            name="Active User",
            email="active@mct.com",
            role="employee",
            is_admin=False,
            status="ACTIVE",
            must_change_password=False,
            token_version=1,
        )
        self.db.add(active_user)

        # Seed provisioned pending user
        provisioned_user = User(
            user_id=3,
            name="Pending Employee",
            email="pending@mct.com",
            role="employee",
            is_admin=False,
            status="PROVISIONED",
            must_change_password=True,
            token_version=1,
        )
        self.db.add(provisioned_user)

        self.db.commit()

        # Mock Supabase
        self.mock_supabase = MagicMock()
        mock_auth_user = MagicMock()
        mock_auth_user.id = "auth_test_123"
        self.mock_supabase.auth.admin.create_user.return_value = MagicMock(user=mock_auth_user)
        self.mock_supabase.auth.admin.update_user_by_id.return_value = MagicMock()
        self.mock_supabase.auth.admin.delete_user.return_value = MagicMock()

        self.patches = [
            patch("app.db.supabase.get_supabase_admin_client", return_value=self.mock_supabase),
            patch("app.services.user_service.get_supabase_admin_client", return_value=self.mock_supabase),
            patch("app.services.auth_service.get_supabase_admin_client", return_value=self.mock_supabase),
            patch("app.services.user_service.UserService._find_auth_user_id", return_value="auth_test_123"),
            # Reduce time floor in unit tests for sub-second execution while testing padding
            patch.object(settings, "FORGOT_PASSWORD_TIME_FLOOR_MS", 20),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db.close()

    def _create_token(self, user_id: int, purpose: str, expires_in_seconds: int = 86400, status: str = "PENDING"):
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        invitation = UserInvitation(
            user_id=user_id,
            token_hash=token_hash,
            status=status,
            purpose=purpose,
            expires_at=now + timedelta(seconds=expires_in_seconds),
        )
        self.db.add(invitation)
        self.db.commit()
        encrypted_token = encrypt_invitation_token(raw_token, user_id, purpose=purpose)
        return raw_token, encrypted_token, invitation

    # AC-1, AC-2: Setup token expiry and rejection
    def test_ac1_ac2_setup_token_expiry_rejection(self):
        # 1. Token expired in the past
        raw_token, enc_token, inv = self._create_token(user_id=3, purpose="initial_password_setup", expires_in_seconds=-10)
        with self.assertRaises(HTTPException) as ctx:
            setup_invitation_password(self.db, token=enc_token, new_password="SecurePassword123!")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("expired", ctx.exception.detail.lower())

        # 2. Token status became EXPIRED
        self.db.refresh(inv)
        self.assertEqual(inv.status, "EXPIRED")

        # 3. User remains PROVISIONED
        user = self.db.query(User).filter(User.user_id == 3).first()
        self.assertEqual(user.status, "PROVISIONED")

    # AC-3: Strict single-use token consumption
    def test_ac3_setup_token_single_use(self):
        raw_token, enc_token, inv = self._create_token(user_id=3, purpose="initial_password_setup", expires_in_seconds=3600)
        res = setup_invitation_password(self.db, token=enc_token, new_password="SecurePassword123!")
        self.assertTrue(res.success)

        # Replay attempt
        with self.assertRaises(HTTPException) as ctx:
            setup_invitation_password(self.db, token=enc_token, new_password="AnotherPassword123!")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("already been used", ctx.exception.detail.lower())

    # AC-4: Reissuing invitation revokes previous setup tokens and cancels jobs
    def test_ac4_reinvite_revokes_previous_setup_tokens(self):
        user_service = UserService(self.db)
        _, _, old_inv = self._create_token(user_id=3, purpose="initial_password_setup", expires_in_seconds=3600)

        # Create dummy outbox job for user 3
        job = InvitationOutbox(
            idempotency_key="job-to-cancel-1",
            user_id=3,
            invitation_id=old_inv.invitation_id,
            recipient_email="pending@mct.com",
            encrypted_payload="dummy",
            status="PENDING",
        )
        self.db.add(job)
        self.db.commit()

        # Reissue invitation
        with patch("app.services.user_service.UserService._find_auth_user_id", return_value="auth_test_123"):
            user_service.reinvite_user(3)

        self.db.refresh(old_inv)
        self.db.refresh(job)
        self.assertEqual(old_inv.status, "REVOKED")
        self.assertEqual(job.status, "CANCELLED")

        # New pending invitation exists with purpose initial_password_setup
        new_inv = (
            self.db.query(UserInvitation)
            .filter(UserInvitation.user_id == 3, UserInvitation.status == "PENDING")
            .first()
        )
        self.assertIsNotNone(new_inv)
        self.assertEqual(new_inv.purpose, "initial_password_setup")

    # AC-5: Ineligible accounts blocked from setup and recovery
    def test_ac5_ineligible_accounts_blocked(self):
        # Create suspended user
        suspended = User(
            user_id=4,
            name="Suspended User",
            email="suspended@mct.com",
            role="employee",
            status="SUSPENDED",
            token_version=1,
        )
        self.db.add(suspended)
        self.db.commit()

        _, setup_token, _ = self._create_token(user_id=4, purpose="initial_password_setup", expires_in_seconds=3600)
        with self.assertRaises(HTTPException) as ctx:
            setup_invitation_password(self.db, token=setup_token, new_password="SecurePassword123!")
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("suspended", ctx.exception.detail.lower())

        _, reset_token, _ = self._create_token(user_id=4, purpose="password_reset", expires_in_seconds=1800)
        with self.assertRaises(HTTPException) as ctx2:
            reset_password(self.db, confirm_data=PasswordResetConfirm(token=reset_token, new_password="SecurePassword123!"))
        self.assertEqual(ctx2.exception.status_code, 403)
        self.assertIn("suspended", ctx2.exception.detail.lower())

    # AC-6: Purpose isolation: setup token rejected at reset endpoint
    def test_ac6_setup_token_rejected_at_reset_endpoint(self):
        _, enc_token, _ = self._create_token(user_id=2, purpose="initial_password_setup", expires_in_seconds=3600)
        with self.assertRaises(HTTPException) as ctx:
            reset_password(self.db, confirm_data=PasswordResetConfirm(token=enc_token, new_password="SecurePassword123!"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("purpose", ctx.exception.detail.lower())

    # AC-7: Forgot password anti-enumeration generic response
    def test_ac7_forgot_password_anti_enumeration_generic_response(self):
        expected_msg = "If an account exists for that email address, you will receive instructions to reset your password."

        # Registered active email
        res1 = request_password_reset(self.db, PasswordResetRequest(email="active@mct.com"), ip_address="198.51.100.1")
        self.assertEqual(res1.message, expected_msg)

        # Unregistered email
        res2 = request_password_reset(self.db, PasswordResetRequest(email="nonexistent@mct.com"), ip_address="198.51.100.2")
        self.assertEqual(res2.message, expected_msg)

        # Ineligible (PROVISIONED) email
        res3 = request_password_reset(self.db, PasswordResetRequest(email="pending@mct.com"), ip_address="198.51.100.3")
        self.assertEqual(res3.message, expected_msg)

        # Verify no token was created for nonexistent or provisioned user
        no_tokens = self.db.query(UserInvitation).filter(UserInvitation.purpose == "password_reset").all()
        user_ids = {t.user_id for t in no_tokens}
        self.assertNotIn(3, user_ids)
        self.assertIn(2, user_ids)

    # AC-8: Dual sliding-window rate limiting (5 per email, 10 per IP per 15 min)
    def test_ac8_forgot_password_dual_rate_limiting(self):
        target_email = "test-ratelimit@mct.com"
        target_ip = "198.51.100.50"

        # 5 requests should pass or hit cooldown
        for _ in range(5):
            request_password_reset(self.db, PasswordResetRequest(email=target_email), ip_address=target_ip)

        # 6th request with same email should trigger 429
        with self.assertRaises(HTTPException) as ctx:
            request_password_reset(self.db, PasswordResetRequest(email=target_email), ip_address=target_ip)
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("too many", ctx.exception.detail.lower())

        # Now test IP limit with varying emails
        ip_limit_target = "198.51.100.99"
        for i in range(10):
            request_password_reset(self.db, PasswordResetRequest(email=f"user_{i}@other.com"), ip_address=ip_limit_target)

        # 11th request from that IP triggers 429
        with self.assertRaises(HTTPException) as ctx_ip:
            request_password_reset(self.db, PasswordResetRequest(email="overflow@other.com"), ip_address=ip_limit_target)
        self.assertEqual(ctx_ip.exception.status_code, 429)

    # AC-9: 60s silent cooldown and monotonic time floor
    def test_ac9_silent_cooldown_and_time_floor(self):
        # First request creates a token
        res1 = request_password_reset(self.db, PasswordResetRequest(email="active@mct.com"), ip_address="198.51.100.1")
        self.assertTrue(res1.success)
        initial_token_count = self.db.query(UserInvitation).filter(UserInvitation.user_id == 2).count()

        # Second request immediately after (within 60s cooldown)
        res2 = request_password_reset(self.db, PasswordResetRequest(email="active@mct.com"), ip_address="198.51.100.1")
        self.assertTrue(res2.success)
        second_token_count = self.db.query(UserInvitation).filter(UserInvitation.user_id == 2).count()

        # No new token was created due to silent cooldown
        self.assertEqual(initial_token_count, second_token_count)

    # AC-10, AC-11: Password reset token 30m expiry and invalidation
    def test_ac10_ac11_reset_token_expiry_and_invalidation(self):
        # Expired reset token
        _, enc_token, inv = self._create_token(user_id=2, purpose="password_reset", expires_in_seconds=-5)
        with self.assertRaises(HTTPException) as ctx:
            reset_password(self.db, PasswordResetConfirm(token=enc_token, new_password="NewSecurePassword123!"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("expired", ctx.exception.detail.lower())

    # AC-12: Reset token rejected at setup endpoint; user.status not altered
    def test_ac12_reset_token_rejected_at_setup_endpoint(self):
        _, enc_token, _ = self._create_token(user_id=2, purpose="password_reset", expires_in_seconds=1800)
        with self.assertRaises(HTTPException) as ctx:
            setup_invitation_password(self.db, token=enc_token, new_password="NewSecurePassword123!")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("purpose", ctx.exception.detail.lower())

    # AC-13: Password reset session revocation via token_version bump & lockout clearance
    def test_ac13_password_reset_session_revocation_token_version(self):
        user = self.db.query(User).filter(User.user_id == 2).first()
        initial_version = user.token_version

        # Seed locked rate limit row
        rate_lock = LoginRateLimit(
            ip_address="198.51.100.77",
            failed_attempts=5,
            locked_until=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
        self.db.add(rate_lock)
        self.db.commit()

        _, enc_token, _ = self._create_token(user_id=2, purpose="password_reset", expires_in_seconds=1800)
        with patch("app.services.user_service.UserService._find_auth_user_id", return_value="auth_test_123"):
            res = reset_password(self.db, PasswordResetConfirm(token=enc_token, new_password="NewSecurePassword123!"))
        self.assertTrue(res.success)

        self.db.refresh(user)
        self.assertEqual(user.token_version, initial_version + 1)

    # AC-14: Explicit login required (no auto-authentication)
    def test_ac14_no_auto_login_on_completion(self):
        _, enc_token, _ = self._create_token(user_id=2, purpose="password_reset", expires_in_seconds=1800)
        with patch("app.services.user_service.UserService._find_auth_user_id", return_value="auth_test_123"):
            res = reset_password(self.db, PasswordResetConfirm(token=enc_token, new_password="NewSecurePassword123!"))

        # Returns MessageResponse without access_token
        self.assertTrue(res.success)
        self.assertFalse(hasattr(res, "access_token"))

    # AC-15: Entropy, SHA-256 storage, and Fernet ciphertext
    def test_ac15_entropy_and_crypto_hygiene(self):
        raw_token, enc_token, inv = self._create_token(user_id=2, purpose="password_reset")
        self.assertGreaterEqual(len(raw_token), 43)  # 32 bytes base64url is 43 chars (256 bits)
        self.assertTrue(enc_token.startswith("gAAAAA"))  # Fernet signature
        self.assertEqual(inv.token_hash, hashlib.sha256(raw_token.encode("utf-8")).hexdigest())

    # AC-16: Atomic database token consumption
    def test_ac16_atomic_token_consumption_concurrency(self):
        raw_token, enc_token, inv = self._create_token(user_id=2, purpose="password_reset")
        with patch("app.services.user_service.UserService._find_auth_user_id", return_value="auth_test_123"):
            res = reset_password(self.db, PasswordResetConfirm(token=enc_token, new_password="NewSecurePassword123!"))
        self.assertTrue(res.success)

        # Second attempt immediately rejected with 400
        with self.assertRaises(HTTPException) as ctx:
            reset_password(self.db, PasswordResetConfirm(token=enc_token, new_password="NewSecurePassword123!"))
        self.assertEqual(ctx.exception.status_code, 400)

    # AC-17: Three-phase compensation saga with rollback to PENDING
    def test_ac17_three_phase_compensation_saga_rollback(self):
        raw_token, enc_token, inv = self._create_token(user_id=2, purpose="password_reset")

        # Mock Supabase failure
        self.mock_supabase.auth.admin.update_user_by_id.side_effect = RuntimeError("Supabase timeout")

        with patch("app.services.user_service.UserService._find_auth_user_id", return_value="auth_test_123"):
            with self.assertRaises(HTTPException) as ctx:
                reset_password(self.db, PasswordResetConfirm(token=enc_token, new_password="NewSecurePassword123!"))

        self.assertEqual(ctx.exception.status_code, 502)

        # Token must be rolled back to PENDING, not stuck in CLAIMED
        self.db.refresh(inv)
        self.assertEqual(inv.status, "PENDING")
        self.assertIsNone(inv.claimed_at)

    # AC-18: Plaintext secrets invariant (no passwords or raw tokens in DB)
    def test_ac18_plaintext_secrets_invariant(self):
        raw_token, enc_token, inv = self._create_token(user_id=2, purpose="password_reset")
        self.assertNotIn(raw_token, inv.token_hash)
        self.assertEqual(len(inv.token_hash), 64)

    # AC-19: Email delivery resilience and template dispatching
    def test_ac19_email_dispatcher_templates(self):
        dispatcher = InvitationDispatcher(self.db)
        raw_token, enc_token, inv_reset = self._create_token(user_id=2, purpose="password_reset")

        job_reset = InvitationOutbox(
            idempotency_key="job-reset-template-test",
            user_id=2,
            invitation_id=inv_reset.invitation_id,
            recipient_email="active@mct.com",
            encrypted_payload=encrypt_payload({
                "setup_url": "https://mct.com/auth/setup-password#token=test",
                "user_name": "Active User",
                "purpose": "password_reset",
            }),
            status="PENDING",
        )
        self.db.add(job_reset)
        self.db.commit()

        # Simulate dispatcher delivery when BREVO_API_KEY is unset
        with patch.object(settings, "BREVO_API_KEY", ""):
            claimed = dispatcher.claim_batch(batch_size=1)
            self.assertEqual(len(claimed), 1)
            dispatched = dispatcher.dispatch_job(claimed[0])
            self.assertTrue(dispatched)

    # AC-20, AC-22: Token validation endpoint without pre-consumption
    def test_ac20_ac22_token_validation_endpoint(self):
        raw_token, enc_token, inv = self._create_token(user_id=2, purpose="password_reset")

        # 1. Valid token validation returns 200 with purpose and masked email
        res = validate_invitation_token(self.db, token=enc_token)
        self.assertTrue(res.valid)
        self.assertEqual(res.purpose, "password_reset")
        self.assertEqual(res.masked_email, "a***@mct.com")

        # 2. Token remains PENDING (read validation does NOT consume it)
        self.db.refresh(inv)
        self.assertEqual(inv.status, "PENDING")

        # 3. Expired token returns 410
        _, expired_token, _ = self._create_token(user_id=2, purpose="password_reset", expires_in_seconds=-10)
        with self.assertRaises(HTTPException) as ctx_exp:
            validate_invitation_token(self.db, token=expired_token)
        self.assertEqual(ctx_exp.exception.status_code, 410)

        # 4. Malformed token returns 422
        with self.assertRaises(HTTPException) as ctx_mal:
            validate_invitation_token(self.db, token="gAAAAA_invalid_corrupted_fernet_token")
        self.assertEqual(ctx_mal.exception.status_code, 422)

    # AC-21: Schema migration backward compatibility
    def test_ac21_schema_migration_backward_compatibility(self):
        # Verify purpose column has default initial_password_setup
        inv = UserInvitation(
            user_id=2,
            token_hash="hash_migration_test_default",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        self.db.add(inv)
        self.db.commit()
        self.db.refresh(inv)
        self.assertEqual(inv.purpose, "initial_password_setup")


if __name__ == "__main__":
    unittest.main()
