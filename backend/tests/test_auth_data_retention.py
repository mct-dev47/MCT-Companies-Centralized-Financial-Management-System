"""
Automated Test Suite for Auth Tables Data Retention, Scrubbing, Replay Detection, and Advisory-Locked Purging.
"""
import hashlib
import os
import sys
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

sys.path.insert(0, os.path.abspath("backend"))

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models
from app.core.config import settings
from app.core.security import (
    _revoked_tokens,
    _valid_token_cache,
    revoke_access_token,
    verify_token,
)
from app.db.migrations import get_applied_migrations, rollback_migration_0051, run_migrations
from app.db.session import Base
from app.models.invitation import InvitationOutbox, UserInvitation
from app.models.security import LoginOtpChallenge, RateLimit, RevokedToken, UserSession
from app.models.user import User, UserCompany
from app.services.auth_service import create_jwt_token
from app.services.invitation_dispatcher import cleanup_invitation_tables
from app.services.otp_service import otp_service
from app.services.rate_limiter import rate_limiter
from app.services.session_service import (
    _revoked_families,
    _rotated_tokens,
    cleanup_expired_revoked_tokens,
    cleanup_expired_user_sessions,
    create_refresh_cookie_payload,
    register_user_session,
    revoke_session,
    rotate_refresh_token,
    verify_refresh_cookie,
)
from app.tasks.retention_purge import (
    _local_purge_lock,
    run_auth_retention_purge,
)


