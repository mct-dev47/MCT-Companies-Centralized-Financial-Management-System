import pytest
from datetime import date
from decimal import Decimal
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.models.petty_cash import PettyCashWallet, PettyCashTopUp
from app.schemas.petty_cash import PettyCashTopUpCreate
from app.services.petty_cash_service import PettyCashService


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        if db.query(Company).count() == 0:
            comp = Company(
                company_id=1,
                company_name="JK Property and Ventures",
                location="Manila",
                starting_balance=Decimal("100000.00"),
                petty_cash=Decimal("10000.00"),
            )
            db.add(comp)
            db.add(
                PettyCashWallet(
                    company_id=1,
                    balance=Decimal("10000.00"),
                    low_balance_threshold=Decimal("5000.00"),
                )
            )
            db.commit()
        yield db
    finally:
        db.close()


def test_petty_cash_wallets_balance_column_resilience(db_session: Session):
    """Verify that querying petty cash summaries runs without missing column errors."""
    service = PettyCashService(db_session)
    summaries = service.list_summaries()
    assert isinstance(summaries, list)
    assert len(summaries) > 0
    # Every summary should have a non negative threshold and a numeric balance
    for s in summaries:
        assert isinstance(s.balance, Decimal)
        assert isinstance(s.low_balance_threshold, Decimal)


def test_finance_direct_endorsement_creation_and_ledger(db_session: Session):
    """Verify that creating a top-up with direct endorsement assigns Pending Audit Approval."""
    service = PettyCashService(db_session)
    company = db_session.query(Company).first()
    assert company is not None

    finance_user = {
        "user_id": 9999,
        "full_name": "Finance Test User",
        "email": "finance@mct.com",
        "role": "finance",
        "company_id": company.company_id,
        "company_ids": [company.company_id],
    }

    create_in = PettyCashTopUpCreate(
        company_id=company.company_id,
        amount=Decimal("1500.00"),
        topup_date=date.today(),
        description="SPEC-0024 automated test endorsement",
        status="Pending Audit Approval",
        finance_remark="Automated endorsement remark",
    )

    result = service.create_topup(create_in, current_user=finance_user)
    assert result.status == "Pending Audit Approval"
    assert result.endorsed_by == "Finance Test User"
    assert result.finance_remark == "Automated endorsement remark"

    # Verify that ledger includes this entry
    ledger = service.list_ledger(company=company)
    matching = [e for e in ledger if getattr(e, "record_id", None) == result.topup_id]
    assert len(matching) == 1
    assert matching[0].status == "Pending Audit Approval"

    # Clean up test topup
    created_topup = db_session.query(PettyCashTopUp).filter_by(topup_id=result.topup_id).first()
    if created_topup:
        db_session.delete(created_topup)
        db_session.commit()


def test_petty_cash_approval_creates_bank_withdrawal(db_session: Session):
    """Verify that Audit approval of petty cash top-up funded from company's own bank records a real bank withdrawal."""
    service = PettyCashService(db_session)
    company = db_session.query(Company).first()
    assert company is not None

    # Setup or create a bank account for this company
    test_bank_id = f"test-bnk-{company.company_id}"
    bank = db_session.query(BankAccount).filter_by(id=test_bank_id).first()
    if not bank:
        bank = BankAccount(
            id=test_bank_id,
            company_id=company.company_id,
            company_name=company.company_name,
            bank_name="Test BDO Bank",
            account_name="Petty Cash Source Account",
            account_number="1234567890",
            starting_balance=Decimal("50000.00"),
            current_balance=Decimal("50000.00"),
            account_type="Checking",
        )
        db_session.add(bank)
        db_session.commit()
    else:
        bank.current_balance = Decimal("50000.00")
        db_session.commit()

    initial_balance = bank.current_balance
    topup_amount = Decimal("3000.00")

    # Create top-up with own bank account as funding bank
    finance_user = {
        "user_id": 9998,
        "full_name": "Finance Reviewer",
        "email": "finance@mct.com",
        "role": "finance",
        "company_id": company.company_id,
        "company_ids": [company.company_id],
    }

    create_in = PettyCashTopUpCreate(
        company_id=company.company_id,
        amount=topup_amount,
        topup_date=date.today(),
        description="Pantry & minor office supplies replenishment",
        status="Pending Audit Approval",
        bank_account_id=bank.id,
        finance_remark="Funded from company main account",
    )

    created = service.create_topup(create_in, current_user=finance_user)
    assert created.status == "Pending Audit Approval"

    # Audit approves the top-up
    approved = service.review_topup(
        topup_id=created.topup_id,
        action="approve",
        remark="Audit approved for petty cash disbursement",
        reviewer_name="Internal Auditor",
    )
    assert approved.status == "Approved"

    # Verify that the bank account balance decreased by topup_amount
    db_session.refresh(bank)
    assert bank.current_balance == initial_balance - topup_amount

    # Verify that a BankTransaction record was created with withdrawal = topup_amount
    tx = (
        db_session.query(BankTransaction)
        .filter(BankTransaction.bank_account_id == bank.id)
        .order_by(BankTransaction.created_at.desc())
        .first()
    )
    assert tx is not None
    assert tx.withdrawal == topup_amount
    assert tx.deposit == Decimal("0.00")
    assert "Petty Cash Replenishment" in tx.particulars

    # Clean up test topup and bank transaction
    db_session.delete(tx)
    topup_row = db_session.query(PettyCashTopUp).filter_by(topup_id=created.topup_id).first()
    if topup_row:
        db_session.delete(topup_row)
    db_session.commit()
