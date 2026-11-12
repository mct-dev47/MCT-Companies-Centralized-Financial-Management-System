import html
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import Request, HTTPException as FastAPIHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import settings

logger = logging.getLogger(__name__)

# Cooldown map for 500 crash notifications: signature -> last_alerted_monotonic_ts
_CRASH_ALERT_COOLDOWN_SECONDS = 300.0
_crash_alert_lock = threading.Lock()
_crash_alert_last_sent: dict[str, float] = {}
_last_resolved_admin_email: str = ""


def resolve_admin_email(db=None) -> str:
    """
    Dynamically resolve the primary admin email using the `is_admin` flag:
    1. Local/Postgres `users` table (`is_admin = True` or `role = 'admin'`)
    2. Supabase `users` table (`is_admin = True`)
    3. Last known cached `is_admin` email (survives temporary DB outages)
    4. Fallback to `settings.ADMIN_EMAIL` or `settings.BREVO_FROM_EMAIL`
    """
    global _last_resolved_admin_email
    close_db = False
    try:
        if db is None:
            from app.db.session import SessionLocal
            db = SessionLocal()
            close_db = True
        from app.models.user import User
        admin_user = (
            db.query(User)
            .filter(or_(User.is_admin.is_(True), User.role == "admin"))
            .order_by(User.is_admin.desc(), User.user_id.asc())
            .first()
        )
        if admin_user and getattr(admin_user, "email", None):
            resolved = str(admin_user.email).strip()
            if resolved:
                _last_resolved_admin_email = resolved
                return resolved
    except Exception as e:
        logger.debug("Could not resolve admin email from SQL session: %s", e)
    finally:
        if close_db and db is not None:
            try:
                db.close()
            except Exception:
                pass

    try:
        from app.db.supabase import get_supabase_admin_client
        sb = get_supabase_admin_client()
        if sb is not None:
            res = sb.table("users").select("email,is_admin,role").eq("is_admin", True).limit(1).execute()
            rows = getattr(res, "data", None) or []
            if rows and rows[0].get("email"):
                resolved = str(rows[0]["email"]).strip()
                if resolved:
                    _last_resolved_admin_email = resolved
                    return resolved
    except Exception as e:
        logger.debug("Could not resolve admin email from Supabase client: %s", e)

    return (
        (getattr(settings, "ADMIN_EMAIL", "") or "").strip()
        or _last_resolved_admin_email
        or (getattr(settings, "BREVO_FROM_EMAIL", "") or "").strip()
    )


def _record_and_send_crash_alert(
    request_id: str,
    method: str,
    path: str,
    client_ip: str,
    exc_type: str,
    error_category: str = "SERVER_CRASH",
) -> bool:
    """
    Persist a critical system crash audit log and send an email alert to the `is_admin` user.
    Enforces a per-endpoint/exception-type cooldown to prevent alert storms.
    Returns True if an alert was dispatched, False if suppressed by cooldown.
    """
    signature = f"{method}:{path}:{exc_type}"
    now_mono = time.monotonic()
    with _crash_alert_lock:
        last_ts = _crash_alert_last_sent.get(signature)
        if last_ts is not None and (now_mono - last_ts) < _CRASH_ALERT_COOLDOWN_SECONDS:
            return False
        _crash_alert_last_sent[signature] = now_mono

    admin_email = ""
    try:
        from app.db.session import SessionLocal
        from app.models.audit_log import AuditLog

        with SessionLocal() as db:
            admin_email = resolve_admin_email(db)
            log_entry = AuditLog(
                user_name="SYSTEM_MONITOR",
                user_role="system",
                action="SYSTEM_CRASH_500",
                action_category="SECURITY",
                module="SYSTEM",
                ip_address=client_ip,
                details={
                    "severity": "CRITICAL",
                    "error_category": error_category,
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "exception_type": exc_type,
                },
            )
            db.add(log_entry)
            db.commit()
    except Exception as db_err:
        logger.warning("Failed to persist crash alert audit log: %s", db_err)
        if not admin_email:
            admin_email = resolve_admin_email(None)

    if admin_email:
        try:
            from app.services.email_service import send_transactional_email

            ts_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            subject = f"[CRITICAL 500 ALERT] {method} {path} ({request_id})"
            html_body = (
                "<div style='font-family: sans-serif; padding: 20px; border: 1px solid #fecaca; border-radius: 8px;'>"
                "<h2 style='color: #dc2626; margin-top: 0;'>Unhandled Production Server Error (HTTP 500)</h2>"
                f"<p><strong>Request ID:</strong> <code>{html.escape(request_id)}</code></p>"
                f"<p><strong>Endpoint:</strong> <code>{html.escape(method)} {html.escape(path)}</code></p>"
                f"<p><strong>Category:</strong> {html.escape(error_category)} ({html.escape(exc_type)})</p>"
                f"<p><strong>Client IP:</strong> {html.escape(client_ip)}</p>"
                f"<p><strong>Timestamp:</strong> {html.escape(ts_str)}</p>"
                "</div>"
            )
            text_body = (
                f"CRITICAL 500 SERVER ALERT\n"
                f"Request ID: {request_id}\n"
                f"Endpoint: {method} {path}\n"
                f"Category: {error_category} ({exc_type})\n"
                f"Client IP: {client_ip}\n"
                f"Timestamp: {ts_str}\n"
            )
            send_transactional_email(
                recipient_email=admin_email,
                subject=subject,
                html_content=html_body,
                text_content=text_body,
                bypass_cooldown=True,
            )
        except Exception as mail_err:
            logger.warning("Failed to dispatch crash alert email to admin: %s", mail_err)

    return True


