import pytest
from datetime import date
from decimal import Decimal
from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Sale, Expense
from app.models.bills import Bill, BillPayment
from app.models.receivable import Receivable, ReceivablePayment
from app.models.loan import Loan, LoanRepayment
from app.models.lending import Borrower, LendingTransaction
from app.models.tenant import TenantLease, TenantLeasePayment
from app.models.petty_cash import PettyCashTopUp
from app.core.dependencies import (
    require_business_reader,
    require_business_writer,
    require_auditor_user,
)


client = TestClient(app)

AUDITOR_USER = {
    "user_id": 99,
    "email": "auditor@mct.com",
    "role": "audit",
    "full_name": "Chief Auditor",
    "company_ids": [],
    "company_id": None,
    "is_admin": True,
}


@pytest.fixture(autouse=True)
def override_deps():
    old_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[require_business_reader] = lambda: AUDITOR_USER
    app.dependency_overrides[require_business_writer] = lambda: AUDITOR_USER
    app.dependency_overrides[require_auditor_user] = lambda: AUDITOR_USER
    yield
    app.dependency_overrides.clear()
    app.dependency_overrides.update(old_overrides)


@pytest.fixture()
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _seed_company_and_bank(db, name: str, bank_id: str):
    comp = Company(company_name=name)
    db.add(comp)
    db.flush()
    bank = BankAccount(
        id=bank_id,
        bank_name="BDO",
        account_name=f"{name} Main",
        company_name=comp.company_name,
        company_id=comp.company_id,
        starting_balance=Decimal("100000.00"),
        current_balance=Decimal("100000.00"),
    )
    db.add(bank)
    db.flush()
    return comp, bank


