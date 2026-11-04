import html
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from app.core.config import settings, unwrap_secret
from app.core.resilience import email_circuit_breaker

logger = logging.getLogger(__name__)

# Strict RFC-compliant email regex pattern (disallowing newlines and spaces)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

# In-memory sliding cooldown tracking: recipient_email -> last_sent_timestamp
_recipient_cooldowns: dict[str, float] = {}
_cooldown_lock = threading.Lock()


def mask_email(email: str) -> str:
    """Mask email for privacy in server logs (e.g. j***e@domain.com)."""
    if not email or "@" not in email:
        return "[INVALID_EMAIL]"
    name, domain = email.split("@", 1)
    if len(name) <= 2:
        masked_name = name[0] + "***"
    else:
        masked_name = name[0] + "***" + name[-1]
    return f"{masked_name}@{domain}"


def mask_sensitive_url(url: str) -> str:
    """Redact sensitive query parameters (e.g. token, key, secret) in URLs for safe logging."""
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.query:
            return url
        params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        masked_params = []
        for key, value in params:
            if any(s in key.lower() for s in ("token", "key", "secret", "otp", "password")):
                masked_params.append((key, "[REDACTED]"))
            else:
                masked_params.append((key, value))
        masked_query = urllib.parse.urlencode(masked_params)
        return urllib.parse.urlunparse(
            (parsed.scheme, parsed.netloc, parsed.path, parsed.params, masked_query, parsed.fragment)
        )
    except Exception:
        return "[URL_REDACTED]"


def sanitize_header_value(value: str, field_name: str = "Header") -> str:
    """
    Prevent email header/CRLF injection attacks.
    Disallows \r and \n characters in header fields like subject and recipient names.
    """
    if not value:
        return ""
    if "\r" in value or "\n" in value:
        logger.warning("Security alert: Attempted CRLF injection in %s: %r", field_name, value)
        raise ValueError(f"Invalid control characters detected in email {field_name}")
    return value.strip()


def is_valid_email(email: str) -> bool:
    """Verify that an email address is syntactically valid and free of newline/injection characters."""
    if not email or not isinstance(email, str):
        return False
    if "\r" in email or "\n" in email or len(email) > 254:
        return False
    return bool(EMAIL_REGEX.match(email.strip()))


def check_and_update_recipient_cooldown(
    email: str,
    cooldown_seconds: Optional[float] = None,
) -> bool:
    """
    Enforce per-recipient sliding cooldown to prevent email bombing / rapid quota exhaustion.
    Returns True if permitted, False if the request violates the cooldown window.
    """
    if cooldown_seconds is None:
        cooldown_seconds = float(settings.EMAIL_COOLDOWN_SECONDS_PER_RECIPIENT)

    if cooldown_seconds <= 0:
        return True

    normalized = email.strip().lower()
    now = time.time()
    with _cooldown_lock:
        last_sent = _recipient_cooldowns.get(normalized, 0.0)
        if (now - last_sent) < cooldown_seconds:
            logger.warning(
                "Rate limit exceeded: Dispatch to %s suppressed (cooldown %.1fs remaining).",
                mask_email(normalized),
                cooldown_seconds - (now - last_sent),
            )
            return False
        _recipient_cooldowns[normalized] = now

        # Prune old entries if dictionary exceeds 5000 items
        if len(_recipient_cooldowns) > 5000:
            threshold = now - 3600.0
            stale_keys = [k for k, v in _recipient_cooldowns.items() if v < threshold]
            for k in stale_keys:
                _recipient_cooldowns.pop(k, None)

        return True


def send_transactional_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: str,
    to_name: Optional[str] = None,
    from_email: Optional[str] = None,
    from_name: Optional[str] = None,
    timeout: Optional[float] = None,
    enforce_cooldown: bool = True,
) -> bool:
    """
    Send a secure transactional email via Brevo REST API v3 with circuit breaker resilience,
    strict input sanitization, and PII masking.
    """
    # 1. Validation & Header Sanitization
    if not is_valid_email(to_email):
        logger.error("Email dispatch aborted: Invalid recipient email address %r", to_email)
        return False

    try:
        sanitized_subject = sanitize_header_value(subject, "Subject")
        sanitized_to_name = sanitize_header_value(to_name, "Recipient Name") if to_name else None
    except ValueError as val_err:
        logger.error("Email dispatch blocked by security validation: %s", val_err)
        return False

    # 2. Recipient Abuse Cooldown Check
    if enforce_cooldown and not check_and_update_recipient_cooldown(to_email):
        return False

    # 3. Provider Configuration Resolution
    api_key = unwrap_secret(settings.BREVO_API_KEY) or unwrap_secret(settings.RESEND_API_KEY)
    resolved_from_email = from_email or settings.BREVO_FROM_EMAIL or settings.RESEND_FROM_EMAIL
    resolved_from_name = from_name or settings.BREVO_FROM_NAME

    if not api_key:
        logger.warning(
            "BREVO_API_KEY is not configured. Email dispatch skipped for %s.",
            mask_email(to_email),
        )
        return False

    if not resolved_from_email or not is_valid_email(resolved_from_email):
        logger.error(
            "BREVO_FROM_EMAIL is invalid or missing (%r). Brevo requires an authorized sender.",
            resolved_from_email,
        )
        return False

    # 4. Resilience Circuit Breaker Check
    if not email_circuit_breaker.can_execute():
        logger.warning(
            "Email circuit breaker is OPEN. Delivery to %s postponed.",
            mask_email(to_email),
        )
        return False

    # 5. Build Brevo v3 Transactional Payload
    recipient_obj: dict[str, str] = {"email": to_email.strip()}
    if sanitized_to_name:
        recipient_obj["name"] = sanitized_to_name

    payload = {
        "sender": {
            "name": resolved_from_name,
            "email": resolved_from_email.strip(),
        },
        "to": [recipient_obj],
        "subject": sanitized_subject,
        "htmlContent": html_content,
        "textContent": text_content,
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=req_data,
        headers={
            "api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "MCT-Financial-Management-System",
        },
        method="POST",
    )

    dispatch_timeout = timeout or settings.EMAIL_DISPATCH_TIMEOUT_SECONDS

    # 6. Execute Dispatch
    try:
        with urllib.request.urlopen(req, timeout=dispatch_timeout) as response:
            if 200 <= response.status < 300:
                email_circuit_breaker.record_success()
                logger.info(
                    "Successfully dispatched email via Brevo to %s (status=%d)",
                    mask_email(to_email),
                    response.status,
                )
                return True
            else:
                email_circuit_breaker.record_failure()
                logger.warning(
                    "Unexpected HTTP response from Brevo for %s: %d",
                    mask_email(to_email),
                    response.status,
                )
                return False
    except urllib.error.HTTPError as http_err:
        email_circuit_breaker.record_failure()
        err_msg = ""
        try:
            err_msg = http_err.read().decode("utf-8")[:200]
        except Exception:
            pass
        logger.warning(
            "Brevo HTTP error %d when sending to %s: %s",
            http_err.code,
            mask_email(to_email),
            err_msg,
        )
        return False
    except Exception as exc:
        email_circuit_breaker.record_failure()
        logger.warning(
            "Brevo email dispatch failed for %s: %s",
            mask_email(to_email),
            exc,
        )
        return False

