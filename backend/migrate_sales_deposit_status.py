import sqlite3
import os

db_paths = ["mct_financial.db", "backend/mct_financial.db"]

for db_path in db_paths:
    if not os.path.exists(db_path):
        continue
    print(f"\n--- Migrating {db_path} for spec 0038 ---")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if "sales" not in tables:
        print(f"Skipping {db_path} (no sales table)")
        conn.close()
        continue

    cols = [c[1] for c in cursor.execute("PRAGMA table_info(sales)").fetchall()]
    if "payment_status" not in cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN payment_status VARCHAR(50) DEFAULT 'Paid'")
        print("Added payment_status column to sales table.")

    if "deposit_status" not in cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN deposit_status VARCHAR(50) DEFAULT 'Not Deposited'")
        print("Added deposit_status column to sales table.")

    # Safe backfill (AC-7)
    cursor.execute("UPDATE sales SET payment_status = 'Paid' WHERE payment_status IS NULL OR payment_status = ''")
    cursor.execute("UPDATE sales SET deposit_status = 'Deposited' WHERE payment_status = 'Paid' AND (deposit_status IS NULL OR deposit_status = '' OR deposit_status = 'Not Deposited')")
    cursor.execute("UPDATE sales SET deposit_status = 'Not Deposited' WHERE payment_status IN ('Unpaid', 'Pending')")

    conn.commit()
    print("Backfill applied successfully.")
    conn.close()

