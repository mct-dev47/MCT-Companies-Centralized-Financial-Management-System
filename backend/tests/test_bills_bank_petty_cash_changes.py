"""Tests for:
1. Bills Details: editing and deleting a bill payment syncs Expense, BankTransaction, BankAccount balance, and Bill status.
2. Bank Management: deleting a bank account cascades across Sales, Expenses, Bills, Receivables, Loans, Tenants, Lending, Petty Cash, Intercompany Transfers, and BankTransactions.
3. Petty Cash: editing and deleting rows is allowed after Finance endorsement (Pending Audit Approval) and on un-audited disbursements, and blocked once Audited by Auditor.
"""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.bills import Bill, BillPayment
from app.models.company import Company
from app.models.finance import Expense, Sale
from app.models.intercompany_transfer import IntercompanyTransfer
from app.models.lending import Borrower, LendingTransaction
from app.models.loan import Loan, LoanRepayment
from app.models.petty_cash import PettyCashTopUp
from app.models.receivable import Receivable, ReceivablePayment
from app.models.tenant import TenantLease, TenantLeasePayment
from app.schemas.bills import BillPaymentCreate, BillPaymentUpdate
from app.services.bank_service import BankService
from app.services.bills_service import BillsService
from app.services.petty_cash_service import PettyCashService


def _db():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add(Company(company_id=1, company_name="Acme"))
    db.add(Company(company_id=2, company_name="Beta"))
    db.add(
        BankAccount(
            id="bnk-1",
            bank_name="BDO",
            account_name="Acme Main",
            company_name="Acme",
            company_id=1,
            starting_balance=Decimal("5000.00"),
            current_balance=Decimal("5000.00"),
        )
    )
    db.add(
        BankAccount(
            id="bnk-2",
            bank_name="BPI",
            account_name="Beta Main",
            company_name="Beta",
            company_id=2,
            starting_balance=Decimal("2000.00"),
            current_balance=Decimal("2000.00"),
        )
    )
    db.commit()
    return db


def test_bill_payment_edit_and_delete_syncs_expense_bank_and_status():
    db = _db()
    bill = Bill(
        bill_id=1,
        company_id=1,
        bill_name="Meralco",
        amount=Decimal("500.00"),
        recurring="monthly",
        due_date=date.today(),
        due_date_reminder=3,
    )
    db.add(bill)
    db.commit()

    svc = BillsService(db)
    svc.record_payment(
        1,
        BillPaymentCreate(
            payment_date=date.today(),
            amount=Decimal("500.00"),
            payment_method="Bank Transfer",
            funding_source="bank",
            bank_account_id="bnk-1",
        ),
    )

    bank = db.query(BankAccount).filter(BankAccount.id == "bnk-1").first()
    assert bank.current_balance == Decimal("4500.00")
    payment = db.query(BillPayment).filter(BillPayment.bill_id == 1).first()
    assert payment is not None
    assert payment.expense_id is not None

    # Edit payment amount from 500 -> 300
    svc.update_payment(
        1,
        payment.bill_payment_id,
        BillPaymentUpdate(amount=Decimal("300.00"), reference_no="REF-300", notes="Partial"),
    )
    db.refresh(bank)
    db.refresh(bill)
    exp = db.query(Expense).filter(Expense.expense_id == payment.expense_id).first()
    assert bank.current_balance == Decimal("4700.00")
    assert exp.amount == Decimal("300.00")
    assert exp.amount_paid == Decimal("300.00")
    assert bill.status == "partially paid"

    # Delete payment -> removes expense, bank entry, restores bank balance and bill status
    svc.delete_payment(1, payment.bill_payment_id)
    db.refresh(bank)
    db.refresh(bill)
    assert bank.current_balance == Decimal("5000.00")
    assert db.query(Expense).filter(Expense.expense_id == payment.expense_id).first() is None
    assert db.query(BankTransaction).filter(BankTransaction.bank_account_id == "bnk-1").count() == 0
    assert bill.status != "paid"


