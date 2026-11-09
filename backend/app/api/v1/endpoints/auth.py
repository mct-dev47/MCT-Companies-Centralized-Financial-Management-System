from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.supabase import get_supabase_client
from app.core.config import settings
from app.core.dependencies import get_current_user, AuthenticatedUser
from app.core.network import get_trusted_client_ip
from app.core.security import get_access_token, revoke_access_token
from app.schemas.auth import (
    LoginRequest,
    LoginChallengeResponse,
    VerifyOtpRequest,
    OtpResponse,
    TokenResponse,
    PasswordResetRequest,
    PasswordResetConfirm,
    MessageResponse,
    SetupPasswordRequest,
    ReauthenticateRequest,
    ReauthenticateResponse,
    TokenValidateRequest,
    TokenValidateResponse,
)
from app.schemas.user import UserResponse
from app.services.auth_service import (
    login_user,
    logout_user,
    get_current_user_info,
    request_password_reset,
    reset_password,
    verify_login_otp,
    resend_login_otp,
    setup_invitation_password,
    validate_invitation_token,
)
from app.services.session_service import (
    set_refresh_cookie,
    clear_refresh_cookie,
    verify_csrf_header,
    verify_refresh_cookie,
    rotate_refresh_token,
    revoke_session,
    create_reauth_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# login user
@router.post("/login", response_model=LoginChallengeResponse, summary="User Login")
def login(
    login_data: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    client_ip = get_trusted_client_ip(request)
    result, cookie = login_user(db=db, login_data=login_data, ip_address=client_ip)
    is_secure = settings.OTP_COOKIE_SECURE or (settings.ENVIRONMENT.lower() == "production")
    response.set_cookie("mct_login_otp", cookie, httponly=True, secure=is_secure, samesite="lax", max_age=settings.OTP_EXPIRES_SECONDS)
    return result

@router.post("/login/verify-otp", response_model=TokenResponse, summary="Verify Login OTP")
def verify_otp(
    otp_data: VerifyOtpRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    client_ip = get_trusted_client_ip(request)
    result, refresh_cookie, remember_me = verify_login_otp(
        db=db,
        otp_data=otp_data,
        ip_address=client_ip,
        cookie_value=request.cookies.get("mct_login_otp"),
    )
    response.delete_cookie("mct_login_otp")
    set_refresh_cookie(response=response, cookie_value=refresh_cookie, remember_me=remember_me)
    return result

@router.post("/login/resend-otp", response_model=OtpResponse, summary="Resend Login OTP")
def resend_otp(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    client_ip = get_trusted_client_ip(request)
    result, cookie = resend_login_otp(
        db=db,
        ip_address=client_ip,
        cookie_value=request.cookies.get("mct_login_otp"),
    )
    is_secure = settings.OTP_COOKIE_SECURE or (settings.ENVIRONMENT.lower() == "production")
    response.set_cookie("mct_login_otp", cookie, httponly=True, secure=is_secure, samesite="lax", max_age=settings.OTP_EXPIRES_SECONDS)
    return result

@router.get("/rate-limit-status", summary="Check Rate Limit and Cooldown Status")
def get_rate_limit_status(
    request: Request,
    email: Optional[str] = None,
    scope: Optional[str] = None,
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services.rate_limiter import rate_limiter, get_login_combo_key, get_login_ip_key
    from app.services.otp_service import otp_service
    from app.core.encryption import decrypt_payload

    client_ip = get_trusted_client_ip(request)
    now = datetime.now(timezone.utc)
    resend_cooldown = 0
    resend_locked = False
    resend_retry_after = 0

    # Check OTP challenge cookie if present
    cookie_val = request.cookies.get("mct_login_otp")
    if cookie_val:
        try:
            challenge = decrypt_payload(cookie_val)
            cid = challenge.get("challenge_id")
            if cid:
                c_status = otp_service.get_challenge_status(db, cid, client_ip, now=now)
                resend_cooldown = c_status.get("cooldown_remaining", 0)
                resend_locked = c_status.get("resend_locked", False)
                resend_retry_after = c_status.get("resend_retry_after", 0)
        except Exception:
            pass

    # Check login rate limit status (email + IP combo, or IP)
    is_locked = False
    retry_after = 0
    locked_until_str = None

    if email:
        from app.core.company_resolver import normalize_email
        combo_key, _, _ = get_login_combo_key(normalize_email(email), client_ip)
        combo_status = rate_limiter.get_status(db, combo_key, now=now)
        if combo_status.get("locked"):
            is_locked = True
            retry_after = combo_status.get("retry_after", 0)
            locked_until_str = combo_status.get("locked_until")

    if not is_locked:
        ip_key, _, _ = get_login_ip_key(client_ip)
        ip_status = rate_limiter.get_status(db, ip_key, now=now)
        if ip_status.get("locked"):
            is_locked = True
            retry_after = ip_status.get("retry_after", 0)
            locked_until_str = ip_status.get("locked_until")

    return {
        "locked": is_locked,
        "retry_after": retry_after,
        "locked_until": locked_until_str,
        "cooldown_remaining": resend_cooldown,
        "resend_locked": resend_locked,
        "resend_retry_after": resend_retry_after,
    }

@router.post("/refresh", response_model=TokenResponse, summary="Refresh Access Token and Rotate Refresh Cookie")
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    # AC-11: CSRF protection
    verify_csrf_header(request)

    cookie_value = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    verification = verify_refresh_cookie(cookie_value=cookie_value, db=db)

    if verification.get("is_grace_hit"):
        cached = verification["cached_result"]
        remember_me_val = bool(cached.get("remember_me", False))
        set_refresh_cookie(response, cached["cookie_value"], remember_me_val)
        return TokenResponse(access_token=cached["access_token"], user=cached["user_info"], remember_me=remember_me_val)

    old_payload = verification["payload"]
    user = verification["user"]
    remember_me_val = bool(old_payload.get("remember_me", False))

    new_cookie_value, access_token, user_info = rotate_refresh_token(
        old_payload=old_payload,
        user=user,
        db=db,
    )

    set_refresh_cookie(response, new_cookie_value, remember_me_val)
    return TokenResponse(access_token=access_token, user=user_info, remember_me=remember_me_val)

# logout user
@router.post("/logout", response_model=MessageResponse, summary="User Logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    # AC-11: CSRF protection
    verify_csrf_header(request)

    ip = request.client.host if request.client else "unknown"
    cookie_value = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    sid = None
    family_id = None
    nonce = None
    user_id = None

    if cookie_value:
        try:
            from app.core.encryption import decrypt_payload
            payload = decrypt_payload(cookie_value)
            sid = payload.get("sid")
            family_id = payload.get("family_id")
            nonce = payload.get("nonce")
            user_id = payload.get("user_id")
        except Exception:
            pass

    # Revoke session in session_service and revoked_tokens table (AC-10)
    revoke_session(db=db, sid=sid, family_id=family_id, nonce=nonce, user_id=user_id)
    clear_refresh_cookie(response)

    # If Bearer token is provided, revoke it as well
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        try:
            revoke_access_token(token, db=db)
        except Exception:
            pass

    try:
        logout_user(db=db, token=None, user_id=user_id, ip_address=ip)
    except Exception:
        pass

    return MessageResponse(message="Successfully logged out.", success=True)

# get current user profile
@router.get("/me", response_model=UserResponse, summary="Get Current User Profile")
def get_me(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    user_id = int(current_user["auth_user_id"])
    return get_current_user_info(db=db, user_id=user_id)

# fresh reauthentication for sensitive actions (AC-16)
@router.post("/reauthenticate", response_model=ReauthenticateResponse, summary="Sensitive Action Reauthentication")
def reauthenticate(
    request_data: ReauthenticateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    password = request_data.password
    if request_data.encrypted_payload:
        from app.core.encryption import decrypt_payload
        decrypted = decrypt_payload(request_data.encrypted_payload)
        password = decrypted.get("password", password)

    if not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password is required for reauthentication.",
        )

    email = current_user.get("email")
    user_id = int(current_user.get("user_id") or current_user.get("auth_user_id") or 0)

    authenticated = False
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            supabase = get_supabase_client()
            auth_res = supabase.auth.sign_in_with_password({
                "email": email,
                "password": password,
            })
            authenticated = bool(auth_res and auth_res.session)
        except Exception:
            authenticated = False

    if not authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password.",
        )

    token, expires_in = create_reauth_token(user_id=user_id)
    return ReauthenticateResponse(reauth_token=token, expires_in=expires_in, success=True)

# validate invitation or reset token on link opening (AC-20, AC-22)
@router.post("/tokens/validate", response_model=TokenValidateResponse, summary="Validate Token Authenticity and Purpose")
def validate_token(
    data: TokenValidateRequest,
    db: Session = Depends(get_db),
):
    token = data.token
    if data.encrypted_payload:
        from app.core.encryption import decrypt_payload
        decrypted = decrypt_payload(data.encrypted_payload)
        token = decrypted.get("token", token)
    return validate_invitation_token(db=db, token=token)

# request password reset
@router.post("/forgot-password", response_model=MessageResponse, summary="Request Password Reset")
def forgot_password(
    request: Request,
    reset_request: PasswordResetRequest,
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    return request_password_reset(db=db, request_data=reset_request, ip_address=ip)

# reset password
@router.post("/reset-password", response_model=MessageResponse, summary="Confirm Password Reset")
def confirm_password_reset(
    request: PasswordResetConfirm,
    req: Request,
    db: Session = Depends(get_db),
):
    client_ip = get_trusted_client_ip(req)
    return reset_password(
        db=db,
        confirm_data=request,
        ip_address=client_ip,
    )

@router.post("/setup-password", response_model=MessageResponse, summary="Set Password from Invitation Token")
def setup_password(
    data: SetupPasswordRequest,
    req: Request,
    db: Session = Depends(get_db),
):
    client_ip = get_trusted_client_ip(req)
    token = data.token
    new_password = data.new_password
    if data.encrypted_payload:
        from app.core.encryption import decrypt_payload
        decrypted = decrypt_payload(data.encrypted_payload)
        token = decrypted.get("token", token)
        new_password = decrypted.get("new_password", new_password)
    return setup_invitation_password(db=db, token=token, new_password=new_password, ip_address=client_ip)
