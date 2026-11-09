import hashlib
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.core.config import settings
from app.models.security import RateLimit

logger = logging.getLogger(__name__)


def hash_email_identifier(email: str) -> str:
    """Returns the first 16 hexadecimal characters of SHA-256(normalized_email)."""
    from app.core.company_resolver import normalize_email
    clean_email = normalize_email(email.strip().lower())
    return hashlib.sha256(clean_email.encode("utf-8")).hexdigest()[:16]


def get_login_combo_key(email: str, ip: str) -> Tuple[str, str, str]:
    email_hash = hash_email_identifier(email)
    identifier = f"{email_hash}:{ip}"
    return f"login:combo:{identifier}", "login_combo", identifier


def get_login_email_key(email: str) -> Tuple[str, str, str]:
    email_hash = hash_email_identifier(email)
    return f"login:email:{email_hash}", "login_email", email_hash


def get_login_ip_key(ip: str) -> Tuple[str, str, str]:
    return f"login:ip:{ip}", "login_ip", ip


def get_otp_resend_combo_key(email: str, ip: str) -> Tuple[str, str, str]:
    email_hash = hash_email_identifier(email)
    identifier = f"{email_hash}:{ip}"
    return f"otp_resend:combo:{identifier}", "otp_resend_combo", identifier


def get_otp_resend_ip_key(ip: str) -> Tuple[str, str, str]:
    return f"otp_resend:ip:{ip}", "otp_resend_ip", ip


def get_api_heavy_key(ip: str) -> Tuple[str, str, str]:
    return f"api:heavy:{ip}", "api_heavy", ip


