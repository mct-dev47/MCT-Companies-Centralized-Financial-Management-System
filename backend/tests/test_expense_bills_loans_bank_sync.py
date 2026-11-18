from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.bills import Bill, BillPayment
from app.models.company import Company
from app.models.finance import Category, Expense, Sale
from app.models.loan import Loan, LoanRepayment
from app.services.bank_service import BankService
from app.services.bills_service import BillsService
from app.schemas.bills import BillCreate, BillPaymentCreate
from app.api.v1.endpoints.expenses import reconcile_expense_bank
from app.api.v1.endpoints.loans import (
    delete_loan_repayment_from_expense,
    recompute_loan_repayments_and_status,
    sync_loan_repayment_from_expense,
)
from app.services.sales_receivables_sync import SalesReceivablesSyncService


def _db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    c1 = Company(company_id=1, company_name="Alpha Corp")
    c2 = Company(company_id=2, company_name="Beta Corp")
    db.add_all([c1, c2])
    db.add_all([
        BankAccount(
            id="bnk-alpha-1",
            bank_name="BDO",
            account_name="Alpha Main",
            company_name="Alpha Corp",
            company_id=1,
            starting_balance=Decimal("10000.00"),
            current_balance=Decimal("10000.00"),
        ),
        BankAccount(
            id="bnk-alpha-2",
            bank_name="BPI",
            account_name="Alpha Alt",
            company_name="Alpha Corp",
            company_id=1,
            starting_balance=Decimal("5000.00"),
            current_balance=Decimal("5000.00"),
        ),
        BankAccount(
            id="bnk-beta-1",
            bank_name="Metrobank",
            account_name="Beta Main",
            company_name="Beta Corp",
            company_id=2,
            starting_balance=Decimal("20000.00"),
            current_balance=Decimal("20000.00"),
        ),
    ])
    db.commit()
    return db


def test_sale_in_place_edit_and_delete_updates_single_bank_row():
    db = _db()
    sale = Sale(
        company_id=1,
        transaction_date=date(2026, 11, 1),
        deposit_date=date(2026, 11, 1),
        deposit_status="Deposited",
        payment_status="Paid",
        payment_method="Bank Transfer",
        amount=Decimal("1500.00"),
        particulars="Widget (1x @ ₱1,500.00 = ₱1,500.00) [Paid]",
        cheque_no="CHK-001",
        bank_account_id="bnk-alpha-1",
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)

    SalesReceivablesSyncService(db).reconcile_sale_bank(sale.sales_id)
    txs = db.query(BankTransaction).filter(BankTransaction.source_sale_id == sale.sales_id).all()
    assert len(txs) == 1
    assert txs[0].deposit == Decimal("1500.00")
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("11500.00")

    # Edit amount, date, cheque, and move bank account
    sale.amount = Decimal("2200.00")
    sale.particulars = "Widget (1x @ ₱2,200.00 = ₱2,200.00) [Paid]"
    sale.deposit_date = date(2026, 11, 5)
    sale.cheque_no = "CHK-002"
    sale.bank_account_id = "bnk-alpha-2"
    db.commit()

    SalesReceivablesSyncService(db).reconcile_sale_bank(sale.sales_id)
    txs = db.query(BankTransaction).filter(BankTransaction.source_sale_id == sale.sales_id).all()
    assert len(txs) == 1  # in-place edit, no duplicate/reversal row
    assert txs[0].bank_account_id == "bnk-alpha-2"
    assert txs[0].deposit == Decimal("2200.00")
    assert txs[0].cheque_no == "CHK-002"
    assert txs[0].transaction_date == "11/05/26"
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("10000.00")
    assert db.get(BankAccount, "bnk-alpha-2").current_balance == Decimal("7200.00")

    # Delete sale -> purge bank entry and restore balance
    SalesReceivablesSyncService(db).reconcile_sale_bank(sale.sales_id, force_zero=True)
    BankService(db).purge_linked_entries(link_attr="source_sale_id", link_id=sale.sales_id)
    assert db.query(BankTransaction).filter(BankTransaction.source_sale_id == sale.sales_id).count() == 0
    assert db.get(BankAccount, "bnk-alpha-2").current_balance == Decimal("5000.00")


