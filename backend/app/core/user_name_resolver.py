"""
user_name_resolver.py
---------------------
Resolves raw emails and usernames into clean display names without hardcoded user data.
"""

from typing import Optional

KNOWN_EMAIL_NAMES: dict[str, str] = {}


def resolve_real_name(name_or_email: Optional[str]) -> str:
    if not name_or_email or not str(name_or_email).strip():
        return "System User"

    raw = str(name_or_email).strip()

    if "@" in raw:
        local_part = raw.split("@")[0]
        cleaned = (
            local_part.replace(".", " ")
            .replace("_", " ")
            .replace("-", " ")
            .replace("+", " ")
        )
        words = [w.capitalize() for w in cleaned.split() if w]
        if words:
            return " ".join(words)
        return local_part.capitalize()

    return raw
