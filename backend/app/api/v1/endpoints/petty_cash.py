from datetime import date
from typing import List, Optional

import base64
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    AuditorUser,
    AuthenticatedUser,
    BusinessReader,
    BusinessWriter,
    FinanceUser,
    check_company_access,
    require_auditor_user,
    require_business_reader,
    require_business_writer,
    require_finance_user,
)
from app.db.session import get_db
from app.schemas.petty_cash import (
    PettyCashEndorseIn,
    PettyCashLedgerEntry,
    PettyCashMovementOut,
    PettyCashReviewIn,
    PettyCashSummaryOut,
    PettyCashTopUpCreate,
    PettyCashTopUpOut,
    PettyCashTopUpUpdate,
    PettyCashWalletUpdate,
)
from app.services.audit_service import AuditAction, log_transaction
from app.services.petty_cash_service import PettyCashService


router = APIRouter()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/summary", response_model=PettyCashSummaryOut, summary="Petty cash balance for one company")
def get_summary(
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = PettyCashService(db)
    company = service.resolve_company(company_id, company_name)
    check_company_access(current_user, company.company_id)
    return service.get_summary(company, start_date, end_date)


@router.get("/summaries", response_model=List[PettyCashSummaryOut], summary="Petty cash balances for all companies")
def list_summaries(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    summaries = PettyCashService(db).list_summaries(start_date, end_date)
    role = (current_user.get("role") or "").lower()
    if role in ("finance", "audit", "auditor"):
        return summaries

    user_company_ids = current_user.get("company_ids") or []
    if current_user.get("company_id") and current_user["company_id"] not in user_company_ids:
        user_company_ids.append(current_user["company_id"])

    return [s for s in summaries if s.company_id in user_company_ids]


@router.get("/ledger", response_model=List[PettyCashLedgerEntry], summary="Petty cash top-ups and spending")
def get_ledger(
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = PettyCashService(db)
    company = None
    if company_id or (company_name and company_name.strip().lower() != "all companies"):
        company = service.resolve_company(company_id, company_name)
        check_company_access(current_user, company.company_id)
    else:
        role = (current_user.get("role") or "").lower()
        if role not in ("finance", "audit", "auditor"):
            user_company_ids = current_user.get("company_ids") or []
            if user_company_ids:
                company = service.resolve_company(user_company_ids[0], None)
            elif current_user.get("company_id"):
                company = service.resolve_company(current_user["company_id"], None)

    return service.list_ledger(company, start_date, end_date, user_role=current_user.get("role"))


@router.get(
    "/movements",
    response_model=List[PettyCashMovementOut],
    summary="Petty cash top-ups with requesting and funding company, for the Transaction ledger",
)
def get_movements(
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = PettyCashService(db)
    company = None
    if company_id or (company_name and company_name.strip().lower() != "all companies"):
        company = service.resolve_company(company_id, company_name)
        check_company_access(current_user, company.company_id)
    return service.list_movements(company)


@router.post("/topups", response_model=PettyCashTopUpOut, status_code=status.HTTP_201_CREATED, summary="Top up petty cash from sales")
def create_topup(
    topup_in: PettyCashTopUpCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    company_identifier = topup_in.company_name or topup_in.company
    target_comp = PettyCashService(db).resolve_company(topup_in.company_id, company_identifier)
    check_company_access(current_user, target_comp.company_id)
    topup = PettyCashService(db).create_topup(topup_in, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_topup",
        extra={"amount": float(topup.amount), "topup_date": topup.topup_date.isoformat()},
    )
    return topup


@router.put("/topups/{topup_id}", response_model=PettyCashTopUpOut, summary="Update pending petty cash request before finance review")
def update_topup(
    topup_id: int,
    topup_update: PettyCashTopUpUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    topup = PettyCashService(db).update_topup(
        topup_id=topup_id,
        amount=topup_update.amount,
        description=topup_update.description,
    )
    check_company_access(current_user, topup.company_id)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_topup_update",
        extra={"amount": float(topup.amount)},
    )
    return topup


@router.post("/topups/{topup_id}/endorse", response_model=PettyCashTopUpOut, summary="Finance endorse or reject petty cash request")
def endorse_topup(
    topup_id: int,
    endorse_in: PettyCashEndorseIn,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    from app.core.user_name_resolver import resolve_real_name
    endorser = current_user.get("full_name") or current_user.get("name") or resolve_real_name(current_user.get("email")) or "Finance Officer"
    topup = PettyCashService(db).endorse_topup(
        topup_id=topup_id,
        action=endorse_in.action,
        remark=endorse_in.remark,
        endorser_name=endorser,
        bank_account_id=endorse_in.bank_account_id,
    )
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_endorsement",
        extra={"action": endorse_in.action, "remark": endorse_in.remark, "status": topup.status},
    )
    return topup


@router.post("/topups/{topup_id}/review", response_model=PettyCashTopUpOut, summary="Audit approve or disapprove petty cash request")
def review_topup(
    topup_id: int,
    review_in: PettyCashReviewIn,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db),
):
    from app.core.user_name_resolver import resolve_real_name
    reviewer = current_user.get("full_name") or current_user.get("name") or resolve_real_name(current_user.get("email")) or "Internal Auditor"
    topup = PettyCashService(db).review_topup(
        topup_id=topup_id,
        action=review_in.action,
        remark=review_in.remark,
        reviewer_name=reviewer,
    )
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_audit_review",
        extra={"action": review_in.action, "remark": review_in.remark, "status": topup.status},
    )
    return topup


@router.delete("/topups/{topup_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove a petty cash top-up")
def delete_topup(
    topup_id: int,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    topup = PettyCashService(db).delete_topup(topup_id)
    check_company_access(current_user, topup.company_id)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_DELETED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup_id, record_type="petty_cash_topup",
        extra={"amount": float(topup.amount)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/wallet", response_model=PettyCashSummaryOut, summary="Update petty cash low-balance alert")
def update_wallet(
    wallet_in: PettyCashWalletUpdate,
    request: Request,
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    service = PettyCashService(db)
    company = service.resolve_company(company_id, company_name)
    summary = service.update_threshold(company, wallet_in.low_balance_threshold)
    log_transaction(
        db, AuditAction.PETTY_CASH_WALLET_UPDATED,
        user_id=current_user.get("user_id"), company_id=company.company_id,
        ip_address=_client_ip(request),
        record_type="petty_cash_wallet",
        extra={"low_balance_threshold": float(wallet_in.low_balance_threshold)},
    )
    return summary


@router.post("/receipts", summary="Upload receipt image (JPG, PNG, HEIC) or PDF")
async def upload_receipt(
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(require_business_writer),
):
    content_type = (file.content_type or "").lower()
    fname = (file.filename or "").lower()
    is_valid_type = (
        content_type.startswith("image/")
        or content_type == "application/pdf"
        or fname.endswith((".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".pdf"))
    )
    if not is_valid_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Acceptable formats are JPG, PNG, HEIC, and PDF."
        )
    data = await file.read()
    file_size = len(data)
    if file_size > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds the 5 MB limit."
        )
    encoded = base64.b64encode(data).decode("utf-8")
    final_mime = content_type if content_type.startswith("image/") or content_type == "application/pdf" else "application/octet-stream"
    data_url = f"data:{final_mime};base64,{encoded}"
    return {
        "url": data_url,
        "filename": file.filename or "receipt",
        "file_name": file.filename or "receipt",
        "file_size": file_size,
        "mime_type": final_mime,
        "content_type": final_mime
    }
