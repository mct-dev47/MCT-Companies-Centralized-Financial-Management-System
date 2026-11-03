import base64
import json
import logging
from cryptography.fernet import Fernet
from fastapi import HTTPException, status
from app.core.config import settings

logger = logging.getLogger(__name__)


def get_encryption_key() -> bytes:
    # Load key from settings (sourced from .env via config.py)
    key = settings.PAYLOAD_ENCRYPTION_KEY
    if not key:
        secret = settings.SUPABASE_JWT_SECRET
        if not secret or len(secret.strip()) < 32:
            raise RuntimeError("PAYLOAD_ENCRYPTION_KEY or valid SUPABASE_JWT_SECRET (>= 32 chars) must be configured.")
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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or corrupted encrypted payload.",
        )
