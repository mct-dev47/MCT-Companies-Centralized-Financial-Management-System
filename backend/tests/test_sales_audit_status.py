from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.finance import Sale, Expense, Base
from app.schemas.sale import SaleOut
from app.schemas.audit_review import audit_fields

def test_sale_model_default_audit_status():
    """Verify that Sale column default sets audit_status to 'Pending Audit' when omitted."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    sale = Sale(
        company_id=1,
        transaction_date=date.today(),
        amount=Decimal("1500.00"),
        particulars="Food Sales [Paid]",
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)

    assert sale.audit_status == "Pending Audit"
    assert sale.audited_by is None
    assert sale.audited_at is None
    assert sale.audit_remarks is None
    session.close()

def test_sale_out_schema_pending_audit():
    """Verify that SaleOut assigns Pending Audit when audit fields are null or default."""
    row = {
        "sales_id": 99,
        "company_id": 1,
        "category_id": None,
        "payment_method": "Cash",
        "transaction_date": "2026-11-06",
        "cheque_number": None,
        "amount": 1000.0,
        "particulars": "Sample Sale",
        "created_at": "2026-11-06T10:00:00",
        "updated_at": "2026-11-06T10:00:00",
        "audit_status": None,
        "audited_by": None,
        "audited_at": None,
        "audit_remarks": None,
    }
    sale_out = SaleOut(
        sales_id=row["sales_id"],
        company_id=row["company_id"],
        company_name="MCT Kitchen",
        category_id=row["category_id"],
        category_name="None",
        payment_method=row["payment_method"],
        transaction_date=row["transaction_date"],
        cheque_no=None,
        amount=row["amount"],
        particulars=row["particulars"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        **audit_fields(row)
    )
    assert sale_out.audit_status == "Pending Audit"
    assert sale_out.audited_by is None

def test_create_sale_payload_has_clean_audit_fields():
    """Verify that create_sale payload explicitly sets clean audit fields."""
    from app.api.v1.endpoints.sales import create_sale
    from app.schemas.sale import SaleCreate

    mock_db = MagicMock()
    mock_request = MagicMock()
    user = {
        "auth_user_id": "u1",
        "user_id": 1,
        "email": "staff@mct.com",
        "role": "staff",
        "company_id": 1,
        "company_ids": [1],
    }
    sale_in = SaleCreate(
        company_id=1,
        transaction_date=date.today(),
        category="Sales",
        particulars="Test Item [Paid]",
        amount=Decimal("500.00"),
        payment_method="Cash",
    )

    mock_client = MagicMock()
    mock_insert = MagicMock()
    mock_client.table.return_value.insert.return_value = mock_insert
    mock_insert.execute.return_value.data = [{
        "sales_id": 201,
        "company_id": 1,
        "category_id": None,
        "payment_method": "Cash",
        "transaction_date": date.today().isoformat(),
        "cheque_number": None,
        "amount": 500.0,
        "particulars": "Test Item [Paid]",
        "created_at": "2026-11-06T10:00:00Z",
        "updated_at": "2026-11-06T10:00:00Z",
        "audit_status": "Pending Audit",
        "audited_by": None,
        "audited_at": None,
        "audit_remarks": None,
    }]

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync_svc, \
         patch("app.api.v1.endpoints.sales.get_supabase_admin_client", return_value=mock_client), \
         patch("app.api.v1.endpoints.sales.get_supabase_mappings", return_value=({1: "MCT"}, {})), \
         patch("app.api.v1.endpoints.sales.resolve_company") as mock_res_comp, \
         patch("app.api.v1.endpoints.sales.check_company_access"), \
         patch("app.api.v1.endpoints.sales.log_transaction"), \
         patch("app.api.v1.endpoints.sales.ws_manager"):
        mock_sync_svc.return_value._use_supabase.return_value = True
        mock_comp = MagicMock()
        mock_comp.company_id = 1
        mock_comp.company_name = "MCT"
        mock_res_comp.return_value = mock_comp

        res = create_sale(sale_in=sale_in, request=mock_request, current_user=user, db=mock_db)
        assert res.audit_status == "Pending Audit"

        # Assert insert called with audit_status: Pending Audit and null audit metadata
        args, kwargs = mock_client.table.return_value.insert.call_args
        payload = args[0]
        assert payload["audit_status"] == "Pending Audit"
        assert payload["audited_by"] is None
        assert payload["audited_at"] is None
        assert payload["audit_remarks"] is None
