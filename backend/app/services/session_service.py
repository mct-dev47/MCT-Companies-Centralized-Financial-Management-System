from __future__ import annotations

import hashlib
import logging
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.encryption import decrypt_payload, encrypt_payload
from app.models.security import RevokedToken, UserSession
from app.models.user import User

logger = logging.getLogger(__name__)

# Concurrency locks and in-memory caches
_session_lock = threading.RLock()
_session_activity: dict[str, float] = {}
_revoked_families: set[str] = set()
_rotated_tokens: dict[str, dict[str, Any]] = {}

# Paths that do not update session activity (AC-7)
INACTIVITY_EXEMPT_PATHS: set[str] = {
    "/api/v1/health",
    "/health",
    "/api/v1/notifications",
    "/api/v1/notifications/unread-count",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/docs",
    "/redoc",
    "/openapi.json",
}


def _current_timestamp() -> float:
    return datetime.now(timezone.utc).timestamp()


def _prune_rotated_tokens(now: float) -> None:
    cutoff = now - (settings.REFRESH_GRACE_PERIOD_SECONDS * 4)
    stale_keys = [k for k, v in _rotated_tokens.items() if float(v.get("rotated_at", 0)) < cutoff]
    for k in stale_keys:
        _rotated_tokens.pop(k, None)


def create_refresh_cookie_payload(
    user_id: int,
    email: str,
    token_version: int,
    remember_me: bool,
    sid: Optional[str] = None,
    family_id: Optional[str] = None,
) -> tuple[str, dict[str, Any]]:
    now = _current_timestamp()
    resolved_sid = sid or secrets.token_urlsafe(32)
    resolved_family_id = family_id or secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)

    payload = {
        "sid": resolved_sid,
        "family_id": resolved_family_id,
        "user_id": user_id,
        "email": email,
        "created_at": now,
        "token_version": token_version,
        "nonce": nonce,
        "remember_me": bool(remember_me),
        "last_activity": now,
    }

    with _session_lock:
        _session_activity[resolved_sid] = now

    cookie_value = encrypt_payload(payload)
    return cookie_value, payload


def set_refresh_cookie(response: Response, cookie_value: str, remember_me: bool) -> None:
    is_secure = settings.OTP_COOKIE_SECURE or (settings.ENVIRONMENT.lower() == "production")
    max_age = settings.SESSION_ABSOLUTE_LIFETIME_SECONDS if remember_me else None

    response.set_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        value=cookie_value,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        path=settings.REFRESH_COOKIE_PATH,
        max_age=max_age,
    )


def clear_refresh_cookie(response: Response) -> None:
    is_secure = settings.OTP_COOKIE_SECURE or (settings.ENVIRONMENT.lower() == "production")
    response.delete_cookie(
        key=settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        httponly=True,
        secure=is_secure,
        samesite="lax",
    )


def track_session_activity(sid: str) -> None:
    if not sid:
        return
    now = _current_timestamp()
    with _session_lock:
        _session_activity[sid] = now


def get_session_activity(sid: str, fallback: float) -> float:
    with _session_lock:
        return _session_activity.get(sid, fallback)


def verify_csrf_header(request: Request) -> None:
    custom_csrf = request.headers.get("X-MCT-CSRF")
    requested_with = request.headers.get("X-Requested-With")
    if custom_csrf == "1" or (requested_with and requested_with.lower() == "xmlhttprequest"):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="CSRF header verification failed. Custom header required for cookie authentication.",
    )


def _revoke_session_family(db: Session, family_id: str, user_id: Optional[int] = None) -> None:
    with _session_lock:
        _revoked_families.add(family_id)
    try:
        family_hash = hashlib.sha256(family_id.encode("utf-8")).hexdigest()
        existing = db.query(RevokedToken).filter(RevokedToken.token_hash == family_hash).first()
        if not existing:
            db.add(RevokedToken(token_hash=family_hash, user_id=user_id))
            db.commit()
    except Exception as exc:
        logger.warning(f"Failed to record family revocation in database: {exc}")


