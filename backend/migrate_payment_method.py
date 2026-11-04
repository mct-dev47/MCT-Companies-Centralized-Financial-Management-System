"""
Adds the payment_method column to the sales and expenses tables.

The models and endpoints already write payment_method (e.g. "Cash", "GCash",
"Petty Cash"), but databases created before it existed are missing the column,
so the value was silently dropped and petty cash queries failed.

Safe to run more than once.

Usage (from backend/):
    python migrate_payment_method.py
"""
from sqlalchemy import inspect, text

from app.db.session import engine


TABLES = ("sales", "expenses")


def migrate() -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in TABLES:
            columns = {col["name"] for col in inspector.get_columns(table)}
            if "payment_method" in columns:
                print(f"[SKIP] {table}.payment_method already exists")
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN payment_method VARCHAR(100)"))
            print(f"[ADDED] {table}.payment_method")


if __name__ == "__main__":
    migrate()
