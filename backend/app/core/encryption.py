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
        # Fallback: derive a key from SUPABASE_JWT_SECRET or SUPABASE_KEY
        secret = unwrap_secret(settings.SUPABASE_JWT_SECRET) or settings.SUPABASE_KEY or "mct-centralized-system-32byte-secret-key!!"
        key = base64.urlsafe_b64encode(secret.ljust(32)[:32].encode("utf-8")).decode("utf-8")
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
