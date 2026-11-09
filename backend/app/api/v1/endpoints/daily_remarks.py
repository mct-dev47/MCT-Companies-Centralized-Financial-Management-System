from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.dependencies import (
    AuthenticatedUser,
    check_company_access,
    require_business_reader,
    require_business_writer,
)
from app.db.session import get_db
from app.models.daily_remark import DailyRemark
from app.schemas.daily_remark import DailyRemarkKind, DailyRemarkOut, DailyRemarkUpsert

router = APIRouter()


@router.get("", response_model=List[DailyRemarkOut], summary="List day remarks for a company and kind")
def list_daily_remarks(
    company_id: int = Query(...),
    kind: DailyRemarkKind = Query(...),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    check_company_access(current_user, company_id)

    query = db.query(DailyRemark).filter(
        DailyRemark.company_id == company_id,
        DailyRemark.kind == kind,
    )
    if date_from:
        query = query.filter(DailyRemark.remark_date >= date_from)
    if date_to:
        query = query.filter(DailyRemark.remark_date <= date_to)
    return query.order_by(DailyRemark.remark_date.desc()).all()


@router.put(
    "",
    response_model=Optional[DailyRemarkOut],
    summary="Save, update, or clear the remark for one day (Supervisor and Finance)",
)
def upsert_daily_remark(
    payload: DailyRemarkUpsert,
    response: Response,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    check_company_access(current_user, payload.company_id)

    text_value = payload.remarks.strip() if payload.remarks else ""
    actor = (
        current_user.get("full_name")
        or current_user.get("name")
        or current_user.get("email")
        or f"User #{current_user.get('user_id')}"
    )

    existing = (
        db.query(DailyRemark)
        .filter(
            DailyRemark.company_id == payload.company_id,
            DailyRemark.kind == payload.kind,
            DailyRemark.remark_date == payload.remark_date,
        )
        .first()
    )

    result: Optional[DailyRemark] = None
    if not text_value:
        if existing:
            db.delete(existing)
            db.commit()
    elif existing:
        existing.remarks = text_value
        existing.updated_by = actor
        db.commit()
        db.refresh(existing)
        result = existing
    else:
        result = DailyRemark(
            company_id=payload.company_id,
            kind=payload.kind,
            remark_date=payload.remark_date,
            remarks=text_value,
            updated_by=actor,
        )
        db.add(result)
        db.commit()
        db.refresh(result)

    try:
        from app.core.websocket import ws_manager

        ws_manager.broadcast_sync({
            "type": "DAILY_REMARK_UPDATED",
            "payload": {
                "company_id": payload.company_id,
                "kind": payload.kind,
                "remark_date": payload.remark_date.isoformat(),
                "remarks": text_value or None,
            },
        })
    except Exception:
        pass

    return result
