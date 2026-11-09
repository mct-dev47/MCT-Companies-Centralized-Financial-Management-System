import logging
import secrets
from typing import Optional, Any
from fastapi import Request, HTTPException as FastAPIHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


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

    # If already a structured dict
    if isinstance(exc.detail, dict):
        payload = dict(exc.detail)
        payload.setdefault("request_id", request_id)
        if "code" not in payload:
            payload["code"] = _infer_error_code(exc.status_code, payload.get("detail", ""))
        if "retry_after" in payload and payload["retry_after"]:
            headers["Retry-After"] = str(payload["retry_after"])
        return JSONResponse(status_code=exc.status_code, content=payload, headers=headers)

    detail_str = str(exc.detail) if exc.detail else "An error occurred."
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

    return JSONResponse(
        status_code=500,
        content={
            "code": "INTERNAL_SERVER_ERROR",
            "detail": "Something went wrong. Please try again later.",
            "request_id": request_id,
        },
        headers=headers,
    )
