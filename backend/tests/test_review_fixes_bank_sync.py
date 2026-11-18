"""Regression tests for the review findings on the Sales/Expense -> Bank/Bills/Loans cascade."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import loans as loans_ep
from app.api.v1.endpoints.expenses import reconcile_expense_bank
from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.bills import Bill, BillPayment
from app.models.company import Company
from app.models.finance import Expense
from app.models.loan import Loan, LoanRepayment
from app.schemas.bills import BillCreate, BillPaymentCreate
from app.schemas.loan import LoanRepaymentCreate
from app.services.bills_service import BillsService

ADMIN = {"role": "admin", "is_admin": True, "user_id": 1}
REQ = SimpleNamespace(client=None)


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    db.add_all([Company(company_id=1, company_name="Alpha Corp"), Company(company_id=2, company_name="Beta Corp")])
    db.add_all([
        BankAccount(id="bnk-a", bank_name="BDO", account_name="A", company_name="Alpha Corp", company_id=1,
                    starting_balance=Decimal("10000.00"), current_balance=Decimal("10000.00")),
        BankAccount(id="bnk-b", bank_name="Metro", account_name="B", company_name="Beta Corp", company_id=2,
                    starting_balance=Decimal("20000.00"), current_balance=Decimal("20000.00")),
    ])
    loan = Loan(borrower=1, lender=2, loan_ref_no="LN-1", bank_account_id="bnk-b",
                principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
                loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Working Capital")
    db.add(loan)
    db.commit()
    return db, loan


def _repay(db, loan, amount, ref=None):
    with patch.object(loans_ep, "get_supabase_admin_client", return_value=None):
        return loans_ep.create_loan_repayment(
            loan_id=loan.loan_id,
            repayment_in=LoanRepaymentCreate(payment_date=date(2026, 11, 5), amount=Decimal(amount),
                                             bank_account_id="bnk-a", payment_method="Bank Transfer", reference_no=ref),
            request=REQ, current_user=ADMIN, db=db,
        )


def _bal(db, acc):
    db.expire_all()
    return db.query(BankAccount).filter(BankAccount.id == acc).first().current_balance


def test_create_repayment_links_expense_and_both_bank_rows():
    """Blocker 1: deposit() returns a tuple; creating a repayment must not 500 and must tag the lender row."""
    db, loan = _db()
    rep = _repay(db, loan, "2000.00")
    assert rep.expense_id is not None
    borrower_rows = db.query(BankTransaction).filter(BankTransaction.source_expense_id == rep.expense_id).all()
    lender_rows = db.query(BankTransaction).filter(
        BankTransaction.source_loan_repayment_id == rep.loan_repayment_id, BankTransaction.deposit > 0
    ).all()
    assert len(borrower_rows) == 1 and borrower_rows[0].withdrawal == Decimal("2000.00")
    assert len(lender_rows) == 1 and lender_rows[0].bank_account_id == "bnk-b"
    assert _bal(db, "bnk-a") == Decimal("8000.00")
    assert _bal(db, "bnk-b") == Decimal("22000.00")


def test_two_same_day_equal_partial_repayments_stay_two_payments():
    """Major: the second identical payment must not be merged into the first payment's expense."""
    db, loan = _db()
    r1 = _repay(db, loan, "1000.00")
    r2 = _repay(db, loan, "1000.00")
    assert r1.expense_id != r2.expense_id
    assert db.query(Expense).filter(Expense.description.ilike("Loan Repayment%")).count() == 2
    assert _bal(db, "bnk-a") == Decimal("8000.00")
    assert _bal(db, "bnk-b") == Decimal("22000.00")


def test_refused_edit_changes_nothing():
    """Blocker 3: an amount the loan cannot take is refused before anything is written."""
    db, loan = _db()
    rep = _repay(db, loan, "2000.00")
    with pytest.raises(HTTPException) as err:
        loans_ep.prepare_loan_repayment_edit(db, rep.expense_id, Decimal("9000.00"))
    assert err.value.status_code == 400
    exp = db.query(Expense).filter(Expense.expense_id == rep.expense_id).first()
    assert exp.amount == Decimal("2000.00")
    assert _bal(db, "bnk-a") == Decimal("8000.00")
    assert _bal(db, "bnk-b") == Decimal("22000.00")


