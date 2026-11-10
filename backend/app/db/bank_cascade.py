"""Database triggers: deleting a sale or expense deletes its bank entries and fixes the bank balance.

The API already does this on delete, but a row removed any other way (Supabase table editor, SQL, a script,
another backend copy on old code) used to leave its bank entries behind, so the bank kept money the
Transactions ledger no longer counts. A trigger runs for every delete, whoever makes it.

The trigger body is the same SQL for Postgres and SQLite: first re-derive each affected account's balance
from its entries minus the ones being removed, then remove them (the same rule BankService._sync_balance uses).
"""

# (table, its id column, the bank_transactions link column)
_LINKS = (
    ("sales", "sales_id", "source_sale_id"),
    ("expenses", "expense_id", "source_expense_id"),
)


def _body(id_col: str, link_col: str) -> str:
    return (
        "UPDATE bank_accounts SET current_balance = starting_balance + COALESCE(("
        "SELECT SUM(COALESCE(t.deposit, 0) - COALESCE(t.withdrawal, 0)) FROM bank_transactions t "
        f"WHERE t.bank_account_id = bank_accounts.id AND (t.{link_col} IS NULL OR t.{link_col} <> OLD.{id_col})), 0) "
        f"WHERE id IN (SELECT bank_account_id FROM bank_transactions WHERE {link_col} = OLD.{id_col}); "
        f"DELETE FROM bank_transactions WHERE {link_col} = OLD.{id_col};"
    )


def postgres_script() -> str:
    parts = []
    for table, id_col, link_col in _LINKS:
        fn = f"purge_bank_entries_of_deleted_{table}"
        trg = f"trg_{table}_bank_cascade"
        parts.append(
            f"CREATE OR REPLACE FUNCTION {fn}() RETURNS trigger AS $$\n"
            f"BEGIN\n    {_body(id_col, link_col)}\n    RETURN NULL;\nEND;\n$$ LANGUAGE plpgsql;\n"
            f"DROP TRIGGER IF EXISTS {trg} ON {table};\n"
            f"CREATE TRIGGER {trg} AFTER DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION {fn}();\n"
        )
    return "\n".join(parts)


def install_sqlite_triggers(conn) -> None:
    """Create the triggers on SQLite (only for tables that exist)."""
    for table, id_col, link_col in _LINKS:
        exists = conn.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name IN (?, 'bank_transactions', 'bank_accounts')",
            (table,),
        ).fetchall()
        if len(exists) < 3:
            continue
        conn.exec_driver_sql(
            f"CREATE TRIGGER IF NOT EXISTS trg_{table}_bank_cascade AFTER DELETE ON {table} FOR EACH ROW "
            f"BEGIN {_body(id_col, link_col)} END;"
        )
