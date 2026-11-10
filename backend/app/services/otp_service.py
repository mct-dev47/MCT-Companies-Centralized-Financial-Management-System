import hmac
import hashlib
import logging
import math
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.errors import RateLimitException
from app.models.security import LoginOtpChallenge
from app.services.rate_limiter import (
    rate_limiter,
    get_otp_resend_combo_key,
    get_otp_resend_ip_key,
)

logger = logging.getLogger(__name__)


def compute_otp_hmac(otp: str) -> str:
    secret = settings.otp_hmac_secret_plain.encode("utf-8")
    return hmac.new(secret, otp.strip().encode("utf-8"), hashlib.sha256).hexdigest()


class OtpService:
    def create_login_challenge(
        self,
        db: Session,
        email: str,
        ip_address: str,
        user_id: Optional[int] = None,
        now: Optional[datetime] = None,
    ) -> Tuple[str, str, str]:
        """
        Generates a 6-digit OTP and creates an active OTP challenge in PostgreSQL/SQLite.
        Returns (challenge_id, otp_code, otp_id).
        """
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        challenge_id = str(uuid.uuid4())
        otp_id = str(uuid.uuid4())
        otp_code = f"{secrets.randbelow(1_000_000):06d}"
        otp_hmac = compute_otp_hmac(otp_code)
        expires_at = now + timedelta(seconds=settings.OTP_EXPIRES_SECONDS)

        challenge = LoginOtpChallenge(
            otp_id=otp_id,
            challenge_id=challenge_id,
            user_id=user_id,
            email=email,
            purpose="login_2fa",
            ip_address=ip_address,
            otp_hmac=otp_hmac,
            status="active",
            attempts=0,
            max_attempts=settings.OTP_MAX_ATTEMPTS,
            resend_count=0,
            last_sent_at=now,
            expires_at=expires_at,
            created_at=now,
            updated_at=now,
        )
        db.add(challenge)
        db.commit()
        return challenge_id, otp_code, otp_id

    def resend_otp(
        self,
        db: Session,
        challenge_id: str,
        ip_address: str,
        send_email_func,
        now: Optional[datetime] = None,
    ) -> Tuple[dict, str]:
        """
        Executes two-phase OTP resend invalidation:
        1. Checks rate limits (2m cooldown, 5 resends max, 15m lockout).
        2. Pre-allocates new OTP row as 'pending_delivery'.
        3. Calls external send_email_func.
        4. If success: invalidates prior active OTP and activates new OTP.
        5. If failure: marks new OTP as delivery_failed, leaves prior active OTP valid!
        """
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        # 1. Fetch current active or latest challenge for this session
        active_challenge = (
            db.query(LoginOtpChallenge)
            .filter(
                LoginOtpChallenge.challenge_id == challenge_id,
                LoginOtpChallenge.status.in_(["active", "pending_delivery"]),
            )
            .order_by(LoginOtpChallenge.created_at.desc())
            .first()
        )

        if not active_challenge:
            # Check if challenge existed at all
            any_challenge = (
                db.query(LoginOtpChallenge)
                .filter(LoginOtpChallenge.challenge_id == challenge_id)
                .order_by(LoginOtpChallenge.created_at.desc())
                .first()
            )
            if not any_challenge:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Login verification session not found.",
                )
            active_challenge = any_challenge

        email = active_challenge.email

        # 2. Check combo and IP resend lockouts in rate_limits table (survives re-login!)
        combo_key, combo_type, combo_id = get_otp_resend_combo_key(email, ip_address)
        ip_key, ip_type, ip_id = get_otp_resend_ip_key(ip_address)

        is_combo_locked, combo_retry, combo_until = rate_limiter.check_rate_limit(db, combo_key, now=now)
        if is_combo_locked:
            minutes = math.floor(combo_retry / 60)
            seconds = combo_retry % 60
            time_str = f"{minutes:02d}:{seconds:02d}"
            raise RateLimitException(
                code="OTP_RESEND_LOCKED",
                detail=f"You have reached the resend limit. Please try again in {time_str}.",
                retry_after=combo_retry,
                locked_until=combo_until.isoformat() if combo_until else None,
                scope="otp_resend_lockout",
            )

        is_ip_locked, ip_retry, ip_until = rate_limiter.check_rate_limit(db, ip_key, now=now)
        if is_ip_locked:
            raise RateLimitException(
                code="OTP_RESEND_LOCKED",
                detail="Too many resend requests from this network. Try again later.",
                retry_after=ip_retry,
                locked_until=ip_until.isoformat() if ip_until else None,
                scope="otp_ip_resend_lockout",
            )

        # 3. Check 2-minute cooldown from last_sent_at (AC-11)
        last_sent = active_challenge.last_sent_at
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)

        elapsed = (now - last_sent).total_seconds()
        cooldown_remaining = settings.OTP_RESEND_INTERVAL_SECONDS - elapsed
        if cooldown_remaining > 0:
            retry_after = max(1, math.ceil(cooldown_remaining))
            minutes = math.floor(retry_after / 60)
            seconds = retry_after % 60
            time_str = f"{minutes:02d}:{seconds:02d}"
            raise RateLimitException(
                code="OTP_COOLDOWN_ACTIVE",
                detail=f"Please wait {time_str} before requesting another code.",
                retry_after=retry_after,
                scope="otp_cooldown",
            )

        # 4. Check total resend count for this challenge session (AC-13)
        current_resends = active_challenge.resend_count
        if current_resends >= settings.OTP_RESEND_LIMIT:
            # Trigger 15-minute resend lockout on rate_limits
            is_locked, attempts, retry_after, locked_until = rate_limiter.record_attempt(
                db=db,
                key=combo_key,
                rate_type=combo_type,
                identifier=combo_id,
                max_attempts=1,
                window_minutes=15,
                lockout_minutes=settings.OTP_RESEND_LOCKOUT_MINUTES,
                now=now,
            )
            minutes = math.floor(retry_after / 60)
            seconds = retry_after % 60
            time_str = f"{minutes:02d}:{seconds:02d}"
            raise RateLimitException(
                code="OTP_RESEND_LOCKED",
                detail=f"You have reached the resend limit. Please try again in {time_str}.",
                retry_after=retry_after,
                locked_until=locked_until.isoformat() if locked_until else None,
                scope="otp_resend_lockout",
            )

        # Phase 1: Pre-allocation (Insert pending_delivery row)
        new_otp_id = str(uuid.uuid4())
        new_otp_code = f"{secrets.randbelow(1_000_000):06d}"
        new_otp_hmac = compute_otp_hmac(new_otp_code)
        new_expires_at = now + timedelta(seconds=settings.OTP_EXPIRES_SECONDS)

        pending_challenge = LoginOtpChallenge(
            otp_id=new_otp_id,
            challenge_id=challenge_id,
            user_id=active_challenge.user_id,
            email=email,
            purpose="login_2fa",
            ip_address=ip_address,
            otp_hmac=new_otp_hmac,
            status="pending_delivery",
            attempts=0,
            max_attempts=settings.OTP_MAX_ATTEMPTS,
            resend_count=current_resends + 1,
            last_sent_at=now,
            expires_at=new_expires_at,
            created_at=now,
            updated_at=now,
        )
        db.add(pending_challenge)
        db.commit()

        # External Dispatch
        dispatch_success = False
        try:
            dispatch_success = bool(send_email_func(email, new_otp_code))
        except Exception as exc:
            logger.warning("OTP email dispatch failed: %s", exc)
            dispatch_success = False

        if dispatch_success:
            # Phase 2a: Confirmation Transaction (AC-27)
            # Invalidate prior active OTPs with 'superseded_by_resend' and scrub otp_hmac
            db.query(LoginOtpChallenge).filter(
                LoginOtpChallenge.challenge_id == challenge_id,
                LoginOtpChallenge.otp_id != new_otp_id,
                LoginOtpChallenge.status == "active",
            ).update(
                {
                    "status": "invalidated",
                    "otp_hmac": None,
                    "invalidated_at": now,
                    "invalidation_reason": "superseded_by_resend",
                    "updated_at": now,
                },
                synchronize_session=False,
            )

            # Activate the new OTP
            pending_challenge.status = "active"
            pending_challenge.delivery_outcome = "sent"
            pending_challenge.last_sent_at = now
            pending_challenge.updated_at = now
            db.commit()

            # Record resend in rate_limits if on final allowance
            if (current_resends + 1) >= settings.OTP_RESEND_LIMIT:
                rate_limiter.record_attempt(
                    db=db,
                    key=combo_key,
                    rate_type=combo_type,
                    identifier=combo_id,
                    max_attempts=1,
                    window_minutes=15,
                    lockout_minutes=settings.OTP_RESEND_LOCKOUT_MINUTES,
                    now=now,
                )

            return {
                "message": "A new verification code has been sent.",
                "expires_in": settings.OTP_EXPIRES_SECONDS,
                "resend_available_in": settings.OTP_RESEND_INTERVAL_SECONDS,
            }, new_otp_code
        else:
            # Phase 2b: Failure Rollback (AC-18, AC-27)
            # Prior active OTP remains active and accepted!
            pending_challenge.status = "delivery_failed"
            pending_challenge.delivery_outcome = "failed"
            pending_challenge.otp_hmac = None
            pending_challenge.updated_at = now
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Unable to send verification code. Please try again later.",
            )

    def verify_otp(
        self,
        db: Session,
        challenge_id: str,
        submitted_otp: str,
        ip_address: str,
        now: Optional[datetime] = None,
    ) -> LoginOtpChallenge:
        """
        Verifies submitted OTP code using keyed HMAC-SHA256 constant-time comparison.
        Updates attempts or marks used atomically.
        """
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        challenge = (
            db.query(LoginOtpChallenge)
            .filter(
                LoginOtpChallenge.challenge_id == challenge_id,
                LoginOtpChallenge.status == "active",
            )
            .order_by(LoginOtpChallenge.created_at.desc())
            .first()
        )

        if not challenge:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The code is invalid or has expired. Request a new code if needed.",
            )

        exp = challenge.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)

        if now > exp:
            challenge.status = "expired"
            challenge.otp_hmac = None
            challenge.updated_at = now
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The code is invalid or has expired. Request a new code if needed.",
            )

        if challenge.attempts >= challenge.max_attempts:
            challenge.status = "invalidated"
            challenge.otp_hmac = None
            challenge.invalidation_reason = "max_attempts_exceeded"
            challenge.invalidated_at = now
            challenge.updated_at = now
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many verification attempts. Please sign in again.",
            )

        submitted_hmac = compute_otp_hmac(submitted_otp)
        if not challenge.otp_hmac or not hmac.compare_digest(challenge.otp_hmac, submitted_hmac):
            challenge.attempts += 1
            challenge.updated_at = now
            if challenge.attempts >= challenge.max_attempts:
                challenge.status = "invalidated"
                challenge.otp_hmac = None
                challenge.invalidation_reason = "max_attempts_exceeded"
                challenge.invalidated_at = now
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many verification attempts. Please sign in again.",
                )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The code is invalid or has expired. Request a new code if needed.",
            )

        # Correct code: atomically consume and scrub otp_hmac (AC-28)
        challenge.status = "used"
        challenge.otp_hmac = None
        challenge.consumed_at = now
        challenge.updated_at = now
        db.commit()
        return challenge

    def get_challenge_status(
        self,
        db: Session,
        challenge_id: str,
        ip_address: str,
        now: Optional[datetime] = None,
    ) -> dict:
        """Returns cooldown remaining and resend lockout status for a challenge session."""
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        challenge = (
            db.query(LoginOtpChallenge)
            .filter(LoginOtpChallenge.challenge_id == challenge_id)
            .order_by(LoginOtpChallenge.created_at.desc())
            .first()
        )

        if not challenge:
            return {"cooldown_remaining": 0, "resend_locked": False, "resend_retry_after": 0}

        # Check resend lockout on combo key
        combo_key, _, _ = get_otp_resend_combo_key(challenge.email, ip_address)
        is_locked, retry_after, _ = rate_limiter.check_rate_limit(db, combo_key, now=now)

        last_sent = challenge.last_sent_at
        if last_sent.tzinfo is None:
            last_sent = last_sent.replace(tzinfo=timezone.utc)

        elapsed = (now - last_sent).total_seconds()
        cooldown_remaining = max(0, math.ceil(settings.OTP_RESEND_INTERVAL_SECONDS - elapsed))

        return {
            "cooldown_remaining": cooldown_remaining,
            "resend_locked": is_locked or challenge.resend_count >= settings.OTP_RESEND_LIMIT,
            "resend_retry_after": retry_after if is_locked else 0,
        }

    def cleanup_expired_challenges(
        self,
        db: Session,
        retention_days: Optional[int] = None,
        batch_size: Optional[int] = None,
        now: Optional[datetime] = None,
    ) -> int:
        """
        1. Transitions expired active/pending_delivery challenges (expires_at <= now) to 'expired'
           and scrubs otp_hmac = None.
        2. Prunes non-active OTP challenges older than retention_days in batches.
           Active (unexpired) challenges are NEVER deleted (AC-24).
        """
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        resolved_days = (
            retention_days
            if retention_days is not None
            else getattr(settings, "OTP_CHALLENGES_RETENTION_DAYS", 30)
        )
        resolved_batch = (
            batch_size
            if batch_size is not None
            else getattr(settings, "RETENTION_PURGE_BATCH_SIZE", 1000)
        )
        cutoff = now - timedelta(days=resolved_days)
        total_deleted = 0

        try:
            # Step 1: Transition expired active/pending rows and scrub otp_hmac in batches
            while True:
                exp_ids = db.scalars(
                    select(LoginOtpChallenge.otp_id)
                    .where(
                        LoginOtpChallenge.status.in_(["active", "pending_delivery"]),
                        LoginOtpChallenge.expires_at <= now,
                    )
                    .limit(resolved_batch)
                ).all()
                if not exp_ids:
                    break
                db.query(LoginOtpChallenge).filter(
                    LoginOtpChallenge.otp_id.in_(exp_ids)
                ).update(
                    {"status": "expired", "otp_hmac": None, "updated_at": now},
                    synchronize_session=False,
                )
                db.commit()
                if len(exp_ids) < resolved_batch:
                    break

            # Scrub any remaining terminal rows that still have a non-null otp_hmac
            while True:
                unscrubbed_ids = db.scalars(
                    select(LoginOtpChallenge.otp_id)
                    .where(
                        LoginOtpChallenge.status != "active",
                        LoginOtpChallenge.otp_hmac.isnot(None),
                    )
                    .limit(resolved_batch)
                ).all()
                if not unscrubbed_ids:
                    break
                db.query(LoginOtpChallenge).filter(
                    LoginOtpChallenge.otp_id.in_(unscrubbed_ids)
                ).update(
                    {"otp_hmac": None, "updated_at": now},
                    synchronize_session=False,
                )
                db.commit()
                if len(unscrubbed_ids) < resolved_batch:
                    break

            # Step 2: Delete non-active challenges older than retention_days in batches
            while True:
                del_ids = db.scalars(
                    select(LoginOtpChallenge.otp_id)
                    .where(
                        LoginOtpChallenge.created_at < cutoff,
                        LoginOtpChallenge.status != "active",
                    )
                    .limit(resolved_batch)
                ).all()
                if not del_ids:
                    break
                res = db.execute(
                    delete(LoginOtpChallenge).where(LoginOtpChallenge.otp_id.in_(del_ids))
                )
                db.commit()
                deleted = res.rowcount or 0
                total_deleted += deleted
                if deleted < resolved_batch:
                    break

            return total_deleted
        except Exception as exc:
            db.rollback()
            logger.warning("Failed to prune login_otp_challenges: %s", exc)
            return total_deleted


otp_service = OtpService()