class RateLimiterService:
    def __init__(self):
        pass

    def check_rate_limit(
        self,
        db: Session,
        key: str,
        now: Optional[datetime] = None,
    ) -> Tuple[bool, int, Optional[datetime]]:
        """
        Checks whether a key is currently locked out.
        Returns (is_locked, retry_after_seconds, locked_until).
        """
        if not settings.RATE_LIMIT_ENABLED:
            return False, 0, None

        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        try:
            record = db.query(RateLimit).filter(RateLimit.key == key).first()
            if not record or not record.locked_until:
                return False, 0, None

            locked_until = record.locked_until
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)

            if locked_until > now:
                retry_after = max(1, math.ceil((locked_until - now).total_seconds()))
                return True, retry_after, locked_until

            return False, 0, None
        except Exception as exc:
            logger.error("Rate limiter check failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please try again.",
            )

    def record_attempt(
        self,
        db: Session,
        key: str,
        rate_type: str,
        identifier: str,
        max_attempts: int,
        window_minutes: int,
        lockout_minutes: int,
        now: Optional[datetime] = None,
    ) -> Tuple[bool, int, int, Optional[datetime]]:
        """
        Records an attempt atomically.
        Returns (is_locked, current_attempts, retry_after_seconds, locked_until).
        """
        if not settings.RATE_LIMIT_ENABLED:
            return False, 1, 0, None

        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        dialect = db.bind.dialect.name if db.bind else "sqlite"

        try:
            if dialect == "postgresql":
                return self._record_attempt_postgres(
                    db=db,
                    key=key,
                    rate_type=rate_type,
                    identifier=identifier,
                    max_attempts=max_attempts,
                    window_minutes=window_minutes,
                    lockout_minutes=lockout_minutes,
                    now=now,
                )
            else:
                return self._record_attempt_generic(
                    db=db,
                    key=key,
                    rate_type=rate_type,
                    identifier=identifier,
                    max_attempts=max_attempts,
                    window_minutes=window_minutes,
                    lockout_minutes=lockout_minutes,
                    now=now,
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Rate limiter record_attempt failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please try again.",
            )

    def _record_attempt_postgres(
        self,
        db: Session,
        key: str,
        rate_type: str,
        identifier: str,
        max_attempts: int,
        window_minutes: int,
        lockout_minutes: int,
        now: datetime,
    ) -> Tuple[bool, int, int, Optional[datetime]]:
        sql = text(
            """
            INSERT INTO rate_limits (key, rate_type, identifier, attempts, window_start, locked_until, last_attempt_at, created_at, updated_at)
            VALUES (:key, :rate_type, :identifier, 1, :now,
                    CASE WHEN :max_attempts <= 1 THEN :now + (:lockout_minutes || ' minutes')::INTERVAL ELSE NULL END,
                    :now, :now, :now)
            ON CONFLICT (key) DO UPDATE SET
              attempts = CASE
                WHEN rate_limits.locked_until IS NOT NULL AND rate_limits.locked_until <= :now THEN 1
                WHEN :now > rate_limits.window_start + (:window_minutes || ' minutes')::INTERVAL THEN 1
                ELSE rate_limits.attempts + 1
              END,
              window_start = CASE
                WHEN rate_limits.locked_until IS NOT NULL AND rate_limits.locked_until <= :now THEN :now
                WHEN :now > rate_limits.window_start + (:window_minutes || ' minutes')::INTERVAL THEN :now
                ELSE rate_limits.window_start
              END,
              locked_until = CASE
                WHEN (rate_limits.locked_until IS NULL OR rate_limits.locked_until <= :now)
                     AND (CASE
                            WHEN rate_limits.locked_until IS NOT NULL AND rate_limits.locked_until <= :now THEN 1
                            WHEN :now > rate_limits.window_start + (:window_minutes || ' minutes')::INTERVAL THEN 1
                            ELSE rate_limits.attempts + 1
                          END) >= :max_attempts
                THEN :now + (:lockout_minutes || ' minutes')::INTERVAL
                WHEN rate_limits.locked_until IS NOT NULL AND rate_limits.locked_until > :now
                THEN rate_limits.locked_until
                ELSE NULL
              END,
              last_attempt_at = :now,
              updated_at = :now
            RETURNING attempts, locked_until;
            """
        )
        result = db.execute(
            sql,
            {
                "key": key,
                "rate_type": rate_type,
                "identifier": identifier,
                "max_attempts": max_attempts,
                "window_minutes": window_minutes,
                "lockout_minutes": lockout_minutes,
                "now": now,
            },
        ).fetchone()
        db.commit()

        if not result:
            return False, 1, 0, None

        attempts = int(result[0])
        locked_until = result[1]
        if locked_until is not None and locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)

        if locked_until and locked_until > now:
            retry_after = max(1, math.ceil((locked_until - now).total_seconds()))
            return True, attempts, retry_after, locked_until

        return False, attempts, 0, None

    def _record_attempt_generic(
        self,
        db: Session,
        key: str,
        rate_type: str,
        identifier: str,
        max_attempts: int,
        window_minutes: int,
        lockout_minutes: int,
        now: datetime,
    ) -> Tuple[bool, int, int, Optional[datetime]]:
        window_duration = timedelta(minutes=window_minutes)
        lockout_duration = timedelta(minutes=lockout_minutes)

        record = db.query(RateLimit).filter(RateLimit.key == key).with_for_update().first() if hasattr(db.query(RateLimit), "with_for_update") else db.query(RateLimit).filter(RateLimit.key == key).first()

        if not record:
            locked_until = now + lockout_duration if max_attempts <= 1 else None
            record = RateLimit(
                key=key,
                rate_type=rate_type,
                identifier=identifier,
                attempts=1,
                window_start=now,
                locked_until=locked_until,
                last_attempt_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(record)
            db.commit()
            if locked_until and locked_until > now:
                return True, 1, max(1, math.ceil((locked_until - now).total_seconds())), locked_until
            return False, 1, 0, None

        # Record exists
        rec_locked_until = record.locked_until
        if rec_locked_until and rec_locked_until.tzinfo is None:
            rec_locked_until = rec_locked_until.replace(tzinfo=timezone.utc)

        rec_window_start = record.window_start
        if rec_window_start and rec_window_start.tzinfo is None:
            rec_window_start = rec_window_start.replace(tzinfo=timezone.utc)

        if rec_locked_until and rec_locked_until > now:
            # Already locked
            retry_after = max(1, math.ceil((rec_locked_until - now).total_seconds()))
            record.last_attempt_at = now
            record.updated_at = now
            db.commit()
            return True, record.attempts, retry_after, rec_locked_until

        # Check if previous lockout expired or window expired
        if (rec_locked_until and rec_locked_until <= now) or (now > rec_window_start + window_duration):
            record.attempts = 1
            record.window_start = now
            record.locked_until = None
        else:
            record.attempts += 1

        if record.attempts >= max_attempts:
            record.locked_until = now + lockout_duration
            record.last_attempt_at = now
            record.updated_at = now
            db.commit()
            locked_dt = record.locked_until
            if locked_dt.tzinfo is None:
                locked_dt = locked_dt.replace(tzinfo=timezone.utc)
            retry_after = max(1, math.ceil((locked_dt - now).total_seconds()))
            return True, record.attempts, retry_after, locked_dt

        record.last_attempt_at = now
        record.updated_at = now
        db.commit()
        return False, record.attempts, 0, None

    def reset_attempts(self, db: Session, key: str) -> None:
        """Resets failed attempt count and unlocks a key upon successful authentication."""
        try:
            record = db.query(RateLimit).filter(RateLimit.key == key).first()
            if record:
                record.attempts = 0
                record.locked_until = None
                record.updated_at = datetime.now(timezone.utc)
                db.commit()
        except Exception as exc:
            logger.warning("Failed to reset rate limit attempts for %s: %s", key, exc)

    def get_status(
        self,
        db: Session,
        key: str,
        now: Optional[datetime] = None,
    ) -> dict:
        """Returns rate limit status dict for a given key."""
        if now is None:
            now = datetime.now(timezone.utc)
        elif now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        try:
            record = db.query(RateLimit).filter(RateLimit.key == key).first()
            if not record or not record.locked_until:
                return {"locked": False, "retry_after": 0, "locked_until": None, "attempts": record.attempts if record else 0}

            locked_until = record.locked_until
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)

            if locked_until > now:
                retry_after = max(1, math.ceil((locked_until - now).total_seconds()))
                return {
                    "locked": True,
                    "retry_after": retry_after,
                    "locked_until": locked_until.isoformat(),
                    "attempts": record.attempts,
                }
            return {"locked": False, "retry_after": 0, "locked_until": None, "attempts": record.attempts}
        except Exception as exc:
            logger.error("Rate limiter get_status failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service temporarily unavailable. Please try again.",
            )

    def cleanup_expired_records(self, db: Session, retention_days: int = 30) -> int:
        """
        Deletes expired rate limit records older than retention_days.
        Active lockouts are never pruned.
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=retention_days)
        try:
            deleted = db.query(RateLimit).filter(
                RateLimit.last_attempt_at < cutoff,
                (RateLimit.locked_until == None) | (RateLimit.locked_until < now),
            ).delete(synchronize_session=False)
            db.commit()
            return deleted
        except Exception as exc:
            db.rollback()
            logger.warning("Failed to prune rate_limits: %s", exc)
            return 0


rate_limiter = RateLimiterService()

