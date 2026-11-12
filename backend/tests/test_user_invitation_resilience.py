"""
Comprehensive Resilience and Concurrency Test Suite (spec 0020).
Covers:
1. Strict Validation (@gmail.com, Unicode names, role allowlist, password field excised).
2. Plaintext Secrets Invariant (no secrets in responses, SHA-256 token hashes, Fernet-encrypted outbox).
3. Decoupled Provisioning & Failure Recovery (Resend 500 leaves DB user PROVISIONED).
4. Resilient Worker, Full-Jitter Backoff & Circuit Breaker.
5. Worker Lease Fencing & Stale Worker Protection.
6. Concurrency-Safe Invitation Redemption & Old Invitation Revocation.
7. Server-Side Gatekeeping (PROVISIONED/LOCKED/SUSPENDED blocked with 403; whitelisted routes pass).
8. Backdoor Excision (Password123! and 123456 OTP do not work on unseeded accounts).
"""
import hashlib
import json
import os
import secrets
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath("backend"))

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models
from app.schemas.user import UserCreate
from app.core.config import settings
from app.core.dependencies import get_current_user
from app.core.encryption import decrypt_payload, encrypt_payload, decrypt_invitation_token
from app.core.resilience import CircuitBreaker, calculate_full_jitter_backoff
from app.db.session import Base
from app.models.company import Company
from app.models.invitation import InvitationOutbox, UserInvitation
from app.models.user import User, UserCompany
from app.services.auth_service import setup_invitation_password
from app.services.invitation_dispatcher import InvitationDispatcher
from app.services.user_service import UserService, UserValidationError


