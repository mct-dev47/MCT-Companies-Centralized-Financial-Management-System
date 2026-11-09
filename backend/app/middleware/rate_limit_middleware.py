import collections
import logging
import math
import time
from datetime import datetime, timezone
from typing import Deque, Dict
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.config import settings
from app.core.network import get_trusted_client_ip
from app.services.rate_limiter import rate_limiter, get_api_heavy_key

logger = logging.getLogger(__name__)

# In-memory sliding window counters per worker process for general API routes
_worker_sliding_windows: Dict[str, Deque[float]] = collections.defaultdict(collections.deque)

EXEMPT_PATHS = {
    "/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/v1/openapi.json",
    "/api/v1/health",
    "/health",
    "/ws",
}

HEAVY_ROUTE_KEYWORDS = (
    "/export",
    "/reports",
    "/calculate",
    "/reconciliation",
)


def _is_heavy_route(path: str) -> bool:
    lower_path = path.lower()
    return any(keyword in lower_path for keyword in HEAVY_ROUTE_KEYWORDS)


class RateLimitingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        path = request.url.path

        # 1. Exempt static/health/docs/websocket paths
        if path in EXEMPT_PATHS or path.startswith("/static") or path == "/ws":
            return await call_next(request)

        # Skip non-API paths if any
        if not path.startswith("/api/"):
            return await call_next(request)

        client_ip = get_trusted_client_ip(request)
        req_id = getattr(request.state, "request_id", None) or request.headers.get("x-request-id") or ""
        now_ts = time.time()
        now_dt = datetime.now(timezone.utc)

        # 2. Heavy routes: enforced via database rate limiting (AC-20)
        if _is_heavy_route(path):
            key, rate_type, identifier = get_api_heavy_key(client_ip)
            try:
                from app.db.session import SessionLocal
                session = SessionLocal()
                try:
                    is_locked, attempts, retry_after, locked_until = rate_limiter.record_attempt(
                        db=session,
                        key=key,
                        rate_type=rate_type,
                        identifier=identifier,
                        # record_attempt locks when attempts >= max_attempts, so add one to allow
                        # exactly HEAVY_API_RATE_LIMIT_PER_MINUTE requests and block the next one
                        max_attempts=settings.HEAVY_API_RATE_LIMIT_PER_MINUTE + 1,
                        window_minutes=1,
                        lockout_minutes=1,
                        now=now_dt,
                    )
                finally:
                    session.close()

                if is_locked:
                    retry_sec = max(1, retry_after)
                    return JSONResponse(
                        status_code=429,
                        content={
                            "code": "API_RATE_LIMITED",
                            "detail": "Heavy resource request limit exceeded. Please wait a moment.",
                            "request_id": req_id,
                            "retry_after": retry_sec,
                            "scope": "api_heavy",
                        },
                        headers={
                            "Retry-After": str(retry_sec),
                            "X-Request-ID": req_id,
                        },
                    )
            except Exception as exc:
                logger.error("Heavy route rate check failed: %s", exc)
                return JSONResponse(
                    status_code=503,
                    content={
                        "code": "SERVICE_UNAVAILABLE",
                        "detail": "Authentication service temporarily unavailable. Please try again.",
                        "request_id": req_id,
                    },
                    headers={"X-Request-ID": req_id},
                )

        # 3. General API routes: enforced via worker memory sliding window (AC-20)
        window = _worker_sliding_windows[client_ip]
        cutoff = now_ts - 60.0

        # Prune expired timestamps
        while window and window[0] < cutoff:
            window.popleft()

        limit = settings.API_RATE_LIMIT_PER_MINUTE
        if len(window) >= limit:
            oldest = window[0]
            retry_after = max(1, math.ceil(60.0 - (now_ts - oldest)))
            return JSONResponse(
                status_code=429,
                content={
                    "code": "API_RATE_LIMITED",
                    "detail": "Too many requests. Please slow down.",
                    "request_id": req_id,
                    "retry_after": retry_after,
                    "scope": "api_general",
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-Request-ID": req_id,
                },
            )

        window.append(now_ts)
        return await call_next(request)

