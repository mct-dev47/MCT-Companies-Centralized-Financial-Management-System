from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from typing import Any, Annotated

from app.core.config import settings, unwrap_secret

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


_bearer_scheme = HTTPBearer(auto_error=False)
_SUPPORTED_ALGORITHM = "HS256"
_revoked_tokens: set[str] = set()
_valid_token_cache: dict[str, float] = {}


def revoke_access_token(token: str, db: Any | None = None) -> None:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    _revoked_tokens.add(token_hash)
    _valid_token_cache.pop(token_hash, None)
    try:
        from app.db.session import SessionLocal
        from app.models.security import RevokedToken
        session = db or SessionLocal()
        try:
            existing = session.query(RevokedToken).filter(RevokedToken.token_hash == token_hash).first()
            if not existing:
                session.add(RevokedToken(token_hash=token_hash))
                session.commit()
        finally:
            if db is None:
                session.close()
    except Exception:
        pass


def get_access_token(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
) -> str:
    # Return the bearer token or reject an unauthenticated request.
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return credentials.credentials


def verify_token(token: Annotated[str, Depends(get_access_token)]) -> dict[str, Any]:
    """Validate a Supabase HS256 JWT and return its claims.

    The signing secret must be provided through ``SUPABASE_JWT_SECRET``.
    Tokens are rejected when they have an invalid signature, missing subject,
    expired timestamps, an invalid audience, or an invalid issuer.
    """
    secret = unwrap_secret(settings.SUPABASE_JWT_SECRET)
    if not secret or len(secret.strip()) < 32:
        raise RuntimeError("SUPABASE_JWT_SECRET is missing, empty, or shorter than 32 characters.")

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if token_hash in _revoked_tokens:
        raise _invalid_token("Access token has been revoked.")

    now = time.time()
    last_verified = _valid_token_cache.get(token_hash)
    if last_verified is None or (now - last_verified) > 60.0:
        if len(_valid_token_cache) > 5000:
            _valid_token_cache.clear()
        try:
            from app.db.session import SessionLocal
            from app.models.security import RevokedToken
            with SessionLocal() as db_session:
                if db_session.query(RevokedToken).filter(RevokedToken.token_hash == token_hash).first():
                    _revoked_tokens.add(token_hash)
                    _valid_token_cache.pop(token_hash, None)
                    raise _invalid_token("Access token has been revoked.")
                _valid_token_cache[token_hash] = now
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        header_segment, payload_segment, signature_segment = token.split(".")
        header = _decode_json_segment(header_segment)
        payload = _decode_json_segment(payload_segment)
        signature = _decode_segment(signature_segment)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error):
        raise _invalid_token("Malformed access token.") from None

    if header.get("alg") != _SUPPORTED_ALGORITHM:
        raise _invalid_token("Unsupported access token algorithm.")
    if header.get("typ") not in (None, "JWT"):
        raise _invalid_token("Invalid access token type.")
    if not isinstance(payload.get("sub"), str) or not payload["sub"]:
        raise _invalid_token("Access token subject is missing.")

    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    expected_signature = hmac.new(
        secret.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise _invalid_token("Invalid access token signature.")

    now = time.time()
    _validate_numeric_timestamp(payload, "exp", now, must_be_present=True)
    _validate_numeric_timestamp(payload, "nbf", now, must_be_present=False)

    expected_audience = settings.SUPABASE_JWT_AUDIENCE or "authenticated"
    if payload.get("aud") != expected_audience:
        raise _invalid_token("Invalid access token audience.")

    expected_issuer = settings.SUPABASE_JWT_ISSUER
    if expected_issuer and payload.get("iss") != expected_issuer:
        raise _invalid_token("Invalid access token issuer.")

    return payload


def _decode_segment(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _decode_json_segment(segment: str) -> dict[str, Any]:
    decoded = _decode_segment(segment)
    value = json.loads(decoded.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("JWT segment is not an object.")
    return value


def _validate_numeric_timestamp(
    payload: dict[str, Any],
    claim: str,
    now: float,
    *,
    must_be_present: bool,
) -> None:
    value = payload.get(claim)
    if value is None:
        if must_be_present:
            raise _invalid_token(f"Access token {claim} claim is missing.")
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _invalid_token(f"Access token {claim} claim is invalid.")

    if claim == "exp" and now >= value:
        raise _invalid_token("Access token has expired.")
    if claim == "nbf" and now < value:
        raise _invalid_token("Access token is not active yet.")


def _invalid_token(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )
