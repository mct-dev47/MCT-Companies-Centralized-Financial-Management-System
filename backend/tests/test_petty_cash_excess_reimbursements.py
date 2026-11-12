"""
Spec 0038: Petty Cash Excess Reimbursements and Intercompany Funding Test Suite.
Verifies AC-1 through AC-15.
"""

from datetime import date
from decimal import Decimal
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.company import Company
from app.models.bank import BankAccount
from app.models.finance import Category, Expense
from app.models.petty_cash import PettyCashTopUp, PettyCashWallet
from app.models.intercompany_transfer import IntercompanyTransfer
from app.schemas.petty_cash import PettyCashTopUpCreate, PettyCashEndorseIn, PettyCashReviewIn
from app.services.petty_cash_service import PettyCashService


@pytest.fixture
def db_session():
    """In-memory SQLite session with tables created."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def test_setup(db_session):
    """Sets up two companies, bank accounts, and petty cash wallets."""
    # Requesting Company (Company A)
    comp_a = Company(
        company_id=101,
        company_name="Alpha Tech Inc",
        starting_balance=Decimal("100000.00"),
    )
    # Funding Affiliate Company (Company B)
    comp_b = Company(
        company_id=102,
        company_name="Beta Logistics Corp",
        starting_balance=Decimal("100000.00"),
    )
    db_session.add_all([comp_a, comp_b])
    db_session.flush()

    # Company A Bank Account
    bank_a = BankAccount(
        id="BANK-A-01",
        company_id=comp_a.company_id,
        company_name=comp_a.company_name,
        bank_name="BDO Unibank",
        account_name="Alpha Checking",
        account_number="101-0001",
        current_balance=Decimal("20000.00"),
        starting_balance=Decimal("20000.00"),
    )
    # Company B Bank Account
    bank_b = BankAccount(
        id="BANK-B-01",
        company_id=comp_b.company_id,
        company_name=comp_b.company_name,
        bank_name="BPI",
        account_name="Beta Funding",
        account_number="102-0001",
        current_balance=Decimal("50000.00"),
        starting_balance=Decimal("50000.00"),
    )
    db_session.add_all([bank_a, bank_b])

    # Category
    cat = Category(
        category_id=55,
        name="Office Supplies",
    )
    db_session.add(cat)

    # Fund Company A Petty Cash Wallet with 10,000.00 via an approved topup
    wallet_topup = PettyCashTopUp(
        company_id=comp_a.company_id,
        amount=Decimal("10000.00"),
        topup_date=date.today(),
        description="Initial Float",
        status="Approved",
        request_type="topup",
    )
    wallet_a = PettyCashWallet(
        company_id=comp_a.company_id,
        balance=Decimal("10000.00"),
        low_balance_threshold=Decimal("1000.00"),
    )
    db_session.add_all([wallet_topup, wallet_a])
    db_session.commit()

    return {
        "comp_a": comp_a,
        "comp_b": comp_b,
        "bank_a": bank_a,
        "bank_b": bank_b,
        "cat": cat,
    }


def test_ac1_funding_breakdown_and_validation(db_session, test_setup):
    """AC-1: E=8000, C=5000, O=3000. Validates decimal arithmetic and rejections."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]

    # Valid breakdown
    claim_in = PettyCashTopUpCreate(
        company_id=comp_a.company_id,
        amount=Decimal("3000.00"),
        total_expenses=Decimal("8000.00"),
        company_funded_amount=Decimal("5000.00"),
        topup_date=date.today(),
        paid_by="Juan Dela Cruz",
        description="Project Supplies and Meals",
        request_type="reimbursement",
    )
    out = svc.create_topup(claim_in)
    assert out.total_expenses == Decimal("8000.00")
    assert out.company_funded_amount == Decimal("5000.00")
    assert out.employee_out_of_pocket == Decimal("3000.00")
    assert out.amount == Decimal("3000.00")
    assert out.reserved_amount == Decimal("0.00")
    assert out.petty_cash_expense_id is not None
    assert svc.get_balance(comp_a.company_id) == Decimal("5000.00")
    assert out.status == "Pending Finance Endorsement"

    # Rejection: E <= 0
    with pytest.raises(ValueError):
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("0.00"),
            total_expenses=Decimal("0.00"),
            company_funded_amount=Decimal("0.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )

    # Rejection: C < 0
    with pytest.raises(ValueError):
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("100.00"),
            total_expenses=Decimal("100.00"),
            company_funded_amount=Decimal("-10.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )

    # Rejection: C > E
    with pytest.raises(ValueError):
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("0.00"),
            total_expenses=Decimal("500.00"),
            company_funded_amount=Decimal("600.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )


def test_ac2_reservation_logic_concurrency_hold(db_session, test_setup):
    """AC-2: Immediate petty cash deduction updates balance atomically; excess fails with 422."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]

    # Initial available float is 10,000.00
    assert svc.get_unreserved_balance(comp_a.company_id) == Decimal("10000.00")

    # Claim 1 immediately deducts 6,000.00 from petty cash float
    c1 = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("2000.00"),
            total_expenses=Decimal("8000.00"),
            company_funded_amount=Decimal("6000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )
    )
    assert c1.reserved_amount == Decimal("0.00")
    assert c1.petty_cash_expense_id is not None
    assert svc.get_balance(comp_a.company_id) == Decimal("4000.00")
    assert svc.get_unreserved_balance(comp_a.company_id) == Decimal("4000.00")

    # Claim 2 tries to reserve 5,000.00 (exceeds remaining 4,000.00) -> 422
    with pytest.raises(HTTPException) as exc_info:
        svc.create_topup(
            PettyCashTopUpCreate(
                company_id=comp_a.company_id,
                amount=Decimal("1000.00"),
                total_expenses=Decimal("6000.00"),
                company_funded_amount=Decimal("5000.00"),
                topup_date=date.today(),
                request_type="reimbursement",
            )
        )
    assert exc_info.value.status_code == 422
    assert "Insufficient unreserved petty cash float" in exc_info.value.detail


def test_ac2_ac3_prerecorded_expense_validation_and_deduplication(db_session, test_setup):
    """AC-2 & AC-3: Pre-recorded expense sets reserved_amount=0, avoids duplicate deduction, creates only 3000 expense."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]

    # Pre-record an expense in the expenses table for 5,000.00
    pre_exp = Expense(
        company_id=comp_a.company_id,
        amount=Decimal("5000.00"),
        expense_date=date.today(),
        description="Pre-recorded supplies",
        payment_method="Petty Cash",
        reference_no="EXP-PRE-001",
    )
    db_session.add(pre_exp)
    db_session.commit()

    # Float was 10,000; with 5,000 expense already recorded, ledger balance is 5,000
    assert svc.get_balance(comp_a.company_id) == Decimal("5000.00")

    # Submit claim linking existing expense
    claim = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("3000.00"),
            total_expenses=Decimal("8000.00"),
            company_funded_amount=Decimal("5000.00"),
            existing_expense_id=pre_exp.expense_id,
            topup_date=date.today(),
            request_type="reimbursement",
        )
    )
    # Because it is pre-recorded, reserved_amount is 0.00 and no float was reserved
    assert claim.reserved_amount == Decimal("0.00")
    assert svc.get_unreserved_balance(comp_a.company_id) == Decimal("5000.00")

    # Finance endorses with Bank A
    svc.endorse_topup(
        topup_id=claim.topup_id,
        action="endorse",
        remark="Verified against receipt and pre-recorded entry",
        bank_account_id=test_setup["bank_a"].id,
    )
    # Auditor approves
    svc.review_topup(
        topup_id=claim.topup_id,
        action="approve",
        remark="Audit approved",
    )

    # Finance reimburses
    res = svc.reimburse(claim.topup_id, notes="Paid employee")
    assert res.status == "Reimbursed"
    assert res.amount_reimbursed == Decimal("3000.00")

    # Confirm pre-recorded expense was updated with linked_topup_id
    db_session.refresh(pre_exp)
    assert pre_exp.linked_topup_id == claim.topup_id

    # Confirm only one new expense was created: the 3000.00 reimbursement expense
    reimb_exp = db_session.query(Expense).filter(Expense.reference_no == f"REIMB-{claim.topup_id}").first()
    assert reimb_exp is not None
    assert reimb_exp.amount == Decimal("3000.00")
    assert reimb_exp.payment_method == "Bank Reimbursement"

    # Confirm no duplicate PC-EXP was created
    dup_pc = db_session.query(Expense).filter(Expense.reference_no == f"PC-EXP-{claim.topup_id}").first()
    assert dup_pc is None


def test_ac4_zero_excess_finalization(db_session, test_setup):
    """AC-4: Zero excess unrecorded claim (E=5000, C=5000, O=0) deducts & settles immediately without Finance/Audit approval or bank payout."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]

    # Submit unrecorded zero-excess claim
    claim = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("0.00"),
            total_expenses=Decimal("5000.00"),
            company_funded_amount=Decimal("5000.00"),
            topup_date=date.today(),
            paid_by="Maria Santos",
            description="Entirely funded by float",
            request_type="reimbursement",
        )
    )
    assert claim.amount == Decimal("0.00")
    assert claim.reserved_amount == Decimal("0.00")
    assert claim.status == "Settled"
    assert claim.petty_cash_expense_id is not None

    # PC-EXP expense was created immediately and deducted from float
    pc_exp = db_session.query(Expense).filter(Expense.reference_no == f"PC-EXP-{claim.topup_id}").first()
    assert pc_exp is not None
    assert pc_exp.amount == Decimal("5000.00")
    assert pc_exp.payment_method == "Petty Cash"
    assert pc_exp.audit_status == "Pending Audit"
    assert svc.get_balance(comp_a.company_id) == Decimal("5000.00")

    # Finalize settlement remains idempotent and does not duplicate Expense
    settled = svc.finalize_settlement(claim.topup_id)
    assert settled.status == "Settled"
    assert db_session.query(Expense).filter(Expense.reference_no == f"PC-EXP-{claim.topup_id}").count() == 1

    # Ledger shows only replenishment_disbursement with blank status & Pending Audit audit_status
    ledger = svc.list_ledger(company=comp_a)
    matching = [e for e in ledger if e.record_id == claim.topup_id]
    assert len(matching) == 1
    assert matching[0].request_type == "replenishment_disbursement"
    assert matching[0].amount_out == Decimal("5000.00")
    assert matching[0].status == ""
    assert matching[0].audit_status == "Pending Audit"
    assert matching[0].expense_id == pc_exp.expense_id

    # Bank balance remains untouched
    db_session.refresh(test_setup["bank_a"])
    assert test_setup["bank_a"].current_balance == Decimal("20000.00")


def test_ac7_ac9_cross_company_method_a_direct_payout(db_session, test_setup):
    """Spec 0042 AC-1/AC-2: New cross-company endorsement returns 422; seeded historical Method A rows remain reimbursable."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    bank_b = test_setup["bank_b"]

    new_claim = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("3000.00"),
            total_expenses=Decimal("8000.00"),
            company_funded_amount=Decimal("5000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )
    )
    with pytest.raises(HTTPException) as exc_info:
        svc.endorse_topup(
            topup_id=new_claim.topup_id,
            action="endorse",
            remark="Affiliate B blocked under Spec 0042",
            bank_account_id=bank_b.id,
        )
    assert exc_info.value.status_code == 422
    assert "must belong to the requesting company" in exc_info.value.detail

    # Seed a legacy pre-0042 approved Method A record directly in DB
    legacy_claim = PettyCashTopUp(
        company_id=comp_a.company_id,
        amount=Decimal("3000.00"),
        total_expenses=Decimal("8000.00"),
        company_funded_amount=Decimal("5000.00"),
        employee_out_of_pocket=Decimal("3000.00"),
        reserved_amount=Decimal("5000.00"),
        topup_date=date.today(),
        request_type="reimbursement",
        status="Approved",
        bank_account_id=bank_b.id,
        payment_method_option="direct",
        endorsed_by="Legacy Finance",
        reviewed_by="Legacy Auditor",
    )
    db_session.add(legacy_claim)
    db_session.commit()
    db_session.refresh(legacy_claim)

    # Historical claim still reimburses cleanly and records IntercompanyTransfer
    res = svc.reimburse(legacy_claim.topup_id)
    assert res.status == "Reimbursed"

    # Bank B was debited 3000
    db_session.refresh(bank_b)
    assert bank_b.current_balance == Decimal("47000.00")

    # Intercompany transfer record created with NOT_APPLICABLE transfer_status and UNSETTLED settlement_status
    ict = db_session.query(IntercompanyTransfer).filter(IntercompanyTransfer.linked_topup_id == legacy_claim.topup_id).first()
    assert ict is not None
    assert ict.amount == Decimal("3000.00")
    assert ict.transfer_status == "NOT_APPLICABLE"
    assert ict.settlement_status == "UNSETTLED"
    assert ict.source_company_id == test_setup["comp_b"].company_id
    assert ict.destination_company_id == test_setup["comp_a"].company_id


def test_ac10_method_b_transfer_first_lifecycle(db_session, test_setup):
    """Spec 0042 AC-2: Seeded historical Method B lifecycle remains completable (Transfer in transit -> Received -> Reimbursed)."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    bank_a = test_setup["bank_a"]
    bank_b = test_setup["bank_b"]

    claim = PettyCashTopUp(
        company_id=comp_a.company_id,
        amount=Decimal("3000.00"),
        total_expenses=Decimal("8000.00"),
        company_funded_amount=Decimal("5000.00"),
        employee_out_of_pocket=Decimal("3000.00"),
        reserved_amount=Decimal("5000.00"),
        topup_date=date.today(),
        request_type="reimbursement",
        status="Approved",
        bank_account_id=bank_b.id,
        payment_method_option="transfer_first",
        destination_bank_id=bank_a.id,
        endorsed_by="Legacy Finance",
        reviewed_by="Legacy Auditor",
    )
    db_session.add(claim)
    db_session.commit()
    db_session.refresh(claim)

    # 1. Initiate transfer
    step1 = svc.initiate_transfer(claim.topup_id)
    assert step1.status == "Transfer In Transit"
    db_session.refresh(bank_b)
    assert bank_b.current_balance == Decimal("47000.00")
    db_session.refresh(bank_a)
    assert bank_a.current_balance == Decimal("20000.00")  # Not yet received

    # 2. Confirm transfer received
    step2 = svc.confirm_transfer(claim.topup_id)
    assert step2.status == "Transfer Received"
    db_session.refresh(bank_a)
    assert bank_a.current_balance == Decimal("23000.00")  # Received!

    # 3. Reimburse from Bank A to employee
    step3 = svc.reimburse(claim.topup_id)
    assert step3.status == "Reimbursed"
    db_session.refresh(bank_a)
    assert bank_a.current_balance == Decimal("20000.00")  # Disbursed to employee!


def test_ac11_ac12_transfer_cancellation_and_reversal(db_session, test_setup):
    """Spec 0042 AC-2: Seeded historical Method B transfer cancellation & reversal moves to RETURN_PENDING then resets approvals."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    bank_a = test_setup["bank_a"]
    bank_b = test_setup["bank_b"]

    claim = PettyCashTopUp(
        company_id=comp_a.company_id,
        amount=Decimal("3000.00"),
        total_expenses=Decimal("8000.00"),
        company_funded_amount=Decimal("5000.00"),
        employee_out_of_pocket=Decimal("3000.00"),
        reserved_amount=Decimal("5000.00"),
        topup_date=date.today(),
        request_type="reimbursement",
        status="Approved",
        bank_account_id=bank_b.id,
        payment_method_option="transfer_first",
        destination_bank_id=bank_a.id,
        endorsed_by="Legacy Finance",
        reviewed_by="Legacy Auditor",
    )
    db_session.add(claim)
    db_session.commit()
    db_session.refresh(claim)
    svc.initiate_transfer(claim.topup_id)

    # Cancel transfer
    cancelled = svc.cancel_transfer(claim.topup_id, reason="Wrong funding amount requested")
    assert cancelled.status == "Return Pending"

    # Bank B balance is NOT refunded yet
    db_session.refresh(bank_b)
    assert bank_b.current_balance == Decimal("47000.00")

    # Confirm reversal
    reversed_claim = svc.confirm_reversal(claim.topup_id, verification_notes="Funds verified returned in Bank B online portal")
    assert reversed_claim.status == "Pending Finance Endorsement"
    assert reversed_claim.endorsed_by is None
    assert reversed_claim.reviewed_by is None

    # Bank B balance is now restored
    db_session.refresh(bank_b)
    assert bank_b.current_balance == Decimal("50000.00")


def test_ac13_intercompany_repayment_settlement(db_session, test_setup):
    """AC-13: /settle executes atomic repayment from Company A to Company B."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    comp_b = test_setup["comp_b"]
    bank_a = test_setup["bank_a"]
    bank_b = test_setup["bank_b"]

    # Create an outstanding liability of 3,000 from Method A
    transfer = IntercompanyTransfer(
        source_company_id=comp_b.company_id,
        destination_company_id=comp_a.company_id,
        source_bank_id=bank_b.id,
        amount=Decimal("3000.00"),
        transfer_type="reimbursement_direct",
        reference_no="ICT-TEST-001",
        transfer_status="NOT_APPLICABLE",
        settlement_status="UNSETTLED",
        initiated_by="Finance Officer",
    )
    db_session.add(transfer)
    db_session.commit()

    # Settle repayment: Bank A repays Bank B
    res = svc.settle_intercompany_transfer(
        transfer_id=transfer.transfer_id,
        source_bank_id=bank_a.id,
        destination_bank_id=bank_b.id,
        notes="Repaid via PESONet",
    )
    assert res.settlement_status == "SETTLED"
    db_session.refresh(bank_a)
    assert bank_a.current_balance == Decimal("17000.00")  # -3000
    db_session.refresh(bank_b)
    assert bank_b.current_balance == Decimal("53000.00")  # +3000


def test_ac14_insufficient_bank_balance_fails_cleanly(db_session, test_setup):
    """AC-14: If source bank balance is below payout amount, transaction fails cleanly without partial records."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    bank_a = test_setup["bank_a"]

    # Set Bank A balance to 1,000
    bank_a.current_balance = Decimal("1000.00")
    db_session.commit()

    claim = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("3000.00"),
            total_expenses=Decimal("8000.00"),
            company_funded_amount=Decimal("5000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )
    )
    svc.endorse_topup(claim.topup_id, "endorse", "Endorsed with Bank A", bank_account_id=bank_a.id)
    svc.review_topup(claim.topup_id, "approve", "Approved")

    # Attempt reimburse: Bank A only has 1,000, payout requires 3,000
    with pytest.raises(HTTPException) as exc_info:
        svc.reimburse(claim.topup_id)
    assert exc_info.value.status_code == 400
    assert "Insufficient bank funds" in exc_info.value.detail

    # Verify claim status remains Approved, bank balance unchanged, no expense records created
    topup_row = db_session.query(PettyCashTopUp).filter_by(topup_id=claim.topup_id).first()
    assert topup_row.status == "Approved"
    assert topup_row.amount_reimbursed == Decimal("0.00")
    db_session.refresh(bank_a)
    assert bank_a.current_balance == Decimal("1000.00")
    reimb_exp = db_session.query(Expense).filter(Expense.reference_no == f"REIMB-{claim.topup_id}").first()
    assert reimb_exp is None


def test_ac15_idempotency_retries(db_session, test_setup):
    """AC-15: Retries of reimburse or finalize-settlement return existing result without duplicate movements."""
    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    bank_a = test_setup["bank_a"]

    claim = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("2000.00"),
            total_expenses=Decimal("5000.00"),
            company_funded_amount=Decimal("3000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
        )
    )
    svc.endorse_topup(claim.topup_id, "endorse", "Endorsed", bank_account_id=bank_a.id)
    svc.review_topup(claim.topup_id, "approve", "Approved")

    # First reimbursement
    res1 = svc.reimburse(claim.topup_id)
    assert res1.status == "Reimbursed"
    db_session.refresh(bank_a)
    bal_after_first = bank_a.current_balance

    # Second (retried) reimbursement
    res2 = svc.reimburse(claim.topup_id)
    assert res2.status == "Reimbursed"
    db_session.refresh(bank_a)
    # Bank balance was NOT deducted twice
    assert bank_a.current_balance == bal_after_first


