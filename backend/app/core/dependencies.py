from __future__ import annotations
from typing import Annotated, Any, TypedDict, Optional, List
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import verify_token
from app.db.session import get_db
from app.models.user import User

# authenticated user model
class AuthenticatedUser(TypedDict, total=False):
    auth_user_id: str
    user_id: int | None
    email: str | None
    name: str | None
    full_name: str | None
    company_id: int | None
    company_ids: list[int]
    is_admin: bool
    role: str
    status: str
    must_change_password: bool


VerifiedToken = Annotated[dict[str, Any], Depends(verify_token)]

def _optional_positive_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit() and int(value) > 0:
        return int(value)
    return None

# get the current authenticated user from the verified token claims and DB
def get_current_user(
    claims: VerifiedToken,
    request: Request = None,
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    metadata = claims.get("app_metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    company_id = _optional_positive_int(metadata.get("company_id"))
    is_admin = metadata.get("is_admin") is True
    role = str(metadata.get("role") or ("admin" if is_admin else "supervisor")).lower()
    email = claims.get("email") if isinstance(claims.get("email"), str) else None

    user_id = None
    company_ids = [company_id] if company_id else []

    if email:
        from app.core.company_resolver import normalize_email, normalize_company_id
        resolved_email = normalize_email(email)
        db_user = db.query(User).filter(func.lower(User.email) == resolved_email.lower()).first()
        if db_user:
            user_id = db_user.user_id
            is_admin = bool(db_user.is_admin or db_user.user_id == 1 or (db_user.role and db_user.role.lower() == "admin"))
            role = "admin" if is_admin else (db_user.role or "supervisor").lower()
            if role in ("company", "company employee"):
                role = "supervisor"
            assigned = [normalize_company_id(uc.company_id) for uc in db_user.user_companies if uc.company_id is not None]
            if not assigned and db_user.company_id:
                assigned = [normalize_company_id(db_user.company_id)]
            company_ids = [cid for cid in assigned if cid is not None]
            if company_ids:
                company_id = company_ids[0]
        else:
            # Check Supabase users table fallback
            try:
                from app.db.supabase import get_supabase_admin_client
                client = get_supabase_admin_client()
                supa_res = client.table("users").select("*").ilike("email", resolved_email).limit(1).execute()
                if supa_res.data:
                    su = supa_res.data[0]
                    user_id = su.get("user_id")
                    is_admin = bool(su.get("is_admin") is True or (su.get("role") and su.get("role").lower() == "admin") or user_id == 1)
                    role = "admin" if is_admin else (su.get("role") or "supervisor").lower()
                    if role in ("company", "company employee"):
                        role = "supervisor"
                    s_cid = normalize_company_id(su.get("company_id"))
                    if s_cid:
                        company_id = s_cid
                        company_ids = [s_cid]
            except Exception:
                pass

    user_status = "ACTIVE"
    must_change_password = False
    if db_user:
        user_status = str(getattr(db_user, "status", "ACTIVE") or "ACTIVE").upper()
        must_change_password = bool(getattr(db_user, "must_change_password", False))

    path = request.url.path if request and hasattr(request, "url") else ""
    is_whitelisted = path.endswith("/auth/me") or path.endswith("/auth/logout") or path.endswith("/auth/setup-password")
    if not is_whitelisted:
        if user_status == "LOCKED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is locked due to security policy. Please contact an administrator.",
            )
        if user_status == "SUSPENDED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account has been suspended. Please contact an administrator.",
            )
        if user_status == "PROVISIONED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account invitation is pending. You must set up your password before accessing resources.",
            )
        if user_status != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Account status '{user_status}' is not authorized to access system resources.",
            )
        if must_change_password:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password setup required before accessing application resources.",
            )

    from app.core.user_name_resolver import resolve_real_name
    real_name = None
    if db_user and (getattr(db_user, "name", None) or "").strip():
        real_name = str(db_user.name).strip()
    elif isinstance(claims.get("user_metadata"), dict):
        um = claims["user_metadata"]
        real_name = um.get("full_name") or um.get("name")
    if not real_name and claims.get("name"):
        real_name = claims.get("name")
    if not real_name:
        real_name = resolve_real_name(email)

    return {
        "auth_user_id": claims.get("sub", ""),
        "user_id": user_id,
        "email": email,
        "name": real_name,
        "full_name": real_name,
        "company_id": company_id,
        "company_ids": company_ids,
        "is_admin": is_admin,
        "role": role,
        "status": user_status,
        "must_change_password": must_change_password,
    }


CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]

# require an Audit or Administrator account (for audit actions where permitted)
def require_audit_or_admin_user(user: CurrentUser) -> AuthenticatedUser:
    role = str(user.get("role") or "").lower()
    if role not in ("audit", "auditor", "admin") and not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Audit or Admin accounts can change the audit status.",
        )
    return user


AuditOrAdminUser = Annotated[AuthenticatedUser, Depends(require_audit_or_admin_user)]