def test_edit_link_survives_after_expense_values_change():
    """Major: the repayment is pinned by expense_id, so later changing amount/date cannot lose it."""
    db, loan = _db()
    rep = _repay(db, loan, "2000.00")
    expense_id, repayment_id = rep.expense_id, rep.loan_repayment_id
    db.query(LoanRepayment).filter(LoanRepayment.loan_repayment_id == repayment_id).update({"expense_id": None})
    db.commit()
    assert loans_ep.prepare_loan_repayment_edit(db, expense_id, Decimal("2500.00")) == repayment_id
    exp = db.query(Expense).filter(Expense.expense_id == expense_id).first()
    exp.amount = Decimal("2500.00")
    exp.expense_date = date(2026, 11, 9)
    db.commit()
    assert loans_ep.sync_loan_repayment_from_expense(db, exp) == loan.loan_id
    db.refresh(rep)
    assert rep.amount == Decimal("2500.00")


def test_backfill_links_old_repayment_and_lender_row():
    """Major: repayments saved before 0074 get their links so edit and delete reach them."""
    db, loan = _db()
    rep = _repay(db, loan, "2000.00")
    db.query(LoanRepayment).update({"expense_id": None, "bank_account_id": None})
    db.query(BankTransaction).update({"source_loan_repayment_id": None})
    db.commit()
    assert loans_ep.backfill_loan_repayment_links(db) >= 2
    db.expire_all()
    fixed = db.query(LoanRepayment).first()
    assert fixed.expense_id is not None
    assert db.query(BankTransaction).filter(
        BankTransaction.source_loan_repayment_id == fixed.loan_repayment_id, BankTransaction.deposit > 0
    ).count() == 1
    assert loans_ep.backfill_loan_repayment_links(db) == 0  # running again changes nothing


def test_expense_amount_paid_is_not_left_stale():
    """Major: amount_paid follows the amount and the [Paid]/[Pending] lines."""
    from app.services.sales_receivables_sync import compute_paid_amount_from_particulars

    assert compute_paid_amount_from_particulars("Rice (1x @ ₱100.00 = ₱100.00) [Paid]\nOil (1x @ ₱50.00 = ₱50.00) [Pending]", "150") == Decimal("100.00")


def test_bill_payment_rejects_pending_edit_and_syncs_cleanly():
    """Major: marking a bill-linked expense as [Pending] must be rejected with HTTP 400 rather than deleting BillPayment."""
    db, _ = _db()
    svc = BillsService(db)
    bill = svc.create_bill(BillCreate(company_id=1, bill_name="Meralco", amount=Decimal("1000.00"),
                                      recurring="one-time", due_date=date(2026, 11, 15)))
    svc.record_payment(bill.bill_id, BillPaymentCreate(payment_date=date(2026, 11, 10), amount=Decimal("1000.00"),
                                                       payment_method="Bank Transfer", funding_source="bank",
                                                       bank_account_id="bnk-a", reference_no="B-1"))
    pay = db.query(BillPayment).filter(BillPayment.bill_id == bill.bill_id).first()
    with pytest.raises(HTTPException) as exc:
        svc.prepare_payment_edit_from_expense(pay.expense_id, Decimal("0.00"))
    assert exc.value.status_code == 400
    assert db.query(BillPayment).filter(BillPayment.bill_id == bill.bill_id).count() == 1
    assert _bal(db, "bnk-a") == Decimal("9000.00")


def test_legacy_adoption_does_not_duplicate_bank_row_without_autoflush():
    """Major: with autoflush off (as in production) adopting a legacy entry must not create a second row."""
    from app.services.bank_service import BankService

    db, _ = _db()
    db.autoflush = False
    svc = BankService(db)
    svc.record_deposit_by_account_id("bnk-a", Decimal("500"), "Sales Collection: Item")
    db.query(BankTransaction).update({"category": "Cash"})
    db.commit()
    svc.sync_sale_deposit(sale_id=7, target_amount=Decimal("500"), account_id="bnk-a",
                          particulars="Sales Collection: Item", legacy_particulars="Item")
    assert db.query(BankTransaction).count() == 1
    assert _bal(db, "bnk-a") == Decimal("10500.00")


def test_backfill_same_day_same_amount_under_autoflush_false_claims_distinct_rows():
    """Major: under autoflush=False, two same-day, same-amount repayments claim two distinct lender deposits."""
    db, loan = _db()
    db.autoflush = False
    r1 = _repay(db, loan, "1000.00")
    r2 = _repay(db, loan, "1000.00")
    db.query(LoanRepayment).update({"expense_id": None, "bank_account_id": None})
    db.query(BankTransaction).update({"source_loan_repayment_id": None})
    db.commit()

    count = loans_ep.backfill_loan_repayment_links(db)
    assert count >= 4
    db.expire_all()
    lender_links = [
        tx.source_loan_repayment_id
        for tx in db.query(BankTransaction).filter(BankTransaction.bank_account_id == "bnk-b", BankTransaction.deposit > 0).all()
    ]
    assert sorted(lender_links) == sorted([r1.loan_repayment_id, r2.loan_repayment_id])


