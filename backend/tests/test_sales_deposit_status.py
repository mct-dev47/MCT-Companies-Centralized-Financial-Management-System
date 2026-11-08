import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.finance import Sale, Base
from app.schemas.sale import SaleCreate, SaleUpdate, SaleOut, DepositStatusUpdate
from app.api.v1.endpoints.sales import update_sale_deposit_status, create_sale, update_sale


def test_sale_model_default_deposit_and_payment_status():
    """Verify that Sale column defaults set payment_status='Paid' and deposit_status='Not Deposited'."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    sale = Sale(
        company_id=1,
        transaction_date=date.today(),
        amount=Decimal("2000.00"),
        particulars="Product Sale",
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)

    assert sale.payment_status == "Paid"
    assert sale.deposit_status == "Not Deposited"
    session.close()


def test_sale_create_schema_paid_allowed_states():
    """Verify Paid sales can be either Deposited or Not Deposited."""
    # Paid + Deposited
    s1 = SaleCreate(
        company_id=1,
        category="Sales",
        transaction_date=date.today(),
        amount=Decimal("100.00"),
        payment_method="Cash",
        payment_status="Paid",
        deposit_status="Deposited",
        particulars="Paid and deposited item",
    )
    assert s1.payment_status == "Paid"
    assert s1.deposit_status == "Deposited"

    # Paid + Not Deposited
    s2 = SaleCreate(
        company_id=1,
        category="Sales",
        transaction_date=date.today(),
        amount=Decimal("100.00"),
        payment_method="Cash",
        payment_status="Paid",
        deposit_status="Not Deposited",
        particulars="Paid but cash in drawer",
    )
    assert s2.payment_status == "Paid"
    assert s2.deposit_status == "Not Deposited"


def test_sale_create_schema_unpaid_validation():
    """Verify Unpaid sales cannot be Deposited and give exact error message."""
    # Unpaid + Not Deposited is valid
    s1 = SaleCreate(
        company_id=1,
        category="Sales",
        transaction_date=date.today(),
        amount=Decimal("150.00"),
        payment_method="Cash",
        payment_status="Unpaid",
        deposit_status="Not Deposited",
        particulars="Unpaid delivery",
    )
    assert s1.payment_status == "Unpaid"
    assert s1.deposit_status == "Not Deposited"

    # Unpaid + Deposited must raise 422 validation error with exact message
    with pytest.raises(ValidationError) as exc_info:
        SaleCreate(
            company_id=1,
            category="Sales",
            transaction_date=date.today(),
            amount=Decimal("150.00"),
            payment_method="Cash",
            payment_status="Unpaid",
            deposit_status="Deposited",
            particulars="Invalid combo",
        )
    assert "Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first." in str(exc_info.value)


def test_sale_create_schema_pending_validation():
    """Verify Pending sales rules for Cheque vs non-Cheque payment methods."""
    # Pending + Not Deposited is valid
    s1 = SaleCreate(
        company_id=1,
        category="Sales",
        transaction_date=date.today(),
        amount=Decimal("250.00"),
        payment_method="Bank Transfer",
        payment_status="Pending",
        deposit_status="Not Deposited",
        particulars="Pending transfer",
    )
    assert s1.deposit_status == "Not Deposited"

    # Pending + Deposited with Bank Transfer must fail
    with pytest.raises(ValidationError) as exc_info:
        SaleCreate(
            company_id=1,
            category="Sales",
            transaction_date=date.today(),
            amount=Decimal("250.00"),
            payment_method="Bank Transfer",
            payment_status="Pending",
            deposit_status="Deposited",
            particulars="Pending transfer deposited error",
        )
    assert "Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance." in str(exc_info.value)

    # Pending + Deposited with Cheque but no cheque_no must fail
    with pytest.raises(ValidationError) as exc_info:
        SaleCreate(
            company_id=1,
            category="Sales",
            transaction_date=date.today(),
            amount=Decimal("250.00"),
            payment_method="Cheque",
            payment_status="Pending",
            deposit_status="Deposited",
            cheque_no=None,
            particulars="Cheque without number",
        )
    assert "Pending sales cannot be marked as deposited unless the payment method is Cheque and physically deposited awaiting clearance." in str(exc_info.value)

    # Pending + Deposited with Cheque and cheque_no is allowed
    s2 = SaleCreate(
        company_id=1,
        category="Sales",
        transaction_date=date.today(),
        amount=Decimal("250.00"),
        payment_method="Cheque",
        payment_status="Pending",
        deposit_status="Deposited",
        cheque_no="CHQ-98765",
        particulars="Cheque deposited awaiting clearance",
    )
    assert s2.payment_status == "Pending"
    assert s2.deposit_status == "Deposited"


def test_sale_update_schema_validation():
    """Verify SaleUpdate raises error when Unpaid is marked Deposited."""
    with pytest.raises(ValidationError) as exc_info:
        SaleUpdate(
            payment_status="Unpaid",
            deposit_status="Deposited",
        )
    assert "Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first." in str(exc_info.value)


def test_patch_sale_deposit_status_verified_conflict():
    """Verify updating deposit status on a Verified sale returns 409 Conflict."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    sale = Sale(
        company_id=1,
        transaction_date=date.today(),
        amount=Decimal("500.00"),
        payment_status="Paid",
        deposit_status="Not Deposited",
        audit_status="Verified",
        particulars="Verified Sale Record",
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)

    mock_request = MagicMock()
    user = {"user_id": 1, "role": "admin", "company_ids": [1]}
    body = DepositStatusUpdate(deposit_status="Deposited")

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync:
        mock_sync.return_value._use_supabase.return_value = False
        with pytest.raises(HTTPException) as exc_info:
            update_sale_deposit_status(
                sales_id=sale.sales_id,
                deposit_in=body,
                request=mock_request,
                current_user=user,
                db=session,
            )
        assert exc_info.value.status_code == 409
        assert "Verified" in exc_info.value.detail and "locked" in exc_info.value.detail

    session.close()