def revoke_session(
    db: Session,
    sid: Optional[str] = None,
    family_id: Optional[str] = None,
    nonce: Optional[str] = None,
    user_id: Optional[int] = None,
) -> None:
    with _session_lock:
        if sid:
            _session_activity.pop(sid, None)
        if family_id:
            _revoked_families.add(family_id)

    hashes_to_revoke = []
    if nonce:
        hashes_to_revoke.append(hashlib.sha256(nonce.encode("utf-8")).hexdigest())
    if family_id:
        hashes_to_revoke.append(hashlib.sha256(family_id.encode("utf-8")).hexdigest())

    for th in hashes_to_revoke:
        try:
            existing = db.query(RevokedToken).filter(RevokedToken.token_hash == th).first()
            if not existing:
                db.add(RevokedToken(token_hash=th, user_id=user_id))
        except Exception:
            pass

    if sid or family_id:
        try:
            q = db.query(UserSession)
            if sid:
                q = q.filter(UserSession.session_id == sid)
            elif family_id:
                q = q.filter(UserSession.family_id == family_id)
            q.delete(synchronize_session=False)
        except Exception:
            pass

    try:
        db.commit()
    except Exception as exc:
        logger.warning(f"Failed committing revoked tokens: {exc}")


def verify_refresh_cookie(
    cookie_value: Optional[str],
    db: Session,
) -> dict[str, Any]:
    if not cookie_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh cookie missing or empty.",
        )

    try:
        payload = decrypt_payload(cookie_value)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or corrupted refresh cookie.",
        )

    sid = str(payload.get("sid", ""))
    family_id = str(payload.get("family_id", ""))
    user_id = int(payload.get("user_id", 0))
    nonce = str(payload.get("nonce", ""))
    created_at = float(payload.get("created_at", 0))
    token_version = int(payload.get("token_version", 1))
    remember_me = bool(payload.get("remember_me", False))
    last_activity = float(payload.get("last_activity", created_at))

    now = _current_timestamp()

    # 1. Family revocation check
    with _session_lock:
        if family_id in _revoked_families:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session family has been revoked.",
            )

    # 2. Database revoked check
    nonce_hash = hashlib.sha256(nonce.encode("utf-8")).hexdigest()
    family_hash = hashlib.sha256(family_id.encode("utf-8")).hexdigest()
    is_revoked = db.query(RevokedToken).filter(
        RevokedToken.token_hash.in_([nonce_hash, family_hash])
    ).first()
    if is_revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session credential has been revoked.",
        )

    # 3. Concurrency grace period & reuse detection (AC-8, AC-9)
    with _session_lock:
        _prune_rotated_tokens(now)
        if nonce in _rotated_tokens:
            info = _rotated_tokens[nonce]
            rotated_at = float(info.get("rotated_at", 0))
            if (now - rotated_at) <= settings.REFRESH_GRACE_PERIOD_SECONDS:
                # Concurrent refresh within grace window: return cached result idempotently
                return {
                    "is_grace_hit": True,
                    "cached_result": info["cached_result"],
                }
            else:
                # Reused outside grace window: security violation (AC-9)
                logger.warning(
                    "Token reuse detected for family %s, user %s outside grace period.",
                    family_id,
                    user_id,
                )
                _revoke_session_family(db, family_id, user_id)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Security violation: Token reuse detected. Session revoked.",
                    headers={"X-Reason-Code": "TOKEN_REUSE_DETECTED"},
                )

    # 4. User account & token version verification (AC-12)
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account associated with this session no longer exists.",
        )

    u_stat = str(getattr(user, "status", "ACTIVE") or "ACTIVE").upper()
    if u_stat == "LOCKED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked due to security policy.",
        )
    if u_stat == "SUSPENDED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been suspended.",
        )

    current_db_version = int(getattr(user, "token_version", 1) or 1)
    if token_version < current_db_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked due to credential changes.",
            headers={"X-Reason-Code": "TOKEN_VERSION_OUTDATED"},
        )

    # 5. Absolute maximum session lifetime check (AC-6)
    if (now - created_at) > settings.SESSION_ABSOLUTE_LIFETIME_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired after reaching maximum duration.",
            headers={"X-Reason-Code": "SESSION_EXPIRED_MAX_DURATION"},
        )

    # 6. Idle timeout check based on qualifying activity (AC-5, AC-7)
    with _session_lock:
        latest_activity = _session_activity.get(sid, last_activity)
    if (now - latest_activity) > settings.SESSION_IDLE_TIMEOUT_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired due to inactivity.",
            headers={"X-Reason-Code": "SESSION_EXPIRED_IDLE"},
        )

    return {
        "is_grace_hit": False,
        "payload": payload,
        "user": user,
    }


