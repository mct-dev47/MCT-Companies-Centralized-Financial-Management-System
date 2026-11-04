import logging
import os
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"


def get_applied_migrations(engine: Engine) -> list[str]:
    """
    Returns the list of migration versions already applied to the database.
    """
    with engine.connect() as conn:
        try:
            rows = conn.execute(
                text("SELECT version FROM schema_migrations ORDER BY applied_at ASC")
            ).fetchall()
            return [row[0] for row in rows]
        except Exception:
            return []


def run_migrations(engine: Engine) -> list[str]:
    """
    Applies versioned SQL migrations idempotently with engine-specific locking.
    Returns the list of migration versions applied during this execution.
    """
    dialect = engine.dialect.name
    logger.info("Running database migrations for dialect: %s", dialect)

    with engine.connect() as conn:
        if dialect == "postgresql":
            return _run_postgresql_migrations(conn)
        else:
            return _run_sqlite_migrations(conn)


def _run_postgresql_migrations(conn) -> list[str]:
    applied: list[str] = []
    # 1. Acquire transaction-scoped advisory lock to prevent concurrent runs
    conn.execute(text("SELECT pg_advisory_xact_lock(84729104);"))

    # 2. Ensure schema_migrations exists
    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(100) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
    )

    # 3. Check if 0002 is applied
    result = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0002_user_status_and_invitations'")
    ).first()

    if result:
        logger.info("Migration 0002_user_status_and_invitations already applied.")
        conn.commit()
        return []

    # 4. Read and execute PostgreSQL migration script
    script_path = MIGRATIONS_DIR / "0002_user_status_and_invitations.postgres.sql"
    if not script_path.exists():
        raise FileNotFoundError(f"Migration script not found: {script_path}")

    with open(script_path, "r", encoding="utf-8") as f:
        sql = f.read()

    # Split on semicolons or execute blocks (excluding BEGIN / COMMIT wrapper since conn handles it)
    clean_sql = sql.replace("BEGIN;", "").replace("COMMIT;", "").strip()
    conn.execute(text(clean_sql))
    conn.commit()
    applied.append("0002_user_status_and_invitations")
    logger.info("Migration 0002_user_status_and_invitations applied successfully.")
    return applied


def _run_sqlite_migrations(conn) -> list[str]:
    applied: list[str] = []
    # 1. Ensure schema_migrations exists
    conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(100) PRIMARY KEY,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
    )

    result = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0002_user_status_and_invitations'")
    ).first()

    if result:
        logger.info("Migration 0002_user_status_and_invitations already applied.")
        conn.commit()
        return []

    # 2. Inspect users table columns to avoid duplicate column errors in SQLite
    user_cols_res = conn.execute(text("PRAGMA table_info(users)")).fetchall()
    existing_cols = {row[1] for row in user_cols_res}

    if "status" not in existing_cols:
        conn.execute(text("ALTER TABLE users ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)"))

    if "must_change_password" not in existing_cols:
        conn.execute(text("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0"))

    # 3. Execute tables and indexes from sqlite script
    script_path = MIGRATIONS_DIR / "0002_user_status_and_invitations.sqlite.sql"
    if script_path.exists():
        with open(script_path, "r", encoding="utf-8") as f:
            for statement in f.read().split(";"):
                stmt = statement.strip()
                if stmt and not stmt.startswith("--") and "schema_migrations" not in stmt:
                    conn.execute(text(stmt))

    conn.execute(
        text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0002_user_status_and_invitations')")
    )
    conn.commit()
    applied.append("0002_user_status_and_invitations")
    logger.info("SQLite migration 0002_user_status_and_invitations applied successfully.")
    return applied
