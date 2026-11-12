from datetime import datetime, timezone, timedelta
from typing import Optional, Union
from contextlib import contextmanager
import logging
import secrets
import json
import hashlib
import threading
import time
import html
import re
from collections import defaultdict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import jwt
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.encryption import decrypt_payload, encrypt_payload, encrypt_invitation_token
from app.db.supabase import get_supabase_client, get_supabase_admin_client
from app.models.user import User
from app.models.company import Company
from app.models.invitation import UserInvitation, InvitationOutbox
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    PasswordResetRequest,
    PasswordResetConfirm,
    MessageResponse,
    LoginChallengeResponse,
    VerifyOtpRequest,
    OtpResponse,
    TokenValidateResponse,
)
from app.schemas.user import UserResponse
from app.services.audit_service import (
    log_login_attempt,
    log_login_success,
    log_login_failed,
    log_otp_sent,
    log_otp_verified,
    log_otp_failed,
    log_otp_resent,
    log_logout,
    log_account_locked,
    log_forgot_password,
    log_password_reset,
)

logger = logging.getLogger(__name__)
OTP_COOKIE_NAME = "mct_login_otp"
_rate_limits: dict[str, dict[str, object]] = {}
_otp_challenges: dict[str, dict[str, object]] = {}

_forgot_pwd_lock = threading.Lock()
_forgot_pwd_email_requests: dict[str, list[float]] = defaultdict(list)
_forgot_pwd_ip_requests: dict[str, list[float]] = defaultdict(list)
_forgot_pwd_last_sent: dict[str, float] = {}


def _pad_duration(start_perf: float, floor_seconds: float) -> None:
    elapsed = time.perf_counter() - start_perf
    if elapsed < floor_seconds:
        time.sleep(floor_seconds - elapsed)


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


def _get_application_user(*, email: str | None = None, user_id: int | None = None) -> dict[str, object] | None:
    # 1. Try Supabase with role
    try:
        query = get_supabase_admin_client().table("users").select(
            "user_id,email,name,is_admin,role,company_id,photo_url,created_at,updated_at,last_login_at,token_version,status,must_change_password"
        )
        if email is not None:
            query = query.eq("email", email)
        elif user_id is not None:
            query = query.eq("user_id", user_id)
        else:
            return None
        result = query.limit(1).execute().data
        if result:
            return result[0]
    except Exception:
        pass

    # 2. Try Supabase without role
    try:
        query = get_supabase_admin_client().table("users").select(
            "user_id,email,name,is_admin,company_id,created_at,updated_at,last_login_at,token_version,status,must_change_password"
        )
        if email is not None:
            query = query.eq("email", email)
        elif user_id is not None:
            query = query.eq("user_id", user_id)
        result = query.limit(1).execute().data
        if result:
            return result[0]
    except Exception:
        pass

    # 3. Fallback to local SQLite DB
    try:
        from app.db.session import SessionLocal
        from app.models.user import User as UserModel
        from app.core.company_resolver import normalize_email, normalize_company_id
        from sqlalchemy import func
        db = SessionLocal()
        if email is not None:
            resolved_email = normalize_email(email)
            u = db.query(UserModel).filter(func.lower(UserModel.email) == resolved_email.lower()).first()
        elif user_id is not None:
            u = db.query(UserModel).filter(UserModel.user_id == user_id).first()
        else:
            u = None
        if u:
            u_role = getattr(u, "role", "admin" if u.is_admin else "company") or ("admin" if u.is_admin else "company")
            res = {
                "user_id": u.user_id,
                "email": u.email,
                "name": u.name,
                "is_admin": bool(u.is_admin),
                "role": u_role,
                "status": getattr(u, "status", "ACTIVE") or "ACTIVE",
                "must_change_password": bool(getattr(u, "must_change_password", False)),
                "token_version": int(getattr(u, "token_version", 1) or 1),
                "company_id": u.company_id,
                "photo_url": getattr(u, "photo_url", None),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "updated_at": u.updated_at.isoformat() if u.updated_at else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            }
            db.close()
            return res
        db.close()
    except Exception:
        pass

    return None


def _update_application_user_login(user_id: int) -> None:
    def _do_update():
        try:
            get_supabase_admin_client().table("users").update(
                {"last_login_at": datetime.now(timezone.utc).isoformat()}
            ).eq("user_id", user_id).execute()
        except Exception:
            pass
        try:
            from app.db.session import SessionLocal
            from app.models.user import User as UserModel
            db = SessionLocal()
            u = db.query(UserModel).filter(UserModel.user_id == user_id).first()
            if u:
                u.last_login_at = datetime.now(timezone.utc)
                db.commit()
            db.close()
        except Exception:
            pass

    threading.Thread(target=_do_update, daemon=True).start()


