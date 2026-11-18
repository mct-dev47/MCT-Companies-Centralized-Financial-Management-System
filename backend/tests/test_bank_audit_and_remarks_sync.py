import pytest
from datetime import datetime, timezone
from decimal import Decimal
from fastapi.testclient import TestClient

from app.main import app
from app.db.session import SessionLocal
from app.models.company import Company
from app.models.bank import BankAccount, BankTransaction
from app.models.finance import Expense, Category
from app.api.v1.endpoints.auth import get_current_user

client = TestClient(app)

@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture
def setup_bank_and_expense_data(db_session):
    # Ensure company exists
    company = db_session.query(Company).filter(Company.company_id == 888).first()
    if not company:
        company = Company(
            company_id=888,
            company_name="Test Audit Hospitality Corp",
        )
        db_session.add(company)
        db_session.commit()

    # Ensure bank account exists
    account = db_session.query(BankAccount).filter(BankAccount.id == "bnk-test-audit").first()
    if not account:
        account = BankAccount(
            id="bnk-test-audit",
            company_id=company.company_id,
            company_name=company.company_name,
            bank_name="Test Bank",
            account_name="Test Account 1234",
            account_type="Checking",
            current_balance=Decimal("50000.00"),
            starting_balance=Decimal("50000.00"),
        )
        db_session.add(account)
        db_session.commit()

    # Ensure category exists
    category = db_session.query(Category).filter(Category.category_id == 888).first()
    if not category:
        category = Category(
            category_id=888,
            name="Rent & Utilities",
        )
        db_session.add(category)
        db_session.commit()

    # Create an Expense
    expense = db_session.query(Expense).filter(Expense.expense_id == 88801).first()
    if not expense:
        from datetime import date
        expense = Expense(
            expense_id=88801,
            company_id=company.company_id,
            category_id=category.category_id,
            expense_date=date(2026, 11, 17),
            amount=Decimal("15000.00"),
            amount_paid=Decimal("15000.00"),
            description="Bill Payment: Rent - Nov 17, 2026",
            payment_method="Bank Transfer",
            bank_account_id=account.id,
            audit_status="Pending Audit",
        )
        db_session.add(expense)
        db_session.commit()

    # Create linked BankTransaction
    tx = db_session.query(BankTransaction).filter(BankTransaction.id == "tx-test-audit-888").first()
    if not tx:
        tx = BankTransaction(
            id="tx-test-audit-888",
            bank_account_id=account.id,
            transaction_date="11/17/26",
            particulars="Bill Payment: Rent - Nov 17, 2026",
            withdrawal=Decimal("15000.00"),
            deposit=Decimal("0.00"),
            category="Cash",
            net_amount=Decimal("-15000.00"),
            source_expense_id=expense.expense_id,
            audit_status="Pending Audit",
        )
        db_session.add(tx)
        db_session.commit()

    yield {
        "company": company,
        "account": account,
        "expense": expense,
        "tx": tx,
    }

    # Cleanup
    try:
        db_session.query(BankTransaction).filter(BankTransaction.id == "tx-test-audit-888").delete()
        db_session.query(Expense).filter(Expense.expense_id == 88801).delete()
        db_session.commit()
    except Exception:
        db_session.rollback()

