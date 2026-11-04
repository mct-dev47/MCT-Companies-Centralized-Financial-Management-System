"""
audit_service.py
----------------
Central service for recording audit log entries throughout the system.

Audit logs capture every significant user action (authentication events,
CRUD operations on financial records, user management, etc.) together with
the actor's IP address.  Logs are persisted to both the local SQLAlchemy
database and Supabase; they are **not** exposed through any public API
endpoint — only stored.

Usage (from any endpoint or service)
--------------------------------------
    from app.services.audit_service import log_action, AuditAction

    log_action(
        db=db,
        action=AuditAction.LOGIN_SUCCESS,
        user_id=current_user["user_id"],
        company_id=current_user.get("company_id"),
        ip_address=request.client.host,
        details="User logged in successfully",
    )
"""

from __future__ import annotations

import json
import logging
import threading
from enum import Enum
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.cache import system_cache
from app.db.supabase import get_supabase_admin_client
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Action catalogue
# Every auditable event in the system must have a corresponding constant here.
# Format convention:  <CATEGORY>_<VERB_OR_EVENT>
# ---------------------------------------------------------------------------

class AuditAction(str, Enum):
    # ── Authentication ───────────────────────────────────────────────────────
    LOGIN_ATTEMPT       = "LOGIN_ATTEMPT"
    LOGIN_SUCCESS       = "LOGIN_SUCCESS"
    LOGIN_FAILED        = "LOGIN_FAILED"
    LOGIN_OTP_SENT      = "LOGIN_OTP_SENT"
    LOGIN_OTP_VERIFIED  = "LOGIN_OTP_VERIFIED"
    LOGIN_OTP_FAILED    = "LOGIN_OTP_FAILED"
    LOGIN_OTP_RESENT    = "LOGIN_OTP_RESENT"
    LOGOUT              = "LOGOUT"
    SESSION_EXPIRED     = "SESSION_EXPIRED"
    ACCOUNT_LOCKED      = "ACCOUNT_LOCKED"

    # ── Password Management ──────────────────────────────────────────────────
    FORGOT_PASSWORD_REQUEST   = "FORGOT_PASSWORD_REQUEST"
    PASSWORD_RESET_SUCCESS    = "PASSWORD_RESET_SUCCESS"
    PASSWORD_RESET_FAILED     = "PASSWORD_RESET_FAILED"
    PASSWORD_CHANGED          = "PASSWORD_CHANGED"

    # ── User Management ──────────────────────────────────────────────────────
    USER_CREATED        = "USER_CREATED"
    USER_UPDATED        = "USER_UPDATED"
    USER_DELETED        = "USER_DELETED"
    USER_ROLE_CHANGED   = "USER_ROLE_CHANGED"
    USER_VIEWED         = "USER_VIEWED"

    # ── Company Management ───────────────────────────────────────────────────
    COMPANY_CREATED     = "COMPANY_CREATED"
    COMPANY_UPDATED     = "COMPANY_UPDATED"
    COMPANY_DELETED     = "COMPANY_DELETED"
    COMPANY_VIEWED      = "COMPANY_VIEWED"

    # ── Expenses ────────────────────────────────────────────────────────────
    EXPENSE_CREATED     = "EXPENSE_CREATED"
    EXPENSE_UPDATED     = "EXPENSE_UPDATED"
    EXPENSE_DELETED     = "EXPENSE_DELETED"
    EXPENSE_VIEWED      = "EXPENSE_VIEWED"

    # ── Sales ────────────────────────────────────────────────────────────────
    SALE_CREATED        = "SALE_CREATED"
    SALE_UPDATED        = "SALE_UPDATED"
    SALE_DELETED        = "SALE_DELETED"
    SALE_VIEWED         = "SALE_VIEWED"

    # ── Cash Inflows ─────────────────────────────────────────────────────────
    CASH_INFLOW_CREATED = "CASH_INFLOW_CREATED"
    CASH_INFLOW_UPDATED = "CASH_INFLOW_UPDATED"
    CASH_INFLOW_DELETED = "CASH_INFLOW_DELETED"
    CASH_INFLOW_VIEWED  = "CASH_INFLOW_VIEWED"

    # ── Loans ────────────────────────────────────────────────────────────────
    LOAN_CREATED        = "LOAN_CREATED"
    LOAN_UPDATED        = "LOAN_UPDATED"
    LOAN_DELETED        = "LOAN_DELETED"
    LOAN_VIEWED         = "LOAN_VIEWED"

    # ── Budgets ──────────────────────────────────────────────────────────────
    BUDGET_CREATED      = "BUDGET_CREATED"
    BUDGET_UPDATED      = "BUDGET_UPDATED"
    BUDGET_DELETED      = "BUDGET_DELETED"
    BUDGET_VIEWED       = "BUDGET_VIEWED"

    # ── Staff Credits ────────────────────────────────────────────────────────
    STAFF_CREDIT_CREATED = "STAFF_CREDIT_CREATED"
    STAFF_CREDIT_UPDATED = "STAFF_CREDIT_UPDATED"
    STAFF_CREDIT_DELETED = "STAFF_CREDIT_DELETED"
    STAFF_CREDIT_VIEWED  = "STAFF_CREDIT_VIEWED"

    # ── Petty Cash ───────────────────────────────────────────────────────────
    PETTY_CASH_TOPUP_CREATED = "PETTY_CASH_TOPUP_CREATED"
    PETTY_CASH_TOPUP_DELETED = "PETTY_CASH_TOPUP_DELETED"
    PETTY_CASH_WALLET_UPDATED = "PETTY_CASH_WALLET_UPDATED"

    # ── Tenant leases (spec 0017) ────────────────────────────────────────────
    TENANT_LEASE_CREATED   = "TENANT_LEASE_CREATED"
    TENANT_LEASE_UPDATED   = "TENANT_LEASE_UPDATED"
    TENANT_LEASE_DELETED   = "TENANT_LEASE_DELETED"
    TENANT_PAYMENT_RECORDED = "TENANT_PAYMENT_RECORDED"
    TENANT_PAYMENT_UPDATED = "TENANT_PAYMENT_UPDATED"
    TENANT_PAYMENT_REMOVED = "TENANT_PAYMENT_REMOVED"
    TENANT_AUDIT_REVIEWED  = "TENANT_AUDIT_REVIEWED"

    # ── Categories ───────────────────────────────────────────────────────────
    CATEGORY_CREATED    = "CATEGORY_CREATED"
    CATEGORY_UPDATED    = "CATEGORY_UPDATED"
    CATEGORY_DELETED    = "CATEGORY_DELETED"

    # ── Reports / Dashboards ─────────────────────────────────────────────────
    REPORT_VIEWED       = "REPORT_VIEWED"
    DASHBOARD_VIEWED    = "DASHBOARD_VIEWED"
    EXPORT_PERFORMED    = "EXPORT_PERFORMED"

    # ── System / General ────────────────────────────────────────────────────
    SYSTEM_ERROR        = "SYSTEM_ERROR"
    UNAUTHORIZED_ACCESS = "UNAUTHORIZED_ACCESS"
    PERMISSION_DENIED   = "PERMISSION_DENIED"


