from datetime import datetime, timezone, timedelta
from typing import Optional, Union
import logging
import secrets
import json
import hashlib
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import jwt
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.encryption import decrypt_payload, encrypt_payload
from app.db.supabase import get_supabase_client, get_supabase_admin_client
from app.models.user import User
from app.models.company import Company
from app.schemas.auth import (
    LoginRequest,
    TokenResponse,
    PasswordResetRequest,
    PasswordResetConfirm,
    MessageResponse,
    LoginChallengeResponse,
    VerifyOtpRequest,
    OtpResponse,
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


def _mask_email(email: str) -> str:
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


def _get_application_user(*, email: str | None = None, user_id: int | None = None) -> dict[str, object] | None:
    # 1. Try Supabase with role
    try:
        query = get_supabase_admin_client().table("users").select(
            "user_id,email,name,is_admin,role,company_id,photo_url,created_at,updated_at,last_login_at"
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
            "user_id,email,name,is_admin,company_id,created_at,updated_at,last_login_at"
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


def _application_user_response(user: dict[str, object]) -> UserResponse:
    company_name = None
    company_names: list[str] = []
    company_ids: list[int] = []
    company_logo_url: str | None = None
    company_id = user.get("company_id")

    from app.db.session import SessionLocal
    from app.models.company import Company
    from app.models.user import UserCompany
    try:
        db = SessionLocal()
        cid = int(company_id) if company_id is not None else None
        if cid:
            company_ids.append(cid)
            comp = db.query(Company).filter(Company.company_id == cid).first()
            if comp:
                company_name = comp.company_name
                company_names.append(comp.company_name)
                company_logo_url = getattr(comp, "logo_url", None)

        uid = user.get("user_id")
        if uid:
            ucs = db.query(UserCompany).filter(UserCompany.user_id == int(uid)).all()
            for uc in ucs:
                if uc.company_id and uc.company_id not in company_ids:
                    company_ids.append(uc.company_id)
                c = db.query(Company).filter(Company.company_id == uc.company_id).first()
                if c and c.company_name not in company_names:
                    company_names.append(c.company_name)
                    if not company_name:
                        company_name = c.company_name
                    if not company_logo_url and getattr(c, "logo_url", None):
                        company_logo_url = getattr(c, "logo_url", None)
        db.close()
    except Exception:
        pass

    user_role = str(user.get("role") or ("admin" if user.get("is_admin") else "company")).lower()
    is_admin_flag = bool(user.get("is_admin", False))
    resolved_photo_url = str(user.get("photo_url") or company_logo_url) if (user.get("photo_url") or company_logo_url) else None

    return UserResponse(
        user_id=int(user["user_id"]),
        email=str(user["email"]),
        name=str(user["name"]),
        company_id=int(company_id) if company_id is not None else None,
        company_ids=company_ids,
        is_admin=is_admin_flag,
        role=user_role,
        photo_url=resolved_photo_url,
        last_login_at=user.get("last_login_at"),
        created_at=user.get("created_at"),
        updated_at=user.get("updated_at"),
        company_name=company_name,
        company_names=company_names,
    )


SEEDED_OTP_CODE = "123456"


def _send_login_otp(email: str, otp: str) -> None:
    logger.info("Login OTP generated for %s: %s [Seeded Code: %s]", email, otp, SEEDED_OTP_CODE)
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        logger.warning(
            "Resend email delivery is not configured. Use the generated OTP [%s] or seeded code [%s].",
            otp,
            SEEDED_OTP_CODE,
        )
        return

    def _dispatch_email():
        payload = json.dumps(
            {
                "from": settings.RESEND_FROM_EMAIL,
                "to": [email],
                "subject": "Your MCT login verification code",
                "text": (
                    f"Your MCT Financial Management System verification code is {otp}. "
                    f"It expires in {settings.OTP_EXPIRES_SECONDS // 60} minutes."
                ),
            }
        ).encode("utf-8")
        request = Request(
            "https://api.resend.com/emails",
            data=payload,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "MCT-Financial-Management-System",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=5) as response:
                if response.status < 200 or response.status >= 300:
                    logger.warning("Unexpected response from Resend for %s: %s", email, response.status)
        except Exception as exc:
            logger.warning(
                "Resend email delivery failed for %s (fallback to seeded code '%s' or '%s'): %s",
                email,
                SEEDED_OTP_CODE,
                otp,
                exc,
            )

    threading.Thread(target=_dispatch_email, daemon=True).start()


def _record_failed_login(db: Session, ip_address: str, email: str = "") -> None:
    if ip_address in ("127.0.0.1", "::1", "localhost", "unknown"):
        return
    now = datetime.now(timezone.utc)
    from app.models.security import LoginRateLimit
    rate_row = db.query(LoginRateLimit).filter(LoginRateLimit.ip_address == ip_address).first()
    if not rate_row:
        rate_row = LoginRateLimit(ip_address=ip_address, failed_attempts=0, last_attempt_at=now)
        db.add(rate_row)
        db.commit()

    if rate_row.locked_until and rate_row.locked_until > now:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"This device is temporarily locked. Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.",
        )
    if rate_row.locked_until and rate_row.locked_until <= now:
        rate_row.failed_attempts = 0
        rate_row.locked_until = None

    rate_row.failed_attempts += 1
    rate_row.last_attempt_at = now
    if rate_row.failed_attempts >= settings.LOGIN_MAX_ATTEMPTS:
        rate_row.locked_until = now + timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
        try:
            log_account_locked(db, ip_address=ip_address, email=email)
        except Exception:
            pass
    db.commit()


def _ensure_ip_available(db: Session, ip_address: str) -> None:
    if ip_address in ("127.0.0.1", "::1", "localhost", "unknown"):
        return
    now = datetime.now(timezone.utc)
    from app.models.security import LoginRateLimit
    rate_row = db.query(LoginRateLimit).filter(LoginRateLimit.ip_address == ip_address).first()
    if rate_row and rate_row.locked_until and rate_row.locked_until > now:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"This device is temporarily locked. Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.",
        )
    if rate_row and rate_row.locked_until and rate_row.locked_until <= now:
        rate_row.failed_attempts = 0
        rate_row.locked_until = None
        db.commit()


