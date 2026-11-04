import sqlite3
import os

db_paths = ['mct_financial.db', 'backend/mct_financial.db']

for db_path in db_paths:
    if not os.path.exists(db_path):
        continue
    print(f"\n--- Migrating {db_path} ---")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check if users table exists
    tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if 'users' not in tables:
        print(f"Skipping {db_path} (no users table)")
        conn.close()
        continue

    # Check and add role column to users
    cols = [c[1] for c in cursor.execute('PRAGMA table_info(users)').fetchall()]
    if 'role' not in cols:
        cursor.execute("ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'company'")
        cursor.execute("UPDATE users SET role = 'admin' WHERE is_admin = 1")
        conn.commit()
        print("Added role column to users table.")

    # Ensure demo accounts exist in SQLite
    existing_emails = {row[0].lower(): row[1] for row in cursor.execute("SELECT email, user_id FROM users").fetchall()}

    # Ensure existing primary admin account has admin role and is_admin set
    cursor.execute("UPDATE users SET role = 'admin', is_admin = 1 WHERE user_id = 1 OR is_admin = 1")
    conn.commit()

    # Separate Audit user (Same frontend as admin, minus company & user management)
    if "audit@mct.com" not in existing_emails:
        cursor.execute("""
            INSERT INTO users (name, email, role, is_admin, company_id)
            VALUES ('Audit Officer', 'audit@mct.com', 'audit', 0, NULL)
        """)
        conn.commit()
        print("Inserted audit@mct.com (role: audit)")
    else:
        cursor.execute("UPDATE users SET name = 'Audit Officer', role = 'audit', is_admin = 0 WHERE lower(email) = 'audit@mct.com'")
        conn.commit()

    # Finance user
    if "finance@mct.com" not in existing_emails:
        cursor.execute("""
            INSERT INTO users (name, email, role, is_admin, company_id)
            VALUES ('Finance Officer', 'finance@mct.com', 'finance', 0, NULL)
        """)
        conn.commit()
        print("Inserted finance@mct.com (role: finance)")

    # Company user (Temporary Employee)
    if "temporaryemployee@gmail.com" not in existing_emails:
        cursor.execute("""
            INSERT INTO users (name, email, role, is_admin, company_id)
            VALUES ('Temporary Employee', 'temporaryemployee@gmail.com', 'company', 0, 3)
        """)
        conn.commit()
        print("Inserted temporaryemployee@gmail.com (role: company, company_id: 3)")

    print(f"Users in {db_path}:")
    for row in cursor.execute("SELECT user_id, email, name, role, is_admin, company_id FROM users").fetchall():
        print(row)

    conn.close()