# Map each action to its broad category label (stored in action_category column)
_ACTION_CATEGORY_MAP: dict[str, str] = {
    # AUTH
    "LOGIN_ATTEMPT": "AUTH",
    "LOGIN_SUCCESS": "AUTH",
    "LOGIN_FAILED": "AUTH",
    "LOGIN_OTP_SENT": "AUTH",
    "LOGIN_OTP_VERIFIED": "AUTH",
    "LOGIN_OTP_FAILED": "AUTH",
    "LOGIN_OTP_RESENT": "AUTH",
    "LOGOUT": "AUTH",
    "SESSION_EXPIRED": "AUTH",
    "ACCOUNT_LOCKED": "AUTH",
    # PASSWORD
    "FORGOT_PASSWORD_REQUEST": "PASSWORD",
    "PASSWORD_RESET_SUCCESS": "PASSWORD",
    "PASSWORD_RESET_FAILED": "PASSWORD",
    "PASSWORD_CHANGED": "PASSWORD",
    # USER
    "USER_CREATED": "USER",
    "USER_UPDATED": "USER",
    "USER_DELETED": "USER",
    "USER_ROLE_CHANGED": "USER",
    "USER_VIEWED": "USER",
    # COMPANY
    "COMPANY_CREATED": "COMPANY",
    "COMPANY_UPDATED": "COMPANY",
    "COMPANY_DELETED": "COMPANY",
    "COMPANY_VIEWED": "COMPANY",
    # TRANSACTION
    "EXPENSE_CREATED": "TRANSACTION",
    "EXPENSE_UPDATED": "TRANSACTION",
    "EXPENSE_DELETED": "TRANSACTION",
    "EXPENSE_VIEWED": "TRANSACTION",
    "SALE_CREATED": "TRANSACTION",
    "SALE_UPDATED": "TRANSACTION",
    "SALE_DELETED": "TRANSACTION",
    "SALE_VIEWED": "TRANSACTION",
    "CASH_INFLOW_CREATED": "TRANSACTION",
    "CASH_INFLOW_UPDATED": "TRANSACTION",
    "CASH_INFLOW_DELETED": "TRANSACTION",
    "CASH_INFLOW_VIEWED": "TRANSACTION",
    "LOAN_CREATED": "LOAN",
    "LOAN_UPDATED": "LOAN",
    "LOAN_DELETED": "LOAN",
    "LOAN_VIEWED": "LOAN",
    "BUDGET_CREATED": "BUDGET",
    "BUDGET_UPDATED": "BUDGET",
    "BUDGET_DELETED": "BUDGET",
    "BUDGET_VIEWED": "BUDGET",
    "STAFF_CREDIT_CREATED": "STAFF_CREDIT",
    "STAFF_CREDIT_UPDATED": "STAFF_CREDIT",
    "STAFF_CREDIT_DELETED": "STAFF_CREDIT",
    "STAFF_CREDIT_VIEWED": "STAFF_CREDIT",
    "PETTY_CASH_TOPUP_CREATED": "PETTY_CASH",
    "PETTY_CASH_TOPUP_DELETED": "PETTY_CASH",
    "PETTY_CASH_WALLET_UPDATED": "PETTY_CASH",
    "TENANT_LEASE_CREATED": "TENANT",
    "TENANT_LEASE_UPDATED": "TENANT",
    "TENANT_LEASE_DELETED": "TENANT",
    "TENANT_PAYMENT_RECORDED": "TENANT",
    "TENANT_PAYMENT_UPDATED": "TENANT",
    "TENANT_PAYMENT_REMOVED": "TENANT",
    "TENANT_AUDIT_REVIEWED": "TENANT",
    "CATEGORY_CREATED": "CATEGORY",
    "CATEGORY_UPDATED": "CATEGORY",
    "CATEGORY_DELETED": "CATEGORY",
    # REPORTS
    "REPORT_VIEWED": "REPORT",
    "DASHBOARD_VIEWED": "REPORT",
    "EXPORT_PERFORMED": "REPORT",
    # SYSTEM
    "SYSTEM_ERROR": "SYSTEM",
    "UNAUTHORIZED_ACCESS": "SYSTEM",
    "PERMISSION_DENIED": "SYSTEM",
}


