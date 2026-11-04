"""
Drops category and account_no columns from the bills table.

Safe to run more than once across both PostgreSQL and SQLite.

Usage (from backend/):
    python migrate_drop_bill_columns.py
"""
import os
import sqlite3
from sqlalchemy import inspect, text

from app.db.session import engine


def migrate_engine() -> None:
    inspector = inspect(engine)
    if "bills" not in inspector.get_table_names():
        print("[SKIP] Table bills not found in primary database")
        return

    columns = {col["name"] for col in inspector.get_columns("bills")}
    
    cols_to_drop = ["category", "account_no"]
    to_drop = [c for c in cols_to_drop if c in columns]
    if not to_drop:
        print("[SKIP] Columns already dropped in primary database")
        return

    with engine.begin() as conn:
        for c in to_drop:
            try:
                conn.execute(text(f"ALTER TABLE bills DROP COLUMN IF EXISTS {c} CASCADE"))
                print(f"[DROPPED] bills.{c} from primary database")
            except Exception as e:
                print(f"[WARN] Error dropping bills.{c}: {e}")


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db", "app.db", "backend/app.db"]
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            if "bills" not in tables:
                conn.close()
                continue

            cols = [c[1] for c in cur.execute("PRAGMA table_info(bills)").fetchall()]
            cols_to_drop = ["category", "account_no"]
            for c in cols_to_drop:
                if c in cols:
                    try:
                        cur.execute(f"ALTER TABLE bills DROP COLUMN {c}")
                        conn.commit()
                        print(f"[DROPPED] bills.{c} in SQLite: {path}")
                    except Exception as e:
                        print(f"[WARN] SQLite drop {c} in {path}: {e}")
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration to Drop bills columns (category, account_no) ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
