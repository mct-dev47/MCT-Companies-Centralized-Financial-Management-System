import secrets
import contextvars
from starlette.types import ASGIApp, Scope, Receive, Send

request_id_ctx_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


def get_current_request_id() -> str:
    return request_id_ctx_var.get() or f"req_{secrets.token_hex(8)}"


def resolve_request_id(incoming_id: str | None) -> str:
    if incoming_id and len(incoming_id.strip()) <= 64:
        return incoming_id.strip()
    return f"req_{secrets.token_hex(8)}"


class RequestCorrelationMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers", [])
        incoming_id = None
        for key, val in headers:
            if key.lower() == b"x-request-id":
                try:
                    incoming_id = val.decode("latin1").strip()
                except Exception:
                    incoming_id = None
                break

        req_id = resolve_request_id(incoming_id)

        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["request_id"] = req_id

        token = request_id_ctx_var.set(req_id)

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                # Drop any X-Request-ID set by inner layers so the header appears exactly once
                resp_headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"
                ]
                resp_headers.append((b"x-request-id", req_id.encode("latin1")))
                message["headers"] = resp_headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_ctx_var.reset(token)
