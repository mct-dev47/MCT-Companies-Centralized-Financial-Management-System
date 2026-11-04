import sys
from decimal import Decimal
sys.path.insert(0, 'backend')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from app.db.session import engine
from sqlalchemy import text

# Mapping: Old company_id -> New company_id
ID_MAPPING = {
    3: 1,    # MCTolentino Hospitality Business Corporation
    28: 2,   # MyCity.Kitchen Corporation
    8: 3,    # JK Global Printing Service
    9: 4,    # Speedfire Construction & Trading Corporation
    10: 5,   # JK Property and Ventures Corporation
    11: 6,   # Golden Jupiter Property Ventures Corporation
    14: 7,   # FILCAP Prime Holdings Corp.
    15: 8,   # MEDSYS Uni Horizon Pharma Corporation | Arcade
    16: 9,   # Far East Asia Trading Corporation
    17: 10,  # M.C Tolentino College Foundation, Incorporation
    18: 11,  # Bagong Bansa May Pag Asa Movement, Incorporation
    19: 12,  # Bookworld Systems Solutions & Technologies Corporation
    20: 13,  # MEDSYS Uni Horizon Pharma Corporation | Sapamanai
    21: 14,  # MEDSYS Uni Horizon Pharma Corporation | Regalado
}

OFFSET = 10000

def run_migration():
    with engine.connect() as conn:
        with conn.begin():
            print("Step 1: Dropping foreign key constraints referencing company...")
            conn.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_company_id_fkey;"))
            conn.execute(text("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_company_id_fkey;"))
            conn.execute(text("ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_company_id_fkey;"))
            conn.execute(text("ALTER TABLE petty_cash_topups DROP CONSTRAINT IF EXISTS petty_cash_topups_company_id_fkey;"))
            conn.execute(text("ALTER TABLE petty_cash_wallets DROP CONSTRAINT IF EXISTS petty_cash_wallets_company_id_fkey;"))
            conn.execute(text("ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS user_companies_company_id_fkey;"))
            conn.execute(text("ALTER TABLE tenant_leases DROP CONSTRAINT IF EXISTS tenant_leases_company_id_fkey;"))

            print("Step 2: Shifting old IDs to intermediate offset IDs (+10000)...")
            for old_id in ID_MAPPING.keys():
                temp_id = old_id + OFFSET
                conn.execute(text(f"UPDATE company SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE users SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE user_companies SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE bills SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE petty_cash_topups SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE petty_cash_wallets SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE tenant_leases SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE audit_logs SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE bank_accounts SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE sales SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE expenses SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE loan SET borrower = {temp_id} WHERE borrower = {old_id}"))
                conn.execute(text(f"UPDATE loan SET lender = {temp_id} WHERE lender = {old_id}"))
                conn.execute(text(f"UPDATE budget SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE cash_inflow SET company_id = {temp_id} WHERE company_id = {old_id}"))
                conn.execute(text(f"UPDATE staff_credits SET company_id = {temp_id} WHERE company_id = {old_id}"))

            print("Step 3: Updating intermediate IDs to final chronological IDs (1..14)...")
            for old_id, new_id in ID_MAPPING.items():
                temp_id = old_id + OFFSET
                conn.execute(text(f"UPDATE company SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE users SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE user_companies SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE bills SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE petty_cash_topups SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE petty_cash_wallets SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE tenant_leases SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE audit_logs SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE bank_accounts SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE sales SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE expenses SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE loan SET borrower = {new_id} WHERE borrower = {temp_id}"))
                conn.execute(text(f"UPDATE loan SET lender = {new_id} WHERE lender = {temp_id}"))
                conn.execute(text(f"UPDATE budget SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE cash_inflow SET company_id = {new_id} WHERE company_id = {temp_id}"))
                conn.execute(text(f"UPDATE staff_credits SET company_id = {new_id} WHERE company_id = {temp_id}"))

            print("Step 4: Recreating foreign key constraints...")
            conn.execute(text("ALTER TABLE users ADD CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE SET NULL;"))
            conn.execute(text("ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE SET NULL;"))
            conn.execute(text("ALTER TABLE bills ADD CONSTRAINT bills_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE petty_cash_topups ADD CONSTRAINT petty_cash_topups_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE petty_cash_wallets ADD CONSTRAINT petty_cash_wallets_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE user_companies ADD CONSTRAINT user_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE CASCADE;"))
            conn.execute(text("ALTER TABLE tenant_leases ADD CONSTRAINT tenant_leases_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(company_id) ON DELETE CASCADE;"))

            print("Step 5: Resetting company_company_id_seq to 14...")
            conn.execute(text("SELECT setval('public.company_company_id_seq', 14, true);"))

            print("Migration committed successfully!")

if __name__ == "__main__":
    run_migration()

