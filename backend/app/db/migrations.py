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
    result_0002 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0002_user_status_and_invitations'")
    ).first()

    if not result_0002:
        script_path = MIGRATIONS_DIR / "0002_user_status_and_invitations.postgres.sql"
        if script_path.exists():
            with open(script_path, "r", encoding="utf-8") as f:
                sql = f.read()
            clean_sql = sql.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_sql))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0002_user_status_and_invitations')"))
            applied.append("0002_user_status_and_invitations")
            logger.info("Migration 0002_user_status_and_invitations applied successfully.")

    # 4. Check if 0038 is applied
    result_0038 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0038_petty_cash_excess_reimbursements'")
    ).first()

    if not result_0038:
        # Pre-flight check for duplicate reference_no in expenses
        dup_rows = conn.execute(
            text("SELECT reference_no, COUNT(*) FROM expenses WHERE reference_no IS NOT NULL GROUP BY reference_no HAVING COUNT(*) > 1")
        ).fetchall()
        if dup_rows:
            logger.warning("Pre-flight check found duplicate reference numbers in expenses: %s", dup_rows)

        script_0038 = MIGRATIONS_DIR / "0038_petty_cash_excess_reimbursements.postgres.sql"
        if script_0038.exists():
            with open(script_0038, "r", encoding="utf-8") as f:
                sql_0038 = f.read()
            clean_0038 = sql_0038.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0038))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0038_petty_cash_excess_reimbursements')"))
            applied.append("0038_petty_cash_excess_reimbursements")
            logger.info("Migration 0038_petty_cash_excess_reimbursements applied successfully.")

    # 5. Check if 0039 is applied
    result_0039 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0039_petty_cash_categories'")
    ).first()

    if not result_0039:
        script_0039 = MIGRATIONS_DIR / "0039_petty_cash_categories.postgres.sql"
        if script_0039.exists():
            with open(script_0039, "r", encoding="utf-8") as f:
                sql_0039 = f.read()
            clean_0039 = sql_0039.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0039))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0039_petty_cash_categories')"))
            applied.append("0039_petty_cash_categories")
            logger.info("Migration 0039_petty_cash_categories applied successfully.")

    # 6. Check if 0040 is applied
    result_0040 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0040_user_token_version'")
    ).first()

    if not result_0040:
        script_0040 = MIGRATIONS_DIR / "0040_user_token_version.postgres.sql"
        if script_0040.exists():
            with open(script_0040, "r", encoding="utf-8") as f:
                sql_0040 = f.read()
            clean_0040 = sql_0040.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0040))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0040_user_token_version')"))
            applied.append("0040_user_token_version")
            logger.info("Migration 0040_user_token_version applied successfully.")

    # 7. Check if 0041 is applied
    result_0041 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0041_user_invitations_purpose'")
    ).first()

    if not result_0041:
        script_0041 = MIGRATIONS_DIR / "0041_user_invitations_purpose.postgres.sql"
        if script_0041.exists():
            with open(script_0041, "r", encoding="utf-8") as f:
                sql_0041 = f.read()
            clean_0041 = sql_0041.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0041))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0041_user_invitations_purpose')"))
            applied.append("0041_user_invitations_purpose")
            logger.info("Migration 0041_user_invitations_purpose applied successfully.")

    conn.commit()
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

    result_0002 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0002_user_status_and_invitations'")
    ).first()

    if not result_0002:
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
                    lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                    clean_stmt = "\n".join(lines).strip()
                    if clean_stmt and "schema_migrations" not in clean_stmt:
                        conn.execute(text(clean_stmt))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0002_user_status_and_invitations')")
        )
        applied.append("0002_user_status_and_invitations")
        logger.info("SQLite migration 0002_user_status_and_invitations applied successfully.")

    # 4. Check if 0038 is applied
    result_0038 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0038_petty_cash_excess_reimbursements'")
    ).first()

    if not result_0038:
        # Check if tables exist before inspecting or altering
        exp_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'")
        ).first()
        pct_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='petty_cash_topups'")
        ).first()

        # Pre-flight check for duplicate reference_no in expenses
        if exp_table_exists:
            dup_rows = conn.execute(
                text("SELECT reference_no, COUNT(*) FROM expenses WHERE reference_no IS NOT NULL GROUP BY reference_no HAVING COUNT(*) > 1")
            ).fetchall()
            if dup_rows:
                logger.warning("Pre-flight check found duplicate reference numbers in expenses: %s", dup_rows)

        # Inspect petty_cash_topups columns if table exists
        if pct_table_exists:
            pct_res = conn.execute(text("PRAGMA table_info(petty_cash_topups)")).fetchall()
            pct_cols = {row[1] for row in pct_res}

            cols_to_add = [
                ("total_expenses", "NUMERIC(15, 2) NULL"),
                ("company_funded_amount", "NUMERIC(15, 2) NULL DEFAULT 0.00"),
                ("employee_out_of_pocket", "NUMERIC(15, 2) NULL DEFAULT 0.00"),
                ("reserved_amount", "NUMERIC(15, 2) NULL DEFAULT 0.00"),
                ("amount_reimbursed", "NUMERIC(15, 2) NOT NULL DEFAULT 0.00"),
                ("existing_expense_id", "INTEGER NULL"),
                ("petty_cash_expense_id", "INTEGER NULL"),
                ("reimbursement_expense_id", "INTEGER NULL"),
                ("payment_method_option", "VARCHAR(50) NULL"),
                ("destination_bank_id", "VARCHAR(100) NULL"),
                ("intercompany_transfer_id", "INTEGER NULL"),
                ("reimbursed_at", "DATETIME NULL"),
                ("reimbursed_by", "VARCHAR(150) NULL"),
                ("transfer_received_at", "DATETIME NULL"),
                ("transfer_received_by", "VARCHAR(150) NULL"),
            ]
            for col_name, col_def in cols_to_add:
                if col_name not in pct_cols:
                    conn.execute(text(f"ALTER TABLE petty_cash_topups ADD COLUMN {col_name} {col_def}"))

        # Inspect expenses columns if table exists
        if exp_table_exists:
            exp_res = conn.execute(text("PRAGMA table_info(expenses)")).fetchall()
            exp_cols = {row[1] for row in exp_res}
            if "linked_topup_id" not in exp_cols:
                conn.execute(text("ALTER TABLE expenses ADD COLUMN linked_topup_id INTEGER NULL"))

        # Execute sqlite script for tables & indexes
        script_0038 = MIGRATIONS_DIR / "0038_petty_cash_excess_reimbursements.sqlite.sql"
        if script_0038.exists():
            with open(script_0038, "r", encoding="utf-8") as f:
                for statement in f.read().split(";"):
                    # Strip comment-only lines
                    lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                    clean_stmt = "\n".join(lines).strip()
                    if clean_stmt and "schema_migrations" not in clean_stmt:
                        conn.execute(text(clean_stmt))

        # Create partial unique indexes if tables exist
        if pct_table_exists:
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS idx_topups_existing_expense_id ON petty_cash_topups(existing_expense_id) WHERE existing_expense_id IS NOT NULL")
            )
        if exp_table_exists:
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_reference_no ON expenses(reference_no) WHERE reference_no IS NOT NULL")
            )
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS idx_expenses_linked_topup ON expenses(linked_topup_id)")
            )

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0038_petty_cash_excess_reimbursements')")
        )
        applied.append("0038_petty_cash_excess_reimbursements")
        logger.info("SQLite migration 0038_petty_cash_excess_reimbursements applied successfully.")

    # 5. Check if 0039 is applied
    result_0039 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0039_petty_cash_categories'")
    ).first()

    if not result_0039:
        script_0039 = MIGRATIONS_DIR / "0039_petty_cash_categories.sqlite.sql"
        if script_0039.exists():
            with open(script_0039, "r", encoding="utf-8") as f:
                for statement in f.read().split(";"):
                    lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                    clean_stmt = "\n".join(lines).strip()
                    if clean_stmt and "schema_migrations" not in clean_stmt:
                        conn.execute(text(clean_stmt))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0039_petty_cash_categories')")
        )
        applied.append("0039_petty_cash_categories")
        logger.info("SQLite migration 0039_petty_cash_categories applied successfully.")

    # 6. Check if 0040 is applied
    result_0040 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0040_user_token_version'")
    ).first()

    if not result_0040:
        user_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        ).first()
        if user_table_exists:
            user_cols_res = conn.execute(text("PRAGMA table_info(users)")).fetchall()
            user_cols = {row[1] for row in user_cols_res}
            if "token_version" not in user_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1"))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0040_user_token_version')")
        )
        applied.append("0040_user_token_version")
        logger.info("SQLite migration 0040_user_token_version applied successfully.")

    # 7. Check if 0041 is applied
    result_0041 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0041_user_invitations_purpose'")
    ).first()

    if not result_0041:
        inv_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='user_invitations'")
        ).first()
        if inv_table_exists:
            inv_cols_res = conn.execute(text("PRAGMA table_info(user_invitations)")).fetchall()
            inv_cols = {row[1] for row in inv_cols_res}
            if "purpose" not in inv_cols:
                conn.execute(
                    text("ALTER TABLE user_invitations ADD COLUMN purpose VARCHAR(30) NOT NULL DEFAULT 'initial_password_setup'")
                )
            conn.execute(
                text("CREATE INDEX IF NOT EXISTS idx_user_invitations_user_purpose ON user_invitations(user_id, purpose, status)")
            )

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0041_user_invitations_purpose')")
        )
        applied.append("0041_user_invitations_purpose")
        logger.info("SQLite migration 0041_user_invitations_purpose applied successfully.")

    conn.commit()
    return applied
