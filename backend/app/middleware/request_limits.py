import asyncio
import json
import logging
from typing import Set

logger = logging.getLogger(__name__)

MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024  # 10 MB
REQUEST_TIMEOUT_SECONDS = 30.0

EXEMPT_TIMEOUT_PATHS = {
    "",
    "/",
    "/ws",
    "/health",
    "/api/v1/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/v1/openapi.json",
}


class PayloadTooLargeException(Exception):
    """Internal sentinel raised when accumulated streamed body bytes exceed allowed limit."""
    pass


class RequestSizeLimitMiddleware:
    """
    Pure ASGI middleware that rejects incoming HTTP requests exceeding MAX_REQUEST_BODY_BYTES (10 MB).
    Inspects both Content-Length headers and chunked streamed request bodies.
    """
    def __init__(self, app, max_bytes: int = MAX_REQUEST_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def _send_413(self, send):
        response_body = json.dumps({
            "code": "REQUEST_ENTITY_TOO_LARGE",
            "detail": f"Request body exceeds maximum allowed size of {self.max_bytes // (1024 * 1024)} MB.",
        }).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(response_body)).encode("latin1")),
            ],
        })
        await send({
            "type": "http.response.body",
            "body": response_body,
        })

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        content_length = None
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    content_length = int(value.decode("latin1"))
                except ValueError:
                    pass
                break

        if content_length is not None and content_length > self.max_bytes:
            return await self._send_413(send)

        received_bytes = 0

        async def tracking_receive():
            nonlocal received_bytes
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body", b"")
                received_bytes += len(body)
                if received_bytes > self.max_bytes:
                    raise PayloadTooLargeException()
            return message

        try:
            return await self.app(scope, tracking_receive, send)
        except PayloadTooLargeException:
            return await self._send_413(send)


class RequestTimeoutMiddleware:
    """
    Pure ASGI middleware that aborts requests exceeding REQUEST_TIMEOUT_SECONDS (30s) with HTTP 504.
    Exempts WebSocket connections, static files, and health checks.
    Guards against duplicate http.response.start emissions if the downstream response already started.
    """
    def __init__(self, app, timeout_seconds: float = REQUEST_TIMEOUT_SECONDS):
        self.app = app
        self.timeout_seconds = timeout_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        raw_path = scope.get("path", "")
        norm_path = raw_path.rstrip("/")
        if norm_path in EXEMPT_TIMEOUT_PATHS or raw_path in EXEMPT_TIMEOUT_PATHS or raw_path.startswith("/static"):
            return await self.app(scope, receive, send)

        response_started = False

        async def guarded_send(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            return await asyncio.wait_for(
                self.app(scope, receive, guarded_send),
                timeout=self.timeout_seconds,
            )
        except asyncio.TimeoutError:
            logger.warning("Request execution timed out after %.1fs: %s %s", self.timeout_seconds, scope.get("method"), raw_path)
            if not response_started:
                response_body = json.dumps({
                    "code": "GATEWAY_TIMEOUT",
                    "detail": f"Request execution timed out after {self.timeout_seconds:.0f} seconds.",
                }).encode("utf-8")
                await send({
                    "type": "http.response.start",
                    "status": 504,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(response_body)).encode("latin1")),
                    ],
                })
                await send({
                    "type": "http.response.body",
                    "body": response_body,
                })
            else:
                # Downstream response already began streaming headers/body, close stream gracefully
                await send({
                    "type": "http.response.body",
                    "body": b"",
                    "more_body": False,
                })
