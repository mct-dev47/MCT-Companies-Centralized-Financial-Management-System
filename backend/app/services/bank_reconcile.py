"""One sweep that brings every bank back in line with the Transactions ledger.

Each sale and expense is reconciled on save, but that can be skipped (a reconcile error is only logged so a
save is never blocked) or undone by a write made outside the API (raw SQL, a script, the Supabase console).
This sweep re-runs the same per-record reconcile for every sale and expense, then re-derives every account
balance from its entries. It only posts the differences, so running it again changes nothing.

It makes the bank follow each record's CURRENT status. If a status itself is wrong, fix the status first.
"""
import logging
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Expense, Sale

logger = logging.getLogger(__name__)


def _drift_by_account(db: Session) -> Dict[str, Decimal]:
    """stored balance minus (starting balance + entries), per account; only the non zero ones."""
    nets = dict(
        db.query(
            BankTransaction.bank_account_id,
            func.coalesce(func.sum(func.coalesce(BankTransaction.deposit, 0) - func.coalesce(BankTransaction.withdrawal, 0)), 0),
        )
        .group_by(BankTransaction.bank_account_id)
        .all()
    )
    out: Dict[str, Decimal] = {}
    for acc in db.query(BankAccount).all():
        derived = Decimal(str(acc.starting_balance or 0)) + Decimal(str(nets.get(acc.id) or 0))
        diff = (Decimal(str(acc.current_balance or 0)) - derived).quantize(Decimal("0.01"))
        if diff != 0:
            out[acc.id] = diff
    return out


def _purge_orphan_entries(db: Session) -> int:
    """Remove bank entries whose sale or expense no longer exists (deleted outside the API before the
    0054 trigger existed). Skipped for a table with no rows at all, so a database whose records live
    elsewhere never loses its entries. Balances are re-derived afterwards by the sweep."""
    removed = 0
    for model, id_col, link_col in (
        (Sale, Sale.sales_id, BankTransaction.source_sale_id),
        (Expense, Expense.expense_id, BankTransaction.source_expense_id),
    ):
        if db.query(model).first() is None:
            continue
        removed += (
            db.query(BankTransaction)
            .filter(link_col.isnot(None), ~link_col.in_(db.query(id_col)))
            .delete(synchronize_session=False)
        )
    db.commit()
    return removed


def repair_bank_integrity(db: Session) -> dict:
    """
    The two repairs that never depend on whether a record's status is right, so they are safe to run at any
    time (the server runs them on every startup): drop entries whose sale/expense is gone, then re-derive
    every balance from its entries. Returns what changed.
    """
    from app.services.bank_service import BankService

    statuses_restored = _undo_raw_status_flips(db)
    orphans_removed = _purge_orphan_entries(db)
    balances_fixed = BankService(db).recompute_all_balances()
    if statuses_restored or orphans_removed or balances_fixed:
        logger.warning(
            "Bank integrity repair: restored %s sale statuses, removed %s leftover entries, fixed %s balances.",
            statuses_restored, orphans_removed, balances_fixed,
        )
    return {
        "statuses_restored": statuses_restored,
        "orphan_entries_removed": orphans_removed,
        "balances_fixed": balances_fixed,
    }


def _undo_raw_status_flips(db: Session) -> int:
    """
    Undo what the old startup backfill did in raw SQL (it changed the status but never the date, and never the
    bank). Every API path keeps status, date and bank together, so these two shapes only come from that flip:
      - Deposited, no deposit date, nothing in the bank  -> it was Not Deposited
      - Not Deposited, still has a deposit date and money in the bank -> it was Deposited
    """
    from sqlalchemy import exists, update

    linked_net = (
        db.query(func.coalesce(func.sum(func.coalesce(BankTransaction.deposit, 0) - func.coalesce(BankTransaction.withdrawal, 0)), 0))
        .filter(BankTransaction.source_sale_id == Sale.sales_id)
        .scalar_subquery()
    )
    has_entries = exists().where(BankTransaction.source_sale_id == Sale.sales_id)

    to_not = db.execute(
        update(Sale)
        .where(Sale.deposit_status == "Deposited", Sale.deposit_date.is_(None), ~has_entries)
        .values(deposit_status="Not Deposited")
        .execution_options(synchronize_session=False)
    ).rowcount or 0
    to_dep = db.execute(
        update(Sale)
        .where(Sale.deposit_status == "Not Deposited", Sale.deposit_date.isnot(None), linked_net > 0)
        .values(deposit_status="Deposited")
        .execution_options(synchronize_session=False)
    ).rowcount or 0
    db.commit()
    return to_not + to_dep


def reconcile_all_banks(db: Session, company_ids: Optional[List[int]] = None) -> dict:
    """Full sweep. `company_ids` limits the per record reconcile to those companies (None = all)."""
    from app.api.v1.endpoints.expenses import reconcile_expense_bank
    from app.services.bank_service import BankService
    from app.services.sales_receivables_sync import SalesReceivablesSyncService

    entries_before = db.query(func.count(BankTransaction.id)).scalar() or 0
    orphans_removed = _purge_orphan_entries(db)

    sale_q = db.query(Sale.sales_id)
    expense_q = db.query(Expense.expense_id)
    if company_ids is not None:
        sale_q = sale_q.filter(Sale.company_id.in_(company_ids))
        expense_q = expense_q.filter(Expense.company_id.in_(company_ids))

    sale_ids: List[int] = [sid for (sid,) in sale_q.order_by(Sale.sales_id).all()]
    sync = SalesReceivablesSyncService(db)
    for sid in sale_ids:
        sync.reconcile_sale_bank(sid)

    expense_ids: List[int] = [eid for (eid,) in expense_q.order_by(Expense.expense_id).all()]
    for eid in expense_ids:
        reconcile_expense_bank(db, expense_id=eid)

    balances_fixed = BankService(db).recompute_all_balances()
    entries_after = db.query(func.count(BankTransaction.id)).scalar() or 0
    remaining = _drift_by_account(db)
    if remaining:
        logger.warning("Bank balances still differ from their entries after reconcile: %s", remaining)

    return {
        "sales_checked": len(sale_ids),
        "expenses_checked": len(expense_ids),
        "orphan_entries_removed": orphans_removed,
        "entries_posted": entries_after - entries_before + orphans_removed,
        "balances_fixed": balances_fixed,
        "accounts_still_off": {k: str(v) for k, v in remaining.items()},
    }