# ---------------------------------------------------------------------------
# Human-readable action descriptions
# ---------------------------------------------------------------------------

_ACTION_DESCRIPTION_MAP: dict[str, str] = {
    "LOGIN_ATTEMPT":           "User attempted to log in",
    "LOGIN_SUCCESS":           "User logged in successfully",
    "LOGIN_FAILED":            "User login attempt failed",
    "LOGIN_OTP_SENT":          "Login OTP code sent to user",
    "LOGIN_OTP_VERIFIED":      "Login OTP verified successfully",
    "LOGIN_OTP_FAILED":        "Login OTP verification failed",
    "LOGIN_OTP_RESENT":        "Login OTP resent to user",
    "LOGOUT":                  "User logged out",
    "SESSION_EXPIRED":         "User session expired",
    "ACCOUNT_LOCKED":          "Account temporarily locked due to failed attempts",
    "FORGOT_PASSWORD_REQUEST": "Password reset requested",
    "PASSWORD_RESET_SUCCESS":  "Password reset completed successfully",
    "PASSWORD_RESET_FAILED":   "Password reset attempt failed",
    "PASSWORD_CHANGED":        "User changed their password",
    "USER_CREATED":            "New user account created",
    "USER_UPDATED":            "User account updated",
    "USER_DELETED":            "User account deleted",
    "USER_ROLE_CHANGED":       "User role/permissions changed",
    "USER_VIEWED":             "User account details viewed",
    "COMPANY_CREATED":         "New company created",
    "COMPANY_UPDATED":         "Company details updated",
    "COMPANY_DELETED":         "Company deleted",
    "COMPANY_VIEWED":          "Company details viewed",
    "EXPENSE_CREATED":         "New expense record created",
    "EXPENSE_UPDATED":         "Expense record updated",
    "EXPENSE_DELETED":         "Expense record deleted",
    "EXPENSE_VIEWED":          "Expense record(s) viewed",
    "SALE_CREATED":            "New sale record created",
    "SALE_UPDATED":            "Sale record updated",
    "SALE_DELETED":            "Sale record deleted",
    "SALE_VIEWED":             "Sale record(s) viewed",
    "CASH_INFLOW_CREATED":     "New cash inflow record created",
    "CASH_INFLOW_UPDATED":     "Cash inflow record updated",
    "CASH_INFLOW_DELETED":     "Cash inflow record deleted",
    "CASH_INFLOW_VIEWED":      "Cash inflow record(s) viewed",
    "LOAN_CREATED":            "New loan record created",
    "LOAN_UPDATED":            "Loan record updated",
    "LOAN_DELETED":            "Loan record deleted",
    "LOAN_VIEWED":             "Loan record(s) viewed",
    "BUDGET_CREATED":          "New budget created",
    "BUDGET_UPDATED":          "Budget updated",
    "BUDGET_DELETED":          "Budget deleted",
    "BUDGET_VIEWED":           "Budget(s) viewed",
    "STAFF_CREDIT_CREATED":    "New staff credit created",
    "STAFF_CREDIT_UPDATED":    "Staff credit updated",
    "STAFF_CREDIT_DELETED":    "Staff credit deleted",
    "STAFF_CREDIT_VIEWED":     "Staff credit(s) viewed",
    "PETTY_CASH_TOPUP_CREATED": "Petty cash topped up from sales",
    "PETTY_CASH_TOPUP_DELETED": "Petty cash top-up removed",
    "PETTY_CASH_WALLET_UPDATED": "Petty cash wallet settings updated",
    "TENANT_LEASE_CREATED":    "Tenant lease created",
    "TENANT_LEASE_UPDATED":    "Tenant lease updated",
    "TENANT_LEASE_DELETED":    "Tenant lease deleted",
    "TENANT_PAYMENT_RECORDED": "Tenant payment recorded",
    "TENANT_PAYMENT_UPDATED":  "Tenant payment edited",
    "TENANT_PAYMENT_REMOVED":  "Tenant payment removed",
    "TENANT_AUDIT_REVIEWED":   "Tenant lease audit review saved",
    "CATEGORY_CREATED":        "New category created",
    "CATEGORY_UPDATED":        "Category updated",
    "CATEGORY_DELETED":        "Category deleted",
    "REPORT_VIEWED":           "Financial report viewed",
    "DASHBOARD_VIEWED":        "Dashboard viewed",
    "EXPORT_PERFORMED":        "Data export performed",
    "SYSTEM_ERROR":            "System error occurred",
    "UNAUTHORIZED_ACCESS":     "Unauthorized access attempt detected",
    "PERMISSION_DENIED":       "Permission denied for requested action",
}


