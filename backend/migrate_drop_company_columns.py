"""
Drops contact_person, email, and current_balance columns from the company table.

Safe to run more than once across both PostgreSQL and SQLite.

Usage (from backend/):
    python migrate_drop_company_columns.py
"""
import os
import sqlite3
from sqlalchemy import inspect, text

from app.db.session import engine


def migrate_engine() -> None:
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("company")}
    
    cols_to_drop = ["contact_person", "email", "current_balance"]
    to_drop = [c for c in cols_to_drop if c in columns]
    if not to_drop:
        print("[SKIP] Columns already dropped in primary database")
        return

    with engine.begin() as conn:
        for c in to_drop:
            conn.execute(text(f"ALTER TABLE company DROP COLUMN IF EXISTS {c} CASCADE"))
            print(f"[DROPPED] company.{c} from primary database")


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db"]
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            cols = [c[1] for c in cur.execute("PRAGMA table_info(company)").fetchall()]
            cols_to_drop = ["contact_person", "email", "current_balance"]
            for c in cols_to_drop:
                if c in cols:
                    try:
                        cur.execute(f"ALTER TABLE company DROP COLUMN {c}")
                        conn.commit()
                        print(f"[DROPPED] company.{c} in SQLite: {path}")
                    except Exception as e:
                        print(f"[WARN] SQLite drop {c}: {e}")
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration to Drop company columns ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