def test_bills_audit_syncs_with_transactions_and_bank(db_session):
    comp, bank = _seed_company_and_bank(db_session, "Bills Sync Corp", "acc-bills-1")
    exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("1500.00"),
        amount_paid=Decimal("1500.00"),
        particulars="Electric Bill",
        payment_method="Bank Transfer",
        bank_account_id=bank.id,
        audit_status="Pending Audit",
    )
    db_session.add(exp)
    db_session.flush()

    btx = BankTransaction(
        id="tx-bill-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Electric Bill",
        withdrawal=Decimal("1500.00"),
        deposit=Decimal("0.00"),
        net_amount=Decimal("1500.00"),
        source_expense_id=exp.expense_id,
        company_name=comp.company_name,
    )
    db_session.add(btx)

    bill = Bill(
        company_id=comp.company_id,
        bill_name="Meralco",
        amount=Decimal("1500.00"),
        due_date=date.today(),
        status="paid",
    )
    db_session.add(bill)
    db_session.flush()

    bp = BillPayment(
        bill_id=bill.bill_id,
        period_key=date.today().strftime("%Y-%m"),
        payment_date=date.today(),
        amount=Decimal("1500.00"),
        payment_method="Bank Transfer",
        bank_account_id=bank.id,
        expense_id=exp.expense_id,
    )
    db_session.add(bp)
    db_session.commit()

    # 1. Mark audited on Bills -> reflected on Expense, Bank, Transactions
    res = client.patch(f"/api/v1/bills/{bill.bill_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    assert res.json()["audit_status"] == "Verified"

    db_session.refresh(exp)
    db_session.refresh(btx)
    assert exp.audit_status == "Verified"
    assert btx.audit_status == "Verified"

    txs = client.get(f"/api/v1/transactions?company_id={comp.company_id}").json()
    exp_tx = next(t for t in txs if t["id"] == f"exp_{exp.expense_id}")
    assert exp_tx["auditStatus"] == "Verified"

    # 2. Reset via Bank -> reflected on Bill and Expense
    res = client.patch(f"/api/v1/bank-accounts/transactions/{btx.id}/audit", json={"audit_status": "Pending Audit"})
    assert res.status_code == 200
    db_session.refresh(bill)
    db_session.refresh(exp)
    assert bill.audit_status == "Pending Audit"
    assert exp.audit_status == "Pending Audit"

    # 3. Mark audited via Expense (Transaction page) -> reflected on Bill and Bank
    res = client.patch(f"/api/v1/expenses/{exp.expense_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(bill)
    db_session.refresh(btx)
    assert bill.audit_status == "Verified"
    assert btx.audit_status == "Verified"


def test_receivables_audit_syncs_with_transactions_and_bank(db_session):
    comp, bank = _seed_company_and_bank(db_session, "Rec Sync Corp", "acc-rec-1")
    rec = Receivable(
        company_id=comp.company_id,
        company_name=comp.company_name,
        customer_name="Juan Dela Cruz",
        customer_type="External",
        transaction_date=date.today(),
        items_summary="Catering Order",
        total_amount=Decimal("2000.00"),
        amount_paid=Decimal("2000.00"),
        balance=Decimal("0.00"),
        payment_status="Paid",
    )
    db_session.add(rec)
    db_session.flush()

    pmt = ReceivablePayment(
        receivable_id=rec.receivable_id,
        payment_date=date.today(),
        amount=Decimal("2000.00"),
        payment_method="Bank Transfer",
        bank_account_id=bank.id,
    )
    db_session.add(pmt)
    db_session.flush()

    btx = BankTransaction(
        id="tx-rec-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Receivable Payment - Juan Dela Cruz",
        withdrawal=Decimal("0.00"),
        deposit=Decimal("2000.00"),
        net_amount=Decimal("2000.00"),
        source_receivable_payment_id=pmt.payment_id,
        company_name=comp.company_name,
    )
    db_session.add(btx)
    db_session.commit()

    # 1. Audit via Receivables Payment (Transaction page) -> Bank & Receivable
    res = client.patch(f"/api/v1/receivables/payments/{pmt.payment_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(rec)
    db_session.refresh(btx)
    assert rec.audit_status == "Verified"
    assert btx.audit_status == "Verified"

    txs = client.get(f"/api/v1/transactions?company_id={comp.company_id}").json()
    rec_tx = next(t for t in txs if t["id"] == f"rec_pmt_{pmt.payment_id}")
    assert rec_tx["auditStatus"] == "Verified"

    # 2. Flag via Bank -> Receivable
    res = client.patch(f"/api/v1/bank-accounts/transactions/{btx.id}/audit", json={"audit_status": "Flagged", "remarks": "Mismatch"})
    assert res.status_code == 200
    db_session.refresh(rec)
    assert rec.audit_status == "Flagged"


def test_loan_and_repayment_audit_syncs_with_transactions_and_bank(db_session):
    borrower, b_bank = _seed_company_and_bank(db_session, "Loan Bor Corp", "acc-loan-b")
    lender, l_bank = _seed_company_and_bank(db_session, "Loan Len Corp", "acc-loan-l")

    loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        loan_ref_no="LN-SYNC-001",
        bank_account_id=l_bank.id,
        borrower_bank_account_id=b_bank.id,
        principal_amount=Decimal("10000.00"),
        loan_date=date.today(),
        status="Disbursed",
        description="Working capital",
    )
    db_session.add(loan)
    db_session.flush()

    btx_disb = BankTransaction(
        id="tx-loan-disb-1",
        bank_account_id=b_bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Loan: Working capital",
        withdrawal=Decimal("0.00"),
        deposit=Decimal("10000.00"),
        net_amount=Decimal("10000.00"),
        source_loan_id=loan.loan_id,
        company_name=borrower.company_name,
    )
    db_session.add(btx_disb)
    db_session.commit()

    # 1. Audit Loan -> Bank & Transactions
    res = client.patch(f"/api/v1/loans/{loan.loan_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(btx_disb)
    assert btx_disb.audit_status == "Verified"

    txs = client.get(f"/api/v1/transactions?company_id={borrower.company_id}").json()
    ln_tx = next(t for t in txs if t["id"] == f"loan_{loan.loan_id}")
    assert ln_tx["auditStatus"] == "Verified"

    # 2. Reset via Bank -> Loan
    res = client.patch(f"/api/v1/bank-accounts/transactions/{btx_disb.id}/audit", json={"audit_status": "Pending Audit"})
    assert res.status_code == 200
    db_session.refresh(loan)
    assert loan.audit_status == "Pending Audit"


def test_lending_and_tenants_and_petty_cash_audit_syncs(db_session):
    comp, bank = _seed_company_and_bank(db_session, "Multi Sync Corp", "acc-multi-1")

    # Lending
    rel_exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("5000.00"),
        amount_paid=Decimal("5000.00"),
        particulars="Lending Release",
        payment_method="Bank Transfer",
        bank_account_id=bank.id,
    )
    db_session.add(rel_exp)
    db_session.flush()
    btx_lend = BankTransaction(
        id="tx-lend-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Lending Release",
        withdrawal=Decimal("5000.00"),
        deposit=Decimal("0.00"),
        net_amount=Decimal("5000.00"),
        source_expense_id=rel_exp.expense_id,
        company_name=comp.company_name,
    )
    db_session.add(btx_lend)
    bor = Borrower(
        borrower_name="Pedro",
        principal_amount=Decimal("5000.00"),
        total_payable=Decimal("6000.00"),
        remaining_balance=Decimal("6000.00"),
        date_borrowed=date.today(),
        due_date=date.today(),
        bank_account_id=bank.id,
        release_expense_id=rel_exp.expense_id,
    )
    db_session.add(bor)

    # Tenants
    rent_sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("8000.00"),
        particulars="Rent Payment",
        payment_method="Bank Transfer",
        deposit_status="Deposited",
        bank_account_id=bank.id,
    )
    db_session.add(rent_sale)
    db_session.flush()
    btx_rent = BankTransaction(
        id="tx-rent-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Rent Payment",
        withdrawal=Decimal("0.00"),
        deposit=Decimal("8000.00"),
        net_amount=Decimal("8000.00"),
        source_sale_id=rent_sale.sales_id,
        company_name=comp.company_name,
    )
    db_session.add(btx_rent)
    lease = TenantLease(
        tenant_ref="TNT-SYNC-1",
        company_id=comp.company_id,
        tenant_name="Maria",
        unit_name="Unit A",
        rent_amount=Decimal("8000.00"),
        contract_date=date.today(),
        due_date=date.today(),
        total_amount_payable=Decimal("8000.00"),
        bank_account_id=bank.id,
    )
    db_session.add(lease)
    db_session.flush()
    tlp = TenantLeasePayment(
        lease_id=lease.lease_id,
        payment_date=date.today(),
        amount=Decimal("8000.00"),
        method="Bank Transfer",
        sale_id=rent_sale.sales_id,
    )
    db_session.add(tlp)

    # Petty Cash TopUp
    topup = PettyCashTopUp(
        company_id=comp.company_id,
        amount=Decimal("3000.00"),
        topup_date=date.today(),
        description="Petty Cash Replenishment",
        bank_account_id=bank.id,
        status="Approved",
    )
    db_session.add(topup)
    db_session.flush()
    btx_pc = BankTransaction(
        id="tx-pc-1",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Petty Cash Replenishment",
        withdrawal=Decimal("3000.00"),
        deposit=Decimal("0.00"),
        net_amount=Decimal("3000.00"),
        source_topup_id=topup.topup_id,
        company_name=comp.company_name,
    )
    db_session.add(btx_pc)
    db_session.commit()

    # Verify Bank -> Lending
    res = client.patch(f"/api/v1/bank-accounts/transactions/{btx_lend.id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(bor)
    db_session.refresh(rel_exp)
    assert bor.audit_status == "Verified"
    assert rel_exp.audit_status == "Verified"

    # Verify Bank -> TenantLease
    res = client.patch(f"/api/v1/bank-accounts/transactions/{btx_rent.id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(lease)
    db_session.refresh(rent_sale)
    assert lease.audit_status == "Verified"
    assert rent_sale.audit_status == "Verified"

    # Verify PettyCashTopUp -> Bank & Transactions
    res = client.patch(f"/api/v1/petty-cash/topups/{topup.topup_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(btx_pc)
    assert btx_pc.audit_status == "Verified"
    txs = client.get(f"/api/v1/transactions?company_id={comp.company_id}").json()
    pc_tx = next(t for t in txs if t["id"] == f"petty_{topup.topup_id}")
    assert pc_tx["auditStatus"] == "Verified"


def test_loan_repayment_audit_syncs_with_expense_bank_and_transactions(db_session):
    borrower, b_bank = _seed_company_and_bank(db_session, "Repay Bor Corp", "acc-rep-b")
    lender, l_bank = _seed_company_and_bank(db_session, "Repay Len Corp", "acc-rep-l")

    loan = Loan(
        borrower=borrower.company_id,
        lender=lender.company_id,
        loan_ref_no="LN-REP-001",
        bank_account_id=l_bank.id,
        borrower_bank_account_id=b_bank.id,
        principal_amount=Decimal("10000.00"),
        loan_date=date.today(),
        status="Disbursed",
        description="Repayment sync loan",
    )
    db_session.add(loan)
    db_session.flush()

    exp = Expense(
        company_id=borrower.company_id,
        expense_date=date.today(),
        amount=Decimal("2500.00"),
        amount_paid=Decimal("2500.00"),
        particulars="Loan Repayment",
        payment_method="Bank Transfer",
        bank_account_id=b_bank.id,
    )
    db_session.add(exp)
    db_session.flush()

    rep = LoanRepayment(
        loan_id=loan.loan_id,
        payment_date=date.today(),
        remaining_balance=Decimal("7500.00"),
        amount=Decimal("2500.00"),
        expense_id=exp.expense_id,
        bank_account_id=b_bank.id,
    )
    db_session.add(rep)
    db_session.flush()

    btx_lender = BankTransaction(
        id="tx-loan-rep-l",
        bank_account_id=l_bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Loan Repayment Received",
        withdrawal=Decimal("0.00"),
        deposit=Decimal("2500.00"),
        net_amount=Decimal("2500.00"),
        source_loan_repayment_id=rep.loan_repayment_id,
        company_name=lender.company_name,
    )
    db_session.add(btx_lender)
    db_session.commit()

    # Audit repayment -> syncs to Expense, BankTransaction, and Transactions
    res = client.patch(f"/api/v1/loans/repayments/{rep.loan_repayment_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(exp)
    db_session.refresh(btx_lender)
    assert exp.audit_status == "Verified"
    assert btx_lender.audit_status == "Verified"

    txs = client.get(f"/api/v1/transactions?company_id={lender.company_id}").json()
    rep_tx = next(t for t in txs if t["id"] == f"loan_rep_{rep.loan_repayment_id}:lender")
    assert rep_tx["auditStatus"] == "Verified"


def test_lending_and_tenants_audit_from_domain_syncs_to_bank(db_session):
    comp, bank = _seed_company_and_bank(db_session, "Domain Sync Corp", "acc-dom-1")

    rel_exp = Expense(
        company_id=comp.company_id,
        expense_date=date.today(),
        amount=Decimal("4000.00"),
        amount_paid=Decimal("4000.00"),
        particulars="Lending Release",
        payment_method="Bank Transfer",
        bank_account_id=bank.id,
    )
    db_session.add(rel_exp)
    db_session.flush()
    btx_lend = BankTransaction(
        id="tx-dom-lend",
        bank_account_id=bank.id,
        transaction_date=date.today().strftime("%m/%d/%y"),
        particulars="Lending Release",
        withdrawal=Decimal("4000.00"),
        deposit=Decimal("0.00"),
        net_amount=Decimal("4000.00"),
        source_expense_id=rel_exp.expense_id,
        company_name=comp.company_name,
    )
    db_session.add(btx_lend)
    bor = Borrower(
        borrower_name="Ana",
        principal_amount=Decimal("4000.00"),
        total_payable=Decimal("4800.00"),
        remaining_balance=Decimal("4800.00"),
        date_borrowed=date.today(),
        due_date=date.today(),
        bank_account_id=bank.id,
        release_expense_id=rel_exp.expense_id,
    )
    db_session.add(bor)
    db_session.commit()

    # Audit borrower -> syncs to release_expense_id and BankTransaction
    res = client.patch(f"/api/v1/lending/borrowers/{bor.borrower_id}/audit", json={"audit_status": "Verified"})
    assert res.status_code == 200
    db_session.refresh(rel_exp)
    db_session.refresh(btx_lend)
    assert rel_exp.audit_status == "Verified"
    assert btx_lend.audit_status == "Verified"


@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/v1/bills/999999/audit",
        "/api/v1/receivables/999999/audit",
        "/api/v1/receivables/payments/999999/audit",
        "/api/v1/loans/999999/audit",
        "/api/v1/loans/repayments/999999/audit",
        "/api/v1/petty-cash/topups/999999/audit",
    ],
)
def test_audit_endpoints_return_404_for_missing_records(endpoint):
    res = client.patch(endpoint, json={"audit_status": "Verified"})
    assert res.status_code == 404


def test_audit_endpoints_reject_invalid_status_and_non_auditor():
    # Invalid audit_status -> 422
    res = client.patch("/api/v1/bills/1/audit", json={"audit_status": "InvalidStatus"})
    assert res.status_code == 422

    # Non-auditor user -> 403 when require_auditor_user is not overridden
    app.dependency_overrides.pop(require_auditor_user, None)
    res_unauth = client.patch("/api/v1/bills/1/audit", json={"audit_status": "Verified"})
    assert res_unauth.status_code in (401, 403)


def test_dashboard_summary_includes_deposit_and_audit_status_on_recent_transactions(db_session):
    comp, bank = _seed_company_and_bank(db_session, "Dash Summary Corp", "acc-dash-1")
    sale = Sale(
        company_id=comp.company_id,
        transaction_date=date.today(),
        amount=Decimal("1200.00"),
        particulars="Deposited Sale",
        payment_method="Cash",
        payment_status="Paid",
        deposit_status="Deposited",
        deposit_date=date.today(),
        bank_account_id=bank.id,
        audit_status="Verified",
    )
    db_session.add(sale)
    db_session.commit()

    res = client.get(f"/api/v1/dashboard/summary?company_name={comp.company_name}")
    assert res.status_code == 200
    recent = res.json()["recent_transactions"]
    sale_row = next(r for r in recent if r["id"] == f"sale_{sale.sales_id}")
    assert sale_row["deposit_status"] == "Deposited"
    assert sale_row["deposit_date"] == date.today().isoformat()
    assert sale_row["paid_amount"] == 1200.0
    assert sale_row["audit_status"] == "Verified"

