from decimal import Decimal
from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.finance import Base, Sale
from app.models.company import Company
from app.models.receivable import Receivable
from app.services.sales_receivables_sync import _extract_status_tag, _KNOWN_STATUS_TAGS
from app.services.receivables_service import ReceivablesService
from app.schemas.receivable import ReceivableUpdate


def test_extract_status_tag_recognizes_partial():
    assert "partial" in _KNOWN_STATUS_TAGS
    cleaned, tag = _extract_status_tag("Deluxe Room Booking [Partial]")
    assert cleaned == "Deluxe Room Booking"
    assert tag == "Partial"


def test_update_receivable_allows_partial_status():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    company = Company(company_id=1, company_name="MCT", starting_balance=Decimal("1000.00"))
    session.add(company)
    session.commit()

    rec = Receivable(
        company_id=1,
        company_name="MCT",
        customer_name="John Doe",
        customer_type="External",
        transaction_date=date.today(),
        items_summary="Booking 101",
        total_amount=Decimal("5000.00"),
        amount_paid=Decimal("0.00"),
        balance=Decimal("5000.00"),
        payment_status="Unpaid",
    )
    session.add(rec)
    session.commit()
    session.refresh(rec)

    # Update payment_status to 'Partial' even when amount_paid is 0
    payload = ReceivableUpdate(payment_status="Partial")
    service = ReceivablesService(session)
    updated = service.update_receivable(rec.receivable_id, payload)
    assert updated.payment_status == "Partial"

    session.close()
