"""Safer error responses (security audit, 2026-10-30 & secret isolation hardening)."""
import logging
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """
    FastAPI's default 422 body repeats the submitted value in an `input` field. That echoes things like
    passwords back to the caller, and a value such as NaN cannot be turned into JSON, so the error response
    itself crashed. Only the location, message and type are returned.
    """
    errors = [
        {"loc": list(err.get("loc", ())), "msg": str(err.get("msg", "Invalid value")), "type": str(err.get("type", "value_error"))}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


def global_unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all 500 handler that logs the error securely on the server
    and returns a clean, sanitized generic response to prevent leaking
    stack traces, environment variables, or internal credentials.
    """
    logger.exception("Unhandled server exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal server error occurred. Please try again later."},
    )