def _dispatch_admin_crash_alert_async(
    request_id: str,
    method: str,
    path: str,
    client_ip: str,
    exc: Exception,
    error_category: str = "SERVER_CRASH",
) -> None:
    if os.environ.get("TESTING") == "1":
        return
    exc_type = type(exc).__name__
    t = threading.Thread(
        target=_record_and_send_crash_alert,
        args=(request_id, method, path, client_ip, exc_type, error_category),
        name=f"crash-alert-{request_id[:8]}",
        daemon=True,
    )
    t.start()


def _extract_request_id(request: Request) -> str:
    req_id = getattr(request.state, "request_id", None)
    if not req_id:
        req_id = request.headers.get("x-request-id") or request.headers.get("X-Request-ID")
    if not req_id:
        from app.middleware.correlation import get_current_request_id
        req_id = get_current_request_id()
    return str(req_id)


def _infer_error_code(status_code: int, detail: Any) -> str:
    """Infers machine-readable error codes when not explicitly provided."""
    msg = str(detail).lower() if detail else ""
    if status_code == 401:
        if "otp" in msg or "verification" in msg or "code" in msg:
            return "OTP_INVALID"
        return "AUTH_INVALID_CREDENTIALS"
    if status_code == 429:
        if "cooldown" in msg or "wait" in msg and "before" in msg:
            return "OTP_COOLDOWN_ACTIVE"
        if "resend" in msg and ("limit" in msg or "locked" in msg):
            return "OTP_RESEND_LOCKED"
        if "verification attempts" in msg:
            return "OTP_MAX_ATTEMPTS"
        if "network" in msg or "device" in msg or "ip" in msg:
            return "AUTH_IP_RATE_LIMITED"
        if "login" in msg or "password" in msg:
            return "AUTH_RATE_LIMITED"
        return "API_RATE_LIMITED"
    if status_code == 502:
        if "verification" in msg or "otp" in msg or "code" in msg or "email" in msg:
            return "OTP_DELIVERY_FAILED"
        return "BAD_GATEWAY"
    if status_code == 503:
        return "SERVICE_UNAVAILABLE"
    if status_code == 400:
        if "token" in msg or "expired" in msg or "link" in msg:
            return "TOKEN_EXPIRED"
        return "BAD_REQUEST"
    if status_code == 403:
        return "FORBIDDEN"
    if status_code == 404:
        return "NOT_FOUND"
    if status_code == 409:
        return "CONFLICT"
    if status_code >= 500:
        return "INTERNAL_SERVER_ERROR"
    return "API_ERROR"


