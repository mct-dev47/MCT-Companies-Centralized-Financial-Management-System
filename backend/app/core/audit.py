"""
Audit logging utilities:
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Set
from fastapi import Request

DEFAULT_SENSITIVE_PATTERNS: Set[str] = {
    "password",
    "pin",
    "token",
    "secret",
    "authorization",
    "auth_token",
    "access_token",
    "refresh_token",
    "api_key",
    "credentials",
    "otp",
}

DEFAULT_IGNORED_KEYS: Set[str] = {
    "updated_at",
}


def is_sensitive_key(key: str, custom_patterns: Optional[Set[str]] = None) -> bool:
    """
    Check if a dictionary key represents sensitive information
    such as passwords, tokens, pins, or authorization secrets.
    """
    key_lower = key.lower().replace("-", "_")
    patterns = custom_patterns or DEFAULT_SENSITIVE_PATTERNS
    for pattern in patterns:
        if pattern in key_lower:
            return True
    return False


def _safe_serialize_val(val: Any) -> Any:
    """
    Ensure value is JSON serializable for audit storage.
    """
    if val is None:
        return None
    if isinstance(val, (int, float, bool, str)):
        return val
    # Handle dates and objects
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)


def compute_dict_diff(
    old_dict: Optional[Dict[str, Any]],
    new_dict: Optional[Dict[str, Any]],
    *,
    ignored_keys: Optional[Set[str]] = None,
    sensitive_keys: Optional[Set[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Compare two dictionaries and produce a structured map of changed fields.
    Each changed key maps to {"old": old_value, "new": new_value}.
    """
    old_data = old_dict or {}
    new_data = new_dict or {}
    ignored = ignored_keys if ignored_keys is not None else DEFAULT_IGNORED_KEYS

    all_keys = set(old_data.keys()).union(set(new_data.keys()))
    diffs: Dict[str, Dict[str, Any]] = {}

    for key in sorted(all_keys):
        if key in ignored:
            continue

        old_val = old_data.get(key)
        new_val = new_data.get(key)

        # Skip if identical
        if old_val == new_val:
            continue

        sensitive = is_sensitive_key(key, sensitive_keys)

        masked_old = (
            "[REDACTED]"
            if sensitive and old_val is not None
            else _safe_serialize_val(old_val)
        )
        masked_new = (
            "[REDACTED]"
            if sensitive and new_val is not None
            else _safe_serialize_val(new_val)
        )

        diffs[key] = {
            "old": masked_old,
            "new": masked_new,
        }

    return diffs


def get_client_ip(request: Optional[Request]) -> Optional[str]:
    """
    Extract client IP address reliably, prioritizing forwarded proxy headers
    (X-Forwarded-For, X-Real-IP, CF-Connecting-IP) before client host.
    """
    if not request:
        return None

    # Check X-Forwarded-For (comma-separated list of IPs: client, proxy1, proxy2)
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
        if parts:
            return parts[0][:45]

    # Check X-Real-IP
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()[:45]

    # Check Cloudflare Connecting IP
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip and cf_ip.strip():
        return cf_ip.strip()[:45]

    # Fallback to direct client host
    if request.client and request.client.host:
        return request.client.host.strip()[:45]

    return None


def get_user_agent(request: Optional[Request]) -> Optional[str]:
    """
    Extract user agent string from incoming HTTP request.
    """
    if not request:
        return None
    agent = request.headers.get("user-agent")
    return agent[:500] if agent else None


def build_audit_details(
    *,
    record_type: Optional[str] = None,
    record_id: Optional[Any] = None,
    record_ref: Optional[str] = None,
    severity: str = "INFO",
    user_agent: Optional[str] = None,
    changes: Optional[Dict[str, Dict[str, Any]]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Construct standardized JSON details payload for audit logs.
    """
    payload: Dict[str, Any] = {
        "severity": severity.upper() if severity else "INFO",
    }
    if record_type:
        payload["record_type"] = record_type
    if record_id is not None:
        payload["record_id"] = record_id
    if record_ref:
        payload["record_ref"] = record_ref
    if user_agent:
        payload["user_agent"] = user_agent
    if changes:
        payload["changes"] = changes
    if metadata:
        payload["metadata"] = metadata
    return payload