def test_bank_transaction_audit_update_syncs_to_expense(setup_bank_and_expense_data, db_session):
    data = setup_bank_and_expense_data
    auditor_user = {
        "user_id": 99,
        "auth_user_id": "auditor-test-uid",
        "email": "mikaella@mct.com",
        "role": "audit",
        "fullName": "Mikaella Aninion",
        "is_admin": False,
        "company_id": None,
        "company_ids": [],
    }

    app.dependency_overrides[get_current_user] = lambda: auditor_user

    try:
        # 1. Audit the bank transaction via /api/v1/bank-accounts/transactions/{id}/audit
        response = client.patch(
            f"/api/v1/bank-accounts/transactions/{data['tx'].id}/audit",
            json={
                "audit_status": "Verified",
                "audit_remarks": "try again verified with supporting receipt",
            }
        )
        assert response.status_code == 200, response.text
        res_data = response.json()
        assert res_data["audit_status"] == "Verified"
        assert res_data["audit_remarks"] == "try again verified with supporting receipt"
        assert "audited_at" in res_data and res_data["audited_at"] is not None

        # 2. Verify that bank_transaction table has updated fields
        db_session.expire_all()
        bt = db_session.query(BankTransaction).filter(BankTransaction.id == data["tx"].id).first()
        assert bt.audit_status == "Verified"
        assert bt.audit_remarks == "try again verified with supporting receipt"
        assert bt.audited_at is not None

        # 3. Verify that the linked Expense was also updated
        exp = db_session.query(Expense).filter(Expense.expense_id == data["expense"].expense_id).first()
        assert exp.audit_status == "Verified"
        assert exp.audit_remarks == "try again verified with supporting receipt"
        assert exp.audited_at is not None

    finally:
        app.dependency_overrides.pop(get_current_user, None)

def test_expense_endpoint_accepts_tx_id_without_integer_parsing_error(setup_bank_and_expense_data, db_session):
    data = setup_bank_and_expense_data
    auditor_user = {
        "user_id": 99,
        "auth_user_id": "auditor-test-uid",
        "email": "mikaella@mct.com",
        "role": "audit",
        "fullName": "Mikaella Aninion",
        "is_admin": False,
        "company_id": None,
        "company_ids": [],
    }

    app.dependency_overrides[get_current_user] = lambda: auditor_user

    try:
        # Call PATCH /api/v1/expenses/{expense_id}/audit with a "tx-..." string ID
        # Previously, FastAPI would return 422: Path.expense_id: Input should be a valid integer, unable to parse string as an integer
        response = client.patch(
            f"/api/v1/expenses/{data['tx'].id}/audit",
            json={
                "audit_status": "Flagged",
                "audit_remarks": "Found discrepancy in bill payment receipt",
            }
        )
        assert response.status_code == 200, response.text
        res_data = response.json()
        assert res_data["audit_status"] == "Flagged"
        assert res_data["audit_remarks"] == "Found discrepancy in bill payment receipt"

        # Verify linked BankTransaction was also updated
        db_session.expire_all()
        bt = db_session.query(BankTransaction).filter(BankTransaction.id == data["tx"].id).first()
        assert bt.audit_status == "Flagged"
        assert bt.audit_remarks == "Found discrepancy in bill payment receipt"

    finally:
        app.dependency_overrides.pop(get_current_user, None)

def test_activity_timeline_returns_bank_and_expense_milestones(setup_bank_and_expense_data):
    data = setup_bank_and_expense_data
    finance_user = {
        "user_id": 98,
        "auth_user_id": "finance-test-uid",
        "email": "finance@mct.com",
        "role": "finance",
        "fullName": "Finance Officer",
        "is_admin": False,
        "company_id": 888,
        "company_ids": [888],
    }

    app.dependency_overrides[get_current_user] = lambda: finance_user

    try:
        # Add remarks to bank transaction as finance
        res_rem = client.patch(
            f"/api/v1/bank-accounts/transactions/{data['tx'].id}/remarks",
            json={"remarks": "Payment confirmed with landlord"}
        )
        assert res_rem.status_code == 200, res_rem.text

        # Query timeline using tx- ID
        response = client.get(
            f"/api/v1/activity-logs/timeline?record_type=expense&record_id={data['tx'].id}"
        )
        assert response.status_code == 200, response.text
        timeline = response.json()
        assert isinstance(timeline, list)
        assert len(timeline) >= 1
        # Check that timestamp has 'Z' UTC indicator
        for item in timeline:
            assert "timestamp" in item
            assert item["timestamp"].endswith("Z") or "+00:00" in item["timestamp"]

    finally:
        app.dependency_overrides.pop(get_current_user, None)