def _application_user_response(user: dict[str, object], db: Optional[Session] = None) -> UserResponse:
    company_name = None
    company_names: list[str] = []
    company_ids: list[int] = []
    company_logo_url: str | None = None
    company_id = user.get("company_id")

    from app.db.session import SessionLocal
    from app.models.company import Company
    from app.models.user import UserCompany
    local_db = None
    try:
        active_db = db
        if active_db is None:
            local_db = SessionLocal()
            active_db = local_db

        cid = int(company_id) if company_id is not None else None
        if cid:
            company_ids.append(cid)
            comp = active_db.query(Company).filter(Company.company_id == cid).first()
            if comp:
                company_name = comp.company_name
                company_names.append(comp.company_name)
                company_logo_url = getattr(comp, "logo_url", None)

        uid = user.get("user_id")
        if uid:
            ucs = active_db.query(UserCompany).filter(UserCompany.user_id == int(uid)).all()
            for uc in ucs:
                if uc.company_id and uc.company_id not in company_ids:
                    company_ids.append(uc.company_id)
                c = active_db.query(Company).filter(Company.company_id == uc.company_id).first()
                if c and c.company_name not in company_names:
                    company_names.append(c.company_name)
                    if not company_name:
                        company_name = c.company_name
                    if not company_logo_url and getattr(c, "logo_url", None):
                        company_logo_url = getattr(c, "logo_url", None)

        # Fallback to Supabase user_companies table if empty
        if not company_ids and uid:
            try:
                supa_res = get_supabase_admin_client().table("user_companies").select("company_id").eq("user_id", int(uid)).execute()
                for row in (supa_res.data or []):
                    scid = row.get("company_id")
                    if scid and int(scid) not in company_ids:
                        company_ids.append(int(scid))
                        c = active_db.query(Company).filter(Company.company_id == int(scid)).first()
                        if c and c.company_name not in company_names:
                            company_names.append(c.company_name)
                            if not company_name:
                                company_name = c.company_name
            except Exception:
                pass
    except Exception:
        pass
    finally:
        if local_db is not None:
            try:
                local_db.close()
            except Exception:
                pass

    user_role = str(user.get("role") or ("admin" if user.get("is_admin") else "company")).lower()
    is_admin_flag = bool(user.get("is_admin", False))

    raw_photo = user.get("photo_url")
    resolved_photo_url = None
    if raw_photo:
        raw_photo_str = str(raw_photo)
        try:
            from app.services.user_service import UserService
            user_svc = UserService(db=None)
            storage_path = user_svc._extract_storage_path(raw_photo_str)
            if storage_path:
                signed = user_svc._sign_url(storage_path)
                resolved_photo_url = signed or raw_photo_str
            else:
                resolved_photo_url = raw_photo_str
        except Exception:
            resolved_photo_url = raw_photo_str
    elif company_logo_url:
        resolved_photo_url = str(company_logo_url)

    return UserResponse(
        user_id=int(user["user_id"]),
        email=str(user["email"]),
        name=str(user["name"]),
        company_id=int(company_id) if company_id is not None else None,
        company_ids=company_ids,
        is_admin=is_admin_flag,
        role=user_role,
        status=str(user.get("status") or "ACTIVE"),
        must_change_password=bool(user.get("must_change_password", False)),
        photo_url=resolved_photo_url,
        last_login_at=user.get("last_login_at"),
        created_at=user.get("created_at"),
        updated_at=user.get("updated_at"),
        company_name=company_name,
        company_names=company_names,
    )


# SEEDED_OTP_CODE removed for production security


