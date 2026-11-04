"""
Migration: create the tenant tables
"""
from sqlalchemy import inspect, text

import app.models  # noqa: F401  (registers every table on Base)
from app.db.session import Base, engine
from app.models.tenant import TenantLease, TenantLeasePayment

TABLES = (TenantLease.__table__, TenantLeasePayment.__table__)


def migrate() -> None:
    inspector = inspect(engine)
    for table in TABLES:
        if inspector.has_table(table.name):
            print(f"[SKIP] table {table.name} already exists")
        else:
            table.create(bind=engine, checkfirst=True)
            print(f"[CREATED] table {table.name}")

    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("NOTIFY pgrst, 'reload schema'"))
        print("[OK] Requested Supabase schema cache reload")


if __name__ == "__main__":
    print(f"--- Tenant tables migration (database: {engine.dialect.name}) ---")
    migrate()
    print("--- Migration finished ---")
