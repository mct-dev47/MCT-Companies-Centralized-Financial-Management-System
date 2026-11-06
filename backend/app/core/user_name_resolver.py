"""
user_name_resolver.py
---------------------
Resolves raw emails, usernames, and Google account strings into clean real names.
"""

from typing import Optional

KNOWN_EMAIL_NAMES = {
    "admin@mct.com": "Administrator",
    "audit@mct.com": "Audit Officer",
    "finance@mct.com": "Finance Officer",
    "temporaryemployee@gmail.com": "Temporary Employee",
    "jkproperty@mct.com": "Clarian Cuenta",
    "filcap@mct.com": "Clarian Cuenta",
    "clarian@mct.com": "Clarian Cuenta",
    "slosizante@gmail.com": "Clarian Cuenta",
}


def resolve_real_name(name_or_email: Optional[str]) -> str:
    if not name_or_email or not str(name_or_email).strip():
        return "System User"

    raw = str(name_or_email).strip()
    lower = raw.lower()

    if lower in KNOWN_EMAIL_NAMES:
        return KNOWN_EMAIL_NAMES[lower]

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