def test_expense_in_place_edit_and_delete_updates_single_bank_row():
    db = _db()
    exp = Expense(
        company_id=1,
        expense_date=date(2026, 11, 2),
        payment_method="Bank Transfer",
        amount=Decimal("800.00"),
        amount_paid=Decimal("800.00"),
        description="Internet (1x @ ₱800.00 = ₱800.00) [Paid]",
        cheque_no="REF-10",
        bank_account_id="bnk-alpha-1",
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)

    reconcile_expense_bank(db, expense_id=exp.expense_id)
    txs = db.query(BankTransaction).filter(BankTransaction.source_expense_id == exp.expense_id).all()
    assert len(txs) == 1
    assert txs[0].withdrawal == Decimal("800.00")
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("9200.00")

    # Edit amount, date, cheque, and move bank
    exp.amount = Decimal("1200.00")
    exp.amount_paid = Decimal("1200.00")
    exp.description = "Internet (1x @ ₱1,200.00 = ₱1,200.00) [Paid]"
    exp.expense_date = date(2026, 11, 6)
    exp.cheque_no = "REF-20"
    exp.bank_account_id = "bnk-alpha-2"
    db.commit()

    reconcile_expense_bank(db, expense_id=exp.expense_id)
    txs = db.query(BankTransaction).filter(BankTransaction.source_expense_id == exp.expense_id).all()
    assert len(txs) == 1
    assert txs[0].bank_account_id == "bnk-alpha-2"
    assert txs[0].withdrawal == Decimal("1200.00")
    assert txs[0].cheque_no == "REF-20"
    assert txs[0].transaction_date == "11/06/26"
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("10000.00")
    assert db.get(BankAccount, "bnk-alpha-2").current_balance == Decimal("3800.00")


def test_expense_edit_and_delete_cascades_to_bills_and_bank():
    db = _db()
    svc = BillsService(db)
    bill_out = svc.create_bill(
        BillCreate(
            company_id=1,
            bill_name="Meralco",
            amount=Decimal("1000.00"),
            recurring="one-time",
            due_date=date(2026, 11, 15),
        )
    )
    paid_bill = svc.record_payment(
        bill_out.bill_id,
        BillPaymentCreate(
            payment_date=date(2026, 11, 10),
            amount=Decimal("1000.00"),
            payment_method="Bank Transfer",
            funding_source="bank",
            bank_account_id="bnk-alpha-1",
            reference_no="BILL-01",
        ),
    )
    assert paid_bill.status == "paid"
    payment = db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).first()
    assert payment is not None and payment.expense_id is not None
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("9000.00")

    # Edit the expense (e.g. partial payment 600.00, new date & ref)
    exp = db.query(Expense).filter(Expense.expense_id == payment.expense_id).first()
    exp.amount = Decimal("600.00")
    exp.amount_paid = Decimal("600.00")
    exp.description = "Bills Payment: Meralco (1x @ ₱600.00 = ₱600.00) [Paid]"
    exp.expense_date = date(2026, 11, 12)
    exp.cheque_no = "BILL-02"
    db.commit()

    reconcile_expense_bank(db, expense_id=exp.expense_id)
    affected_bill_id = svc.sync_payment_from_expense(exp)
    assert affected_bill_id == bill_out.bill_id

    db.refresh(payment)
    assert payment.amount == Decimal("600.00")
    assert payment.payment_date == date(2026, 11, 12)
    assert payment.reference_no == "BILL-02"
    assert db.get(Bill, bill_out.bill_id).status == "partially paid"
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("9400.00")

    # Delete the expense -> BillPayment removed, Bill status reverts, Bank restored
    affected_bill_id = svc.delete_payment_from_expense(exp.expense_id)
    assert affected_bill_id == bill_out.bill_id
    reconcile_expense_bank(db, expense_id=exp.expense_id, force_zero=True)
    db.delete(exp)
    db.commit()
    BankService(db).purge_linked_entries(link_attr="source_expense_id", link_id=exp.expense_id)

    assert db.query(BillPayment).filter(BillPayment.bill_id == bill_out.bill_id).count() == 0
    assert db.get(Bill, bill_out.bill_id).status in ("unpaid", "due soon", "overdue")
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("10000.00")


