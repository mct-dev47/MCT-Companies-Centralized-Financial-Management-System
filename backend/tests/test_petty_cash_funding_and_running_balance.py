"""
Petty cash: Company Petty Cash as a reimbursement funding source, reimbursements reaching the
Transactions page only once Reimbursed, and the ledger running balance being each row's ending
balance per company.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.cache import system_cache
from app.db.session import Base
from app.models.bank import BankAccount
from app.models.company import Company
from app.models.finance import Expense
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.schemas.petty_cash import PettyCashTopUpCreate
from app.services.petty_cash_service import PETTY_CASH_FUNDING, PettyCashService

FINANCE = {"user_id": 1, "role": "finance", "full_name": "Fin Officer"}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    system_cache.invalidate_tag("petty_cash")
    yield session
    session.close()
    system_cache.invalidate_tag("petty_cash")


@pytest.fixture
def setup(db):
    a = Company(company_id=201, company_name="Alpha Foods")
    b = Company(company_id=202, company_name="Beta Retail")
    db.add_all([a, b])
    db.flush()
    bank_a = BankAccount(
        id="BANK-A",
        company_id=a.company_id,
        company_name=a.company_name,
        bank_name="BDO",
        account_name="Alpha Checking",
        current_balance=Decimal("20000.00"),
        starting_balance=Decimal("20000.00"),
    )
    db.add(bank_a)
    db.add_all([
        PettyCashWallet(company_id=a.company_id, balance=Decimal("0"), low_balance_threshold=Decimal("100")),
        PettyCashWallet(company_id=b.company_id, balance=Decimal("0"), low_balance_threshold=Decimal("100")),
        PettyCashTopUp(company_id=a.company_id, amount=Decimal("5000.00"), topup_date=date.today(),
                       description="Float A", status="Approved", request_type="topup"),
        PettyCashTopUp(company_id=b.company_id, amount=Decimal("1000.00"), topup_date=date.today(),
                       description="Float B", status="Approved", request_type="topup"),
    ])
    db.commit()
    return {"a": a, "b": b, "bank_a": bank_a}


def _claim(company_id, out_of_pocket="300.00"):
    return PettyCashTopUpCreate(
        company_id=company_id,
        amount=Decimal(out_of_pocket),
        total_expenses=Decimal(out_of_pocket),
        company_funded_amount=Decimal("0.00"),
        topup_date=date.today(),
        paid_by="Juan",
        description="Meals",
        request_type="reimbursement",
    )


def test_reimbursement_paid_from_company_petty_cash(db, setup):
    svc = PettyCashService(db)
    a = setup["a"]
    claim = svc.create_topup(_claim(a.company_id))

    svc.endorse_topup(claim.topup_id, "endorse", "ok", "Fin", bank_account_id=PETTY_CASH_FUNDING)
    row = db.get(PettyCashTopUp, claim.topup_id)
    assert row.payment_method_option == PETTY_CASH_FUNDING
    assert row.bank_account_id is None

    svc.review_topup(claim.topup_id, "approve", "verified", "Auditor")
    assert svc.get_balance(a.company_id) == Decimal("5000.00")  # nothing moves on approval

    out = svc.reimburse(claim.topup_id, current_user=FINANCE)
    assert out.status == "Reimbursed"
    assert out.funding_bank_name == "Company Petty Cash"
    # The float paid the employee; the bank was not touched.
    assert svc.get_balance(a.company_id) == Decimal("4700.00")
    db.refresh(setup["bank_a"])
    assert setup["bank_a"].current_balance == Decimal("20000.00")
    payout = db.get(Expense, row.reimbursement_expense_id)
    assert payout.payment_method == "Petty Cash" and payout.amount == Decimal("300.00")

    # The ledger shows one reimbursement row carrying the cash out (no separate expense row).
    ledger = svc.list_ledger(company=a)
    reimb_rows = [e for e in ledger if e.record_id == claim.topup_id]
    assert len(reimb_rows) == 1
    assert reimb_rows[0].amount_out == Decimal("300.00")
    assert reimb_rows[0].funding_bank_name == "Company Petty Cash"
    assert not any(e.entry_id == f"expense-{payout.expense_id}" for e in ledger)


def test_petty_cash_funding_rejects_top_ups_and_short_float(db, setup):
    svc = PettyCashService(db)
    a = setup["a"]
    topup_in = PettyCashTopUpCreate(
        company_id=a.company_id, amount=Decimal("100.00"), topup_date=date.today(),
        request_type="topup", bank_account_id=PETTY_CASH_FUNDING,
    )
    with pytest.raises(HTTPException) as exc:
        svc.create_topup(topup_in, current_user=FINANCE)
    assert exc.value.status_code == 422

    big = svc.create_topup(_claim(a.company_id, "9000.00"))
    with pytest.raises(HTTPException) as exc:
        svc.endorse_topup(big.topup_id, "endorse", "ok", "Fin", bank_account_id=PETTY_CASH_FUNDING)
    assert "Insufficient petty cash" in exc.value.detail


def test_finance_direct_reimbursement_with_petty_cash(db, setup):
    svc = PettyCashService(db)
    a = setup["a"]
    claim_in = _claim(a.company_id)
    claim_in.bank_account_id = PETTY_CASH_FUNDING
    out = svc.create_topup(claim_in, current_user=FINANCE)
    assert out.status == "Pending Audit Approval"
    assert out.payment_method_option == PETTY_CASH_FUNDING
    assert out.bank_account_id is None


def test_reimbursement_reaches_transactions_only_once_reimbursed(db, setup):
    svc = PettyCashService(db)
    a = setup["a"]
    claim = svc.create_topup(_claim(a.company_id))
    svc.endorse_topup(claim.topup_id, "endorse", "ok", "Fin", bank_account_id="BANK-A")

    def listed():
        return any(m.topup_id == claim.topup_id for m in svc.list_movements())

    assert not listed()  # pending audit
    svc.review_topup(claim.topup_id, "approve", "verified", "Auditor")
    assert not listed()  # approved, not yet disbursed
    db.refresh(setup["bank_a"])
    assert setup["bank_a"].current_balance == Decimal("20000.00")

    svc.reimburse(claim.topup_id, current_user=FINANCE)
    assert listed()
    db.refresh(setup["bank_a"])
    assert setup["bank_a"].current_balance == Decimal("19700.00")


def test_running_balance_is_each_rows_ending_balance_per_company(db, setup):
    svc = PettyCashService(db)
    a, b = setup["a"], setup["b"]
    base = datetime(2026, 1, 1, 8, 0, 0)
    # Same-day expenses recorded at different times, inserted out of order.
    for cid, amt, minutes in [(a.company_id, "200.00", 30), (b.company_id, "50.00", 10), (a.company_id, "100.00", 5)]:
        db.add(Expense(company_id=cid, expense_date=date.today(), amount=Decimal(amt), amount_paid=Decimal(amt),
                       description=f"spend {amt}", payment_method="Petty Cash",
                       created_at=base + timedelta(minutes=minutes)))
    db.commit()

    ledger = svc.list_ledger()  # all companies, newest first
    for company in (a, b):
        rows = [e for e in ledger if e.company_id == company.company_id]
        # Read from the oldest up: every balance = previous balance + in - out, for that company only.
        prev = Decimal("0.00")
        for row in reversed(rows):
            assert row.running_balance == prev + row.amount_in - row.amount_out
            prev = row.running_balance
    a_rows = [e for e in ledger if e.company_id == a.company_id]
    assert a_rows[0].running_balance == Decimal("4700.00")
    assert [r.amount_out for r in a_rows if r.amount_out] == [Decimal("200.00"), Decimal("100.00")]
    b_rows = [e for e in ledger if e.company_id == b.company_id]
    assert b_rows[0].running_balance == Decimal("950.00")