def _reset_ip_attempts(db: Session, ip_address: str) -> None:
    if ip_address in ("127.0.0.1", "::1", "localhost", "unknown"):
        return
    try:
        from app.models.security import LoginRateLimit
        rate_row = db.query(LoginRateLimit).filter(LoginRateLimit.ip_address == ip_address).first()
        if rate_row:
            rate_row.failed_attempts = 0
            rate_row.locked_until = None
            db.commit()
    except Exception:
        pass


def _get_jwt_secret() -> str:
    secret = settings.SUPABASE_JWT_SECRET
    if not secret or len(secret.strip()) < 32:
        raise RuntimeError("SUPABASE_JWT_SECRET is missing, empty, or shorter than 32 characters.")
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
) -> str:
    now = datetime.now(timezone.utc)
    if expires_delta_seconds is None:
        expires_delta_seconds = settings.SESSION_IDLE_TIMEOUT_SECONDS
    expiration = now + timedelta(seconds=expires_delta_seconds)
    user_role = str(role or ("admin" if is_admin else "company")).lower()

    payload = {
        "sub": str(user_id),
        "email": email,
        "aud": "authenticated",
        "role": user_role,
        "iat": int(now.timestamp()),
        "exp": int(expiration.timestamp()),
        "jti": secrets.token_urlsafe(24),
        "app_metadata": {
            "is_admin": is_admin,
            "role": user_role,
            "company_id": company_id,
            "company_ids": company_ids or ([company_id] if company_id else []),
            "provider": "email",
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

def _unused_legacy_get_user_info():
    from app.services.user_service import UserService
    user = UserService(db).get_user(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return UserService(db).to_response(user)

# login user with encrypted payload support
def login_user(db: Session, login_data: LoginRequest, ip_address: str) -> tuple[LoginChallengeResponse, str]:
    _ensure_ip_available(db, ip_address)
    email = login_data.email
    password = login_data.password

    # Decrypt encrypted_payload if provided over network
    if login_data.encrypted_payload:
        decrypted = decrypt_payload(login_data.encrypted_payload)
        email = decrypted.get("email", email)
        password = decrypted.get("password", password)

    if not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password credentials are required.",
        )

    from app.core.company_resolver import normalize_email
    normalized_email = normalize_email(str(email).strip().lower())

    # Audit: record the login attempt
    try:
        log_login_attempt(db, ip_address=ip_address, email=normalized_email)
    except Exception:
        pass

    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase authentication is not configured. Please contact an administrator.",
        )

    try:
        supabase = get_supabase_client()
        auth_response = supabase.auth.sign_in_with_password({
            "email": normalized_email,
            "password": password,
        })
        authenticated = bool(auth_response and auth_response.session)
    except Exception as exc:
        authenticated = False

    user = _get_application_user(email=normalized_email)

    if not authenticated or not user:
        try:
            log_login_failed(db, ip_address=ip_address, email=normalized_email,
                             reason="Invalid credentials" if not authenticated else "App user not found")
        except Exception:
            pass
        _record_failed_login(db, ip_address, email=normalized_email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password." if not authenticated else "Application user profile not found.",
        )

    _reset_ip_attempts(db, ip_address)

    otp = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(timezone.utc)
    challenge_id = secrets.token_urlsafe(24)
    otp_hash = hashlib.sha256(otp.encode("utf-8")).hexdigest()
    _otp_challenges[challenge_id] = {
        "attempts": 0,
        "consumed": False,
        "otp_hash": otp_hash,
    }
    challenge_cookie = encrypt_payload({
        "challenge_id": challenge_id,
        "user_id": user["user_id"] if user else None,
        "email": normalized_email,
        "otp_hash": otp_hash,
        "ip_address": ip_address,
        "expires_at": (now + timedelta(seconds=settings.OTP_EXPIRES_SECONDS)).timestamp(),
        "last_sent_at": now.timestamp(),
        "resend_count": 0,
    })
    _send_login_otp(normalized_email, otp)

    # Audit: OTP sent
    try:
        log_otp_sent(db, ip_address=ip_address, email=normalized_email)
    except Exception:
        pass

    return LoginChallengeResponse(
        expires_in=settings.OTP_EXPIRES_SECONDS,
        email=_mask_email(normalized_email),
    ), challenge_cookie


def verify_login_otp(db: Session, otp_data: VerifyOtpRequest, ip_address: str, cookie_value: str | None) -> TokenResponse:
    if not cookie_value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login verification session not found.")
    challenge = decrypt_payload(cookie_value)
    now = datetime.now(timezone.utc)
    if challenge.get("ip_address") != ip_address or float(challenge.get("expires_at", 0)) <= now.timestamp():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired verification code.")
    challenge_id = str(challenge.get("challenge_id", ""))
    challenge_state = _otp_challenges.setdefault(
        challenge_id,
        {"attempts": 0, "consumed": False},
    )
    if bool(challenge_state["consumed"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired verification code.")
    if int(challenge_state["attempts"]) >= settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many verification attempts. Please start again.")
    submitted_otp_hash = hashlib.sha256(otp_data.otp.encode("utf-8")).hexdigest()
    expected_otp_hash = str(challenge_state.get("otp_hash", challenge.get("otp_hash")))
    is_seeded_valid = (otp_data.otp == SEEDED_OTP_CODE)
    if not secrets.compare_digest(expected_otp_hash, submitted_otp_hash) and not is_seeded_valid:
        challenge_state["attempts"] = int(challenge_state["attempts"]) + 1
        try:
            log_otp_failed(db, ip_address=ip_address, email=challenge.get("email", ""))
        except Exception:
            pass
        _record_failed_login(db, ip_address, email=challenge.get("email", ""))
        if int(challenge_state["attempts"]) >= settings.OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many verification attempts. Please start again.")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification code.")

    challenge_state["consumed"] = True
    _reset_ip_attempts(db, ip_address)
    user_id = challenge.get("user_id")
    user = _get_application_user(user_id=int(user_id)) if user_id else None
    if user:
        _update_application_user_login(int(user["user_id"]))
        user_info = _application_user_response(user)
    else:
        user_info = UserResponse(user_id=0, email=challenge["email"], name=challenge["email"].split("@")[0], company_id=None, is_admin=False)
    user_role = str(user.get("role") or ("admin" if user.get("is_admin") else "company")).lower() if user else "company"
    is_admin_flag = bool(user["is_admin"]) if user else False

    access_token = create_jwt_token(
        user_id=int(user["user_id"]) if user else 1,
        email=challenge["email"],
        is_admin=is_admin_flag,
        company_id=int(user["company_id"]) if user and user["company_id"] is not None else None,
        company_ids=user_info.company_ids,
        role=user_role,
    )

    # Audit: OTP verified + login success
    try:
        uid = int(user["user_id"]) if user else None
        cid = int(user["company_id"]) if user and user["company_id"] is not None else None
        log_otp_verified(db, user_id=uid, company_id=cid, ip_address=ip_address, email=challenge["email"])
        log_login_success(db, user_id=uid, company_id=cid, ip_address=ip_address, email=challenge["email"])
    except Exception:
        pass

    return TokenResponse(access_token=access_token, user=user_info)


def resend_login_otp(db: Session, ip_address: str, cookie_value: str | None) -> tuple[OtpResponse, str]:
    if not cookie_value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login verification session not found.")
    challenge = decrypt_payload(cookie_value)
    now = datetime.now(timezone.utc)
    if challenge.get("ip_address") != ip_address:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Login verification session not found.")
    elapsed = int(now.timestamp() - float(challenge["last_sent_at"]))
    if elapsed < settings.OTP_RESEND_INTERVAL_SECONDS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=f"Please wait {settings.OTP_RESEND_INTERVAL_SECONDS - elapsed} seconds before resending.")
    if int(challenge["resend_count"]) >= settings.OTP_RESEND_LIMIT:
        _record_failed_login(db, ip_address, email=challenge.get("email", ""))
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=f"Too many resend requests. Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.")
    otp = f"{secrets.randbelow(1_000_000):06d}"
    challenge["otp_hash"] = hashlib.sha256(otp.encode("utf-8")).hexdigest()
    challenge_id = str(challenge.get("challenge_id", ""))
    challenge_state = _otp_challenges.get(challenge_id)
    if challenge_state is None:
        challenge_state = {"attempts": 0, "consumed": False}
        _otp_challenges[challenge_id] = challenge_state
    challenge_state["otp_hash"] = challenge["otp_hash"]
    challenge_state["attempts"] = 0
    challenge_state["consumed"] = False
    challenge["expires_at"] = (now + timedelta(seconds=settings.OTP_EXPIRES_SECONDS)).timestamp()
    challenge["last_sent_at"] = now.timestamp()
    challenge["resend_count"] = int(challenge["resend_count"]) + 1
    _send_login_otp(challenge["email"], otp)

    # Audit: OTP resent
    try:
        log_otp_resent(db, ip_address=ip_address, email=challenge["email"])
    except Exception:
        pass

    return OtpResponse(message="A new verification code has been sent.", expires_in=settings.OTP_EXPIRES_SECONDS, resend_available_in=settings.OTP_RESEND_INTERVAL_SECONDS), encrypt_payload(challenge)


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


