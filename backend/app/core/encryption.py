import base64
import json
import logging
from cryptography.fernet import Fernet
from fastapi import HTTPException, status
from app.core.config import settings, unwrap_secret

logger = logging.getLogger(__name__)


def get_encryption_key() -> bytes:
    # Load key from settings (sourced from .env via config.py)
    key = unwrap_secret(settings.PAYLOAD_ENCRYPTION_KEY)
    if not key:
        secret = unwrap_secret(settings.SUPABASE_JWT_SECRET) or settings.SUPABASE_KEY or "mct-centralized-system-32byte-secret-key!!"
        if len(secret.strip()) < 32:
            secret = secret.strip().ljust(32, "!")
        key = base64.urlsafe_b64encode(secret.strip()[:32].encode("utf-8")).decode("utf-8")
    if isinstance(key, str):
        key = key.encode("utf-8")
    return key


def encrypt_payload(data: dict) -> str:
    try:
        f = Fernet(get_encryption_key())
        json_data = json.dumps(data).encode("utf-8")
        return f.encrypt(json_data).decode("utf-8")
    except Exception as e:
        logger.error(f"Payload encryption error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to encrypt payload.",
        )


def decrypt_payload(encrypted_str: str) -> dict:
    try:
        f = Fernet(get_encryption_key())
        decrypted_bytes = f.decrypt(encrypted_str.encode("utf-8"))
        return json.loads(decrypted_bytes.decode("utf-8"))
    except Exception as e:
        logger.error(f"Payload decryption error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to decrypt payload.",
        )


def encrypt_invitation_token(raw_token: str, user_id: int | None = None) -> str:
    """Encrypt an invitation token into a Fernet URL-safe ciphertext payload."""
    payload = {"token": raw_token}
    if user_id is not None:
        payload["uid"] = user_id
    return encrypt_payload(payload)


def decrypt_invitation_token(token_or_encrypted: str) -> str:
    """
    Decrypt an encrypted invitation token if it is encrypted with Fernet.
    If it is already a raw token, returns it safely for backward compatibility.
    """
    clean = (token_or_encrypted or "").strip()
    if not clean:
        return ""
    if clean.startswith("gAAAAA"):
        try:
            data = decrypt_payload(clean)
            if isinstance(data, dict) and "token" in data:
                return data["token"]
        except Exception:
            pass
    return clean