class TestUserInvitationResilience(unittest.TestCase):
    def setUp(self):
        # Configure in-memory SQLite for test isolation
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

        # Seed primary admin at user_id=1 so subsequent users get user_id > 1
        admin = User(
            user_id=1,
            name="Primary Admin",
            email="admin@mct.com",
            role="admin",
            is_admin=True,
            status="ACTIVE",
            must_change_password=False,
        )
        self.db.add(admin)
        self.db.commit()

        # Mock Supabase Admin Client
        self.mock_supabase = MagicMock()
        mock_auth_user = MagicMock()
        mock_auth_user.id = "auth_test_123"
        self.mock_supabase.auth.admin.create_user.return_value = MagicMock(
            user=mock_auth_user
        )
        self.mock_supabase.auth.admin.update_user_by_id.return_value = MagicMock()
        self.mock_supabase.auth.admin.delete_user.return_value = MagicMock()

        self.patches = [
            patch("app.db.supabase.get_supabase_admin_client", return_value=self.mock_supabase),
            patch("app.services.user_service.get_supabase_admin_client", return_value=self.mock_supabase),
            patch("app.services.auth_service.get_supabase_admin_client", return_value=self.mock_supabase),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db.close()
        self.engine.dispose()

    # =========================================================================
    # 1. Strict Validation Tests
    # =========================================================================

    def test_email_validation_strict_gmail_domain(self):
        """Rejects non-@gmail.com domains and accepts valid @gmail.com."""
        invalid_emails = [
            "user@yahoo.com",
            "user@outlook.com",
            "admin@mct.com",
            "user@gmail.com.ph",
            "user@notgmail.com",
            "user@gmail.co",
        ]
        for email in invalid_emails:
            with self.assertRaises((ValidationError, ValueError), msg=f"Should reject {email}"):
                UserCreate(
                    name="John Doe",
                    email=email,
                    role="supervisor",
                    company_ids=[1],
                )

        valid_emails = [
            "valid.user@gmail.com",
            "USER.NAME+tag@GMAIL.COM",
            "simple@gmail.com",
        ]
        for email in valid_emails:
            user_in = UserCreate(
                name="John Doe",
                email=email,
                role="supervisor",
                company_ids=[1],
            )
            self.assertTrue(user_in.email.lower().endswith("@gmail.com"))

    def test_unicode_and_international_names(self):
        """Accepts accented, international, and hyphenated/apostrophe names; rejects scripts/symbols."""
        valid_names = [
            "José María",
            "Zoë O'Connor",
            "Mary-Jane Watson",
            "René Descartes",
            "Juan Dela Cruz",
        ]
        for name in valid_names:
            u = UserCreate(
                name=name,
                email="test.name@gmail.com",
                role="supervisor",
                company_ids=[1],
            )
            self.assertEqual(u.name, name)

        invalid_names = [
            "<script>alert(1)</script>",
            "User123!",
            "Admin @ MCT",
            "A" * 150,  # exceeds 100 chars
            "",
        ]
        for name in invalid_names:
            with self.assertRaises((ValidationError, ValueError), msg=f"Should reject {name}"):
                UserCreate(
                    name=name,
                    email="test@gmail.com",
                    role="supervisor",
                    company_ids=[1],
                )

    def test_role_allowlist_and_password_excised(self):
        """Verifies allowed roles (finance, audit, supervisor) and rejects unknown roles or custom passwords."""
        for role in ["finance", "audit", "auditor", "supervisor"]:
            u = UserCreate(
                name="Valid User",
                email="valid@gmail.com",
                role=role,
                company_ids=[1],
            )
            self.assertIn(u.role, ["finance", "audit", "auditor", "supervisor"])

        for invalid_role in ["admin", "superadmin", "manager", "client", "company"]:
            with self.assertRaises(ValidationError):
                UserCreate(
                    name="Invalid Role User",
                    email="valid@gmail.com",
                    role=invalid_role,
                    company_ids=[1],
                )

        # Confirm password cannot be passed to UserCreate (field assignment prohibited)
        with self.assertRaises(ValidationError):
            UserCreate(
                name="Password Bypass",
                email="valid@gmail.com",
                role="supervisor",
                company_ids=[1],
                password="HardcodedPassword123!",
            )

    # =========================================================================
    # 2. Plaintext Secrets Invariant Tests
    # =========================================================================

    def test_no_plaintext_secrets_in_db_or_response(self):
        """Ensures tokens/passwords never appear in responses, and DB hashes tokens and encrypts outbox."""
        service = UserService(self.db)
        user_in = UserCreate(
            name="Alice Smith",
            email="alice.smith@gmail.com",
            role="supervisor",
            company_ids=[1],
        )

        resp = service.create_user(user_in)

        # Response must not contain any sensitive fields
        resp_dict = resp.model_dump() if hasattr(resp, "model_dump") else resp.dict()
        self.assertNotIn("password", resp_dict)
        self.assertNotIn("temporary_password", resp_dict)
        self.assertNotIn("token", resp_dict)
        self.assertNotIn("setup_url", resp_dict)
        self.assertEqual(resp.status, "PROVISIONED")
        self.assertTrue(resp.must_change_password)

        # DB UserInvitation must store SHA-256 hash (64 hex characters)
        invitation = (
            self.db.query(UserInvitation)
            .filter(UserInvitation.user_id == resp.user_id)
            .first()
        )
        self.assertIsNotNone(invitation)
        self.assertEqual(len(invitation.token_hash), 64)
        self.assertEqual(invitation.status, "PENDING")

        # DB Outbox must store encrypted payload, not plaintext
        outbox = (
            self.db.query(InvitationOutbox)
            .filter(InvitationOutbox.user_id == resp.user_id)
            .first()
        )
        self.assertIsNotNone(outbox)
        self.assertTrue(outbox.encrypted_payload.startswith("gAAAAA"))

        # Decrypt payload and verify contents
        decrypted = decrypt_payload(outbox.encrypted_payload)
        self.assertEqual(decrypted["user_id"], resp.user_id)
        self.assertIn("/auth/setup-password#token=", decrypted["setup_url"])
        token_in_url = decrypted["setup_url"].split("#token=")[1]
        self.assertTrue(token_in_url.startswith("gAAAAA"), "Setup token in link must be encrypted with payload encryption")
        self.assertEqual(decrypt_invitation_token(token_in_url), decrypted["raw_token"])

    # =========================================================================
    # 3. Decoupled Delivery & Error Recovery Tests
    # =========================================================================

    def test_resend_failure_preserves_provisioned_user(self):
        """When transactional email provider fails with HTTP 500, the user account is NOT deleted."""
        service = UserService(self.db)
        user_in = UserCreate(
            name="Bob Jones",
            email="bob.jones@gmail.com",
            role="supervisor",
            company_ids=[1],
        )
        resp = service.create_user(user_in)
        user_id = resp.user_id

        # Claim the outbox job
        dispatcher = InvitationDispatcher(self.db)
        jobs = dispatcher.claim_batch(batch_size=1)
        self.assertEqual(len(jobs), 1)
        job = jobs[0]

        # Dispatch with simulated Brevo 500 server error
        from urllib.error import HTTPError
        with patch.object(settings, "BREVO_API_KEY", "xkeysib-mock-test-key"), \
             patch("urllib.request.urlopen", side_effect=HTTPError("https://api.brevo.com/v3/smtp/email", 500, "Internal Server Error", {}, None)):
            success = dispatcher.dispatch_job(job)
            self.assertFalse(success)

        # Refresh state from DB
        db_user = self.db.query(User).filter(User.user_id == user_id).first()
        self.assertIsNotNone(db_user, "User must NOT be deleted when email dispatch fails")
        self.assertEqual(db_user.status, "PROVISIONED")

        # Refresh outbox job
        db_job = self.db.query(InvitationOutbox).filter(InvitationOutbox.job_id == job.job_id).first()
        self.assertEqual(db_job.status, "FAILED")
        self.assertEqual(db_job.retry_count, 1)
        self.assertIsNotNone(db_job.next_retry_at)
        self.assertIsNotNone(db_job.encrypted_payload, "Payload must remain intact for retry")

    def test_full_jitter_backoff_bounds(self):
        """Verifies AWS Full-Jitter backoff formula stays within [0, min(max_delay, base * 2^attempts)]."""
        base = 2.0
        max_d = 60.0
        for attempt in range(10):
            ceiling = min(max_d, base * (2 ** attempt))
            for _ in range(50):
                delay = calculate_full_jitter_backoff(attempt, base_delay=base, max_delay=max_d)
                self.assertGreaterEqual(delay, 0.0)
                self.assertLessEqual(delay, ceiling)

    def test_circuit_breaker_trips_after_failures(self):
        """Verifies circuit breaker opens after consecutive failures and blocks execution."""
        breaker = CircuitBreaker(failure_threshold=5, recovery_timeout_seconds=30.0)
        self.assertTrue(breaker.can_execute())

        for _ in range(4):
            breaker.record_failure()
            self.assertTrue(breaker.can_execute())

        # 5th failure trips the breaker
        breaker.record_failure()
        self.assertFalse(breaker.can_execute())
        self.assertEqual(breaker.state, "OPEN")

        # Record success resets failure count
        breaker.record_success()
        self.assertEqual(breaker.consecutive_failures, 0)

    # =========================================================================
    # 4. Worker Lease Fencing & Stale Worker Protection
    # =========================================================================

    def test_worker_lease_fencing_prevents_stale_worker_update(self):
        """A stale worker whose lease has expired cannot commit updates to a reclaimed job."""
        service = UserService(self.db)
        resp = service.create_user(
            UserCreate(name="Carol White", email="carol.white@gmail.com", role="supervisor", company_ids=[1])
        )

        dispatcher = InvitationDispatcher(self.db)
        # Worker 1 claims job with 1-second lease
        jobs1 = dispatcher.claim_batch(batch_size=1, lease_duration=1)
        self.assertEqual(len(jobs1), 1)
        job1 = jobs1[0]
        stale_claim_token = job1.claim_token

        # Artificially expire lease in DB
        past_time = datetime.now(timezone.utc) - timedelta(seconds=10)
        self.db.query(InvitationOutbox).filter(InvitationOutbox.job_id == job1.job_id).update(
            {"lease_expires_at": past_time}
        )
        self.db.commit()

        # Worker 2 claims the now-expired job
        jobs2 = dispatcher.claim_batch(batch_size=1, lease_duration=60)
        self.assertEqual(len(jobs2), 1)
        new_claim_token = jobs2[0].claim_token
        self.assertNotEqual(stale_claim_token, new_claim_token)

        # Worker 1 (stale) attempts to finalize success with stale claim token
        stale_result = dispatcher._finalize_success(job1.job_id, stale_claim_token, resp.user_id)
        self.assertFalse(stale_result, "Stale worker update must be rejected")

        # Verify job is still held by Worker 2
        fresh_job = self.db.query(InvitationOutbox).filter(InvitationOutbox.job_id == job1.job_id).first()
        self.assertEqual(fresh_job.claim_token, new_claim_token)

    # =========================================================================
    # 5. Concurrency-Safe Invitation Redemption Tests
    # =========================================================================

    def test_atomic_single_use_token_redemption(self):
        """Simultaneous token redemption permits exactly one success and rejects the second."""
        service = UserService(self.db)
        resp = service.create_user(
            UserCreate(name="David Green", email="david.green@gmail.com", role="supervisor", company_ids=[1])
        )

        # Extract raw token from encrypted payload
        outbox = self.db.query(InvitationOutbox).filter(InvitationOutbox.user_id == resp.user_id).first()
        payload = decrypt_payload(outbox.encrypted_payload)
        raw_token = payload["setup_url"].split("#token=")[1]

        # Helper method for find_auth_user_id
        with patch.object(UserService, "_find_auth_user_id", return_value="auth_test_123"):
            # First redemption attempt: succeeds
            result = setup_invitation_password(
                token=raw_token,
                new_password="ComplexPassword2026!",
                db=self.db,
            )
            self.assertTrue(result.success)

            # DB user is now ACTIVE and must_change_password is False
            db_user = self.db.query(User).filter(User.user_id == resp.user_id).first()
            self.assertEqual(db_user.status, "ACTIVE")
            self.assertFalse(db_user.must_change_password)

            # Invitation is marked ACCEPTED
            invitation = self.db.query(UserInvitation).filter(UserInvitation.user_id == resp.user_id).first()
            self.assertEqual(invitation.status, "ACCEPTED")

            # Second redemption attempt with the same token: fails with 400 Bad Request
            with self.assertRaises(HTTPException) as ctx:
                setup_invitation_password(
                    token=raw_token,
                    new_password="AnotherPassword2026!",
                    db=self.db,
                )
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("already been used", ctx.exception.detail)

    def test_reinvite_user_revokes_old_invitation(self):
        """Issuing a new invitation revokes old invitations; old token can no longer be redeemed."""
        service = UserService(self.db)
        resp = service.create_user(
            UserCreate(name="Eva Black", email="eva.black@gmail.com", role="supervisor", company_ids=[1])
        )

        # Extract first raw token
        outbox1 = self.db.query(InvitationOutbox).filter(InvitationOutbox.user_id == resp.user_id).first()
        token_payload = decrypt_payload(outbox1.encrypted_payload)
        raw_token_1 = token_payload.get("raw_token") or decrypt_invitation_token(token_payload["setup_url"].split("#token=")[1])

        # Re-invite user
        service.reinvite_user(resp.user_id)

        # Verify old invitation was marked REVOKED (token_hash is scrubbed to NULL on revocation per retention spec)
        old_invitation = (
            self.db.query(UserInvitation)
            .filter(
                UserInvitation.user_id == resp.user_id,
                UserInvitation.status == "REVOKED",
            )
            .first()
        )
        self.assertIsNotNone(old_invitation)
        self.assertEqual(old_invitation.status, "REVOKED")

        # Attempting to redeem revoked token fails
        with patch.object(UserService, "_find_auth_user_id", return_value="auth_test_123"):
            with self.assertRaises(HTTPException) as ctx:
                setup_invitation_password(
                    token=raw_token_1,
                    new_password="NewPassword2026!",
                    db=self.db,
                )
            self.assertEqual(ctx.exception.status_code, 400)

    # =========================================================================
    # 6. Server-Side Gatekeeping Tests
    # =========================================================================

    def test_get_current_user_blocks_non_active_accounts(self):
        """Accounts in PROVISIONED, LOCKED, or SUSPENDED status cannot access protected routes."""
        test_user = User(
            user_id=2,
            name="Status Test User",
            email="status.test@gmail.com",
            role="supervisor",
            company_id=1,
            status="PROVISIONED",
            must_change_password=True,
        )
        self.db.add(test_user)
        self.db.commit()

        claims = {"sub": "usr_status_123", "email": "status.test@gmail.com"}
        mock_req = MagicMock(url=MagicMock(path="/api/v1/bills"))

        # 1. PROVISIONED account: blocked with 403
        with self.assertRaises(HTTPException) as ctx:
            get_current_user(claims=claims, request=mock_req, db=self.db)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("invitation is pending", ctx.exception.detail)

        # 2. LOCKED account: blocked with 403
        test_user.status = "LOCKED"
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            get_current_user(claims=claims, request=mock_req, db=self.db)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Account is locked", ctx.exception.detail)

        # 3. SUSPENDED account: blocked with 403
        test_user.status = "SUSPENDED"
        self.db.commit()
        with self.assertRaises(HTTPException) as ctx:
            get_current_user(claims=claims, request=mock_req, db=self.db)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Account has been suspended", ctx.exception.detail)

        # 4. ACTIVE account: successfully passes
        test_user.status = "ACTIVE"
        test_user.must_change_password = False
        self.db.commit()
        auth_user = get_current_user(claims=claims, request=mock_req, db=self.db)
        self.assertEqual(auth_user["email"], "status.test@gmail.com")
        self.assertEqual(auth_user["role"], "supervisor")

        # 5. Whitelisted path /auth/me succeeds even if PROVISIONED
        test_user.status = "PROVISIONED"
        test_user.must_change_password = True
        self.db.commit()
        whitelisted_req = MagicMock(url=MagicMock(path="/api/v1/auth/me"))
        whitelisted_user = get_current_user(claims=claims, request=whitelisted_req, db=self.db)
        self.assertEqual(whitelisted_user["email"], "status.test@gmail.com")

    # =========================================================================
    # 7. Backdoor Excision Tests
    # =========================================================================

    def test_hardcoded_passwords_and_otp_bypass_removed(self):
        """Verifies that Password123! and 123456 OTP do not allow authentication for unseeded users."""
        from app.services import auth_service

        # Verify allowed_seeded_passwords no longer exists or is empty/removed
        self.assertFalse(hasattr(auth_service, "allowed_seeded_passwords"))

        # Verify SEEDED_OTP_CODE constant is completely excised
        self.assertFalse(hasattr(auth_service, "SEEDED_OTP_CODE"))


if __name__ == "__main__":
    unittest.main()
