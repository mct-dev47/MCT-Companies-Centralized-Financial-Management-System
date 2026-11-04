import os
from sqlalchemy import text
from app.db.session import SessionLocal, engine

def run_migration():
    db = SessionLocal()
    try:
        # 1. Ensure user_companies table exists in PostgreSQL
        print("Creating user_companies table if not exists...")
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS user_companies (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                company_id BIGINT NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_user_company UNIQUE (user_id, company_id)
            );
        """))
        db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);
        """))
        db.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);
        """))

        # 2. Ensure photo_url column exists in users
        db.execute(text("""
            ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
        """))

        # 3. Seed user_companies from existing users.company_id
        db.execute(text("""
            INSERT INTO user_companies (user_id, company_id)
            SELECT user_id, company_id FROM users
            WHERE company_id IS NOT NULL
            ON CONFLICT (user_id, company_id) DO NOTHING;
        """))
        db.commit()
        print("PostgreSQL migration completed successfully.")
    except Exception as e:
        db.rollback()
        print("PostgreSQL migration error:", e)
    finally:
        db.close()

    # Also SQLite fallback if file exists
    sqlite_path = os.path.join(os.path.dirname(__file__), "mct_financial.db")
    if os.path.exists(sqlite_path):
        import sqlite3
        conn = sqlite3.connect(sqlite_path)
        cur = conn.cursor()
        try:
            # Check photo_url
            cols = [r[1] for r in cur.execute("PRAGMA table_info(users)").fetchall()]
            if "photo_url" not in cols:
                cur.execute("ALTER TABLE users ADD COLUMN photo_url TEXT;")
            if "role" not in cols:
                cur.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'company';")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_companies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                    company_id INTEGER NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, company_id)
                );
            """)
            conn.commit()
            print("SQLite migration completed successfully.")
        except Exception as e:
            print("SQLite migration error:", e)
        finally:
            conn.close()

if __name__ == "__main__":
    run_migration()
