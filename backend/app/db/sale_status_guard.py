"""Database guard: a sale's deposit status may only change together with a matching deposit date.

Deposited needs a deposit date; Not Deposited has none. Every API path changes the two together. An old
startup backfill (still on any copy of the code that predates the fix, e.g. a teammate's checkout) flipped
statuses in raw SQL without touching the date, so the Transactions ledger and the bank stopped matching.
This trigger lives in the database, so it protects the data whichever code version is connected: an
inconsistent status change is skipped (the rest of the database is untouched).
"""

# Row is inconsistent after the change: status says one thing, the date says the other.
_INCONSISTENT = (
    "((NEW.deposit_status = 'Deposited' AND NEW.deposit_date IS NULL) "
    "OR (NEW.deposit_status <> 'Deposited' AND NEW.deposit_date IS NOT NULL))"
)


def postgres_script() -> str:
    return (
        "CREATE OR REPLACE FUNCTION guard_sale_deposit_status() RETURNS trigger AS $$\n"
        "BEGIN\n"
        f"    IF NEW.deposit_status IS DISTINCT FROM OLD.deposit_status AND {_INCONSISTENT} THEN\n"
        # No percent sign here: the driver would read it as a bind placeholder and the script would fail
        "        RAISE WARNING USING MESSAGE = 'Skipped deposit status change on sale ' || OLD.sales_id || ' (no matching deposit date)';\n"
        "        RETURN NULL;\n"
        "    END IF;\n"
        "    RETURN NEW;\n"
        "END;\n"
        "$$ LANGUAGE plpgsql;\n"
        "DROP TRIGGER IF EXISTS trg_sales_deposit_guard ON sales;\n"
        "CREATE TRIGGER trg_sales_deposit_guard BEFORE UPDATE ON sales "
        "FOR EACH ROW EXECUTE FUNCTION guard_sale_deposit_status();\n"
    )


def install_sqlite_trigger(conn) -> None:
    exists = conn.exec_driver_sql("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales'").first()
    if not exists:
        return
    conn.exec_driver_sql(
        "CREATE TRIGGER IF NOT EXISTS trg_sales_deposit_guard BEFORE UPDATE ON sales FOR EACH ROW "
        f"WHEN (NEW.deposit_status IS NOT OLD.deposit_status) AND {_INCONSISTENT} "
        "BEGIN SELECT RAISE(IGNORE); END;"
    )