def test_reimburse_step_withdraws_from_assigned_bank_and_reflects_everywhere(db_session, test_setup):
    """Audit approval of a reimbursement moves no money; the Reimburse step withdraws from the assigned
    funding bank, and the movement shows in the bank, the petty cash ledger, and Transaction page movements.
    A top-up is withdrawn from its funding bank on approval."""
    from app.models.bank import BankTransaction

    svc = PettyCashService(db_session)
    comp_a = test_setup["comp_a"]
    bank_a = test_setup["bank_a"]
    start_balance = Decimal(str(bank_a.current_balance))

    # Reimbursement: E=4000, C=1000 from petty cash, O=3000 out of pocket
    claim = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("3000.00"),
            total_expenses=Decimal("4000.00"),
            company_funded_amount=Decimal("1000.00"),
            topup_date=date.today(),
            request_type="reimbursement",
            paid_by="Juan",
        )
    )
    svc.endorse_topup(claim.topup_id, "endorse", "OK", bank_account_id=bank_a.id)
    approved = svc.review_topup(claim.topup_id, "approve", "Approved")
    assert approved.status == "Approved"
    db_session.refresh(bank_a)
    assert bank_a.current_balance == start_balance  # approval alone moves no money

    out = svc.reimburse(claim.topup_id, current_user={"full_name": "Finance Officer"})
    assert out.status == "Reimbursed"
    db_session.refresh(bank_a)
    assert bank_a.current_balance == start_balance - Decimal("3000.00")
    bank_tx = db_session.query(BankTransaction).filter(BankTransaction.bank_account_id == bank_a.id).all()
    assert any(t.withdrawal == Decimal("3000.00") for t in bank_tx)

    ledger = svc.list_ledger(comp_a)
    reimb_rows = [e for e in ledger if e.record_id == claim.topup_id and e.request_type == "reimbursement"]
    assert reimb_rows and reimb_rows[0].status == "Reimbursed"

    movements = svc.list_movements(comp_a)
    assert any(m.topup_id == claim.topup_id and m.status == "Reimbursed" for m in movements)

    # Top-up: approval withdraws from the assigned bank and credits the petty cash wallet
    before_balance = svc.get_balance(comp_a.company_id)
    topup = svc.create_topup(
        PettyCashTopUpCreate(
            company_id=comp_a.company_id,
            amount=Decimal("2000.00"),
            topup_date=date.today(),
            request_type="topup",
        )
    )
    svc.endorse_topup(topup.topup_id, "endorse", "OK", bank_account_id=bank_a.id)
    out2 = svc.review_topup(topup.topup_id, "approve", "Approved")
    assert out2.status == "Approved"
    db_session.refresh(bank_a)
    assert bank_a.current_balance == start_balance - Decimal("5000.00")
    assert svc.get_balance(comp_a.company_id) == before_balance + Decimal("2000.00")
