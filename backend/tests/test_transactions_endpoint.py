import pytest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import or_, text

from app.main import app
from app.db.session import get_db, SessionLocal
from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Sale, Expense, Category
from app.models.lending import Borrower
from app.models.receivable import Receivable, ReceivablePayment
from app.models.tenant import TenantLease, TenantLeasePayment
from app.models.bills import Bill, BillPayment
from app.models.loan import Loan, LoanRepayment
from app.models.petty_cash import PettyCashTopUp
from app.schemas.bills import BillCreate, BillPaymentCreate
from app.services.bills_service import BillsService
from app.services.bank_service import BankService, entry_source_supported
from app.services.sales_receivables_sync import SalesReceivablesSyncService
from app.core.dependencies import require_business_reader, require_business_writer, require_auditor_user


client = TestClient(app)

ADMIN_USER = {
    "user_id": 1,
    "email": "admin@mct.com",
    "role": "owner",
    "full_name": "Admin Owner",
    "company_ids": [],
    "company_id": None,
}


@pytest.fixture(autouse=True)
def override_deps():
    old_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[require_business_reader] = lambda: ADMIN_USER
    app.dependency_overrides[require_business_writer] = lambda: ADMIN_USER
    app.dependency_overrides[require_auditor_user] = lambda: ADMIN_USER
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(old_overrides)


