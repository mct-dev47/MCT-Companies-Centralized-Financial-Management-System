from typing import List, Union
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, field_validator
import json

BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

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
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    DATABASE_URL: str = ""

    # Supabase JWT settings
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_JWT_AUDIENCE: str = "authenticated"
    SUPABASE_JWT_ISSUER: str = ""

    # Payload encryption key (Fernet)
    PAYLOAD_ENCRYPTION_KEY: str = ""

    # Login OTP delivery via Resend
    RESEND_API_KEY: str = ""
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
    def validate_jwt_secret(cls, v: str) -> str:
        if not v or len(v.strip()) < 32:
            raise ValueError(
                "Configuration error: SUPABASE_JWT_SECRET is missing, empty, or shorter than 32 characters."
            )
        return v.strip()

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
