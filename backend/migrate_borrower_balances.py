"""
Migration script to add persistent ledger totals to borrowers table:
- total_penalties NUMERIC(15, 2) DEFAULT 0.00
- amount_paid NUMERIC(15, 2) DEFAULT 0.00
- remaining_balance NUMERIC(15, 2) DEFAULT 0.00

Safe to run multiple times across PostgreSQL (Supabase) and SQLite.
"""
import os
import sqlite3
from decimal import Decimal
from sqlalchemy import inspect, text
from app.db.session import engine, SessionLocal
from app.models import Borrower, LendingTransaction
from app.services.lending_service import LendingService


def migrate_engine() -> None:
    inspector = inspect(engine)
    if "borrowers" not in inspector.get_table_names():
        print("[SKIP] Table borrowers not found in primary database")
        return

    columns = {col["name"] for col in inspector.get_columns("borrowers")}

    columns_to_add = [
        ("total_penalties", "NUMERIC(15, 2) DEFAULT 0.00"),
        ("amount_paid", "NUMERIC(15, 2) DEFAULT 0.00"),
        ("remaining_balance", "NUMERIC(15, 2) DEFAULT 0.00"),
    ]

    with engine.begin() as conn:
        for col_name, col_def in columns_to_add:
            if col_name not in columns:
                try:
                    conn.execute(text(f"ALTER TABLE borrowers ADD COLUMN {col_name} {col_def}"))
                    print(f"[ADDED] borrowers.{col_name}")
                except Exception as e:
                    print(f"[ERROR] Adding {col_name}: {e}")
            else:
                print(f"[EXISTS] borrowers.{col_name}")

    # Synchronize all existing borrower balances in Supabase
    db = SessionLocal()
    try:
        borrowers = db.query(Borrower).all()
        print(f"[SYNC] Synchronizing balances for {len(borrowers)} borrowers in primary DB...")
        for b in borrowers:
            freq = b.payment_frequency or "Daily"
            term_days = b.term_days or (40 if freq == "Daily" else 60)
            txs = (
                db.query(LendingTransaction)
                .filter(LendingTransaction.borrower_id == b.borrower_id)
                .order_by(LendingTransaction.payment_date.desc(), LendingTransaction.created_at.desc())
                .all()
            )
            repayment_dicts = [
                {
                    "date": t.payment_date.isoformat() if t.payment_date else "",
                    "payment_date": t.payment_date.isoformat() if t.payment_date else "",
                    "cycle_due_date": t.cycle_due_date.isoformat() if t.cycle_due_date else "",
                    "cycle_index": t.cycle_index,
                    "is_late": t.is_late or False,
                    "days_late": t.days_late or 0,
                    "amount": float(t.amount or 0),
                    "penalty_portion": float(t.penalty_portion or 0),
                    "penalty": float(t.penalty_portion or 0),
                    "status": "Paid" if (t.status or "").lower() == "completed" else (t.status or "Paid"),
                }
                for t in txs
            ]

            terms = LendingService.calculate_terms(
                principal=b.principal_amount,
                interest_rate=b.interest_rate or Decimal("20.00"),
                frequency=freq,
                start_date_val=b.date_borrowed,
                due_date_val=b.due_date,
                term_days_val=term_days,
            )

            total_paid = sum((Decimal(str(r["amount"])) for r in repayment_dicts), Decimal("0.00"))

            if freq == "Daily":
                _, ledger_meta = LendingService.build_daily_ledger(
                    b.date_borrowed,
                    b.due_date,
                    repayment_dicts,
                    term_days=terms["term_days"],
                    installment_target=terms["installment_target"],
                    penalty_per_cycle=terms["penalty_per_cycle"],
                )
                total_penalties = Decimal(str(ledger_meta["total_penalties"]))
            else:
                progress = LendingService.get_monthly_progress(
                    b.date_borrowed,
                    b.due_date,
                    terms["total_payable"],
                    repayment_dicts,
                    term_days=terms["term_days"],
                )
                total_penalties = Decimal(str(progress["totalPenalties"]))

            total_payable_with_penalties = Decimal(str(terms["total_payable"])) + total_penalties
            remaining_balance = max(Decimal("0.00"), total_payable_with_penalties - total_paid)

            b.total_penalties = total_penalties
            b.amount_paid = total_paid
            b.total_payable = total_payable_with_penalties
            b.remaining_balance = remaining_balance

            print(
                f"  Borrower {b.borrower_id} ({b.borrower_name}): "
                f"Principal={b.principal_amount}, Rate={b.interest_rate}%, "
                f"Penalties={b.total_penalties}, TotalPayable={b.total_payable}, "
                f"Paid={b.amount_paid}, Remaining={b.remaining_balance}"
            )

        db.commit()
        print("[SUCCESS] Borrower balances successfully saved to Supabase.")
    finally:
        db.close()


def migrate_sqlite_fallbacks() -> None:
    db_paths = ["mct_financial.db", "backend/mct_financial.db", "app.db", "backend/app.db"]
    for path in db_paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            tables = [t[0] for t in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            if "borrowers" not in tables:
                conn.close()
                continue

            columns = {col[1] for col in cur.execute("PRAGMA table_info(borrowers)").fetchall()}
            columns_to_add = [
                ("total_penalties", "NUMERIC(15, 2) DEFAULT 0.00"),
                ("amount_paid", "NUMERIC(15, 2) DEFAULT 0.00"),
                ("remaining_balance", "NUMERIC(15, 2) DEFAULT 0.00"),
            ]
            for col_name, col_def in columns_to_add:
                if col_name not in columns:
                    cur.execute(f"ALTER TABLE borrowers ADD COLUMN {col_name} {col_def}")
                    print(f"[SQLITE ADDED] {path}: borrowers.{col_name}")
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[SQLITE ERROR] {path}: {e}")


if __name__ == "__main__":
    print("--- Running Migration for Borrower Persistent Balances ---")
    migrate_engine()
    migrate_sqlite_fallbacks()
    print("--- Migration Finished ---")