@pytest.fixture
def db_session():
    db = SessionLocal()
    existing_cids = {cid for (cid,) in db.query(Company.company_id).all()}
    existing_bt_ids = {bid for (bid,) in db.query(BankTransaction.id).all()}
    existing_borrower_ids = {bid for (bid,) in db.query(Borrower.borrower_id).all()}
    try:
        yield db
    finally:
        try:
            db.rollback()
            new_borrower_ids = [bid for (bid,) in db.query(Borrower.borrower_id).all() if bid not in existing_borrower_ids]
            if new_borrower_ids:
                db.query(Borrower).filter(Borrower.borrower_id.in_(new_borrower_ids)).delete(synchronize_session=False)

            new_bt_ids = [bid for (bid,) in db.query(BankTransaction.id).all() if bid not in existing_bt_ids]
            if new_bt_ids:
                db.query(BankTransaction).filter(BankTransaction.id.in_(new_bt_ids)).delete(synchronize_session=False)

            cids = [cid for (cid,) in db.query(Company.company_id).all() if cid not in existing_cids]
            if cids:
                db.query(ReceivablePayment).filter(ReceivablePayment.receivable.has(Receivable.company_id.in_(cids))).delete(synchronize_session=False)
                db.query(Receivable).filter(Receivable.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(TenantLeasePayment).filter(TenantLeasePayment.lease.has(TenantLease.company_id.in_(cids))).delete(synchronize_session=False)
                db.query(TenantLease).filter(TenantLease.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(BankTransaction).filter(
                    BankTransaction.account.has(BankAccount.company_id.in_(cids))
                ).delete(synchronize_session=False)
                db.query(BankAccount).filter(BankAccount.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(BillPayment).filter(BillPayment.bill.has(Bill.company_id.in_(cids))).delete(synchronize_session=False)
                db.query(Bill).filter(Bill.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(Expense).filter(Expense.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(Sale).filter(Sale.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(LoanRepayment).filter(LoanRepayment.loan.has(or_(Loan.borrower.in_(cids), Loan.lender.in_(cids)))).delete(synchronize_session=False)
                db.query(Loan).filter(or_(Loan.borrower.in_(cids), Loan.lender.in_(cids))).delete(synchronize_session=False)
                db.query(PettyCashTopUp).filter(PettyCashTopUp.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(Company).filter(Company.company_id.in_(cids)).delete(synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()


def test_transactions_endpoint_strict_sync(db_session):
    """
    Verify:
    1. Paid / Deposited sales & expenses appear in GET /api/v1/transactions with proper IDs.
    2. Unpaid items appear with status='Unpaid' and paidAmount=0.0.
    3. Manual bank entries appear with single 'tx-' prefix without duplicating sales/expenses.
    4. saleDate is provided on all records.
    """
    comp = Company(company_name="Sync Test Corp")
    db_session.add(comp)
    db_session.flush()

    bank = BankAccount(
        id="acc-test-sync-1",
        bank_name="BDO",
        account_name="Main Operating",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("50000.00"),
        current_balance=Decimal("50000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    # 1. Paid & Deposited Sale
    sale_paid = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("1500.00"),
        particulars="Paid Retail Sale",
        payment_status="Paid",
        deposit_status="Deposited",
        bank_account_id=bank.id,
        audit_status="Pending Audit",
    )
    db_session.add(sale_paid)

    # 2. Unpaid Sale
    sale_unpaid = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("9999.00"),
        particulars="Unpaid Future Sale",
        payment_status="Unpaid",
        deposit_status="Not Deposited",
        audit_status="Pending Audit",
    )
    db_session.add(sale_unpaid)

    # 3. Paid Expense
    exp_paid = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("250.00"),
        amount_paid=Decimal("250.00"),
        particulars="Office Supplies",
        payment_method="Cash",
        audit_status="Pending Audit",
    )
    db_session.add(exp_paid)

    # 4. Manual Direct Bank Entry
    manual_bt = BankTransaction(
        id="tx-manual-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Manual Owner Capital Injection",
        deposit=Decimal("10000.00"),
        withdrawal=Decimal("0.00"),
        company_name=comp.company_name,
    )
    if entry_source_supported(db_session):
        manual_bt._entry_source = "manual"
    db_session.add(manual_bt)
    db_session.commit()
    if entry_source_supported(db_session):
        BankService(db_session)._save_entry_source(manual_bt)
        db_session.commit()

    res = client.get(f"/api/v1/transactions?company_id={comp.company_id}")
    assert res.status_code == 200
    items = res.json()
    assert len(items) >= 4

    # Validate sale_paid
    paid_s = next((i for i in items if i["id"] == f"sale_{sale_paid.sales_id}"), None)
    assert paid_s is not None
    assert paid_s["deposit"] == 1500.0
    assert paid_s["status"] == "Paid"
    assert paid_s["depositStatus"] == "Deposited"
    assert paid_s["saleDate"] is not None

    # Validate sale_unpaid
    unpaid_s = next((i for i in items if i["id"] == f"sale_{sale_unpaid.sales_id}"), None)
    assert unpaid_s is not None
    assert unpaid_s["deposit"] == 0.0
    assert unpaid_s["status"] == "Unpaid"
    assert unpaid_s["depositStatus"] == "Not Deposited"

    # Validate exp_paid
    exp_i = next((i for i in items if i["id"] == f"exp_{exp_paid.expense_id}"), None)
    assert exp_i is not None
    assert exp_i["amount"] == 250.0
    assert exp_i["status"] == "Paid"

    # Validate manual bank transaction
    bank_i = next((i for i in items if i["id"] == "tx-manual-1"), None)
    assert bank_i is not None
    assert bank_i["deposit"] == 10000.0
    assert bank_i["type"] == "Bank"


def test_unpaid_expense_status_and_paid_amount(db_session):
    """
    Verify that unpaid expenses (amount_paid=0.0) display status='Unpaid' and withdrawal=0.0.
    """
    comp = Company(company_name="Sync Test Corp 2")
    db_session.add(comp)
    db_session.flush()

    exp_unpaid = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("5000.00"),
        amount_paid=Decimal("0.00"),
        particulars="Unpaid Consulting Fee",
        payment_method="Cash",
        audit_status="Pending Audit",
    )
    db_session.add(exp_unpaid)
    db_session.commit()

    res = client.get(f"/api/v1/transactions?company_id={comp.company_id}")
    assert res.status_code == 200
    items = res.json()
    unpaid_exp = next((i for i in items if i["id"] == f"exp_{exp_unpaid.expense_id}"), None)
    assert unpaid_exp is not None
    assert unpaid_exp["status"] == "Unpaid"
    assert unpaid_exp["paidAmount"] == 0.0
    assert unpaid_exp["withdrawal"] == 0.0


def test_partially_paid_sale_does_not_crash_and_uses_derived_paid_amount(db_session):
    """
    Blocker 1 test: Sale model has no amount_paid column.
    A sale with payment_status='Partially Paid' must not crash with AttributeError
    and must compute paid amounts safely.
    """
    comp = Company(company_name="Partially Paid Test Corp")
    db_session.add(comp)
    db_session.flush()

    # Create a partially paid sale
    sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("2000.00"),
        particulars="Product Sale [Partial: 500.00 paid]",
        payment_status="Partially Paid",
        deposit_status="Deposited",
        audit_status="Pending Audit",
    )
    db_session.add(sale)
    db_session.flush()

    rec = Receivable(
        company_id=comp.company_id,
        company_name=comp.company_name,
        sale_id=sale.sales_id,
        customer_name="Partial Customer",
        transaction_date=date.today(),
        items_summary="Product Sale",
        total_amount=Decimal("2000.00"),
        amount_paid=Decimal("500.00"),
        balance=Decimal("1500.00"),
        payment_status="Partial",
    )
    db_session.add(rec)
    db_session.commit()

    # GET /api/v1/transactions must return 200 without AttributeError
    res = client.get(f"/api/v1/transactions?company_id={comp.company_id}")
    assert res.status_code == 200
    items = res.json()
    s_item = next((i for i in items if i["id"] == f"sale_{sale.sales_id}"), None)
    assert s_item is not None
    assert s_item["amount"] == 2000.0
    assert s_item["paidAmount"] == 500.0
    assert s_item["deposit"] == 500.0


def test_manual_bank_entry_does_not_duplicate_loan_and_petty_cash_transfers(db_session):
    """
    Blocker 3 test: Automated bank transfers created by loans or petty cash top-ups
    must not appear under Section 4 (Bank) to prevent double counting.
    """
    comp = Company(company_name="Bank Dedup Test Corp")
    db_session.add(comp)
    db_session.flush()

    bank = BankAccount(
        id="acc-bank-dedup-1",
        bank_name="BPI",
        account_name="Operating Account",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("100000.00"),
        current_balance=Decimal("100000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    # Automated bank entry from loan disbursement (entry_source is None, particulars start with 'Loan:')
    loan_bt = BankTransaction(
        id="tx-loan-auto-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Loan: Working capital (to Subsidiary)",
        category="Bank Transfer",
        withdrawal=Decimal("25000.00"),
        deposit=Decimal("0.00"),
        company_name=comp.company_name,
    )
    db_session.add(loan_bt)

    # Manual bank transaction
    manual_bt = BankTransaction(
        id="tx-manual-legit-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Bank Service Fee adjustment",
        category="Bank Transfer",
        withdrawal=Decimal("150.00"),
        deposit=Decimal("0.00"),
        company_name=comp.company_name,
    )
    if entry_source_supported(db_session):
        manual_bt._entry_source = "manual"
    db_session.add(manual_bt)
    db_session.commit()
    if entry_source_supported(db_session):
        BankService(db_session)._save_entry_source(manual_bt)
        db_session.commit()

    res = client.get(f"/api/v1/transactions?company_id={comp.company_id}&type=bank")
    assert res.status_code == 200
    bank_items = res.json()

    # Only manual transaction should appear under type=bank
    ids = [b["id"] for b in bank_items]
    assert "tx-manual-legit-1" in ids
    assert "tx-loan-auto-1" not in ids


def test_manual_bank_deletion_syncs_balance(db_session):
    """
    Verify that deleting a manual bank entry via DELETE /api/v1/transactions/{id}
    recalculates and updates the BankAccount balance with zero ghost data.
    """
    comp = Company(company_name="Cascade Test Corp")
    db_session.add(comp)
    db_session.flush()

    bank = BankAccount(
        id="acc-test-cascade-1",
        bank_name="Metrobank",
        account_name="Savings",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("1000.00"),
        current_balance=Decimal("6000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    bt = BankTransaction(
        id="tx-test-del-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Test Deposit to Delete",
        deposit=Decimal("5000.00"),
        withdrawal=Decimal("0.00"),
        company_name=comp.company_name,
    )
    db_session.add(bt)
    db_session.commit()

    del_res = client.delete(f"/api/v1/transactions/tx-test-del-1")
    assert del_res.status_code == 200

    # Ensure transaction is deleted
    assert db_session.query(BankTransaction).filter(BankTransaction.id == "tx-test-del-1").first() is None

    # Ensure bank balance recalculated: 1000 starting + 0 transactions = 1000.00
    db_session.refresh(bank)
    assert bank.current_balance == Decimal("1000.00")


def test_delete_sale_with_prefixed_and_tx_id(db_session):
    """
    Blocker 4 test: Calling DELETE /api/v1/sales/sale_{sales_id} must not raise ValueError
    and must resolve the ID cleanly.
    """
    comp = Company(company_name="Delete Sale Prefix Corp")
    db_session.add(comp)
    db_session.flush()

    sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("3500.00"),
        particulars="Sale with prefix ID test",
        payment_status="Paid",
        deposit_status="Not Deposited",
        audit_status="Pending Audit",
    )
    db_session.add(sale)
    db_session.commit()
    sid = sale.sales_id

    # Call delete endpoint with 'sale_<id>' prefix
    res = client.delete(f"/api/v1/sales/sale_{sid}")
    assert res.status_code == 200
    assert db_session.query(Sale).filter(Sale.sales_id == sid).first() is None


def test_delete_transaction_safety_guards(db_session):
    """
    Blocker 5 test: Test security guards in delete_transaction:
    1. Linked bank transaction cannot be deleted directly (HTTP 400).
    2. Expense linked to BillPayment cannot be deleted directly (HTTP 409).
    3. Approved loan cannot be deleted directly (HTTP 400).
    """
    comp = Company(company_name="Delete Guards Corp")
    db_session.add(comp)
    db_session.flush()

    bank = BankAccount(
        id="acc-del-guards-1",
        bank_name="BDO",
        account_name="Main",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("20000.00"),
        current_balance=Decimal("20000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    # 1. Linked bank transaction
    linked_bt = BankTransaction(
        id="tx-linked-sale-bt-1",
        bank_account_id=bank.id,
        source_sale_id=99999,
        deposit=Decimal("1000.00"),
        withdrawal=Decimal("0.00"),
        particulars="Sale deposit link",
        transaction_date=date.today().strftime("%m/%d/%y"),
    )
    db_session.add(linked_bt)

    # 2. Expense linked to BillPayment
    bill = Bill(
        company_id=comp.company_id,
        bill_name="Meralco",
        amount=Decimal("5000.00"),
        due_date=date.today(),
    )
    db_session.add(bill)
    db_session.flush()

    exp_bill = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("5000.00"),
        amount_paid=Decimal("5000.00"),
        particulars="Meralco Bill",
        audit_status="Pending Audit",
    )
    db_session.add(exp_bill)
    db_session.flush()

    bp = BillPayment(
        bill_id=bill.bill_id,
        expense_id=exp_bill.expense_id,
        payment_date=date.today(),
        amount=Decimal("5000.00"),
        payment_method="Cash",
    )
    db_session.add(bp)

    # 3. Approved Loan
    loan = Loan(
        borrower=comp.company_id,
        principal_amount=Decimal("50000.00"),
        loan_date=date.today(),
        status="Disbursed",
    )
    db_session.add(loan)
    db_session.commit()

    # Check 1: Linked bank transaction delete fails 400
    res1 = client.delete("/api/v1/transactions/tx-linked-sale-bt-1")
    assert res1.status_code == 400
    assert "Cannot delete a bank transaction linked" in res1.json()["detail"]

    # Check 2: Bill payment linked expense delete fails 409
    res2 = client.delete(f"/api/v1/transactions/exp_{exp_bill.expense_id}")
    assert res2.status_code == 409
    assert "bill payment" in res2.json()["detail"].lower()

    # Check 3: Approved loan delete fails 400
    res3 = client.delete(f"/api/v1/transactions/loan_{loan.loan_id}")
    assert res3.status_code == 400
    assert "Approved loans cannot be deleted" in res3.json()["detail"]


def test_sale_deletion_cascade(db_session):
    """
    Verify deleting a sale cascades to linked bank entries and deletes with zero ghost records.
    """
    comp = Company(company_name="Cascade Test Corp 2")
    db_session.add(comp)
    db_session.flush()

    sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("2000.00"),
        particulars="Cascade Sale",
        payment_status="Paid",
        deposit_status="Deposited",
        audit_status="Pending Audit",
    )
    db_session.add(sale)
    db_session.commit()
    sid = sale.sales_id

    # Create linked bank transaction
    bank = BankAccount(
        id="acc-test-cascade-2",
        bank_name="Security Bank",
        account_name="Main",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("1000.00"),
        current_balance=Decimal("3000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    bt = BankTransaction(
        id="tx-test-del-2",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Deposit for Cascade Sale",
        deposit=Decimal("2000.00"),
        withdrawal=Decimal("0.00"),
        source_sale_id=sid,
        company_name=comp.company_name,
    )
    db_session.add(bt)
    db_session.commit()

    del_res = client.delete(f"/api/v1/transactions/sale_{sid}")
    assert del_res.status_code == 200

    # Sale and linked bank transaction must both be removed
    assert db_session.query(Sale).filter(Sale.sales_id == sid).first() is None
    assert db_session.query(BankTransaction).filter(BankTransaction.source_sale_id == sid).first() is None


def test_company_idor_access_check(db_session):
    """
    Verify that an unassigned user gets 403 Forbidden on transactions endpoint.
    """
    comp1 = Company(company_name="IDOR Test Company One")
    comp2 = Company(company_name="IDOR Test Company Two")
    db_session.add_all([comp1, comp2])
    db_session.commit()

    USER_UNASSIGNED = {
        "user_id": 99,
        "email": "user@test.com",
        "role": "supervisor",
        "full_name": "Supervisor Unassigned",
        "company_ids": [],
        "company_id": None,
    }

    app.dependency_overrides[require_business_reader] = lambda: USER_UNASSIGNED
    app.dependency_overrides[require_business_writer] = lambda: USER_UNASSIGNED

    # An unassigned user should receive 403 Forbidden
    res = client.get("/api/v1/transactions")
    assert res.status_code == 403


def test_verified_expense_locked_on_update_and_delete(db_session):
    """
    Verify that an expense marked 'Verified' cannot be deleted.
    """
    comp = Company(company_name="Lock Test Corp")
    db_session.add(comp)
    db_session.flush()

    exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("1000.00"),
        amount_paid=Decimal("1000.00"),
        particulars="Audited Office Expense",
        audit_status="Verified",
        audited_by="Senior Auditor",
    )
    db_session.add(exp)
    db_session.commit()
    eid = exp.expense_id

    # Deleting verified expense must fail with 409 Conflict
    del_res = client.delete(f"/api/v1/transactions/exp_{eid}")
    assert del_res.status_code == 409
    assert "Verified" in del_res.json()["detail"]


def test_verified_bill_payment_locked_against_delete(db_session):
    """
    Verify that deleting a bill payment whose funding expense is Verified
    raises HTTP 409 Conflict.
    """
    comp = Company(company_name="Bills Cascade Corp")
    db_session.add(comp)
    db_session.flush()

    bank = BankAccount(
        id="acc-test-bills-1",
        bank_name="BDO",
        account_name="Bills Account",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("20000.00"),
        current_balance=Decimal("20000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    bills_svc = BillsService(db_session)
    bill = bills_svc.create_bill(
        BillCreate(
            company_id=comp.company_id,
            bill_name="PLDT Enterprise",
            amount=Decimal("8000.00"),
            due_date=date.today(),
            recurring="monthly",
        )
    )

    bills_svc.record_payment(
        bill.bill_id,
        BillPaymentCreate(
            payment_date=date.today(),
            amount=Decimal("8000.00"),
            payment_method="Bank Transfer",
            funding_source="bank",
            bank_account_id=bank.id,
        ),
    )

    # Find the linked expense and lock it as Verified
    pmt = db_session.query(BillPayment).filter(BillPayment.bill_id == bill.bill_id).first()
    assert pmt is not None
    exp = db_session.query(Expense).filter(Expense.expense_id == pmt.expense_id).first()
    assert exp is not None
    exp.audit_status = "Verified"
    db_session.commit()

    # Attempt to delete payment
    with pytest.raises(HTTPException) as exc_info:
        bills_svc.delete_payment(bill.bill_id, pmt.bill_payment_id)
    assert exc_info.value.status_code == 409
    assert "Verified" in exc_info.value.detail


def test_loan_audit_status_and_sale_date(db_session):
    """
    Test that loans return Pending Audit (no auto-audit) and borrower bank is attached.
    """
    borrower = Company(company_name="Borrower Corp")
    lender = Company(company_name="Lender Corp")
    db_session.add_all([borrower, lender])
    db_session.flush()

    borrower_bank = BankAccount(
        id="acc-borrower-1",
        bank_name="BDO",
        account_name="Borrower Main",
        company_name=borrower.company_name,
        company_id=borrower.company_id,
        starting_balance=Decimal("10000.00"),
        current_balance=Decimal("10000.00"),
    )
    db_session.add(borrower_bank)
    db_session.flush()

    loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        principal_amount=Decimal("50000.00"),
        loan_date=date.today(),
        status="disbursed",
        description="Intercompany working capital loan",
        audit_reviewed_by="Auditor General",
        audit_remark="Approved and audited against bank transfer voucher",
    )
    db_session.add(loan)
    db_session.commit()

    res = client.get(f"/api/v1/transactions?type=loan&company_id={borrower.company_id}")
    assert res.status_code == 200
    items = res.json()
    assert len(items) > 0
    loan_tx = items[0]
    assert loan_tx["auditStatus"] == "Pending Audit"
    assert loan_tx["saleDate"] is not None
    assert loan_tx["bankAccountId"] == "acc-borrower-1"


def test_normal_expense_delete_delegation(db_session):
    """
    Verify DELETE /api/v1/transactions/exp_{id} delegates cleanly without NameError,
    removes the expense, and purges linked bank entries.
    """
    comp = Company(company_name="Exp Delete Test Corp")
    db_session.add(comp)
    db_session.flush()

    bank = BankAccount(
        id="acc-exp-del-1",
        bank_name="BPI",
        account_name="Exp Main",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("20000.00"),
        current_balance=Decimal("20000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("1200.00"),
        amount_paid=Decimal("1200.00"),
        particulars="Office Chairs",
        bank_account_id=bank.id,
        payment_method="Bank Transfer",
        audit_status="Pending Audit",
    )
    db_session.add(exp)
    db_session.flush()

    bt = BankTransaction(
        id="tx-exp-del-linked-1",
        bank_account_id=bank.id,
        source_expense_id=exp.expense_id,
        withdrawal=Decimal("1200.00"),
        deposit=Decimal("0.00"),
        particulars="Office Chairs expense",
        transaction_date=date.today().strftime("%m/%d/%y"),
    )
    db_session.add(bt)
    db_session.commit()

    # Call DELETE /api/v1/transactions/exp_{id}
    res = client.delete(f"/api/v1/transactions/exp_{exp.expense_id}")
    assert res.status_code == 200

    # Ensure expense is deleted from DB and linked bank entry purged
    assert db_session.query(Expense).filter(Expense.expense_id == exp.expense_id).first() is None
    assert db_session.query(BankTransaction).filter(BankTransaction.source_expense_id == exp.expense_id).first() is None


def test_loan_status_filter_excludes_undisbursed(db_session):
    """
    Blocker 2 test: Undisbursed loans (Pending Approval, Approved not disbursed)
    must be excluded from the ledger cash movements.
    """
    borrower = Company(company_name="Loan Status Borrower Corp")
    lender = Company(company_name="Loan Status Lender Corp")
    db_session.add_all([borrower, lender])
    db_session.flush()

    # Undisbursed loan
    undisbursed_loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        principal_amount=Decimal("100000.00"),
        loan_date=date.today(),
        status="Pending Approval",
        description="Pending Loan Request",
    )
    # Disbursed loan
    disbursed_loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        principal_amount=Decimal("50000.00"),
        loan_date=date.today(),
        status="Disbursed",
        description="Disbursed Working Capital",
    )
    db_session.add_all([undisbursed_loan, disbursed_loan])
    db_session.commit()

    res = client.get(f"/api/v1/transactions?type=loan&company_id={borrower.company_id}")
    assert res.status_code == 200
    items = res.json()
    item_ids = [it["id"] for it in items]
    assert f"loan_{disbursed_loan.loan_id}" in item_ids
    assert f"loan_{undisbursed_loan.loan_id}" not in item_ids


def test_tenant_lease_payment_excludes_missed_and_formats_id(db_session):
    """
    Blocker 3 test: Tenant lease payments with status 'Missed' or amount 0 are excluded,
    and row ID is formatted as tenant_lease_{lease_id}_pmt_{pmt_id}.
    """
    comp = Company(company_name="Tenant Test Corp")
    db_session.add(comp)
    db_session.flush()

    lease = TenantLease(
        company_id=comp.company_id,
        tenant_name="Tenant Alpha",
        unit_name="Unit 101",
        tenant_ref=f"TNT-TEST-{int(datetime.now().timestamp() * 1000)}",
        rent_amount=Decimal("15000.00"),
        contract_date=date.today(),
        due_date=date.today(),
        total_amount_payable=Decimal("15000.00"),
        status="Active",
    )
    db_session.add(lease)
    db_session.flush()

    # Valid cash payment
    valid_pmt = TenantLeasePayment(
        lease_id=lease.lease_id,
        amount=Decimal("15000.00"),
        payment_date=date.today(),
        method="Cash",
        status="Paid",
        sale_id=None,
    )
    # Missed mark payment
    missed_pmt = TenantLeasePayment(
        lease_id=lease.lease_id,
        amount=Decimal("0.00"),
        payment_date=date.today(),
        method="Cash",
        status="Missed",
        sale_id=None,
    )
    db_session.add_all([valid_pmt, missed_pmt])
    db_session.commit()

    res = client.get(f"/api/v1/transactions?type=income&company_id={comp.company_id}")
    assert res.status_code == 200
    items = res.json()

    expected_id = f"tenant_lease_{lease.lease_id}_pmt_{valid_pmt.payment_id}"
    item_ids = [it["id"] for it in items]
    assert expected_id in item_ids
    assert not any(f"pmt_{missed_pmt.payment_id}" in it_id for it_id in item_ids)


def test_petty_cash_disbursement_excluded_from_ledger(db_session):
    """
    Major 1 test: Petty cash disbursements are excluded to prevent double counting
    with Section 2 Expenses.
    """
    comp = Company(company_name="Petty Dedup Test Corp")
    db_session.add(comp)
    db_session.flush()

    # Disbursement row (already in Expenses)
    disb = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="disbursement",
        amount=Decimal("800.00"),
        topup_date=date.today(),
        status="Reimbursed",
        description="Office Supplies Disbursement",
    )
    # Valid topup row
    topup = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="topup",
        amount=Decimal("5000.00"),
        topup_date=date.today(),
        status="Settled",
        description="Operating Float Topup",
    )
    db_session.add_all([disb, topup])
    db_session.commit()

    res = client.get(f"/api/v1/transactions?type=petty_cash&company_id={comp.company_id}")
    assert res.status_code == 200
    items = res.json()
    item_ids = [it["id"] for it in items]
    assert f"petty_{topup.topup_id}" in item_ids
    assert f"petty_{disb.topup_id}" not in item_ids


def test_loan_repayment_delete_rejected(db_session):
    """
    Verify that DELETE /api/v1/transactions/loan_rep_... returns 400.
    """
    res = client.delete("/api/v1/transactions/loan_rep_999:lender")
    assert res.status_code == 400
    assert "Loan repayments cannot be deleted directly" in res.json()["detail"]


def test_pending_loan_delete_permitted_and_disbursed_rejected(db_session):
    """
    Verify pending loans can be deleted, but approved/disbursed loans return 400.
    """
    borrower = Company(company_name="Loan Del Borrower Corp")
    lender = Company(company_name="Loan Del Lender Corp")
    db_session.add_all([borrower, lender])
    db_session.flush()

    pending_loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        principal_amount=Decimal("30000.00"),
        loan_date=date.today(),
        status="Pending Approval",
        description="Pending Loan Request",
    )
    disbursed_loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        principal_amount=Decimal("40000.00"),
        loan_date=date.today(),
        status="Disbursed",
        description="Disbursed Loan",
    )
    db_session.add_all([pending_loan, disbursed_loan])
    db_session.commit()

    # Deleting pending loan succeeds
    res_pending = client.delete(f"/api/v1/transactions/loan_{pending_loan.loan_id}")
    assert res_pending.status_code == 200

    # Deleting disbursed loan is rejected with 400
    res_disbursed = client.delete(f"/api/v1/transactions/loan_{disbursed_loan.loan_id}")
    assert res_disbursed.status_code == 400


def _supervisor_for(company_id):
    return {
        "user_id": 77,
        "email": "sup@test.com",
        "role": "supervisor",
        "full_name": "Scoped Supervisor",
        "company_ids": [company_id],
        "company_id": company_id,
    }


def test_restricted_user_without_company_filter_does_not_see_counterparty_loan_rows(db_session):
    """Review Blocker 1: lender side rows of another company must not leak to a borrower only user."""
    borrower = Company(company_name="Leak Borrower Test Corp")
    lender = Company(company_name="Leak Lender Test Corp")
    db_session.add_all([borrower, lender])
    db_session.flush()
    loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        principal_amount=Decimal("10000.00"),
        loan_date=date.today(),
        status="Disbursed",
        description="Scope isolation loan",
    )
    db_session.add(loan)
    db_session.commit()

    user = _supervisor_for(borrower.company_id)
    app.dependency_overrides[require_business_reader] = lambda: user

    res = client.get("/api/v1/transactions?type=loan")
    assert res.status_code == 200
    ids = [it["id"] for it in res.json()]
    assert f"loan_{loan.loan_id}" in ids
    assert f"loan_{loan.loan_id}:lender" not in ids
    assert not any(i.startswith("loan_rep_") for i in ids)


def test_petty_cash_status_mapping_and_cross_company_split(db_session):
    """Review Blocker 2: approved topups are Paid with a bank withdrawal, cancelled are hidden,
    and a funder only sees its own withdrawal for a cross company funding."""
    funder = Company(company_name="Petty Funder Test Corp")
    recipient = Company(company_name="Petty Recipient Test Corp")
    db_session.add_all([funder, recipient])
    db_session.flush()
    bank = BankAccount(
        id="acc-test-petty-funder",
        bank_name="BDO",
        account_name="Funder Main",
        company_name=funder.company_name,
        company_id=funder.company_id,
        starting_balance=Decimal("50000.00"),
        current_balance=Decimal("50000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    approved = PettyCashTopUp(
        company_id=funder.company_id, request_type="topup", amount=Decimal("1000.00"),
        topup_date=date.today(), status="Approved", description="Approved own topup",
        bank_account_id=bank.id, reviewed_by="Auditor",
    )
    cancelled = PettyCashTopUp(
        company_id=funder.company_id, request_type="topup", amount=Decimal("700.00"),
        topup_date=date.today(), status="Cancelled", description="Cancelled topup",
        bank_account_id=bank.id,
    )
    in_transit = PettyCashTopUp(
        company_id=funder.company_id, request_type="topup", amount=Decimal("500.00"),
        topup_date=date.today(), status="Transfer In Transit", description="Transit topup",
        bank_account_id=bank.id,
    )
    return_pending = PettyCashTopUp(
        company_id=funder.company_id, request_type="topup", amount=Decimal("300.00"),
        topup_date=date.today(), status="Return Pending", description="Return topup",
        bank_account_id=bank.id,
    )
    cross = PettyCashTopUp(
        company_id=recipient.company_id, request_type="topup", amount=Decimal("2000.00"),
        topup_date=date.today(), status="Approved", description="Cross company funding",
        bank_account_id=bank.id, reviewed_by="Auditor",
    )
    db_session.add_all([approved, cancelled, in_transit, return_pending, cross])
    db_session.commit()

    res = client.get(f"/api/v1/transactions?type=petty_cash&company_id={funder.company_id}")
    assert res.status_code == 200
    by_id = {it["id"]: it for it in res.json()}

    assert by_id[f"petty_{approved.topup_id}"]["status"] == "Paid"
    assert by_id[f"petty_{approved.topup_id}"]["withdrawal"] == 1000.0
    assert by_id[f"petty_{approved.topup_id}"]["awaitingAudit"] is False
    assert f"petty_{cancelled.topup_id}" not in by_id
    for row in (in_transit, return_pending):
        item = by_id[f"petty_{row.topup_id}"]
        assert item["withdrawal"] == float(row.amount)
        assert item["awaitingAudit"] is False
    # Funder sees the cross company withdrawal under its own name and bank
    cross_item = by_id[f"petty_{cross.topup_id}"]
    assert cross_item["company"] == funder.company_name
    assert cross_item["bankAccountId"] == bank.id

    # Recipient only user sees the row without the funder bank
    app.dependency_overrides[require_business_reader] = lambda: _supervisor_for(recipient.company_id)
    res2 = client.get("/api/v1/transactions?type=petty_cash")
    assert res2.status_code == 200
    rec_items = {it["id"]: it for it in res2.json()}
    assert f"petty_{cross.topup_id}" in rec_items
    assert rec_items[f"petty_{cross.topup_id}"]["bankAccountId"] is None
    assert rec_items[f"petty_{cross.topup_id}"]["withdrawal"] == 0.0
    assert f"petty_{approved.topup_id}" not in rec_items


def test_transactions_offset_and_limit_are_applied(db_session):
    """Review Major: bounded paging, offset is honoured."""
    comp = Company(company_name="Paging Test Corp")
    db_session.add(comp)
    db_session.flush()
    for i in range(3):
        db_session.add(Expense(
            company_id=comp.company_id, expense_date=date.today(), amount=Decimal("10.00"),
            amount_paid=Decimal("10.00"), particulars=f"Paging {i}", audit_status="Pending Audit",
        ))
    db_session.commit()

    full = client.get(f"/api/v1/transactions?type=expense&company_id={comp.company_id}").json()
    page = client.get(f"/api/v1/transactions?type=expense&company_id={comp.company_id}&limit=1&offset=1").json()
    assert len(full) == 3
    assert [p["id"] for p in page] == [full[1]["id"]]


def test_delete_bill_rolls_back_everything_when_a_payment_cleanup_fails(db_session, monkeypatch):
    """Review Major: bill deletion is atomic, a failure mid loop leaves bill, payments and expenses intact."""
    comp = Company(company_name="Bills Atomic Test Corp")
    db_session.add(comp)
    db_session.flush()
    bank = BankAccount(
        id="acc-test-bills-atomic",
        bank_name="BDO",
        account_name="Atomic Account",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("50000.00"),
        current_balance=Decimal("50000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    svc = BillsService(db_session)
    bill = svc.create_bill(BillCreate(
        company_id=comp.company_id, bill_name="Atomic Bill", amount=Decimal("4000.00"),
        due_date=date.today(), recurring="monthly",
    ))
    for _ in range(2):
        svc.record_payment(bill.bill_id, BillPaymentCreate(
            payment_date=date.today(), amount=Decimal("1000.00"),
            payment_method="Bank Transfer", funding_source="bank", bank_account_id=bank.id,
        ))
    bill_id = bill.bill_id
    expense_ids = [p.expense_id for p in db_session.query(BillPayment).filter(BillPayment.bill_id == bill_id).all()]
    assert len(expense_ids) == 2

    calls = {"n": 0}
    original = BankService.purge_linked_entries

    def flaky(self, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("simulated bank purge failure")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(BankService, "purge_linked_entries", flaky)

    with pytest.raises(RuntimeError):
        BillsService(db_session).delete_bill(bill_id)

    db_session.expire_all()
    assert db_session.query(Bill).filter(Bill.bill_id == bill_id).first() is not None
    assert db_session.query(BillPayment).filter(BillPayment.bill_id == bill_id).count() == 2
    assert db_session.query(Expense).filter(Expense.expense_id.in_(expense_ids)).count() == 2

    # And a clean run removes everything
    monkeypatch.setattr(BankService, "purge_linked_entries", original)
    BillsService(db_session).delete_bill(bill_id)
    db_session.expire_all()
    assert db_session.query(Bill).filter(Bill.bill_id == bill_id).first() is None
    assert db_session.query(Expense).filter(Expense.expense_id.in_(expense_ids)).count() == 0


def test_delete_petty_cash_pending_succeeds_and_reviewed_rejected(db_session):
    """Pending petty cash topups can be deleted via transactions endpoint; reviewed ones return 400."""
    comp = Company(company_name="Petty Delete Corp")
    db_session.add(comp)
    db_session.flush()

    pending = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="topup",
        amount=Decimal("1500.00"),
        topup_date=date.today(),
        status="Pending Finance Endorsement",
        description="Pending topup",
    )
    reviewed = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="topup",
        amount=Decimal("2500.00"),
        topup_date=date.today(),
        status="Approved",
        description="Approved topup",
    )
    db_session.add_all([pending, reviewed])
    db_session.commit()

    res_ok = client.delete(f"/api/v1/transactions/petty_{pending.topup_id}")
    assert res_ok.status_code == 200
    assert db_session.query(PettyCashTopUp).filter(PettyCashTopUp.topup_id == pending.topup_id).first() is None

    res_err = client.delete(f"/api/v1/transactions/petty_{reviewed.topup_id}")
    assert res_err.status_code == 400


def test_delete_manual_bank_tx_cross_company_403_and_verified_409(db_session):
    """Manual bank transaction deletion rejects wrong-company users (403) and Verified entries (409)."""
    comp_a = Company(company_name="Bank Guard Alpha")
    comp_b = Company(company_name="Bank Guard Beta")
    db_session.add_all([comp_a, comp_b])
    db_session.flush()

    bank_a = BankAccount(
        id="acc-test-guard-a",
        bank_name="BPI",
        account_name="Alpha Main",
        company_name=comp_a.company_name,
        company_id=comp_a.company_id,
        starting_balance=Decimal("10000.00"),
        current_balance=Decimal("10000.00"),
    )
    db_session.add(bank_a)
    db_session.flush()

    bt_pending = BankTransaction(
        id="tx-guard-pending-1",
        bank_account_id=bank_a.id,
        company_name=comp_a.company_name,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Manual bank deposit",
        deposit=Decimal("500.00"),
        withdrawal=Decimal("0.00"),
        audit_status="Pending Audit",
    )
    bt_verified = BankTransaction(
        id="tx-guard-verified-1",
        bank_account_id=bank_a.id,
        company_name=comp_a.company_name,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Verified manual deposit",
        deposit=Decimal("800.00"),
        withdrawal=Decimal("0.00"),
        audit_status="Verified",
    )
    db_session.add_all([bt_pending, bt_verified])
    db_session.commit()

    # Wrong-company supervisor gets 403
    user_b = _supervisor_for(comp_b.company_id)
    app.dependency_overrides[require_business_writer] = lambda: user_b
    res_403 = client.delete(f"/api/v1/transactions/{bt_pending.id}")
    assert res_403.status_code == 403

    # Verified transaction gets 409 even for authorized owner
    app.dependency_overrides[require_business_writer] = lambda: ADMIN_USER
    res_409 = client.delete(f"/api/v1/transactions/{bt_verified.id}")
    assert res_409.status_code == 409


def test_delete_linked_sale_and_lending_expense_rejected(db_session):
    """Linked Tenant sale and Lending release expense return HTTP 409 when deleted via /transactions."""
    comp = Company(company_name="Linked Guard Corp")
    db_session.add(comp)
    db_session.flush()

    linked_sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("6000.00"),
        particulars="Tenant rent sale [Paid]",
        payment_status="Paid",
        deposit_status="Deposited",
        audit_status="Pending Audit",
    )
    db_session.add(linked_sale)
    db_session.flush()

    lease = TenantLease(
        company_id=comp.company_id,
        tenant_ref=f"TNT-LINK-{int(datetime.now().timestamp() * 1000)}",
        tenant_name="Tenant Linked",
        unit_name="Unit B",
        rent_amount=Decimal("6000.00"),
        contract_date=date.today(),
        due_date=date.today(),
        total_amount_payable=Decimal("6000.00"),
        status="Active",
    )
    db_session.add(lease)
    db_session.flush()

    pmt = TenantLeasePayment(
        lease_id=lease.lease_id,
        payment_date=date.today(),
        amount=Decimal("6000.00"),
        method="Cash",
        status="Paid",
        sale_id=linked_sale.sales_id,
    )
    db_session.add(pmt)

    lending_exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("3000.00"),
        amount_paid=Decimal("3000.00"),
        particulars="Loan release",
        description="Loan release",
        payment_method="Cash",
        audit_status="Pending Audit",
    )
    db_session.add(lending_exp)
    db_session.flush()

    borrower = Borrower(
        borrower_ref_no=f"BRW-LINK-{int(datetime.now().timestamp() * 1000)}",
        borrower_name="Test Lending Borrower",
        principal_amount=Decimal("3000.00"),
        total_payable=Decimal("3600.00"),
        remaining_balance=Decimal("3600.00"),
        date_borrowed=date.today(),
        due_date=date.today() + timedelta(days=30),
        release_expense_id=lending_exp.expense_id,
    )
    db_session.add(borrower)
    db_session.commit()

    res_sale = client.delete(f"/api/v1/transactions/sale_{linked_sale.sales_id}")
    assert res_sale.status_code == 409

    res_exp = client.delete(f"/api/v1/transactions/exp_{lending_exp.expense_id}")
    assert res_exp.status_code == 409


def test_list_transactions_query_filters_search_audit_status_and_dates(db_session):
    """GET /api/v1/transactions honors search, audit_status, start_date, end_date, and X-Total-Count."""
    comp = Company(company_name="Filter Query Corp")
    db_session.add(comp)
    db_session.flush()

    d_old = date.today() - timedelta(days=10)
    d_mid = date.today() - timedelta(days=2)
    s_match = Sale(
        company_id=comp.company_id,
        transaction_date=d_mid,
        amount=Decimal("450.00"),
        particulars="Match Keyword Coffee [Paid]",
        payment_status="Paid",
        deposit_status="Deposited",
        audit_status="Verified",
    )
    s_other_status = Sale(
        company_id=comp.company_id,
        transaction_date=d_mid,
        amount=Decimal("200.00"),
        particulars="Match Keyword Tea [Paid]",
        payment_status="Paid",
        deposit_status="Deposited",
        audit_status="Pending Audit",
    )
    s_old = Sale(
        company_id=comp.company_id,
        transaction_date=d_old,
        amount=Decimal("100.00"),
        particulars="Match Keyword Old [Paid]",
        payment_status="Paid",
        deposit_status="Deposited",
        audit_status="Verified",
    )
    db_session.add_all([s_match, s_other_status, s_old])
    db_session.commit()

    res = client.get(
        f"/api/v1/transactions?company_id={comp.company_id}&search=Keyword&audit_status=Verified"
        f"&start_date={(date.today() - timedelta(days=5)).isoformat()}&end_date={date.today().isoformat()}"
    )
    assert res.status_code == 200
    assert res.headers.get("X-Total-Count") == "1"
    data = res.json()
    assert [it["id"] for it in data] == [f"sale_{s_match.sales_id}"]


def test_petty_cash_reimbursed_vs_unsettled_and_bank_reimbursement_expense_dedup(db_session):
    """Reimbursed bank-funded claims appear once (Section 3), unsettled or petty_cash claims are hidden,
    and paired Bank Reimbursement expenses do not duplicate in Section 2."""
    comp = Company(company_name="Petty Reimb Corp")
    db_session.add(comp)
    db_session.flush()
    bank = BankAccount(
        id="acc-test-reimb-1",
        bank_name="BDO",
        account_name="Reimb Main",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("25000.00"),
        current_balance=Decimal("25000.00"),
    )
    db_session.add(bank)
    db_session.flush()

    reimbursed = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="reimbursement",
        amount=Decimal("900.00"),
        topup_date=date.today(),
        status="Reimbursed",
        payment_method_option="bank",
        bank_account_id=bank.id,
        description="Reimbursed fuel claim",
    )
    unsettled = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="reimbursement",
        amount=Decimal("400.00"),
        topup_date=date.today(),
        status="Approved",
        payment_method_option="bank",
        bank_account_id=bank.id,
        description="Unsettled approved reimbursement",
    )
    pc_funded = PettyCashTopUp(
        company_id=comp.company_id,
        request_type="reimbursement",
        amount=Decimal("250.00"),
        topup_date=date.today(),
        status="Reimbursed",
        payment_method_option="petty_cash",
        description="Petty cash funded reimbursement",
    )
    db_session.add_all([reimbursed, unsettled, pc_funded])
    db_session.flush()

    paired_exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("900.00"),
        amount_paid=Decimal("900.00"),
        particulars="Bank Reimbursement fuel claim",
        description="Bank Reimbursement fuel claim",
        payment_method="Bank Reimbursement",
        bank_account_id=bank.id,
        linked_topup_id=reimbursed.topup_id,
        audit_status="Pending Audit",
    )
    db_session.add(paired_exp)
    db_session.commit()

    res = client.get(f"/api/v1/transactions?company_id={comp.company_id}")
    assert res.status_code == 200
    ids = [it["id"] for it in res.json()]
    assert f"petty_{reimbursed.topup_id}" in ids
    assert f"petty_{unsettled.topup_id}" not in ids
    assert f"petty_{pc_funded.topup_id}" not in ids
    assert f"exp_{paired_exp.expense_id}" not in ids