def test_bill_payment_edit_blocked_when_verified():
    db = _db()
    bill = Bill(
        bill_id=1,
        company_id=1,
        bill_name="PLDT",
        amount=Decimal("400.00"),
        recurring="monthly",
        due_date=date.today(),
        due_date_reminder=3,
    )
    db.add(bill)
    db.commit()

    svc = BillsService(db)
    svc.record_payment(
        1,
        BillPaymentCreate(
            payment_date=date.today(),
            amount=Decimal("400.00"),
            payment_method="Bank Transfer",
            funding_source="bank",
            bank_account_id="bnk-1",
        ),
    )
    payment = db.query(BillPayment).filter(BillPayment.bill_id == 1).first()
    exp = db.query(Expense).filter(Expense.expense_id == payment.expense_id).first()
    exp.audit_status = "Verified"
    db.commit()

    with pytest.raises(HTTPException) as exc:
        svc.update_payment(1, payment.bill_payment_id, BillPaymentUpdate(amount=Decimal("200.00")))
    assert exc.value.status_code == 409


def test_delete_bank_cascades_all_modules():
    db = _db()

    # Sale & Receivable & Tenant & Lending linked to bnk-1
    sale = Sale(
        sales_id=10,
        company_id=1,
        transaction_date=date.today(),
        particulars="Sale 1",
        amount=Decimal("1000.00"),
        bank_account_id="bnk-1",
        deposit_status="Deposited",
    )
    db.add(sale)
    expense = Expense(
        expense_id=20,
        company_id=1,
        expense_date=date.today(),
        description="Exp 1",
        amount=Decimal("200.00"),
        amount_paid=Decimal("200.00"),
        bank_account_id="bnk-1",
    )
    db.add(expense)
    db.flush()

    db.add(
        BankTransaction(
            id="tx-sale-1",
            bank_account_id="bnk-1",
            transaction_date=str(date.today()),
            particulars="Sale 1",
            deposit=Decimal("1000.00"),
            withdrawal=Decimal("0.00"),
            source_sale_id=10,
        )
    )
    db.add(
        BankTransaction(
            id="tx-exp-1",
            bank_account_id="bnk-1",
            transaction_date=str(date.today()),
            particulars="Exp 1",
            deposit=Decimal("0.00"),
            withdrawal=Decimal("200.00"),
            source_expense_id=20,
        )
    )

    bill = Bill(
        bill_id=30,
        company_id=1,
        bill_name="Water",
        amount=Decimal("200.00"),
        recurring="monthly",
        due_date=date.today(),
        status="paid",
    )
    db.add(bill)
    db.flush()
    db.add(
        BillPayment(
            bill_id=30,
            period_key=date.today().strftime("%Y-%m"),
            payment_date=date.today(),
            amount=Decimal("200.00"),
            payment_method="Bank Transfer",
            bank_account_id="bnk-1",
            expense_id=20,
        )
    )

    rec = Receivable(
        receivable_id=40,
        company_id=1,
        company_name="Acme",
        customer_name="Client A",
        transaction_date=date.today(),
        items_summary="Item",
        total_amount=Decimal("500.00"),
        amount_paid=Decimal("500.00"),
        balance=Decimal("0.00"),
        payment_status="Paid",
    )
    db.add(rec)
    db.flush()
    db.add(
        ReceivablePayment(
            receivable_id=40,
            payment_date=date.today(),
            amount=Decimal("500.00"),
            payment_method="Bank Transfer",
            bank_account_id="bnk-1",
        )
    )

    loan = Loan(
        loan_id=50,
        borrower=1,
        lender=2,
        bank_account_id="bnk-1",
        loan_date=date.today(),
        principal_amount=Decimal("1000.00"),
    )
    db.add(loan)
    db.flush()
    db.add(
        LoanRepayment(
            loan_id=50,
            payment_date=date.today(),
            remaining_balance=Decimal("500.00"),
            amount=Decimal("500.00"),
            bank_account_id="bnk-1",
        )
    )

    lease = TenantLease(
        lease_id=60,
        tenant_ref="TEN-60",
        company_id=1,
        tenant_name="Tenant A",
        unit_name="Unit 1",
        rent_amount=Decimal("1000.00"),
        contract_date=date.today(),
        due_date=date.today(),
        total_amount_payable=Decimal("1000.00"),
        status="Paid",
        bank_account_id="bnk-1",
    )
    db.add(lease)
    db.flush()
    db.add(
        TenantLeasePayment(
            lease_id=60,
            payment_date=date.today(),
            amount=Decimal("1000.00"),
            sale_id=10,
        )
    )

    borrower = Borrower(
        borrower_id=70,
        borrower_name="Borrower A",
        principal_amount=Decimal("1000.00"),
        total_payable=Decimal("1200.00"),
        amount_paid=Decimal("1000.00"),
        remaining_balance=Decimal("200.00"),
        date_borrowed=date.today(),
        due_date=date.today(),
        bank_account_id="bnk-1",
        release_expense_id=20,
    )
    db.add(borrower)
    db.flush()
    db.add(
        LendingTransaction(
            borrower_id=70,
            transaction_type="Repayment",
            payment_date=date.today(),
            amount=Decimal("1000.00"),
            sale_id=10,
        )
    )

    topup = PettyCashTopUp(
        topup_id=80,
        company_id=1,
        amount=Decimal("300.00"),
        topup_date=date.today(),
        status="Approved",
        request_type="topup",
        bank_account_id="bnk-1",
    )
    db.add(topup)
    db.add(
        IntercompanyTransfer(
            transfer_id=90,
            source_company_id=1,
            destination_company_id=2,
            source_bank_id="bnk-1",
            destination_bank_id="bnk-2",
            amount=Decimal("100.00"),
            transfer_type="REIMBURSEMENT",
            reference_no="ICT-90",
            initiated_by="Finance",
        )
    )
    db.commit()

    ok = BankService(db).delete_account("bnk-1")
    assert ok is True

    assert db.query(BankAccount).filter(BankAccount.id == "bnk-1").first() is None
    assert db.query(BankTransaction).filter(BankTransaction.bank_account_id == "bnk-1").count() == 0
    assert db.query(Sale).filter(Sale.sales_id == 10).first() is None
    assert db.query(Expense).filter(Expense.expense_id == 20).first() is None
    assert db.query(BillPayment).filter(BillPayment.bill_id == 30).count() == 0
    assert db.query(Bill).filter(Bill.bill_id == 30).first().status != "paid"
    assert db.query(ReceivablePayment).filter(ReceivablePayment.receivable_id == 40).count() == 0
    assert db.query(Receivable).filter(Receivable.receivable_id == 40).first().payment_status == "Unpaid"
    assert db.query(Loan).filter(Loan.loan_id == 50).first() is None
    assert db.query(LoanRepayment).filter(LoanRepayment.loan_id == 50).count() == 0
    assert db.query(TenantLeasePayment).filter(TenantLeasePayment.lease_id == 60).count() == 0
    assert db.query(TenantLease).filter(TenantLease.lease_id == 60).first().status == "Active"
    assert db.query(LendingTransaction).filter(LendingTransaction.borrower_id == 70).count() == 0
    assert db.query(Borrower).filter(Borrower.borrower_id == 70).first().amount_paid == Decimal("0.00")
    assert db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == 80).first() is None
    assert db.query(IntercompanyTransfer).filter(IntercompanyTransfer.transfer_id == 90).first() is None