def _http_env():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.session import get_db
    from app.core.dependencies import require_business_reader, require_business_writer
    from app.models.finance import Category

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()
    db.add_all([Company(company_id=1, company_name="Alpha Corp"), Company(company_id=2, company_name="Beta Corp")])
    db.add(Category(category_id=1, name="Utilities"))
    db.add_all([
        BankAccount(id="bnk-a1", bank_name="BDO", account_name="Alpha Primary", company_name="Alpha Corp", company_id=1,
                    starting_balance=Decimal("10000.00"), current_balance=Decimal("10000.00")),
        BankAccount(id="bnk-a2", bank_name="BPI", account_name="Alpha Secondary", company_name="Alpha Corp", company_id=1,
                    starting_balance=Decimal("8000.00"), current_balance=Decimal("8000.00")),
        BankAccount(id="bnk-b1", bank_name="Metro", account_name="Beta Main", company_name="Beta Corp", company_id=2,
                    starting_balance=Decimal("20000.00"), current_balance=Decimal("20000.00")),
    ])
    db.commit()

    def override_get_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    old = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_business_reader] = lambda: ADMIN
    app.dependency_overrides[require_business_writer] = lambda: ADMIN
    return app, TestClient(app), TestingSession, old, db


def test_http_expenses_round_trip_bank_account_id_and_amount_paid():
    """Blocker 1 & Major 6 over HTTP: POST/GET/PUT /api/v1/expenses preserve bank_account_id and update amount_paid."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        with patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            post_res = client.post(
                "/api/v1/expenses",
                json={
                    "company_id": 1,
                    "category": "Utilities",
                    "payment_method": "Bank Transfer",
                    "expense_date": "2026-11-10",
                    "amount": 1500.00,
                    "amount_paid": 1500.00,
                    "particulars": "Water (1x @ ₱1,500.00 = ₱1,500.00) [Paid]",
                    "bank_account_id": "bnk-a2",
                },
            )
            assert post_res.status_code in (200, 201), post_res.text
            created = post_res.json()
            assert created["bank_account_id"] == "bnk-a2"
            eid = created["expense_id"]

            get_res = client.get(f"/api/v1/expenses/{eid}")
            assert get_res.status_code == 200, get_res.text
            assert get_res.json()["bank_account_id"] == "bnk-a2"

            put_res = client.put(
                f"/api/v1/expenses/{eid}",
                json={
                    "amount": 1200.00,
                    "particulars": "Water (1x @ ₱900.00 = ₱900.00) [Paid]\nFee (1x @ ₱300.00 = ₱300.00) [Pending]",
                },
            )
            assert put_res.status_code == 200, put_res.text
            updated = put_res.json()
            assert updated["bank_account_id"] == "bnk-a2"
            assert Decimal(str(updated["amount_paid"])) == Decimal("900.00")

            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a2").current_balance == Decimal("7100.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_delete_expense_cascades_to_bills_and_loans_atomically():
    """Major 2 & 3: HTTP PUT (happy + bill overpay/[Pending] rejections) & DELETE /expenses/{id} cascades."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        svc = BillsService(seed_db)
        bill_out = svc.create_bill(
            BillCreate(company_id=1, bill_name="PLDT", amount=Decimal("1000.00"), recurring="one-time", due_date=date(2026, 11, 15))
        )
        svc.record_payment(
            bill_out.bill_id,
            BillPaymentCreate(
                payment_date=date(2026, 11, 10),
                amount=Decimal("600.00"),
                payment_method="Bank Transfer",
                funding_source="bank",
                bank_account_id="bnk-a1",
                reference_no="BILL-HTTP-1",
            ),
        )
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-HTTP-2", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Ops",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        bill_exp_id = seed_db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).first().expense_id

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            # Bill overpayment & [Pending] rejections return 400 without mutating DB
            overpay = client.put(f"/api/v1/expenses/{bill_exp_id}", json={"amount": 1500.00})
            assert overpay.status_code == 400
            pending_bill = client.put(
                f"/api/v1/expenses/{bill_exp_id}",
                json={"particulars": "Bills Payment: PLDT (1x @ ₱600.00 = ₱600.00) [Pending]"},
            )
            assert pending_bill.status_code == 400

            # Happy path PUT /expenses/{bill_exp_id} updates BillPayment, Bill.status, and Bank
            ok_bill = client.put(
                f"/api/v1/expenses/{bill_exp_id}",
                json={"amount": 1000.00, "particulars": "Bills Payment: PLDT (1x @ ₱1,000.00 = ₱1,000.00) [Paid]"},
            )
            assert ok_bill.status_code == 200, ok_bill.text
            check_db = SessionMaker()
            assert check_db.get(Bill, bill_out.bill_id).status == "paid"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("9000.00")
            check_db.close()

            # DELETE /expenses/{bill_exp_id} cascades cleanly to BillPayment, Bill, and Bank
            del_bill = client.delete(f"/api/v1/expenses/{bill_exp_id}")
            assert del_bill.status_code == 200, del_bill.text
            check_db = SessionMaker()
            assert check_db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).count() == 0
            assert check_db.get(Bill, bill_out.bill_id).status != "paid"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            check_db.close()

            # Loan repayment happy PUT /expenses/{id} & DELETE /expenses/{id}
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 2000.00, "bank_account_id": "bnk-a1", "payment_method": "Bank Transfer"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]
            check_db = SessionMaker()
            loan_exp_id = check_db.get(LoanRepayment, rep_id).expense_id
            check_db.close()

            ok_loan_put = client.put(
                f"/api/v1/expenses/{loan_exp_id}",
                json={"amount": 3000.00, "particulars": "Loan Repayment: Ops (1x @ ₱3,000.00 = ₱3,000.00) [Paid]"},
            )
            assert ok_loan_put.status_code == 200, ok_loan_put.text
            check_db = SessionMaker()
            assert check_db.get(LoanRepayment, rep_id).amount == Decimal("3000.00")
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("7000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("23000.00")
            check_db.close()

            del_loan = client.delete(f"/api/v1/expenses/{loan_exp_id}")
            assert del_loan.status_code == 200, del_loan.text
            check_db = SessionMaker()
            assert check_db.get(LoanRepayment, rep_id) is None
            assert check_db.get(Loan, loan.loan_id).status == "Disbursed"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("20000.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_delete_expense_cascades_to_bills_and_loans_atomically():
    """Major 2 & 3: HTTP PUT (happy + bill overpay/[Pending] rejections) & DELETE /expenses/{id} cascades."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        svc = BillsService(seed_db)
        bill_out = svc.create_bill(
            BillCreate(company_id=1, bill_name="PLDT", amount=Decimal("1000.00"), recurring="one-time", due_date=date(2026, 11, 15))
        )
        svc.record_payment(
            bill_out.bill_id,
            BillPaymentCreate(
                payment_date=date(2026, 11, 10),
                amount=Decimal("600.00"),
                payment_method="Bank Transfer",
                funding_source="bank",
                bank_account_id="bnk-a1",
                reference_no="BILL-HTTP-1",
            ),
        )
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-HTTP-2", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Ops",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        bill_exp_id = seed_db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).first().expense_id

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            # Bill overpayment & [Pending] rejections return 400 without mutating DB
            overpay = client.put(f"/api/v1/expenses/{bill_exp_id}", json={"amount": 1500.00})
            assert overpay.status_code == 400
            pending_bill = client.put(
                f"/api/v1/expenses/{bill_exp_id}",
                json={"particulars": "Bills Payment: PLDT (1x @ ₱600.00 = ₱600.00) [Pending]"},
            )
            assert pending_bill.status_code == 400

            # Happy path PUT /expenses/{bill_exp_id} updates BillPayment, Bill.status, and Bank
            ok_bill = client.put(
                f"/api/v1/expenses/{bill_exp_id}",
                json={"amount": 1000.00, "particulars": "Bills Payment: PLDT (1x @ ₱1,000.00 = ₱1,000.00) [Paid]"},
            )
            assert ok_bill.status_code == 200, ok_bill.text
            check_db = SessionMaker()
            assert check_db.get(Bill, bill_out.bill_id).status == "paid"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("9000.00")
            check_db.close()

            # DELETE /expenses/{bill_exp_id} cascades cleanly to BillPayment, Bill, and Bank
            del_bill = client.delete(f"/api/v1/expenses/{bill_exp_id}")
            assert del_bill.status_code == 200, del_bill.text
            check_db = SessionMaker()
            assert check_db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).count() == 0
            assert check_db.get(Bill, bill_out.bill_id).status != "paid"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            check_db.close()

            # Loan repayment happy PUT /expenses/{id} & DELETE /expenses/{id}
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 2000.00, "bank_account_id": "bnk-a1", "payment_method": "Bank Transfer"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]
            check_db = SessionMaker()
            loan_exp_id = check_db.get(LoanRepayment, rep_id).expense_id
            check_db.close()

            ok_loan_put = client.put(
                f"/api/v1/expenses/{loan_exp_id}",
                json={"amount": 3000.00, "particulars": "Loan Repayment: Ops (1x @ ₱3,000.00 = ₱3,000.00) [Paid]"},
            )
            assert ok_loan_put.status_code == 200, ok_loan_put.text
            check_db = SessionMaker()
            assert check_db.get(LoanRepayment, rep_id).amount == Decimal("3000.00")
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("7000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("23000.00")
            check_db.close()

            del_loan = client.delete(f"/api/v1/expenses/{loan_exp_id}")
            assert del_loan.status_code == 200, del_loan.text
            check_db = SessionMaker()
            assert check_db.get(LoanRepayment, rep_id) is None
            assert check_db.get(Loan, loan.loan_id).status == "Disbursed"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("20000.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_verified_lender_deposit_locks_repayment_edits_and_deletes_409():
    """Major 3 / Minor: Verified lender BankTransaction locks repayment edits and deletes with 409."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-VER-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: AuditLock",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 2000.00, "bank_account_id": "bnk-a1", "payment_method": "Bank Transfer"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]
            check_db = SessionMaker()
            rep_exp_id = check_db.get(LoanRepayment, rep_id).expense_id
            lender_tx = check_db.query(BankTransaction).filter(
                BankTransaction.source_loan_repayment_id == rep_id, BankTransaction.deposit > 0
            ).first()
            lender_tx.audit_status = "Verified"
            check_db.commit()
            check_db.close()

            assert client.put(f"/api/v1/expenses/{rep_exp_id}", json={"amount": 2500.00}).status_code == 409
            assert client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-06", "amount": 2500.00},
            ).status_code == 409
            assert client.delete(f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}").status_code == 409

            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("22000.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_repayment_payment_method_omitted_preserves_petty_cash_and_switches_cleanly():
    """Major 1: omitting payment_method in PUT repayment preserves Petty Cash; switching to Bank resolves default bank."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-PM-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Petty",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 1000.00, "payment_method": "Petty Cash"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]

            # Omitting payment_method must NOT reset Petty Cash to Cash
            put_omitted = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-05", "amount": 1500.00},
            )
            assert put_omitted.status_code == 200, put_omitted.text
            assert put_omitted.json()["payment_method"] == "Petty Cash"
            assert put_omitted.json()["bank_account_id"] is None
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            check_db.close()

            # Switching to Bank Transfer without bank_account_id resolves and persists default borrower bank
            put_bank = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-05", "amount": 1500.00, "payment_method": "Bank Transfer"},
            )
            assert put_bank.status_code == 200, put_bank.text
            assert put_bank.json()["bank_account_id"] == "bnk-a1"
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8500.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_patch_linked_entry_preserves_verified_on_noop_and_recompute_loan_skips_rest_when_shared_db():
    """Blocker 1 & Minor 6: patch_linked_entry keeps Verified on '' vs None no-op; recompute skips REST inside tx."""
    from app.services.bank_service import BankService

    db, loan = _db()
    svc = BankService(db)
    tx = svc.patch_linked_entry(
        link_attr="source_expense_id",
        link_id=501,
        credit=False,
        amount=Decimal("250.00"),
        account_id="bnk-a",
        particulars="Supplies",
        reference_no=None,
        tx_date="11/05/26",
    )
    tx.audit_status = "Verified"
    tx.audited_by = "Auditor"
    db.commit()

    # No-op reconcile with reference_no="" must preserve Verified
    res = svc.patch_linked_entry(
        link_attr="source_expense_id",
        link_id=501,
        credit=False,
        amount=Decimal("250.00"),
        account_id="bnk-a",
        particulars="Supplies",
        reference_no="",
        tx_date="11/05/26",
    )
    assert res.audit_status == "Verified"
    assert res.audited_by == "Auditor"

    # recompute_loan_repayments_and_status must NOT make any Supabase REST call before commit
    with patch.object(loans_ep, "get_supabase_admin_client") as sb_mock:
        loans_ep.recompute_loan_repayments_and_status(db, loan.loan_id)
        sb_mock.assert_not_called()



def test_http_verified_lender_deposit_locks_repayment_edits_and_deletes_409():
    """Major 3 / Minor: Verified lender BankTransaction locks repayment edits and deletes with 409."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-VER-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: AuditLock",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 2000.00, "bank_account_id": "bnk-a1", "payment_method": "Bank Transfer"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]
            check_db = SessionMaker()
            rep_exp_id = check_db.get(LoanRepayment, rep_id).expense_id
            lender_tx = check_db.query(BankTransaction).filter(
                BankTransaction.source_loan_repayment_id == rep_id, BankTransaction.deposit > 0
            ).first()
            lender_tx.audit_status = "Verified"
            check_db.commit()
            check_db.close()

            assert client.put(f"/api/v1/expenses/{rep_exp_id}", json={"amount": 2500.00}).status_code == 409
            assert client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-06", "amount": 2500.00},
            ).status_code == 409
            assert client.delete(f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}").status_code == 409

            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("22000.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_repayment_payment_method_omitted_preserves_petty_cash_and_switches_cleanly():
    """Major 1: omitting payment_method in PUT repayment preserves Petty Cash; switching to Bank resolves default bank."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-PM-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Petty",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 1000.00, "payment_method": "Petty Cash"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]

            # Omitting payment_method must NOT reset Petty Cash to Cash
            put_omitted = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-05", "amount": 1500.00},
            )
            assert put_omitted.status_code == 200, put_omitted.text
            assert put_omitted.json()["payment_method"] == "Petty Cash"
            assert put_omitted.json()["bank_account_id"] is None
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            check_db.close()

            # Switching to Bank Transfer without bank_account_id resolves and persists default borrower bank
            put_bank = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-05", "amount": 1500.00, "payment_method": "Bank Transfer"},
            )
            assert put_bank.status_code == 200, put_bank.text
            assert put_bank.json()["bank_account_id"] == "bnk-a1"
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8500.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_patch_linked_entry_preserves_verified_on_noop_and_recompute_loan_skips_rest_when_shared_db():
    """Blocker 1 & Minor 6: patch_linked_entry keeps Verified on '' vs None no-op; recompute skips REST inside tx."""
    from app.services.bank_service import BankService

    db, loan = _db()
    svc = BankService(db)
    tx = svc.patch_linked_entry(
        link_attr="source_expense_id",
        link_id=501,
        credit=False,
        amount=Decimal("250.00"),
        account_id="bnk-a",
        particulars="Supplies",
        reference_no=None,
        tx_date="11/05/26",
    )
    tx.audit_status = "Verified"
    tx.audited_by = "Auditor"
    db.commit()

    # No-op reconcile with reference_no="" must preserve Verified
    res = svc.patch_linked_entry(
        link_attr="source_expense_id",
        link_id=501,
        credit=False,
        amount=Decimal("250.00"),
        account_id="bnk-a",
        particulars="Supplies",
        reference_no="",
        tx_date="11/05/26",
    )
    assert res.audit_status == "Verified"
    assert res.audited_by == "Auditor"

    # recompute_loan_repayments_and_status must NOT make any Supabase REST call before commit
    with patch.object(loans_ep, "get_supabase_admin_client") as sb_mock:
        loans_ep.recompute_loan_repayments_and_status(db, loan.loan_id)
        sb_mock.assert_not_called()



def test_http_update_expense_rejects_loan_overpay_via_particulars_and_pending_atomically():
    """Blocker 2 & Major 3 over HTTP: particulars-derived loan overpay and [Pending] bill/loan edits reject with 400 without mutating DB."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-HTTP-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Equipment",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={
                    "payment_date": "2026-11-05",
                    "amount": 2000.00,
                    "bank_account_id": "bnk-a1",
                    "payment_method": "Bank Transfer",
                },
            )
            assert rep_res.status_code == 201, rep_res.text
            rep_json = rep_res.json()

            check_db = SessionMaker()
            rep = check_db.get(LoanRepayment, rep_json["loan_repayment_id"])
            rep_exp_id = rep.expense_id
            check_db.close()

            # Overpay via particulars edit (amount omitted!) must return 400 and leave Expense & Bank untouched
            bad_put = client.put(
                f"/api/v1/expenses/{rep_exp_id}",
                json={
                    "amount": 6000.00,
                    "particulars": "Loan Repayment: Equipment (1x @ ₱6,000.00 = ₱6,000.00) [Paid]",
                },
            )
            assert bad_put.status_code == 400, bad_put.text

            # [Pending] edit on loan-linked expense must return 400 and leave repayment intact
            pending_put = client.put(
                f"/api/v1/expenses/{rep_exp_id}",
                json={"particulars": "Loan Repayment: Equipment (1x @ ₱2,000.00 = ₱2,000.00) [Pending]"},
            )
            assert pending_put.status_code == 400, pending_put.text

            check_db = SessionMaker()
            assert check_db.get(Expense, rep_exp_id).amount == Decimal("2000.00")
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("22000.00")
            check_db.close()

            # PUT & DELETE /api/v1/loans/{loan_id}/repayments/{rep_id} over HTTP
            ok_put = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_json['loan_repayment_id']}",
                json={
                    "payment_date": "2026-11-06",
                    "amount": 3500.00,
                    "bank_account_id": "bnk-a2",
                    "payment_method": "Bank Transfer",
                },
            )
            assert ok_put.status_code == 200, ok_put.text
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            assert check_db.get(BankAccount, "bnk-a2").current_balance == Decimal("4500.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("23500.00")
            check_db.close()

            del_res = client.delete(f"/api/v1/loans/{loan.loan_id}/repayments/{rep_json['loan_repayment_id']}")
            assert del_res.status_code == 200, del_res.text
            check_db = SessionMaker()
            assert check_db.get(Expense, rep_exp_id) is None
            assert check_db.get(BankAccount, "bnk-a2").current_balance == Decimal("8000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("20000.00")
            assert check_db.get(Loan, loan.loan_id).status == "Disbursed"
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_delete_expense_cascades_to_bills_and_loans_atomically():
    """Major 2 & 3: HTTP PUT (happy + bill overpay/[Pending] rejections) & DELETE /expenses/{id} cascades."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        svc = BillsService(seed_db)
        bill_out = svc.create_bill(
            BillCreate(company_id=1, bill_name="PLDT", amount=Decimal("1000.00"), recurring="one-time", due_date=date(2026, 11, 15))
        )
        svc.record_payment(
            bill_out.bill_id,
            BillPaymentCreate(
                payment_date=date(2026, 11, 10),
                amount=Decimal("600.00"),
                payment_method="Bank Transfer",
                funding_source="bank",
                bank_account_id="bnk-a1",
                reference_no="BILL-HTTP-1",
            ),
        )
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-HTTP-2", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Ops",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        bill_exp_id = seed_db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).first().expense_id

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            # Bill overpayment & [Pending] rejections return 400 without mutating DB
            overpay = client.put(f"/api/v1/expenses/{bill_exp_id}", json={"amount": 1500.00})
            assert overpay.status_code == 400
            pending_bill = client.put(
                f"/api/v1/expenses/{bill_exp_id}",
                json={"particulars": "Bills Payment: PLDT (1x @ ₱600.00 = ₱600.00) [Pending]"},
            )
            assert pending_bill.status_code == 400

            # Happy path PUT /expenses/{bill_exp_id} updates BillPayment, Bill.status, and Bank
            ok_bill = client.put(
                f"/api/v1/expenses/{bill_exp_id}",
                json={"amount": 1000.00, "particulars": "Bills Payment: PLDT (1x @ ₱1,000.00 = ₱1,000.00) [Paid]"},
            )
            assert ok_bill.status_code == 200, ok_bill.text
            check_db = SessionMaker()
            assert check_db.get(Bill, bill_out.bill_id).status == "paid"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("9000.00")
            check_db.close()

            # DELETE /expenses/{bill_exp_id} cascades cleanly to BillPayment, Bill, and Bank
            del_bill = client.delete(f"/api/v1/expenses/{bill_exp_id}")
            assert del_bill.status_code == 200, del_bill.text
            check_db = SessionMaker()
            assert check_db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).count() == 0
            assert check_db.get(Bill, bill_out.bill_id).status != "paid"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            check_db.close()

            # Loan repayment happy PUT /expenses/{id} & DELETE /expenses/{id}
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 2000.00, "bank_account_id": "bnk-a1", "payment_method": "Bank Transfer"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]
            check_db = SessionMaker()
            loan_exp_id = check_db.get(LoanRepayment, rep_id).expense_id
            check_db.close()

            ok_loan_put = client.put(
                f"/api/v1/expenses/{loan_exp_id}",
                json={"amount": 3000.00, "particulars": "Loan Repayment: Ops (1x @ ₱3,000.00 = ₱3,000.00) [Paid]"},
            )
            assert ok_loan_put.status_code == 200, ok_loan_put.text
            check_db = SessionMaker()
            assert check_db.get(LoanRepayment, rep_id).amount == Decimal("3000.00")
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("7000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("23000.00")
            check_db.close()

            del_loan = client.delete(f"/api/v1/expenses/{loan_exp_id}")
            assert del_loan.status_code == 200, del_loan.text
            check_db = SessionMaker()
            assert check_db.get(LoanRepayment, rep_id) is None
            assert check_db.get(Loan, loan.loan_id).status == "Disbursed"
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("20000.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_verified_lender_deposit_locks_repayment_edits_and_deletes_409():
    """Major 3 / Minor: Verified lender BankTransaction locks repayment edits and deletes with 409."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-VER-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: AuditLock",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 2000.00, "bank_account_id": "bnk-a1", "payment_method": "Bank Transfer"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]
            check_db = SessionMaker()
            rep_exp_id = check_db.get(LoanRepayment, rep_id).expense_id
            lender_tx = check_db.query(BankTransaction).filter(
                BankTransaction.source_loan_repayment_id == rep_id, BankTransaction.deposit > 0
            ).first()
            lender_tx.audit_status = "Verified"
            check_db.commit()
            check_db.close()

            assert client.put(f"/api/v1/expenses/{rep_exp_id}", json={"amount": 2500.00}).status_code == 409
            assert client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-06", "amount": 2500.00},
            ).status_code == 409
            assert client.delete(f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}").status_code == 409

            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8000.00")
            assert check_db.get(BankAccount, "bnk-b1").current_balance == Decimal("22000.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_http_repayment_payment_method_omitted_preserves_petty_cash_and_switches_cleanly():
    """Major 1: omitting payment_method in PUT repayment preserves Petty Cash; switching to Bank resolves default bank."""
    from app.api.v1.endpoints import expenses as exp_ep

    app, client, SessionMaker, old_overrides, seed_db = _http_env()
    try:
        loan = Loan(
            borrower=1, lender=2, loan_ref_no="LN-PM-1", bank_account_id="bnk-b1",
            principal_amount=Decimal("5000.00"), interest_rate=Decimal("0.00"),
            loan_date=date(2026, 11, 1), status="Disbursed", description="Loan: Petty",
        )
        seed_db.add(loan)
        seed_db.commit()
        seed_db.refresh(loan)

        with patch.object(loans_ep, "get_supabase_admin_client", return_value=None), \
             patch.object(exp_ep, "get_supabase_admin_client", return_value=None):
            rep_res = client.post(
                f"/api/v1/loans/{loan.loan_id}/repayments",
                json={"payment_date": "2026-11-05", "amount": 1000.00, "payment_method": "Petty Cash"},
            )
            assert rep_res.status_code == 201
            rep_id = rep_res.json()["loan_repayment_id"]

            # Omitting payment_method must NOT reset Petty Cash to Cash
            put_omitted = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-05", "amount": 1500.00},
            )
            assert put_omitted.status_code == 200, put_omitted.text
            assert put_omitted.json()["payment_method"] == "Petty Cash"
            assert put_omitted.json()["bank_account_id"] is None
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("10000.00")
            check_db.close()

            # Switching to Bank Transfer without bank_account_id resolves and persists default borrower bank
            put_bank = client.put(
                f"/api/v1/loans/{loan.loan_id}/repayments/{rep_id}",
                json={"payment_date": "2026-11-05", "amount": 1500.00, "payment_method": "Bank Transfer"},
            )
            assert put_bank.status_code == 200, put_bank.text
            assert put_bank.json()["bank_account_id"] == "bnk-a1"
            check_db = SessionMaker()
            assert check_db.get(BankAccount, "bnk-a1").current_balance == Decimal("8500.00")
            check_db.close()
    finally:
        seed_db.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_patch_linked_entry_preserves_verified_on_noop_and_recompute_loan_skips_rest_when_shared_db():
    """Blocker 1 & Minor 6: patch_linked_entry keeps Verified on '' vs None no-op; recompute skips REST inside tx."""
    from app.services.bank_service import BankService

    db, loan = _db()
    svc = BankService(db)
    tx = svc.patch_linked_entry(
        link_attr="source_expense_id",
        link_id=501,
        credit=False,
        amount=Decimal("250.00"),
        account_id="bnk-a",
        particulars="Supplies",
        reference_no=None,
        tx_date="11/05/26",
    )
    tx.audit_status = "Verified"
    tx.audited_by = "Auditor"
    db.commit()

    # No-op reconcile with reference_no="" must preserve Verified
    res = svc.patch_linked_entry(
        link_attr="source_expense_id",
        link_id=501,
        credit=False,
        amount=Decimal("250.00"),
        account_id="bnk-a",
        particulars="Supplies",
        reference_no="",
        tx_date="11/05/26",
    )
    assert res.audit_status == "Verified"
    assert res.audited_by == "Auditor"

    # recompute_loan_repayments_and_status must NOT make any Supabase REST call before commit
    with patch.object(loans_ep, "get_supabase_admin_client") as sb_mock:
        loans_ep.recompute_loan_repayments_and_status(db, loan.loan_id)
        sb_mock.assert_not_called()