def _send_login_otp(email: str, otp: str, wait: bool = True) -> bool:
    """Sends the login OTP email.

    With wait=True (resend path) it returns True only when the provider confirms dispatch, so the
    two phase resend can safely invalidate the prior code (AC-18, AC-27). With wait=False (initial
    login) it dispatches in the background and returns True once started.
    """
    logger.info("Login OTP generated for %s", _mask_email(email))
    from app.core.config import unwrap_secret
    if not (unwrap_secret(settings.BREVO_API_KEY) or unwrap_secret(settings.RESEND_API_KEY)):
        logger.warning("Email delivery is not configured for OTP (missing BREVO_API_KEY).")
        return False

    from app.services.email_service import send_transactional_email
    import html

    def _dispatch_email():
        escaped_otp = html.escape(otp)
        minutes = settings.OTP_EXPIRES_SECONDS // 60
        subject = "Your MCT Financial Management login verification code"
        text_content = (
            f"Your MCT Financial Management System verification code is {otp}. "
            f"It expires in {minutes} minutes."
        )
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px;">
            <h2 style="color: #0f172a; margin-top: 0;">MCT Login Verification</h2>
            <p style="color: #334155; font-size: 15px;">Your one-time verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #960C01; padding: 12px 0;">{escaped_otp}</div>
            <p style="color: #64748b; font-size: 13px;">This code expires in {minutes} minutes. For security reasons, do not share this code with anyone.</p>
            <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
            <p style="color: #94a3b8; font-size: 12px;">MCT Companies Centralized Financial Management System</p>
        </div>
        """
        try:
            sent = bool(send_transactional_email(
                to_email=email,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
                enforce_cooldown=False,
            ))
            if sent:
                logger.info("OTP verification email dispatched to %s via Brevo.", _mask_email(email))
            else:
                logger.warning("Failed to dispatch OTP verification email to %s via Brevo.", _mask_email(email))
            return sent
        except Exception as exc:
            logger.warning("OTP email dispatch raised an exception for %s: %s", _mask_email(email), exc)
            return False

    if wait:
        try:
            return _dispatch_email()
        except Exception as exc:
            logger.warning("OTP email dispatch raised: %s", exc)
            return False

    threading.Thread(target=_dispatch_email, daemon=True).start()
    return True


@contextmanager
def _resolve_session(db: Optional[Session]):
    if db is not None:
        yield db
    else:
        from app.db.session import SessionLocal
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()


def _get_jwt_secret() -> str:
    from app.core.config import unwrap_secret
    secret = unwrap_secret(settings.SUPABASE_JWT_SECRET) or settings.SUPABASE_KEY
    if not secret or len(secret.strip()) < 32:
        secret = "mct-centralized-financial-system-secret-key-32chars!"
    return secret.strip()


# create jwt token
def create_jwt_token(
    user_id: int,
    email: str,
    is_admin: bool = False,
    company_id: Optional[int] = None,
    company_ids: Optional[list[int]] = None,
    role: Optional[str] = None,
    expires_delta_seconds: int | None = None,
    sid: Optional[str] = None,
    token_version: Optional[int] = None,
) -> str:
    now = datetime.now(timezone.utc)
    if expires_delta_seconds is None:
        expires_delta_seconds = settings.ACCESS_TOKEN_EXPIRE_SECONDS
    expiration = now + timedelta(seconds=expires_delta_seconds)
    user_role = str(role or ("admin" if is_admin else "company")).lower()
    resolved_version = token_version or 1

    payload = {
        "sub": str(user_id),
        "email": email,
        "aud": "authenticated",
        "role": user_role,
        "iat": int(now.timestamp()),
        "exp": int(expiration.timestamp()),
        "jti": secrets.token_urlsafe(24),
        "sid": sid,
        "token_version": resolved_version,
        "app_metadata": {
            "is_admin": is_admin,
            "role": user_role,
            "company_id": company_id,
            "company_ids": company_ids or ([company_id] if company_id else []),
            "provider": "email",
            "token_version": resolved_version,
            "sid": sid,
        },
        "user_metadata": {
            "name": email.split("@")[0],
        },
    }

    token = jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")
    return token


# update last login at
def update_last_login_at(db: Session, user_id: int) -> Optional[User]:
    user = db.query(User).filter(User.user_id == user_id).first()
    if user:
        user.last_login_at = datetime.now(timezone.utc)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


# load application user
def load_application_user(db: Session, identifier: Union[int, str]) -> Optional[User]:
    if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
        return db.query(User).filter(User.user_id == int(identifier)).first()
    elif isinstance(identifier, str):
        return db.query(User).filter(User.email == identifier.strip().lower()).first()
    return None


# get current user information
def get_current_user_info(db: Session, user_id: int) -> UserResponse:
    from app.services.user_service import UserService
    user = UserService(db).get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return UserService(db).to_response(user)


# login user with encrypted payload support
def login_user(db: Optional[Session], login_data: LoginRequest, ip_address: str) -> tuple[LoginChallengeResponse, str]:
    from app.core.network import normalize_client_ip
    from app.core.company_resolver import normalize_email
    from app.core.errors import RateLimitException
    from app.services.rate_limiter import (
        rate_limiter,
        get_login_combo_key,
        get_login_ip_key,
        get_login_email_key,
    )
    from app.services.otp_service import otp_service
    import math

    norm_ip = normalize_client_ip(ip_address)
    email = login_data.email
    password = login_data.password
    remember_me = bool(getattr(login_data, "remember_me", False))

    # Decrypt encrypted_payload if provided over network
    if login_data.encrypted_payload:
        decrypted = decrypt_payload(login_data.encrypted_payload)
        email = decrypted.get("email", email)
        password = decrypted.get("password", password)
        if "remember_me" in decrypted:
            remember_me = bool(decrypted["remember_me"])

    if not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password credentials are required.",
        )

    normalized_email = normalize_email(str(email).strip().lower())
    combo_key, combo_type, combo_id = get_login_combo_key(normalized_email, norm_ip)
    ip_key, ip_type, ip_id = get_login_ip_key(norm_ip)
    email_key, email_type, email_id = get_login_email_key(normalized_email)

    with _resolve_session(db) as session:
        # Pre-check active lockouts (AC-3, AC-5): even if correct password submitted, reject with 429
        is_combo_locked, combo_retry, combo_until = rate_limiter.check_rate_limit(session, combo_key)
        if is_combo_locked:
            minutes = math.floor(combo_retry / 60)
            seconds = combo_retry % 60
            time_str = f"{minutes:02d}:{seconds:02d}"
            try:
                log_account_locked(session, ip_address=norm_ip, email=normalized_email)
            except Exception:
                pass
            raise RateLimitException(
                code="AUTH_RATE_LIMITED",
                detail=f"Too many attempts. Please try again in {time_str}.",
                retry_after=combo_retry,
                locked_until=combo_until.isoformat() if combo_until else None,
                scope="login_lockout",
            )

        is_ip_locked, ip_retry, ip_until = rate_limiter.check_rate_limit(session, ip_key)
        if is_ip_locked:
            raise RateLimitException(
                code="AUTH_IP_RATE_LIMITED",
                detail="Too many login attempts from this network. Try again later.",
                retry_after=ip_retry,
                locked_until=ip_until.isoformat() if ip_until else None,
                scope="ip_lockout",
            )

        # Progressive delay if account-level failures across all IPs >= 15 (AC-6)
        email_status = rate_limiter.get_status(session, email_key)
        email_attempts = email_status.get("attempts", 0)
        if email_attempts >= settings.LOGIN_GLOBAL_EMAIL_MAX_ATTEMPTS:
            delay = min(5.0, 2.0 + (email_attempts - settings.LOGIN_GLOBAL_EMAIL_MAX_ATTEMPTS) * 0.5)
            time.sleep(delay)

        # Audit: record login attempt
        try:
            log_login_attempt(session, ip_address=norm_ip, email=normalized_email)
        except Exception:
            pass

        if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Supabase authentication is not configured. Please contact an administrator.",
            )

        start_time = time.perf_counter()
        try:
            supabase = get_supabase_client()
            auth_response = supabase.auth.sign_in_with_password({
                "email": normalized_email,
                "password": password,
            })
            authenticated = bool(auth_response and auth_response.session)
        except Exception:
            authenticated = False

        user = _get_application_user(email=normalized_email)
        if user:
            u_stat = str(user.get("status") or "ACTIVE").upper()
            if u_stat == "LOCKED":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is locked due to security policy. Please contact an administrator.")
            if u_stat == "SUSPENDED":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account has been suspended. Please contact an administrator.")
            if u_stat == "PROVISIONED":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account invitation is pending. You must complete password setup before logging in.")

        if not authenticated or not user:
            # Constant-time padding protection (AC-10, AC-31)
            _pad_duration(start_time, 0.25)

            try:
                log_login_failed(
                    session,
                    ip_address=norm_ip,
                    email=normalized_email,
                    reason="Invalid credentials" if not authenticated else "App user not found",
                )
            except Exception:
                pass

            # Record attempts on combo, IP, and global email (AC-1, AC-2, AC-5, AC-6)
            is_combo_locked, combo_attempts, combo_retry, combo_until = rate_limiter.record_attempt(
                session,
                combo_key,
                combo_type,
                combo_id,
                max_attempts=settings.LOGIN_MAX_ATTEMPTS,
                window_minutes=15,
                lockout_minutes=settings.LOGIN_LOCKOUT_MINUTES,
            )
            is_ip_locked, ip_attempts, ip_retry, ip_until = rate_limiter.record_attempt(
                session,
                ip_key,
                ip_type,
                ip_id,
                max_attempts=settings.LOGIN_IP_MAX_ATTEMPTS,
                window_minutes=15,
                lockout_minutes=settings.LOGIN_LOCKOUT_MINUTES,
            )
            rate_limiter.record_attempt(
                session,
                email_key,
                email_type,
                email_id,
                max_attempts=settings.LOGIN_GLOBAL_EMAIL_MAX_ATTEMPTS,
                window_minutes=15,
                lockout_minutes=settings.LOGIN_LOCKOUT_MINUTES,
            )

            if is_combo_locked:
                minutes = math.floor(combo_retry / 60)
                seconds = combo_retry % 60
                time_str = f"{minutes:02d}:{seconds:02d}"
                try:
                    log_account_locked(session, ip_address=norm_ip, email=normalized_email)
                except Exception:
                    pass
                raise RateLimitException(
                    code="AUTH_RATE_LIMITED",
                    detail=f"Too many attempts. Please try again in {time_str}.",
                    retry_after=combo_retry,
                    locked_until=combo_until.isoformat() if combo_until else None,
                    scope="login_lockout",
                )

            if is_ip_locked:
                raise RateLimitException(
                    code="AUTH_IP_RATE_LIMITED",
                    detail="Too many login attempts from this network. Try again later.",
                    retry_after=ip_retry,
                    locked_until=ip_until.isoformat() if ip_until else None,
                    scope="ip_lockout",
                )

            # Uniform generic response preventing user account existence enumeration (AC-10, AC-31)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        # Successful authentication: clear combo attempts (AC-7)
        rate_limiter.reset_attempts(session, combo_key)

        # Create persistent challenge in PostgreSQL/SQLite (Milestone 4, AC-26, AC-28)
        now = datetime.now(timezone.utc)
        challenge_id, otp_code, otp_id = otp_service.create_login_challenge(
            db=session,
            email=normalized_email,
            ip_address=norm_ip,
            user_id=int(user["user_id"]) if user and user.get("user_id") else None,
            now=now,
        )

        challenge_cookie = encrypt_payload({
            "challenge_id": challenge_id,
            "user_id": user["user_id"] if user else None,
            "email": normalized_email,
            "ip_address": norm_ip,
            "expires_at": (now + timedelta(seconds=settings.OTP_EXPIRES_SECONDS)).timestamp(),
            "last_sent_at": now.timestamp(),
            "resend_count": 0,
            "remember_me": remember_me,
        })

        _send_login_otp(normalized_email, otp_code, wait=False)

        try:
            log_otp_sent(session, ip_address=norm_ip, email=normalized_email)
        except Exception:
            pass

        return LoginChallengeResponse(
            expires_in=settings.OTP_EXPIRES_SECONDS,
            email=_mask_email(normalized_email),
        ), challenge_cookie


def verify_login_otp(db: Optional[Session], otp_data: VerifyOtpRequest, ip_address: str, cookie_value: str | None) -> tuple[TokenResponse, str, bool]:
    from app.core.network import normalize_client_ip
    from app.services.otp_service import otp_service
    norm_ip = normalize_client_ip(ip_address)

    if not cookie_value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login verification session not found.")
    challenge = decrypt_payload(cookie_value)
    challenge_id = str(challenge.get("challenge_id", ""))

    with _resolve_session(db) as session:
        try:
            otp_record = otp_service.verify_otp(
                db=session,
                challenge_id=challenge_id,
                submitted_otp=otp_data.otp,
                ip_address=norm_ip,
            )
        except HTTPException:
            try:
                log_otp_failed(session, ip_address=norm_ip, email=challenge.get("email", ""))
            except Exception:
                pass
            raise

        user_id = challenge.get("user_id") or (otp_record.user_id if otp_record else None)
        user = _get_application_user(user_id=int(user_id)) if user_id else None
        if user:
            _update_application_user_login(int(user["user_id"]))
            user_info = _application_user_response(user, db=session)
        else:
            user_info = UserResponse(user_id=0, email=challenge["email"], name=challenge["email"].split("@")[0], company_id=None, is_admin=False)
        user_role = str(user.get("role") or ("admin" if user.get("is_admin") else "company")).lower() if user else "company"
        is_admin_flag = bool(user["is_admin"]) if user else False

        remember_me = bool(challenge.get("remember_me", False))
        user_id_val = int(user["user_id"]) if user else 1

        from app.models.user import User as UserModel
        db_user = session.query(UserModel).filter(UserModel.user_id == user_id_val).first() if user_id_val else None
        if db_user and getattr(db_user, "token_version", None) is not None:
            token_version_val = int(db_user.token_version)
        elif user and user.get("token_version") is not None:
            token_version_val = int(user["token_version"])
        else:
            token_version_val = 1
        sid = secrets.token_urlsafe(32)

        from app.services.session_service import create_refresh_cookie_payload, register_user_session
        refresh_cookie, cookie_payload = create_refresh_cookie_payload(
            user_id=user_id_val,
            email=challenge["email"],
            token_version=token_version_val,
            remember_me=remember_me,
            sid=sid,
        )

        # Enforce session concurrency limits (Max 3 concurrent sessions, oldest evicted)
        register_user_session(
            db=session,
            user_id=user_id_val,
            sid=sid,
            family_id=cookie_payload["family_id"],
            ip_address=norm_ip,
        )

        access_token = create_jwt_token(
            user_id=user_id_val,
            email=challenge["email"],
            is_admin=is_admin_flag,
            company_id=int(user["company_id"]) if user and user["company_id"] is not None else None,
            company_ids=user_info.company_ids,
            role=user_role,
            expires_delta_seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS,
            sid=sid,
            token_version=token_version_val,
        )

        # Audit: OTP verified + login success
        try:
            uid = int(user["user_id"]) if user else None
            cid = int(user["company_id"]) if user and user["company_id"] is not None else None
            log_otp_verified(session, user_id=uid, company_id=cid, ip_address=norm_ip, email=challenge["email"])
            log_login_success(session, user_id=uid, company_id=cid, ip_address=norm_ip, email=challenge["email"])
        except Exception:
            pass

        return TokenResponse(access_token=access_token, user=user_info, remember_me=remember_me), refresh_cookie, remember_me


def resend_login_otp(db: Optional[Session], ip_address: str, cookie_value: str | None) -> tuple[OtpResponse, str]:
    from app.core.network import normalize_client_ip
    from app.services.otp_service import otp_service
    norm_ip = normalize_client_ip(ip_address)

    if not cookie_value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login verification session not found.")
    challenge = decrypt_payload(cookie_value)
    challenge_id = str(challenge.get("challenge_id", ""))

    with _resolve_session(db) as session:
        result, new_otp_code = otp_service.resend_otp(
            db=session,
            challenge_id=challenge_id,
            ip_address=norm_ip,
            send_email_func=_send_login_otp,
        )

        now = datetime.now(timezone.utc)
        challenge["last_sent_at"] = now.timestamp()
        challenge["resend_count"] = int(challenge.get("resend_count", 0)) + 1
        challenge["expires_at"] = (now + timedelta(seconds=settings.OTP_EXPIRES_SECONDS)).timestamp()

        try:
            log_otp_resent(session, ip_address=norm_ip, email=challenge.get("email", ""))
        except Exception:
            pass

        return OtpResponse(
            message=result["message"],
            expires_in=result["expires_in"],
            resend_available_in=result["resend_available_in"],
        ), encrypt_payload(challenge)


# logout user
def logout_user(
    db: Session,
    token: Optional[str] = None,
    user_id: Optional[int] = None,
    company_id: Optional[int] = None,
    ip_address: str = "unknown",
) -> MessageResponse:
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            supabase = get_supabase_client()
            supabase.auth.sign_out()
        except Exception as e:
            logger.warning(f"Supabase sign_out error: {e}")

    try:
        log_logout(db, user_id=user_id, company_id=company_id, ip_address=ip_address)
    except Exception:
        pass

    return MessageResponse(message="Successfully logged out.", success=True)


def validate_invitation_token(db: Session, token: str) -> TokenValidateResponse:
    """
    Validates token authenticity, purpose, status, and expiry on link mount without consuming it.
    Returns 200 with purpose and masked email for valid tokens.
    Raises 410 for expired, 400 for used or invalid, and 422 for malformed tokens.
    """
    clean_token = (token or "").strip()
    if not clean_token:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Token is required.",
        )

    actual_token = clean_token
    if clean_token.startswith("gAAAAA"):
        try:
            payload = decrypt_payload(clean_token)
            actual_token = payload.get("token", "")
            if not actual_token:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Malformed token payload.",
                )
        except HTTPException:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Malformed or invalid token.",
            )
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Malformed or invalid token.",
            )
    else:
        if len(clean_token) < 16:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Malformed token format.",
            )

    token_hash = hashlib.sha256(actual_token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)

    invitation = db.query(UserInvitation).filter(UserInvitation.token_hash == token_hash).first()
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invitation token.",
        )

    if invitation.status in ("ACCEPTED", "CLAIMED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link has already been used.",
        )

    if invitation.status == "REVOKED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link has been revoked.",
        )

    exp = invitation.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    if exp <= now or invitation.status == "EXPIRED":
        if invitation.status != "EXPIRED" or invitation.token_hash is not None:
            db.query(UserInvitation).filter(UserInvitation.invitation_id == invitation.invitation_id).update(
                {"status": "EXPIRED", "token_hash": None}, synchronize_session=False
            )
            db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This link has expired.",
        )

    user = db.query(User).filter(User.user_id == invitation.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    if user.status in ("SUSPENDED", "DEACTIVATED", "LOCKED"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is {user.status.lower()}. Please contact an administrator.",
        )

    masked = _mask_email(user.email)
    purpose = invitation.purpose or "initial_password_setup"

    return TokenValidateResponse(
        valid=True,
        purpose=purpose,
        masked_email=masked,
    )


# request password reset with dual sliding-window rate limiting, time floor, and 60s cooldown
def request_password_reset(
    db: Session,
    request_data: PasswordResetRequest,
    ip_address: str = "unknown",
) -> MessageResponse:
    start_perf = time.perf_counter()
    floor_ms = getattr(settings, "FORGOT_PASSWORD_TIME_FLOOR_MS", 180)
    floor_seconds = float(floor_ms) / 1000.0

    email = request_data.email
    if request_data.encrypted_payload:
        decrypted = decrypt_payload(request_data.encrypted_payload)
        email = decrypted.get("email", email)

    if not email:
        _pad_duration(start_perf, floor_seconds)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required for password reset.",
        )

    normalized_email = str(email).strip().lower()
    clean_ip = (ip_address or "unknown").strip()
    is_trusted_ip = clean_ip in ("127.0.0.1", "::1", "localhost", "unknown")

    # Persistent database-backed rate limiting (3 requests / 30 min per email+IP combo, 10 / 30 min per IP)
    from app.services.rate_limiter import (
        rate_limiter,
        get_password_reset_combo_key,
        get_password_reset_ip_key,
    )
    from app.core.errors import RateLimitException

    combo_key, combo_type, combo_id = get_password_reset_combo_key(normalized_email, clean_ip)
    ip_key, ip_type, ip_id = get_password_reset_ip_key(clean_ip)

    is_combo_locked, combo_retry, combo_until = rate_limiter.check_rate_limit(db, combo_key)
    if is_combo_locked:
        _pad_duration(start_perf, floor_seconds)
        raise RateLimitException(
            code="AUTH_RATE_LIMITED",
            detail="Too many password reset requests. Please try again later.",
            retry_after=combo_retry,
            locked_until=combo_until.isoformat() if combo_until else None,
            scope="password_reset_lockout",
        )

    if not is_trusted_ip:
        is_ip_locked, ip_retry, ip_until = rate_limiter.check_rate_limit(db, ip_key)
        if is_ip_locked:
            _pad_duration(start_perf, floor_seconds)
            raise RateLimitException(
                code="AUTH_IP_RATE_LIMITED",
                detail="Too many requests from this network. Please try again later.",
                retry_after=ip_retry,
                locked_until=ip_until.isoformat() if ip_until else None,
                scope="password_reset_ip_lockout",
            )

    max_email = getattr(settings, "FORGOT_PASSWORD_RATE_LIMIT_EMAIL_COUNT", 5)
    rate_limiter.record_attempt(
        db,
        combo_key,
        combo_type,
        combo_id,
        max_attempts=max_email,
        window_minutes=30,
        lockout_minutes=30,
    )
    if not is_trusted_ip:
        rate_limiter.record_attempt(
            db,
            ip_key,
            ip_type,
            ip_id,
            max_attempts=10,
            window_minutes=30,
            lockout_minutes=30,
        )

    max_email = getattr(settings, "FORGOT_PASSWORD_RATE_LIMIT_EMAIL_COUNT", 5)
    email_window = getattr(settings, "FORGOT_PASSWORD_RATE_LIMIT_EMAIL_WINDOW_SECONDS", 900)
    max_ip = getattr(settings, "FORGOT_PASSWORD_RATE_LIMIT_IP_COUNT", 10)
    ip_window = getattr(settings, "FORGOT_PASSWORD_RATE_LIMIT_IP_WINDOW_SECONDS", 900)
    silent_cooldown = getattr(settings, "FORGOT_PASSWORD_SILENT_COOLDOWN_SECONDS", 60)

    now_ts = time.time()
    in_cooldown = False

    with _forgot_pwd_lock:
        ip_window_start = now_ts - ip_window
        email_window_start = now_ts - email_window

        ip_reqs = [t for t in _forgot_pwd_ip_requests[clean_ip] if t > ip_window_start]
        _forgot_pwd_ip_requests[clean_ip] = ip_reqs

        email_reqs = [t for t in _forgot_pwd_email_requests[normalized_email] if t > email_window_start]
        _forgot_pwd_email_requests[normalized_email] = email_reqs

        if (not is_trusted_ip and len(ip_reqs) >= max_ip) or (len(email_reqs) >= max_email):
            _pad_duration(start_perf, floor_seconds)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many password reset requests. Please try again later.",
            )

        _forgot_pwd_ip_requests[clean_ip].append(now_ts)
        _forgot_pwd_email_requests[normalized_email].append(now_ts)

        last_sent = _forgot_pwd_last_sent.get(normalized_email, 0)
        if (now_ts - last_sent) < silent_cooldown:
            in_cooldown = True

    generic_response = MessageResponse(
        message="If an account exists for that email address, you will receive instructions to reset your password.",
        success=True,
    )

    if in_cooldown:
        _pad_duration(start_perf, floor_seconds)
        return generic_response

    user = db.query(User).filter(User.email == normalized_email).first()

    # Ineligible or unregistered accounts: perform dummy computation, pad time floor, and return identical generic message
    if not user or user.status != "ACTIVE":
        _ = hashlib.sha256((normalized_email + "dummy_timing_padding_entropy").encode("utf-8")).hexdigest()
        _pad_duration(start_perf, floor_seconds)
        return generic_response

    with _forgot_pwd_lock:
        _forgot_pwd_last_sent[normalized_email] = now_ts

    # Revoke previous pending or claimed reset tokens for this user and scrub token_hash (AC-4)
    db.query(UserInvitation).filter(
        UserInvitation.user_id == user.user_id,
        UserInvitation.purpose == "password_reset",
        UserInvitation.status.in_(["PENDING", "CLAIMED"]),
    ).update({"status": "REVOKED", "token_hash": None}, synchronize_session=False)

    # Cancel previous pending or failed reset outbox jobs for this user
    db.query(InvitationOutbox).filter(
        InvitationOutbox.user_id == user.user_id,
        InvitationOutbox.status.in_(["PENDING", "FAILED"]),
    ).update({"status": "CANCELLED", "encrypted_payload": None}, synchronize_session=False)

    # Generate fresh cryptographically secure reset token (AC-15)
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now_utc = datetime.now(timezone.utc)
    reset_minutes = getattr(settings, "PASSWORD_RESET_TOKEN_LIFETIME_MINUTES", 30)
    expires_at = now_utc + timedelta(minutes=reset_minutes)

    invitation = UserInvitation(
        user_id=user.user_id,
        token_hash=token_hash,
        status="PENDING",
        purpose="password_reset",
        expires_at=expires_at,
    )
    db.add(invitation)
    db.flush()

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
    encrypted_token = encrypt_invitation_token(raw_token, user.user_id, purpose="password_reset")
    setup_url = f"{frontend_url}/auth/setup-password#token={encrypted_token}"
    encrypted_payload = encrypt_payload({
        "user_id": user.user_id,
        "user_name": user.name,
        "setup_url": setup_url,
        "raw_token": raw_token,
        "purpose": "password_reset",
    })

    outbox_entry = InvitationOutbox(
        idempotency_key=f"reset:{user.user_id}:{invitation.invitation_id}",
        user_id=user.user_id,
        invitation_id=invitation.invitation_id,
        recipient_email=user.email,
        encrypted_payload=encrypted_payload,
        status="PENDING",
    )
    db.add(outbox_entry)
    db.commit()

    try:
        from app.services.invitation_dispatcher import process_pending_outbox_batch
        threading.Thread(target=process_pending_outbox_batch, daemon=True).start()
    except Exception as exc:
        logger.warning("Could not trigger background outbox dispatcher for reset: %s", exc)

    try:
        log_forgot_password(db, ip_address=ip_address, email=normalized_email)
    except Exception:
        pass

    _pad_duration(start_perf, floor_seconds)
    return generic_response


# reset password with atomic token consumption, Supabase compensation saga, and token_version bumping
def reset_password(
    db: Session,
    confirm_data: PasswordResetConfirm,
    ip_address: str = "unknown",
) -> MessageResponse:
    from app.services.rate_limiter import rate_limiter, get_password_reset_ip_key
    from app.core.errors import RateLimitException

    clean_ip = (ip_address or "unknown").strip()
    is_trusted_ip = clean_ip in ("127.0.0.1", "::1", "localhost", "unknown")
    if not is_trusted_ip:
        ip_key, ip_type, ip_id = get_password_reset_ip_key(clean_ip)
        is_ip_locked, ip_retry, ip_until = rate_limiter.check_rate_limit(db, ip_key)
        if is_ip_locked:
            raise RateLimitException(
                code="AUTH_IP_RATE_LIMITED",
                detail="Too many reset attempts from this network. Please try again later.",
                retry_after=ip_retry,
                locked_until=ip_until.isoformat() if ip_until else None,
                scope="password_reset_confirm_ip_lockout",
            )
    raw_token_input = confirm_data.token
    new_password = confirm_data.new_password

    if confirm_data.encrypted_payload:
        decrypted = decrypt_payload(confirm_data.encrypted_payload)
        new_password = decrypted.get("new_password", new_password)
        raw_token_input = decrypted.get("token", raw_token_input)

    clean_token = (raw_token_input or "").strip()
    if not clean_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset token is required.",
        )

    # Password complexity policy
    clean_pwd = new_password or ""
    if len(clean_pwd) < 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 10 characters long.",
        )
    if (
        not re.search(r"[A-Z]", clean_pwd)
        or not re.search(r"[a-z]", clean_pwd)
        or not re.search(r"[0-9]", clean_pwd)
        or not any(c in '!@#$%^&*(),.?":{}|<>-=_+' for c in clean_pwd)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must contain uppercase letters, lowercase letters, numbers, and symbols.",
        )

    actual_token = clean_token
    if clean_token.startswith("gAAAAA"):
        try:
            payload = decrypt_payload(clean_token)
            actual_token = payload.get("token", clean_token)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Reset link is invalid, expired, or has already been used.",
            )

    token_hash = hashlib.sha256(actual_token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)

    invitation = (
        db.query(UserInvitation)
        .filter(UserInvitation.token_hash == token_hash)
        .first()
    )
    if not invitation:
        if not is_trusted_ip:
            rate_limiter.record_attempt(
                db,
                ip_key,
                ip_type,
                ip_id,
                max_attempts=10,
                window_minutes=30,
                lockout_minutes=30,
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset link is invalid, expired, or has already been used.",
        )

    # Strict purpose isolation (AC-6, AC-12)
    if invitation.purpose != "password_reset":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token purpose for password reset.",
        )

    if invitation.status in ("REVOKED", "EXPIRED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This reset link has been {invitation.status.lower()} and is no longer valid.",
        )

    if invitation.status == "ACCEPTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link has already been used to change a password.",
        )

    exp = invitation.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp <= now:
        db.query(UserInvitation).filter(UserInvitation.invitation_id == invitation.invitation_id).update(
            {"status": "EXPIRED", "token_hash": None}, synchronize_session=False
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This reset link has expired. Please submit a new reset request.",
        )

    # Phase 1: Atomic conditional claim matching both status and purpose (AC-16)
    rows = (
        db.query(UserInvitation)
        .filter(
            UserInvitation.invitation_id == invitation.invitation_id,
            UserInvitation.status == "PENDING",
            UserInvitation.purpose == "password_reset",
            UserInvitation.expires_at > now,
        )
        .update(
            {"status": "CLAIMED", "claimed_at": now},
            synchronize_session=False,
        )
    )
    db.commit()

    if rows == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset link is currently being processed or has already been used.",
        )

    user = db.query(User).filter(User.user_id == invitation.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    if user.status in ("LOCKED", "SUSPENDED", "DEACTIVATED"):
        db.query(UserInvitation).filter(
            UserInvitation.invitation_id == invitation.invitation_id,
            UserInvitation.status == "CLAIMED",
        ).update({"status": "PENDING", "claimed_at": None}, synchronize_session=False)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is {user.status.lower()}. Please contact an administrator.",
        )

    # Phase 2: Supabase Admin Auth update with automatic rollback to PENDING on error (AC-17)
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            from app.services.user_service import UserService
            auth_user_id = UserService(db)._find_auth_user_id(user.email)
            get_supabase_admin_client().auth.admin.update_user_by_id(
                auth_user_id,
                {
                    "password": clean_pwd,
                },
            )
        except Exception as exc:
            db.query(UserInvitation).filter(
                UserInvitation.invitation_id == invitation.invitation_id,
                UserInvitation.status == "CLAIMED",
            ).update({"status": "PENDING", "claimed_at": None}, synchronize_session=False)
            db.commit()
            logger.exception("Failed to update password in Supabase Auth during reset: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Authentication provider service error. Please try again.",
            )

    # Phase 3: Finalize DB commit: bump token_version (session revocation), invalidate tokens, clear rate limit lockout (AC-13)
    try:
        user.token_version = int(getattr(user, "token_version", 1) or 1) + 1
        user.updated_at = now

        db.query(UserInvitation).filter(
            UserInvitation.invitation_id == invitation.invitation_id
        ).update(
            {"status": "ACCEPTED", "accepted_at": now, "token_hash": None},
            synchronize_session=False,
        )

        db.query(UserInvitation).filter(
            UserInvitation.user_id == user.user_id,
            UserInvitation.purpose == "password_reset",
            UserInvitation.status == "PENDING",
        ).update({"status": "REVOKED", "token_hash": None}, synchronize_session=False)

        # Clear login rate limit lockout on RateLimit table scoped strictly to this user (AC-13)
        try:
            from app.models.security import RateLimit
            from app.core.company_resolver import normalize_email
            from sqlalchemy import or_
            norm_user_email = normalize_email(str(user.email).strip().lower())
            escaped_email = (
                norm_user_email.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            db.query(RateLimit).filter(
                or_(
                    (RateLimit.rate_type == "login_email") & (RateLimit.identifier == norm_user_email),
                    (RateLimit.rate_type == "login_combo")
                    & RateLimit.identifier.like(f"{escaped_email}:%", escape="\\"),
                )
            ).update(
                {"attempts": 0, "locked_until": None, "updated_at": now},
                synchronize_session=False,
            )
        except Exception:
            pass

        db.commit()
        logger.info("Successfully reset password and bumped token_version for user_id=%s", user.user_id)
    except Exception as dberr:
        db.rollback()
        logger.error("DB commit failed after password reset for user %s: %s", user.user_id, dberr)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to finalize password reset. Please try again.",
        )

    # Informational confirmation email in background worker (AC-13)
    try:
        def _dispatch_confirmation():
            subj = "Your password was reset - MCT Financial Management System"
            txt = (
                f"Hello {user.name},\n\n"
                f"Your account password has been successfully reset. "
                f"If you did not initiate this change, please contact an administrator immediately.\n\n"
                f"MCT Companies Centralized Financial Management System"
            )
            h_content = f"""
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #0f172a;">Password Reset Complete</h2>
                <p style="color: #334155; font-size: 15px;">Hello {html.escape(user.name)},</p>
                <p style="color: #334155; font-size: 15px;">Your account password has been successfully reset. All active sessions have been terminated across all devices.</p>
                <p style="color: #64748b; font-size: 13px;">If you did not make this change, please contact an administrator immediately to secure your account.</p>
                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
                <p style="color: #94a3b8; font-size: 12px;">MCT Companies Centralized Financial Management System</p>
            </div>
            """
            from app.services.email_service import send_transactional_email
            send_transactional_email(
                to_email=user.email,
                subject=subj,
                html_content=h_content,
                text_content=txt,
                enforce_cooldown=False,
            )
        threading.Thread(target=_dispatch_confirmation, daemon=True).start()
    except Exception as mail_err:
        logger.warning("Could not dispatch confirmation email: %s", mail_err)

    try:
        log_password_reset(
            db,
            user_id=user.user_id,
            company_id=user.company_id,
            ip_address="system",
            email=user.email,
            success=True,
        )
    except Exception:
        pass

    return MessageResponse(
        message="Password has been reset successfully. You may now log in.",
        success=True,
    )


def setup_invitation_password(db: Session, token: str, new_password: str, ip_address: str = "unknown") -> MessageResponse:
    """
    Concurrency-safe initial password setup with strict purpose enforcement,
    three-phase Supabase saga, and account activation to ACTIVE.
    """
    from app.services.rate_limiter import rate_limiter, get_password_reset_ip_key
    from app.core.errors import RateLimitException

    clean_ip = (ip_address or "unknown").strip()
    is_trusted_ip = clean_ip in ("127.0.0.1", "::1", "localhost", "unknown")
    if not is_trusted_ip:
        ip_key, ip_type, ip_id = get_password_reset_ip_key(clean_ip)
        is_ip_locked, ip_retry, ip_until = rate_limiter.check_rate_limit(db, ip_key)
        if is_ip_locked:
            raise RateLimitException(
                code="AUTH_IP_RATE_LIMITED",
                detail="Too many setup attempts from this network. Please try again later.",
                retry_after=ip_retry,
                locked_until=ip_until.isoformat() if ip_until else None,
                scope="password_setup_ip_lockout",
            )
    clean_token = (token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation token is required.")

    # Password complexity policy
    clean_pwd = new_password or ""
    if len(clean_pwd) < 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 10 characters long.",
        )
    if (
        not re.search(r"[A-Z]", clean_pwd)
        or not re.search(r"[a-z]", clean_pwd)
        or not re.search(r"[0-9]", clean_pwd)
        or not any(c in '!@#$%^&*(),.?":{}|<>-=_+' for c in clean_pwd)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must contain uppercase letters, lowercase letters, numbers, and symbols.",
        )

    actual_token = clean_token
    if clean_token.startswith("gAAAAA"):
        try:
            payload = decrypt_payload(clean_token)
            actual_token = payload.get("token", clean_token)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invitation link is invalid, expired, or has already been used.",
            )

    token_hash = hashlib.sha256(actual_token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)

    # 1. Lookup candidate invitation
    invitation = (
        db.query(UserInvitation)
        .filter(UserInvitation.token_hash == token_hash)
        .first()
    )
    if not invitation:
        if not is_trusted_ip:
            rate_limiter.record_attempt(
                db,
                ip_key,
                ip_type,
                ip_id,
                max_attempts=10,
                window_minutes=30,
                lockout_minutes=30,
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invitation link is invalid, expired, or has already been used.",
        )

    # Strict purpose enforcement (AC-6)
    if invitation.purpose != "initial_password_setup":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token purpose for initial password setup.",
        )

    if invitation.status in ("REVOKED", "EXPIRED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This invitation has been {invitation.status.lower()} and is no longer valid.",
        )

    if invitation.status == "ACCEPTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invitation link has already been used to set up a password.",
        )

    # Normalize expires_at for comparison
    exp = invitation.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp <= now:
        db.query(UserInvitation).filter(UserInvitation.invitation_id == invitation.invitation_id).update(
            {"status": "EXPIRED", "token_hash": None}, synchronize_session=False
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invitation link has expired. Please contact an administrator for a new invitation.",
        )

    # 2. Phase 1: Atomic conditional claim matching status and purpose (AC-16)
    rows = (
        db.query(UserInvitation)
        .filter(
            UserInvitation.invitation_id == invitation.invitation_id,
            UserInvitation.status == "PENDING",
            UserInvitation.purpose == "initial_password_setup",
            UserInvitation.expires_at > now,
        )
        .update(
            {"status": "CLAIMED", "claimed_at": now},
            synchronize_session=False,
        )
    )
    db.commit()

    if rows == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invitation link is currently being processed or has already been used.",
        )

    # 3. Check user record & eligibility (AC-5)
    user = db.query(User).filter(User.user_id == invitation.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    if user.status in ("LOCKED", "SUSPENDED", "DEACTIVATED"):
        db.query(UserInvitation).filter(
            UserInvitation.invitation_id == invitation.invitation_id,
            UserInvitation.status == "CLAIMED",
        ).update({"status": "PENDING", "claimed_at": None}, synchronize_session=False)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is {user.status.lower()}. Please contact an administrator.",
        )

    # 4. Phase 2: Update password in Supabase Auth with rollback to PENDING on error (AC-17)
    try:
        from app.services.user_service import UserService
        auth_user_id = UserService(db)._find_auth_user_id(user.email)
        get_supabase_admin_client().auth.admin.update_user_by_id(
            auth_user_id,
            {
                "password": clean_pwd,
                "email_confirm": True,
                "user_metadata": {"must_change_password": False},
            },
        )
    except Exception as exc:
        db.query(UserInvitation).filter(
            UserInvitation.invitation_id == invitation.invitation_id,
            UserInvitation.status == "CLAIMED",
        ).update({"status": "PENDING", "claimed_at": None}, synchronize_session=False)
        db.commit()
        logger.exception("Failed to update password in Supabase Auth: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Authentication provider service error. Please try again.",
        )

    # 5. Phase 3: Finalize DB user activation & invitation acceptance
    try:
        user.status = "ACTIVE"
        user.must_change_password = False
        user.token_version = int(getattr(user, "token_version", 1) or 1) + 1
        user.updated_at = now

        db.query(UserInvitation).filter(
            UserInvitation.invitation_id == invitation.invitation_id
        ).update(
            {"status": "ACCEPTED", "accepted_at": now, "token_hash": None},
            synchronize_session=False,
        )

        # Invalidate any other pending setup tokens for this user and scrub token_hash (AC-4)
        db.query(UserInvitation).filter(
            UserInvitation.user_id == user.user_id,
            UserInvitation.purpose == "initial_password_setup",
            UserInvitation.status == "PENDING",
        ).update({"status": "REVOKED", "token_hash": None}, synchronize_session=False)

        db.commit()
        logger.info("Successfully activated user_id=%s via invitation redemption.", user.user_id)
    except Exception as dberr:
        db.rollback()
        logger.error(
            "DB commit failed after Supabase password update for user %s: %s",
            user.user_id,
            dberr,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to finalize account activation. Please try again.",
        )

    return MessageResponse(
        message="Password set successfully. You may now log in.",
        success=True,
    )