def rotate_refresh_token(
    old_payload: dict[str, Any],
    user: User,
    db: Session,
) -> tuple[str, str, dict[str, Any]]:
    from app.services.auth_service import create_jwt_token, _application_user_response

    sid = str(old_payload["sid"])
    family_id = str(old_payload["family_id"])
    old_nonce = str(old_payload["nonce"])
    created_at = float(old_payload["created_at"])
    remember_me = bool(old_payload.get("remember_me", False))
    now = _current_timestamp()

    new_nonce = secrets.token_urlsafe(32)
    current_token_version = int(getattr(user, "token_version", 1) or 1)

    new_payload = {
        "sid": sid,
        "family_id": family_id,
        "user_id": user.user_id,
        "email": user.email,
        "created_at": created_at,
        "token_version": current_token_version,
        "nonce": new_nonce,
        "remember_me": remember_me,
        "last_activity": now,
    }

    new_cookie_value = encrypt_payload(new_payload)

    # User response and token claims
    user_info = _application_user_response({
        "user_id": user.user_id,
        "email": user.email,
        "name": user.name,
        "is_admin": bool(user.is_admin),
        "role": getattr(user, "role", "company"),
        "status": getattr(user, "status", "ACTIVE"),
        "must_change_password": bool(getattr(user, "must_change_password", False)),
        "company_id": user.company_id,
        "photo_url": getattr(user, "photo_url", None),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    })

    company_ids = [uc.company_id for uc in user.user_companies if uc.company_id]
    if not company_ids and user.company_id:
        company_ids = [user.company_id]

    access_token = create_jwt_token(
        user_id=user.user_id,
        email=user.email,
        is_admin=bool(user.is_admin),
        company_id=user.company_id,
        company_ids=company_ids,
        role=getattr(user, "role", "company"),
        expires_delta_seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS,
        sid=sid,
        token_version=current_token_version,
    )

    cached_result = {
        "access_token": access_token,
        "cookie_value": new_cookie_value,
        "user_info": user_info,
        "remember_me": remember_me,
    }

    with _session_lock:
        _session_activity[sid] = now
        _rotated_tokens[old_nonce] = {
            "rotated_at": now,
            "family_id": family_id,
            "user_id": user.user_id,
            "cached_result": cached_result,
        }

    return new_cookie_value, access_token, user_info


def create_reauth_token(user_id: int) -> tuple[str, int]:
    now = _current_timestamp()
    expires_in = settings.REAUTH_TOKEN_EXPIRE_SECONDS
    reauth_payload = {
        "purpose": "reauthentication",
        "user_id": user_id,
        "issued_at": now,
        "expires_at": now + expires_in,
        "nonce": secrets.token_urlsafe(16),
    }
    return encrypt_payload(reauth_payload), expires_in


def verify_reauth_token(reauth_token: Optional[str], expected_user_id: int) -> bool:
    if not reauth_token:
        return False
    try:
        data = decrypt_payload(reauth_token)
        if data.get("purpose") != "reauthentication":
            return False
        if int(data.get("user_id", 0)) != expected_user_id:
            return False
        now = _current_timestamp()
        if float(data.get("expires_at", 0)) <= now:
            return False
        return True
    except Exception:
        return False


def register_user_session(
    db: Session,
    user_id: int,
    sid: str,
    family_id: str,
    ip_address: str,
    user_agent: Optional[str] = None,
    max_concurrent: int = 3,
) -> None:
    """Enforces concurrent session limit (max 3 by default).
    If active sessions >= max_concurrent, evicts the oldest session(s) via FIFO.
    """
    try:
        active_sessions = (
            db.query(UserSession)
            .filter(UserSession.user_id == user_id)
            .order_by(UserSession.last_activity_at.asc())
            .all()
        )
        if len(active_sessions) >= max_concurrent:
            evict_count = len(active_sessions) - max_concurrent + 1
            sessions_to_evict = active_sessions[:evict_count]
            for s in sessions_to_evict:
                logger.info("Evicting oldest session %s for user %s to enforce concurrency limit", s.session_id, user_id)
                revoke_session(db=db, sid=s.session_id, family_id=s.family_id, user_id=user_id)

        new_sess = UserSession(
            session_id=sid,
            user_id=user_id,
            family_id=family_id,
            ip_address=ip_address,
            user_agent=(user_agent[:255] if user_agent else None),
            created_at=datetime.now(timezone.utc),
            last_activity_at=datetime.now(timezone.utc),
        )
        db.merge(new_sess)
        db.commit()
    except Exception as exc:
        logger.warning("Failed managing user session concurrency: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


def delete_user_session(
    db: Session,
    sid: Optional[str] = None,
    family_id: Optional[str] = None,
) -> None:
    if not sid and not family_id:
        return
    try:
        q = db.query(UserSession)
        if sid:
            q = q.filter(UserSession.session_id == sid)
        elif family_id:
            q = q.filter(UserSession.family_id == family_id)
        q.delete(synchronize_session=False)
        db.commit()
    except Exception as exc:
        logger.warning("Failed deleting user session: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