class RateLimitException(FastAPIHTTPException):
    def __init__(
        self,
        code: str,
        detail: str,
        retry_after: int,
        locked_until: Optional[str] = None,
        scope: Optional[str] = None,
        status_code: int = 429,
    ):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
        self.retry_after = retry_after
        self.locked_until = locked_until
        self.scope = scope


def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    request_id = _extract_request_id(request)
    headers = dict(exc.headers or {})
    headers["X-Request-ID"] = request_id

    is_prod = str(getattr(settings, "ENVIRONMENT", "development")).lower() == "production"
    # If already a structured dict
    if isinstance(exc.detail, dict):
        payload = dict(exc.detail)
        payload.setdefault("request_id", request_id)
        if exc.status_code >= 500 and is_prod:
            payload["detail"] = "An internal server error occurred. Please try again later."
        if "code" not in payload:
            payload["code"] = _infer_error_code(exc.status_code, payload.get("detail", ""))
        if "retry_after" in payload and payload["retry_after"]:
            headers["Retry-After"] = str(payload["retry_after"])
        return JSONResponse(status_code=exc.status_code, content=payload, headers=headers)

    detail_str = str(exc.detail) if exc.detail else "An error occurred."
    if exc.status_code >= 500 and is_prod:
        detail_str = "An internal server error occurred. Please try again later."
    code = getattr(exc, "code", None) or _infer_error_code(exc.status_code, detail_str)
    retry_after = getattr(exc, "retry_after", None)
    locked_until = getattr(exc, "locked_until", None)
    scope = getattr(exc, "scope", None)

    # Check for Retry-After header in exc.headers
    if retry_after is None and "Retry-After" in headers:
        try:
            retry_after = int(headers["Retry-After"])
        except ValueError:
            pass

    content: dict[str, Any] = {
        "code": code,
        "detail": detail_str,
        "request_id": request_id,
    }

    if retry_after is not None:
        content["retry_after"] = retry_after
        headers["Retry-After"] = str(retry_after)

    if locked_until is not None:
        content["locked_until"] = locked_until

    if scope is not None:
        content["scope"] = scope

    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers=headers,
    )


def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = _extract_request_id(request)
    headers = {"X-Request-ID": request_id}

    errors = [
        {
            "loc": list(err.get("loc", ())),
            "msg": str(err.get("msg", "Invalid value")),
            "type": str(err.get("type", "value_error")),
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "code": "VALIDATION_ERROR",
            "detail": "Invalid request parameters. Please verify your submission.",
            "errors": errors,
            "request_id": request_id,
        },
        headers=headers,
    )


def global_unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = _extract_request_id(request)
    headers = {"X-Request-ID": request_id}

    # Redact sensitive parameters from request url/headers when logging
    method = request.method
    path = request.url.path
    client_ip = request.client.host if request.client else "unknown"

    logger.exception(
        "Unhandled server exception: [%s] %s %s from IP %s. Exception: %s",
        request_id,
        method,
        path,
        client_ip,
        exc,
    )
    _dispatch_admin_crash_alert_async(request_id, method, path, client_ip, exc, error_category="SERVER_CRASH")

    return JSONResponse(
        status_code=500,
        content={
            "code": "INTERNAL_SERVER_ERROR",
            "detail": "Something went wrong. Please try again later.",
            "request_id": request_id,
        },
        headers=headers,
    )


def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    request_id = _extract_request_id(request)
    headers = {"X-Request-ID": request_id}
    method = request.method
    path = request.url.path
    client_ip = request.client.host if request.client else "unknown"

    logger.exception(
        "Database exception intercepted: [%s] %s %s from IP %s. Exception: %s",
        request_id,
        method,
        path,
        client_ip,
        exc,
    )
    _dispatch_admin_crash_alert_async(request_id, method, path, client_ip, exc, error_category="DATABASE_CRASH")

    return JSONResponse(
        status_code=500,
        content={
            "code": "DATABASE_ERROR",
            "detail": "A database error occurred. Please try again later.",
            "request_id": request_id,
        },
        headers=headers,
    )
