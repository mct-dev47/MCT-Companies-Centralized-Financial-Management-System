from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.core.dependencies import get_current_user, AuthenticatedUser
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
    result, cookie = login_user(db=db, login_data=login_data, ip_address=request.client.host if request.client else "unknown")
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
    result = verify_login_otp(db=db, otp_data=otp_data, ip_address=request.client.host if request.client else "unknown", cookie_value=request.cookies.get("mct_login_otp"))
    response.delete_cookie("mct_login_otp")
    return result

@router.post("/login/resend-otp", response_model=OtpResponse, summary="Resend Login OTP")
def resend_otp(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    result, cookie = resend_login_otp(db=db, ip_address=request.client.host if request.client else "unknown", cookie_value=request.cookies.get("mct_login_otp"))
    is_secure = settings.OTP_COOKIE_SECURE or (settings.ENVIRONMENT.lower() == "production")
    response.set_cookie("mct_login_otp", cookie, httponly=True, secure=is_secure, samesite="lax", max_age=settings.OTP_EXPIRES_SECONDS)
    return result

# logout user
@router.post("/logout", response_model=MessageResponse, summary="User Logout")
def logout(
    request: Request,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
    token: str = Depends(get_access_token),
):
    ip = request.client.host if request.client else "unknown"
    result = logout_user(
        db=db,
        token=token,
        user_id=int(current_user["auth_user_id"]) if current_user["auth_user_id"] else None,
        company_id=current_user.get("company_id"),
        ip_address=ip,
    )
    revoke_access_token(token)
    return result

# get current user profile
@router.get("/me", response_model=UserResponse, summary="Get Current User Profile")
def get_me(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    user_id = int(current_user["auth_user_id"])
    return get_current_user_info(db=db, user_id=user_id)

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
    db: Session = Depends(get_db),
):
    return reset_password(
        db=db,
        confirm_data=request,
    )

@router.post("/setup-password", response_model=MessageResponse, summary="Set Password from Invitation Token")
def setup_password(
    data: SetupPasswordRequest,
    db: Session = Depends(get_db),
):
    token = data.token
    new_password = data.new_password
    if data.encrypted_payload:
        from app.core.encryption import decrypt_payload
        decrypted = decrypt_payload(data.encrypted_payload)
        token = decrypted.get("token", token)
        new_password = decrypted.get("new_password", new_password)
    return setup_invitation_password(db=db, token=token, new_password=new_password)