def test_petty_cash_editable_after_finance_endorsement_locked_only_when_audited():
    db = _db()
    svc = PettyCashService(db)

    # 1. Finance-endorsed topup (Pending Audit Approval) -> should be editable & deletable
    t_endorsed = PettyCashTopUp(
        company_id=1,
        amount=Decimal("1000.00"),
        topup_date=date.today(),
        description="Endorsed topup",
        status="Pending Audit Approval",
        request_type="topup",
        bank_account_id="bnk-1",
    )
    db.add(t_endorsed)
    db.commit()

    updated = svc.update_topup(t_endorsed.topup_id, amount=Decimal("1200.00"), description="Updated endorsed")
    assert updated.amount == Decimal("1200.00")
    svc.delete_topup(t_endorsed.topup_id)
    assert db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == t_endorsed.topup_id).first() is None

    # 2. Auditor-approved topup -> locked from edit & delete
    t_approved = PettyCashTopUp(
        company_id=1,
        amount=Decimal("2000.00"),
        topup_date=date.today(),
        description="Approved topup",
        status="Approved",
        request_type="topup",
        bank_account_id="bnk-1",
    )
    db.add(t_approved)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        svc.update_topup(t_approved.topup_id, amount=Decimal("1500.00"))
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc2:
        svc.delete_topup(t_approved.topup_id)
    assert exc2.value.status_code == 409

    # 3. Direct disbursement (status="Approved", audit_status="Pending Audit") -> editable & deletable until Verified
    exp = Expense(
        company_id=1,
        expense_date=date.today(),
        description="Office snacks",
        amount=Decimal("250.00"),
        amount_paid=Decimal("250.00"),
        payment_method="Petty Cash",
        audit_status="Pending Audit",
    )
    db.add(exp)
    db.flush()
    t_disb = PettyCashTopUp(
        company_id=1,
        amount=Decimal("250.00"),
        topup_date=date.today(),
        description="Office snacks",
        status="Approved",
        request_type="disbursement",
        petty_cash_expense_id=exp.expense_id,
        total_expenses=Decimal("250.00"),
        company_funded_amount=Decimal("250.00"),
    )
    db.add(t_disb)
    db.commit()

    upd_disb = svc.update_topup(t_disb.topup_id, amount=Decimal("300.00"), description="Updated snacks")
    assert upd_disb.amount == Decimal("300.00")
    db.refresh(exp)
    assert exp.amount == Decimal("300.00")

    # Mark linked expense Verified -> now locked
    exp.audit_status = "Verified"
    db.commit()
    with pytest.raises(HTTPException) as exc3:
        svc.delete_topup(t_disb.topup_id)
    assert exc3.value.status_code == 409

    # Unmark Verified -> deleting disbursement also deletes its expense
    exp.audit_status = "Pending Audit"
    db.commit()
    svc.delete_topup(t_disb.topup_id)
    assert db.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == t_disb.topup_id).first() is None
    assert db.query(Expense).filter(Expense.expense_id == exp.expense_id).first() is None


