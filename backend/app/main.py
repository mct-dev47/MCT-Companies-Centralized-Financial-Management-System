import json
import threading
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router
from app.core.websocket import ws_manager
from app.core.errors import (
    validation_exception_handler,
    global_unhandled_exception_handler,
    http_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from app.core.logging_filter import setup_log_redaction
from app.middleware.correlation import RequestCorrelationMiddleware
from app.middleware.rate_limit_middleware import RateLimitingMiddleware
from app.middleware.request_limits import RequestSizeLimitMiddleware, RequestTimeoutMiddleware

setup_log_redaction()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Centralized financial management system backend for MCT Companies.",
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Standardized error responses and zero leakage
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
# Validation errors never echo the submitted values back (see app/core/errors.py)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
# Catch-all exception handler to prevent any secret or stack trace leakage in 500 errors
app.add_exception_handler(Exception, global_unhandled_exception_handler)

# CORS Middleware setup

# Save timing (speed plan, phase 0): every API write reports how long it took, in a
# Server-Timing header (visible in the browser's Network tab) and a log line, so slow saves can be measured.
import logging as _logging
import time as _time

_timing_logger = _logging.getLogger("app.timing")


@app.middleware("http")
async def report_write_timing(request, call_next):
    if request.method not in ("POST", "PUT", "PATCH", "DELETE") or not request.url.path.startswith("/api/"):
        return await call_next(request)
    started = _time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (_time.perf_counter() - started) * 1000
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    _timing_logger.info("%s %s -> %s in %.0f ms", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


# Cache prevention & security headers middleware
@app.middleware("http")
async def add_security_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "0"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self' data:; "
        "connect-src 'self' ws: wss: https:; "
        "frame-ancestors 'none';"
    )

    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    is_prod = str(getattr(settings, "ENVIRONMENT", "development")).lower() == "production"
    if is_https or is_prod:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestTimeoutMiddleware)
app.add_middleware(RequestSizeLimitMiddleware)
app.add_middleware(RateLimitingMiddleware)
app.add_middleware(RequestCorrelationMiddleware)

# Real-time WebSocket endpoint for instant multi-tab sync (requires authentication)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token and "authorization" in websocket.headers:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        else:
            token = auth_header.strip()

    if not token:
        # In-band authentication handshake: if token is not in query params or headers,
        # accept socket and await the initial authentication frame
        await websocket.accept()
        try:
            import asyncio
            auth_raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            auth_data = json.loads(auth_raw)
            if isinstance(auth_data, dict) and auth_data.get("type") == "auth":
                token = auth_data.get("token")
        except Exception:
            await websocket.close(code=1008)
            return

    if not token:
        await websocket.close(code=1008)
        return

    try:
        from app.core.security import verify_token
        claims = verify_token(token)
    except Exception:
        await websocket.close(code=1008)
        return

    try:
        await ws_manager.connect(websocket, claims=claims)
        await websocket.send_text(json.dumps({"type": "authenticated"}))
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except (WebSocketDisconnect, Exception):
        ws_manager.disconnect(websocket)

# Include API Router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.on_event("startup")
def on_startup():
    setup_log_redaction()
    import os
    if os.environ.get("TESTING") == "1":
        return
    from app.db.session import init_db
    init_db()

    try:
        import asyncio
        ws_manager._loop = asyncio.get_event_loop()
    except Exception:
        pass

    # Data retention policy: asynchronously purge activity logs older than 6 months (180 days)
    # and rate limit / OTP audit records older than 30 days (AC-24, AC-28)
    def _run_retention_purge():
        try:
            from app.services.activity_log_service import activity_log_service
            activity_log_service.cleanup_expired_logs(retention_days=180)
        except Exception:
            pass

        try:
            from app.db.session import SessionLocal
            from app.services.rate_limiter import rate_limiter
            from app.services.otp_service import otp_service
            session = SessionLocal()
            try:
                rate_limiter.cleanup_expired_records(session, retention_days=settings.OTP_AUDIT_RETENTION_DAYS)
                otp_service.cleanup_expired_challenges(session, retention_days=settings.OTP_AUDIT_RETENTION_DAYS)
            finally:
                session.close()
        except Exception:
            pass

    threading.Thread(target=_run_retention_purge, daemon=True, name="activity-retention-purge").start()

@app.get("/", tags=["Root"])
def root():
    return {
        "message": f"Welcome to {settings.PROJECT_NAME} API",
        "docs_url": "/docs",
        "health_check": f"{settings.API_V1_STR}/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
