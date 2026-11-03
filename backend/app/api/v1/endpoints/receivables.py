from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.company_resolver import resolve_company
from app.core.dependencies import (
    BusinessReader,
    BusinessWriter,
    check_company_access,
    get_authorized_company_scope,
)
from app.db.session import get_db
from app.models.receivable import ReceivablePayment
from app.schemas.receivable import (
    DebtorBatchDelete,
    DebtorBatchDeleteOut,
    DebtorBatchUpdate,
    DebtorBatchUpdateOut,
    PayrollDeductionRequest,
    ReceivableCreate,
    ReceivableOut,
    ReceivablePaymentCreate,
    ReceivablePaymentOut,
    ReceivablesKPIsOut,
    ReceivableUpdate,
)
from app.services.receivables_service import ReceivablesService


router = APIRouter()


def _resolve_requested_company_id(
    db: Session,
    company_id: Optional[int],
    company_name: Optional[str],
) -> Optional[int]:
    if company_id is not None:
        return company_id
    if company_name and company_name.strip().lower() not in ("all", "all companies", ""):
        try:
            comp = resolve_company(db, company_name=company_name)
            return comp.company_id
        except HTTPException:
            return None
    return None


@router.get("", response_model=List[ReceivableOut])
def list_receivables(
    user: BusinessReader,
    db: Session = Depends(get_db),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    customer_type: Optional[str] = Query(None),
    payment_status: Optional[str] = Query(None, alias="status"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """
    List receivables with company, debtor type, payment status, and date range filters.
    """
    resolved_cid = _resolve_requested_company_id(db, company_id, company_name)
    scoped_cids = get_authorized_company_scope(user, resolved_cid)

    service = ReceivablesService(db)
    return service.list_receivables(
        company_id=resolved_cid,
        company_ids=scoped_cids,
        company_name=company_name if resolved_cid is None else None,
        customer_type=customer_type,
        payment_status=payment_status,
        start_date=start_date,
        end_date=end_date,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("/summary", response_model=ReceivablesKPIsOut)
def get_receivables_summary(
    user: BusinessReader,
    db: Session = Depends(get_db),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
):
    """
    Retrieve summarized KPI cards for food sales receivables.
    """
    resolved_cid = _resolve_requested_company_id(db, company_id, company_name)
    scoped_cids = get_authorized_company_scope(user, resolved_cid)

    service = ReceivablesService(db)
    return service.get_summary_kpis(
        company_id=resolved_cid,
        company_ids=scoped_cids,
        company_name=company_name if resolved_cid is None else None,
    )


@router.post("", response_model=ReceivableOut, status_code=status.HTTP_201_CREATED)
def create_receivable(
    data: ReceivableCreate,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Create a new food sale receivable within the caller's authorized company scope.
    """
    service = ReceivablesService(db)
    target_cid, _ = service._resolve_company_info(data.company_id, data.company_name)
    check_company_access(user, target_cid)
    data.company_id = target_cid

    actor = user.get("email") or f"user-{user.get('user_id')}"
    return service.create_receivable(data, actor_name=actor)


@router.put("/debtor", response_model=DebtorBatchUpdateOut)
def update_debtor_batch(
    data: DebtorBatchUpdate,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Batch update debtor name and customer type across non-verified receivables within authorized company scope.
    """
    resolved_cid = _resolve_requested_company_id(db, data.company_id, data.company_name)
    scoped_cids = get_authorized_company_scope(user, resolved_cid)
    if resolved_cid is not None:
        data.company_id = resolved_cid

    actor = user.get("email") or f"user-{user.get('user_id')}"
    service = ReceivablesService(db)
    return service.update_debtor(data, company_ids=scoped_cids, actor_name=actor)


@router.delete("/debtor", response_model=DebtorBatchDeleteOut)
def delete_debtor_batch(
    user: BusinessWriter,
    db: Session = Depends(get_db),
    customer_name: Optional[str] = Query(None),
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    payload: Optional[DebtorBatchDelete] = Body(None),
):
    """
    Cascade delete all non-verified receivables for a debtor within authorized company scope.
    """
    effective_customer = customer_name or (payload.customer_name if payload else None)
    effective_cid = company_id if company_id is not None else (payload.company_id if payload else None)
    effective_cname = company_name or (payload.company_name if payload else None)

    if not effective_customer or not effective_customer.strip():
        raise HTTPException(status_code=400, detail="customer_name is required")

    resolved_cid = _resolve_requested_company_id(db, effective_cid, effective_cname)
    scoped_cids = get_authorized_company_scope(user, resolved_cid)

    actor = user.get("email") or f"user-{user.get('user_id')}"
    service = ReceivablesService(db)
    return service.delete_debtor(
        customer_name=effective_customer,
        company_id=resolved_cid,
        company_name=effective_cname if resolved_cid is None else None,
        company_ids=scoped_cids,
        actor_name=actor,
    )


@router.get("/{receivable_id}", response_model=ReceivableOut)
def get_receivable(
    receivable_id: int,
    user: BusinessReader,
    db: Session = Depends(get_db),
):
    """
    Get detailed ledger and payment history for a single receivable.
    """
    service = ReceivablesService(db)
    rec = service.get_receivable(receivable_id)
    check_company_access(user, rec.company_id)
    return rec


@router.put("/{receivable_id}", response_model=ReceivableOut)
def update_receivable(
    receivable_id: int,
    update_data: ReceivableUpdate,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Modify debtor details, order items/amounts, or payment status within authorized company scope.
    """
    service = ReceivablesService(db)
    rec = service.get_receivable(receivable_id)
    check_company_access(user, rec.company_id)

    actor = user.get("email") or f"user-{user.get('user_id')}"
    return service.update_receivable(receivable_id, update_data, actor_name=actor)


@router.delete("/{receivable_id}")
def delete_receivable(
    receivable_id: int,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Delete a receivable record and cascade payments with bidirectional sync within authorized company scope.
    """
    service = ReceivablesService(db)
    rec = service.get_receivable(receivable_id)
    check_company_access(user, rec.company_id)

    actor = user.get("email") or f"user-{user.get('user_id')}"
    service.delete_receivable(receivable_id, actor_name=actor)
    return {"detail": "Receivable deleted successfully"}


@router.post("/{receivable_id}/payments", response_model=ReceivablePaymentOut, status_code=status.HTTP_201_CREATED)
def record_payment(
    receivable_id: int,
    payment_data: ReceivablePaymentCreate,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Record a partial or full payment remittance on a receivable order.
    """
    service = ReceivablesService(db)
    rec = service.get_receivable(receivable_id)
    check_company_access(user, rec.company_id)

    actor = user.get("email") or f"user-{user.get('user_id')}"
    return service.record_payment(receivable_id, payment_data, actor_name=actor)


@router.post("/settle-payroll")
def settle_payroll(
    data: PayrollDeductionRequest,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Settle outstanding staff credit via payroll deduction within authorized company scope.
    """
    scoped_cids = get_authorized_company_scope(user, data.company_id)
    actor = user.get("email") or f"user-{user.get('user_id')}"
    service = ReceivablesService(db)
    return service.settle_payroll_deduction(
        customer_name=data.customer_name,
        company_id=data.company_id,
        company_ids=scoped_cids,
        notes=data.notes,
        actor_name=actor,
    )


@router.delete("/payments/{payment_id}")
def delete_payment(
    payment_id: int,
    user: BusinessWriter,
    db: Session = Depends(get_db),
):
    """
    Reverse and delete a payment remittance within authorized company scope.
    """
    pay = db.query(ReceivablePayment).filter(ReceivablePayment.payment_id == payment_id).first()
    if not pay:
        raise HTTPException(status_code=404, detail="Payment record not found")

    service = ReceivablesService(db)
    rec = service.get_receivable(pay.receivable_id)
    check_company_access(user, rec.company_id)

    actor = user.get("email") or f"user-{user.get('user_id')}"
    service.delete_payment(payment_id, actor_name=actor)
    return {"detail": "Payment reversed successfully"}
