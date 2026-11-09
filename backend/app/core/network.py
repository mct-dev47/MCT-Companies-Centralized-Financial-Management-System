import ipaddress
import logging
from typing import Optional, Union
from fastapi import Request
from app.core.config import settings

logger = logging.getLogger(__name__)


def _parse_trusted_proxies(trusted_proxies_str: str) -> list[Union[ipaddress.IPv4Network, ipaddress.IPv6Network]]:
    networks: list[Union[ipaddress.IPv4Network, ipaddress.IPv6Network]] = []
    for item in trusted_proxies_str.split(","):
        stripped = item.strip()
        if not stripped:
            continue
        try:
            if "/" in stripped:
                net = ipaddress.ip_network(stripped, strict=False)
            else:
                ip = ipaddress.ip_address(stripped)
                net = ipaddress.ip_network(f"{ip}/{32 if ip.version == 4 else 128}", strict=False)
            networks.append(net)
        except ValueError:
            logger.warning("Invalid trusted proxy network configured: %s", stripped)
    return networks


def is_ip_trusted(ip_str: str, trusted_networks: list[Union[ipaddress.IPv4Network, ipaddress.IPv6Network]]) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
        return any(ip in net for net in trusted_networks)
    except ValueError:
        return False


def normalize_client_ip(ip_str: str) -> str:
    """
    Normalizes an IP address. IPv4 addresses are returned trimmed.
    IPv6 addresses are grouped by their /64 subnet prefix to prevent
    attackers from rotating interface identifiers to bypass limits.
    """
    cleaned = ip_str.strip().strip("[]")
    try:
        ip = ipaddress.ip_address(cleaned)
        if ip.version == 6:
            # Map IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1) to IPv4
            if ip.ipv4_mapped:
                return str(ip.ipv4_mapped)
            # Group into /64 network
            net64 = ipaddress.IPv6Network(f"{ip}/64", strict=False)
            return str(net64.network_address) + "/64"
        return str(ip)
    except ValueError:
        return cleaned or "unknown"


def get_trusted_client_ip(request: Request) -> str:
    """
    Securely resolves the client's actual IP address.
    Direct socket IP is verified against TRUSTED_PROXIES before inspecting X-Forwarded-For.
    Untrusted headers are ignored. For trusted proxies, the rightmost untrusted hop is returned.
    IPv6 addresses are normalized to /64 prefixes.
    """
    direct_socket_ip = request.client.host if request.client and request.client.host else "127.0.0.1"
    trusted_networks = _parse_trusted_proxies(settings.TRUSTED_PROXIES)

    # If the direct connection is NOT from a trusted proxy, ignore X-Forwarded-For completely
    if not is_ip_trusted(direct_socket_ip, trusted_networks):
        return normalize_client_ip(direct_socket_ip)

    # Direct connection is trusted: inspect X-Forwarded-For
    xff_header = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if not xff_header:
        return normalize_client_ip(direct_socket_ip)

    hops = [hop.strip().strip("[]") for hop in xff_header.split(",") if hop.strip()]
    if not hops:
        return normalize_client_ip(direct_socket_ip)

    # Traverse from right to left: find the first IP that is NOT a trusted proxy
    for hop in reversed(hops):
        if not is_ip_trusted(hop, trusted_networks):
            return normalize_client_ip(hop)

    # If every hop is trusted, return the leftmost origin hop
    return normalize_client_ip(hops[0])

