import logging

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Response, status
from app.schemas.company import HealthResponse
from app.core.config import settings
from app.db.supabase import get_supabase_client
from app.db.session import engine
from sqlalchemy import text

router = APIRouter()

@router.get("/health", response_model=HealthResponse, summary="System Health Check")
def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": "1.0.0",
        "api_v1_path": settings.API_V1_STR
    }

@router.get("/health/db", summary="Check Supabase / Database Connection")
def check_db_connection(response: Response = None):
    results = {
        "supabase_api": "not_configured",
        "sqlalchemy_db": "not_configured"
    }
    db_healthy = False

    # Check Supabase client
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            client = get_supabase_client()
            # Perform a lightweight ping/read if client exists
            if client:
                results["supabase_api"] = "configured"
        except Exception as e:
            logger.error("Supabase API check failed: %s", e, exc_info=True)
            results["supabase_api"] = "error: connection failed"

    # Check Direct Postgres/SQLite connection via SQLAlchemy
    if engine:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            results["sqlalchemy_db"] = "connected"
            db_healthy = True
        except Exception as e:
            logger.error("SQLAlchemy DB check failed: %s", e, exc_info=True)
            results["sqlalchemy_db"] = "error: database connection failed"

    if not db_healthy and response is not None:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    any_check_failed = not db_healthy or any(
        isinstance(val, str) and val.startswith("error:")
        for val in results.values()
    )

    return {
        "status": "degraded" if any_check_failed else "ok",
        "database_checks": results
    }