def test_bill_payment_edit_errors_and_supabase_mirror_and_cache_invalidation(monkeypatch):
    from app.core.cache import system_cache

    db = _db()
    bill = Bill(
        bill_id=2,
        company_id=1,
        bill_name="Globe",
        amount=Decimal("500.00"),
        recurring="monthly",
        due_date=date.today(),
        due_date_reminder=3,
    )
    db.add(bill)
    db.commit()

    svc = BillsService(db)
    with pytest.raises(HTTPException) as not_found_exc:
        svc.update_payment(2, 99999, BillPaymentUpdate(amount=Decimal("100.00")))
    assert not_found_exc.value.status_code == 404

    svc.record_payment(
        2,
        BillPaymentCreate(
            payment_date=date.today(),
            amount=Decimal("200.00"),
            billed_amount=Decimal("500.00"),
            payment_method="Bank Transfer",
            funding_source="bank",
            bank_account_id="bnk-1",
        ),
    )
    payment = db.query(BillPayment).filter(BillPayment.bill_id == 2).first()

    with pytest.raises(HTTPException) as exceed_exc:
        svc.update_payment(2, payment.bill_payment_id, BillPaymentUpdate(amount=Decimal("600.00")))
    assert exceed_exc.value.status_code == 400

    # Mock Supabase mirror boundary and verify cache tags are invalidated on edit
    mirrored_updates = []

    class FakeTable:
        def update(self, payload):
            mirrored_updates.append(payload)
            return self

        def eq(self, *_args):
            return self

        def execute(self):
            return None

    class FakeClient:
        def table(self, _name):
            return FakeTable()

    monkeypatch.setattr("app.services.bills_service.rest_and_orm_share_database", lambda: False)
    monkeypatch.setattr("app.db.supabase.get_supabase_admin_client", lambda: FakeClient())
    system_cache.set("dash_key", {"ok": True}, ttl=60, tags=["dashboard"])
    system_cache.set("exp_key", {"ok": True}, ttl=60, tags=["expenses"])

    svc.update_payment(2, payment.bill_payment_id, BillPaymentUpdate(amount=Decimal("350.00"), notes="Synced"))
    assert len(mirrored_updates) == 1
    assert mirrored_updates[0]["amount"] == 350.0
    assert system_cache.get("dash_key") is None
    assert system_cache.get("exp_key") is None


