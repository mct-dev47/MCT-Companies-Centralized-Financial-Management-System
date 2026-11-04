"""
Adds the petty_cash column to the company table.

Safe to run more than once across both PostgreSQL and SQLite.

Usage (from backend/):
    python migrate_company_petty_cash.py
"""
import os
import sqlite3
from sqlalchemy import inspect, text

from app.db.session import engine


def migrate_engine() -> None:
    try:
        inspector = inspect(engine)
        columns = {col["name"] for col in inspector.get_columns("company")}
        if "petty_cash" in columns:
            print("[SKIP] company.petty_cash already exists in primary database")
            return

        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE company ADD COLUMN petty_cash NUMERIC(15, 2) DEFAULT 0.00"))
            print("[ADDED] company.petty_cash to primary database")
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
            cols = [c[1] for c in cur.execute("PRAGMA table_info(company)").fetchall()]
            if cols and "petty_cash" not in cols:
                cur.execute("ALTER TABLE company ADD COLUMN petty_cash NUMERIC(15, 2) DEFAULT 0.00")
                conn.commit()
                print(f"[ADDED] company.petty_cash to SQLite: {path}")
            else:
                print(f"[SKIP] company.petty_cash already in SQLite: {path}")
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for company.petty_cash ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
