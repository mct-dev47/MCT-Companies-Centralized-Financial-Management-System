from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.company_resolver import resolve_company
from app.core.dependencies import (
    AuthenticatedUser,
    BusinessReader,
    BusinessWriter,
    check_company_access,
    get_authorized_company_scope,
    require_business_reader,
    require_business_writer,
)
from app.db.session import get_db
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
) -> tuple[Optional[int], Optional[str]]:
    """Resolves and enforces authorized company scope for bill queries."""
    target_cid = company_id
    target_cname = company_name

    if company_name and company_name.strip().lower() != "all companies":
        comp = resolve_company(db, company_name=company_name)
        target_cid = comp.company_id
        target_cname = comp.company_name

    scoped_cids = get_authorized_company_scope(user, target_cid)
    if scoped_cids is not None:
        if len(scoped_cids) == 1:
            target_cid = scoped_cids[0]
            target_cname = None
        else:
            # Multi-company supervisor without explicit company filter
            target_cid = scoped_cids[0]
            target_cname = None

    return target_cid, target_cname


@router.get("", response_model=List[BillOut], summary="List company bills")
def list_bills(
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    cid, cname = _resolve_caller_scope(user, db, company_id, company_name)
    return BillsService(db).list_bills(company_id=cid, company_name=cname)


@router.post("", response_model=BillOut, status_code=status.HTTP_201_CREATED, summary="Create a company bill")
def create_bill(
    bill_in: BillCreate,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    check_company_access(user, bill_in.company_id)
    return BillsService(db).create_bill(bill_in)


@router.get("/stats", response_model=BillStatsOut, summary="Get aggregated bill statistics")
def get_bill_stats(
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    cid, cname = _resolve_caller_scope(user, db, company_id, company_name)
    return BillsService(db).get_stats(company_id=cid, company_name=cname)


@router.get("/reminders", response_model=List[BillReminderOut], summary="Get bill payment reminders")
def get_bill_reminders(
    user: AuthenticatedUser = Depends(require_business_reader),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    as_of: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    cid, cname = _resolve_caller_scope(user, db, company_id, company_name)
    return BillsService(db).get_reminders(company_id=cid, company_name=cname, as_of=as_of or date.today())


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
    return service.update_bill(bill_id, bill_in)


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
    return service.record_payment(bill_id, payment_in)


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
    return service.delete_payment(bill_id, payment_id)


@router.delete("/{bill_id}/latest-payment", response_model=BillOut, summary="Undo the latest bill payment")
def delete_latest_bill_payment(
    bill_id: int,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BillsService(db)
    bill = service.get_bill(bill_id)
    check_company_access(user, bill.company_id)
    return service.delete_latest_payment(bill_id)
