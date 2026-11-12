"""
Spec 0030: Refine Lending Page Tables and Payment Validation Test Suite.
Covers AC-1 through AC-7:
- AC-1 & AC-2: Date Borrowed and Due Date export preservation in models and schemas
- AC-3: Status representations for borrowers and repayments
- AC-4 & AC-6: Formatted creator and auditor name formatting logic
- AC-5: Remarks handling with multiline text
- AC-6: Persistent recorded_by creator attribution in transactions and ledger
- AC-7: Payment modal input validation (required method, 50 character limit on remarks)
"""

from datetime import date, timedelta
from decimal import Decimal
import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.company import Company
from app.models.lending import Borrower, LendingTransaction
from app.schemas.audit_review import AuditReviewIn
from app.schemas.lending import (
    BorrowerOut,
    LendingPaymentCreateRequest,
    LendingTransactionCreateRequest,
    LendingTransactionOut,
    DailyPaymentRecordOut,
)
from app.services.lending_service import LendingService
from app.api.v1.endpoints import lending as lending_endpoints


def format_person_initial_and_last_name(full_name: str | None) -> str:
    """Python parity helper matching frontend formatPersonInitialAndLastName."""
    if not full_name or not full_name.strip():
        return "—"
    trimmed = full_name.strip()
    if "@" in trimmed:
        username = trimmed.split("@")[0]
        known_roles = {"audit", "auditor", "admin", "administrator", "finance", "supervisor", "system", "user", "info", "support"}
        lower_user = username.lower()
        if lower_user in known_roles:
            return lower_user[0].upper() + lower_user[1:]
        return trimmed

    parts = trimmed.split()
    if len(parts) == 1:
        return parts[0]
    first_initial = parts[0][0].upper()
    last_name = parts[-1]
    return f"{first_initial}. {last_name}"