# require an Audit role account specifically
def require_auditor_user(user: CurrentUser) -> AuthenticatedUser:
    role = str(user.get("role") or "").lower()
    if role not in ("audit", "auditor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Auditor accounts can perform this audit review action.",
        )
    return user


AuditorUser = Annotated[AuthenticatedUser, Depends(require_auditor_user)]

# require the current authenticated user to be a central administrator account.
def require_admin_user(user: CurrentUser) -> AuthenticatedUser:
    if not user.get("is_admin") and user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Central administrator access is required.",
        )
    return user


AdminUser = Annotated[AuthenticatedUser, Depends(require_admin_user)]

# require Finance role
def require_finance_user(user: CurrentUser) -> AuthenticatedUser:
    role = str(user.get("role") or "").lower()
    if role != "finance":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance access is required.",
        )
    return user


FinanceUser = Annotated[AuthenticatedUser, Depends(require_finance_user)]

# require Finance or Administrator role
def require_finance_or_admin_user(user: CurrentUser) -> AuthenticatedUser:
    role = user.get("role", "").lower()
    if role not in ["finance", "admin"] and not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Finance or administrator access is required.",
        )
    return user


FinanceOrAdminUser = Annotated[AuthenticatedUser, Depends(require_finance_or_admin_user)]

# require Finance or Supervisor role for business record mutations (Admin and Auditor blocked)
def require_business_writer(user: CurrentUser) -> AuthenticatedUser:
    if user.get("is_admin") or user.get("role") == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator accounts manage system configuration and users only; business operations are reserved for Finance and Supervisors.",
        )
    role = str(user.get("role") or "").lower()
    if role == "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner accounts have read-only access to business records.",
        )
    if role in ("audit", "auditor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Auditor accounts have read-only access to business records.",
        )
    if role not in ("finance", "supervisor", "company"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Business mutation access requires Finance or Supervisor role.",
        )
    return user


BusinessWriter = Annotated[AuthenticatedUser, Depends(require_business_writer)]

# require business reader (Finance, Auditor, and Supervisor allowed; Admin blocked from business operations)
def require_business_reader(user: CurrentUser) -> AuthenticatedUser:
    if user.get("is_admin") or user.get("role") == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator accounts manage system configuration and users only; business operations are reserved for Finance and Supervisors.",
        )
    return user


BusinessReader = Annotated[AuthenticatedUser, Depends(require_business_reader)]

# require the current authenticated user to be a company account.
def require_company_user(user: CurrentUser) -> AuthenticatedUser:
    if (user.get("is_admin") or user.get("role") in ["audit", "admin"]) and user.get("company_id") is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Company account access is required.",
        )
    return user


CompanyUser = Annotated[AuthenticatedUser, Depends(require_company_user)]

# Company scope authorization checker
def check_company_access(user: AuthenticatedUser, target_company_id: int | None) -> None:
    """Ensure user has access to a specific company or is an administrator/finance/audit user."""
    if target_company_id is None:
        return
    from app.core.company_resolver import normalize_company_id
    normalized_target_id = normalize_company_id(target_company_id)

    role = str(user.get("role") or "").lower()
    if user.get("is_admin") or role in ("admin", "finance", "audit", "auditor", "owner"):
        return

    assigned = user.get("company_ids") or []
    assigned_normalized = {normalize_company_id(cid) for cid in assigned if cid is not None}
    if user.get("company_id"):
        assigned_normalized.add(normalize_company_id(user.get("company_id")))

    if normalized_target_id not in assigned_normalized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are not assigned to this company."
        )


def get_authorized_company_scope(
    user: AuthenticatedUser,
    requested_company_id: int | None = None,
) -> list[int] | None:
    """
    Resolve the authorized company IDs for querying:
    - Finance / Auditor: None (all companies) unless requested_company_id is specified.
    - Supervisor: Returns [requested_company_id] if assigned, or all assigned company IDs.
      Raises HTTP 403 Forbidden if requested_company_id is not assigned to the supervisor.
    """
    from app.core.company_resolver import normalize_company_id
    role = str(user.get("role") or "").lower()
    is_privileged = user.get("is_admin") or role in ("admin", "finance", "audit", "auditor", "owner")

    req_cid = normalize_company_id(requested_company_id) if requested_company_id is not None else None

    if is_privileged:
        return [req_cid] if req_cid is not None else None

    assigned = user.get("company_ids") or []
    assigned_normalized = [normalize_company_id(cid) for cid in assigned if cid is not None]
    if user.get("company_id"):
        p_cid = normalize_company_id(user.get("company_id"))
        if p_cid is not None and p_cid not in assigned_normalized:
            assigned_normalized.insert(0, p_cid)

    if not assigned_normalized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Your account is not assigned to any company."
        )

    if req_cid is not None:
        if req_cid not in assigned_normalized:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You are not assigned to this company."
            )
        return [req_cid]

    return assigned_normalized
