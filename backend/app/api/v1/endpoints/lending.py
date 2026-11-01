from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.company_features import COMPANY_FEATURE_LENDING, FILCAP_COMPANY_ID, require_company_feature_access
from app.core.dependencies import (
    AuthenticatedUser,
    BusinessReader,
    BusinessWriter,
    CurrentUser,
    check_company_access,
    get_current_user,
    require_business_reader,
    require_business_writer,
)
from app.db.session import get_db
from app.services.lending_service import LendingService
from app.schemas.lending import (
    LendingCalculateRequest,
    LendingCalculateResponse,
    BorrowerCreateRequest,
    BorrowerUpdateRequest,
    BorrowerDeleteResponse,
    BorrowerOut,
    LendingPaymentCreateRequest,
    LendingTransactionCreateRequest,
    LendingTransactionOut,
    LendingLedgerResponse,
)

router = APIRouter()


def _enforce_lending_access(user: dict, company_id: Optional[int] = None) -> None:
    """Enforce that Lending is strictly restricted to FILCAP Prime Holdings Corp. (ID 7) and authorized callers."""
    target_cid = company_id if company_id is not None else FILCAP_COMPANY_ID
    require_company_feature_access(COMPANY_FEATURE_LENDING, target_cid)
    check_company_access(user, target_cid)


@router.post(
    "/calculate",
    response_model=LendingCalculateResponse,
    summary="Stateless loan terms and installment calculation",
)
def calculate_terms(
    payload: LendingCalculateRequest,
    _: AuthenticatedUser = Depends(get_current_user),
):
    """
    Pure calculation endpoint computing interest, total payable, and installment amounts
    based on principal, interest rate, payment frequency, and schedule dates.
    """
    return LendingService.calculate_terms(
        principal=payload.principal,
        interest_rate=payload.interest_rate,
        frequency=payload.payment_frequency,
        start_date_val=payload.date_borrowed,
        due_date_val=payload.due_date,
        term_days_val=payload.term_days,
    )


@router.get(
    "/borrowers",
    response_model=List[BorrowerOut],
    summary="List borrowers with balance and schedule aggregates",
)
def list_borrowers(
    company_id: Optional[int] = Query(None, description="Filter by company ID (FILCAP only)"),
    borrower: Optional[str] = Query(None, description="Filter by borrower name"),
    user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user, company_id)
    return LendingService.get_borrowers(db=db, borrower_query=borrower)


@router.get(
    "/borrowers/{borrower_id}",
    response_model=BorrowerOut,
    summary="Get single borrower details",
)
def get_borrower(
    borrower_id: int,
    user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.get_borrower(db=db, borrower_id=borrower_id)


@router.post(
    "/borrowers",
    response_model=BorrowerOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new borrower",
)
def create_borrower(
    payload: BorrowerCreateRequest,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.create_borrower(
        db=db,
        borrower_name=payload.borrower_name,
        borrower_contact=payload.borrower_contact,
        borrower_address=payload.borrower_address,
        principal_amount=payload.loan_amount,
        interest_rate=payload.interest_rate,
        frequency=payload.payment_frequency,
        date_borrowed_val=payload.date_borrowed,
        due_date_val=payload.due_date,
        term_days_val=payload.term_days,
        notes=payload.notes,
    )


@router.put(
    "/borrowers/{borrower_id}",
    response_model=BorrowerOut,
    summary="Update an existing borrower",
)
def update_borrower(
    borrower_id: int,
    payload: BorrowerUpdateRequest,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.update_borrower(
        db=db,
        borrower_id=borrower_id,
        payload=payload.model_dump(exclude_unset=True),
    )


@router.delete(
    "/borrowers/{borrower_id}",
    response_model=BorrowerDeleteResponse,
    summary="Delete a borrower and associated transactions",
)
def delete_borrower(
    borrower_id: int,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.delete_borrower(db=db, borrower_id=borrower_id)


@router.get(
    "/ledger/{borrower_id}",
    response_model=LendingLedgerResponse,
    summary="Get complete borrower schedule ledger and installment progress",
)
def get_ledger(
    borrower_id: int,
    user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.get_borrower_ledger(db=db, borrower_id=borrower_id)


@router.get(
    "/transactions",
    response_model=List[LendingTransactionOut],
    summary="List and filter all lending transactions",
)
def list_transactions(
    user: AuthenticatedUser = Depends(require_business_reader),
    borrower_id: Optional[int] = Query(None, description="Filter by borrower ID"),
    transaction_type: Optional[str] = Query(None, description="Filter by transaction type"),
    payment_method: Optional[str] = Query(None, description="Filter by payment method"),
    date_from: Optional[str] = Query(None, description="Filter transactions starting from date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter transactions up to date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.get_transactions(
        db=db,
        borrower_id=borrower_id,
        transaction_type=transaction_type,
        payment_method=payment_method,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/transactions/{transaction_id}",
    response_model=LendingTransactionOut,
    summary="Get a single lending transaction by ID",
)
def get_transaction(
    transaction_id: int,
    user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.get_transaction(db=db, transaction_id=transaction_id)


@router.post(
    "/transactions",
    status_code=status.HTTP_201_CREATED,
    summary="Record a lending transaction in the lending_transactions table",
)
def create_transaction(
    payload: LendingTransactionCreateRequest,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    penalty_val = payload.penalty_amount if payload.penalty_amount is not None else payload.penalty_portion
    return LendingService.record_payment(
        db=db,
        borrower_id=payload.borrower_id,
        payment_date_val=payload.payment_date,
        amount_val=payload.amount,
        penalty_amount_val=penalty_val,
        method=payload.payment_method,
        reference_no=payload.reference_no,
        notes=payload.notes,
        transaction_type=payload.transaction_type,
        cycle_due_date_val=payload.cycle_due_date,
        cycle_index_val=payload.cycle_index,
    )


@router.post(
    "/payments",
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment remittance",
)
def record_payment(
    payload: LendingPaymentCreateRequest,
    user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    _enforce_lending_access(user)
    return LendingService.record_payment(
        db=db,
        borrower_id=payload.borrower_id,
        payment_date_val=payload.payment_date,
        amount_val=payload.amount,
        penalty_amount_val=payload.penalty_amount,
        method=payload.method,
        reference_no=payload.reference_no,
        notes=payload.notes,
        cycle_due_date_val=payload.cycle_due_date,
        cycle_index_val=payload.cycle_index,
    )
