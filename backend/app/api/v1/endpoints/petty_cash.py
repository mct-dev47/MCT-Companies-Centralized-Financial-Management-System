import base64
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import func
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
    FinalizeSettlementIn,
    IntercompanySettleIn,
    IntercompanyTransferOut,
    PettyCashCategoryCreate,
    PettyCashCategoryOut,
    PettyCashEndorseIn,
    PettyCashLedgerEntry,
    PettyCashMovementOut,
    PettyCashReviewIn,
    PettyCashSummaryOut,
    PettyCashTopUpCreate,
    PettyCashTopUpOut,
    PettyCashTopUpUpdate,
    PettyCashWalletUpdate,
    ReceiptUploadOut,
    TransferCancelIn,
    TransferReversalConfirmIn,
)
from app.models.petty_cash import PettyCashCategory
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


@router.post("/reimbursements", response_model=PettyCashTopUpOut, status_code=status.HTTP_201_CREATED, summary="Submit expense reimbursement claim")
def submit_reimbursement(
    claim_in: PettyCashTopUpCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    claim_in.request_type = "reimbursement"
    company_identifier = claim_in.company_name or claim_in.company
    target_comp = PettyCashService(db).resolve_company(claim_in.company_id, company_identifier)
    check_company_access(current_user, target_comp.company_id)
    topup = PettyCashService(db).create_topup(claim_in, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_reimbursement",
        extra={"amount": float(topup.amount), "total_expenses": float(topup.total_expenses or 0.0)},
    )
    return topup


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
        total_expenses=topup_update.total_expenses,
        company_funded_amount=topup_update.company_funded_amount,
        existing_expense_id=topup_update.existing_expense_id,
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
        payment_method_option=endorse_in.payment_method_option,
        destination_bank_id=endorse_in.destination_bank_id,
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


@router.post("/topups/{topup_id}/finalize-settlement", response_model=PettyCashTopUpOut, summary="Finalize zero excess reimbursement settlement")
def finalize_settlement(
    topup_id: int,
    request: Request,
    settle_in: Optional[FinalizeSettlementIn] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    notes = settle_in.notes if settle_in else None
    topup = PettyCashService(db).finalize_settlement(topup_id=topup_id, notes=notes, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_finalize_settlement",
        extra={"status": topup.status, "idempotency_key": idempotency_key},
    )
    return topup


@router.post("/topups/{topup_id}/reimburse", response_model=PettyCashTopUpOut, summary="Disburse reimbursement payout to employee")
def reimburse_topup(
    topup_id: int,
    request: Request,
    reimb_in: Optional[FinalizeSettlementIn] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    notes = reimb_in.notes if reimb_in else None
    topup = PettyCashService(db).reimburse(topup_id=topup_id, notes=notes, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_reimburse",
        extra={"status": topup.status, "amount_reimbursed": float(topup.amount_reimbursed), "idempotency_key": idempotency_key},
    )
    return topup


@router.post("/topups/{topup_id}/transfer", response_model=PettyCashTopUpOut, summary="Initiate intercompany bank transfer (Method B)")
def initiate_transfer(
    topup_id: int,
    request: Request,
    transfer_in: Optional[FinalizeSettlementIn] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    notes = transfer_in.notes if transfer_in else None
    topup = PettyCashService(db).initiate_transfer(topup_id=topup_id, notes=notes, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_transfer_initiated",
        extra={"status": topup.status, "idempotency_key": idempotency_key},
    )
    return topup


@router.post("/topups/{topup_id}/confirm-transfer", response_model=PettyCashTopUpOut, summary="Confirm receipt of intercompany bank transfer (Method B)")
def confirm_transfer(
    topup_id: int,
    request: Request,
    confirm_in: Optional[FinalizeSettlementIn] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    notes = confirm_in.notes if confirm_in else None
    topup = PettyCashService(db).confirm_transfer(topup_id=topup_id, notes=notes, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_transfer_confirmed",
        extra={"status": topup.status, "idempotency_key": idempotency_key},
    )
    return topup


@router.post("/topups/{topup_id}/cancel-transfer", response_model=PettyCashTopUpOut, summary="Cancel in-transit intercompany bank transfer")
def cancel_transfer(
    topup_id: int,
    cancel_in: TransferCancelIn,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    topup = PettyCashService(db).cancel_transfer(topup_id=topup_id, reason=cancel_in.reason, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_transfer_cancelled",
        extra={"reason": cancel_in.reason, "status": topup.status, "idempotency_key": idempotency_key},
    )
    return topup


@router.post("/topups/{topup_id}/confirm-reversal", response_model=PettyCashTopUpOut, summary="Confirm return reversal deposit for cancelled transfer")
def confirm_reversal(
    topup_id: int,
    request: Request,
    reversal_in: Optional[TransferReversalConfirmIn] = None,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    v_notes = reversal_in.verification_notes if reversal_in else None
    topup = PettyCashService(db).confirm_reversal(topup_id=topup_id, verification_notes=v_notes, current_user=current_user)
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=topup.company_id,
        ip_address=_client_ip(request),
        record_id=topup.topup_id, record_type="petty_cash_reversal_confirmed",
        extra={"status": topup.status, "idempotency_key": idempotency_key},
    )
    return topup


@router.get("/intercompany-transfers", response_model=List[IntercompanyTransferOut], summary="List intercompany funding transfers")
def list_intercompany_transfers(
    company_id: Optional[int] = Query(None),
    settlement_status: Optional[str] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    return PettyCashService(db).list_intercompany_transfers(company_id=company_id, settlement_status=settlement_status)


@router.post("/intercompany-transfers/{transfer_id}/settle", response_model=IntercompanyTransferOut, summary="Settle and repay intercompany liability")
def settle_intercompany_transfer(
    transfer_id: int,
    settle_in: IntercompanySettleIn,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    res = PettyCashService(db).settle_intercompany_transfer(
        transfer_id=transfer_id,
        source_bank_id=settle_in.source_bank_id,
        destination_bank_id=settle_in.destination_bank_id,
        notes=settle_in.notes,
        current_user=current_user,
    )
    log_transaction(
        db, AuditAction.PETTY_CASH_TOPUP_CREATED,
        user_id=current_user.get("user_id"), company_id=res.source_company_id,
        ip_address=_client_ip(request),
        record_id=transfer_id, record_type="intercompany_settle",
        extra={"settlement_status": res.settlement_status, "idempotency_key": idempotency_key},
    )
    return res


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


@router.post("/receipts", response_model=ReceiptUploadOut, summary="Upload receipt image (JPG, PNG, HEIC) or PDF")
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


@router.get("/categories", response_model=List[PettyCashCategoryOut], summary="List configurable categories for a company")
def list_categories(
    company_id: Optional[int] = Query(None),
    company_name: Optional[str] = Query(None),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = PettyCashService(db)
    cid = company_id if isinstance(company_id, int) else None
    cname = company_name if isinstance(company_name, str) else None
    company = service.resolve_company(cid, cname)
    check_company_access(current_user, company.company_id)
    return (
        db.query(PettyCashCategory)
        .filter(PettyCashCategory.company_id == company.company_id)
        .order_by(PettyCashCategory.name.asc())
        .all()
    )


@router.post("/categories", response_model=PettyCashCategoryOut, status_code=status.HTTP_201_CREATED, summary="Create category for a company")
def create_category(
    payload: PettyCashCategoryCreate,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = PettyCashService(db)
    company = service.resolve_company(payload.company_id, payload.company_name)
    check_company_access(current_user, company.company_id)
    cat_name = payload.name.strip()
    if not cat_name:
        raise HTTPException(status_code=422, detail="Category name cannot be empty.")

    existing = (
        db.query(PettyCashCategory)
        .filter(
            PettyCashCategory.company_id == company.company_id,
            func.lower(PettyCashCategory.name) == cat_name.lower(),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Category '{cat_name}' already exists for {company.company_name}."
        )

    new_cat = PettyCashCategory(
        company_id=company.company_id,
        name=cat_name,
    )
    db.add(new_cat)
    db.commit()
    db.refresh(new_cat)
    return new_cat


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a category for a company")
def delete_category(
    category_id: int,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    cat = db.query(PettyCashCategory).filter(PettyCashCategory.category_id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found.")
    check_company_access(current_user, cat.company_id)
    db.delete(cat)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

