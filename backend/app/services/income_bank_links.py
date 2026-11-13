"""Money that tenants and borrowers move through a company bank (spec 0045).

- A tenant rent payment and a borrower repayment each become a Sale credited to the chosen bank.
- A loan release becomes an Expense debited from the chosen bank.

The Sale / Expense is what moves the bank (through the usual reconcile helpers) and what shows the money in
Transactions. Once an Auditor has Verified it, it is locked: the source payment can no longer be edited or
removed, so the ledger and the bank never drift away from what was audited.
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.cache import system_cache

logger = logging.getLogger(__name__)

RENT_CATEGORY = "Rental Income"
REPAYMENT_CATEGORY = "Loan Repayment"
RELEASE_CATEGORY = "Loan Release"


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _plain(text: str) -> str:
    """One plain line with no parentheses, so the sale/expense line parser reads the full amount as paid."""
    return " ".join((text or "").replace("(", " ").replace(")", " ").split())


def is_verified(audit_status: Optional[str]) -> bool:
    return (audit_status or "").strip().lower() == "verified"


def validate_company_bank(db: Session, company_id: int, account_id: Optional[str]):
    """The bank account must exist and belong to (or be shared with) the company. Returns the account."""
    from app.models.bank import BankAccount
    from app.models.company import Company

    account_id = (account_id or "").strip()
    if not account_id:
        raise HTTPException(status_code=400, detail="Please choose a bank account.")
    account = db.query(BankAccount).filter(BankAccount.id == account_id).first()
    if account is None:
        raise HTTPException(status_code=400, detail="The selected bank account was not found.")
    company = db.query(Company).filter(Company.company_id == company_id).first()
    company_name = (company.company_name if company else "").strip().lower()
    owners = [n.strip().lower() for n in (account.company_names or [])]
    if account.company_id != company_id and company_name not in owners:
        raise HTTPException(status_code=400, detail="The selected bank account does not belong to this company.")
    return account


def _category_id(db: Session, name: str) -> Optional[int]:
    from app.models.finance import Category

    cat = db.query(Category).filter(func.lower(Category.name) == name.lower()).order_by(Category.category_id).first()
    if cat is None:
        cat = Category(name=name)
        db.add(cat)
        db.flush()
    return cat.category_id


# ── Sales (money in) ─────────────────────────────────────────────────────────

def assert_sale_editable(db: Session, sale_id: Optional[int], what: str = "payment") -> None:
    if not sale_id:
        return
    from app.models.finance import Sale

    sale = db.query(Sale).filter(Sale.sales_id == sale_id).first()
    if sale is not None and is_verified(sale.audit_status):
        raise HTTPException(
            status_code=409,
            detail=f"This {what} is already in Sales and has been Verified by an Auditor, so it can no longer be changed.",
        )


def save_income_sale(
    db: Session,
    *,
    sale_id: Optional[int],
    company_id: int,
    bank_account_id: str,
    amount,
    tx_date: date,
    particulars: str,
    category: str,
    payment_method: Optional[str] = None,
    reference_no: Optional[str] = None,
) -> int:
    """Create the sale, or update the existing one. Flushes only: the caller commits, then calls reconcile_sale."""
    from app.models.finance import Sale

    category_id = _category_id(db, category)
    sale = db.query(Sale).filter(Sale.sales_id == sale_id).first() if sale_id else None
    if sale is not None and is_verified(sale.audit_status):
        raise HTTPException(status_code=409, detail="The linked sale has been Verified by an Auditor and cannot be changed.")
    if sale is None:
        sale = Sale(company_id=company_id, audit_status="Pending Audit")
        db.add(sale)
    sale.company_id = company_id
    sale.category_id = category_id
    sale.payment_method = (payment_method or "Cash").strip() or "Cash"
    sale.payment_status = "Paid"
    sale.transaction_date = tx_date
    sale.amount = _money(amount)
    sale.particulars = _plain(particulars)
    sale.cheque_no = (reference_no or "").strip() or None
    sale.bank_account_id = bank_account_id
    # The money is in the bank on the day it was received
    sale.deposit_status = "Deposited"
    sale.deposit_date = tx_date
    db.flush()
    return sale.sales_id


def reconcile_sale(db: Session, sale_id: Optional[int]) -> None:
    if not sale_id:
        return
    from app.api.v1.endpoints.sales import reconcile_sale_bank

    reconcile_sale_bank(db, sale_id=sale_id)
    system_cache.invalidate_tag("sales")


def remove_income_sale(db: Session, sale_id: Optional[int]) -> None:
    """Take the money back out of the bank and delete the sale. Commits."""
    if not sale_id:
        return
    from app.api.v1.endpoints.sales import reconcile_sale_bank
    from app.models.finance import Sale
    from app.services.bank_service import BankService

    sale = db.query(Sale).filter(Sale.sales_id == sale_id).first()
    if sale is not None and is_verified(sale.audit_status):
        raise HTTPException(status_code=409, detail="The linked sale has been Verified by an Auditor and cannot be removed.")
    reconcile_sale_bank(db, sale_id=sale_id, force_zero=True)
    sale = db.query(Sale).filter(Sale.sales_id == sale_id).first()
    if sale is not None:
        db.delete(sale)
        db.commit()
    try:
        BankService(db).purge_linked_entries(link_attr="source_sale_id", link_id=sale_id)
    except Exception as exc:
        db.rollback()
        logger.warning("Bank entry purge skipped for sale %s: %s", sale_id, exc)
    system_cache.invalidate_tag("sales")


# ── Expenses (money out) ─────────────────────────────────────────────────────

def assert_expense_editable(db: Session, expense_id: Optional[int], what: str = "loan release") -> None:
    if not expense_id:
        return
    from app.models.finance import Expense

    exp = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if exp is not None and is_verified(exp.audit_status):
        raise HTTPException(
            status_code=409,
            detail=f"This {what} is already in Expenses and has been Verified by an Auditor, so it can no longer be changed.",
        )


def check_bank_balance(account, amount, *, exclude: Decimal = Decimal("0.00")) -> None:
    """The bank must hold the amount. `exclude` is what this record already took out of the same account."""
    available = _money(account.current_balance) + _money(exclude)
    if _money(amount) > available:
        raise HTTPException(
            status_code=400,
            detail=f"Amount (₱{_money(amount):,.2f}) is more than the balance of {account.bank_name} (₱{available:,.2f}).",
        )


def save_release_expense(
    db: Session,
    *,
    expense_id: Optional[int],
    company_id: int,
    bank_account_id: str,
    amount,
    tx_date: date,
    description: str,
    reference_no: Optional[str] = None,
) -> int:
    """Create or update the loan-release expense. Flushes only: the caller commits, then calls reconcile_expense."""
    from app.models.finance import Expense

    category_id = _category_id(db, RELEASE_CATEGORY)
    exp = db.query(Expense).filter(Expense.expense_id == expense_id).first() if expense_id else None
    if exp is not None and is_verified(exp.audit_status):
        raise HTTPException(status_code=409, detail="The loan release expense has been Verified by an Auditor and cannot be changed.")
    if exp is None:
        exp = Expense(company_id=company_id, audit_status="Pending Audit")
        db.add(exp)
    exp.company_id = company_id
    exp.category_id = category_id
    exp.expense_date = tx_date
    exp.amount = _money(amount)
    exp.amount_paid = _money(amount)
    exp.description = _plain(description)
    exp.payment_method = "Bank Transfer"
    exp.reference_no = reference_no
    exp.bank_account_id = bank_account_id
    db.flush()
    return exp.expense_id


def reconcile_expense(db: Session, expense_id: Optional[int]) -> None:
    if not expense_id:
        return
    from app.api.v1.endpoints.expenses import reconcile_expense_bank

    reconcile_expense_bank(db, expense_id=expense_id)
    system_cache.invalidate_tag("expenses")


def remove_release_expense(db: Session, expense_id: Optional[int]) -> None:
    """Give the money back to the bank and delete the expense. Commits."""
    if not expense_id:
        return
    from app.api.v1.endpoints.expenses import reconcile_expense_bank
    from app.models.finance import Expense
    from app.services.bank_service import BankService

    exp = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if exp is not None and is_verified(exp.audit_status):
        raise HTTPException(status_code=409, detail="The loan release expense has been Verified by an Auditor and cannot be removed.")
    reconcile_expense_bank(db, expense_id=expense_id, force_zero=True)
    exp = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    if exp is not None:
        db.delete(exp)
        db.commit()
    try:
        BankService(db).purge_linked_entries(link_attr="source_expense_id", link_id=expense_id)
    except Exception as exc:
        db.rollback()
        logger.warning("Bank entry purge skipped for expense %s: %s", expense_id, exc)
    system_cache.invalidate_tag("expenses")
