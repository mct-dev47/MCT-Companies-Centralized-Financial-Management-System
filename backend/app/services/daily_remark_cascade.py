"""Day remarks (spec 0041) belong to a company's sales or expenses on one day.

When the last sale (or expense) of that day is deleted, its remark is deleted too. Migration 0053 does the
same in Postgres with a trigger, so rows removed outside the API are covered as well.
"""
from datetime import date
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.daily_remark import DailyRemark

# kind -> (Supabase table, date column)
_KINDS = {
    "sales": ("sales", "transaction_date"),
    "expense": ("expenses", "expense_date"),
}


def _as_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def count_records_on_day(db: Session, client, kind: str, company_id: Any, day: Any) -> int:
    """Records of that kind still on that company + day (Supabase and the local copy; the larger count wins)."""
    from app.models.finance import Expense, Sale

    day = _as_date(day)
    if not company_id or day is None:
        return 1
    table, date_col = _KINDS[kind]
    count = 0
    if client is not None:
        try:
            res = (
                client.table(table)
                .select("company_id")
                .eq("company_id", int(company_id))
                .eq(date_col, day.isoformat())
                .limit(1)
                .execute()
            )
            count = len(res.data or [])
        except Exception:
            return 1  # unknown: keep the remark rather than lose it
    model, col = (Sale, Sale.transaction_date) if kind == "sales" else (Expense, Expense.expense_date)
    try:
        local = db.query(model).filter(model.company_id == int(company_id), col == day).count()
        count = max(count, local)
    except Exception:
        pass
    return count


def purge_orphan_daily_remark(db: Session, client, kind: str, company_id: Any, day: Any) -> bool:
    """Delete the day remark when no record of that kind is left on that day. Returns True if one was deleted."""
    day = _as_date(day)
    if not company_id or day is None:
        return False
    if count_records_on_day(db, client, kind, company_id, day) > 0:
        return False
    try:
        deleted = (
            db.query(DailyRemark)
            .filter(
                DailyRemark.company_id == int(company_id),
                DailyRemark.remark_date == day,
                DailyRemark.kind == kind,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"Daily remark cascade error: {exc}")
        return False
    if deleted:
        try:
            from app.core.websocket import ws_manager

            ws_manager.broadcast_sync({
                "type": "DAILY_REMARK_UPDATED",
                "payload": {
                    "company_id": int(company_id),
                    "kind": kind,
                    "remark_date": day.isoformat(),
                    "remarks": None,
                },
            })
        except Exception:
            pass
    return bool(deleted)
