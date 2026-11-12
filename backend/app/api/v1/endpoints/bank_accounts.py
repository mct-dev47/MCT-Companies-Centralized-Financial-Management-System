from typing import List, Optional
import re
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

def _sanitize_value_error(msg: str, fallback: str) -> str:
    lower = msg.lower()
    suspicious_tokens = ["traceback", "sql", "password", "secret", "select ", "insert ", "update ", "delete ", "c:\\", "/var/", "/usr/", "/etc/"]
    if any(tok in lower for tok in suspicious_tokens) or re.search(r"[/\\].+[/\\].", msg):
        return fallback
    return msg


def _check_any_owner_access(db: Session, current_user, account) -> None:
    """Allow access when the user may access ANY owner company of the account; re-raise the last denial otherwise."""
    owners = [n for n in (account.company_names or [account.company_name]) if n and str(n).strip()]
    if not owners:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: account has no associated company.",
        )
    last_exc: Optional[HTTPException] = None
    for name in owners:
        try:
            comp = resolve_company(db, company_name=name)
            check_company_access(current_user, comp.company_id)
            return
        except HTTPException as exc:
            last_exc = exc
    if last_exc:
        raise last_exc
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied to bank account.",
    )


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
        if any(n.lower() in assigned_names for n in (a.company_names or [getattr(a, "company", "") or ""]))
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
        _check_any_owner_access(db, current_user, account)

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
    try:
        account = service.update_account(account_id, data)
    except ValueError as e:
        db.rollback()
        msg = _sanitize_value_error(str(e), "Invalid bank account parameters.")
        raise HTTPException(status_code=400, detail=msg)
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
        _check_any_owner_access(db, current_user, account)
    if req.company_name:
        req_comp = resolve_company(db, company_name=req.company_name)
        check_company_access(current_user, req_comp.company_id)

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
        msg = _sanitize_value_error(str(e), "Invalid deposit parameters.")
        raise HTTPException(status_code=400, detail=msg)


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
        _check_any_owner_access(db, current_user, account)
    if req.company_name:
        req_comp = resolve_company(db, company_name=req.company_name)
        check_company_access(current_user, req_comp.company_id)

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
        msg = _sanitize_value_error(str(e), "Invalid withdrawal parameters.")
        raise HTTPException(status_code=400, detail=msg)
