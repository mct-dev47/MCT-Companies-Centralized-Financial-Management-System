import logging
import os
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"


def _sql_statements(sql: str) -> list[str]:
    """Split a SQL script into statements, dropping ``--`` comment lines first.

    Comments must go before splitting on ";": a comment that contains a semicolon would otherwise leave
    its second half behind as a bogus statement (this broke 0051).
    """
    body = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [stmt.strip() for stmt in body.split(";") if stmt.strip()]


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

    # 8. Check if 0042 is applied
    result_0042 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0042_secure_rate_limiting'")
    ).first()

    if not result_0042:
        script_0042 = MIGRATIONS_DIR / "0042_secure_rate_limiting.postgres.sql"
        if script_0042.exists():
            with open(script_0042, "r", encoding="utf-8") as f:
                sql_0042 = f.read()
            clean_0042 = sql_0042.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0042))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0042_secure_rate_limiting')"))
            applied.append("0042_secure_rate_limiting")
            logger.info("Migration 0042_secure_rate_limiting applied successfully.")

    # 9. Check if 0043 is applied
    result_0043 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0043_user_sessions'")
    ).first()

    if not result_0043:
        script_0043 = MIGRATIONS_DIR / "0043_user_sessions.postgres.sql"
        if script_0043.exists():
            with open(script_0043, "r", encoding="utf-8") as f:
                sql_0043 = f.read()
            clean_0043 = sql_0043.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0043))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0043_user_sessions')"))
            applied.append("0043_user_sessions")
            logger.info("Migration 0043_user_sessions applied successfully.")

    # 10. Check if 0044 is applied
    result_0044 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0044_sales_expenses_remarks'")
    ).first()

    if not result_0044:
        script_0044 = MIGRATIONS_DIR / "0044_sales_expenses_remarks.postgres.sql"
        if script_0044.exists():
            with open(script_0044, "r", encoding="utf-8") as f:
                sql_0044 = f.read()
            clean_0044 = sql_0044.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0044))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0044_sales_expenses_remarks')"))
            applied.append("0044_sales_expenses_remarks")
            logger.info("Migration 0044_sales_expenses_remarks applied successfully.")

    # 11. Check if 0045 is applied
    result_0045 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0045_daily_remarks'")
    ).first()

    if not result_0045:
        script_0045 = MIGRATIONS_DIR / "0045_daily_remarks.postgres.sql"
        if script_0045.exists():
            with open(script_0045, "r", encoding="utf-8") as f:
                sql_0045 = f.read()
            clean_0045 = sql_0045.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0045))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0045_daily_remarks')"))
            applied.append("0045_daily_remarks")
            logger.info("Migration 0045_daily_remarks applied successfully.")

    # 12. Check if 0046 is applied
    result_0046 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0046_sales_expenses_bank_account'")
    ).first()

    if not result_0046:
        script_0046 = MIGRATIONS_DIR / "0046_sales_expenses_bank_account.postgres.sql"
        if script_0046.exists():
            with open(script_0046, "r", encoding="utf-8") as f:
                sql_0046 = f.read()
            clean_0046 = sql_0046.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0046))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0046_sales_expenses_bank_account')"))
            applied.append("0046_sales_expenses_bank_account")
            logger.info("Migration 0046_sales_expenses_bank_account applied successfully.")

    # 13. Check if 0047 is applied
    result_0047 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0047_sales_deposit_date'")
    ).first()

    if not result_0047:
        script_0047 = MIGRATIONS_DIR / "0047_sales_deposit_date.postgres.sql"
        if script_0047.exists():
            with open(script_0047, "r", encoding="utf-8") as f:
                sql_0047 = f.read()
            clean_0047 = sql_0047.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0047))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0047_sales_deposit_date')"))
            applied.append("0047_sales_deposit_date")
            logger.info("Migration 0047_sales_deposit_date applied successfully.")

    # 14. Check if 0048 is applied
    result_0048 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0048_bank_transactions_source_expense'")
    ).first()

    if not result_0048:
        script_0048 = MIGRATIONS_DIR / "0048_bank_transactions_source_expense.postgres.sql"
        if script_0048.exists():
            with open(script_0048, "r", encoding="utf-8") as f:
                sql_0048 = f.read()
            clean_0048 = sql_0048.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            conn.execute(text(clean_0048))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0048_bank_transactions_source_expense')"))
            applied.append("0048_bank_transactions_source_expense")
            logger.info("Migration 0048_bank_transactions_source_expense applied successfully.")

    # 15. Check if 0049 is applied
    result_0049 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0049_bank_shared_owners'")
    ).first()

    if not result_0049:
        script_0049 = MIGRATIONS_DIR / "0049_bank_shared_owners.postgres.sql"
        if script_0049.exists():
            with open(script_0049, "r", encoding="utf-8") as f:
                sql_0049 = f.read()
            for stmt in sql_0049.replace("BEGIN;", "").replace("COMMIT;", "").split(";"):
                body = "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()
                if body:
                    conn.execute(text(body))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0049_bank_shared_owners')"))
            applied.append("0049_bank_shared_owners")
            logger.info("Migration 0049_bank_shared_owners applied successfully.")

    # 16. Check if 0050 is applied
    result_0050 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0050_receivables_sale_cascade'")
    ).first()

    if not result_0050:
        script_0050 = MIGRATIONS_DIR / "0050_receivables_sale_cascade.postgres.sql"
        if script_0050.exists():
            # Own savepoint: if this fails, later migrations (e.g. 0051, which bank writes depend on) still apply
            try:
                with conn.begin_nested():
                    # One DO block: run it whole (it must not be split on semicolons)
                    conn.exec_driver_sql(script_0050.read_text(encoding="utf-8"))
                    conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0050_receivables_sale_cascade')"))
                applied.append("0050_receivables_sale_cascade")
                logger.info("Migration 0050_receivables_sale_cascade applied successfully.")
            except Exception as exc:
                logger.error("Migration 0050_receivables_sale_cascade failed and was skipped: %s", exc)

    # 17. Check if 0051 is applied
    result_0051 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0051_auth_data_retention'")
    ).first()

    if not result_0051:
        script_0051 = MIGRATIONS_DIR / "0051_auth_data_retention.postgres.sql"
        if script_0051.exists():
            sql_0051 = script_0051.read_text(encoding="utf-8")
            for stmt in sql_0051.replace("BEGIN;", "").replace("COMMIT;", "").split(";"):
                body = "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()
                if body:
                    conn.execute(text(body))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0051_auth_data_retention')"))
            applied.append("0051_auth_data_retention")
            logger.info("Migration 0051_auth_data_retention applied successfully.")

    # 18. Check if 0052 is applied
    result_0052 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0052_update_admin_email'")
    ).first()

    if not result_0052:
        script_0052 = MIGRATIONS_DIR / "0052_update_admin_email.postgres.sql"
        if script_0052.exists():
            sql_0052 = script_0052.read_text(encoding="utf-8")
            clean_0052 = sql_0052.replace("BEGIN;", "").replace("COMMIT;", "").strip()
            if clean_0052:
                conn.execute(text(clean_0052))
            conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0052_update_admin_email')"))
            applied.append("0052_update_admin_email")
            logger.info("Migration 0052_update_admin_email applied successfully.")

    # 19. Check if 0053 is applied: bank_transactions.entry_source
    result_0053 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0053_bank_transactions_entry_source'")
    ).first()

    if not result_0053:
        script_0053 = MIGRATIONS_DIR / "0053_bank_transactions_entry_source.postgres.sql"
        if script_0053.exists():
            import time as _time

            for attempt in range(1, 4):
                try:
                    with conn.begin_nested():
                        conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                        for stmt in _sql_statements(script_0053.read_text(encoding="utf-8")):
                            conn.execute(text(stmt))
                        conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0053_bank_transactions_entry_source')"))
                    applied.append("0053_bank_transactions_entry_source")
                    logger.info("Migration 0053_bank_transactions_entry_source applied successfully.")
                    break
                except Exception as exc:
                    logger.error("Migration 0053_bank_transactions_entry_source attempt %s failed: %s", attempt, exc)
                    if attempt < 3:
                        _time.sleep(2)

    # 20. 0054: client_ref on sales, expenses, receivables (offline queue dedupe, spec 0038)
    result_0054 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0054_client_ref_idempotency'")
    ).first()

    if not result_0054:
        script_0054 = MIGRATIONS_DIR / "0054_client_ref_idempotency.postgres.sql"
        if script_0054.exists():
            import time as _time

            for attempt in range(1, 4):
                try:
                    with conn.begin_nested():
                        conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                        for stmt in _sql_statements(script_0054.read_text(encoding="utf-8")):
                            conn.execute(text(stmt))
                        conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0054_client_ref_idempotency')"))
                    applied.append("0054_client_ref_idempotency")
                    logger.info("Migration 0054_client_ref_idempotency applied successfully.")
                    break
                except Exception as exc:
                    logger.error("Migration 0054_client_ref_idempotency attempt %s failed: %s", attempt, exc)
                    if attempt < 3:
                        _time.sleep(2)

    # 21. 0055: deleting the last sale/expense of a day deletes that day's remark (trigger + one-time cleanup)
    result_0055 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0055_daily_remarks_cascade'")
    ).first()

    if not result_0055:
        script_0055 = MIGRATIONS_DIR / "0055_daily_remarks_cascade.postgres.sql"
        if script_0055.exists():
            try:
                with conn.begin_nested():
                    conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                    conn.exec_driver_sql(script_0055.read_text(encoding="utf-8"))
                    conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0055_daily_remarks_cascade')"))
                applied.append("0055_daily_remarks_cascade")
                logger.info("Migration 0055_daily_remarks_cascade applied successfully.")
            except Exception as exc:
                logger.error("Migration 0055_daily_remarks_cascade failed and was skipped: %s", exc)

    # 22. 0056: deleting a sale/expense (any way, not only via the API) deletes its bank entries and fixes the balance
    result_0056 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0056_bank_entries_cascade'")
    ).first()

    if not result_0056:
        from app.db.bank_cascade import postgres_script

        try:
            with conn.begin_nested():
                conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                conn.exec_driver_sql(postgres_script())
                conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0056_bank_entries_cascade')"))
            applied.append("0056_bank_entries_cascade")
            logger.info("Migration 0056_bank_entries_cascade applied successfully.")
        except Exception as exc:
            logger.error("Migration 0056_bank_entries_cascade failed and was skipped: %s", exc)

    # 23. 0057: a sale's deposit status may only change together with a matching deposit date (blocks stale
    #     code, like the old startup backfill on other checkouts, from flipping sales behind the bank's back)
    result_0057 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0057_sale_deposit_guard'")
    ).first()

    if not result_0057:
        from app.db.sale_status_guard import postgres_script as guard_script

        try:
            with conn.begin_nested():
                conn.execute(text("SET LOCAL lock_timeout = '5s'"))
                conn.exec_driver_sql(guard_script())
                conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0057_sale_deposit_guard')"))
            applied.append("0057_sale_deposit_guard")
            logger.info("Migration 0057_sale_deposit_guard applied successfully.")
        except Exception as exc:
            logger.error("Migration 0057_sale_deposit_guard failed and was skipped: %s", exc)

    # 24. 0058: compound performance indexes for high-frequency transaction queries
    result_0058 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0058_compound_performance_indexes'")
    ).first()

    if not result_0058:
        script_0058 = MIGRATIONS_DIR / "0058_compound_performance_indexes.postgres.sql"
        if script_0058.exists():
            try:
                with conn.begin_nested():
                    with open(script_0058, "r", encoding="utf-8") as f:
                        for stmt in f.read().split(";"):
                            clean_stmt = "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()
                            if clean_stmt:
                                conn.execute(text(clean_stmt))
                    conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('0058_compound_performance_indexes')"))
                applied.append("0058_compound_performance_indexes")
                logger.info("Migration 0058_compound_performance_indexes applied successfully.")
            except Exception as exc:
                logger.error("Migration 0058_compound_performance_indexes failed and was skipped: %s", exc)

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

    # 8. Check if 0042 is applied
    result_0042 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0042_secure_rate_limiting'")
    ).first()

    if not result_0042:
        script_0042 = MIGRATIONS_DIR / "0042_secure_rate_limiting.sqlite.sql"
        if script_0042.exists():
            with open(script_0042, "r", encoding="utf-8") as f:
                for statement in f.read().split(";"):
                    lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                    clean_stmt = "\n".join(lines).strip()
                    if clean_stmt and "schema_migrations" not in clean_stmt:
                        conn.execute(text(clean_stmt))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0042_secure_rate_limiting')")
        )
        applied.append("0042_secure_rate_limiting")
        logger.info("SQLite migration 0042_secure_rate_limiting applied successfully.")

    # 9. Check if 0043 is applied
    result_0043 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0043_user_sessions'")
    ).first()

    if not result_0043:
        script_0043 = MIGRATIONS_DIR / "0043_user_sessions.sqlite.sql"
        if script_0043.exists():
            with open(script_0043, "r", encoding="utf-8") as f:
                for statement in f.read().split(";"):
                    lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                    clean_stmt = "\n".join(lines).strip()
                    if clean_stmt and "schema_migrations" not in clean_stmt:
                        conn.execute(text(clean_stmt))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0043_user_sessions')")
        )
        applied.append("0043_user_sessions")
        logger.info("SQLite migration 0043_user_sessions applied successfully.")

    # 10. Check if 0044 is applied
    result_0044 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0044_sales_expenses_remarks'")
    ).first()

    if not result_0044:
        sales_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'")
        ).first()
        expenses_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'")
        ).first()

        if sales_table_exists:
            sales_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(sales)")).fetchall()}
            if "remarks" not in sales_cols:
                conn.execute(text("ALTER TABLE sales ADD COLUMN remarks TEXT NULL"))

        if expenses_table_exists:
            expenses_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(expenses)")).fetchall()}
            if "remarks" not in expenses_cols:
                conn.execute(text("ALTER TABLE expenses ADD COLUMN remarks TEXT NULL"))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0044_sales_expenses_remarks')")
        )
        applied.append("0044_sales_expenses_remarks")
        logger.info("SQLite migration 0044_sales_expenses_remarks applied successfully.")

    # 11. Check if 0045 is applied
    result_0045 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0045_daily_remarks'")
    ).first()

    if not result_0045:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS daily_remarks (
                    daily_remark_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id INTEGER NOT NULL,
                    remark_date DATE NOT NULL,
                    kind VARCHAR(20) NOT NULL,
                    remarks TEXT NOT NULL,
                    updated_by VARCHAR(150) NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_daily_remarks_company_date_kind UNIQUE (company_id, remark_date, kind)
                )
                """
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_daily_remarks_company_id ON daily_remarks (company_id)")
        )
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0045_daily_remarks')")
        )
        applied.append("0045_daily_remarks")
        logger.info("SQLite migration 0045_daily_remarks applied successfully.")

    # 12. Check if 0046 is applied
    result_0046 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0046_sales_expenses_bank_account'")
    ).first()

    if not result_0046:
        for table in ("sales", "expenses"):
            table_exists = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}
            ).first()
            if table_exists:
                cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
                if "bank_account_id" not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN bank_account_id VARCHAR(100) NULL"))
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0046_sales_expenses_bank_account')")
        )
        applied.append("0046_sales_expenses_bank_account")
        logger.info("SQLite migration 0046_sales_expenses_bank_account applied successfully.")

    # 13. Check if 0047 is applied
    result_0047 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0047_sales_deposit_date'")
    ).first()

    if not result_0047:
        table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='sales'")
        ).first()
        if table_exists:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(sales)")).fetchall()}
            if "deposit_date" not in cols:
                conn.execute(text("ALTER TABLE sales ADD COLUMN deposit_date DATE NULL"))
            conn.execute(
                text(
                    "UPDATE sales SET deposit_date = transaction_date "
                    "WHERE deposit_status = 'Deposited' AND deposit_date IS NULL"
                )
            )
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0047_sales_deposit_date')")
        )
        applied.append("0047_sales_deposit_date")
        logger.info("SQLite migration 0047_sales_deposit_date applied successfully.")

    # 14. Check if 0048 is applied
    result_0048 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0048_bank_transactions_source_expense'")
    ).first()

    if not result_0048:
        table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_transactions'")
        ).first()
        if table_exists:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(bank_transactions)")).fetchall()}
            if "source_expense_id" not in cols:
                conn.execute(text("ALTER TABLE bank_transactions ADD COLUMN source_expense_id INTEGER NULL"))
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0048_bank_transactions_source_expense')")
        )
        applied.append("0048_bank_transactions_source_expense")
        logger.info("SQLite migration 0048_bank_transactions_source_expense applied successfully.")

    # 15. Check if 0049 is applied
    result_0049 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0049_bank_shared_owners'")
    ).first()

    if not result_0049:
        acct_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_accounts'")
        ).first()
        if acct_exists:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(bank_accounts)")).fetchall()}
            if "company_names" not in cols:
                conn.execute(text("ALTER TABLE bank_accounts ADD COLUMN company_names TEXT NULL"))
        tx_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_transactions'")
        ).first()
        if tx_exists:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(bank_transactions)")).fetchall()}
            if "company_name" not in cols:
                conn.execute(text("ALTER TABLE bank_transactions ADD COLUMN company_name VARCHAR(255) NULL"))
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0049_bank_shared_owners')")
        )
        applied.append("0049_bank_shared_owners")
        logger.info("SQLite migration 0049_bank_shared_owners applied successfully.")

    # 16. 0050: SQLite cannot alter a foreign key; the ORM-level cascade covers it, so just record the version.
    result_0050 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0050_receivables_sale_cascade'")
    ).first()
    if not result_0050:
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0050_receivables_sale_cascade')")
        )
        applied.append("0050_receivables_sale_cascade")

    # 17. Check if 0051 is applied
    result_0051 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0051_auth_data_retention'")
    ).first()
    if not result_0051:
        script_0051 = MIGRATIONS_DIR / "0051_auth_data_retention.sqlite.sql"
        if script_0051.exists():
            for statement in script_0051.read_text(encoding="utf-8").split(";"):
                lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                clean_stmt = "\n".join(lines).strip()
                if clean_stmt and "schema_migrations" not in clean_stmt:
                    conn.execute(text(clean_stmt))

        # Rebuild login_otp_challenges if otp_hmac has NOT NULL constraint in SQLite
        otp_table = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='login_otp_challenges'")
        ).first()
        if otp_table:
            otp_cols = conn.execute(text("PRAGMA table_info(login_otp_challenges)")).fetchall()
            otp_hmac_notnull = any(row[1] == "otp_hmac" and row[3] == 1 for row in otp_cols)
            if otp_hmac_notnull:
                conn.execute(
                    text(
                        """
                        CREATE TABLE login_otp_challenges_new (
                            otp_id VARCHAR(36) PRIMARY KEY,
                            challenge_id VARCHAR(36) NOT NULL,
                            user_id INTEGER NULL,
                            email VARCHAR(255) NOT NULL,
                            purpose VARCHAR(50) NOT NULL DEFAULT 'login_2fa',
                            ip_address VARCHAR(45) NOT NULL,
                            otp_hmac VARCHAR(64) NULL,
                            status VARCHAR(30) NOT NULL DEFAULT 'pending_delivery',
                            attempts INTEGER NOT NULL DEFAULT 0,
                            max_attempts INTEGER NOT NULL DEFAULT 5,
                            resend_count INTEGER NOT NULL DEFAULT 0,
                            last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            expires_at DATETIME NOT NULL,
                            consumed_at DATETIME NULL,
                            invalidated_at DATETIME NULL,
                            invalidation_reason VARCHAR(100) NULL,
                            delivery_outcome VARCHAR(50) NULL,
                            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        )
                        """
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO login_otp_challenges_new SELECT "
                        "otp_id, challenge_id, user_id, email, purpose, ip_address, otp_hmac, status, "
                        "attempts, max_attempts, resend_count, last_sent_at, expires_at, consumed_at, "
                        "invalidated_at, invalidation_reason, delivery_outcome, created_at, updated_at "
                        "FROM login_otp_challenges"
                    )
                )
                conn.execute(text("DROP TABLE login_otp_challenges"))
                conn.execute(text("ALTER TABLE login_otp_challenges_new RENAME TO login_otp_challenges"))
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_otp_challenges_session ON login_otp_challenges (challenge_id, status)")
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_otp_challenges_email_ip ON login_otp_challenges (email, ip_address)")
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires ON login_otp_challenges (expires_at)")
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_otp_challenges_retention ON login_otp_challenges (created_at, status)")
                )

            conn.execute(
                text(
                    "UPDATE login_otp_challenges SET otp_hmac = NULL "
                    "WHERE status IN ('used', 'expired', 'invalidated', 'delivery_failed') AND otp_hmac IS NOT NULL"
                )
            )

        # Rebuild user_invitations if token_hash has NOT NULL constraint in SQLite
        inv_table = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='user_invitations'")
        ).first()
        if inv_table:
            inv_cols = conn.execute(text("PRAGMA table_info(user_invitations)")).fetchall()
            token_hash_notnull = any(row[1] == "token_hash" and row[3] == 1 for row in inv_cols)
            if token_hash_notnull:
                conn.execute(
                    text(
                        """
                        CREATE TABLE user_invitations_new (
                            invitation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                            token_hash VARCHAR(64) NULL UNIQUE,
                            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                            purpose VARCHAR(30) NOT NULL DEFAULT 'initial_password_setup',
                            expires_at DATETIME NOT NULL,
                            claimed_at DATETIME NULL,
                            accepted_at DATETIME NULL,
                            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            created_by_user_id INTEGER NULL REFERENCES users(user_id) ON DELETE SET NULL,
                            CONSTRAINT chk_invitation_status CHECK (status IN ('PENDING', 'CLAIMED', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
                            CONSTRAINT chk_invitation_purpose CHECK (purpose IN ('initial_password_setup', 'password_reset'))
                        )
                        """
                    )
                )
                conn.execute(
                    text(
                        "INSERT INTO user_invitations_new "
                        "(invitation_id, user_id, token_hash, status, purpose, expires_at, claimed_at, accepted_at, created_at, created_by_user_id) "
                        "SELECT invitation_id, user_id, token_hash, status, "
                        "COALESCE(purpose, 'initial_password_setup'), expires_at, claimed_at, accepted_at, created_at, created_by_user_id "
                        "FROM user_invitations"
                    )
                )
                conn.execute(text("DROP TABLE user_invitations"))
                conn.execute(text("ALTER TABLE user_invitations_new RENAME TO user_invitations"))
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_user_invitations_token_status ON user_invitations(token_hash, status)")
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_user_invitations_user_purpose ON user_invitations(user_id, purpose, status)")
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS idx_user_invitations_user ON user_invitations(user_id)")
                )

            conn.execute(
                text(
                    "UPDATE user_invitations SET token_hash = NULL "
                    "WHERE status IN ('ACCEPTED', 'EXPIRED', 'REVOKED') AND token_hash IS NOT NULL"
                )
            )

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0051_auth_data_retention')")
        )
        applied.append("0051_auth_data_retention")
        logger.info("SQLite migration 0051_auth_data_retention applied successfully.")

    # Ensure payment_method column exists on sales and expenses in SQLite (schema parity guard)
    for _tbl in ("sales", "expenses"):
        _tbl_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": _tbl}
        ).first()
        if _tbl_exists:
            _cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({_tbl})")).fetchall()}
            if "payment_method" not in _cols:
                conn.execute(text(f"ALTER TABLE {_tbl} ADD COLUMN payment_method VARCHAR(100) NULL"))

    # 18. Check if 0052 is applied
    result_0052 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0052_update_admin_email'")
    ).first()

    if not result_0052:
        users_table_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        ).first()
        script_0052 = MIGRATIONS_DIR / "0052_update_admin_email.sqlite.sql"
        if users_table_exists and script_0052.exists():
            u_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()}
            if "is_admin" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            if "role" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(50) NULL"))
            for statement in script_0052.read_text(encoding="utf-8").split(";"):
                lines = [l for l in statement.splitlines() if not l.strip().startswith("--")]
                stmt = "\n".join(lines).strip()
                if stmt:
                    conn.execute(text(stmt))

        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0052_update_admin_email')")
        )
        applied.append("0052_update_admin_email")
        logger.info("SQLite migration 0052_update_admin_email applied successfully.")

    # 19. 0053: bank_transactions.entry_source
    result_0053 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0053_bank_transactions_entry_source'")
    ).first()
    if not result_0053:
        tx_exists = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_transactions'")
        ).first()
        if tx_exists:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(bank_transactions)")).fetchall()}
            if "entry_source" not in cols:
                conn.execute(text("ALTER TABLE bank_transactions ADD COLUMN entry_source VARCHAR(30) NULL"))
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0053_bank_transactions_entry_source')")
        )
        applied.append("0053_bank_transactions_entry_source")

    # 20. 0054: client_ref on sales, expenses, receivables (offline queue dedupe, spec 0038)
    result_0054 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0054_client_ref_idempotency'")
    ).first()
    if not result_0054:
        for table in ("sales", "expenses", "receivables"):
            exists = conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"), {"t": table}
            ).first()
            if not exists:
                continue
            cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
            if "client_ref" not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN client_ref VARCHAR(64) NULL"))
            conn.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS ux_{table}_client_ref ON {table} (client_ref)"))
        conn.execute(
            text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0054_client_ref_idempotency')")
        )
        applied.append("0054_client_ref_idempotency")

    # 21. 0056: deleting a sale/expense deletes its bank entries and fixes the balance (trigger)
    result_0056 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0056_bank_entries_cascade'")
    ).first()
    if not result_0056:
        from app.db.bank_cascade import install_sqlite_triggers

        install_sqlite_triggers(conn)
        conn.execute(text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0056_bank_entries_cascade')"))
        applied.append("0056_bank_entries_cascade")

    # 22. 0057: deposit status only changes together with a matching deposit date (trigger)
    result_0057 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0057_sale_deposit_guard'")
    ).first()
    if not result_0057:
        from app.db.sale_status_guard import install_sqlite_trigger

        install_sqlite_trigger(conn)
        conn.execute(text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0057_sale_deposit_guard')"))
        applied.append("0057_sale_deposit_guard")

    # 23. 0058: compound performance indexes for high-frequency queries
    result_0058 = conn.execute(
        text("SELECT 1 FROM schema_migrations WHERE version = '0058_compound_performance_indexes'")
    ).first()
    if not result_0058:
        index_specs = [
            ("sales", "CREATE INDEX IF NOT EXISTS idx_sales_company_transaction_date ON sales (company_id, transaction_date DESC)"),
            ("sales", "CREATE INDEX IF NOT EXISTS idx_sales_company_deposit_status ON sales (company_id, deposit_status, transaction_date DESC)"),
            ("expenses", "CREATE INDEX IF NOT EXISTS idx_expenses_company_expense_date ON expenses (company_id, expense_date DESC)"),
            ("bank_transactions", "CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date ON bank_transactions (bank_account_id, transaction_date DESC)"),
            ("bills", "CREATE INDEX IF NOT EXISTS idx_bills_company_due_date ON bills (company_id, due_date ASC)"),
            ("loan", "CREATE INDEX IF NOT EXISTS idx_loan_borrower_date ON loan (borrower, loan_date DESC)"),
            ("loan", "CREATE INDEX IF NOT EXISTS idx_loan_lender_date ON loan (lender, loan_date DESC)"),
        ]
        existing_tables = {
            row[0]
            for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
        }
        for tbl_name, idx_sql in index_specs:
            if tbl_name in existing_tables:
                try:
                    conn.execute(text(idx_sql))
                except Exception as exc:
                    logger.warning("SQLite index skipped on %s: %s", tbl_name, exc)
        conn.execute(text("INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0058_compound_performance_indexes')"))
        applied.append("0058_compound_performance_indexes")
        logger.info("SQLite migration 0058_compound_performance_indexes applied successfully.")

    conn.commit()
    return applied


def rollback_migration_0051(engine: Engine) -> None:
    """Reversible downgrade for migration 0051_auth_data_retention."""
    dialect = engine.dialect.name
    with engine.connect() as conn:
        if dialect == "postgresql":
            down_script = MIGRATIONS_DIR / "0051_auth_data_retention.down.postgres.sql"
            if down_script.exists():
                for stmt in down_script.read_text(encoding="utf-8").split(";"):
                    body = "\n".join(l for l in stmt.splitlines() if not l.strip().startswith("--")).strip()
                    if body:
                        conn.execute(text(body))
        else:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS login_rate_limits (
                        ip_address VARCHAR(45) PRIMARY KEY,
                        failed_attempts INTEGER NOT NULL DEFAULT 0,
                        locked_until DATETIME NULL,
                        last_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("DROP INDEX IF EXISTS ix_revoked_tokens_expires_at"))
            conn.execute(text("DROP INDEX IF EXISTS idx_rate_limits_retention"))
            conn.execute(text("DROP INDEX IF EXISTS idx_outbox_retention"))
            conn.execute(text("DROP INDEX IF EXISTS idx_user_sessions_created_at"))
            conn.execute(text("DELETE FROM schema_migrations WHERE version = '0051_auth_data_retention'"))
        conn.commit()