# ---------------------------------------------------------------------------
# Core logging function
# ---------------------------------------------------------------------------

def log_action(
    db: Optional[Session] = None,
    action: AuditAction | str = AuditAction.LOGIN_ATTEMPT,
    *,
    user_id: Optional[int] = None,
    company_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    details: Optional[Any] = None,
) -> None:
    """
    Record an audit log entry via event-driven architecture.
    Dispatches an ActivityEvent asynchronously so callers are never blocked.
    """
    from app.core.events import dispatch_activity_event

    action_str = action.value if isinstance(action, AuditAction) else str(action)
    action_category = _ACTION_CATEGORY_MAP.get(action_str, "GENERAL")

    dispatch_activity_event(
        action=action_str,
        action_category=action_category,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details=details,
        sync=False,
    )



# ---------------------------------------------------------------------------
# Convenience wrappers — thin helpers so callers don't need to import the enum
# ---------------------------------------------------------------------------

def log_login_attempt(db: Session, *, ip_address: str, email: str) -> None:
    """Log a login attempt (before credentials are validated)."""
    log_action(
        db,
        AuditAction.LOGIN_ATTEMPT,
        ip_address=ip_address,
        details={"email": email},
    )


def log_login_success(
    db: Session,
    *,
    user_id: int,
    company_id: Optional[int],
    ip_address: str,
    email: str,
) -> None:
    """Log a successful login (after OTP is verified)."""
    log_action(
        db,
        AuditAction.LOGIN_SUCCESS,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details={"email": email},
    )


def log_login_failed(db: Session, *, ip_address: str, email: str, reason: str = "") -> None:
    """Log a failed login attempt."""
    log_action(
        db,
        AuditAction.LOGIN_FAILED,
        ip_address=ip_address,
        details={"email": email, "reason": reason},
    )


