from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.schemas.company import CompanyCreate, CompanyUpdate
from app.services.company_service import CompanyService


def test_create_company_auto_creates_primary_bank_with_starting_balance(db: Session):
    service = CompanyService(db)
    comp_in = CompanyCreate(
        name="Auto Bank Co",
        location="Makati",
        starting_balance=Decimal("250000.00"),
        petty_cash=Decimal("5000.00"),
    )
    result = service.create_company(comp_in)
    assert result.id is not None
    assert result.starting_balance == 250000.00

    # Verify BankAccount was auto-created
    acc = db.query(BankAccount).filter(BankAccount.company_id == result.id).first()
    assert acc is not None
    assert acc.company_name == "Auto Bank Co"
    assert acc.bank_name == "CHINABANK"
    assert Decimal(str(acc.starting_balance)) == Decimal("250000.00")
    assert Decimal(str(acc.current_balance)) == Decimal("250000.00")


def test_update_company_starting_balance_syncs_existing_bank_and_recalculates(db: Session):
    service = CompanyService(db)
    comp_in = CompanyCreate(
        name="Sync Existing Bank Co",
        location="BGC",
        starting_balance=Decimal("100000.00"),
    )
    result = service.create_company(comp_in)
    acc = db.query(BankAccount).filter(BankAccount.company_id == result.id).first()
    assert acc is not None
    assert Decimal(str(acc.starting_balance)) == Decimal("100000.00")

    # Add transactions to this bank account
    db.add(BankTransaction(
        id="tx-test-01",
        bank_account_id=acc.id,
        transaction_date="2026-11-16",
        particulars="Customer Deposit",
        deposit=Decimal("20000.00"),
        withdrawal=Decimal("0.00"),
        net_amount=Decimal("20000.00"),
        category="Sales Deposit",
    ))
    db.add(BankTransaction(
        id="tx-test-02",
        bank_account_id=acc.id,
        transaction_date="2026-11-16",
        particulars="Office Supplies",
        deposit=Decimal("0.00"),
        withdrawal=Decimal("5000.00"),
        net_amount=Decimal("-5000.00"),
        category="Operating Expense",
    ))
    acc.current_balance = Decimal("115000.00")
    db.commit()

    # Now Admin updates company starting balance to 300000.00
    updated = service.update_company(result.id, CompanyUpdate(starting_balance=Decimal("300000.00")))
    assert updated is not None
    assert updated.starting_balance == 300000.00

    db.refresh(acc)
    # Starting balance is updated
    assert Decimal(str(acc.starting_balance)) == Decimal("300000.00")
    # Current balance is re-derived: 300000 + 20000 - 5000 = 315000
    assert Decimal(str(acc.current_balance)) == Decimal("315000.00")


def test_reconcile_existing_company_starting_balances(db: Session):
    service = CompanyService(db)
    # Create a company without a bank account
    company = Company(
        company_name="Orphan Balance Corp",
        location="Ortigas",
        starting_balance=Decimal("500000.00"),
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    # Reconcile
    reconciled = service.reconcile_existing_company_starting_balances()
    assert reconciled >= 1

    acc = db.query(BankAccount).filter(BankAccount.company_id == company.company_id).first()
    assert acc is not None
    assert Decimal(str(acc.starting_balance)) == Decimal("500000.00")
    assert Decimal(str(acc.current_balance)) == Decimal("500000.00")
