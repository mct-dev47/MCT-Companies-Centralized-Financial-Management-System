"""
Migration: Add three-tier endorsement and audit approval columns to loan and petty_cash_topups.
"""
from sqlalchemy import text
from app.db.session import engine

def migrate():
    with engine.connect() as conn:
        print("Migrating petty_cash_topups table...")
        conn.execute(text("""
            ALTER TABLE petty_cash_topups
            ADD COLUMN IF NOT EXISTS endorsed_by VARCHAR(100),
            ADD COLUMN IF NOT EXISTS endorsed_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS finance_remark TEXT;
        """))

        print("Migrating loan table...")
        conn.execute(text("""
            ALTER TABLE loan
            ADD COLUMN IF NOT EXISTS endorsed_by VARCHAR(100),
            ADD COLUMN IF NOT EXISTS endorsed_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS finance_remark TEXT,
            ADD COLUMN IF NOT EXISTS audit_reviewed_by VARCHAR(100),
            ADD COLUMN IF NOT EXISTS audit_reviewed_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS audit_remark TEXT;
        """))

        conn.commit()
        print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