def log_otp_sent(db: Session, *, ip_address: str, email: str) -> None:
    """Log that an OTP was sent to the user."""
    log_action(
        db,
        AuditAction.LOGIN_OTP_SENT,
        ip_address=ip_address,
        details={"email": email},
    )


def log_otp_verified(
    db: Session,
    *,
    user_id: int,
    company_id: Optional[int],
    ip_address: str,
    email: str,
) -> None:
    """Log a successful OTP verification."""
    log_action(
        db,
        AuditAction.LOGIN_OTP_VERIFIED,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details={"email": email},
    )


def log_otp_failed(db: Session, *, ip_address: str, email: str) -> None:
    """Log a failed OTP attempt."""
    log_action(
        db,
        AuditAction.LOGIN_OTP_FAILED,
        ip_address=ip_address,
        details={"email": email},
    )


def log_otp_resent(db: Session, *, ip_address: str, email: str) -> None:
    """Log that an OTP was resent."""
    log_action(
        db,
        AuditAction.LOGIN_OTP_RESENT,
        ip_address=ip_address,
        details={"email": email},
    )


def log_logout(
    db: Session,
    *,
    user_id: Optional[int],
    company_id: Optional[int],
    ip_address: str,
) -> None:
    """Log a logout event."""
    log_action(
        db,
        AuditAction.LOGOUT,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
    )


def log_account_locked(db: Session, *, ip_address: str, email: str) -> None:
    """Log that an account was temporarily locked."""
    log_action(
        db,
        AuditAction.ACCOUNT_LOCKED,
        ip_address=ip_address,
        details={"email": email},
    )


def log_forgot_password(db: Session, *, ip_address: str, email: str) -> None:
    """Log a forgot-password request."""
    log_action(
        db,
        AuditAction.FORGOT_PASSWORD_REQUEST,
        ip_address=ip_address,
        details={"email": email},
    )


def log_password_reset(
    db: Session,
    *,
    user_id: Optional[int],
    company_id: Optional[int],
    ip_address: str,
    email: str,
    success: bool = True,
) -> None:
    """Log a password reset attempt."""
    action = AuditAction.PASSWORD_RESET_SUCCESS if success else AuditAction.PASSWORD_RESET_FAILED
    log_action(
        db,
        action,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details={"email": email},
    )


def log_password_changed(
    db: Session,
    *,
    user_id: int,
    company_id: Optional[int],
    ip_address: str,
) -> None:
    """Log a deliberate password change by the user."""
    log_action(
        db,
        AuditAction.PASSWORD_CHANGED,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
    )


def log_transaction(
    db: Session,
    action: AuditAction,
    *,
    user_id: Optional[int],
    company_id: Optional[int],
    ip_address: str,
    record_id: Optional[int] = None,
    record_type: Optional[str] = None,
    extra: Optional[dict] = None,
) -> None:
    """
    Generic helper for financial transaction audit events
    (expenses, sales, cash inflows, loans, budgets, staff credits).
    """
    details: dict[str, Any] = {}
    if record_id is not None:
        details["record_id"] = record_id
    if record_type is not None:
        details["record_type"] = record_type
    if extra:
        details.update(extra)

    log_action(
        db,
        action,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details=details if details else None,
    )


def log_user_management(
    db: Session,
    action: AuditAction,
    *,
    actor_user_id: Optional[int],
    target_user_id: Optional[int],
    company_id: Optional[int],
    ip_address: str,
    extra: Optional[dict] = None,
) -> None:
    """Log user management actions (create, update, delete, role change)."""
    details: dict[str, Any] = {}
    if target_user_id is not None:
        details["target_user_id"] = target_user_id
    if extra:
        details.update(extra)

    log_action(
        db,
        action,
        user_id=actor_user_id,
        company_id=company_id,
        ip_address=ip_address,
        details=details if details else None,
    )


def log_company_management(
    db: Session,
    action: AuditAction,
    *,
    user_id: Optional[int],
    company_id: Optional[int],
    ip_address: str,
    extra: Optional[dict] = None,
) -> None:
    """Log company management actions (create, update, delete)."""
    details: dict[str, Any] = {}
    if company_id is not None:
        details["company_id"] = company_id
    if extra:
        details.update(extra)

    log_action(
        db,
        action,
        user_id=user_id,
        company_id=company_id,
        ip_address=ip_address,
        details=details if details else None,
    )