def test_section4_intercompany_dedup_and_shared_bank_null_company_isolation(db_session):
    """Intercompany bank transfers and null-company entries on shared accounts are excluded for primary owner."""
    comp_primary = Company(company_name="Shared Primary Corp")
    comp_co = Company(company_name="Shared CoOwner Corp")
    db_session.add_all([comp_primary, comp_co])
    db_session.flush()

    shared_bank = BankAccount(
        id="acc-test-shared-sec4",
        bank_name="BPI",
        account_name="Shared Ops",
        company_name=comp_primary.company_name,
        company_id=comp_primary.company_id,
        starting_balance=Decimal("30000.00"),
        current_balance=Decimal("30000.00"),
    )
    shared_bank.company_names = [comp_primary.company_name, comp_co.company_name]
    db_session.add(shared_bank)
    db_session.flush()

    bt_ic_transfer = BankTransaction(
        id="tx-sec4-ic-1",
        bank_account_id=shared_bank.id,
        company_name=comp_primary.company_name,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Intercompany Transfer to Shared CoOwner Corp",
        withdrawal=Decimal("1000.00"),
        deposit=Decimal("0.00"),
        category="Bank Transfer",
    )
    bt_ic_repay = BankTransaction(
        id="tx-sec4-ic-2",
        bank_account_id=shared_bank.id,
        company_name=comp_primary.company_name,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Intercompany Repayment from Shared CoOwner Corp",
        deposit=Decimal("1000.00"),
        withdrawal=Decimal("0.00"),
        category="Bank Transfer",
    )
    bt_null_shared = BankTransaction(
        id="tx-sec4-null-shared",
        bank_account_id=shared_bank.id,
        company_name=None,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Unlabelled shared entry",
        deposit=Decimal("500.00"),
        withdrawal=Decimal("0.00"),
        category="Deposit",
    )
    bt_labelled_primary = BankTransaction(
        id="tx-sec4-primary-ok",
        bank_account_id=shared_bank.id,
        company_name=comp_primary.company_name,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Manual labelled deposit",
        deposit=Decimal("750.00"),
        withdrawal=Decimal("0.00"),
        category="Deposit",
    )
    db_session.add_all([bt_ic_transfer, bt_ic_repay, bt_null_shared, bt_labelled_primary])
    db_session.commit()

    if entry_source_supported(db_session):
        db_session.execute(
            text("UPDATE bank_transactions SET entry_source = 'manual' WHERE id = :id"),
            {"id": bt_labelled_primary.id},
        )
        db_session.commit()

    res = client.get(f"/api/v1/transactions?type=bank&company_id={comp_primary.company_id}")
    assert res.status_code == 200
    ids = [it["id"] for it in res.json()]
    assert bt_labelled_primary.id in ids
    assert bt_ic_transfer.id not in ids
    assert bt_ic_repay.id not in ids
    assert bt_null_shared.id not in ids


