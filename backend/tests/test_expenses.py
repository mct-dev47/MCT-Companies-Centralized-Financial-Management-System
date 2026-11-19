import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
from app.schemas.expense import ExpenseOut
from app.api.v1.endpoints.expenses import get_supabase_mappings, delete_expense, get_expenses
from fastapi import HTTPException

def test_expense_out_schema_resilience():
    """Verify that ExpenseOut can deserialize records with null company_id or dates without crashing."""
    exp = ExpenseOut(
        expense_id=101,
        company_id=None,
        company_name=None,
        category_id=None,
        category_name=None,
        payment_method=None,
        created_by=None,
        expense_date=None,
        cheque_no=None,
        amount=Decimal("150.00"),
        amount_paid=None,
        unpaid_balance=None,
        particulars="Test particulars",
        description="Test particulars"
    )
    assert exp.expense_id == 101
    assert exp.company_id is None
    assert exp.amount == Decimal("150.00")

def test_get_supabase_mappings_uses_session():
    """Verify that get_supabase_mappings accepts an active db session and extracts mappings."""
    mock_db = MagicMock()
    mock_company = MagicMock()
    mock_company.company_id = 10
    mock_company.company_name = "Test Enterprise"
    mock_db.query.return_value.all.return_value = [mock_company]

    with patch("app.api.v1.endpoints.expenses.get_cached", return_value=None):
        with patch("app.api.v1.endpoints.expenses.set_cached") as mock_set_cache:
            comp_map, cat_map = get_supabase_mappings(client=None, db=mock_db)
            assert comp_map.get(10) == "Test Enterprise"
            mock_set_cache.assert_called_once()

def test_delete_expense_unbound_local_prevention():
    """Verify delete_expense initializes client=None and does not fail with UnboundLocalError when client fails."""
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None
    mock_request = MagicMock()
    admin_user = {
        "auth_user_id": "admin-1",
        "user_id": 1,
        "email": "admin@mct.com",
        "company_id": None,
        "company_ids": [],
        "is_admin": True,
        "role": "admin"
    }

    # When get_supabase_admin_client raises an exception and record not found
    with patch("app.api.v1.endpoints.expenses.get_supabase_admin_client", side_effect=Exception("Connection refused")):
        with pytest.raises(HTTPException) as excinfo:
            delete_expense(
                expense_id=99999,
                request=mock_request,
                current_user=admin_user,
                db=mock_db
            )
        assert excinfo.value.status_code == 404
        assert excinfo.value.detail == "Expense not found"

def test_get_expenses_allows_audit_and_finance_roles():
    """Verify that audit (unrestricted) and finance (assigned company) roles can read expenses from SQL."""
    from datetime import date
    from decimal import Decimal
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.db.session import Base
    from app.models.company import Company
    from app.models.finance import Category, Expense

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        db.add(Company(company_id=28, company_name="Kitchen Corp"))
        db.add(Category(category_id=20, name="Supplies"))
        db.add(Expense(
            expense_id=1,
            company_id=28,
            category_id=20,
            payment_method="Cash",
            amount=Decimal("250.00"),
            amount_paid=Decimal("250.00"),
            expense_date=date(2026, 10, 28),
            description="Audited transaction",
        ))
        db.commit()

        for role, company_ids in [("audit", []), ("finance", [28])]:
            user = {
                "auth_user_id": f"{role}-1",
                "user_id": 2,
                "email": f"{role}@mct.com",
                "company_id": None,
                "company_ids": company_ids,
                "is_admin": False,
                "role": role,
            }
            results = get_expenses(
                company_id=None,
                company_name=None,
                category_id=None,
                start_date=None,
                end_date=None,
                current_user=user,
                db=db,
            )
            assert len(results) == 1
            assert results[0].expense_id == 1
            assert results[0].company_id == 28
    finally:
        db.close()
