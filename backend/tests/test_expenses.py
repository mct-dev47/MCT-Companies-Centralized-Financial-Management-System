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
        reference_no=None,
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
    """Verify that centralized roles (audit, finance) are treated as privileged and not filtered to empty list."""
    mock_db = MagicMock()
    mock_client = MagicMock()
    mock_query = MagicMock()
    mock_client.table.return_value.select.return_value = mock_query
    mock_query.order.return_value = mock_query
    mock_query.range.return_value = mock_query
    mock_query.execute.return_value.data = [
        {
            "expense_id": 1,
            "company_id": 28,
            "category_id": 20,
            "payment_method": "Cash",
            "amount": 250.0,
            "expense_date": "2026-10-28",
            "description": "Audited transaction"
        }
    ]

    for role in ["audit", "finance"]:
        user = {
            "auth_user_id": f"{role}-1",
            "user_id": 2,
            "email": f"{role}@mct.com",
            "company_id": None,
            "company_ids": [],
            "is_admin": role == "admin",
            "role": role
        }
        with patch("app.api.v1.endpoints.expenses.get_supabase_admin_client", return_value=mock_client):
            with patch("app.api.v1.endpoints.expenses.get_supabase_mappings", return_value=({28: "Kitchen Corp"}, {20: "Supplies"})):
                results = get_expenses(
                    company_id=None,
                    company_name=None,
                    category_id=None,
                    start_date=None,
                    end_date=None,
                    current_user=user,
                    db=mock_db
                )
                assert len(results) == 1
                assert results[0].expense_id == 1
                assert results[0].company_id == 28
