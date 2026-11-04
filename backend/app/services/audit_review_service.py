"""Save the Audit review result on a sale or expense (spec 0014)."""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.dependencies import AuthenticatedUser, check_company_access
from app.core.websocket import ws_manager
from app.db.supabase import get_supabase_admin_client
from app.models.user import User
from app.schemas.audit_review import PENDING_AUDIT, AuditReviewIn


def _auditor_name(db: Session, user: AuthenticatedUser) -> str:
    """The name stamped on the review comes from the signed in user, never from the request."""
    user_id = user.get("user_id")
    if user_id:
        db_user = db.query(User).filter(User.user_id == user_id).first()
        if db_user and (db_user.name or "").strip():
            return db_user.name.strip()
    return (user.get("email") or "Auditor").strip()


def apply_audit_review(
    db: Session,
    user: AuthenticatedUser,
    *,
    model: Any,
    pk_column: str,
    supabase_table: str,
    record_id: int,
    payload: AuditReviewIn,
    not_found: str,
) -> None:
    """
    Update only the four audit columns of one sale or expense, in Supabase and in the local table.
    Raises 404 when the record is missing and 403 when the user has no access to its company.
    """
    pk_attr = getattr(model, pk_column)

    # 1. Find the record's company (Supabase first, local table as fallback).
    company_id: Optional[int] = None
    found_remote = False
    client = None
    try:
        client = get_supabase_admin_client()
        res = client.table(supabase_table).select("company_id").eq(pk_column, record_id).limit(1).execute()
        if res.data:
            found_remote = True
            company_id = res.data[0].get("company_id")
    except Exception:
        client = None

    local_row = db.query(model).filter(pk_attr == record_id).first()
    if local_row is not None and company_id is None:
        company_id = local_row.company_id
    if not found_remote and local_row is None:
        raise HTTPException(status_code=404, detail=not_found)

    check_company_access(user, company_id)

    # 2. Work out the values. The name and time are set here, on the server.
    status = payload.audit_status
    remarks = (payload.remarks or "").strip() or None
    if status == PENDING_AUDIT:
        audited_by, audited_at, remarks = None, None, None
    else:
        audited_by, audited_at = _auditor_name(db, user), datetime.now(timezone.utc)

    # 3. Save to Supabase.
    remote_saved = False
    if found_remote and client is not None:
        try:
            client.table(supabase_table).update({
                "audit_status": status,
                "audited_by": audited_by,
                "audited_at": audited_at.isoformat() if audited_at else None,
                "audit_remarks": remarks,
            }).eq(pk_column, record_id).execute()
            remote_saved = True
        except Exception as e:
            print(f"Supabase audit update error: {e}")

    # 4. Save to the local table.
    local_saved = False
    if local_row is not None:
        local_row.audit_status = status
        local_row.audited_by = audited_by
        local_row.audited_at = audited_at
        local_row.audit_remarks = remarks
        db.commit()
        local_saved = True

    if not remote_saved and not local_saved:
        raise HTTPException(status_code=500, detail="Could not save the audit status. Please try again.")

    # Tell every connected Finance, Audit and company screen to reload (spec 0016, AC-4).

    try:
        ws_manager.broadcast_sync({
            "type": "AUDIT_UPDATED",
            "payload": {"resource": supabase_table, "id": record_id},
        })
    except Exception as e:
        print(f"Audit websocket broadcast error: {e}")
