"""
Migration: Ensure balance column exists in petty_cash_wallets table.
Safe to run repeatedly on PostgreSQL and SQLite.
"""
import os
import sqlite3
from sqlalchemy import inspect, text

from app.db.session import engine


def migrate_engine() -> None:
    try:
        inspector = inspect(engine)
        existing_cols = {col["name"] for col in inspector.get_columns("petty_cash_wallets")}
        print(f"Current columns in petty_cash_wallets: {existing_cols}")

        with engine.begin() as conn:
            if "balance" not in existing_cols:
                conn.execute(text("ALTER TABLE petty_cash_wallets ADD COLUMN balance NUMERIC(15, 2) DEFAULT 0.00"))
                print("[ADDED] balance column to petty_cash_wallets")
            else:
                print("[SKIP] balance column already exists")
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
            cols = [c[1] for c in cur.execute("PRAGMA table_info(petty_cash_wallets)").fetchall()]
            if cols:
                if "balance" not in cols:
                    cur.execute("ALTER TABLE petty_cash_wallets ADD COLUMN balance NUMERIC(15, 2) DEFAULT 0.00")
                    print(f"[ADDED] balance to SQLite: {path}")
                conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for petty_cash_wallets.balance ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")