class TestAuthDataRetention(unittest.TestCase):
    def setUp(self):
        _revoked_tokens.clear()
        _valid_token_cache.clear()
        _revoked_families.clear()
        _rotated_tokens.clear()

        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.db = self.Session()

        self.user = User(
            user_id=101,
            name="Retention Tester",
            email="retention@mct.com",
            role="admin",
            is_admin=True,
            status="ACTIVE",
            token_version=1,
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        _revoked_tokens.clear()
        _valid_token_cache.clear()
        _revoked_families.clear()
        _rotated_tokens.clear()

    def test_1_revoked_tokens_sets_expires_at_from_jwt_and_session(self):
        """Task 1: revoke_access_token sets expires_at from JWT exp claim; revoke_session sets session max lifetime."""
        jwt_secret = "unit-test-jwt-secret-key-at-least-32-chars!"
        with patch.object(settings, "SUPABASE_JWT_SECRET", jwt_secret):
            token = create_jwt_token(
                user_id=101,
                email="retention@mct.com",
                is_admin=True,
                expires_delta_seconds=600,
            )
            revoke_access_token(token, db=self.db)

        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        rev_row = self.db.query(RevokedToken).filter(RevokedToken.token_hash == token_hash).first()
        self.assertIsNotNone(rev_row)
        self.assertIsNotNone(rev_row.expires_at)
        self.assertEqual(rev_row.user_id, 101)
        exp_dt = rev_row.expires_at.replace(tzinfo=timezone.utc) if rev_row.expires_at.tzinfo is None else rev_row.expires_at
        # Should be ~10 minutes in the future
        delta = (exp_dt - datetime.now(timezone.utc)).total_seconds()
        self.assertGreater(delta, 500)
        self.assertLessEqual(delta, 610)

        # Session revocation sets expires_at to created_at + SESSION_ABSOLUTE_LIFETIME_SECONDS
        cookie_val, payload = create_refresh_cookie_payload(
            user_id=101,
            email="retention@mct.com",
            token_version=1,
            remember_me=True,
        )
        revoke_session(
            self.db,
            sid=payload["sid"],
            family_id=payload["family_id"],
            nonce=payload["nonce"],
            user_id=101,
            created_at=payload["created_at"],
        )
        fam_hash = hashlib.sha256(payload["family_id"].encode("utf-8")).hexdigest()
        fam_row = self.db.query(RevokedToken).filter(RevokedToken.token_hash == fam_hash).first()
        self.assertIsNotNone(fam_row)
        self.assertIsNotNone(fam_row.expires_at)

    def test_2_revocation_check_ignores_expired_and_honors_active_or_null(self):
        """Task 1: verify_token and verify_refresh_cookie ignore expired RevokedToken rows and block active/NULL rows."""
        jwt_secret = "unit-test-jwt-secret-key-at-least-32-chars!"
        with patch.object(settings, "SUPABASE_JWT_SECRET", jwt_secret), patch(
            "app.db.session.SessionLocal", self.Session
        ):
            token = create_jwt_token(
                user_id=101,
                email="retention@mct.com",
                is_admin=True,
                expires_delta_seconds=600,
            )
            token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

            # 1. Insert an already-expired RevokedToken row -> verify_token should ignore it
            self.db.add(
                RevokedToken(
                    token_hash=token_hash,
                    user_id=101,
                    expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
                )
            )
            self.db.commit()

            claims = verify_token(token)
            self.assertEqual(claims["sub"], "101")

            # 2. Update row to NULL expires_at (legacy row) -> verify_token must treat it as revoked
            _valid_token_cache.clear()
            _revoked_tokens.clear()
            self.db.query(RevokedToken).filter(RevokedToken.token_hash == token_hash).update(
                {"expires_at": None}
            )
            self.db.commit()

            with self.assertRaises(HTTPException) as ctx:
                verify_token(token)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_3_persisted_refresh_token_replay_detection_across_workers(self):
        """Task 6: Cross-worker requests within the 15s grace window succeed without false-positive family revocation, while replays outside the grace window revoke the family."""
        cookie_val, old_payload = create_refresh_cookie_payload(
            user_id=101,
            email="retention@mct.com",
            token_version=1,
            remember_me=True,
        )
        register_user_session(
            self.db,
            user_id=101,
            sid=old_payload["sid"],
            family_id=old_payload["family_id"],
            ip_address="127.0.0.1",
        )

        verification = verify_refresh_cookie(cookie_val, self.db)
        new_cookie_val, _, _ = rotate_refresh_token(
            old_payload=verification["payload"],
            user=verification["user"],
            db=self.db,
        )

        # Simulate Worker B (empty in-memory _rotated_tokens) receiving a concurrent tab request within 15s grace window
        _rotated_tokens.clear()
        grace_cross_worker = verify_refresh_cookie(cookie_val, self.db)
        self.assertEqual(grace_cross_worker["user"].user_id, 101)

        # Simulate replay after the 15s grace window (e.g., 30 seconds later) on Worker B
        with patch("app.services.session_service._current_timestamp", return_value=time.time() + 30):
            with self.assertRaises(HTTPException) as ctx:
                verify_refresh_cookie(cookie_val, self.db)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertEqual(ctx.exception.headers.get("X-Reason-Code"), "TOKEN_REUSE_DETECTED")

            # Now the newly rotated cookie in the same family is also rejected
            with self.assertRaises(HTTPException) as ctx2:
                verify_refresh_cookie(new_cookie_val, self.db)
            self.assertEqual(ctx2.exception.status_code, 401)

    def test_4_terminal_scrubbing_of_otp_hmac(self):
        """Task 5: LoginOtpChallenge scrubs otp_hmac to NULL on used, expired, invalidated, and delivery_failed."""
        now = datetime.now(timezone.utc)
        cid, code, oid = otp_service.create_login_challenge(
            self.db, email="retention@mct.com", ip_address="127.0.0.1", user_id=101, now=now
        )
        row = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.otp_id == oid).first()
        self.assertIsNotNone(row.otp_hmac)

        # Consume challenge -> status == 'used' and otp_hmac is NULL
        otp_service.verify_otp(self.db, challenge_id=cid, submitted_otp=code, ip_address="127.0.0.1", now=now)
        self.db.refresh(row)
        self.assertEqual(row.status, "used")
        self.assertIsNone(row.otp_hmac)

        # Expired challenge -> status == 'expired' and otp_hmac is NULL
        cid2, code2, oid2 = otp_service.create_login_challenge(
            self.db, email="retention@mct.com", ip_address="127.0.0.1", user_id=101, now=now
        )
        with self.assertRaises(HTTPException):
            otp_service.verify_otp(
                self.db,
                challenge_id=cid2,
                submitted_otp=code2,
                ip_address="127.0.0.1",
                now=now + timedelta(minutes=10),
            )
        row2 = self.db.query(LoginOtpChallenge).filter(LoginOtpChallenge.otp_id == oid2).first()
        self.assertEqual(row2.status, "expired")
        self.assertIsNone(row2.otp_hmac)

    def test_5_batched_purge_skips_active_lockouts_and_dead_letters(self):
        """Tasks 2 & 4: Batched purge deletes expired rows while preserving active lockouts and DEAD_LETTER outbox rows."""
        now = datetime.now(timezone.utc)

        # 1. Seed RevokedToken: 3 expired, 1 active
        for i in range(3):
            self.db.add(
                RevokedToken(
                    token_hash=f"expired_hash_{i}",
                    user_id=101,
                    expires_at=now - timedelta(hours=1),
                )
            )
        self.db.add(
            RevokedToken(
                token_hash="active_hash_1",
                user_id=101,
                expires_at=now + timedelta(hours=1),
            )
        )

        # 2. Seed RateLimit: 2 old unlocked (>7d), 1 old but actively locked
        for i in range(2):
            self.db.add(
                RateLimit(
                    key=f"old_unlocked_{i}",
                    rate_type="login_ip",
                    identifier=f"192.0.2.{i}",
                    attempts=2,
                    window_start=now - timedelta(days=10),
                    locked_until=None,
                    last_attempt_at=now - timedelta(days=10),
                )
            )
        self.db.add(
            RateLimit(
                key="active_lockout_1",
                rate_type="login_ip",
                identifier="192.0.2.99",
                attempts=10,
                window_start=now - timedelta(days=10),
                locked_until=now + timedelta(minutes=30),
                last_attempt_at=now - timedelta(days=10),
            )
        )

        # 3. Seed InvitationOutbox: 1 old DISPATCHED (>60d), 1 old DEAD_LETTER (>60d)
        inv = UserInvitation(
            user_id=101,
            token_hash=None,
            status="ACCEPTED",
            purpose="initial_password_setup",
            expires_at=now - timedelta(days=70),
        )
        self.db.add(inv)
        self.db.flush()

        self.db.add(
            InvitationOutbox(
                idempotency_key="old_dispatched_1",
                user_id=101,
                invitation_id=inv.invitation_id,
                recipient_email="retention@mct.com",
                status="DISPATCHED_TO_PROVIDER",
                created_at=now - timedelta(days=70),
                updated_at=now - timedelta(days=70),
            )
        )
        self.db.add(
            InvitationOutbox(
                idempotency_key="old_dead_letter_1",
                user_id=101,
                invitation_id=inv.invitation_id,
                recipient_email="retention@mct.com",
                status="DEAD_LETTER",
                created_at=now - timedelta(days=70),
                updated_at=now - timedelta(days=70),
            )
        )
        self.db.commit()

        # Run purge with batch_size=1 to verify multi-batch looping
        summary = run_auth_retention_purge(
            session_factory=self.Session,
            batch_size=1,
            now=now,
            include_activity_logs=False,
        )

        self.assertEqual(summary["revoked_tokens"], 3)
        self.assertEqual(summary["rate_limits"], 2)
        self.assertEqual(summary["invitation_outbox"], 1)

        # Active RevokedToken, active RateLimit lockout, and DEAD_LETTER outbox row must remain
        self.assertEqual(self.db.query(RevokedToken).count(), 1)
        self.assertIsNotNone(self.db.query(RateLimit).filter(RateLimit.key == "active_lockout_1").first())
        self.assertEqual(self.db.query(InvitationOutbox).count(), 1)
        self.assertEqual(self.db.query(InvitationOutbox).first().status, "DEAD_LETTER")

    def test_6_advisory_lock_prevents_concurrent_runs(self):
        """Task 2: Advisory lock (pg_try_advisory_lock and local lock) prevents concurrent purge runs."""
        # 1. Test PostgreSQL advisory lock returning False when another worker holds it
        with patch(
            "app.tasks.retention_purge._try_acquire_advisory_lock",
            return_value=(False, True, None, None),
        ):
            res = run_auth_retention_purge(
                session_factory=self.Session,
                include_activity_logs=False,
            )
            self.assertEqual(res, {"skipped_locked": 1})

        # 2. Test local non-blocking lock when already held in-process
        _local_purge_lock.acquire()
        try:
            res2 = run_auth_retention_purge(
                session_factory=self.Session,
                include_activity_logs=False,
            )
            self.assertEqual(res2, {"skipped_locked": 1})
        finally:
            _local_purge_lock.release()

    def test_7_migration_0051_and_reversible_rollback(self):
        """Tasks 1, 3, 5: Migration 0051 backfills/prunes revoked_tokens, drops login_rate_limits, and is reversible."""
        mig_engine = create_engine("sqlite:///:memory:")
        with mig_engine.begin() as conn:
            conn.execute(
                text(
                    """
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
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE revoked_tokens (
                        token_hash VARCHAR(64) PRIMARY KEY,
                        user_id INTEGER NULL,
                        expires_at DATETIME NULL,
                        created_at DATETIME NOT NULL
                    );
                    """
                )
            )
            # 1 ancient NULL-expiry row (>8h old) and 1 recent NULL-expiry row
            conn.execute(
                text(
                    "INSERT INTO revoked_tokens (token_hash, user_id, expires_at, created_at) "
                    "VALUES ('ancient_null', 1, NULL, datetime('now', '-24 hours')), "
                    "       ('recent_null', 1, NULL, datetime('now', '-1 hours'))"
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE login_rate_limits (
                        ip_address VARCHAR(45) PRIMARY KEY,
                        failed_attempts INTEGER NOT NULL DEFAULT 0,
                        locked_until DATETIME NULL,
                        last_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    """
                )
            )

        applied = run_migrations(mig_engine)
        self.assertIn("0051_auth_data_retention", applied)

        inspector = inspect(mig_engine)
        self.assertNotIn("login_rate_limits", inspector.get_table_names())
        rl_indexes = {idx["name"] for idx in inspector.get_indexes("rate_limits")}
        outbox_indexes = {idx["name"] for idx in inspector.get_indexes("invitation_outbox")}
        sess_indexes = {idx["name"] for idx in inspector.get_indexes("user_sessions")}
        self.assertIn("idx_rate_limits_retention", rl_indexes)
        self.assertIn("idx_outbox_retention", outbox_indexes)
        self.assertIn("idx_user_sessions_created_at", sess_indexes)

        with mig_engine.connect() as conn:
            rows = conn.execute(text("SELECT token_hash, expires_at FROM revoked_tokens")).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], "recent_null")
            self.assertIsNotNone(rows[0][1])

        # Test reversible rollback
        rollback_migration_0051(mig_engine)
        inspector_after = inspect(mig_engine)
        self.assertIn("login_rate_limits", inspector_after.get_table_names())
        self.assertNotIn("0051_auth_data_retention", get_applied_migrations(mig_engine))
        mig_engine.dispose()


if __name__ == "__main__":
    unittest.main()

