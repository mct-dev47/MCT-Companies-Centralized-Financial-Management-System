from supabase import create_client, Client, ClientOptions
from app.core.config import settings
from typing import Optional
import logging
import os

logger = logging.getLogger(__name__)

_supabase_client: Optional[Client] = None
_supabase_admin_client: Optional[Client] = None

# Fail-fast timeout configuration for remote Supabase HTTP operations (prevents 120s socket hangs)
DEFAULT_SUPABASE_TIMEOUT_SECONDS = 8


def _get_client_options() -> ClientOptions:
    """Return ClientOptions with bounded timeouts so slow or dropped network calls fail fast."""
    return ClientOptions(
        postgrest_client_timeout=DEFAULT_SUPABASE_TIMEOUT_SECONDS,
        storage_client_timeout=10,
        function_client_timeout=5,
    )


def reset_supabase_clients() -> None:
    """Reset cached Supabase client singletons (primarily used for unit testing)."""
    global _supabase_client, _supabase_admin_client
    _supabase_client = None
    _supabase_admin_client = None


def _extract_plain_key(val: object) -> str:
    """Ensure key is a native string for httpx/supabase headers."""
    if not val:
        return ""
    if hasattr(val, "get_secret_value"):
        return val.get_secret_value()
    return str(val)


def _is_blocked_live_supabase_in_test() -> bool:
    """
    Prevent unmocked unit tests (`TESTING=1`) from contacting remote live Supabase instances
    unless `ALLOW_LIVE_SUPABASE_IN_TEST=1` is explicitly set.
    """
    if os.environ.get("TESTING") != "1" or os.environ.get("ALLOW_LIVE_SUPABASE_IN_TEST") == "1":
        return False
    url = (settings.SUPABASE_URL or "").strip().lower()
    return ".supabase.co" in url or ".supabase.in" in url


def get_supabase_client() -> Optional[Client]:
    """
    Returns a singleton instance of the Supabase Client, or None if not configured.
    """
    global _supabase_client
    key = _extract_plain_key(settings.SUPABASE_KEY)
    if not settings.SUPABASE_URL or not key or _is_blocked_live_supabase_in_test():
        return None
    if _supabase_client is None:
        _supabase_client = create_client(settings.SUPABASE_URL, key, options=_get_client_options())
    return _supabase_client


def get_supabase_admin_client() -> Optional[Client]:
    """
    Returns a singleton instance of the Supabase Client with service role permissions (bypasses RLS),
    or None if not configured.
    """
    global _supabase_admin_client
    service_key = _extract_plain_key(settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY)
    if not settings.SUPABASE_URL or not service_key or _is_blocked_live_supabase_in_test():
        return None
    if _supabase_admin_client is None:
        _supabase_admin_client = create_client(
            settings.SUPABASE_URL,
            service_key,
            options=_get_client_options(),
        )
    return _supabase_admin_client

