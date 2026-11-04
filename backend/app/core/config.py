from typing import List, Union, Optional
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, SecretStr, field_validator
import json

BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def unwrap_secret(val: Union[SecretStr, str, None]) -> str:
    """Safely extract plain secret value from SecretStr or str without leaking in logs."""
    if val is None:
        return ""
    if isinstance(val, SecretStr):
        return val.get_secret_value()
    return str(val)


class Settings(BaseSettings):
    PROJECT_NAME: str = "MCT Companies Centralized Financial Management System"
    API_V1_STR: str = "/api/v1"
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    ENVIRONMENT: str = "development"

    # Supabase settings
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: SecretStr = SecretStr("")
    DATABASE_URL: str = ""

    # Supabase JWT settings
    SUPABASE_JWT_SECRET: SecretStr = SecretStr("")
    SUPABASE_JWT_AUDIENCE: str = "authenticated"
    SUPABASE_JWT_ISSUER: str = ""

    # Payload encryption key (Fernet)
    PAYLOAD_ENCRYPTION_KEY: SecretStr = SecretStr("")

    # Brevo (formerly Sendinblue) settings for transactional emails
    BREVO_API_KEY: SecretStr = SecretStr("")
    BREVO_FROM_EMAIL: str = ""
    BREVO_FROM_NAME: str = "MCT Financial System"

    # Email Security & Resilience Controls
    EMAIL_DISPATCH_TIMEOUT_SECONDS: float = 8.0
    EMAIL_COOLDOWN_SECONDS_PER_RECIPIENT: int = 15

    # Login OTP delivery via Resend (deprecated fallback)
    RESEND_API_KEY: SecretStr = SecretStr("")
    RESEND_FROM_EMAIL: str = ""
    OTP_COOKIE_SECURE: bool = False

    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_LIMIT: int = 5
    OTP_RESEND_INTERVAL_SECONDS: int = 120
    OTP_EXPIRES_SECONDS: int = 180
    SESSION_IDLE_TIMEOUT_SECONDS: int = 7200

    @field_validator("SUPABASE_JWT_SECRET")
    @classmethod
    def validate_jwt_secret(cls, v: Union[SecretStr, str]) -> SecretStr:
        val = v.get_secret_value() if isinstance(v, SecretStr) else str(v)
        if val and len(val.strip()) < 32:
            raise ValueError(
                "Configuration error: SUPABASE_JWT_SECRET is missing, empty, or shorter than 32 characters."
            )
        return SecretStr(val.strip()) if not isinstance(v, SecretStr) else v

    @property
    def brevo_api_key_plain(self) -> str:
        return unwrap_secret(self.BREVO_API_KEY)

    @property
    def resend_api_key_plain(self) -> str:
        return unwrap_secret(self.RESEND_API_KEY)

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, str) and v.startswith("["):
            return json.loads(v)
        return v

    model_config = SettingsConfigDict(
        env_file=BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

settings = Settings()
