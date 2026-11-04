"""
Migration: Add audit columns to sales and expenses (spec 0014).

  audit_status   VARCHAR(20)  NOT NULL DEFAULT 'Pending Audit'
  audited_by     VARCHAR(100) NULL
  audited_at     TIMESTAMP    NULL
  audit_remarks  TEXT         NULL

Safe to run repeatedly on PostgreSQL and SQLite. Existing rows get 'Pending Audit'.
"""
import os
import sqlite3
from sqlalchemy import inspect, text
from app.db.session import engine

TABLES = ("sales", "expenses")


def migrate_engine() -> None:
    try:
        inspector = inspect(engine)
        is_pg = engine.dialect.name == "postgresql"
        ts_type = "TIMESTAMP WITH TIME ZONE" if is_pg else "TIMESTAMP"
        columns = {
            "audit_status": "VARCHAR(20) NOT NULL DEFAULT 'Pending Audit'",
            "audited_by": "VARCHAR(100)",
            "audited_at": ts_type,
            "audit_remarks": "TEXT",
        }
        with engine.begin() as conn:
            for table in TABLES:
                if not inspector.has_table(table):
                    print(f"[SKIP] table {table} does not exist")
                    continue
                existing = {col["name"] for col in inspector.get_columns(table)}
                for name, ddl in columns.items():
                    if name in existing:
                        print(f"[SKIP] {table}.{name} already exists")
                    else:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                        print(f"[ADDED] {table}.{name}")
            if is_pg:
                # Ask the Supabase REST API (PostgREST) to reload its schema cache so select("*") sees the new columns.
                conn.execute(text("NOTIFY pgrst, 'reload schema'"))
                print("[OK] Requested Supabase schema cache reload")
    except Exception as e:
        print(f"[WARN] Primary database migration notice: {e}")


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db"]
    columns = {
        "audit_status": "VARCHAR(20) NOT NULL DEFAULT 'Pending Audit'",
        "audited_by": "VARCHAR(100)",
        "audited_at": "TIMESTAMP",
        "audit_remarks": "TEXT",
    }
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            for table in TABLES:
                cols = [c[1] for c in cur.execute(f"PRAGMA table_info({table})").fetchall()]
                if not cols:
                    continue
                for name, ddl in columns.items():
                    if name not in cols:
                        cur.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                        print(f"[ADDED] {table}.{name} to SQLite: {path}")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for sales/expenses audit columns (spec 0014) ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
