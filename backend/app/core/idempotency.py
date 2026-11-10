"""Create once support for offline retries (spec 0038).

The browser gives every new sale, expense, or receivable a unique ``client_ref``. If the same
``client_ref`` arrives again (a retry after a lost reply, a double click, an offline queue resend),
the create endpoint returns the record that already holds it instead of inserting a duplicate.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# table name -> whether the Supabase REST table has the client_ref column (checked once per process)
_supabase_column_support: dict[str, bool] = {}


@dataclass(frozen=True)
class ExistingRecord:
    record_id: int
    company_id: Optional[int]


def supabase_supports_client_ref(client, table: str) -> bool:
    """True when the Supabase table has a client_ref column (migration 0052 applied there).

    Without the column, inserting client_ref would fail, so callers leave it out and fall back to the
    old behaviour (no dedupe) instead of erroring.
    """
    cached = _supabase_column_support.get(table)
    if cached is not None:
        return cached
    try:
        client.table(table).select("client_ref").limit(1).execute()
        supported = True
    except Exception as exc:  # column missing, or Supabase unreachable
        logger.warning("client_ref not available on Supabase table %s: %s", table, exc)
        supported = False
    _supabase_column_support[table] = supported
    return supported


def find_by_client_ref_supabase(client, table: str, id_column: str, client_ref: str) -> Optional[ExistingRecord]:
    if not client_ref or not supabase_supports_client_ref(client, table):
        return None
    try:
        res = (
            client.table(table)
            .select(f"{id_column},company_id")
            .eq("client_ref", client_ref)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning("client_ref lookup failed on %s: %s", table, exc)
        return None
    if not res.data:
        return None
    row = res.data[0]
    return ExistingRecord(record_id=int(row[id_column]), company_id=row.get("company_id"))


def find_by_client_ref_orm(db: Session, model, id_attr: str, client_ref: str) -> Optional[ExistingRecord]:
    if not client_ref:
        return None
    try:
        row = db.query(model).filter(model.client_ref == client_ref).first()
    except Exception as exc:
        db.rollback()
        logger.warning("client_ref lookup failed on %s: %s", getattr(model, "__tablename__", model), exc)
        return None
    if row is None:
        return None
    return ExistingRecord(record_id=int(getattr(row, id_attr)), company_id=getattr(row, "company_id", None))
