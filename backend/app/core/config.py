from typing import List, Union, Optional
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, Field, SecretStr, field_validator, model_validator
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
    CORS_ORIGINS: Union[str, List[str]] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    ENVIRONMENT: str = "development"
    ENABLE_API_DOCS: bool = False

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
    ADMIN_EMAIL: str = ""

    # Email Security & Resilience Controls
    EMAIL_DISPATCH_TIMEOUT_SECONDS: float = 8.0
    EMAIL_COOLDOWN_SECONDS_PER_RECIPIENT: int = 15

    # Login OTP delivery via Resend (deprecated fallback)
    RESEND_API_KEY: SecretStr = SecretStr("")
    RESEND_FROM_EMAIL: str = ""
    OTP_COOKIE_SECURE: bool = False

    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15
    LOGIN_GLOBAL_EMAIL_MAX_ATTEMPTS: int = 15
    LOGIN_IP_MAX_ATTEMPTS: int = 30
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_LIMIT: int = 5
    OTP_RESEND_INTERVAL_SECONDS: int = 120
    OTP_RESEND_LOCKOUT_MINUTES: int = 15
    OTP_EXPIRES_SECONDS: int = 180
    # Per-table data retention settings
    RATE_LIMITS_RETENTION_DAYS: int = 7
    OTP_CHALLENGES_RETENTION_DAYS: int = 30
    INVITATION_OUTBOX_RETENTION_DAYS: int = 60
    RETENTION_PURGE_BATCH_SIZE: int = 1000
    RETENTION_PURGE_INTERVAL_SECONDS: int = 21600
    # Deprecated alias kept for backwards compatibility; use OTP_CHALLENGES_RETENTION_DAYS instead
    OTP_AUDIT_RETENTION_DAYS: int = Field(
        default=30,
        deprecated="Deprecated: use OTP_CHALLENGES_RETENTION_DAYS instead; scheduled for removal.",
    )
    OTP_HMAC_SECRET: SecretStr = SecretStr("")
    API_RATE_LIMIT_PER_MINUTE: int = 120
    HEAVY_API_RATE_LIMIT_PER_MINUTE: int = 30
    RATE_LIMIT_ENABLED: bool = True
    TRUSTED_PROXIES: str = "127.0.0.1,::1"
    ACCESS_TOKEN_EXPIRE_SECONDS: int = 300
    SESSION_IDLE_TIMEOUT_SECONDS: int = 1800
    SESSION_ABSOLUTE_LIFETIME_SECONDS: int = 28800
    REFRESH_GRACE_PERIOD_SECONDS: int = 15
    REAUTH_TOKEN_EXPIRE_SECONDS: int = 300
    REFRESH_COOKIE_NAME: str = "mct_refresh_token"
    REFRESH_COOKIE_PATH: str = "/api/v1/auth"

    INITIAL_SETUP_TOKEN_LIFETIME_HOURS: int = 24
    PASSWORD_RESET_TOKEN_LIFETIME_MINUTES: int = 30
    FORGOT_PASSWORD_RATE_LIMIT_EMAIL_COUNT: int = 5
    FORGOT_PASSWORD_RATE_LIMIT_EMAIL_WINDOW_SECONDS: int = 900
    FORGOT_PASSWORD_RATE_LIMIT_IP_COUNT: int = 10
    FORGOT_PASSWORD_RATE_LIMIT_IP_WINDOW_SECONDS: int = 900
    FORGOT_PASSWORD_SILENT_COOLDOWN_SECONDS: int = 60
    FORGOT_PASSWORD_TIME_FLOOR_MS: int = 180

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

    @property
    def otp_hmac_secret_plain(self) -> str:
        secret = unwrap_secret(self.OTP_HMAC_SECRET)
        if not secret:
            secret = unwrap_secret(self.SUPABASE_JWT_SECRET) or self.SUPABASE_KEY
        if not secret or len(secret.strip()) < 32:
            secret = "mct-centralized-rate-limit-otp-hmac-secret-32chars-min!"
        return secret.strip()

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        raw_origins: List[str] = []
        if isinstance(v, list):
            raw_origins = [str(item).strip() for item in v]
        elif isinstance(v, str):
            val = v.strip()
            if val.startswith("[") and val.endswith("]"):
                try:
                    parsed = json.loads(val)
                    if isinstance(parsed, list):
                        raw_origins = [str(item).strip() for item in parsed]
                except Exception:
                    inner = val[1:-1].strip()
                    raw_origins = [p.strip().strip("'").strip('"') for p in inner.split(",") if p.strip()]
            else:
                raw_origins = [i.strip().strip("'").strip('"') for i in val.split(",") if i.strip()]

        cleaned_origins: List[str] = []
        for orig in raw_origins:
            orig = orig.strip()
            if not orig:
                continue
            if orig == "*":
                raise ValueError(
                    "Security violation: Wildcard CORS origin '*' cannot be combined with credentials (allow_credentials=True). "
                    "Configure exact trusted origins (e.g. 'http://localhost:5173')."
                )
            if not (orig.startswith("http://") or orig.startswith("https://")):
                raise ValueError(f"Invalid CORS origin: '{orig}'. Origins must start with http:// or https://")
            cleaned_origins.append(orig.rstrip("/"))

        return cleaned_origins

    @model_validator(mode="after")
    def enforce_production_security_defaults(self):
        if str(self.ENVIRONMENT or "").strip().lower() == "production":
            self.OTP_COOKIE_SECURE = True
        return self

    model_config = SettingsConfigDict(
        env_file=BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

settings = Settings()