def test_petty_cash_supabase_mirror_and_edge_cases(monkeypatch):
    from app.core.cache import system_cache

    db = _db()
    svc = PettyCashService(db)

    # Seed approved topup so petty cash has float = 500
    db.add(
        PettyCashTopUp(
            company_id=1,
            amount=Decimal("500.00"),
            topup_date=date.today(),
            status="Approved",
            request_type="topup",
        )
    )
    exp = Expense(
        company_id=1,
        expense_date=date.today(),
        description="Courier",
        amount=Decimal("100.00"),
        amount_paid=Decimal("100.00"),
        payment_method="Petty Cash",
        audit_status="Pending Audit",
    )
    db.add(exp)
    db.flush()
    disb = PettyCashTopUp(
        company_id=1,
        amount=Decimal("100.00"),
        topup_date=date.today(),
        description="Courier",
        status="Approved",
        request_type="disbursement",
        petty_cash_expense_id=exp.expense_id,
        total_expenses=Decimal("100.00"),
        company_funded_amount=Decimal("100.00"),
    )
    db.add(disb)
    db.commit()

    # Editing disbursement beyond unreserved float (500) fails with 422
    with pytest.raises(HTTPException) as over_exc:
        svc.update_topup(disb.topup_id, amount=Decimal("900.00"))
    assert over_exc.value.status_code == 422

    # Mirror update and delete to Supabase REST + invalidate dashboard/expenses cache
    calls = []

    class FakeTable:
        def update(self, payload):
            calls.append(("update", payload))
            return self

        def delete(self):
            calls.append(("delete", None))
            return self

        def eq(self, *_args):
            return self

        def execute(self):
            return None

    class FakeClient:
        def table(self, _name):
            return FakeTable()

    monkeypatch.setattr("app.core.post_save.rest_and_orm_share_database", lambda: False)
    monkeypatch.setattr("app.db.supabase.get_supabase_admin_client", lambda: FakeClient())
    system_cache.set("pc_dash", {"ok": True}, ttl=60, tags=["dashboard"])

    svc.update_topup(disb.topup_id, amount=Decimal("150.00"), description="Courier Updated")
    assert any(kind == "update" and payload["amount"] == 150.0 for kind, payload in calls)
    assert system_cache.get("pc_dash") is None

    system_cache.set("pc_exp", {"ok": True}, ttl=60, tags=["expenses"])
    svc.delete_topup(disb.topup_id)
    assert any(kind == "delete" for kind, _ in calls)
    assert system_cache.get("pc_exp") is None


def test_delete_nonexistent_bank_returns_false():
    db = _db()
    assert BankService(db).delete_account("does-not-exist") is False

