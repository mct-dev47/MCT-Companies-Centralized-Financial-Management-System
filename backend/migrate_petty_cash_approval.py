"""
Migration: Add status, remark, reviewed_by, and reviewed_at columns to petty_cash_topups.
Safe to run repeatedly on PostgreSQL and SQLite.
"""
import os
import sqlite3
from sqlalchemy import inspect, text

from app.db.session import engine


def migrate_engine() -> None:
    try:
        inspector = inspect(engine)
        existing_cols = {col["name"] for col in inspector.get_columns("petty_cash_topups")}
        print(f"Current columns in petty_cash_topups: {existing_cols}")

        with engine.begin() as conn:
            if "status" not in existing_cols:
                conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN status VARCHAR(50) DEFAULT 'Approved'"))
                print("[ADDED] status column to petty_cash_topups")
            else:
                print("[SKIP] status column already exists")

            if "remark" not in existing_cols:
                conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN remark TEXT"))
                print("[ADDED] remark column to petty_cash_topups")
            else:
                print("[SKIP] remark column already exists")

            if "reviewed_by" not in existing_cols:
                conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN reviewed_by VARCHAR(100)"))
                print("[ADDED] reviewed_by column to petty_cash_topups")
            else:
                print("[SKIP] reviewed_by column already exists")

            if "reviewed_at" not in existing_cols:
                conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE"))
                print("[ADDED] reviewed_at column to petty_cash_topups")
            else:
                print("[SKIP] reviewed_at column already exists")
    except Exception as e:
        print(f"[WARN] Primary database migration notice: {e}")


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db"]
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            cols = [c[1] for c in cur.execute("PRAGMA table_info(petty_cash_topups)").fetchall()]
            if cols:
                if "status" not in cols:
                    cur.execute("ALTER TABLE petty_cash_topups ADD COLUMN status VARCHAR(50) DEFAULT 'Approved'")
                    print(f"[ADDED] status to SQLite: {path}")
                if "remark" not in cols:
                    cur.execute("ALTER TABLE petty_cash_topups ADD COLUMN remark TEXT")
                    print(f"[ADDED] remark to SQLite: {path}")
                if "reviewed_by" not in cols:
                    cur.execute("ALTER TABLE petty_cash_topups ADD COLUMN reviewed_by VARCHAR(100)")
                    print(f"[ADDED] reviewed_by to SQLite: {path}")
                if "reviewed_at" not in cols:
                    cur.execute("ALTER TABLE petty_cash_topups ADD COLUMN reviewed_at TIMESTAMP")
                    print(f"[ADDED] reviewed_at to SQLite: {path}")
                conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for petty_cash_topups approval fields ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
