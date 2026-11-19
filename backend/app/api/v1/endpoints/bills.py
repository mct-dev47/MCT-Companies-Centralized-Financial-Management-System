from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.company_resolver import resolve_company
from app.core.pagination import PaginationParams
from app.core.websocket import ws_manager
from app.core.dependencies import (
    AuthenticatedUser,
    BusinessReader,
    BusinessWriter,
    check_company_access,
    get_authorized_company_scope,
    require_auditor_user,
    require_business_reader,
    require_business_writer,
)
from app.db.session import get_db
from app.schemas.audit_review import AuditReviewIn
from app.schemas.bills import (
    BillCreate,
    BillOut,
    BillPaymentCreate,
    BillReminderOut,
    BillScheduleOut,
    BillStatsOut,
    BillUpdate,
)
from app.services.bills_service import BillsService


router = APIRouter()


def _resolve_caller_scope(
    user: AuthenticatedUser,
    db: Session,
    company_id: Optional[int],
    company_name: Optional[str],
) -> tuple[Optional[int], Optional[str], Optional[list[int]]]:
    """Resolves and enforces authorized company scope for bill queries."""
    target_cid = company_id
    target_cname = company_name

    if company_name and company_name.strip().lower() != "all companies":
        comp = resolve_company(db, company_name=company_name)
        target_cid = comp.company_id
        target_cname = comp.company_name

    scoped_cids = get_authorized_company_scope(user, target_cid)
    if scoped_cids is not None:
        if target_cid is not None and target_cid in scoped_cids:
            return target_cid, target_cname, None
        elif len(scoped_cids) == 1:
            return scoped_cids[0], None, None
        else:
            return None, None, scoped_cids

    return target_cid, target_cname, None


@router.get("", response_model=List[BillOut], summary="List company bills")
def list_bills(
    response: Response,
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    company: Optional[str] = Query(None),
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
):
    cid, cname, cids = _resolve_caller_scope(user, db, company_id, company_name or company)
    resolved_cname = None if cid is not None else cname
    service = BillsService(db)
    total_count = service.count_bills(company_id=cid, company_name=resolved_cname, company_ids=cids)
    response.headers["X-Total-Count"] = str(total_count)
    response.headers["X-Page-Limit"] = str(pagination.limit)
    response.headers["X-Page-Offset"] = str(pagination.offset)
    return service.list_bills(
        company_id=cid,
        company_name=resolved_cname,
        company_ids=cids,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.get("/export", response_model=List[BillOut], summary="Export all matching company bills")
def export_bills(
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    company: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    cid, cname, cids = _resolve_caller_scope(user, db, company_id, company_name or company)
    resolved_cname = None if cid is not None else cname
    return BillsService(db).list_bills(
        company_id=cid,
        company_name=resolved_cname,
        company_ids=cids,
        limit=None,
        offset=0,
    )


@router.post("", response_model=BillOut, status_code=status.HTTP_201_CREATED, summary="Create a company bill")
def create_bill(
    bill_in: BillCreate,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    check_company_access(user, bill_in.company_id)
    created = BillsService(db).create_bill(bill_in)
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "created", "bill_id": getattr(created, "bill_id", None)}})
    return created


@router.get("/stats", response_model=BillStatsOut, summary="Get aggregated bill statistics")
def get_bill_stats(
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    company: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    cid, cname, cids = _resolve_caller_scope(user, db, company_id, company_name or company)
    return BillsService(db).get_stats(company_id=cid, company_name=cname, company_ids=cids)


@router.get("/reminders", response_model=List[BillReminderOut], summary="Get bill payment reminders")
def get_bill_reminders(
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    company: Optional[str] = Query(None),
    as_of: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    cid, cname, cids = _resolve_caller_scope(user, db, company_id, company_name or company)
    return BillsService(db).get_reminders(company_id=cid, company_name=cname, as_of=as_of or date.today(), company_ids=cids)


@router.get("/{bill_id}", response_model=BillOut, summary="Get a bill")
def get_bill(
    bill_id: int,
    user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    bill = service.get_bill(bill_id)
    check_company_access(user, bill.company_id)
    return service._to_output(bill)


@router.patch("/{bill_id}", response_model=BillOut, summary="Update a company bill")
def update_bill(
    bill_id: int,
    bill_in: BillUpdate,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    existing = service.get_bill(bill_id)
    check_company_access(user, existing.company_id)
    if bill_in.company_id is not None:
        check_company_access(user, bill_in.company_id)
    updated = service.update_bill(bill_id, bill_in)
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "updated", "bill_id": bill_id}})
    return updated


@router.delete("/{bill_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a company bill")
def delete_bill(
    bill_id: int,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    existing = service.get_bill(bill_id)
    check_company_access(user, existing.company_id)
    service.delete_bill(bill_id)
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "deleted", "bill_id": bill_id}})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{bill_id}/schedule", response_model=BillScheduleOut, summary="Get recurring payment schedule")
def get_bill_schedule(
    bill_id: int,
    user: AuthenticatedUser = Depends(require_business_reader),
    as_of: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    bill = service.get_bill(bill_id)
    check_company_access(user, bill.company_id)
    return service.schedule(bill_id, as_of or date.today())


@router.post("/{bill_id}/payments", response_model=BillOut, status_code=status.HTTP_201_CREATED, summary="Record a bill payment or installment")
def record_bill_payment(
    bill_id: int,
    payment_in: BillPaymentCreate,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    bill = service.get_bill(bill_id)
    check_company_access(user, bill.company_id)
    result = service.record_payment(bill_id, payment_in)
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "payment_recorded", "bill_id": bill_id}})
    return result


@router.delete("/{bill_id}/payments/{payment_id}", response_model=BillOut, summary="Remove a bill payment")
def delete_bill_payment(
    bill_id: int,
    payment_id: int,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    bill = service.get_bill(bill_id)
    check_company_access(user, bill.company_id)
    result = service.delete_payment(bill_id, payment_id)
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "payment_deleted", "bill_id": bill_id}})
    return result


@router.delete("/{bill_id}/latest-payment", response_model=BillOut, summary="Undo the latest bill payment")
def delete_latest_bill_payment(
    bill_id: int,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    bill = service.get_bill(bill_id)
    check_company_access(user, bill.company_id)
    result = service.delete_latest_payment(bill_id)
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "latest_payment_deleted", "bill_id": bill_id}})
    return result


@router.patch("/{bill_id}/audit", summary="Save the audit review of a bill (Auditor only)")
def review_bill_audit(
    bill_id: int,
    review_in: AuditReviewIn,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db),
):
    from app.models.bills import Bill
    from app.services.audit_review_service import apply_audit_review
    from app.core.websocket import ws_manager

    apply_audit_review(
        db,
        current_user,
        model=Bill,
        pk_column="bill_id",
        supabase_table="bills",
        record_id=bill_id,
        payload=review_in,
        not_found="Bill not found",
    )
    ws_manager.broadcast_sync({"type": "BILLS_UPDATED", "payload": {"action": "audited", "bill_id": bill_id}})
    bill = db.query(Bill).filter(Bill.bill_id == bill_id).first()
    return {
        "bill_id": bill_id,
        "audit_status": getattr(bill, "audit_status", "Pending Audit") if bill else review_in.audit_status,
        "audited_by": getattr(bill, "audited_by", None) if bill else None,
        "audited_at": bill.audited_at.isoformat() if bill and getattr(bill, "audited_at", None) else None,
        "audit_remarks": getattr(bill, "audit_remarks", None) if bill else None,
    }
