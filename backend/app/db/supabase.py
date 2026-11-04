from supabase import create_client, Client
from app.core.config import settings
from typing import Optional
import logging

logger = logging.getLogger(__name__)

_supabase_client: Optional[Client] = None


def _extract_plain_key(val: object) -> str:
    """Ensure key is a native string for httpx/supabase headers."""
    if not val:
        return ""
    if hasattr(val, "get_secret_value"):
        return val.get_secret_value()
    return str(val)


def get_supabase_client() -> Client:
    """
    Returns a singleton instance of the Supabase Client.
    """
    global _supabase_client
    if _supabase_client is None:
        key = _extract_plain_key(settings.SUPABASE_KEY)
        if not settings.SUPABASE_URL or not key:
            logger.warning("SUPABASE_URL or SUPABASE_KEY not configured. Supabase client may not function.")
        _supabase_client = create_client(settings.SUPABASE_URL, key)
    return _supabase_client


def get_supabase_admin_client() -> Client:
    """
    Returns a Supabase Client with service role permissions (bypasses RLS).
    """
    service_key = _extract_plain_key(settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY)
    return create_client(settings.SUPABASE_URL, service_key)