def test_patch_sale_deposit_status_unpaid_rejection():
    """Verify setting deposit status to Deposited on an Unpaid sale returns 422 with exact error."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    sale = Sale(
        company_id=1,
        transaction_date=date.today(),
        amount=Decimal("800.00"),
        payment_status="Unpaid",
        deposit_status="Not Deposited",
        audit_status="Pending Audit",
        particulars="Unpaid Invoice Record",
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)

    mock_request = MagicMock()
    user = {"user_id": 1, "role": "admin", "company_ids": [1]}
    body = DepositStatusUpdate(deposit_status="Deposited")

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync:
        mock_sync.return_value._use_supabase.return_value = False
        with pytest.raises(HTTPException) as exc_info:
            update_sale_deposit_status(
                sales_id=sale.sales_id,
                deposit_in=body,
                request=mock_request,
                current_user=user,
                db=session,
            )
        assert exc_info.value.status_code == 422
        assert "Unpaid sales cannot be marked as deposited. Please mark payment status as Paid first." in exc_info.value.detail

    session.close()


def test_patch_sale_deposit_status_success():
    """Verify setting deposit status to Deposited on a Paid sale succeeds."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    sale = Sale(
        company_id=1,
        transaction_date=date.today(),
        amount=Decimal("1200.00"),
        payment_status="Paid",
        deposit_status="Not Deposited",
        audit_status="Pending Audit",
        particulars="Paid Order",
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)

    mock_request = MagicMock()
    user = {"user_id": 1, "role": "admin", "company_ids": [1]}
    body = DepositStatusUpdate(deposit_status="Deposited")

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync, \
         patch("app.api.v1.endpoints.sales.log_transaction") as mock_log, \
         patch("app.api.v1.endpoints.sales.ws_manager") as mock_ws, \
         patch("app.api.v1.endpoints.sales.resolve_company") as mock_comp:
        mock_sync.return_value._use_supabase.return_value = False
        c = MagicMock()
        c.company_name = "MCT Head Office"
        mock_comp.return_value = c

        res = update_sale_deposit_status(
            sales_id=sale.sales_id,
            deposit_in=body,
            request=mock_request,
            current_user=user,
            db=session,
        )

        assert res.deposit_status == "Deposited"
        session.refresh(sale)
        assert sale.deposit_status == "Deposited"
        assert mock_log.called

    session.close()


