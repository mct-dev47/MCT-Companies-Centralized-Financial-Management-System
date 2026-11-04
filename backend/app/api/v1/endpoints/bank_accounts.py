from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.dependencies import (
    AuthenticatedUser,
    BusinessReader,
    BusinessWriter,
    FinanceUser,
    check_company_access,
    require_business_reader,
    require_business_writer,
    require_finance_user,
)
from app.core.company_resolver import resolve_company
from app.models.company import Company
from app.schemas.bank import (
    BankAccountCreate,
    BankAccountUpdate,
    BankAccountOut,
    BankTransactionOut,
    BankDepositWithdrawRequest,
)
from app.services.bank_service import BankService
from app.core.websocket import ws_manager

router = APIRouter()


@router.get("", response_model=List[BankAccountOut], summary="List corporate bank accounts")
def list_bank_accounts(
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    user_role = (current_user.get("role") or "").lower()

    if company_name and company_name.strip().lower() != "all companies":
        comp = resolve_company(db, company_name=company_name)
        check_company_access(current_user, comp.company_id)
        return service.list_accounts(company_name=comp.company_name, company_id=comp.company_id)

    accounts = service.list_accounts()
    if user_role in ("finance", "audit", "auditor"):
        return accounts

    # For supervisor, filter to their assigned companies
    user_company_ids = current_user.get("company_ids") or []
    if current_user.get("company_id") and current_user["company_id"] not in user_company_ids:
        user_company_ids.append(current_user["company_id"])

    assigned_names = {
        c.company_name.lower()
        for c in db.query(Company).filter(Company.company_id.in_(user_company_ids)).all()
    }
    return [
        a for a in accounts
        if (getattr(a, "company_name", None) or getattr(a, "company", "") or "").lower() in assigned_names
    ]


@router.get("/{account_id}", response_model=BankAccountOut, summary="Get single bank account with transactions")
def get_bank_account(
    account_id: str,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found.")

    user_role = (current_user.get("role") or "").lower()
    comp_name = getattr(account, "company_name", getattr(account, "company", None))
    if user_role not in ("finance", "audit", "auditor") and comp_name:
        comp = resolve_company(db, company_name=comp_name)
        check_company_access(current_user, comp.company_id)

    return account


@router.post("", response_model=BankAccountOut, status_code=status.HTTP_201_CREATED, summary="Create a new bank account")
def create_bank_account(
    data: BankAccountCreate,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.create_account(data)
    ws_manager.broadcast_sync({
        "type": "BANK_UPDATED",
        "payload": {
            "account_id": account.id,
            "company_id": account.company_id,
            "action": "created",
        }
    })
    return account


@router.put("/{account_id}", response_model=BankAccountOut, summary="Update bank account details")
def update_bank_account(
    account_id: str,
    data: BankAccountUpdate,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.update_account(account_id, data)
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found.")
    ws_manager.broadcast_sync({
        "type": "BANK_UPDATED",
        "payload": {
            "account_id": account_id,
            "company_id": account.company_id,
            "action": "updated",
        }
    })
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a bank account")
def delete_bank_account(
    account_id: str,
    current_user: AuthenticatedUser = Depends(require_finance_user),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found.")
    company_id = account.company_id
    success = service.delete_account(account_id)
    if not success:
        raise HTTPException(status_code=404, detail="Bank account not found.")
    ws_manager.broadcast_sync({
        "type": "BANK_UPDATED",
        "payload": {
            "account_id": account_id,
            "company_id": company_id,
            "action": "deleted",
        }
    })
    return None


@router.post("/{account_id}/deposit", response_model=BankAccountOut, summary="Record a deposit to bank account")
def deposit_to_bank_account(
    account_id: str,
    req: BankDepositWithdrawRequest,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found.")
    comp_name = getattr(account, "company_name", getattr(account, "company", None))
    if comp_name:
        comp = resolve_company(db, company_name=comp_name)
        check_company_access(current_user, comp.company_id)

    try:
        updated_account, tx = service.deposit(account_id, req)
        ws_manager.broadcast_sync({
            "type": "BANK_UPDATED",
            "payload": {
                "account_id": account_id,
                "company_id": updated_account.company_id,
                "transaction_id": tx.id,
                "action": "deposit",
            }
        })
        return updated_account
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{account_id}/withdraw", response_model=BankAccountOut, summary="Record a withdrawal from bank account")
def withdraw_from_bank_account(
    account_id: str,
    req: BankDepositWithdrawRequest,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found.")
    comp_name = getattr(account, "company_name", getattr(account, "company", None))
    if comp_name:
        comp = resolve_company(db, company_name=comp_name)
        check_company_access(current_user, comp.company_id)

    try:
        updated_account, tx = service.withdraw(account_id, req)
        ws_manager.broadcast_sync({
            "type": "BANK_UPDATED",
            "payload": {
                "account_id": account_id,
                "company_id": updated_account.company_id,
                "transaction_id": tx.id,
                "action": "withdrawal",
            }
        })
        return updated_account
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