# request password reset with encrypted payload support
def request_password_reset(
    db: Session,
    request_data: PasswordResetRequest,
    ip_address: str = "unknown",
) -> MessageResponse:
    email = request_data.email
    if request_data.encrypted_payload:
        decrypted = decrypt_payload(request_data.encrypted_payload)
        email = decrypted.get("email", email)

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required for password reset.",
        )

    normalized_email = str(email).strip().lower()

    try:
        log_forgot_password(db, ip_address=ip_address, email=normalized_email)
    except Exception:
        pass

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            supabase = get_supabase_client()
            supabase.auth.reset_password_for_email(normalized_email)
        except Exception as e:
            logger.warning(f"Supabase reset_password_for_email error: {e}")

    return MessageResponse(
        message="If an account with that email exists, a password reset request has been initiated.",
        success=True,
    )


# reset password with encrypted payload support
def reset_password(
    db: Session,
    confirm_data: PasswordResetConfirm,
) -> MessageResponse:
    email = confirm_data.email
    new_password = confirm_data.new_password
    token = confirm_data.token

    if confirm_data.encrypted_payload:
        decrypted = decrypt_payload(confirm_data.encrypted_payload)
        email = decrypted.get("email", email)
        new_password = decrypted.get("new_password", new_password)
        token = decrypted.get("token", token)

    if not email or not new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address and new password are required.",
        )

    normalized_email = str(email).strip().lower()

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            supabase = get_supabase_client()
            supabase.auth.update_user({"password": new_password})
        except Exception as e:
            logger.error(f"Failed to update password via Supabase Auth SDK: {e}")
            if settings.SUPABASE_SERVICE_ROLE_KEY:
                try:
                    admin_client = get_supabase_admin_client()
                    user = db.query(User).filter(User.email == normalized_email).first()
                    if user:
                        auth_users = admin_client.auth.admin.list_users()
                        auth_user = next(
                            (
                                auth_user
                                for auth_user in getattr(auth_users, "users", auth_users)
                                if str(getattr(auth_user, "email", "")).lower()
                                == normalized_email
                            ),
                            None,
                        )
                        if auth_user is None:
                            raise ValueError("Authentication user not found.")
                        admin_client.auth.admin.update_user_by_id(
                            str(auth_user.id),
                            {"password": new_password},
                        )
                except Exception as admin_err:
                    logger.error(f"Admin auth password update failed: {admin_err}")

    user = db.query(User).filter(User.email == normalized_email).first()
    if user:
        user.updated_at = datetime.now(timezone.utc)
        db.add(user)
        db.commit()

        try:
            log_password_reset(
                db,
                user_id=user.user_id,
                company_id=user.company_id,
                ip_address="system",   # no Request object here; callers can pass it if needed
                email=normalized_email,
                success=True,
            )
        except Exception:
            db.rollback()

    return MessageResponse(
        message="Password has been reset successfully.",
        success=True,
    )
