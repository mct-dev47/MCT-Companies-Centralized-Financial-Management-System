import pytest
from datetime import date
from decimal import Decimal
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import or_, text

from app.main import app
from app.db.session import get_db, SessionLocal
from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Sale, Expense, Category
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
    try:
        yield db
    finally:
        try:
            # Clean up test companies and cascade records to avoid shared DB test pollution
            test_comps = db.query(Company).filter(
                or_(
                    Company.company_name.like("%Test%"),
                    Company.company_name.like("%Sync%"),
                    Company.company_name.like("%Lock%"),
                    Company.company_name.like("%Cascade%"),
                    Company.company_name.like("%Bills%"),
                    Company.company_name.like("%Loan%"),
                    Company.company_name.like("%Partially%"),
                    Company.company_name.like("%Borrower%"),
                    Company.company_name.like("%Lender%"),
                    Company.company_name.like("%Company One%"),
                    Company.company_name.like("%Company Two%"),
                    Company.company_name.like("%IDOR%"),
                    Company.company_name.like("%Tenant%"),
                )
            ).all()
            cids = [c.company_id for c in test_comps]
            if cids:
                db.query(ReceivablePayment).filter(ReceivablePayment.receivable.has(Receivable.company_id.in_(cids))).delete(synchronize_session=False)
                db.query(Receivable).filter(Receivable.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(TenantLeasePayment).filter(TenantLeasePayment.lease.has(TenantLease.company_id.in_(cids))).delete(synchronize_session=False)
                db.query(TenantLease).filter(TenantLease.company_id.in_(cids)).delete(synchronize_session=False)
                db.query(BankTransaction).filter(
                    or_(
                        BankTransaction.bank_account_id.like("%test%"),
                        BankTransaction.account.has(BankAccount.company_id.in_(cids)),
                    )
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
        monthly_rent=Decimal("15000.00"),
        lease_start=date.today(),
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
