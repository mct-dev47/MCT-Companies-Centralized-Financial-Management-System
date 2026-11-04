"""
Migration script to add cycle and late payment tracking columns to lending_transactions.
Adds:
- cycle_index (INTEGER, nullable)
- cycle_due_date (DATE, nullable)
- is_late (BOOLEAN, default FALSE)
- days_late (INTEGER, default 0)

Safe to run multiple times across PostgreSQL and SQLite.
"""
import os
import sqlite3
from sqlalchemy import inspect, text
from app.db.session import engine


def migrate_engine() -> None:
    inspector = inspect(engine)
    if "lending_transactions" not in inspector.get_table_names():
        print("[SKIP] Table lending_transactions not found in primary database")
        return

    columns = {col["name"] for col in inspector.get_columns("lending_transactions")}

    columns_to_add = [
        ("cycle_index", "INTEGER NULL"),
        ("cycle_due_date", "DATE NULL"),
        ("is_late", "BOOLEAN DEFAULT FALSE"),
        ("days_late", "INTEGER DEFAULT 0"),
    ]

    with engine.begin() as conn:
        for col_name, col_def in columns_to_add:
            if col_name not in columns:
                try:
                    conn.execute(text(f"ALTER TABLE lending_transactions ADD COLUMN {col_name} {col_def}"))
                    print(f"[ADDED] lending_transactions.{col_name}")
                except Exception as e:
                    print(f"[ERROR] Adding {col_name}: {e}")
            else:
                print(f"[EXISTS] lending_transactions.{col_name}")


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db", "app.db", "backend/app.db"]
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            if "lending_transactions" not in tables:
                conn.close()
                continue

            columns = {col[1] for col in cur.execute("PRAGMA table_info(lending_transactions)").fetchall()}
            columns_to_add = [
                ("cycle_index", "INTEGER"),
                ("cycle_due_date", "DATE"),
                ("is_late", "BOOLEAN DEFAULT 0"),
                ("days_late", "INTEGER DEFAULT 0"),
            ]
            for col_name, col_def in columns_to_add:
                if col_name not in columns:
                    cur.execute(f"ALTER TABLE lending_transactions ADD COLUMN {col_name} {col_def}")
                    print(f"[SQLITE ADDED] {path}: lending_transactions.{col_name}")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[SQLITE ERROR] {path}: {e}")


if __name__ == "__main__":
    print("Running lending_transactions late payment columns migration...")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("Migration complete.")