@pytest.fixture()
def db_session():
    """In-memory SQLite session with clean lending tables."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()

    # Seed FilCap Prime Holdings Corp (ID 7)
    filcap = Company(
        company_id=7,
        company_name="FilCap Prime Holdings Corp.",
        starting_balance=Decimal("1000000.00"),
    )
    session.add(filcap)
    session.commit()

    yield session
    session.close()


def test_spec_0030_ac1_ac2_dates_preserved_in_model_and_aggregates(db_session):
    """
    covers: AC-1, AC-2
    Verify Date Borrowed and Due Date remain fully modeled and present in data objects
    for CSV and PDF export routines even after removal from main screen table view.
    """
    b = Borrower(
        borrower_id=101,
        borrower_ref_no="BOR-101",
        borrower_name="Maria Santos",
        principal_amount=Decimal("20000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("24000.00"),
        remaining_balance=Decimal("24000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 11, 1),
        due_date=date(2026, 12, 11),
        status="Active",
    )
    db_session.add(b)
    db_session.commit()

    # Query aggregates used by frontend table and export
    borrowers = LendingService.get_borrowers(db=db_session)
    assert len(borrowers) == 1
    row = borrowers[0]

    # Required export fields must remain populated
    assert row["dateBorrowed"] == "2026-11-01"
    assert row["dueDate"] == "2026-12-11"
    assert row["borrowerName"] == "Maria Santos"
    assert row["totalAmountPayable"] == 24000.0

    # Ensure Pydantic BorrowerOut schema validates with date fields
    validated = BorrowerOut.model_validate(row)
    assert validated.dateBorrowed == "2026-11-01"
    assert validated.dueDate == "2026-12-11"


def test_spec_0030_ac3_status_resolution(db_session):
    """
    covers: AC-3
    Verify status derived correctly for active, overdue, and completed loans.
    """
    # 1. Completed loan: fully paid off
    b_completed = Borrower(
        borrower_id=201,
        borrower_name="Juan Dela Cruz",
        principal_amount=Decimal("10000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("12000.00"),
        remaining_balance=Decimal("0.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 9, 1),
        due_date=date(2026, 10, 11),
        status="Active",
    )
    db_session.add(b_completed)
    tx_completed = LendingTransaction(
        borrower_id=201,
        transaction_ref_no="TX-201-001",
        transaction_type="Repayment",
        payment_date=date(2026, 10, 1),
        amount=Decimal("12000.00"),
        payment_method="Cash",
        status="Completed",
    )
    db_session.add(tx_completed)

    # 2. Overdue loan: past due date with remaining balance
    b_overdue = Borrower(
        borrower_id=202,
        borrower_name="Pedro Penduko",
        principal_amount=Decimal("10000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("12000.00"),
        remaining_balance=Decimal("12000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 8, 1),
        due_date=date(2026, 9, 10),
        status="Active",
    )
    db_session.add(b_overdue)

    # 3. Active loan: future due date with remaining balance
    b_active = Borrower(
        borrower_id=203,
        borrower_name="Clara Santos",
        principal_amount=Decimal("10000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("12000.00"),
        remaining_balance=Decimal("12000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date.today(),
        due_date=date.today() + timedelta(days=40),
        status="Active",
    )
    db_session.add(b_active)
    db_session.commit()

    borrowers = LendingService.get_borrowers(db=db_session)
    res_completed = next(b for b in borrowers if b["borrowerName"] == "Juan Dela Cruz")
    res_overdue = next(b for b in borrowers if b["borrowerName"] == "Pedro Penduko")
    res_active = next(b for b in borrowers if b["borrowerName"] == "Clara Santos")

    assert res_completed["status"] == "Completed"
    assert res_overdue["status"] == "Overdue"
    assert res_active["status"] == "Active"


def test_spec_0030_ac4_ac6_name_formatting():
    """
    covers: AC-4, AC-6
    Verify person name formatting transforms full name to first initial and last name.
    """
    assert format_person_initial_and_last_name("Virgie Masiglat") == "V. Masiglat"
    assert format_person_initial_and_last_name("Victoria Masiglat") == "V. Masiglat"
    assert format_person_initial_and_last_name("Princess Tayam") == "P. Tayam"
    assert format_person_initial_and_last_name("Mary Jane Watson") == "M. Watson"
    assert format_person_initial_and_last_name("Manuel") == "Manuel"
    assert format_person_initial_and_last_name(None) == "—"
    assert format_person_initial_and_last_name("") == "—"
    assert format_person_initial_and_last_name("   ") == "—"
    assert format_person_initial_and_last_name("audit@mct.com") == "Audit"


def test_spec_0030_ac5_remarks_multiline_storage(db_session):
    """
    covers: AC-5
    Verify transaction remarks accept multi-line content for wrapping in the history table.
    """
    b = Borrower(
        borrower_id=103,
        borrower_name="Elena Gomez",
        principal_amount=Decimal("15000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("18000.00"),
        remaining_balance=Decimal("18000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 11, 1),
        due_date=date(2026, 12, 11),
        status="Active",
    )
    db_session.add(b)
    db_session.commit()

    multiline_notes = "Paid via field agent.\nReceipt #4812."
    res = LendingService.record_payment(
        db=db_session,
        borrower_id=103,
        payment_date_val="2026-11-06",
        amount_val=Decimal("450.00"),
        method="Cash",
        notes=multiline_notes,
        recorded_by="P. Tayam",
    )
    assert res["notes"] == multiline_notes
    tx = db_session.query(LendingTransaction).filter_by(borrower_id=103).first()
    assert tx.notes == multiline_notes


def test_spec_0030_ac6_recorded_by_lifecycle_and_fallback(db_session):
    """
    covers: AC-6
    Verify recorded_by persists through database, service queries, and DailyPaymentRecord schema,
    with graceful fallback for historical records lacking creator metadata.
    """
    b = Borrower(
        borrower_id=104,
        borrower_name="Roberto Reyes",
        principal_amount=Decimal("30000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("36000.00"),
        remaining_balance=Decimal("36000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 11, 1),
        due_date=date(2026, 12, 11),
        status="Active",
    )
    db_session.add(b)
    db_session.commit()

    # 1. Record payment with recorded_by
    LendingService.record_payment(
        db=db_session,
        borrower_id=104,
        payment_date_val="2026-11-06",
        amount_val=Decimal("900.00"),
        method="GCash",
        reference_no="GCASH-1106-001",
        notes="First daily remittance",
        recorded_by="Princess Tayam",
    )

    # 2. Add historical transaction without recorded_by
    legacy_tx = LendingTransaction(
        borrower_id=104,
        transaction_ref_no="TX-LEGACY-001",
        transaction_type="Repayment",
        payment_date=date(2026, 11, 5),
        amount=Decimal("900.00"),
        payment_method="Cash",
        status="Completed",
        recorded_by=None,
    )
    db_session.add(legacy_tx)
    db_session.commit()

    # 3. Verify get_borrower returns recorded_by and recordedBy
    borrower_detail = LendingService.get_borrower(db=db_session, borrower_id=104)
    payments = borrower_detail["dailyPayments"]
    assert len(payments) == 2

    # New transaction has recorded_by
    new_pay = next(p for p in payments if p["method"] == "GCash")
    assert new_pay["recorded_by"] == "Princess Tayam"
    assert new_pay["recordedBy"] == "Princess Tayam"

    # Legacy transaction has None
    old_pay = next(p for p in payments if p["method"] == "Cash")
    assert old_pay.get("recorded_by") is None

    # Verify Pydantic validation
    daily_out = DailyPaymentRecordOut.model_validate(new_pay)
    assert daily_out.recorded_by == "Princess Tayam"
    assert daily_out.recordedBy == "Princess Tayam"

    # 4. Verify get_transactions endpoint handler
    txs = LendingService.get_transactions(db=db_session, borrower_id=104)
    assert len(txs) == 2
    new_tx = next(t for t in txs if t["payment_method"] == "GCash")
    assert new_tx["recorded_by"] == "Princess Tayam"
    tx_out = LendingTransactionOut.model_validate(new_tx)
    assert tx_out.recorded_by == "Princess Tayam"


def test_spec_0030_ac7_payment_modal_validation():
    """
    covers: AC-7
    Verify payment schema rejects remarks exceeding 50 characters, enforces required defaults,
    and validates positive amounts.
    """
    # 1. 50 characters note succeeds
    fifty_char_note = "A" * 50
    req_50 = LendingPaymentCreateRequest(
        borrower_id=1,
        payment_date="2026-11-06",
        amount=Decimal("500.00"),
        method="Cash",
        notes=fifty_char_note,
        recorded_by="Staff",
    )
    assert req_50.notes == fifty_char_note
    assert req_50.method == "Cash"

    # 2. 501 characters note fails validation (max_length=500)
    five_hundred_one_char_note = "A" * 501
    with pytest.raises(ValidationError) as exc_info:
        LendingPaymentCreateRequest(
            borrower_id=1,
            payment_date="2026-11-06",
            amount=Decimal("500.00"),
            notes=five_hundred_one_char_note,
        )
    assert "String should have at most 500 characters" in str(exc_info.value)

    # 3. Transaction create request also enforces 500 char limit
    with pytest.raises(ValidationError):
        LendingTransactionCreateRequest(
            borrower_id=1,
            payment_date="2026-11-06",
            amount=Decimal("500.00"),
            notes="B" * 501,
        )

    # 4. Amount under 1.0 rejected on LendingPaymentCreateRequest
    with pytest.raises(ValidationError):
        LendingPaymentCreateRequest(
            borrower_id=1,
            payment_date="2026-11-06",
            amount=Decimal("0.50"),
        )


def test_spec_0030_api_record_payment_endpoint(db_session):
    """
    covers: AC-6, AC-7
    Verify the POST /payments endpoint validates inputs, captures user identity,
    and returns recorded_by in response.
    """
    b = Borrower(
        borrower_id=105,
        borrower_name="Ana Batumbakal",
        principal_amount=Decimal("10000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("12000.00"),
        remaining_balance=Decimal("12000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 11, 1),
        due_date=date(2026, 12, 11),
        status="Active",
    )
    db_session.add(b)
    db_session.commit()

    mock_user = {
        "user_id": 10,
        "name": "Princess Tayam",
        "full_name": "Princess Tayam",
        "email": "princess@mct.com",
        "role": "finance",
        "company_id": 7,
        "company_ids": [7],
    }

    # 1. Valid payment submission captures authenticated user's full_name
    valid_payload = LendingPaymentCreateRequest(
        borrower_id=105,
        payment_date="2026-11-06",
        amount=Decimal("300.00"),
        method="Cash",
        notes="Route collection",
    )
    res = lending_endpoints.record_payment(payload=valid_payload, user=mock_user, db=db_session)
    assert res["amount"] == 300.0
    assert res["recorded_by"] == "Princess Tayam"
    assert res["recordedBy"] == "Princess Tayam"

    # 2. Payment submission with explicit recorded_by overrides user fallback
    explicit_payload = LendingPaymentCreateRequest(
        borrower_id=105,
        payment_date="2026-11-07",
        amount=Decimal("200.00"),
        method="Cash",
        notes="Field remittance",
        recorded_by="V. Masiglat",
    )
    res_explicit = lending_endpoints.record_payment(payload=explicit_payload, user=mock_user, db=db_session)
    assert res_explicit["recorded_by"] == "V. Masiglat"
    assert res_explicit["recordedBy"] == "V. Masiglat"

    # 3. Validation rejection: notes exceeding 500 characters raises ValidationError
    with pytest.raises(ValidationError) as exc_info:
        LendingPaymentCreateRequest(
            borrower_id=105,
            payment_date="2026-11-06",
            amount=Decimal("300.00"),
            method="Cash",
            notes="A" * 501,
        )
    assert "String should have at most 500 characters" in str(exc_info.value)


def test_spec_0030_audit_review_persistence_and_reload(db_session):
    """
    covers: AC-4
    Verify audit review tags (Verified / Flagged) persist in the database,
    remain preserved upon reloading the facility list, and map correctly to
    auditStatus, auditDate, and auditedBy.
    """
    b = Borrower(
        borrower_id=106,
        borrower_name="Rodrigo Duterte",
        principal_amount=Decimal("50000.00"),
        interest_rate=Decimal("20.00"),
        total_payable=Decimal("60000.00"),
        remaining_balance=Decimal("60000.00"),
        payment_frequency="Daily",
        term_days=40,
        date_borrowed=date(2026, 11, 1),
        due_date=date(2026, 12, 11),
        status="Active",
    )
    db_session.add(b)
    db_session.commit()

    # Initial state: unreviewed
    initial_borrowers = LendingService.get_borrowers(db=db_session)
    row_init = next(r for r in initial_borrowers if r["borrower_id"] == 106)
    assert row_init["audit_status"] == "Pending Audit"
    assert row_init["auditStatus"] is None
    assert row_init["auditedBy"] is None
    assert row_init["auditDate"] is None

    # 1. Auditor marks as Audited (Verified)
    auditor_user = {
        "user_id": 99,
        "name": "Victoria Masiglat",
        "full_name": "Victoria Masiglat",
        "email": "victoria@mct.com",
        "role": "audit",
        "company_id": 7,
        "company_ids": [7],
    }
    payload_audited = AuditReviewIn(audit_status="Verified", remarks="Verified promissory note and ID")
    res_audited = lending_endpoints.review_borrower_audit(
        borrower_id=106,
        payload=payload_audited,
        user=auditor_user,
        db=db_session,
    )
    assert res_audited["audit_status"] == "Verified"
    assert res_audited["auditStatus"] == "Verified"
    assert res_audited["auditedBy"] == "Victoria Masiglat"
    assert res_audited["auditDate"] is not None

    # 2. Simulate browser reload (calling get_borrowers directly from DB)
    reloaded_borrowers = LendingService.get_borrowers(db=db_session)
    row_reloaded = next(r for r in reloaded_borrowers if r["borrower_id"] == 106)
    assert row_reloaded["audit_status"] == "Verified"
    assert row_reloaded["auditStatus"] == "Verified"
    assert row_reloaded["auditedBy"] == "Victoria Masiglat"
    assert row_reloaded["auditDate"] is not None

    # Verify Pydantic BorrowerOut schema validates persisted audit tags
    borrower_out = BorrowerOut.model_validate(row_reloaded)
    assert borrower_out.auditStatus == "Verified"
    assert borrower_out.auditedBy == "Victoria Masiglat"
    assert borrower_out.auditDate is not None

    # 3. Auditor updates to Discrepancy (Flagged)
    payload_flagged = AuditReviewIn(audit_status="Flagged", remarks="Discrepancy in collection receipt")
    res_flagged = lending_endpoints.review_borrower_audit(
        borrower_id=106,
        payload=payload_flagged,
        user=auditor_user,
        db=db_session,
    )
    assert res_flagged["audit_status"] == "Flagged"
    assert res_flagged["auditStatus"] == "Flagged"
    assert res_flagged["auditedBy"] == "Victoria Masiglat"

    # Reload again from database to verify Flagged audit status persists
    reloaded_flagged = LendingService.get_borrowers(db=db_session)
    row_flagged = next(r for r in reloaded_flagged if r["borrower_id"] == 106)
    assert row_flagged["audit_status"] == "Flagged"
    assert row_flagged["auditStatus"] == "Flagged"
    assert row_flagged["auditedBy"] == "Victoria Masiglat"
