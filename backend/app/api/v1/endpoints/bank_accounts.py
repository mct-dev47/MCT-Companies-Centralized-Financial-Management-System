from typing import List, Optional
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.dependencies import (
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
from app.schemas.audit_review import AuditReviewIn
from app.schemas.expense import RemarksUpdate
from app.core.company_resolver import resolve_company
from app.core.pagination import PaginationParams
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
    include_transactions: bool = Query(True, description="Include embedded transactions list"),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    user_role = (current_user.get("role") or "").lower()

    if company_name and company_name.strip().lower() != "all companies":
        comp = resolve_company(db, company_name=company_name)
        check_company_access(current_user, comp.company_id)
        return service.list_accounts(
            company_name=comp.company_name,
            company_id=comp.company_id,
            include_transactions=include_transactions,
        )

    accounts = service.list_accounts(include_transactions=include_transactions)
    if user_role in ("audit", "auditor", "owner"):
        return accounts

    # For finance, supervisor, and company users, filter to their assigned companies (including shared-owner and alias-matched banks)
    from app.core.company_resolver import normalize_company_id

    raw_ids = list(current_user.get("company_ids") or [])
    if current_user.get("company_id") is not None:
        raw_ids.append(current_user["company_id"])
    assigned_ids = {
        nid for nid in (normalize_company_id(cid) for cid in raw_ids) if nid is not None
    }
    if not assigned_ids:
        return []

    assigned_names = {
        cname.strip().lower()
        for (cname,) in db.query(Company.company_name).filter(Company.company_id.in_(assigned_ids)).all()
        if cname
    }
    owner_id_cache: dict[str, Optional[int]] = {}

    def _owner_matches(owner_name: str) -> bool:
        key = (owner_name or "").strip().lower()
        if not key or key == "general treasury / unassigned":
            return False
        if key in assigned_names:
            return True
        if key not in owner_id_cache:
            try:
                resolved = resolve_company(db, company_name=owner_name)
                owner_id_cache[key] = normalize_company_id(resolved.company_id)
            except HTTPException:
                owner_id_cache[key] = None
        return owner_id_cache[key] in assigned_ids

    def _account_in_scope(acc) -> bool:
        acc_cid = normalize_company_id(getattr(acc, "company_id", None))
        if acc_cid is not None and acc_cid in assigned_ids:
            return True
        owners = acc.company_names or [getattr(acc, "company_name", "") or ""]
        return any(_owner_matches(n) for n in owners if n)

    return [a for a in accounts if _account_in_scope(a)]


@router.get("/{account_id}/transactions", response_model=List[BankTransactionOut], summary="List paginated bank transactions for an account")
def list_bank_account_transactions(
    account_id: str,
    response: Response,
    search: Optional[str] = Query(None, description="Search particulars, cheque no, or category"),
    tx_type: Optional[str] = Query(None, description="Filter by 'deposit' or 'withdrawal'"),
    sort_dir: Optional[str] = Query("desc", description="Sort direction ('asc' or 'desc')"),
    pagination: PaginationParams = Depends(),
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    if hasattr(search, "default"):
        search = None
    if hasattr(tx_type, "default"):
        tx_type = None
    if hasattr(sort_dir, "default"):
        sort_dir = "desc"
    service = BankService(db)
    acc = service.get_account(account_id)
    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank account not found")
    _check_any_owner_access(db, current_user, acc)
    rows, total = service.list_transactions_paginated(
        account_id=account_id,
        offset=pagination.offset,
        limit=pagination.limit,
        search=search,
        tx_type=tx_type,
        sort_dir=sort_dir or "desc",
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("/reconcile", summary="Bring every bank back in line with the Transactions ledger")
def reconcile_bank_accounts(
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    """Finance (all companies) or a Supervisor (their assigned companies only)."""
    from app.core.dependencies import get_authorized_company_scope
    from app.services.bank_reconcile import reconcile_all_banks

    result = reconcile_all_banks(db, company_ids=get_authorized_company_scope(current_user))
    ws_manager.broadcast_sync({"type": "BANK_UPDATED", "payload": {"action": "reconciled"}})
    return result


@router.get("/{account_id}", response_model=BankAccountOut, summary="Get single bank account with transactions")
def get_bank_account(
    account_id: str,
    current_user: AuthenticatedUser = Depends(require_business_reader),
    db: Session = Depends(get_db),
):
    service = BankService(db)
    account = service.get_account(account_id, with_entries=True)
    if not account:
        raise HTTPException(status_code=404, detail="Bank account not found.")

    user_role = (current_user.get("role") or "").lower()
    comp_name = getattr(account, "company_name", getattr(account, "company", None))
    if user_role not in ("finance", "audit", "auditor", "owner") and comp_name:
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
        updated_account, tx = service.deposit(account_id, req, entry_source="manual")
        ws_manager.broadcast_sync({
            "type": "BANK_UPDATED",
            "payload": {
                "account_id": account_id,
                "company_id": updated_account.company_id,
                "transaction_id": tx.id,
                "action": "deposit",
            }
        })
        return service.get_account(account_id, with_entries=True)
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
        updated_account, tx = service.withdraw(account_id, req, entry_source="manual")
        ws_manager.broadcast_sync({
            "type": "BANK_UPDATED",
            "payload": {
                "account_id": account_id,
                "company_id": updated_account.company_id,
                "transaction_id": tx.id,
                "action": "withdrawal",
            }
        })
        return service.get_account(account_id, with_entries=True)
    except ValueError as e:
        msg = _sanitize_value_error(str(e), "Invalid withdrawal parameters.")
        raise HTTPException(status_code=400, detail=msg)


@router.patch("/transactions/{transaction_id}/audit", response_model=BankTransactionOut, summary="Save the audit review of a bank transaction (Auditor only)")
@router.patch("/{account_id}/transactions/{transaction_id}/audit", response_model=BankTransactionOut, summary="Save the audit review of a bank transaction (Auditor only)")
def review_bank_transaction_audit(
    transaction_id: str,
    review_in: AuditReviewIn,
    request: Request,
    account_id: Optional[str] = None,
    current_user: AuthenticatedUser = Depends(require_auditor_user),
    db: Session = Depends(get_db),
):
    from app.models.bank import BankTransaction, BankAccount
    from app.models.finance import Expense, Sale
    from app.services.audit_review_service import _auditor_name, apply_audit_review
    from app.services.audit_service import AuditAction, log_transaction
    from datetime import datetime, timezone

    tx = db.query(BankTransaction).filter(BankTransaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Bank transaction not found")

    account = db.query(BankAccount).filter(BankAccount.id == tx.bank_account_id).first()
    if account:
        _check_any_owner_access(db, current_user, account)

    auditor = _auditor_name(db, current_user)
    now_utc = datetime.now(timezone.utc)
    target_remarks = (review_in.remarks or "").strip() or None

    if review_in.audit_status == "Pending Audit":
        tx.audit_status = "Pending Audit"
        tx.audited_by = None
        tx.audited_at = None
        tx.audit_remarks = None
    else:
        tx.audit_status = review_in.audit_status
        tx.audited_by = auditor
        tx.audited_at = now_utc
        tx.audit_remarks = target_remarks

    # If linked to expense, update the expense's audit review as well
    if tx.source_expense_id:
        try:
            apply_audit_review(
                db, current_user,
                model=Expense, pk_column="expense_id", supabase_table="expenses",
                record_id=tx.source_expense_id, payload=review_in, not_found="Expense not found",
            )
        except Exception:
            exp = db.query(Expense).filter(Expense.expense_id == tx.source_expense_id).first()
            if exp:
                exp.audit_status = tx.audit_status
                exp.audited_by = tx.audited_by
                exp.audited_at = tx.audited_at
                exp.audit_remarks = tx.audit_remarks

    # If linked to sale, update the sale's audit review as well
    if tx.source_sale_id:
        try:
            apply_audit_review(
                db, current_user,
                model=Sale, pk_column="sales_id", supabase_table="sales",
                record_id=tx.source_sale_id, payload=review_in, not_found="Sale not found",
            )
        except Exception:
            s = db.query(Sale).filter(Sale.sales_id == tx.source_sale_id).first()
            if s:
                s.audit_status = tx.audit_status
                s.audited_by = tx.audited_by
                s.audited_at = tx.audited_at
                s.audit_remarks = tx.audit_remarks

    db.commit()
    db.refresh(tx)

    log_transaction(
        db, AuditAction.EXPENSE_UPDATED if tx.source_expense_id else AuditAction.SALE_UPDATED if tx.source_sale_id else AuditAction.BANK_UPDATED,
        user_id=current_user.get("user_id"),
        company_id=account.company_id if account else None,
        ip_address=request.client.host if request.client else "unknown",
        record_id=tx.source_expense_id or tx.source_sale_id or transaction_id,
        record_type="expense_audit_review" if tx.source_expense_id else "sale_audit_review" if tx.source_sale_id else "bank_transaction_audit_review",
        extra={"audit_status": review_in.audit_status, "remarks": target_remarks, "bank_tx_id": transaction_id},
    )

    ws_manager.broadcast_sync({
        "type": "AUDIT_UPDATED",
        "payload": {"resource": "bank_transactions", "id": transaction_id, "expense_id": tx.source_expense_id, "sale_id": tx.source_sale_id},
    })
    ws_manager.broadcast_sync({
        "type": "BANK_UPDATED",
        "payload": {"account_id": tx.bank_account_id, "transaction_id": transaction_id, "action": "audited"},
    })

    return tx


@router.patch("/transactions/{transaction_id}/remarks", response_model=BankTransactionOut, summary="Update operational remarks of a bank transaction")
@router.patch("/{account_id}/transactions/{transaction_id}/remarks", response_model=BankTransactionOut, summary="Update operational remarks of a bank transaction")
def update_bank_transaction_remarks(
    transaction_id: str,
    remarks_in: RemarksUpdate,
    request: Request,
    account_id: Optional[str] = None,
    current_user: AuthenticatedUser = Depends(require_business_writer),
    db: Session = Depends(get_db),
):
    from app.models.bank import BankTransaction, BankAccount
    from app.models.finance import Expense, Sale
    from app.services.audit_service import AuditAction, log_transaction

    tx = db.query(BankTransaction).filter(BankTransaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Bank transaction not found")

    account = db.query(BankAccount).filter(BankAccount.id == tx.bank_account_id).first()
    if account:
        _check_any_owner_access(db, current_user, account)

    target_remarks = remarks_in.remarks.strip() if remarks_in.remarks and remarks_in.remarks.strip() else None
    tx.remarks = target_remarks

    # If linked to expense, update expense remarks too
    if tx.source_expense_id:
        exp = db.query(Expense).filter(Expense.expense_id == tx.source_expense_id).first()
        if exp:
            exp.remarks = target_remarks
            try:
                from app.db.supabase import get_supabase_admin_client
                client = get_supabase_admin_client()
                client.table("expenses").update({"remarks": target_remarks}).eq("expense_id", tx.source_expense_id).execute()
            except Exception:
                pass

    # If linked to sale, update sale remarks too
    if tx.source_sale_id:
        s = db.query(Sale).filter(Sale.sales_id == tx.source_sale_id).first()
        if s:
            s.remarks = target_remarks
            try:
                from app.db.supabase import get_supabase_admin_client
                client = get_supabase_admin_client()
                client.table("sales").update({"remarks": target_remarks}).eq("sales_id", tx.source_sale_id).execute()
            except Exception:
                pass

    db.commit()
    db.refresh(tx)

    actor_name = current_user.get("full_name") or current_user.get("name") or current_user.get("email") or f"User #{current_user.get('user_id')}"
    log_transaction(
        db, AuditAction.EXPENSE_UPDATED if tx.source_expense_id else AuditAction.BANK_UPDATED,
        user_id=current_user.get("user_id"),
        company_id=account.company_id if account else None,
        ip_address=request.client.host if request.client else "unknown",
        record_id=tx.source_expense_id or tx.source_sale_id or transaction_id,
        record_type="expense" if tx.source_expense_id else "bank_transaction",
        extra={"remarks": target_remarks, "actor_name": actor_name, "bank_tx_id": transaction_id},
    )

    ws_manager.broadcast_sync({
        "type": "BANK_UPDATED",
        "payload": {"account_id": tx.bank_account_id, "transaction_id": transaction_id, "action": "remarks_updated", "remarks": target_remarks},
    })
    if tx.source_expense_id:
        ws_manager.broadcast_sync({
            "type": "EXPENSE_UPDATED",
            "payload": {"expense_id": tx.source_expense_id, "action": "remarks_updated", "remarks": target_remarks},
        })

    return tx
