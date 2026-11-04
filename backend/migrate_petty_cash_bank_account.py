"""
Migration: Add bank_account_id column to petty_cash_topups (spec 0012).
This is the funding bank Finance chooses when endorsing a petty cash top-up.
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
            if "bank_account_id" not in existing_cols:
                conn.execute(text("ALTER TABLE petty_cash_topups ADD COLUMN bank_account_id VARCHAR(100)"))
                print("[ADDED] bank_account_id column to petty_cash_topups")
            else:
                print("[SKIP] bank_account_id column already exists")
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
            if cols and "bank_account_id" not in cols:
                cur.execute("ALTER TABLE petty_cash_topups ADD COLUMN bank_account_id VARCHAR(100)")
                print(f"[ADDED] bank_account_id to SQLite: {path}")
                conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for petty_cash_topups bank_account_id field ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
