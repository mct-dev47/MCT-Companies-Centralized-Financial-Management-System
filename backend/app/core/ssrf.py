from __future__ import annotations

import concurrent.futures
import ipaddress
import socket
from urllib.parse import urlsplit
from app.core.config import settings


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Returns True if the IP address is internal, loopback, link-local, cloud metadata, or reserved."""
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True

    # Explicit check for 169.254.169.254 (Cloud metadata service)
    if str(ip) == "169.254.169.254":
        return True

    return False


def _resolve_hostname(hostname: str, timeout: float = 2.5):
    """Resolve hostname with an explicit short timeout to prevent DNS thread exhaustion."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(socket.getaddrinfo, hostname, None, proto=socket.IPPROTO_TCP)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            raise ValueError(f"DNS resolution timed out for host '{hostname}'.")


def validate_safe_url(
    url: str | None,
    allow_localhost_dev: bool = False,
    allow_relative: bool = False,
) -> str | None:
    """Validates that a URL is safe against SSRF attacks.
    
    Rules:
    - Must be a valid HTTP(S) URL (HTTPS required by default).
    - If allow_relative is True, relative paths and storage keys without scheme/netloc
      (e.g. 'user/26/avatar.png', '/api/v1/users/26/picture') are accepted as safe.
    - Hostname must be resolvable via DNS.
    - Resolved IP address must NOT be in loopback, RFC 1918 private space,
      link-local, cloud metadata (169.254.169.254), multicast, or reserved ranges.
    """
    if not url:
        return url

    url_str = str(url).strip()
    if not url_str:
        return url_str

    if len(url_str) > 2048:
        raise ValueError("URL exceeds maximum length of 2048 characters.")

    parsed = urlsplit(url_str)
    scheme = (parsed.scheme or "").lower()

    if allow_relative and not scheme and not parsed.netloc and not url_str.startswith("//"):
        return url_str

    is_dev = str(getattr(settings, "ENVIRONMENT", "development")).lower() == "development"
    allowed_schemes = ("https", "http") if (allow_localhost_dev and is_dev) else ("https",)

    if scheme not in allowed_schemes:
        if "http" in allowed_schemes:
            raise ValueError(f"Invalid URL scheme '{scheme}'. URL must use HTTPS (or HTTP in local development).")
        raise ValueError(f"Invalid URL scheme '{scheme}'. URL must strictly use HTTPS.")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL must include a valid hostname.")

    # Allow localhost/127.0.0.1 in dev if explicitly permitted
    if allow_localhost_dev and is_dev and hostname in ("localhost", "127.0.0.1", "::1"):
        return url_str

    try:
        # Resolve all IPv4 and IPv6 addresses for the hostname with bounded timeout
        addr_infos = _resolve_hostname(hostname, timeout=2.5)
    except socket.gaierror as e:
        raise ValueError(f"Cannot resolve URL hostname '{hostname}': {e}")
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"DNS resolution failure for host '{hostname}': {e}")

    if not addr_infos:
        raise ValueError(f"Hostname '{hostname}' did not resolve to any IP address.")

    resolved_ips = set()
    for addr_info in addr_infos:
        sockaddr = addr_info[4]
        ip_str = sockaddr[0]
        resolved_ips.add(ip_str)

        try:
            ip_obj = ipaddress.ip_address(ip_str)
        except ValueError:
            raise ValueError(f"Hostname '{hostname}' resolved to an invalid IP address ({ip_str}).")

        if is_ip_blocked(ip_obj):
            raise ValueError(
                f"SSRF security violation: URL host '{hostname}' resolved to restricted or internal network ({ip_str})."
            )

    return url_str