def test_sales_receivables_sync_partial_delete_resets_audit_metadata(db_session, monkeypatch):
    """Partial deletion of one receivable line on a Flagged multi-line sale resets audit_status to Pending Audit
    and clears stale auditor metadata, while Verified sales raise 409."""
    comp = Company(company_name="Sync Audit Reset Corp")
    db_session.add(comp)
    db_session.flush()

    sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("300.00"),
        particulars="Burger - 100.00 [Unpaid]\nPasta - 200.00 [Unpaid]",
        payment_status="Unpaid",
        deposit_status="Not Deposited",
        audit_status="Flagged",
        audited_by="Auditor A",
        audited_at=datetime.now(timezone.utc),
        audit_remarks="Check receipt",
    )
    db_session.add(sale)
    db_session.flush()

    rec1 = Receivable(
        company_id=comp.company_id,
        company_name=comp.company_name,
        customer_name="Alice",
        customer_type="External",
        sale_id=sale.sales_id,
        sale_line_index=0,
        transaction_date=date.today(),
        items_summary="Burger",
        total_amount=Decimal("100.00"),
        amount_paid=Decimal("0.00"),
        balance=Decimal("100.00"),
        payment_status="Unpaid",
    )
    rec2 = Receivable(
        company_id=comp.company_id,
        company_name=comp.company_name,
        customer_name="Bob",
        customer_type="External",
        sale_id=sale.sales_id,
        sale_line_index=1,
        transaction_date=date.today(),
        items_summary="Pasta",
        total_amount=Decimal("200.00"),
        amount_paid=Decimal("0.00"),
        balance=Decimal("200.00"),
        payment_status="Unpaid",
    )
    db_session.add_all([rec1, rec2])
    db_session.commit()

    sync_svc = SalesReceivablesSyncService(db_session)
    monkeypatch.setattr(sync_svc, "_get_supabase_client", lambda: None)

    sync_svc.sync_receivable_to_sale(rec1, deleted=True)
    db_session.flush()
    db_session.refresh(sale)
    assert sale.audit_status == "Pending Audit"
    assert sale.audited_by is None
    assert sale.audited_at is None
    assert sale.audit_remarks is None
    assert float(sale.amount) == 200.0

    # Verified parent sale must reject deletion with 409
    sale.audit_status = "Verified"
    db_session.flush()
    with pytest.raises(HTTPException) as exc_info:
        sync_svc.sync_receivable_to_sale(rec2, deleted=True)
    assert exc_info.value.status_code == 409
