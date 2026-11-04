"""
Adds the logo_url column to the company table.

Safe to run more than once across both PostgreSQL and SQLite.

Usage (from backend/):
    python migrate_company_logo_url.py
"""
import os
import sqlite3
from sqlalchemy import inspect, text

from app.db.session import engine


def migrate_engine() -> None:
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("company")}
    if "logo_url" in columns:
        print("[SKIP] company.logo_url already exists in primary database")
        return

    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE company ADD COLUMN logo_url TEXT"))
        print("[ADDED] company.logo_url to primary database")


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db"]
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            cols = [c[1] for c in cur.execute("PRAGMA table_info(company)").fetchall()]
            if cols and "logo_url" not in cols:
                cur.execute("ALTER TABLE company ADD COLUMN logo_url TEXT")
                conn.commit()
                print(f"[ADDED] company.logo_url to SQLite: {path}")
            else:
                print(f"[SKIP] company.logo_url already in SQLite: {path}")
            conn.close()
        except Exception as e:
            print(f"[ERROR] Migrating {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for company.logo_url ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")