def test_expense_edit_and_delete_cascades_to_loan_and_both_banks():
    db = _db()
    loan = Loan(
        borrower=1,
        lender=2,
        loan_ref_no="LN-100",
        bank_account_id="bnk-beta-1",
        principal_amount=Decimal("5000.00"),
        interest_rate=Decimal("0.00"),
        loan_date=date(2026, 11, 1),
        status="Disbursed",
        description="Working Capital",
    )
    db.add(loan)
    db.flush()

    exp = Expense(
        company_id=1,
        expense_date=date(2026, 11, 5),
        payment_method="Bank Transfer",
        amount=Decimal("2000.00"),
        amount_paid=Decimal("2000.00"),
        description="Loan Repayment: Working Capital (to Beta Corp)",
        cheque_no="REP-1",
        bank_account_id="bnk-alpha-1",
    )
    db.add(exp)
    db.flush()

    rep = LoanRepayment(
        loan_id=loan.loan_id,
        payment_date=date(2026, 11, 5),
        remaining_balance=Decimal("3000.00"),
        amount=Decimal("2000.00"),
        reference_no="REP-1",
        status="completed",
        expense_id=exp.expense_id,
        bank_account_id="bnk-alpha-1",
    )
    db.add(rep)
    db.flush()

    # Borrower withdrawal (linked to expense + repayment)
    reconcile_expense_bank(db, expense_id=exp.expense_id, commit=False)
    btx = db.query(BankTransaction).filter(BankTransaction.source_expense_id == exp.expense_id).first()
    btx.source_loan_repayment_id = rep.loan_repayment_id

    # Lender deposit (linked to repayment)
    ltx = BankTransaction(
        id="tx-lender-1",
        bank_account_id="bnk-beta-1",
        transaction_date="11/05/26",
        cheque_no="REP-1",
        particulars="Loan Repayment: Working Capital (from Alpha Corp)",
        deposit=Decimal("2000.00"),
        withdrawal=Decimal("0.00"),
        category="Loan Repayment",
        net_amount=Decimal("2000.00"),
        source_loan_repayment_id=rep.loan_repayment_id,
        company_name="Beta Corp",
    )
    db.add(ltx)
    db.flush()
    BankService(db)._sync_balance(db.get(BankAccount, "bnk-beta-1"))
    recompute_loan_repayments_and_status(db, loan.loan_id)
    db.commit()

    assert db.get(Loan, loan.loan_id).status == "Partially Paid"
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("8000.00")
    assert db.get(BankAccount, "bnk-beta-1").current_balance == Decimal("22000.00")

    # Edit the expense to full payment 5000.00
    exp.amount = Decimal("5000.00")
    exp.amount_paid = Decimal("5000.00")
    exp.expense_date = date(2026, 11, 8)
    exp.cheque_no = "REP-1-EDIT"
    db.commit()

    reconcile_expense_bank(db, expense_id=exp.expense_id)
    affected_loan_id = sync_loan_repayment_from_expense(db, exp)
    assert affected_loan_id == loan.loan_id

    db.refresh(rep)
    db.refresh(loan)
    assert rep.amount == Decimal("5000.00")
    assert rep.remaining_balance == Decimal("0.00")
    assert loan.status == "Paid"
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("5000.00")
    assert db.get(BankAccount, "bnk-beta-1").current_balance == Decimal("25000.00")

    # Delete the expense -> LoanRepayment deleted, Loan reverts to Disbursed, both banks restored
    affected_loan_id = delete_loan_repayment_from_expense(db, exp.expense_id)
    assert affected_loan_id == loan.loan_id
    reconcile_expense_bank(db, expense_id=exp.expense_id, force_zero=True)
    db.delete(exp)
    db.commit()
    BankService(db).purge_linked_entries(link_attr="source_expense_id", link_id=exp.expense_id)

    db.refresh(loan)
    assert db.query(LoanRepayment).filter(LoanRepayment.loan_id == loan.loan_id).count() == 0
    assert loan.status == "Disbursed"
    assert db.get(BankAccount, "bnk-alpha-1").current_balance == Decimal("10000.00")
    assert db.get(BankAccount, "bnk-beta-1").current_balance == Decimal("20000.00")
