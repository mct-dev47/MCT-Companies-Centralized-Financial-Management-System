"""
migrate_audit_log_schema.py
---------------------------
Ensures the local fallback SQLite / PostgreSQL audit_logs table has all
required columns (action_category, ip_address, details).
"""

import sqlite3
import os
import sys

def migrate_local_sqlite():
    db_path = os.path.join(os.path.dirname(__file__), "mct_financial.db")
    if not os.path.exists(db_path):
        print(f"No local database found at {db_path}, skipping.")
        return

    con = sqlite3.connect(db_path)
    cur = con.cursor()

    # Check existing columns
    cur.execute("PRAGMA table_info(audit_logs)")
    columns = [col[1] for col in cur.fetchall()]
    print(f"Current audit_logs columns in SQLite: {columns}")

    needed_columns = {
        "action_category": "TEXT",
        "ip_address": "TEXT",
        "details": "TEXT"
    }

    for col_name, col_type in needed_columns.items():
        if col_name not in columns:
            print(f"Adding column '{col_name}' ({col_type}) to audit_logs...")
            cur.execute(f"ALTER TABLE audit_logs ADD COLUMN {col_name} {col_type};")

    con.commit()
    con.close()
    print("Migration complete. Updated audit_logs schema.")

if __name__ == "__main__":
    migrate_local_sqlite()

