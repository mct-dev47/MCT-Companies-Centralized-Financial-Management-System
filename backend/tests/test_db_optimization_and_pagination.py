from datetime import date
from decimal import Decimal
from fastapi import Response
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.pagination import PaginationParams
from app.db.migrations import run_migrations
from app.db.session import Base
from app.models.bank import BankAccount, BankTransaction
from app.models.company import Company
from app.models.finance import Category, Expense, Sale
from app.models.loan import Loan
from app.models.receivable import Receivable
from app.models.user import User
from app.services.finance_service import FinanceService
from app.services.receivables_service import ReceivablesService
from app.api.v1.endpoints.sales import get_sales, export_sales, get_sales_summary
from app.api.v1.endpoints.expenses import get_expenses, export_expenses, get_expenses_summary
from app.api.v1.endpoints.loans import get_loans
from app.api.v1.endpoints.users import get_users
from app.api.v1.endpoints.companies import get_companies
from app.api.v1.endpoints.bank_accounts import list_bank_account_transactions


def _make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, SessionLocal()


def test_migrations_0066_0069_0070_sqlite():
    engine, db = _make_db()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE staff_credits (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE staff_credits_repayment (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE login_rate_limits (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE budget (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE cash_inflow (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_bank_accounts_company_id ON bank_accounts (company_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_notifications_recipient_feed ON notifications (recipient_user_id, created_at, notification_id)"))

    applied = run_migrations(engine)
    assert "0066_company_categories_dashboard_indexes" in applied
    assert "0069_drop_unused_tables" in applied
    assert "0070_foreign_keys_and_index_cleanup" in applied

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    for dropped in ("staff_credits", "staff_credits_repayment", "login_rate_limits", "budget", "cash_inflow"):
        assert dropped not in tables

    audit_indexes = {idx["name"] for idx in inspector.get_indexes("audit_logs")}
    assert "idx_audit_logs_company_created" in audit_indexes
    assert "idx_audit_logs_created_id" in audit_indexes
    db.close()


def test_group_summary_batch_parity():
    _, db = _make_db()
    c1 = Company(company_name="Alpha Co")
    c2 = Company(company_name="Beta Co")
    db.add_all([c1, c2])
    db.commit()

    db.add_all([
        Sale(company_id=c1.company_id, transaction_date=date(2026, 1, 10), amount=Decimal("1000.00"), particulars="S1"),
        Sale(company_id=c2.company_id, transaction_date=date(2026, 1, 11), amount=Decimal("2500.00"), particulars="S2"),
        Expense(company_id=c1.company_id, expense_date=date(2026, 1, 12), amount=Decimal("400.00"), amount_paid=Decimal("400.00"), description="E1", payment_method="Cash"),
        Expense(company_id=c2.company_id, expense_date=date(2026, 1, 12), amount=Decimal("300.00"), amount_paid=Decimal("300.00"), description="E2", payment_method="Petty Cash"),
        Loan(borrower=c1.company_id, lender=c2.company_id, principal_amount=Decimal("500.00"), loan_date=date(2026, 1, 5), status="Approved"),
    ])
    db.commit()

    svc = FinanceService(db)
    batched = svc.get_group_financial_summaries([c1.company_id, c2.company_id])
    single_1 = svc.get_company_financial_summary(c1.company_id)
    single_2 = svc.get_company_financial_summary(c2.company_id)

    assert batched[0] == single_1
    assert batched[1] == single_2
    db.close()


def test_receivables_summary_kpis_sql_parity():
    _, db = _make_db()
    c = Company(company_name="Gamma Co")
    db.add(c)
    db.commit()
    s1 = Sale(company_id=c.company_id, transaction_date=date(2026, 2, 1), amount=Decimal("500.00"), particulars="Sale 1")
    s2 = Sale(company_id=c.company_id, transaction_date=date(2026, 2, 2), amount=Decimal("300.00"), particulars="Sale 2")
    db.add_all([s1, s2])
    db.commit()

    db.add_all([
        Receivable(
            company_id=c.company_id, company_name=c.company_name, sale_id=s1.sales_id,
            customer_name="Alice", customer_type="external", sale_line_index=0,
            transaction_date=date(2026, 2, 1), items_summary="Item A",
            total_amount=Decimal("500.00"), amount_paid=Decimal("200.00"), balance=Decimal("300.00"),
            payment_status="Partial",
        ),
        Receivable(
            company_id=c.company_id, company_name=c.company_name, sale_id=s2.sales_id,
            customer_name="Bob", customer_type="staff", sale_line_index=0,
            transaction_date=date(2026, 2, 2), items_summary="Item B",
            total_amount=Decimal("300.00"), amount_paid=Decimal("100.00"), balance=Decimal("200.00"),
            payment_status="Partial",
        ),
    ])
    db.commit()

    kpis = ReceivablesService(db).get_summary_kpis(company_id=c.company_id)
    assert kpis.totalSales == Decimal("800.00")
    assert kpis.cashCollected == Decimal("300.00")
    assert kpis.totalOutstanding == Decimal("500.00")
    assert kpis.totalExternalUtang == Decimal("300.00")
    assert kpis.totalStaffUtang == Decimal("200.00")
    assert kpis.externalDebtorCount == 1
    assert kpis.staffDebtorCount == 1
    assert kpis.totalPeopleCount == 2
    db.close()


def test_sales_expenses_loans_bank_users_companies_pagination():
    _, db = _make_db()
    c1 = Company(company_name="Comp One")
    c2 = Company(company_name="Comp Two")
    cat = Category(name="Food")
    db.add_all([c1, c2, cat])
    db.commit()

    for i in range(5):
        db.add(Sale(
            company_id=c1.company_id, category_id=cat.category_id,
            transaction_date=date(2026, 3, i + 1), amount=Decimal("100.00"),
            particulars=f"Sale #{i + 1}", deposit_status="Deposited", payment_status="Paid",
        ))
        db.add(Expense(
            company_id=c1.company_id, category_id=cat.category_id,
            expense_date=date(2026, 3, i + 1), amount=Decimal("50.00"),
            amount_paid=Decimal("50.00"), description=f"Exp #{i + 1}",
        ))
    db.add_all([
        Loan(borrower=c1.company_id, lender=c2.company_id, principal_amount=Decimal("1000.00"), loan_date=date(2026, 3, 1), status="Pending Finance Endorsement"),
        Loan(borrower=c1.company_id, lender=c2.company_id, principal_amount=Decimal("2000.00"), loan_date=date(2026, 3, 2), status="Approved"),
        Loan(borrower=c1.company_id, lender=c2.company_id, principal_amount=Decimal("3000.00"), loan_date=date(2026, 3, 3), status="Disbursed"),
    ])
    bank = BankAccount(id="bank-1", bank_name="BDO", account_name="Main", company_name="Comp One", company_id=c1.company_id)
    db.add(bank)
    db.commit()

    for i in range(4):
        db.add(BankTransaction(
            id=f"tx-{i}", bank_account_id="bank-1", transaction_date=f"2026-03-0{i + 1}",
            particulars=f"Bank tx {i}", deposit=Decimal("100.00"), withdrawal=Decimal("0.00"), net_amount=Decimal("100.00"),
        ))
    db.add_all([
        User(name="Alice Admin", email="alice@example.com", role="admin", is_admin=True),
        User(name="Bob Staff", email="bob@example.com", role="finance", is_admin=False),
    ])
    db.commit()

    admin_user = {"user_id": 1, "role": "admin", "is_admin": True, "company_ids": [c1.company_id, c2.company_id]}
    auditor_user = {"user_id": 2, "role": "auditor", "is_admin": False, "company_ids": []}

    # Sales pagination + summary + export
    s_resp = Response()
    s_page1 = get_sales(company_id=c1.company_id, response=s_resp, pagination=PaginationParams(limit=2, page=1), current_user=admin_user, db=db)
    assert len(s_page1) == 2
    assert s_resp.headers["X-Total-Count"] == "5"
    assert len(export_sales(company_id=c1.company_id, current_user=admin_user, db=db)) == 5
    s_sum = get_sales_summary(company_id=c1.company_id, current_user=admin_user, db=db)
    assert s_sum["total_count"] == 5
    assert s_sum["total_amount"] == 500.0

    # Expenses pagination + summary + export
    e_resp = Response()
    e_page1 = get_expenses(company_id=c1.company_id, response=e_resp, pagination=PaginationParams(limit=2, page=2), current_user=admin_user, db=db)
    assert len(e_page1) == 2
    assert e_resp.headers["X-Total-Count"] == "5"
    assert len(export_expenses(company_id=c1.company_id, current_user=admin_user, db=db)) == 5
    e_sum = get_expenses_summary(company_id=c1.company_id, current_user=admin_user, db=db)
    assert e_sum["total_count"] == 5
    assert e_sum["total_amount"] == 250.0

    # Loans auditor filtering must happen before X-Total-Count and LIMIT/OFFSET
    l_resp = Response()
    l_aud = get_loans(response=l_resp, pagination=PaginationParams(limit=1, page=1), current_user=auditor_user, db=db)
    assert len(l_aud) == 1
    assert l_resp.headers["X-Total-Count"] == "2"

    # Bank transactions pagination
    b_resp = Response()
    b_tx = list_bank_account_transactions(account_id="bank-1", response=b_resp, pagination=PaginationParams(limit=2, page=1), current_user=admin_user, db=db)
    assert len(b_tx) == 2
    assert b_resp.headers["X-Total-Count"] == "4"

    # Users & Companies pagination
    u_resp = Response()
    u_page = get_users(admin_user, response=u_resp, page=1, limit=1, sort_by="asc", db=db)
    assert len(u_page) == 1
    assert u_resp.headers["X-Total-Count"] == "2"

    c_resp = Response()
    c_page = get_companies(admin_user, response=c_resp, page=1, limit=1, sort_by="asc", db=db)
    assert len(c_page) == 1
    assert c_resp.headers["X-Total-Count"] == "2"
    db.close()


def test_http_routes_pagination_owner_rbac_and_delete_company():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.session import get_db
    from app.core.dependencies import get_current_user
    from app.models.daily_remark import DailyRemark
    from app.models.bills import Bill
    from app.services.company_service import CompanyService

    engine, db = _make_db()
    c1 = Company(company_name="Owner Co")
    c2 = Company(company_name="Delete Co")
    db.add_all([c1, c2])
    db.commit()

    # Partial receivable sale: 500 total, 200 paid -> 200 deposited, 300 pending
    s1 = Sale(
        company_id=c1.company_id, transaction_date=date(2026, 4, 1),
        amount=Decimal("500.00"), particulars="Partial Sale [Paid: 200]",
        deposit_status="Deposited", payment_status="Partial",
    )
    s2 = Sale(
        company_id=c1.company_id, transaction_date=date(2026, 4, 2),
        amount=Decimal("300.00"), particulars="Pending Sale",
        deposit_status="Not Deposited", payment_status="Pending",
    )
    db.add_all([s1, s2])
    db.add(Bill(company_id=c1.company_id, bill_name="Electric", amount=Decimal("100.00"), due_date=date(2026, 4, 15)))
    db.add(DailyRemark(company_id=c2.company_id, remark_date=date(2026, 4, 1), kind="sales", remarks="Test remark"))
    bank = BankAccount(id="bank-http-1", bank_name="BPI", account_name="Ops", company_name="Owner Co", company_id=c1.company_id)
    db.add(bank)
    db.commit()
    db.add(Receivable(
        company_id=c1.company_id, company_name=c1.company_name, sale_id=s1.sales_id,
        customer_name="Cust", customer_type="External", sale_line_index=0,
        transaction_date=date(2026, 4, 1), items_summary="Item",
        total_amount=Decimal("500.00"), amount_paid=Decimal("200.00"), balance=Decimal("300.00"),
        payment_status="Partial",
    ))
    db.commit()

    owner_user = {"user_id": 99, "role": "owner", "is_admin": False, "company_ids": []}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: owner_user
    try:
        client = TestClient(app)

        # Owner RBAC + pagination + summary partial split + export
        r_sales = client.get("/api/v1/sales?page=1&limit=1")
        assert r_sales.status_code == 200
        assert r_sales.headers.get("X-Total-Count") == "2"
        assert len(r_sales.json()) == 1

        r_sum = client.get("/api/v1/sales/summary")
        assert r_sum.status_code == 200
        assert r_sum.json()["deposited_amount"] == 200.0
        assert r_sum.json()["pending_amount"] == 600.0

        r_exp = client.get("/api/v1/sales/export")
        assert r_exp.status_code == 200
        assert len(r_exp.json()) == 2

        r_rec = client.get("/api/v1/receivables?page=1&limit=1")
        assert r_rec.status_code == 200
        assert r_rec.headers.get("X-Total-Count") == "1"

        r_bills = client.get("/api/v1/bills/export")
        assert r_bills.status_code == 200
        assert len(r_bills.json()) == 1

        r_banks = client.get("/api/v1/bank-accounts?include_transactions=false")
        assert r_banks.status_code == 200
        assert r_banks.json()[0]["transactions"] == []

        # Company deletion cleans up daily_remarks cleanly
        CompanyService(db).delete_company(c2.company_id)
        assert db.query(DailyRemark).filter(DailyRemark.company_id == c2.company_id).count() == 0
    finally:
        app.dependency_overrides.clear()
        db.close()