def test_update_sale_payment_reversion_auto_resets_deposit():
    """Verify changing payment_status from Paid to Unpaid resets deposit_status to Not Deposited."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    sale = Sale(
        company_id=1,
        transaction_date=date.today(),
        amount=Decimal("950.00"),
        payment_status="Paid",
        deposit_status="Deposited",
        audit_status="Pending Audit",
        particulars="Original Sale [Paid]",
    )
    session.add(sale)
    session.commit()
    session.refresh(sale)

    mock_request = MagicMock()
    user = {"user_id": 1, "role": "admin", "company_ids": [1]}
    update_in = SaleUpdate(
        payment_status="Unpaid",
        # deposit_status not specified, should cascade reset
    )

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync, \
         patch("app.api.v1.endpoints.sales.log_transaction"), \
         patch("app.api.v1.endpoints.sales.ws_manager"), \
         patch("app.api.v1.endpoints.sales.resolve_company") as mock_comp:
        mock_sync.return_value._use_supabase.return_value = False
        c = MagicMock()
        c.company_name = "MCT Head Office"
        mock_comp.return_value = c

        res = update_sale(
            sales_id=sale.sales_id,
            sale_in=update_in,
            request=mock_request,
            current_user=user,
            db=session,
        )

        assert res.payment_status == "Unpaid"
        assert res.deposit_status == "Not Deposited"
        session.refresh(sale)
        assert sale.payment_status == "Unpaid"
        assert sale.deposit_status == "Not Deposited"

    session.close()


def test_daily_summary_scenario_a_deposit_status_filter():
    """Verify that in daily summary, sales only count toward realized_cash if marked Deposited."""
    from app.api.v1.endpoints.sales import get_sales_daily_summary

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    today = date.today()
    # Sale 1: Paid GCash, Not Deposited yet
    sale_gcash = Sale(
        company_id=1,
        transaction_date=today,
        amount=Decimal("1000.00"),
        payment_method="GCash",
        payment_status="Paid",
        deposit_status="Not Deposited",
        particulars="Food delivery [Paid]",
    )
    # Sale 2: Paid Cash, Deposited
    sale_cash = Sale(
        company_id=1,
        transaction_date=today,
        amount=Decimal("2500.00"),
        payment_method="Cash",
        payment_status="Paid",
        deposit_status="Deposited",
        particulars="Dine-in lunch [Paid]",
    )
    session.add_all([sale_gcash, sale_cash])
    session.commit()

    user = {"user_id": 1, "role": "admin", "company_ids": [1]}

    with patch("app.api.v1.endpoints.sales.SalesReceivablesSyncService") as mock_sync:
        mock_sync.return_value._use_supabase.return_value = False

        res = get_sales_daily_summary(
            company_id=1,
            company_name=None,
            category_id=None,
            start_date=None,
            end_date=None,
            status=None,
            view_type=None,
            search=None,
            current_user=user,
            db=session,
        )
        assert len(res) == 1
        summary = res[0]
        # Gross total should include both sales (3500.00)
        assert summary.gross_total == Decimal("3500.00")
        # Realized cash (deposited) should ONLY include the Deposited sale (2500.00)
        assert summary.realized_cash == Decimal("2500.00")

        # Now mark the GCash sale as Deposited
        sale_gcash.deposit_status = "Deposited"
        session.commit()

        res2 = get_sales_daily_summary(
            company_id=1,
            company_name=None,
            category_id=None,
            start_date=None,
            end_date=None,
            status=None,
            view_type=None,
            search=None,
            current_user=user,
            db=session,
        )
        # Realized cash now includes both (3500.00)
        assert res2[0].realized_cash == Decimal("3500.00")

    session.close()
